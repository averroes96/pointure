"""
Synchronous Redis pub/sub publisher.

Called from Django signal handlers (which are always synchronous).
Failures are swallowed so a Redis outage never breaks a sale.
"""
import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)
CHANNEL_PREFIX = "shoedz:events:"


def publish(tenant_id: int, event_type: str, payload: dict) -> None:
    """Publish one SSE event to all dashboard subscribers for this tenant."""
    try:
        import redis as sync_redis

        r = sync_redis.from_url(
            getattr(settings, "REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
        from django.core.serializers.json import DjangoJSONEncoder
        data = json.dumps({"type": event_type, **payload}, cls=DjangoJSONEncoder)
        r.publish(f"{CHANNEL_PREFIX}{str(tenant_id)}", data)
        r.close()
    except Exception:
        logger.debug("SSE publish skipped (non-critical)", exc_info=True)
