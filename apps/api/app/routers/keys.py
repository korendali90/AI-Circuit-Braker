from __future__ import annotations
import os
import secrets
import sys
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "packages"))
from db.session import get_db
from db.models import APIKey, Project, User
from shared.schemas import APIKeyCreate, APIKeyResponse, APIKeyCreatedResponse

from ..auth.dependencies import get_current_user

# Must match the CryptContext used in the proxy for key verification.
_key_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

router = APIRouter(prefix="/projects/{project_id}/keys", tags=["keys"])


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


@router.get("", response_model=List[APIKeyResponse])
async def list_keys(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project_or_404(db, project_id, current_user.org_id)

    result = await db.execute(
        select(APIKey).where(APIKey.project_id == project.id)
    )
    keys = result.scalars().all()
    return [APIKeyResponse.model_validate(k) for k in keys]


@router.post("", response_model=APIKeyCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_key(
    project_id: str,
    payload: APIKeyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project_or_404(db, project_id, current_user.org_id)

    # Generate a secure random key
    full_key = "sk-" + secrets.token_urlsafe(32)
    key_prefix = full_key[:12]
    # Hash with bcrypt — matches the proxy's pwd_ctx.verify() check.
    # SHA-256 would be inconsistent and would cause all auth checks to fail.
    key_hash = _key_ctx.hash(full_key)

    api_key = APIKey(
        id=uuid.uuid4(),
        org_id=current_user.org_id,
        project_id=project.id,
        name=payload.name,
        key_hash=key_hash,
        key_prefix=key_prefix,
        scopes=[],
    )
    db.add(api_key)
    await db.flush()

    return APIKeyCreatedResponse(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        created_at=api_key.created_at,
        last_used=api_key.last_used,
        full_key=full_key,
    )


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_key(
    project_id: str,
    key_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project_or_404(db, project_id, current_user.org_id)

    try:
        kid = uuid.UUID(key_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")

    result = await db.execute(
        select(APIKey).where(APIKey.id == kid, APIKey.project_id == project.id)
    )
    key = result.scalar_one_or_none()
    if key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")

    await db.delete(key)
