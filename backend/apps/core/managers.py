"""
Managers for the core app.

UserManager   — email-based auth (no username).
TenantManager — automatically scopes all querysets to the current tenant.
                This is the primary security mechanism preventing cross-tenant
                data leakage.
"""
import threading

from django.contrib.auth.base_user import BaseUserManager
from django.db import models

# Thread-local storage for the current request's tenant
_thread_locals = threading.local()


def set_current_tenant(tenant):
    """Called by TenantMiddleware on each request."""
    _thread_locals.tenant = tenant


def get_current_tenant():
    """Returns the tenant for the current thread, or None."""
    return getattr(_thread_locals, "tenant", None)


def clear_current_tenant():
    """Called at the end of each request."""
    _thread_locals.tenant = None


class UserManager(BaseUserManager):
    """
    Custom user manager for the email-based User model.
    Replaces Django's default UserManager which requires `username`.
    """

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("An email address is required.")
        email = self.normalize_email(email)
        extra_fields.setdefault("is_active", True)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self.create_user(email, password, **extra_fields)


class TenantQuerySet(models.QuerySet):
    """QuerySet that is always scoped to the current tenant."""

    def for_tenant(self, tenant):
        """Explicitly scope to a specific tenant (used in management commands)."""
        return self.filter(tenant=tenant)


class TenantManager(models.Manager):
    """
    Manager that automatically filters by the current thread-local tenant.
    Falls back to unfiltered queryset when no tenant is set (admin/management commands).
    """

    def get_queryset(self):
        qs = TenantQuerySet(self.model, using=self._db)
        tenant = get_current_tenant()
        if tenant is not None:
            return qs.filter(tenant=tenant)
        return qs

    def unscoped(self):
        """Return all objects regardless of tenant (super-admin use only)."""
        return TenantQuerySet(self.model, using=self._db)
