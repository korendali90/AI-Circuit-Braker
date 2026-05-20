from __future__ import annotations
import base64
import os
import uuid
from typing import Optional, List

from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "packages"))
from db.session import get_db
from db.models import Project, User

from ..auth.dependencies import get_current_user

router = APIRouter(prefix="/projects", tags=["projects"])


# ---------------------------------------------------------------------------
# Encryption helper
# ---------------------------------------------------------------------------


def _get_fernet() -> Fernet:
    """
    Return a Fernet instance using the ENCRYPTION_KEY env var.

    The env var must be a URL-safe base64-encoded 32-byte key (44 chars).
    Generate one with:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

    In development only, a deterministic dev key is used so that the service
    starts without configuration.  Production will raise on startup if the
    key is missing or uses the dev default (enforced in config.py).
    """
    import logging as _logging
    _log = _logging.getLogger(__name__)

    key = os.getenv("ENCRYPTION_KEY", "")
    _DEV_KEY = base64.urlsafe_b64encode(b"dev-encryption-key-32bytes!!!!!").decode()

    if not key:
        environment = os.getenv("ENVIRONMENT", "development")
        if environment != "development":
            raise RuntimeError(
                "ENCRYPTION_KEY must be set in production. "
                "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            )
        _log.warning("ENCRYPTION_KEY not set — using insecure dev default. Do not use in production.")
        key = _DEV_KEY

    # Fernet requires exactly a 32-byte URL-safe base64 key (44 chars).
    # Accept raw 32-byte strings by encoding them; reject anything else.
    if len(key) == 32:
        # Treat as raw bytes, encode to proper Fernet format
        key = base64.urlsafe_b64encode(key.encode()).decode()
    elif len(key) != 44:
        raise ValueError(
            f"ENCRYPTION_KEY has unexpected length {len(key)}. "
            "Must be a 44-char URL-safe base64 string (Fernet.generate_key() output)."
        )
    return Fernet(key.encode())


def _encrypt(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def _decrypt(ciphertext: str) -> str:
    return _get_fernet().decrypt(ciphertext.encode()).decode()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    upstream_base_url: str = Field(..., min_length=1, max_length=1024)
    upstream_api_key: Optional[str] = Field(default=None, max_length=512)
    environment: str = Field(default="production", max_length=50)


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    upstream_base_url: Optional[str] = Field(default=None, min_length=1, max_length=1024)
    upstream_api_key: Optional[str] = Field(default=None, max_length=512)
    status: Optional[str] = Field(default=None, max_length=50)
    environment: Optional[str] = Field(default=None, max_length=50)


class ProjectResponse(BaseModel):
    id: str
    org_id: str
    name: str
    description: Optional[str]
    upstream_base_url: str
    status: str
    environment: str
    created_at: str

    class Config:
        from_attributes = True


def _to_response(p: Project) -> ProjectResponse:
    return ProjectResponse(
        id=str(p.id),
        org_id=str(p.org_id),
        name=p.name,
        description=p.description,
        upstream_base_url=p.upstream_base_url,
        status=p.status,
        environment=p.environment,
        created_at=p.created_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=List[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Project).where(Project.org_id == current_user.org_id)
    )
    projects = result.scalars().all()
    return [_to_response(p) for p in projects]


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    enc_key = _encrypt(payload.upstream_api_key) if payload.upstream_api_key else None
    project = Project(
        id=uuid.uuid4(),
        org_id=current_user.org_id,
        name=payload.name,
        description=payload.description,
        upstream_base_url=payload.upstream_base_url,
        upstream_api_key_enc=enc_key,
        environment=payload.environment,
        status="active",
    )
    db.add(project)
    await db.flush()
    return _to_response(project)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project_or_404(db, project_id, current_user.org_id)
    return _to_response(project)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project_or_404(db, project_id, current_user.org_id)

    if payload.name is not None:
        project.name = payload.name
    if payload.description is not None:
        project.description = payload.description
    if payload.upstream_base_url is not None:
        project.upstream_base_url = payload.upstream_base_url
    if payload.upstream_api_key is not None:
        project.upstream_api_key_enc = _encrypt(payload.upstream_api_key)
    if payload.status is not None:
        project.status = payload.status
    if payload.environment is not None:
        project.environment = payload.environment

    await db.flush()
    return _to_response(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await _get_project_or_404(db, project_id, current_user.org_id)
    await db.delete(project)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


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
