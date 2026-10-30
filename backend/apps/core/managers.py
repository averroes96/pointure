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
    Custom user manager supporting phone-first identity with legacy email support.
    """

    def create_user(self, phone=None, password=None, email=None, **extra_fields):
        from apps.core.utils.phone import normalize_algerian_phone

        # Handle backward compatibility:
        # 1. Called as create_user("user@example.com", "pass") -> phone contains "@", email is None
        if phone and "@" in str(phone) and not email:
            email = phone
            phone = extra_fields.pop("phone", None)
        # 2. Called as create_user(email="user@example.com", password="...") -> phone is None, email in extra_fields or kwargs
        elif not phone and "email" in extra_fields and not email:
            email = extra_fields.pop("email")

        # 3. Called as create_user(phone="0555...", ...) -> phone is in extra_fields if passed as kwarg
        if not phone and "phone" in extra_fields:
            phone = extra_fields.pop("phone")

        if not phone and not email:
            raise ValueError("A phone number or email address is required.")

        normalized_phone = normalize_algerian_phone(phone) if phone else None
        normalized_email = self.normalize_email(email).lower() if email else None

        extra_fields.setdefault("is_active", True)
        user = self.model(
            phone=normalized_phone or None,
            email=normalized_email or None,
            **extra_fields,
        )
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, phone=None, password=None, email=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self.create_user(phone=phone, password=password, email=email, **extra_fields)

    def get_by_natural_key(self, username):
        from apps.core.utils.phone import normalize_algerian_phone
        if not username:
            return self.none()
        username_str = str(username).strip()
        if "@" in username_str:
            return self.get(email__iexact=username_str)
        normalized = normalize_algerian_phone(username_str)
        return self.get(models.Q(phone=normalized) | models.Q(phone=username_str))


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
