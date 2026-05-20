from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Any
from datetime import datetime
from enum import Enum
import uuid


# ── Enums ────────────────────────────────────────────────────────────────────

class ProjectStatus(str, Enum):
    active = "active"
    paused = "paused"
    killed = "killed"

class RuleAction(str, Enum):
    block = "block"
    allow = "allow"
    redact = "redact"
    reroute = "reroute"
    alert = "alert"

class RuleType(str, Enum):
    pii_block = "pii_block"
    rate_limit = "rate_limit"
    action_whitelist = "action_whitelist"
    time_fence = "time_fence"
    kill_switch = "kill_switch"
    custom = "custom"


# ── Auth ─────────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1)
    org_name: str = Field(min_length=1)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


# ── Projects ─────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    upstream_base_url: str = Field(min_length=1)
    upstream_api_key: str = Field(min_length=1)
    environment: str = "production"

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    upstream_base_url: Optional[str] = None
    upstream_api_key: Optional[str] = None
    environment: Optional[str] = None

class ProjectResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    upstream_base_url: str
    status: ProjectStatus
    environment: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Rules ─────────────────────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    priority: int = Field(default=100, ge=1, le=1000)
    rule_type: RuleType
    config: dict[str, Any]
    action: RuleAction
    action_config: Optional[dict[str, Any]] = None

class RuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None
    config: Optional[dict[str, Any]] = None
    action: Optional[RuleAction] = None
    action_config: Optional[dict[str, Any]] = None

class RuleResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    priority: int
    enabled: bool
    rule_type: RuleType
    config: dict[str, Any]
    action: RuleAction
    action_config: Optional[dict[str, Any]]
    trigger_count: int
    last_triggered: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Logs ─────────────────────────────────────────────────────────────────────

class LogResponse(BaseModel):
    id: uuid.UUID
    trace_id: str
    model: Optional[str]
    request_method: str
    request_path: str
    request_body_preview: Optional[str]
    response_status: Optional[int]
    response_latency_ms: Optional[int]
    action_taken: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── API Keys ──────────────────────────────────────────────────────────────────

class APIKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

class APIKeyResponse(BaseModel):
    id: uuid.UUID
    name: str
    key_prefix: str
    created_at: datetime
    last_used: Optional[datetime]

    class Config:
        from_attributes = True

class APIKeyCreatedResponse(APIKeyResponse):
    full_key: str  # Only returned once at creation


# ── Alerts ────────────────────────────────────────────────────────────────────

class AlertCreate(BaseModel):
    name: str = Field(min_length=1)
    metric: str
    operator: str
    threshold: float
    window_seconds: int = 300
    silence_seconds: int = 1800
    channels: List[dict[str, Any]]

class AlertResponse(BaseModel):
    id: uuid.UUID
    name: str
    metric: str
    operator: str
    threshold: float
    window_seconds: int
    enabled: bool
    last_fired: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True
