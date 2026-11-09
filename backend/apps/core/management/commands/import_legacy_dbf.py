import sys
from django.core.management.base import BaseCommand
from apps.core.models import Tenant, Branch
from apps.core.services.legacy_dbf import LegacyDBFImporter


class Command(BaseCommand):
    help = "Imports legacy DBF files into Pointure"

    def add_arguments(self, parser):
        parser.add_argument("path", type=str, help="Path to the LEGACY directory containing DBF files")
        parser.add_argument("--tenant-id", type=str, help="Tenant ID (UUID) to import data into", required=False)
        parser.add_argument("--branch-id", type=str, help="Branch ID (UUID) to import data into", required=False)
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Run import inside a transaction and roll back all changes, printing the preview report",
        )

    def handle(self, *args, **options):
        path = options["path"]
        tenant_id = options.get("tenant_id")
        branch_id = options.get("branch_id")
        dry_run = bool(options.get("dry_run", False))
        interactive = sys.stdin.isatty() and not dry_run

        if not tenant_id:
            if interactive:
                try:
                    entered = input("Enter Tenant ID (leave blank to use first tenant): ").strip()
                    tenant_id = entered or None
                except Exception:
                    tenant_id = None
            if not tenant_id:
                first_tenant = Tenant.objects.first()
                tenant_id = first_tenant.id if first_tenant else None

        tenant = Tenant.objects.get(id=tenant_id)

        branch = None
        if branch_id:
            branch = Branch.objects.get(id=branch_id, tenant=tenant)
        elif interactive:
            try:
                entered_branch = input("Enter Branch ID (leave blank to use primary branch): ").strip()
                if entered_branch:
                    branch = Branch.objects.get(id=entered_branch, tenant=tenant)
            except Exception as e:
                self.stderr.write(f"Invalid Branch ID. Using first branch. Error: {e}")

        if not branch:
            branch = Branch.objects.filter(tenant=tenant).first()

        mode_label = "DRY-RUN (no database changes)" if dry_run else "LIVE IMPORT"
        self.stdout.write(f"[{mode_label}] Using Tenant: {tenant} | Branch: {branch}")

        importer = LegacyDBFImporter(path, tenant, branch, logger=self.stdout.write, dry_run=dry_run)
        stats = importer.execute_import(dry_run=dry_run)

        if dry_run:
            self.stdout.write(self.style.WARNING(f"Dry-run completed (rolled back): {stats}"))
        else:
            self.stdout.write(self.style.SUCCESS(f"Successfully imported legacy data: {stats}"))
