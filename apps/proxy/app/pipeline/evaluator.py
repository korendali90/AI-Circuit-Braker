from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, Any
import json
import logging

from ..evaluators.pii_regex import PIIRegexEvaluator
from ..evaluators.rate_limit import RateLimitEvaluator
from ..evaluators.time_fence import TimeFenceEvaluator

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    action: str  # "allow", "block", "redact"
    rule_id: Optional[str]
    reason: str


async def evaluate_pipeline(
    project: Any,
    rules: list[dict],
    request_body: str,
    redis_client: Any,
) -> PipelineResult:
    """
    Evaluate all enabled rules in priority order (ascending).

    Returns the first blocking result, or PipelineResult(action="allow") if
    all rules pass.
    """
    # Sort by priority ascending (lower number = higher priority)
    sorted_rules = sorted(
        [r for r in rules if r.get("enabled", True)],
        key=lambda r: r.get("priority", 100),
    )

    project_id = str(project.id) if hasattr(project, "id") else str(project.get("id", ""))

    for rule in sorted_rules:
        rule_type = rule.get("rule_type", "")
        config = rule.get("config", {})
        rule_id = str(rule.get("id", ""))
        action = rule.get("action", "block")

        try:
            if rule_type == "pii_regex":
                evaluator = PIIRegexEvaluator(config)
                result = evaluator.evaluate(request_body)

            elif rule_type == "rate_limit":
                evaluator = RateLimitEvaluator(config, redis_client)
                result = await evaluator.evaluate(project_id, rule_id)

            elif rule_type == "time_fence":
                evaluator = TimeFenceEvaluator(config)
                result = evaluator.evaluate()

            else:
                logger.warning("Unknown rule_type=%s, skipping rule_id=%s", rule_type, rule_id)
                continue

        except Exception as exc:
            logger.error(
                "Error evaluating rule_id=%s rule_type=%s: %s",
                rule_id,
                rule_type,
                exc,
            )
            continue

        if not result.passed:
            if action == "block":
                return PipelineResult(
                    action="block",
                    rule_id=rule_id,
                    reason=result.reason,
                )
            elif action == "alert":
                # Log the violation but continue processing
                logger.warning(
                    "Rule alert triggered rule_id=%s reason=%s",
                    rule_id,
                    result.reason,
                )
            elif action == "redact":
                return PipelineResult(
                    action="redact",
                    rule_id=rule_id,
                    reason=result.reason,
                )

    return PipelineResult(action="allow", rule_id=None, reason="")
