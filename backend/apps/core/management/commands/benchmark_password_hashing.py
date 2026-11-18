"""
Time password hashing on THIS computer:  python manage.py benchmark_password_hashing

Every login, user creation and manager-PIN check pays one hash. On the stores' PCs (an i3
with 4 GB) the default PBKDF2 took about 1.7 s each. This only measures, with the app's own
hashers and settings, so the numbers are what the app really spends. It reads and writes
nothing (no database access) and hashes a fixed dummy password.
"""
import statistics
import time

from django.contrib.auth.hashers import PBKDF2PasswordHasher, ScryptPasswordHasher, get_hasher
from django.core.management.base import BaseCommand

PASSWORD = "benchmark-password"
SALT = "benchmarksalt"
# Lower counts to compare with the current setting (Django's older defaults and below).
COMPARE_ITERATIONS = (600_000, 390_000, 260_000, 150_000)


def time_hash(hasher, repeat):
    """Median milliseconds for one hash, over `repeat` runs."""
    runs = []
    for _ in range(max(1, repeat)):
        started = time.perf_counter()
        hasher.encode(PASSWORD, SALT)
        runs.append((time.perf_counter() - started) * 1000)
    return statistics.median(runs)


class Command(BaseCommand):
    help = "Measure how long one password hash takes on this computer (login, PIN check, user creation)."

    def add_arguments(self, parser):
        parser.add_argument("--repeat", type=int, default=3, help="Runs per setting; the median is shown (default 3).")
        parser.add_argument(
            "--iterations", type=int, nargs="*",
            help="PBKDF2 iteration counts to time instead of the default comparison list.",
        )

    def handle(self, *args, **options):
        repeat = options["repeat"]
        current = get_hasher("default")
        current_iterations = getattr(current, "iterations", None)

        self.stdout.write(f"Password hashing on this computer (median of {max(1, repeat)} run(s), one hash each):\n")
        rows = []

        counts = options.get("iterations")
        if not counts:
            counts = sorted({n for n in (current_iterations, *COMPARE_ITERATIONS) if n}, reverse=True)
        for n in counts:
            hasher = type("Pbkdf2", (PBKDF2PasswordHasher,), {"iterations": n})()
            marker = "  <- current setting" if n == current_iterations and current.algorithm == hasher.algorithm else ""
            rows.append((f"pbkdf2_sha256, {n:,} iterations", time_hash(hasher, repeat), marker))

        try:
            rows.append(("scrypt (Django defaults)", time_hash(ScryptPasswordHasher(), repeat),
                         "  <- current setting" if current.algorithm == "scrypt" else ""))
        except Exception:                               # needs OpenSSL scrypt support
            rows.append(("scrypt (Django defaults)", None, "  not available on this Python"))

        if current.algorithm not in ("pbkdf2_sha256", "scrypt"):
            rows.append((f"{current.algorithm} (current setting)", time_hash(current, repeat), ""))

        for label, ms, note in rows:
            timing = f"{ms:8.0f} ms" if ms is not None else "         -"
            self.stdout.write(f"  {label:<38}{timing}{note}")

        self.stdout.write(
            "\nA login, a user creation and a manager-PIN check each cost one hash. "
            "A wrong password costs one hash too."
        )
