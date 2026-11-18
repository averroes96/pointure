"""
Time service: the network check never runs inside a request (stores are offline most of the
time and a hung DNS lookup froze requests for up to 17 s). Every network call is faked.
"""
import email.utils
import time
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Tenant
from apps.core.services import time_service as ts
from apps.sales.models import Sale


class FakeNetwork:
    """Stands in for urllib.request.urlopen."""

    def __init__(self):
        self.calls = []                 # (url, method, timeout)
        self.date = None                # None = offline; else the datetime the host reports
        self.fail_first = 0             # hosts that fail before one answers
        self.on_call = None             # hook run on every call (e.g. advance a fake clock)

    def online(self, date, fail_first=0):
        self.date, self.fail_first = date, fail_first


class _Response:
    def __init__(self, header):
        self.headers = {"Date": header}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _call(self, req, timeout=None):
    self.calls.append((req.full_url, req.get_method(), timeout))
    if self.on_call:
        self.on_call()
    if self.date is None or len(self.calls) <= self.fail_first:
        raise OSError("offline")
    return _Response(email.utils.format_datetime(self.date, usegmt=True))


FakeNetwork.__call__ = _call


@pytest.fixture
def net(monkeypatch):
    fake = FakeNetwork()
    monkeypatch.setattr(ts.urllib.request, "urlopen", fake)
    return fake


@pytest.fixture(autouse=True)
def fresh_state():
    saved = dict(ts._state)
    ts._state.update(
        skew_seconds=0.0, last_sync_time=0.0, sync_source=None, anomaly_detected=False, anomaly_type=None,
        anomaly_message="", refreshing=False, failures=0, next_attempt=0.0, guard_checked=False,
    )
    yield
    ts._state.clear()
    ts._state.update(saved)


class FakeThread:
    """Records instead of running, so a test sees what a request would have started."""
    created, joined = [], []

    def __init__(self, target=None, name=None, daemon=None):
        FakeThread.created.append(target)

    def start(self):
        pass

    def join(self, timeout=None):
        FakeThread.joined.append(timeout)


@pytest.fixture
def fake_threads(monkeypatch):
    FakeThread.created, FakeThread.joined = [], []
    monkeypatch.setattr(ts.threading, "Thread", FakeThread)
    monkeypatch.setattr(ts, "get_last_known_transaction_time", lambda: None)
    return FakeThread


@pytest.fixture
def no_db(monkeypatch):
    monkeypatch.setattr(ts, "get_last_known_transaction_time", lambda: None)


# ─── Requests never wait on the network ───────────────────────────────────────

def test_sync_time_answers_from_cache_and_only_requests_a_background_refresh(net, fake_threads):
    status = ts.sync_time()

    assert net.calls == []                                   # nothing on the network in this thread
    assert len(fake_threads.created) == 1 and fake_threads.created[0] is ts._refresh_thread
    assert fake_threads.joined == []                         # a normal poll never waits
    assert status["refreshing"] is True
    assert (status["sync_source"], status["is_online"], status["is_synchronized"]) == (None, False, False)
    assert status["anomaly_detected"] is False

    ts.sync_time()                                           # a refresh is already queued: no second one
    assert len(fake_threads.created) == 1


def test_a_sale_never_waits_on_the_network_or_starts_a_thread(net, monkeypatch, no_db):
    monkeypatch.setattr(ts.threading, "Thread", mock.Mock(side_effect=AssertionError("no thread expected")))
    assert abs((ts.get_trusted_now() - timezone.now()).total_seconds()) < 1
    assert net.calls == []


def test_a_failed_thread_start_clears_the_flag(net, monkeypatch, no_db):
    class Broken(FakeThread):
        def start(self):
            raise RuntimeError("no threads left")
    monkeypatch.setattr(ts.threading, "Thread", Broken)
    assert ts.request_refresh() is None
    assert ts._state["refreshing"] is False


def test_the_thread_logs_failures_closes_its_connection_and_clears_the_flag(monkeypatch):
    conn = mock.Mock()
    monkeypatch.setattr(ts, "connection", conn)
    monkeypatch.setattr(ts, "refresh_network_time", mock.Mock(side_effect=RuntimeError("boom")))
    ts._state["refreshing"] = True
    ts._refresh_thread()                                     # must not raise
    assert ts._state["refreshing"] is False
    conn.close.assert_called_once()


# ─── A refresh, done in the background ────────────────────────────────────────

@pytest.mark.parametrize("ahead,anomaly", [
    (120, None),                                             # 2 min: fine
    (400, "CLOCK_SKEW_WARNING"),                             # > 5 min
    (3 * 86400, "DEAD_BATTERY_OR_DATE_RESET"),               # > 1 day
])
def test_a_successful_refresh_records_the_skew_and_waits_a_full_interval(net, no_db, ahead, anomaly):
    net.online(timezone.now() + timedelta(seconds=ahead))
    before = time.monotonic()

    assert ts.refresh_network_time() is True

    assert abs(ts._state["skew_seconds"] - ahead) <= 2
    assert ts._state["anomaly_type"] == anomaly and ts._state["anomaly_detected"] is bool(anomaly)
    assert ts._state["sync_source"] == "https://www.google.com"
    assert (ts._state["failures"], ts._state["refreshing"]) == (0, False)
    assert 899 <= ts._state["next_attempt"] - before <= 905
    status = ts.get_time_status()
    assert (status["is_online"], status["is_synchronized"]) == (True, True)
    assert net.calls == [("https://www.google.com", "HEAD", 2.5)]


def test_the_next_host_is_tried_when_one_fails(net, no_db):
    net.online(timezone.now(), fail_first=1)
    assert ts.refresh_network_time() is True
    assert ts._state["sync_source"] == "https://cloudflare.com"


def test_failures_back_off_from_15_minutes_to_6_hours_and_a_success_resets(net, no_db):
    waits = []
    for _ in range(8):
        started = time.monotonic()
        assert ts.refresh_network_time() is False
        waits.append(round(ts._state["next_attempt"] - started))
    assert waits == [900, 1800, 3600, 7200, 14400, 21600, 21600, 21600]
    assert ts._state["failures"] == 8 and ts._state["sync_source"] == "offline_os"
    assert ts.get_time_status()["is_online"] is False

    net.online(timezone.now())
    started = time.monotonic()
    assert ts.refresh_network_time() is True
    assert ts._state["failures"] == 0 and round(ts._state["next_attempt"] - started) == 900


def test_no_new_refresh_while_backing_off_unless_forced(net, no_db):
    ts.refresh_network_time()                                # offline: next attempt in 15 min
    calls = len(net.calls)
    assert ts.request_refresh() is None                      # not due yet
    thread = ts.request_refresh(force=True)                  # an explicit resync skips the backoff
    assert thread is not None
    thread.join(5)
    assert len(net.calls) == calls + 3 and ts._state["refreshing"] is False


def test_only_one_attempt_runs_at_a_time(net, no_db):
    assert ts._refresh_lock.acquire(blocking=False)
    try:
        assert ts.refresh_network_time() is False
        assert net.calls == []
    finally:
        ts._refresh_lock.release()


# ─── The network call itself is bounded ───────────────────────────────────────

def _slow_hosts(net, monkeypatch, seconds_each=3.0):
    clock = {"t": 0.0}
    net.on_call = lambda: clock.__setitem__("t", clock["t"] + seconds_each)
    monkeypatch.setattr(ts, "time", SimpleNamespace(monotonic=lambda: clock["t"]))


@pytest.mark.parametrize("deadline,hosts_tried", [(8.0, 3), (5.0, 2), (0.0, 1)])
def test_hosts_are_tried_only_while_under_the_deadline(net, monkeypatch, deadline, hosts_tried):
    _slow_hosts(net, monkeypatch)                            # every host burns 3 s then fails
    assert ts.fetch_network_time(deadline=deadline) == (None, None)
    assert len(net.calls) == hosts_tried


def test_fetch_reads_the_date_header_with_a_head_request(net):
    when = timezone.now().replace(microsecond=0)
    net.online(when)
    assert ts.fetch_network_time() == (when, "https://www.google.com")
    assert net.calls == [("https://www.google.com", "HEAD", 2.5)]


# ─── The database guard needs no network ──────────────────────────────────────

@pytest.mark.django_db
def test_a_clock_behind_the_last_sale_is_caught_without_any_network(net):
    sale = Sale.objects.create(tenant=Tenant.objects.create(name="Clock Store"))
    last_sale_at = timezone.now() + timedelta(hours=3)
    Sale.objects.filter(pk=sale.pk).update(created_at=last_sale_at)
    ts._state.update(guard_checked=False, sync_source=None, skew_seconds=0.0, anomaly_detected=False)

    status = ts.get_time_status()

    assert net.calls == []
    assert (status["anomaly_type"], status["sync_source"]) == ("CLOCK_ROLLED_BACK", "db_high_water_mark")
    assert ts.get_trusted_now() >= last_sale_at              # time is clamped forward, never backdated


@pytest.mark.django_db
def test_a_failed_attempt_keeps_the_rollback_flag(net):
    sale = Sale.objects.create(tenant=Tenant.objects.create(name="Clock Store 2"))
    Sale.objects.filter(pk=sale.pk).update(created_at=timezone.now() + timedelta(hours=2))
    ts._state.update(guard_checked=False)

    assert ts.refresh_network_time() is False                # offline

    assert ts._state["anomaly_type"] == "CLOCK_ROLLED_BACK" and ts._state["sync_source"] == "db_high_water_mark"


# ─── The endpoint ─────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_endpoint_never_waits_on_a_poll_and_waits_at_most_3_seconds_for_a_resync(net, fake_threads):
    client = APIClient()

    poll = client.get("/api/v1/core/time/")
    assert poll.status_code == 200 and poll.json()["refreshing"] is True
    assert fake_threads.joined == [] and net.calls == []

    ts._state.update(refreshing=False, next_attempt=time.monotonic() + 3600)        # backing off
    resync = client.get("/api/v1/core/time/?resync=true")
    assert resync.status_code == 200
    assert fake_threads.joined == [ts.FORCED_WAIT_SECONDS] == [3.0]                 # explicit: skips the backoff
    assert len(fake_threads.created) == 2 and net.calls == []
    assert {"current_time", "is_online", "is_synchronized", "anomaly_detected", "skew_seconds"} <= set(resync.json())
