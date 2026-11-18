"""
Clear the SyncOutbox table:  python manage.py prune_sync_outbox [--delete] [--vacuum]

Every change to a tenant record used to add an outbox row with a JSON copy of it, for a push
to a cloud server that is not in use (see SYNC_OUTBOX_ENABLED). Those rows are never read
and never purged, so a store's table only grows (an import adds one per imported row).

By default this only COUNTS (dry run). With --delete it deletes in small batches:
  - everything, while no cloud push is configured (SYNC_OUTBOX_ENABLED is off): no one
    can read the rows;
  - only rows already pushed (`synced`), when it is on: unsynced rows are still needed.
--vacuum then compacts the SQLite file so it shrinks on disk. Close the app first: VACUUM
needs the database to itself, and free disk space about the size of the database.
"""
from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection

from apps.core.models import SyncOutbox


class Command(BaseCommand):
    help = "Count (default) or delete SyncOutbox rows that nothing will ever read."

    def add_arguments(self, parser):
        parser.add_argument("--delete", action="store_true", help="Delete the rows (default: only count).")
        parser.add_argument("--vacuum", action="store_true", help="After deleting, compact the SQLite file.")
        parser.add_argument("--batch-size", type=int, default=5000, help="Rows per DELETE (default 5000).")

    def handle(self, *args, **options):
        enabled = bool(getattr(settings, "SYNC_OUTBOX_ENABLED", False))
        everything = SyncOutbox.objects.all()
        targets = everything if not enabled else everything.filter(synced=True)

        total, to_delete = everything.count(), targets.count()
        unsynced = everything.filter(synced=False).count()
        oldest = everything.order_by("timestamp").values_list("timestamp", flat=True).first()
        self.stdout.write(
            f"SyncOutbox: {total:,} rows ({unsynced:,} not pushed), "
            f"oldest: {oldest.date() if oldest else '-'}. "
            f"Cloud push: {'configured' if enabled else 'not configured'}."
        )
        self.stdout.write(
            f"Rows nothing will read: {to_delete:,}"
            + ("" if not enabled else " (only the already-pushed ones: unsynced rows are kept)")
        )

        if not options["delete"]:
            self.stdout.write("Dry run. Add --delete to remove them (and --vacuum to shrink the file).")
            return

        batch = max(1, options["batch_size"])
        deleted = 0
        while True:
            ids = SyncOutbox.objects.filter(pk__in=targets.order_by("timestamp").values("pk")[:batch])
            # One DELETE per batch, without loading rows or firing signals.
            count = ids._raw_delete(ids.db)
            if not count:
                break
            deleted += count
            self.stdout.write(f"  deleted {deleted:,} / {to_delete:,}")
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted:,} rows."))

        if options["vacuum"]:
            if connection.vendor != "sqlite":
                self.stdout.write("--vacuum only applies to SQLite; skipped.")
            else:
                self.stdout.write("Compacting the database file (this can take a while)...")
                with connection.cursor() as cursor:
                    cursor.execute("VACUUM")
                self.stdout.write(self.style.SUCCESS("Done."))
