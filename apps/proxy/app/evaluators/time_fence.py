from __future__ import annotations
from datetime import datetime
from typing import List
from .pii_regex import EvalResult


class TimeFenceEvaluator:
    """
    Block requests outside a configured UTC time window.

    Config keys:
        allowed_days   – list of integers 0-6 where 0 = Monday (weekday() convention)
        start_hour_utc – inclusive start hour (0-23)
        end_hour_utc   – exclusive end hour (0-23); use 24 to mean midnight (end of day)
    """

    def __init__(self, config: dict):
        self.allowed_days: List[int] = config.get("allowed_days", list(range(7)))
        self.start_hour_utc: int = int(config.get("start_hour_utc", 0))
        self.end_hour_utc: int = int(config.get("end_hour_utc", 24))
        self.action: str = config.get("action", "block")

    def evaluate(self, now: datetime | None = None) -> EvalResult:
        if now is None:
            now = datetime.utcnow()

        current_day = now.weekday()  # 0 = Monday
        current_hour = now.hour

        day_allowed = current_day in self.allowed_days
        hour_allowed = self.start_hour_utc <= current_hour < self.end_hour_utc

        if not day_allowed or not hour_allowed:
            return EvalResult(
                passed=False,
                action=self.action,
                reason=(
                    f"Request outside allowed time window "
                    f"(day={current_day}, hour={current_hour} UTC; "
                    f"allowed days={self.allowed_days}, "
                    f"hours={self.start_hour_utc}-{self.end_hour_utc})"
                ),
            )
        return EvalResult(passed=True)
