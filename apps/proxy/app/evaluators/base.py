from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class EvalResult:
    """Result returned by every evaluator."""
    passed: bool
    action: str = "allow"
    reason: Optional[str] = None
    metadata: dict = field(default_factory=dict)
