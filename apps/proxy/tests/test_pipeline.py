from __future__ import annotations
import pytest
import pytest_asyncio
from datetime import datetime
from unittest.mock import AsyncMock, patch

# ---------------------------------------------------------------------------
# PIIRegexEvaluator tests
# ---------------------------------------------------------------------------

from apps.proxy.app.evaluators.pii_regex import PIIRegexEvaluator


def test_pii_blocks_ssn():
    ev = PIIRegexEvaluator({})
    result = ev.evaluate("My SSN is 123-45-6789 please process")
    assert result.passed is False
    assert result.action == "block"


def test_pii_blocks_credit_card():
    ev = PIIRegexEvaluator({})
    result = ev.evaluate("charge card 4111111111111111 for this order")
    assert result.passed is False


def test_pii_allows_clean_body():
    ev = PIIRegexEvaluator({})
    result = ev.evaluate("What is the weather like today?")
    assert result.passed is True


def test_pii_custom_pattern():
    ev = PIIRegexEvaluator({"patterns": [r"SECRET-\d+"]})
    result = ev.evaluate("The code is SECRET-9999")
    assert result.passed is False


# ---------------------------------------------------------------------------
# TimeFenceEvaluator tests
# ---------------------------------------------------------------------------

from apps.proxy.app.evaluators.time_fence import TimeFenceEvaluator


def test_time_fence_blocks_outside_hours():
    ev = TimeFenceEvaluator({"allowed_days": [0, 1, 2, 3, 4], "start_hour_utc": 9, "end_hour_utc": 17})
    # Saturday (weekday=5) at 3am UTC — should block (not in allowed_days and outside hours)
    saturday_3am = datetime(2024, 1, 6, 3, 0)  # Jan 6 2024 = Saturday
    result = ev.evaluate(now=saturday_3am)
    assert result.passed is False


def test_time_fence_allows_inside_hours():
    ev = TimeFenceEvaluator({"allowed_days": [0, 1, 2, 3, 4], "start_hour_utc": 9, "end_hour_utc": 17})
    # Monday (weekday=0) at 10am UTC — should allow
    monday_10am = datetime(2024, 1, 8, 10, 0)  # Jan 8 2024 = Monday
    result = ev.evaluate(now=monday_10am)
    assert result.passed is True


def test_time_fence_blocks_weekend():
    ev = TimeFenceEvaluator({"allowed_days": [0, 1, 2, 3, 4], "start_hour_utc": 9, "end_hour_utc": 17})
    # Sunday (weekday=6) at noon — should block (not in allowed_days)
    sunday_noon = datetime(2024, 1, 7, 12, 0)  # Jan 7 2024 = Sunday
    result = ev.evaluate(now=sunday_noon)
    assert result.passed is False


def test_time_fence_blocks_after_hours():
    ev = TimeFenceEvaluator({"allowed_days": [0, 1, 2, 3, 4], "start_hour_utc": 9, "end_hour_utc": 17})
    # Tuesday at 11pm — wrong hour
    tuesday_11pm = datetime(2024, 1, 9, 23, 0)  # Jan 9 2024 = Tuesday
    result = ev.evaluate(now=tuesday_11pm)
    assert result.passed is False


# ---------------------------------------------------------------------------
# RateLimitEvaluator tests (uses fakeredis)
# ---------------------------------------------------------------------------

import asyncio
import fakeredis.aioredis


@pytest.mark.asyncio
async def test_rate_limit_blocks_over_limit():
    redis = fakeredis.aioredis.FakeRedis()
    from apps.proxy.app.evaluators.rate_limit import RateLimitEvaluator

    ev = RateLimitEvaluator({"max_calls": 3, "window_seconds": 60}, redis)

    # First 3 calls should pass
    for _ in range(3):
        result = await ev.evaluate("proj-1", "rule-1")
        assert result.passed is True

    # 4th call should be blocked
    result = await ev.evaluate("proj-1", "rule-1")
    assert result.passed is False
    assert result.action == "block"

    await redis.aclose()


@pytest.mark.asyncio
async def test_rate_limit_allows_within_limit():
    redis = fakeredis.aioredis.FakeRedis()
    from apps.proxy.app.evaluators.rate_limit import RateLimitEvaluator

    ev = RateLimitEvaluator({"max_calls": 10, "window_seconds": 60}, redis)

    for _ in range(5):
        result = await ev.evaluate("proj-2", "rule-2")
        assert result.passed is True

    await redis.aclose()


@pytest.mark.asyncio
async def test_rate_limit_separate_keys_dont_interfere():
    redis = fakeredis.aioredis.FakeRedis()
    from apps.proxy.app.evaluators.rate_limit import RateLimitEvaluator

    ev = RateLimitEvaluator({"max_calls": 2, "window_seconds": 60}, redis)

    # Max out proj-A
    await ev.evaluate("proj-A", "rule-X")
    await ev.evaluate("proj-A", "rule-X")
    blocked = await ev.evaluate("proj-A", "rule-X")
    assert blocked.passed is False

    # proj-B should still be clean
    result = await ev.evaluate("proj-B", "rule-X")
    assert result.passed is True

    await redis.aclose()
