from __future__ import annotations
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt

logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

_ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

# Refuse to start in production with the default insecure key.
if _ENVIRONMENT != "development" and SECRET_KEY == "dev-secret-key-change-in-production":
    raise RuntimeError(
        "SECRET_KEY must be set to a strong random value in production. "
        "Generate one with: openssl rand -hex 32"
    )

# Warn in development too so developers are aware.
if SECRET_KEY == "dev-secret-key-change-in-production":
    logger.warning(
        "SECRET_KEY is set to the insecure default value. "
        "This is only acceptable in local development."
    )


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode["type"] = "access"
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode["type"] = "refresh"
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise ValueError("Invalid token")
