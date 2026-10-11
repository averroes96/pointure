"""
CLI entry point for ShoeDZ Desktop.
"""
import argparse
import os
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent.parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from .firstrun import ensure_config


def main():
    parser = argparse.ArgumentParser(description="ShoeDZ Desktop CLI")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # serve command
    serve_parser = subparsers.add_parser("serve", help="Run the application server")
    serve_parser.add_argument("--port", type=int, default=8745, help="Port to listen on (default: 8745)")

    # migrate command
    subparsers.add_parser("migrate", help="Run database migrations")

    # backup command
    subparsers.add_parser("backup", help="Perform online database backup")

    # reset-password command
    pw_parser = subparsers.add_parser("reset-password", help="Reset a user password locally")
    pw_parser.add_argument("email", type=str, help="Email of the user account")

    # manage command
    manage_parser = subparsers.add_parser("manage", help="Execute Django management command")
    manage_parser.add_argument("args", nargs=argparse.REMAINDER, help="Django management arguments")

    args = parser.parse_args()

    ensure_config()
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.desktop")

    if args.command == "serve" or args.command is None:
        port = getattr(args, "port", 8745) or 8745
        from .server import run_server
        run_server(port=port)

    elif args.command == "migrate":
        import django
        django.setup()
        from django.core.management import call_command
        call_command("migrate", interactive=False)

    elif args.command == "backup":
        import django
        django.setup()
        from apps.core.desktop.backup import perform_database_backup
        backup_file = perform_database_backup()
        print(f"[ShoeDZ] Backup saved to: {backup_file}")

    elif args.command == "reset-password":
        import django
        django.setup()
        from django.contrib.auth import get_user_model
        import secrets
        User = get_user_model()
        try:
            user = User.objects.get(email=args.email)
            new_pw = secrets.token_urlsafe(10)
            user.set_password(new_pw)
            user.save()
            print(f"[ShoeDZ] Password reset for {args.email}. Temporary password: {new_pw}")
        except User.DoesNotExist:
            print(f"[ShoeDZ ERR] User with email {args.email} not found.", file=sys.stderr)
            sys.exit(1)

    elif args.command == "manage":
        import django
        django.setup()
        from django.core.management import execute_from_command_line
        execute_from_command_line(["manage.py"] + args.args)


if __name__ == "__main__":
    main()
