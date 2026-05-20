from __future__ import annotations
import os
import uuid
from typing import Optional, List, Any

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "packages"))
from db.session import get_db
from db.models import Project, Rule, User

from ..auth.dependencies import get_current_user

router = APIRouter(tags=["rules"])

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


# ---------------------------------------------------------------------------
# Redis helper (module-level lazy singleton)
# ---------------------------------------------------------------------------

_redis: Optional[Any] = None


async def _get_redis() -> Any:
    global _redis
    if _redis is None or _redis.is_closed if hasattr(_redis, "is_closed") else False:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


async def _invalidate_rules(project_id: str) -> None:
    try:
        r = await _get_redis()
        await r.delete(f"rules:{project_id}")
    except Exception:
        pass  # Non-fatal


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


_VALID_RULE_TYPES = {"pii_regex", "rate_limit", "time_fence", "kill_switch", "action_whitelist"}
_VALID_ACTIONS = {"block", "alert", "redact", "allow"}


class RuleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    priority: int = Field(default=100, ge=0, le=10000)
    enabled: bool = True
    rule_type: str = Field(..., max_length=100)
    config: dict = Field(default_factory=dict)
    action: str = Field(..., max_length=50)
    action_config: Optional[dict] = None


class RuleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    priority: Optional[int] = Field(default=None, ge=0, le=10000)
    enabled: Optional[bool] = None
    rule_type: Optional[str] = Field(default=None, max_length=100)
    config: Optional[dict] = None
    action: Optional[str] = Field(default=None, max_length=50)
    action_config: Optional[dict] = None


class RuleResponse(BaseModel):
    id: str
    project_id: str
    org_id: str
    name: str
    description: Optional[str]
    priority: int
    enabled: bool
    rule_type: str
    config: dict
    action: str
    action_config: Optional[dict]
    trigger_count: int
    created_at: str


def _to_response(r: Rule) -> RuleResponse:
    return RuleResponse(
        id=str(r.id),
        project_id=str(r.project_id),
        org_id=str(r.org_id),
        name=r.name,
        description=r.description,
        priority=r.priority,
        enabled=r.enabled,
        rule_type=r.rule_type,
        config=r.config or {},
        action=r.action,
        action_config=r.action_config,
        trigger_count=r.trigger_count,
        created_at=r.created_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/projects/{project_id}/rules", response_model=List[RuleResponse])
async def list_rules(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _check_project_access(db, project_id, current_user.org_id)
    result = await db.execute(
        select(Rule).where(Rule.project_id == uuid.UUID(project_id))
    )
    return [_to_response(r) for r in result.scalars().all()]


@router.post(
    "/projects/{project_id}/rules",
    response_model=RuleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_rule(
    project_id: str,
    payload: RuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _check_project_access(db, project_id, current_user.org_id)
    rule = Rule(
        id=uuid.uuid4(),
        org_id=current_user.org_id,
        project_id=uuid.UUID(project_id),
        name=payload.name,
        description=payload.description,
        priority=payload.priority,
        enabled=payload.enabled,
        rule_type=payload.rule_type,
        config=payload.config,
        action=payload.action,
        action_config=payload.action_config,
        trigger_count=0,
    )
    db.add(rule)
    await db.flush()
    await _invalidate_rules(project_id)
    return _to_response(rule)


@router.get("/projects/{project_id}/rules/{rule_id}", response_model=RuleResponse)
async def get_rule(
    project_id: str,
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rule = await _get_rule_or_404(db, project_id, rule_id, current_user.org_id)
    return _to_response(rule)


@router.put("/projects/{project_id}/rules/{rule_id}", response_model=RuleResponse)
async def update_rule(
    project_id: str,
    rule_id: str,
    payload: RuleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rule = await _get_rule_or_404(db, project_id, rule_id, current_user.org_id)

    if payload.name is not None:
        rule.name = payload.name
    if payload.description is not None:
        rule.description = payload.description
    if payload.priority is not None:
        rule.priority = payload.priority
    if payload.enabled is not None:
        rule.enabled = payload.enabled
    if payload.rule_type is not None:
        rule.rule_type = payload.rule_type
    if payload.config is not None:
        rule.config = payload.config
    if payload.action is not None:
        rule.action = payload.action
    if payload.action_config is not None:
        rule.action_config = payload.action_config

    await db.flush()
    await _invalidate_rules(project_id)
    return _to_response(rule)


@router.delete(
    "/projects/{project_id}/rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_rule(
    project_id: str,
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rule = await _get_rule_or_404(db, project_id, rule_id, current_user.org_id)
    await db.delete(rule)
    await _invalidate_rules(project_id)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _check_project_access(
    db: AsyncSession, project_id: str, org_id: uuid.UUID
) -> Project:
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Project not found")
    result = await db.execute(
        select(Project).where(Project.id == pid, Project.org_id == org_id)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def _get_rule_or_404(
    db: AsyncSession, project_id: str, rule_id: str, org_id: uuid.UUID
) -> Rule:
    await _check_project_access(db, project_id, org_id)
    try:
        rid = uuid.UUID(rule_id)
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Rule not found")

    result = await db.execute(
        select(Rule).where(Rule.id == rid, Rule.project_id == pid)
    )
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule
