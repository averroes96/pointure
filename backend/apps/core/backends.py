"""
ShoeDZ — Phone or Email Dual Authentication Backend.

Permits seamless authentication using either:
  1. An Algerian phone number (in local 0XXXXXXXXX, international +213..., or unformatted form)
  2. A legacy email address
"""
from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q
from apps.core.utils.phone import normalize_algerian_phone


class PhoneOrEmailBackend(ModelBackend):
    """
    Authenticate against settings.AUTH_USER_MODEL using either phone number or email.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        UserModel = get_user_model()
        if password is None:
            return None

        # Identifier can be passed under multiple common keys
        identifier = (
            username
            or kwargs.get("phone")
            or kwargs.get("email")
            or kwargs.get("login")
        )
        if not identifier:
            return None

        identifier_str = str(identifier).strip()
        user = None

        if "@" in identifier_str:
            # Email lookup (case-insensitive)
            try:
                user = UserModel.objects.get(email__iexact=identifier_str)
            except (UserModel.DoesNotExist, UserModel.MultipleObjectsReturned):
                UserModel().set_password(password)
                return None
        else:
            # Phone lookup (normalized or exact)
            normalized = normalize_algerian_phone(identifier_str)
            lookup = Q(phone=normalized) if normalized else Q()
            if identifier_str != normalized:
                lookup = lookup | Q(phone=identifier_str)

            if not lookup:
                UserModel().set_password(password)
                return None

            try:
                user = UserModel.objects.filter(lookup).first()
            except Exception:
                UserModel().set_password(password)
                return None

        if user and user.check_password(password) and self.user_can_authenticate(user):
            return user

        UserModel().set_password(password)
        return None

