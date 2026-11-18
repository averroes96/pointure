"""
ShoeDZ — Phone or Email Dual Authentication Backend.

Permits seamless authentication using either:
  1. An Algerian phone number (in local 0XXXXXXXXX, international +213..., or unformatted form)
  2. A legacy email address
"""
from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.core.exceptions import PermissionDenied
from django.db.models import Q
from apps.core.utils.phone import normalize_algerian_phone


class PhoneOrEmailBackend(ModelBackend):
    """
    Authenticate against settings.AUTH_USER_MODEL using either phone number or email.

    A refused login costs exactly ONE password hash, whatever the reason (wrong password,
    unknown account, inactive account). A hash takes about 1.7 s on the stores' PCs, so this
    matters twice: a wrong password used to cost three hashes (about 5 s), and an unknown
    account cost fewer than a wrong password, which told an attacker which phone numbers and
    emails exist. Raising PermissionDenied stops Django from trying the next backend
    (ModelBackend), which would hash again.
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

        user = self._find_user(UserModel, str(identifier).strip())

        if user is None:
            # Unknown, ambiguous or unreadable account: one dummy hash, so it costs the same
            # (and takes as long) as a wrong password.
            UserModel().set_password(password)
        elif user.check_password(password) and self.user_can_authenticate(user):
            return user

        # The credentials are refused (the hash above was the only one): no further backend.
        raise PermissionDenied

    @staticmethod
    def _find_user(UserModel, identifier):
        """The user with this email or phone number, or None (unknown, ambiguous, or a lookup error)."""
        if "@" in identifier:
            # Email lookup (case-insensitive)
            try:
                return UserModel.objects.get(email__iexact=identifier)
            except (UserModel.DoesNotExist, UserModel.MultipleObjectsReturned):
                return None

        # Phone lookup (normalized or exact)
        normalized = normalize_algerian_phone(identifier)
        lookup = Q(phone=normalized) if normalized else Q()
        if identifier != normalized:
            lookup = lookup | Q(phone=identifier)
        if not lookup:
            return None
        try:
            return UserModel.objects.filter(lookup).first()
        except Exception:
            return None
