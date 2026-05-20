from __future__ import annotations
import os
import sys
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "packages"))
from db.session import get_db
from db.models import Alert, Project, User
from shared.schemas import AlertCreate, AlertResponse

from ..auth.dependencies import get_current_user

router = APIRouter(prefix="/projects/{project_id}/alerts", tags=["alerts"])


class AlertUpdate(BaseModel):
    enabled: Optional[bool] = None
    threshold: Optional[float] = None
    name: Optional[str] = None


async def _get_project_or_404(
    db: AsyncSession, project_id: str, org_id: uuid.UUID
) -> Project:
    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    result = await db.execute(
        select(Project).where(Project.id == pid, Project.org_id == org_id)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def _get_alert_or_404(
    db: AsyncSession, alert_id: str, project_id: uuid.UUID
) -> Alert:
    try:
        aid = uuid.UUID(alert_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")

    result = await db.execute(
        select(Alert).where(Alert.id == aid, Alert.project_id == project_id)
    )
    alert = result.scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    return alert


@router.get("", response_model=List[AlertResponse])
async def list_alerts(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project_or_404(db, project_id, current_user.org_id)

    result = await db.execute(
        select(Alert).where(Alert.project_id == project.id)
    )
    alerts = result.scalars().all()
    return [AlertResponse.model_validate(a) for a in alerts]


@router.post("", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
async def create_alert(
    project_id: str,
    payload: AlertCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project_or_404(db, project_id, current_user.org_id)

    alert = Alert(
        id=uuid.uuid4(),
        org_id=current_user.org_id,
        project_id=project.id,
        name=payload.name,
        metric=payload.metric,
        operator=payload.operator,
        threshold=payload.threshold,
        window_seconds=payload.window_seconds,
        silence_seconds=payload.silence_seconds,
        channels=payload.channels,
        enabled=True,
    )
    db.add(alert)
    await db.flush()

    return AlertResponse.model_validate(alert)


@router.patch("/{alert_id}", response_model=AlertResponse)
async def update_alert(
    project_id: str,
    alert_id: str,
    payload: AlertUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project_or_404(db, project_id, current_user.org_id)
    alert = await _get_alert_or_404(db, alert_id, project.id)

    if payload.enabled is not None:
        alert.enabled = payload.enabled
    if payload.threshold is not None:
        alert.threshold = payload.threshold
    if payload.name is not None:
        alert.name = payload.name

    await db.flush()
    return AlertResponse.model_validate(alert)


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(
    project_id: str,
    alert_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project_or_404(db, project_id, current_user.org_id)
    alert = await _get_alert_or_404(db, alert_id, project.id)
    await db.delete(alert)
