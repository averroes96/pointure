"""
TenantMiddleware — sets request.tenant and thread-local tenant from the
authenticated user. Used for session-based auth (Django admin, tests).

For DRF + JWT requests, tenant is re-resolved inside TenantScopedViewSetMixin.initial()
AFTER DRF has completed JWT token authentication, because at middleware time
request.user is still AnonymousUser for Bearer token requests.
"""
import json
import logging
import re
import time

from django.conf import settings
from django.db import connection
from django.utils import timezone

from .managers import clear_current_tenant, set_current_tenant
from .signals import set_current_user

UUID_REGEX = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
logger_perf = logging.getLogger("shodz.perf")


class TenantMiddleware:
    """
    Resolves tenant from session-authenticated user (Django admin / tests).
    For JWT API requests the real resolution happens in the viewset mixin.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Default to None; overridden in viewset mixin after DRF auth for JWT
        request.tenant = None
        set_current_tenant(None)

        # For session-based auth (admin, tests) the user IS available here
        if request.user.is_authenticated and not request.user.is_superuser:
            tenant = getattr(request.user, "tenant", None)
            request.tenant = tenant
            set_current_tenant(tenant)
            set_current_user(request.user)

        try:
            response = self.get_response(request)
        finally:
            clear_current_tenant()
            set_current_user(None)

        return response


class PerformanceLogMiddleware:
    """
    Records request method, path (with UUIDs replaced by {id}), status,
    duration in ms, DB query count, and DB time.
    Requests slower than PERF_SLOW_MS (default 800) are logged to perf.log.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        query_count = 0
        db_time = 0.0

        def db_query_wrapper(execute, sql, params, many, context):
            nonlocal query_count, db_time
            t0 = time.monotonic()
            try:
                return execute(sql, params, many, context)
            finally:
                t1 = time.monotonic()
                query_count += 1
                db_time += (t1 - t0)

        t_start = time.monotonic()
        with connection.execute_wrapper(db_query_wrapper):
            response = self.get_response(request)
        t_end = time.monotonic()

        duration_ms = (t_end - t_start) * 1000.0
        db_time_ms = db_time * 1000.0

        threshold_ms = getattr(settings, "PERF_SLOW_MS", 800)
        if duration_ms >= threshold_ms:
            clean_path = UUID_REGEX.sub("{id}", request.path)
            log_entry = {
                "timestamp": timezone.now().isoformat(),
                "method": request.method,
                "path": clean_path,
                "status": response.status_code,
                "duration_ms": round(duration_ms, 2),
                "db_queries": query_count,
                "db_time_ms": round(db_time_ms, 2),
            }
            logger_perf.info(json.dumps(log_entry))

        return response

