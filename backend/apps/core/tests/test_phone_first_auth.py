"""
Tests for Phone-First Authentication and Algerian Phone Normalization (Phase 1).
"""
import pytest
from django.db import IntegrityError
from apps.core.models import User
from apps.core.utils.phone import (
    normalize_algerian_phone,
    is_valid_algerian_phone,
    format_algerian_phone_display,
)


class TestAlgerianPhoneUtilities:
    """Test phone normalization and validation against Algerian telecom standards."""

    @pytest.mark.parametrize(
        "raw_input,expected_normalized",
        [
            ("0555 12 34 56", "0555123456"),
            ("0555-12-34-56", "0555123456"),
            ("0555.12.34.56", "0555123456"),
            ("+213 555 12 34 56", "0555123456"),
            ("+213-661-23-45-67", "0661234567"),
            ("00213 770 99 88 77", "0770998877"),
            ("213550112233", "0550112233"),
            ("+213 0550 11 22 33", "0550112233"),
            ("550112233", "0550112233"),
            ("661234567", "0661234567"),
            ("770998877", "0770998877"),
            ("021 23 45 67", "021234567"),
            ("031 99 88 77", "031998877"),
        ],
    )
    def test_normalize_valid_numbers(self, raw_input, expected_normalized):
        assert normalize_algerian_phone(raw_input) == expected_normalized
        assert is_valid_algerian_phone(raw_input) is True

    @pytest.mark.parametrize(
        "invalid_input",
        [
            "0123456789",
            "12345",
            "abcdef",
            "+33612345678",
            "0987654321",
            "",
            None,
        ],
    )
    def test_invalid_numbers(self, invalid_input):
        assert is_valid_algerian_phone(invalid_input) is False

    def test_mobile_only_validation(self):
        # 05, 06, 07 are mobile
        assert is_valid_algerian_phone("0555123456", mobile_only=True) is True
        assert is_valid_algerian_phone("0661234567", mobile_only=True) is True
        assert is_valid_algerian_phone("0770998877", mobile_only=True) is True
        # 021 is fixed landline -> valid in general, invalid when mobile_only
        assert is_valid_algerian_phone("021234567", mobile_only=False) is True
        assert is_valid_algerian_phone("021234567", mobile_only=True) is False

    def test_format_display(self):
        assert format_algerian_phone_display("0555123456") == "0555 12 34 56"
        assert format_algerian_phone_display("+213 661 23 45 67") == "0661 23 45 67"
        assert format_algerian_phone_display("021234567") == "021 23 45 67"


@pytest.mark.django_db
class TestPhoneFirstUserModel:
    """Test User model and UserManager with phone-first credentials and email legacy."""

    def test_create_user_with_phone_only(self):
        user = User.objects.create_user(phone="0555 12 34 56", password="strongpassword123")
        assert user.phone == "0555123456"
        assert user.email is None
        assert user.check_password("strongpassword123")
        assert str(user) == "0555123456"

    def test_create_user_with_international_phone_auto_normalizes(self):
        user = User.objects.create_user(phone="+213 661 23 45 67", password="strongpassword123")
        assert user.phone == "0661234567"
        assert user.email is None

    def test_create_user_legacy_email_only(self):
        user = User.objects.create_user(email="legacy.owner@shodz.dz", password="strongpassword123")
        assert user.email == "legacy.owner@shodz.dz"
        assert user.phone is None
        assert user.check_password("strongpassword123")
        assert str(user) == "legacy.owner@shodz.dz"

    def test_create_user_legacy_positional_email(self):
        user = User.objects.create_user("cashier.positional@shodz.dz", "strongpassword123")
        assert user.email == "cashier.positional@shodz.dz"
        assert user.phone is None

    def test_create_user_with_both_phone_and_email(self):
        user = User.objects.create_user(
            phone="0770 99 88 77",
            email="manager.dual@shodz.dz",
            password="strongpassword123",
        )
        assert user.phone == "0770998877"
        assert user.email == "manager.dual@shodz.dz"
        assert str(user) == "0770998877"

    def test_neither_phone_nor_email_raises_value_error(self):
        with pytest.raises(ValueError, match="A phone number or email address is required"):
            User.objects.create_user(password="strongpassword123")

    def test_multiple_users_with_null_email_allowed(self):
        user1 = User.objects.create_user(phone="0550111111", password="password1")
        user2 = User.objects.create_user(phone="0550222222", password="password2")
        assert user1.email is None
        assert user2.email is None
        assert user1.pk != user2.pk

    def test_multiple_users_with_null_phone_allowed(self):
        user1 = User.objects.create_user(email="user1@example.com", password="password1")
        user2 = User.objects.create_user(email="user2@example.com", password="password2")
        assert user1.phone is None
        assert user2.phone is None
        assert user1.pk != user2.pk

    def test_duplicate_phone_raises_integrity_error(self):
        User.objects.create_user(phone="0555123456", password="password1")
        with pytest.raises(IntegrityError):
            User.objects.create_user(phone="+213 555 12 34 56", password="password2")

    def test_duplicate_email_raises_integrity_error(self):
        User.objects.create_user(email="same@example.com", password="password1")
        with pytest.raises(IntegrityError):
            User.objects.create_user(email="same@example.com", password="password2")

    def test_natural_key_lookup_by_phone_or_email(self):
        phone_user = User.objects.create_user(phone="0555123456", password="password1")
        email_user = User.objects.create_user(email="support@shodz.dz", password="password2")

        # Lookup by phone (raw and formatted)
        found_phone = User.objects.get_by_natural_key("0555123456")
        assert found_phone.pk == phone_user.pk
        found_phone_intl = User.objects.get_by_natural_key("+213 555 12 34 56")
        assert found_phone_intl.pk == phone_user.pk

        # Lookup by email
        found_email = User.objects.get_by_natural_key("support@shodz.dz")
        assert found_email.pk == email_user.pk


@pytest.mark.django_db
class TestPhoneOrEmailBackend:
    """Test PhoneOrEmailBackend authentication with phone or email credentials."""

    def test_authenticate_with_phone_formats(self):
        from django.contrib.auth import authenticate
        user = User.objects.create_user(phone="0555 12 34 56", password="strongpassword123")

        # Local normalized
        auth_user = authenticate(username="0555123456", password="strongpassword123")
        assert auth_user == user

        # Spaced local
        auth_user_spaced = authenticate(username="0555 12 34 56", password="strongpassword123")
        assert auth_user_spaced == user

        # International with +213
        auth_user_intl = authenticate(username="+213 555 12 34 56", password="strongpassword123")
        assert auth_user_intl == user

        # Using 'phone' kwarg directly
        auth_user_kwarg = authenticate(phone="+213555123456", password="strongpassword123")
        assert auth_user_kwarg == user

    def test_authenticate_with_legacy_email(self):
        from django.contrib.auth import authenticate
        user = User.objects.create_user(email="admin@boutique.dz", password="strongpassword123")

        # Exact email
        auth_user = authenticate(username="admin@boutique.dz", password="strongpassword123")
        assert auth_user == user

        # Uppercase / case-insensitive email
        auth_user_upper = authenticate(username="ADMIN@BOUTIQUE.DZ", password="strongpassword123")
        assert auth_user_upper == user

        # Using 'email' kwarg
        auth_user_kwarg = authenticate(email="admin@boutique.dz", password="strongpassword123")
        assert auth_user_kwarg == user

    def test_authenticate_wrong_password_fails(self):
        from django.contrib.auth import authenticate
        User.objects.create_user(phone="0555123456", password="strongpassword123")
        assert authenticate(username="0555123456", password="wrongpassword") is None

    def test_authenticate_inactive_user_fails(self):
        from django.contrib.auth import authenticate
        user = User.objects.create_user(phone="0555123456", password="strongpassword123")
        user.is_active = False
        user.save()
        assert authenticate(username="0555123456", password="strongpassword123") is None

    def test_authenticate_nonexistent_identity_fails(self):
        from django.contrib.auth import authenticate
        assert authenticate(username="0555999999", password="somepassword") is None
        assert authenticate(username="nobody@shodz.dz", password="somepassword") is None
        assert authenticate(username="", password="somepassword") is None
        assert authenticate(password="somepassword") is None


@pytest.mark.django_db
class TestPhoneOrEmailLoginApi:
    """Test /api/v1/auth/login/ endpoint with PhoneOrEmailTokenObtainPairSerializer."""

    def test_login_with_phone(self):
        from rest_framework.test import APIClient
        client = APIClient()
        User.objects.create_user(phone="0555 12 34 56", password="securepassword123")

        # POST with 'username' as normalized phone
        resp = client.post("/api/v1/auth/login/", {"username": "0555123456", "password": "securepassword123"})
        assert resp.status_code == 200
        assert "access" in resp.data
        assert "refresh" in resp.data

        # POST with 'username' as formatted international phone
        resp2 = client.post("/api/v1/auth/login/", {"username": "+213 555 12 34 56", "password": "securepassword123"})
        assert resp2.status_code == 200
        assert "access" in resp2.data

        # POST with 'phone' key explicitly
        resp3 = client.post("/api/v1/auth/login/", {"phone": "0555 12 34 56", "password": "securepassword123"})
        assert resp3.status_code == 200
        assert "access" in resp3.data

    def test_login_with_legacy_email(self):
        from rest_framework.test import APIClient
        client = APIClient()
        User.objects.create_user(email="legacy.admin@boutique.dz", password="securepassword123")

        # POST with 'username' as email
        resp = client.post("/api/v1/auth/login/", {"username": "legacy.admin@boutique.dz", "password": "securepassword123"})
        assert resp.status_code == 200
        assert "access" in resp.data

        # POST with 'email' key explicitly
        resp2 = client.post("/api/v1/auth/login/", {"email": "legacy.admin@boutique.dz", "password": "securepassword123"})
        assert resp2.status_code == 200
        assert "access" in resp2.data

    def test_login_invalid_credentials_returns_401(self):
        from rest_framework.test import APIClient
        client = APIClient()
        User.objects.create_user(phone="0555123456", password="securepassword123")

        resp = client.post("/api/v1/auth/login/", {"username": "0555123456", "password": "incorrect"})
        assert resp.status_code == 401

    def test_login_missing_identifier_returns_400(self):
        from rest_framework.test import APIClient
        client = APIClient()
        resp = client.post("/api/v1/auth/login/", {"password": "securepassword123"})
        assert resp.status_code == 400


