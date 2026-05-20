from __future__ import annotations
from typing import Any
from .pii_regex import EvalResult
from ..cache.rule_cache import check_rate_limit


class RateLimitEvaluator:
    def __init__(self, config: dict, redis_client: Any):
        self.max_calls: int = int(config.get("max_calls", 100))
        self.window_seconds: int = int(config.get("window_seconds", 60))
        self.action: str = config.get("action", "block")
        self.redis_client = redis_client

    async def evaluate(self, project_id: str, rule_id: str) -> EvalResult:
        over_limit = await check_rate_limit(
            self.redis_client,
            project_id,
            rule_id,
            self.max_calls,
            self.window_seconds,
        )
        if over_limit:
            return EvalResult(
                passed=False,
                action=self.action,
                reason=(
                    f"Rate limit exceeded: {self.max_calls} calls "
                    f"per {self.window_seconds}s"
                ),
            )
        return EvalResult(passed=True)
