from __future__ import annotations
import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# Set env vars before any app imports
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-secret-key-for-testing-only"
os.environ["ENCRYPTION_KEY"] = "test-encryption-key-32chars!!!"
os.environ["ENVIRONMENT"] = "development"

VALID_USER = {
    "email": "test@example.com",
    "password": "SecurePassword1",
    "full_name": "Test User",
    "org_name": "Test Org",
}


@pytest_asyncio.fixture
async def client():
    import sys as _sys
    import os as _os
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
    from sqlalchemy.pool import StaticPool

    # The app code loads session/models via sys.path manipulation as plain 'db.*'
    # (not 'packages.db.*'), so we must ensure the packages dir is on sys.path and
    # import the same module objects the app uses.
    _pkg_dir = _os.path.abspath(
        _os.path.join(_os.path.dirname(__file__), "..", "..", "..", "packages")
    )
    if _pkg_dir not in _sys.path:
        _sys.path.insert(0, _pkg_dir)

    import db.session as _db_session      # same object as apps.api.app.main.engine
    import db.models as _db_models

    # StaticPool: all connections share the same in-memory SQLite database so data
    # written in one request is visible to the next (without it each checkout gets
    # a blank database).
    test_engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    test_session_factory = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )

    # Patch the module that get_db() reads at call time
    _db_session.engine = test_engine
    _db_session.AsyncSessionLocal = test_session_factory

    # main.py captured `engine` as a local binding via `from db.session import engine`;
    # patch that binding too so the lifespan create_all and /health/ready use test_engine.
    import apps.api.app.main as _app_main
    _app_main.engine = test_engine

    # Create all tables before the lifespan runs (create_all is idempotent so the
    # lifespan's second call is harmless).
    async with test_engine.begin() as conn:
        await conn.run_sync(_db_models.Base.metadata.create_all)

    from apps.api.app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    # Tear down
    async with test_engine.begin() as conn:
        await conn.run_sync(_db_models.Base.metadata.drop_all)
    await test_engine.dispose()


@pytest.mark.asyncio
async def test_signup_creates_user(client):
    res = await client.post("/api/auth/signup", json=VALID_USER)
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_returns_tokens(client):
    # First sign up
    await client.post("/api/auth/signup", json=VALID_USER)
    # Then log in
    res = await client.post(
        "/api/auth/login",
        json={"email": VALID_USER["email"], "password": VALID_USER["password"]},
    )
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_protected_without_token(client):
    res = await client.get("/api/projects")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_invalid_token_rejected(client):
    res = await client.get(
        "/api/projects",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_duplicate_signup_fails(client):
    await client.post("/api/auth/signup", json=VALID_USER)
    res = await client.post("/api/auth/signup", json=VALID_USER)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_refresh_token_works(client):
    # Sign up to get tokens
    signup_res = await client.post("/api/auth/signup", json=VALID_USER)
    refresh_token = signup_res.json()["refresh_token"]

    # Use refresh token to get new access token
    res = await client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_wrong_password_rejected(client):
    await client.post("/api/auth/signup", json=VALID_USER)
    res = await client.post(
        "/api/auth/login",
        json={"email": VALID_USER["email"], "password": "wrongpassword"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_health_check(client):
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
