"""
Enhanced Django Admin for ShoeDZ.
Provides tenant management, user oversight, audit log, and plan administration.
"""
from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.db.models import Count
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _

from .models import AuditLog, Branch, Tenant, User


# ── Badge helpers ─────────────────────────────────────────────────────────────

def _badge(label, color, bg):
    return format_html(
        '<span style="display:inline-block;padding:2px 10px;border-radius:999px;'
        'font-size:11px;font-weight:700;letter-spacing:.4px;'
        'color:{};background:{};">{}</span>',
        color, bg, label,
    )


PLAN_BADGES = {
    "free":          lambda: _badge("FREE",          "#6b7280", "#f3f4f6"),
    "pro_retail":    lambda: _badge("PRO RETAIL",    "#1d4ed8", "#dbeafe"),
    "pro_wholesale": lambda: _badge("PRO WHOLESALE", "#7c3aed", "#ede9fe"),
    "enterprise":    lambda: _badge("ENTERPRISE",    "#065f46", "#d1fae5"),
}

ROLE_BADGES = {
    "owner":   lambda: _badge("OWNER",   "#92400e", "#fef3c7"),
    "manager": lambda: _badge("MANAGER", "#1d4ed8", "#dbeafe"),
    "cashier": lambda: _badge("CASHIER", "#374151", "#f9fafb"),
}

ACTION_BADGES = {
    "create": lambda: _badge("CREATE", "#065f46", "#d1fae5"),
    "update": lambda: _badge("UPDATE", "#1d4ed8", "#dbeafe"),
    "delete": lambda: _badge("DELETE", "#991b1b", "#fee2e2"),
}


def plan_badge(plan):
    fn = PLAN_BADGES.get(plan)
    return fn() if fn else _badge(plan.upper(), "#374151", "#f9fafb")


def role_badge(role):
    fn = ROLE_BADGES.get(role)
    return fn() if fn else _badge(role.upper(), "#374151", "#f9fafb")


def action_badge(action):
    fn = ACTION_BADGES.get(action)
    return fn() if fn else _badge(action.upper(), "#374151", "#f9fafb")


def active_badge(is_active, yes="Active", no="Inactive"):
    if is_active:
        return _badge(yes, "#065f46", "#d1fae5")
    return _badge(no, "#991b1b", "#fee2e2")


# ── Inlines ───────────────────────────────────────────────────────────────────

class UserInline(admin.TabularInline):
    model = User
    fields = ("email", "_name", "role", "is_active")
    readonly_fields = ("email", "_name", "role", "is_active")
    extra = 0
    can_delete = False
    show_change_link = True
    verbose_name_plural = "Users"

    def _name(self, obj):
        return obj.get_full_name() or "—"
    _name.short_description = "Name"


class BranchInline(admin.TabularInline):
    model = Branch
    fields = ("name", "wilaya", "is_headquarters", "is_active")
    readonly_fields = ("name", "wilaya", "is_headquarters", "is_active")
    extra = 0
    can_delete = False
    show_change_link = True
    verbose_name_plural = "Branches"


# ── Tenant ────────────────────────────────────────────────────────────────────

@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = (
        "name", "_plan", "_active",
        "_users", "_branches", "wilaya", "created_at",
    )
    list_filter = ("plan", "is_active", "wilaya")
    search_fields = ("name", "nif", "rc", "phone")
    readonly_fields = ("id", "created_at", "updated_at")
    ordering = ("-created_at",)
    inlines = [BranchInline, UserInline]
    actions = [
        "set_free", "set_pro_retail", "set_pro_wholesale",
        "activate", "suspend",
    ]
    fieldsets = (
        (None, {
            "fields": ("id", "name", "plan", "is_active"),
        }),
        ("Informations commerciales", {
            "fields": ("nif", "rc", "ai", "phone", "address", "wilaya", "logo"),
            "classes": ("collapse",),
        }),
        ("Horodatages", {
            "fields": ("created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )

    def get_queryset(self, request):
        return (
            super().get_queryset(request)
            .annotate(
                _user_count=Count("users", distinct=True),
                _branch_count=Count("branches", distinct=True),
            )
        )

    @admin.display(description="Plan", ordering="plan")
    def _plan(self, obj):
        return plan_badge(obj.plan)

    @admin.display(description="Statut", ordering="is_active")
    def _active(self, obj):
        return active_badge(obj.is_active, "Actif", "Suspendu")

    @admin.display(description="Utilisateurs", ordering="_user_count")
    def _users(self, obj):
        return obj._user_count

    @admin.display(description="Agences", ordering="_branch_count")
    def _branches(self, obj):
        return obj._branch_count

    # Actions
    @admin.action(description="Changer le plan → Gratuit")
    def set_free(self, request, qs):
        qs.update(plan="free")
        self.message_user(request, f"{qs.count()} tenant(s) passé(s) en Gratuit.", messages.SUCCESS)

    @admin.action(description="Changer le plan → Pro Retail")
    def set_pro_retail(self, request, qs):
        qs.update(plan="pro_retail")
        self.message_user(request, f"{qs.count()} tenant(s) passé(s) en Pro Retail.", messages.SUCCESS)

    @admin.action(description="Changer le plan → Pro Wholesale")
    def set_pro_wholesale(self, request, qs):
        qs.update(plan="pro_wholesale")
        self.message_user(request, f"{qs.count()} tenant(s) passé(s) en Pro Wholesale.", messages.SUCCESS)

    @admin.action(description="Activer les tenants sélectionnés")
    def activate(self, request, qs):
        n = qs.update(is_active=True)
        self.message_user(request, f"{n} tenant(s) activé(s).", messages.SUCCESS)

    @admin.action(description="Suspendre les tenants sélectionnés")
    def suspend(self, request, qs):
        n = qs.update(is_active=False)
        self.message_user(request, f"{n} tenant(s) suspendu(s).", messages.WARNING)


# ── User ──────────────────────────────────────────────────────────────────────

@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        "email", "_name", "_tenant", "_role", "_active", "last_login",
    )
    list_filter = ("role", "is_active", "tenant__plan")
    search_fields = ("email", "first_name", "last_name", "tenant__name")
    ordering = ("-date_joined",)
    actions = ["activate_users", "deactivate_users"]

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        (_("Informations personnelles"), {"fields": ("first_name", "last_name", "phone")}),
        (_("Organisation"), {"fields": ("tenant", "role", "language_preference")}),
        (_("Permissions"), {
            "fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions"),
            "classes": ("collapse",),
        }),
        (_("Dates importantes"), {
            "fields": ("last_login", "date_joined"),
            "classes": ("collapse",),
        }),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "password1", "password2", "tenant", "role"),
        }),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("tenant")

    @admin.display(description="Nom")
    def _name(self, obj):
        return obj.get_full_name() or "—"

    @admin.display(description="Tenant", ordering="tenant__name")
    def _tenant(self, obj):
        if not obj.tenant:
            return format_html('<em style="color:#9ca3af">Superadmin</em>')
        url = f"/admin/core/tenant/{obj.tenant.pk}/change/"
        return format_html('<a href="{}">{}</a>', url, obj.tenant.name)

    @admin.display(description="Rôle", ordering="role")
    def _role(self, obj):
        return role_badge(obj.role)

    @admin.display(description="Statut", ordering="is_active")
    def _active(self, obj):
        return active_badge(obj.is_active)

    @admin.action(description="Activer les utilisateurs sélectionnés")
    def activate_users(self, request, qs):
        n = qs.update(is_active=True)
        self.message_user(request, f"{n} utilisateur(s) activé(s).", messages.SUCCESS)

    @admin.action(description="Désactiver les utilisateurs sélectionnés")
    def deactivate_users(self, request, qs):
        n = qs.update(is_active=False)
        self.message_user(request, f"{n} utilisateur(s) désactivé(s).", messages.WARNING)


# ── Branch ────────────────────────────────────────────────────────────────────

@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ("name", "_tenant", "wilaya", "_hq", "_active")
    list_filter = ("is_active", "is_headquarters", "wilaya")
    search_fields = ("name", "tenant__name")
    ordering = ("tenant__name", "name")

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("tenant")

    @admin.display(description="Tenant", ordering="tenant__name")
    def _tenant(self, obj):
        url = f"/admin/core/tenant/{obj.tenant.pk}/change/"
        return format_html('<a href="{}">{}</a>', url, obj.tenant.name)

    @admin.display(description="Siège")
    def _hq(self, obj):
        return _badge("SIÈGE", "#1d4ed8", "#dbeafe") if obj.is_headquarters else "—"

    @admin.display(description="Statut")
    def _active(self, obj):
        return active_badge(obj.is_active)


# ── AuditLog ──────────────────────────────────────────────────────────────────

@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = (
        "timestamp", "_action", "model_name",
        "_object", "_user", "_tenant",
    )
    list_filter = ("action", "model_name", "tenant")
    search_fields = ("model_name", "object_repr", "user__email", "tenant__name")
    readonly_fields = (
        "tenant", "user", "action", "model_name",
        "object_id", "object_repr", "_diff", "timestamp",
    )
    ordering = ("-timestamp",)
    date_hierarchy = "timestamp"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("user", "tenant")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="Action")
    def _action(self, obj):
        return action_badge(obj.action)

    @admin.display(description="Objet")
    def _object(self, obj):
        s = obj.object_repr
        return s[:70] + ("…" if len(s) > 70 else "")

    @admin.display(description="Utilisateur")
    def _user(self, obj):
        return obj.user.email if obj.user else format_html('<em style="color:#9ca3af">—</em>')

    @admin.display(description="Tenant")
    def _tenant(self, obj):
        return obj.tenant.name if obj.tenant else "—"

    @admin.display(description="Modifications")
    def _diff(self, obj):
        if not obj.diff:
            return format_html('<em style="color:#9ca3af">Aucune modification enregistrée</em>')
        rows = "".join(
            format_html(
                "<tr>"
                "<td style='padding:4px 10px;font-weight:600;color:#374151;white-space:nowrap'>{}</td>"
                "<td style='padding:4px 10px;color:#dc2626;font-family:monospace'>{}</td>"
                "<td style='padding:4px 10px;color:#059669;font-family:monospace'>{}</td>"
                "</tr>",
                field,
                change.get("from", ""),
                change.get("to", ""),
            )
            for field, change in obj.diff.items()
        )
        return format_html(
            "<table style='border-collapse:collapse;font-size:12px;min-width:400px'>"
            "<thead><tr style='background:#f9fafb'>"
            "<th style='padding:4px 10px;text-align:left;color:#6b7280;font-size:11px'>CHAMP</th>"
            "<th style='padding:4px 10px;text-align:left;color:#6b7280;font-size:11px'>AVANT</th>"
            "<th style='padding:4px 10px;text-align:left;color:#6b7280;font-size:11px'>APRÈS</th>"
            "</tr></thead><tbody>{}</tbody></table>",
            format_html(rows),
        )
