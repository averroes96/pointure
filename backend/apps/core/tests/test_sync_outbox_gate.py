"""
The SyncOutbox is written only when a cloud server will read it (SYNC_OUTBOX_ENABLED); notifications are
cleared with one DELETE; `prune_sync_outbox` clears what nothing will read.

Context: a store's perf.log showed `clear-all` running 5,801 queries and an import 16,640, mostly
the outbox (SAVEPOINT + INSERT + RELEASE per change) for a cloud push that does not exist.
"""
from io import StringIO
from unittest import mock

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.core.models import AuditLog, RoleChoices, SyncOutbox, Tenant, User
from apps.notifications.models import Notification

CLEAR = "/api/v1/notifications/clear-all/"


@pytest.fixture
def tenant(db):
    return Tenant.objects.create(name="Outbox Store")


@pytest.fixture
def user(tenant):
    return User.objects.create_user(phone="0555123456", password="x", role=RoleChoices.OWNER, tenant=tenant)


def _notify(tenant, user, n=1, type_="general"):
    return Notification.objects.bulk_create([
        Notification(tenant=tenant, user=user, title=f"t{i}", body="b", type=type_) for i in range(n)
    ])


def _touches_outbox(captured):
    return any("core_syncoutbox" in q["sql"] for q in captured)


# ─── The gate ─────────────────────────────────────────────────────────────────

def test_the_outbox_is_off_by_default_because_no_cloud_server_exists(settings):
    assert settings.CLOUD_API_URL == ""
    assert settings.SYNC_OUTBOX_ENABLED is False


def test_nothing_is_written_to_the_outbox_without_a_cloud_server(tenant, user):
    with CaptureQueriesContext(connection) as ctx:
        notification = Notification.objects.create(tenant=tenant, user=user, title="a", body="b")
        notification.title = "changed"
        notification.save()
        notification.delete()
    assert SyncOutbox.objects.count() == 0
    assert not _touches_outbox(ctx.captured_queries)


def test_changes_are_queued_when_a_cloud_server_is_configured(tenant, user, settings):
    settings.SYNC_OUTBOX_ENABLED = True
    notification = Notification.objects.create(tenant=tenant, user=user, title="a", body="b")
    notification.title = "changed"
    notification.save()
    pk = str(notification.pk)
    notification.delete()

    rows = list(SyncOutbox.objects.filter(model_name="Notification").values_list("action", "object_id"))
    assert rows == [("create", pk), ("update", pk), ("delete", pk)]
    assert SyncOutbox.objects.get(action="create").payload["title"] == "a"


def test_a_save_costs_fewer_queries_without_the_outbox(tenant, user, settings):
    with CaptureQueriesContext(connection) as off:
        Notification.objects.create(tenant=tenant, user=user, title="a", body="b")
    settings.SYNC_OUTBOX_ENABLED = True
    with CaptureQueriesContext(connection) as on:
        Notification.objects.create(tenant=tenant, user=user, title="a", body="b")
    assert not _touches_outbox(off.captured_queries)
    assert len(on.captured_queries) - len(off.captured_queries) >= 2      # SAVEPOINT / INSERT / RELEASE


def test_the_audit_log_is_unaffected_by_the_gate(tenant, user):
    from apps.clients.models import Client
    Client.objects.create(tenant=tenant, name="Audited Client", phone="0661234567")
    assert AuditLog.objects.filter(tenant=tenant).exists()


# ─── clear-all ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("outbox", [False, True])
def test_clear_all_is_a_single_delete_whatever_the_number_of_notifications(tenant, user, settings, outbox):
    settings.SYNC_OUTBOX_ENABLED = outbox
    colleague = User.objects.create_user(phone="0666123456", password="x", role=RoleChoices.MANAGER, tenant=tenant)
    _notify(tenant, user, 40)
    _notify(tenant, colleague, 3)
    client = APIClient()
    client.force_authenticate(user=user)

    with CaptureQueriesContext(connection) as ctx:
        res = client.post(CLEAR)

    assert res.status_code == 200 and res.json() == {"status": "ok"}
    statements = [q["sql"].split()[0] for q in ctx.captured_queries]
    assert statements == ["DELETE"]                         # no SELECT of the rows, no per-row work
    assert Notification.objects.filter(user=user).count() == 0
    assert Notification.objects.filter(user=colleague).count() == 3          # only the caller's own
    assert SyncOutbox.objects.count() == 0                  # notifications are device-local reminders


def test_clear_all_keeps_honouring_the_type_filter(tenant, user):
    _notify(tenant, user, 3, "low_stock")
    _notify(tenant, user, 2, "general")
    client = APIClient()
    client.force_authenticate(user=user)

    assert client.post(CLEAR + "?type=low_stock").status_code == 200
    assert list(Notification.objects.filter(user=user).values_list("type", flat=True)) == ["general", "general"]


def test_clear_all_requires_a_login(db):
    assert APIClient().post(CLEAR).status_code in (401, 403)


# ─── prune_sync_outbox ────────────────────────────────────────────────────────

def _outbox(tenant, n, synced=False):
    SyncOutbox.objects.bulk_create([
        SyncOutbox(tenant=tenant, model_name="Client", object_id=str(i), action="create", payload={"i": i}, synced=synced)
        for i in range(n)
    ])


def _run(*args):
    out = StringIO()
    call_command("prune_sync_outbox", *args, stdout=out)
    return out.getvalue()


def test_prune_counts_and_deletes_nothing_by_default(tenant):
    _outbox(tenant, 5)
    _outbox(tenant, 2, synced=True)
    text = _run()
    assert "SyncOutbox: 7 rows (5 not pushed)" in text
    assert "Cloud push: not configured" in text
    assert "Rows nothing will read: 7" in text
    assert "Dry run" in text
    assert SyncOutbox.objects.count() == 7


def test_prune_deletes_everything_in_batches_when_no_cloud_push_exists(tenant):
    _outbox(tenant, 7)
    text = _run("--delete", "--batch-size", "3")
    assert SyncOutbox.objects.count() == 0
    assert "deleted 3 / 7" in text and "deleted 6 / 7" in text and "Deleted 7 rows." in text


def test_prune_keeps_unsynced_rows_while_a_cloud_push_is_configured(tenant, settings):
    settings.SYNC_OUTBOX_ENABLED = True
    _outbox(tenant, 4)
    _outbox(tenant, 3, synced=True)
    text = _run("--delete")
    assert "Cloud push: configured" in text and "unsynced rows are kept" in text
    assert list(SyncOutbox.objects.values_list("synced", flat=True)) == [False] * 4


def test_prune_on_an_empty_table_is_harmless(db):
    assert "Deleted 0 rows." in _run("--delete")


def test_prune_vacuum_compacts_the_sqlite_file_after_deleting(tenant):
    _outbox(tenant, 2)
    with mock.patch("apps.core.management.commands.prune_sync_outbox.connection") as conn:
        conn.vendor = "sqlite"
        text = _run("--delete", "--vacuum")
    conn.cursor.return_value.__enter__.return_value.execute.assert_called_once_with("VACUUM")
    assert "Compacting the database file" in text and SyncOutbox.objects.count() == 0
