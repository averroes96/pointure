from django.core.management.base import BaseCommand
from apps.core.models import Tenant, Branch
from apps.core.services.legacy_dbf import LegacyDBFImporter

class Command(BaseCommand):
    help = "Imports legacy DBF files into Pointure"

    def add_arguments(self, parser):
        parser.add_argument("path", type=str, help="Path to the LEGACY directory containing DBF files")
        parser.add_argument("--tenant-id", type=int, help="Tenant ID to import data into", required=False)

    def handle(self, *args, **options):
        path = options["path"]
        tenant_id = options.get("tenant_id")
        
        if not tenant_id:
            try:
                tenant_id = input("Enter Tenant ID (leave blank to use first tenant): ").strip()
                if tenant_id:
                    tenant_id = int(tenant_id)
                else:
                    tenant_id = Tenant.objects.first().id
            except Exception as e:
                self.stderr.write(f"Invalid Tenant ID. Using first tenant. Error: {e}")
                tenant_id = Tenant.objects.first().id
                
        tenant = Tenant.objects.get(id=tenant_id)
        
        try:
            branch_id = input("Enter Branch ID (leave blank to use primary branch): ").strip()
            if branch_id:
                branch = Branch.objects.get(id=int(branch_id), tenant=tenant)
            else:
                branch = Branch.objects.filter(tenant=tenant).first()
        except Exception as e:
            self.stderr.write(f"Invalid Branch ID. Using first branch. Error: {e}")
            branch = Branch.objects.filter(tenant=tenant).first()

        self.stdout.write(f"Using Tenant: {tenant} | Branch: {branch}")
        
        importer = LegacyDBFImporter(path, tenant, branch, logger=self.stdout.write)
        stats = importer.execute_import()
        
        self.stdout.write(self.style.SUCCESS(f"Successfully imported legacy data: {stats}"))
