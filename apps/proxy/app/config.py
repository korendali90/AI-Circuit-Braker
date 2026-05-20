from __future__ import annotations
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://cb_user:cb_pass@localhost:5432/circuit_breaker"
    REDIS_URL: str = "redis://localhost:6379/0"
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ENCRYPTION_KEY: str = "dev-encryption-key-32-bytes-long!!"
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"
    PROXY_PORT: int = 8000

    class Config:
        env_file = ".env"
        case_sensitive = True

    def validate_production_secrets(self) -> None:
        """Raise on startup if production is running with insecure defaults."""
        if self.ENVIRONMENT == "production":
            if self.SECRET_KEY == "dev-secret-key-change-in-production":
                raise RuntimeError(
                    "SECRET_KEY must be changed in production. "
                    "Generate one with: openssl rand -hex 32"
                )
            if self.ENCRYPTION_KEY in (
                "dev-encryption-key-32-bytes-long!!",
                "dev-encryption-key-32-chars!!!",
            ):
                raise RuntimeError(
                    "ENCRYPTION_KEY must be changed in production. "
                    "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
                )


settings = Settings()
settings.validate_production_secrets()
