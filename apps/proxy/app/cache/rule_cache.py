from __future__ import annotations
import json
from typing import Any


async def get_rules(redis_client: Any, project_id: str) -> list[dict]:
    """Get rules from Redis cache. Returns empty list on cache miss."""
    key = f"rules:{project_id}"
    raw = await redis_client.get(key)
    if raw is None:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


async def set_rules(redis_client: Any, project_id: str, rules: list[dict]) -> None:
    """Store rules in Redis cache with a 5-minute TTL."""
    key = f"rules:{project_id}"
    await redis_client.set(key, json.dumps(rules), ex=300)


async def invalidate_rules(redis_client: Any, project_id: str) -> None:
    """Delete cached rules for a project."""
    key = f"rules:{project_id}"
    await redis_client.delete(key)


async def check_rate_limit(
    redis_client: Any,
    project_id: str,
    rule_id: str,
    max_calls: int,
    window_seconds: int,
) -> bool:
    """
    Increment the rate-limit counter for a project/rule combination.

    Returns True if the request is over the limit (should be blocked),
    False if the request is within the allowed rate.
    """
    key = f"ratelimit:{project_id}:{rule_id}"
    current = await redis_client.incr(key)
    if current == 1:
        # New key — set expiry equal to the window
        await redis_client.expire(key, window_seconds)
    return current > max_calls
