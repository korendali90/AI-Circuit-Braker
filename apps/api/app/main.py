from __future__ import annotations
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "packages"))
from db.session import engine
from db.models import Base

from .routers import auth, projects, rules, logs, keys, alerts
from .config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup (dev only — prod uses Alembic)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


# In production lock CORS to the actual frontend origin.
# Set ALLOWED_ORIGINS env var to a comma-separated list, e.g.:
#   ALLOWED_ORIGINS=https://app.example.com
_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
if _raw_origins:
    ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]
elif settings.ENVIRONMENT == "development":
    ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
else:
    # No wildcard in production — fail safe to empty (same-origin only)
    ALLOWED_ORIGINS = []


app = FastAPI(
    title="Circuit Breaker API",
    version="0.1.0",
    lifespan=lifespan,
    # Hide detailed errors from clients in production
    openapi_url="/openapi.json" if settings.ENVIRONMENT == "development" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-CB-Key"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add baseline security headers to every API response."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if settings.ENVIRONMENT != "development":
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains; preload"
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)

# Include all routers with /api prefix
app.include_router(auth.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(rules.router, prefix="/api")
app.include_router(logs.router, prefix="/api")
app.include_router(keys.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/ready")
async def ready():
    import logging as _logging
    _log = _logging.getLogger(__name__)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception as exc:
        # Log the real error server-side; never expose DB internals to clients.
        _log.error("Readiness check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Service unavailable")
