"""Application configuration loaded from environment variables."""

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed runtime settings for the ARROH backend."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    project_name: str = "MEDORA - Rural Healthcare Platform"
    api_v1_prefix: str = "/api/v1"
    api_env: Literal["development", "test", "staging", "production"] = "development"
    # Local development defaults to a file-backed async SQLite database. Set
    # DATABASE_URL in .env to a postgresql+asyncpg URL for production.
    database_url: str = "sqlite+aiosqlite:///./arroh_dev.db"
    jwt_secret_key: SecretStr = Field(default=SecretStr("change-me-in-production"))
    jwt_algorithm: str = "HS256"
    cors_origins: list[AnyHttpUrl] = Field(default_factory=list)
    follow_up_overdue_hours: int = Field(default=48, ge=1, le=720)


@lru_cache
def get_settings() -> Settings:
    """Return the cached settings instance for the running process."""

    return Settings()
