from __future__ import annotations
import logging
import re
import signal
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class EvalResult:
    passed: bool
    action: str = "allow"
    reason: str = ""


BUILTIN_PATTERNS = {
    "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
    # Matches both formatted (1234-5678-9012-3456 / 1234 5678 9012 3456)
    # and unformatted (16 consecutive digits) card numbers, without backtracking.
    "credit_card": r"\b(?:\d{4}[ -]){3}\d{4}\b|\b\d{16}\b",
    # Original email regex had a character class with `|` inside (treated as literal).
    # Replaced with a standard safe pattern.
    "email": r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b",
}


class PIIRegexEvaluator:
    def __init__(self, config: dict):
        raw_patterns = config.get("patterns", list(BUILTIN_PATTERNS.values()))
        self.compiled: list[re.Pattern] = []
        for p in raw_patterns:
            try:
                self.compiled.append(re.compile(p))
            except re.error as exc:
                logger.warning("Skipping invalid PII regex pattern %r: %s", p[:60], exc)
        self.action = config.get("action", "block")
        # Truncate body to this limit before regex evaluation to bound worst-case time.
        self._max_body_len: int = int(config.get("max_body_len", 65536))

    def evaluate(self, body: str) -> EvalResult:
        # Bound input length to guard against ReDoS on large payloads.
        truncated = body[: self._max_body_len]
        for pattern in self.compiled:
            try:
                if pattern.search(truncated):
                    return EvalResult(
                        passed=False,
                        action=self.action,
                        reason=f"PII detected: {pattern.pattern[:30]}",
                    )
            except re.error as exc:
                logger.error("Regex evaluation error for pattern %r: %s", pattern.pattern[:60], exc)
        return EvalResult(passed=True)
