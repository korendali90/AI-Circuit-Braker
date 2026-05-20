from __future__ import annotations
import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "packages"))
from db.session import get_db
from db.models import RequestLog, Project
from shared.schemas import LogResponse

from ..auth.dependencies import get_current_user
from db.models import User

router = APIRouter(prefix="/projects/{project_id}/logs", tags=["logs"])


async def _get_project_or_403(
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


@router.get("", response_model=List[LogResponse])
async def list_logs(
    project_id: str,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=500),
    action_taken: Optional[str] = Query(default=None),
    hours: int = Query(default=24, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify project belongs to current user's org
    await _get_project_or_403(db, project_id, current_user.org_id)

    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    since = datetime.utcnow() - timedelta(hours=hours)

    query = (
        select(RequestLog)
        .where(
            RequestLog.project_id == pid,
            RequestLog.created_at >= since,
        )
        .order_by(desc(RequestLog.created_at))
        .offset(skip)
        .limit(limit)
    )

    if action_taken is not None:
        query = (
            select(RequestLog)
            .where(
                RequestLog.project_id == pid,
                RequestLog.created_at >= since,
                RequestLog.action_taken == action_taken,
            )
            .order_by(desc(RequestLog.created_at))
            .offset(skip)
            .limit(limit)
        )

    result = await db.execute(query)
    logs = result.scalars().all()
    return [LogResponse.model_validate(log) for log in logs]


@router.get("/stream")
async def stream_logs(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify project belongs to current user's org
    await _get_project_or_403(db, project_id, current_user.org_id)

    try:
        pid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    async def event_generator():
        # Send SSE retry directive
        yield "retry: 3000\n\n"

        last_seen_id: Optional[uuid.UUID] = None

        # Seed last_seen_id with the most recent log so we only stream new ones
        async with db.__class__(bind=db.bind) as seed_session:  # type: ignore[attr-defined]
            seed_result = await seed_session.execute(
                select(RequestLog)
                .where(RequestLog.project_id == pid)
                .order_by(desc(RequestLog.created_at))
                .limit(1)
            )
            latest = seed_result.scalar_one_or_none()
            if latest:
                last_seen_id = latest.id

        while True:
            try:
                await asyncio.sleep(2)

                async with db.__class__(bind=db.bind) as poll_session:  # type: ignore[attr-defined]
                    if last_seen_id is None:
                        poll_result = await poll_session.execute(
                            select(RequestLog)
                            .where(RequestLog.project_id == pid)
                            .order_by(RequestLog.created_at)
                            .limit(50)
                        )
                    else:
                        # Fetch logs with created_at newer than our last seen entry
                        subq = select(RequestLog.created_at).where(
                            RequestLog.id == last_seen_id
                        ).scalar_subquery()

                        poll_result = await poll_session.execute(
                            select(RequestLog)
                            .where(
                                RequestLog.project_id == pid,
                                RequestLog.created_at > subq,
                            )
                            .order_by(RequestLog.created_at)
                            .limit(50)
                        )

                    new_logs = poll_result.scalars().all()

                for log in new_logs:
                    last_seen_id = log.id
                    log_dict = {
                        "id": str(log.id),
                        "trace_id": log.trace_id,
                        "model": log.model,
                        "request_method": log.request_method,
                        "request_path": log.request_path,
                        "request_body_preview": log.request_body_preview,
                        "response_status": log.response_status,
                        "response_latency_ms": log.response_latency_ms,
                        "action_taken": log.action_taken,
                        "created_at": log.created_at.isoformat(),
                    }
                    yield f"data: {json.dumps(log_dict)}\n\n"

            except asyncio.CancelledError:
                # Client disconnected — stop streaming gracefully
                break
            except Exception:
                # On any unexpected error, pause briefly and retry
                await asyncio.sleep(5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
