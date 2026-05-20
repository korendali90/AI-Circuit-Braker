from __future__ import annotations
import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any

import redis.asyncio as aioredis
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select, text

from .config import settings
from .cache.rule_cache import get_rules, set_rules
from .pipeline.evaluator import evaluate_pipeline
from .pipeline.forwarder import forward_request

# Import DB layer — adjust sys.path if needed when running standalone
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "packages"))
from db.session import AsyncSessionLocal
from db.models import APIKey, Project, RequestLog, Rule

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Redis client (module-level singleton)
# ---------------------------------------------------------------------------
redis_client: Any = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    logger.info("Redis connected: %s", settings.REDIS_URL)
    yield
    await redis_client.aclose()
    logger.info("Redis disconnected")


app = FastAPI(title="AI Circuit Breaker Proxy", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Health endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/ready")
async def ready():
    errors = []

    # Check DB
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
    except Exception as exc:
        errors.append(f"db: {exc}")

    # Check Redis
    try:
        await redis_client.ping()
    except Exception as exc:
        errors.append(f"redis: {exc}")

    if errors:
        # Log real errors server-side; never expose infra details to clients.
        for err in errors:
            logger.error("Readiness check error: %s", err)
        return JSONResponse(
            status_code=503,
            content={"status": "error", "errors": ["dependency unavailable"]},
        )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Helper: resolve API key → project
# ---------------------------------------------------------------------------


async def _get_project_by_key(raw_key: str) -> tuple[Project, APIKey] | None:
    """
    Look up the project associated with an API key.
    Returns (Project, APIKey) or None if not found / key invalid.
    """
    from passlib.context import CryptContext
    from cryptography.fernet import Fernet

    pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    fernet = Fernet(settings.ENCRYPTION_KEY.encode() if len(settings.ENCRYPTION_KEY) < 44
                    else settings.ENCRYPTION_KEY.encode())

    async with AsyncSessionLocal() as session:
        # Narrow candidate keys by the 8-char prefix stored in the DB
        prefix = raw_key[:8] if len(raw_key) >= 8 else raw_key
        stmt = select(APIKey).where(APIKey.key_prefix == prefix)
        result = await session.execute(stmt)
        candidates = result.scalars().all()

        for api_key in candidates:
            if pwd_ctx.verify(raw_key, api_key.key_hash):
                # Load associated project
                proj_result = await session.execute(
                    select(Project).where(Project.id == api_key.project_id)
                )
                project = proj_result.scalar_one_or_none()
                if project:
                    return project, api_key
    return None


# ---------------------------------------------------------------------------
# Helper: decrypt upstream API key
# ---------------------------------------------------------------------------


def _decrypt_upstream_key(enc_key: str | None) -> str:
    if not enc_key:
        return ""
    try:
        from cryptography.fernet import Fernet
        key = settings.ENCRYPTION_KEY.encode()
        # Fernet expects a 32-byte URL-safe base64-encoded key
        fernet = Fernet(key)
        return fernet.decrypt(enc_key.encode()).decode()
    except Exception:
        # Fallback: treat as plain-text (for dev environments)
        return enc_key or ""


# ---------------------------------------------------------------------------
# Helper: load rules (cache-first)
# ---------------------------------------------------------------------------


async def _load_rules(project_id: str) -> list[dict]:
    cached = await get_rules(redis_client, project_id)
    if cached:
        return cached

    async with AsyncSessionLocal() as session:
        stmt = select(Rule).where(
            Rule.project_id == uuid.UUID(project_id),
            Rule.enabled == True,
        )
        result = await session.execute(stmt)
        rules_orm = result.scalars().all()
        rules_dicts = [
            {
                "id": str(r.id),
                "name": r.name,
                "priority": r.priority,
                "enabled": r.enabled,
                "rule_type": r.rule_type,
                "config": r.config or {},
                "action": r.action,
                "action_config": r.action_config,
            }
            for r in rules_orm
        ]

    await set_rules(redis_client, project_id, rules_dicts)
    return rules_dicts


# ---------------------------------------------------------------------------
# Helper: fire-and-forget request logging
# ---------------------------------------------------------------------------


async def _log_request(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    trace_id: str,
    request: Request,
    body_preview: str,
    response_status: int | None,
    latency_ms: int | None,
    rule_triggered_id: str | None,
    action_taken: str | None,
) -> None:
    try:
        async with AsyncSessionLocal() as session:
            log_entry = RequestLog(
                id=uuid.uuid4(),
                org_id=org_id,
                project_id=project_id,
                trace_id=trace_id,
                request_method=request.method,
                request_path=str(request.url.path),
                request_body_preview=body_preview[:500] if body_preview else None,
                response_status=response_status,
                response_latency_ms=latency_ms,
                rule_triggered_id=uuid.UUID(rule_triggered_id) if rule_triggered_id else None,
                action_taken=action_taken,
            )
            session.add(log_entry)
            await session.commit()
    except Exception as exc:
        logger.error("Failed to write request log: %s", exc)


# ---------------------------------------------------------------------------
# Catch-all proxy route
# ---------------------------------------------------------------------------


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
async def proxy_handler(request: Request, path: str):
    # 1. Authenticate via X-CB-Key header
    cb_key = request.headers.get("x-cb-key")
    if not cb_key:
        raise HTTPException(status_code=401, detail="Missing X-CB-Key header")

    # 2. Resolve API key → project
    result = await _get_project_by_key(cb_key)
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid API key")
    project, api_key = result

    # 3. Check project status
    if project.status == "killed":
        return JSONResponse(
            status_code=503,
            content={"error": "Project is killed"},
        )

    # 4. Read request body for rule evaluation
    body_bytes = await request.body()
    body_str = body_bytes.decode("utf-8", errors="replace")

    trace_id = str(uuid.uuid4())

    # 5. Load rules (cache-first)
    rules = await _load_rules(str(project.id))

    # 6. Evaluate pipeline
    pipeline_result = await evaluate_pipeline(
        project=project,
        rules=rules,
        request_body=body_str,
        redis_client=redis_client,
    )

    # 7. Block if pipeline says so
    if pipeline_result.action == "block":
        asyncio.create_task(
            _log_request(
                project_id=project.id,
                org_id=project.org_id,
                trace_id=trace_id,
                request=request,
                body_preview=body_str,
                response_status=429,
                latency_ms=None,
                rule_triggered_id=pipeline_result.rule_id,
                action_taken="block",
            )
        )
        return JSONResponse(
            status_code=429,
            content={"error": pipeline_result.reason},
        )

    # 8. Forward request to upstream
    upstream_key = _decrypt_upstream_key(project.upstream_api_key_enc)
    upstream_response, latency_ms = await forward_request(
        request=request,
        upstream_base_url=project.upstream_base_url,
        upstream_api_key=upstream_key,
    )

    # 9. Log request async (fire and forget)
    asyncio.create_task(
        _log_request(
            project_id=project.id,
            org_id=project.org_id,
            trace_id=trace_id,
            request=request,
            body_preview=body_str,
            response_status=upstream_response.status_code,
            latency_ms=latency_ms,
            rule_triggered_id=pipeline_result.rule_id,
            action_taken=pipeline_result.action,
        )
    )

    # 10. Return upstream response
    return upstream_response
