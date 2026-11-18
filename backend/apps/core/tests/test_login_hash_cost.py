"""
A refused login costs exactly one password hash (the stores' PCs need about 1.7 s per hash:
a wrong password used to take 5 s, three hashes), and an unknown account costs the same as a
wrong password, so response time does not reveal which phone numbers or emails exist.

Hashes are counted where Django makes them (`make_password`, `check_password`), including the
dummy hashes made to equalise timing.
"""
import pytest
from django.contrib.auth import authenticate, base_user
from django.contrib.auth.signals import user_login_failed
from django.core.cache import cache
from django.test import Client
from rest_framework.test import APIClient

from apps.core.models import User

PASSWORD = "strongpassword123"


class HashCounter:
    def __init__(self):
        self.n = 0

    def reset(self):
        self.n = 0


@pytest.fixture
def hashes(monkeypatch):
    counter = HashCounter()
    real_make, real_check = base_user.make_password, base_user.check_password

    def make(*args, **kwargs):
        counter.n += 1
        return real_make(*args, **kwargs)

    def check(*args, **kwargs):
        counter.n += 1
        return real_check(*args, **kwargs)

    monkeypatch.setattr(base_user, "make_password", make)
    monkeypatch.setattr(base_user, "check_password", check)
    return counter


@pytest.fixture
def accounts(db):
    phone_user = User.objects.create_user(phone="0555 12 34 56", password=PASSWORD)
    email_user = User.objects.create_user(email="admin@boutique.dz", password=PASSWORD)
    inactive = User.objects.create_user(phone="0666 12 34 56", password=PASSWORD)
    inactive.is_active = False
    inactive.save()
    return phone_user, email_user, inactive


@pytest.mark.parametrize("identifier,password", [
    ("0555123456", "wrong-password"),            # known phone, wrong password
    ("0555 12 34 56", "wrong-password"),         # same, spaced
    ("+213 555 12 34 56", "wrong-password"),     # same, international
    ("ADMIN@BOUTIQUE.DZ", "wrong-password"),     # known email, wrong password
    ("0777999999", "whatever"),                  # unknown phone
    ("nobody@shodz.dz", "whatever"),             # unknown email
    ("0666123456", PASSWORD),                    # inactive account, right password
])
def test_a_refused_login_costs_exactly_one_hash(accounts, hashes, identifier, password):
    hashes.reset()
    assert authenticate(username=identifier, password=password) is None
    assert hashes.n == 1


@pytest.mark.parametrize("identifier", ["0555123456", "+213 555 12 34 56", "admin@boutique.dz"])
def test_a_successful_login_costs_one_hash(accounts, hashes, identifier):
    hashes.reset()
    assert authenticate(username=identifier, password=PASSWORD) is not None
    assert hashes.n == 1


def test_a_refused_login_still_signals_the_failure(accounts):
    seen = []

    def on_failure(sender, credentials, **kwargs):
        seen.append(credentials["username"])

    user_login_failed.connect(on_failure)
    try:
        authenticate(username="0555123456", password="wrong-password")
        authenticate(username="0777999999", password="whatever")
    finally:
        user_login_failed.disconnect(on_failure)
    assert seen == ["0555123456", "0777999999"]


def test_session_login_still_works_without_the_model_backend(accounts):
    assert Client().login(username="0555123456", password=PASSWORD) is True
    assert Client().login(username="admin@boutique.dz", password=PASSWORD) is True
    assert Client().login(username="0555123456", password="wrong-password") is False


def test_login_api_answers_a_wrong_password_and_an_unknown_account_alike(accounts, hashes):
    cache.clear()                                   # the login throttle is 5 attempts per IP
    client = APIClient()

    hashes.reset()
    wrong = client.post("/api/v1/auth/login/", {"phone": "0555123456", "password": "wrong-password"}, format="json")
    cost_wrong = hashes.n
    hashes.reset()
    unknown = client.post("/api/v1/auth/login/", {"phone": "0777999999", "password": "wrong-password"}, format="json")
    cost_unknown = hashes.n

    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert cost_wrong == cost_unknown == 1
    cache.clear()


# ─── The benchmark command used to measure a store's PC ───────────────────────

def test_benchmark_command_times_the_current_hasher_and_alternatives(settings):
    from io import StringIO
    from django.core.management import call_command

    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.PBKDF2PasswordHasher"]
    out = StringIO()
    call_command("benchmark_password_hashing", "--repeat", "1", "--iterations", "2000", "1000", stdout=out)
    lines = out.getvalue().splitlines()

    import re
    rows = [line for line in lines if line.startswith("  pbkdf2_sha256")]
    assert [re.search(r"pbkdf2_sha256, ([\d,]+) iterations", row).group(1) for row in rows] == ["2,000", "1,000"]
    assert all(" ms" in row for row in rows)
    assert any(line.startswith("  scrypt (Django defaults)") for line in lines)
    assert "A wrong password costs one hash too." in out.getvalue()


def test_benchmark_command_marks_the_current_setting(settings):
    from io import StringIO
    from django.contrib.auth.hashers import PBKDF2PasswordHasher
    from django.core.management import call_command

    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.PBKDF2PasswordHasher"]
    current = PBKDF2PasswordHasher.iterations
    out = StringIO()
    call_command("benchmark_password_hashing", "--repeat", "1", "--iterations", str(current), "1000", stdout=out)
    marked = [line for line in out.getvalue().splitlines() if line.endswith("<- current setting")]
    assert len(marked) == 1 and f"{current:,} iterations" in marked[0]
