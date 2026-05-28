from django.contrib import admin
from django.utils.html import format_html

from .models import License, MachineActivation, generate_license_key


class MachineActivationInline(admin.TabularInline):
    model = MachineActivation
    extra = 0
    readonly_fields = (
        "machine_id",
        "hostname",
        "app_version",
        "first_activated",
        "last_heartbeat",
        "is_active",
    )
    can_delete = False
    show_change_link = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(License)
class LicenseAdmin(admin.ModelAdmin):
    list_display = (
        "key",
        "client_name",
        "email",
        "plan",
        "colored_status",
        "expires_at",
        "machine_count",
        "created_at",
    )
    list_filter = ("plan", "status")
    search_fields = ("key", "client_name", "email")
    readonly_fields = ("key", "created_at", "updated_at")
    ordering = ("-created_at",)
    inlines = [MachineActivationInline]

    fieldsets = (
        (
            "License Key",
            {
                "fields": ("key",),
                "description": (
                    "The key is auto-generated when a new license is created. "
                    "Use the <em>Regenerate key</em> admin action to issue a new one."
                ),
            },
        ),
        (
            "Client",
            {"fields": ("client_name", "email")},
        ),
        (
            "Plan & Status",
            {"fields": ("plan", "status", "expires_at", "max_machines")},
        ),
        (
            "Notes",
            {"fields": ("notes",), "classes": ("collapse",)},
        ),
        (
            "Timestamps",
            {"fields": ("created_at", "updated_at"), "classes": ("collapse",)},
        ),
    )

    actions = ["suspend_licenses", "activate_licenses", "regenerate_keys"]

    # ------------------------------------------------------------------ #
    # Computed columns
    # ------------------------------------------------------------------ #

    @admin.display(description="Active Machines")
    def machine_count(self, obj):
        active = obj.activations.filter(is_active=True).count()
        total = obj.activations.count()
        return f"{active} / {obj.max_machines} (total: {total})"

    @admin.display(description="Status")
    def colored_status(self, obj):
        colours = {
            "active": "green",
            "suspended": "orange",
            "expired": "red",
        }
        colour = colours.get(obj.status, "black")
        label = obj.get_status_display()
        return format_html('<span style="color: {}; font-weight: bold;">{}</span>', colour, label)

    # ------------------------------------------------------------------ #
    # Actions
    # ------------------------------------------------------------------ #

    @admin.action(description="Suspend selected licenses")
    def suspend_licenses(self, request, queryset):
        updated = queryset.update(status="suspended")
        self.message_user(request, f"{updated} license(s) suspended.")

    @admin.action(description="Activate selected licenses")
    def activate_licenses(self, request, queryset):
        updated = queryset.update(status="active")
        self.message_user(request, f"{updated} license(s) set to active.")

    @admin.action(description="Regenerate key for selected licenses")
    def regenerate_keys(self, request, queryset):
        for lic in queryset:
            lic.key = generate_license_key()
            lic.save(update_fields=["key", "updated_at"])
        self.message_user(
            request,
            f"{queryset.count()} key(s) regenerated. "
            "Make sure to communicate the new keys to the respective clients.",
        )

    # ------------------------------------------------------------------ #
    # Pre-populate key on add form
    # ------------------------------------------------------------------ #

    def get_changeform_initial_data(self, request):
        initial = super().get_changeform_initial_data(request)
        # key field is readonly, so Django won't use this, but we override
        # get_form to make key editable only on the add page.
        initial["key"] = generate_license_key()
        return initial

    def get_readonly_fields(self, request, obj=None):
        # On the add form (obj is None) allow editing the key so admins can
        # customise it; on change forms it is locked.
        if obj is None:
            return ("created_at", "updated_at")
        return ("key", "created_at", "updated_at")


@admin.register(MachineActivation)
class MachineActivationAdmin(admin.ModelAdmin):
    list_display = (
        "machine_id",
        "license",
        "hostname",
        "app_version",
        "is_active",
        "first_activated",
        "last_heartbeat",
    )
    list_filter = ("is_active",)
    search_fields = ("machine_id", "hostname", "license__key", "license__client_name")
    readonly_fields = (
        "machine_id",
        "license",
        "hostname",
        "app_version",
        "first_activated",
        "last_heartbeat",
    )
    ordering = ("-last_heartbeat",)

    def has_add_permission(self, request):
        return False
