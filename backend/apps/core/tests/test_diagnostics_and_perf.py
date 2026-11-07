import io
import json
import uuid
import zipfile
import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.test import RequestFactory
from rest_framework.test import APIClient

from apps.core.models import Tenant
from apps.core.middleware import PerformanceLogMiddleware
from apps.core.desktop.backup import get_backups_dir

User = get_user_model()


@pytest.mark.django_db
def test_performance_log_middleware(settings, tmp_path):
    # Set up perf log file in tmp_path
    perf_log_file = tmp_path / "perf.log"
    import logging
    logger = logging.getLogger("shodz.perf")
    handler = logging.FileHandler(str(perf_log_file), encoding="utf-8")
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

    try:
        # 1. Request slower than threshold is logged
        settings.PERF_SLOW_MS = 0  # all requests are logged

        def mock_slow_view(request):
            # perform a DB query
            Tenant.objects.count()
            return HttpResponse("ok", status=200)

        middleware = PerformanceLogMiddleware(mock_slow_view)
        sample_uuid = str(uuid.uuid4())
        rf = RequestFactory()
        req = rf.get(f"/api/v1/clients/{sample_uuid}/")

        resp = middleware(req)
        assert resp.status_code == 200

        handler.flush()
        with open(perf_log_file, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]

        assert len(lines) >= 1
        entry = json.loads(lines[-1])
        assert entry["method"] == "GET"
        assert entry["path"] == "/api/v1/clients/{id}/"
        assert entry["status"] == 200
        assert "duration_ms" in entry
        assert entry["db_queries"] >= 1
        assert "db_time_ms" in entry

        # 2. Fast request with high threshold is not logged
        settings.PERF_SLOW_MS = 100000  # 100 seconds threshold
        initial_count = len(lines)
        middleware(req)
        handler.flush()
        with open(perf_log_file, "r", encoding="utf-8") as f:
            new_lines = [line.strip() for line in f if line.strip()]
        assert len(new_lines) == initial_count

    finally:
        logger.removeHandler(handler)
        handler.close()


@pytest.mark.django_db
def test_diagnostics_bundle_permissions_and_content():
    tenant = Tenant.objects.create(name="Store Diag", is_active=True)
    cashier = User.objects.create_user(phone="0555111222", password="password123", tenant=tenant, role="cashier")
    manager = User.objects.create_user(phone="0555222333", password="password123", tenant=tenant, role="manager")
    owner = User.objects.create_user(phone="0555333444", password="password123", tenant=tenant, role="owner")

    client = APIClient()

    # 1. Unauthenticated gets 401
    res = client.get("/api/v1/desktop/diagnostics/")
    assert res.status_code == 401

    # 2. Cashier gets 403
    client.force_authenticate(user=cashier)
    res = client.get("/api/v1/desktop/diagnostics/")
    assert res.status_code == 403

    # 3. Manager with include_database=true gets 403
    client.force_authenticate(user=manager)
    res = client.get("/api/v1/desktop/diagnostics/?include_database=true")
    assert res.status_code == 403

    # 4. Manager without include_database gets 200 ZIP
    res = client.get("/api/v1/desktop/diagnostics/")
    assert res.status_code == 200
    assert res["Content-Type"] == "application/zip"
    assert "attachment; filename=\"shodz_diagnostic_" in res["Content-Disposition"]

    with zipfile.ZipFile(io.BytesIO(res.content), "r") as zf:
        namelist = zf.namelist()
        assert "meta.json" in namelist
        # No database file included
        assert not any(name.startswith("database/") for name in namelist)

        meta = json.loads(zf.read("meta.json").decode("utf-8"))
        assert "app_version" in meta
        assert "python_version" in meta
        assert "django_version" in meta
        assert "os" in meta
        assert "timestamp" in meta
        assert "sqlite" in meta
        assert "top_15_tables_by_rows" in meta["sqlite"]
        assert "backup_status" in meta
        assert "scheduler_state" in meta

    # 5. Owner with include_database=true gets 200 ZIP with database backup
    # Create a local backup file so it is picked up
    b_dir = get_backups_dir()
    sample_backup = b_dir / "db_backup_20261108_000000.sqlite3"
    sample_backup.write_bytes(b"SQLite format 3\x00sample_backup")
    try:
        client.force_authenticate(user=owner)
        res = client.get("/api/v1/desktop/diagnostics/?include_database=true")
        assert res.status_code == 200
        assert res["Content-Type"] == "application/zip"

        with zipfile.ZipFile(io.BytesIO(res.content), "r") as zf:
            namelist = zf.namelist()
            assert "meta.json" in namelist
            assert any(name.startswith("database/") for name in namelist)
    finally:
        if sample_backup.exists():
            sample_backup.unlink()
