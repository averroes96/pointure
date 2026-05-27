"""Core admin configuration."""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.translation import gettext_lazy as _

from .models import AuditLog, Branch, Tenant, User


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ["name", "plan", "is_active", "user_count", "created_at"]
    list_filter = ["plan", "is_active", "wilaya"]
    search_fields = ["name", "nif", "rc"]
    readonly_fields = ["id", "created_at", "updated_at"]

    def user_count(self, obj):
        return obj.users.count()
    user_count.short_description = "Users"


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["email", "get_full_name", "tenant", "role", "is_active", "date_joined"]
    list_filter = ["role", "is_active", "tenant"]
    search_fields = ["email", "first_name", "last_name"]
    ordering = ["-date_joined"]

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        (_("Personal info"), {"fields": ("first_name", "last_name", "phone", "avatar")}),
        (_("Organisation"), {"fields": ("tenant", "role", "language_preference")}),
        (_("Permissions"), {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        (_("Important dates"), {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "password1", "password2", "tenant", "role"),
        }),
    )


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ["name", "tenant", "wilaya", "is_headquarters", "is_active"]
    list_filter = ["is_active", "is_headquarters", "wilaya"]
    search_fields = ["name", "tenant__name"]


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["timestamp", "action", "model_name", "object_repr", "user", "tenant"]
    list_filter = ["action", "model_name", "tenant"]
    search_fields = ["model_name", "object_repr", "user__email"]
    readonly_fields = ["tenant", "user", "action", "model_name", "object_id", "object_repr", "diff", "timestamp"]
    ordering = ["-timestamp"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
