"""
Server-Sent Events endpoint — enterprise plan only.

GET /api/v1/events/stream/?token=<jwt_access_token>

Authentication uses a query-param token because the browser's native
EventSource API does not support custom request headers.
"""
import asyncio
import json
import logging

from django.contrib.auth import get_user_model
from django.http import HttpResponse, StreamingHttpResponse

from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

logger = logging.getLogger(__name__)
User = get_user_model()
CHANNEL_PREFIX = "shoedz:events:"
HEARTBEAT_INTERVAL = 25  # seconds — keeps proxies from closing idle connections


async def sse_stream(request):
    """
    Stream SSE events for an authenticated enterprise tenant.
    Requires ASGI server (uvicorn.workers.UvicornWorker).
    """
    token_str = request.GET.get("token", "")
    if not token_str:
        return HttpResponse("Unauthorized", status=401)

    # Validate JWT (pure-Python crypto, safe in async context)
    try:
        decoded = AccessToken(token_str)
        user = await User.objects.select_related("tenant").aget(pk=decoded["user_id"])
    except (TokenError, User.DoesNotExist, Exception):
        return HttpResponse("Unauthorized", status=401)

    tenant = user.tenant
    if not tenant or tenant.plan != "enterprise":
        # Return a valid SSE response so the client can read the event type
        body = b'event: plan_required\ndata: {"required": "enterprise"}\n\n'
        return HttpResponse(body, content_type="text/event-stream", status=402)

    channel = f"{CHANNEL_PREFIX}{tenant.pk}"

    async def event_stream():
        yield "event: connected\ndata: {}\n\n"

        try:
            import redis.asyncio as aioredis
        except ImportError:
            logger.error("redis asyncio module unavailable — SSE disabled")
            return

        from django.conf import settings

        redis_url = getattr(settings, "REDIS_URL", "redis://localhost:6379/0")
        client = aioredis.from_url(redis_url, decode_responses=True)
        pubsub = client.pubsub()

        try:
            await pubsub.subscribe(channel)
            loop = asyncio.get_running_loop()
            last_hb = loop.time()

            while True:
                now = loop.time()

                # Keepalive comment (SSE comments start with ":")
                if now - last_hb >= HEARTBEAT_INTERVAL:
                    yield ": keep-alive\n\n"
                    last_hb = now

                try:
                    msg = await asyncio.wait_for(
                        pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0),
                        timeout=2.0,
                    )
                    if msg and isinstance(msg.get("data"), str):
                        payload = json.loads(msg["data"])
                        event_type = payload.pop("type", "message")
                        yield f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    pass
                except json.JSONDecodeError:
                    pass

                await asyncio.sleep(0.05)

        except asyncio.CancelledError:
            pass  # client disconnected
        except Exception as exc:
            logger.warning("SSE stream error: %s", exc)
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
            await client.aclose()

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"   # disable nginx/Render proxy buffering
    response["Connection"] = "keep-alive"
    return response
