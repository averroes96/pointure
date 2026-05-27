"""
Core models: Tenant, User, Branch, AuditLog, and TenantScopedModel base.
These are the foundation of the entire ShoeDZ system.
"""
import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils.translation import gettext_lazy as _

from .managers import TenantManager


# ─────────────────────────────────────────────
# Choices
# ─────────────────────────────────────────────

class PlanChoices(models.TextChoices):
    FREE = "free", _("Free")
    PRO_RETAIL = "pro_retail", _("Pro Retail")
    PRO_WHOLESALE = "pro_wholesale", _("Pro Wholesale")
    ENTERPRISE = "enterprise", _("Enterprise")


class RoleChoices(models.TextChoices):
    OWNER = "owner", _("Owner")
    MANAGER = "manager", _("Manager")
    CASHIER = "cashier", _("Cashier")


class LanguageChoices(models.TextChoices):
    ARABIC = "ar", _("Arabic (Darija)")
    FRENCH = "fr", _("French")
    ENGLISH = "en", _("English")


WILAYA_CHOICES = [
    ("01", "Adrar"), ("02", "Chlef"), ("03", "Laghouat"), ("04", "Oum El Bouaghi"),
    ("05", "Batna"), ("06", "Béjaïa"), ("07", "Biskra"), ("08", "Béchar"),
    ("09", "Blida"), ("10", "Bouira"), ("11", "Tamanrasset"), ("12", "Tébessa"),
    ("13", "Tlemcen"), ("14", "Tiaret"), ("15", "Tizi Ouzou"), ("16", "Alger"),
    ("17", "Djelfa"), ("18", "Jijel"), ("19", "Sétif"), ("20", "Saïda"),
    ("21", "Skikda"), ("22", "Sidi Bel Abbès"), ("23", "Annaba"), ("24", "Guelma"),
    ("25", "Constantine"), ("26", "Médéa"), ("27", "Mostaganem"), ("28", "M'Sila"),
    ("29", "Mascara"), ("30", "Ouargla"), ("31", "Oran"), ("32", "El Bayadh"),
    ("33", "Illizi"), ("34", "Bordj Bou Arréridj"), ("35", "Boumerdès"),
    ("36", "El Tarf"), ("37", "Tindouf"), ("38", "Tissemsilt"), ("39", "El Oued"),
    ("40", "Khenchela"), ("41", "Souk Ahras"), ("42", "Tipaza"), ("43", "Mila"),
    ("44", "Aïn Defla"), ("45", "Naâma"), ("46", "Aïn Témouchent"),
    ("47", "Ghardaïa"), ("48", "Relizane"), ("49", "Timimoun"), ("50", "Bordj Badji Mokhtar"),
    ("51", "Ouled Djellal"), ("52", "Béni Abbès"), ("53", "In Salah"),
    ("54", "In Guezzam"), ("55", "Touggourt"), ("56", "Djanet"),
    ("57", "El M'Ghair"), ("58", "El Meniaa"),
]


# ─────────────────────────────────────────────
# Tenant
# ─────────────────────────────────────────────

class Tenant(models.Model):
    """Top-level isolation unit. Every other entity belongs to a tenant."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(_("Business Name"), max_length=200)
    plan = models.CharField(
        _("Subscription Plan"),
        max_length=20,
        choices=PlanChoices.choices,
        default=PlanChoices.FREE,
    )
    is_active = models.BooleanField(_("Active"), default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Business info
    nif = models.CharField(_("NIF"), max_length=20, blank=True)
    rc = models.CharField(_("RC"), max_length=30, blank=True)
    ai = models.CharField(_("AI"), max_length=30, blank=True)
    phone = models.CharField(_("Phone"), max_length=20, blank=True)
    address = models.TextField(_("Address"), blank=True)
    wilaya = models.CharField(_("Wilaya"), max_length=2, choices=WILAYA_CHOICES, blank=True)
    logo = models.ImageField(_("Logo"), upload_to="tenants/logos/", blank=True, null=True)

    class Meta:
        verbose_name = _("Tenant")
        verbose_name_plural = _("Tenants")

    def __str__(self):
        return self.name

    @property
    def is_pro(self):
        return self.plan in (PlanChoices.PRO_RETAIL, PlanChoices.PRO_WHOLESALE, PlanChoices.ENTERPRISE)

    @property
    def is_wholesale(self):
        return self.plan in (PlanChoices.PRO_WHOLESALE, PlanChoices.ENTERPRISE)


# ─────────────────────────────────────────────
# User
# ─────────────────────────────────────────────

class User(AbstractUser):
    """Custom user model. Tied to a tenant and has a role."""
    # Remove username — we use email
    username = None
    email = models.EmailField(_("Email Address"), unique=True)

    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        related_name="users",
        null=True,
        blank=True,  # Super-admin users have no tenant
    )
    role = models.CharField(
        _("Role"),
        max_length=10,
        choices=RoleChoices.choices,
        default=RoleChoices.CASHIER,
    )
    language_preference = models.CharField(
        _("Language"),
        max_length=2,
        choices=LanguageChoices.choices,
        default=LanguageChoices.FRENCH,
    )
    phone = models.CharField(_("Phone"), max_length=20, blank=True)
    avatar = models.ImageField(_("Avatar"), upload_to="users/avatars/", blank=True, null=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        verbose_name = _("User")
        verbose_name_plural = _("Users")

    def __str__(self):
        return self.email

    @property
    def is_owner(self):
        return self.role == RoleChoices.OWNER

    @property
    def is_manager(self):
        return self.role in (RoleChoices.OWNER, RoleChoices.MANAGER)

    @property
    def can_see_costs(self):
        """Cashiers cannot see purchase prices or gross margin."""
        return self.role in (RoleChoices.OWNER, RoleChoices.MANAGER)


# ─────────────────────────────────────────────
# Branch
# ─────────────────────────────────────────────

class Branch(models.Model):
    """A physical location belonging to a tenant."""
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="branches")
    name = models.CharField(_("Branch Name"), max_length=150)
    address = models.TextField(_("Address"), blank=True)
    wilaya = models.CharField(_("Wilaya"), max_length=2, choices=WILAYA_CHOICES, blank=True)
    phone = models.CharField(_("Phone"), max_length=20, blank=True)
    is_headquarters = models.BooleanField(_("Headquarters"), default=False)
    is_active = models.BooleanField(_("Active"), default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Branch")
        verbose_name_plural = _("Branches")
        unique_together = [["tenant", "name"]]

    def __str__(self):
        return f"{self.tenant.name} — {self.name}"


# ─────────────────────────────────────────────
# TenantScopedModel (abstract base)
# ─────────────────────────────────────────────

class TenantScopedModel(models.Model):
    """
    Abstract base for all tenant-scoped models.
    The custom TenantManager auto-filters by request.tenant.
    Direct use of .objects is intentionally shadowed — always use from views.
    """
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        related_name="+",
        editable=False,
    )
    objects = TenantManager()

    class Meta:
        abstract = True


# ─────────────────────────────────────────────
# AuditLog
# ─────────────────────────────────────────────

class AuditLog(models.Model):
    """
    Immutable audit trail. Written via Django signals on financial models.
    Owner-only view in the admin.
    """
    class ActionChoices(models.TextChoices):
        CREATE = "create", _("Created")
        UPDATE = "update", _("Updated")
        DELETE = "delete", _("Deleted")

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="audit_logs")
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="audit_logs"
    )
    action = models.CharField(max_length=10, choices=ActionChoices.choices)
    model_name = models.CharField(max_length=100)
    object_id = models.CharField(max_length=50)
    object_repr = models.CharField(max_length=300, blank=True)
    diff = models.JSONField(default=dict, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = _("Audit Log")
        verbose_name_plural = _("Audit Logs")
        ordering = ["-timestamp"]
        # This table should never be modified after insert
        default_permissions = ("view",)

    def __str__(self):
        return f"{self.action} {self.model_name}#{self.object_id} by {self.user}"
