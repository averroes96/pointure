from urllib.parse import urlparse

from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from .models import ProviderConfig, CustomerOrder
from .services import catalogue


class ProviderConfigSerializer(serializers.ModelSerializer):
    """
    A courier account (docs/plans/delivery-v1-plan.md P1.4).

    - `courier` is a key of the dzship catalogue; it cannot change after creation.
    - `credentials` is write-only and must use exactly the catalogue's credential names.
      On update, the given credentials are merged into the saved ones (replace one field
      without retyping the others). Values are never returned: `saved_credentials` lists
      names only.
    - `base_url` is required for, and only allowed on, couriers whose catalogue entry
      says `requires_base_url` (the generic Ecotrack key).
    """
    credentials = serializers.DictField(
        child=serializers.CharField(max_length=512, trim_whitespace=True),
        write_only=True,
        required=False,
    )
    courier_name = serializers.SerializerMethodField()
    platform = serializers.SerializerMethodField()
    required_credentials = serializers.SerializerMethodField()
    saved_credentials = serializers.SerializerMethodField()
    missing_credentials = serializers.SerializerMethodField()

    class Meta:
        model = ProviderConfig
        fields = [
            "id",
            "courier",
            "courier_name",
            "platform",
            "required_credentials",
            "saved_credentials",
            "missing_credentials",
            "credentials",
            "base_url",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    # ── catalogue lookups (one snapshot read per request) ─────────────────────
    def _entry(self, key):
        cache = self.context.setdefault("_catalogue_by_key", None)
        if cache is None:
            snapshot = catalogue.load_snapshot()
            cache = {c["key"]: c for c in (snapshot["couriers"] if snapshot else [])}
            self.context["_catalogue_by_key"] = cache
        return cache.get(key)

    def get_courier_name(self, obj):
        entry = self._entry(obj.courier)
        return entry["name"] if entry else obj.courier

    def get_platform(self, obj):
        entry = self._entry(obj.courier)
        return entry["platform"] if entry else None

    def get_required_credentials(self, obj):
        entry = self._entry(obj.courier)
        return entry["required_credentials"] if entry else []

    def get_saved_credentials(self, obj):
        return sorted(k for k, v in (obj.credentials or {}).items() if v)

    def get_missing_credentials(self, obj):
        entry = self._entry(obj.courier)
        if not entry:
            return []
        saved = obj.credentials or {}
        return [name for name in entry["required_credentials"] if not saved.get(name)]

    # ── validation ────────────────────────────────────────────────────────────
    def validate_courier(self, value):
        value = (value or "").strip()
        if self.instance is not None and value != self.instance.courier:
            raise serializers.ValidationError(_("Le transporteur d'une configuration ne peut pas être changé."))
        return value

    def validate(self, attrs):
        instance = self.instance
        courier = attrs.get("courier", instance.courier if instance else "")
        creating = instance is None
        touches_access = creating or "credentials" in attrs or "base_url" in attrs

        if creating and not courier:
            raise serializers.ValidationError({"courier": _("Choisissez un transporteur.")})

        if touches_access:
            entry = self._entry(courier)
            if entry is None:
                raise serializers.ValidationError({
                    "courier": _(
                        "Transporteur inconnu, ou liste des transporteurs pas encore chargée. "
                        "Connectez-vous à Internet puis réessayez."
                    )
                })

            given = attrs.get("credentials", {}) or {}
            unknown = sorted(set(given) - set(entry["required_credentials"]))
            if unknown:
                raise serializers.ValidationError({
                    "credentials": _("Champs inattendus pour ce transporteur : %(names)s")
                    % {"names": ", ".join(unknown)}
                })
            if any(not v for v in given.values()):
                raise serializers.ValidationError({"credentials": _("Un identifiant ne peut pas être vide.")})

            merged = {**((instance.credentials or {}) if instance else {}), **given}
            if creating:
                missing = [n for n in entry["required_credentials"] if not merged.get(n)]
                if missing:
                    raise serializers.ValidationError({
                        "credentials": _("Identifiants manquants : %(names)s") % {"names": ", ".join(missing)}
                    })
            attrs["credentials"] = merged

            base_url = attrs.get("base_url", instance.base_url if instance else "") or ""
            base_url = base_url.strip().rstrip("/")
            if entry["requires_base_url"]:
                parsed = urlparse(base_url)
                host = (parsed.hostname or "").lower()
                if parsed.scheme != "https" or not any(host.endswith(s) for s in entry["base_url_suffixes"]):
                    raise serializers.ValidationError({
                        "base_url": _("Adresse invalide : elle doit commencer par https:// et finir par %(suffixes)s")
                        % {"suffixes": ", ".join(entry["base_url_suffixes"])}
                    })
            elif base_url:
                raise serializers.ValidationError({"base_url": _("Ce transporteur n'utilise pas d'adresse personnalisée.")})
            attrs["base_url"] = base_url

        if creating:
            tenant = getattr(self.context.get("request"), "tenant", None)
            if tenant and ProviderConfig.objects.filter(tenant=tenant, courier=courier).exists():
                raise serializers.ValidationError({"courier": _("Ce transporteur est déjà configuré.")})
        return attrs


class CustomerOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerOrder
        fields = [
            "id",
            "source",
            "customer_name",
            "customer_phone",
            "wilaya",
            "commune",
            "address",
            "customer_notes",
            "status",
            "shipping_fee",
            "provider",
            "tracking_number",
            "sale",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "provider",
            "tracking_number",
            "sale",
            "created_at",
            "updated_at",
        ]


class CustomerOrderDispatchSerializer(serializers.Serializer):
    """
    Serializer used when a store manager validates a draft order and dispatches it.
    """
    # The courier key of one of the store's active ProviderConfigs (e.g. "maystro").
    provider = serializers.CharField(max_length=50)
    # The total price the customer pays on delivery (COD amount).
    # Stores set this manually — it may or may not match the sum of product prices.
    total_price = serializers.DecimalField(max_digits=10, decimal_places=2)
    # The manager must select the specific variants that correspond to what the customer ordered.
    variant_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=False,
        help_text="The exact inventory variants to include in the Sale."
    )
    quantities = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False
    )

    def validate(self, attrs):
        if len(attrs["variant_ids"]) != len(attrs["quantities"]):
            raise serializers.ValidationError("variant_ids and quantities must be the same length.")
        return attrs
