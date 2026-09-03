"""Async SQLAlchemy setup supporting SQLite development and PostgreSQL production.

SQLite uses aiosqlite and requires ``check_same_thread=False``. PostgreSQL URLs
use asyncpg without SQLite-specific connection arguments, keeping deployments
compatible with the same session dependency and ORM models.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings


class Base(DeclarativeBase):
    """Base class for all ARROH persistence models."""


settings = get_settings()
engine_options: dict[str, object] = {"pool_pre_ping": True}
if settings.database_url.startswith("sqlite+"):
    engine_options["connect_args"] = {"check_same_thread": False}

engine = create_async_engine(settings.database_url, **engine_options)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield one transactional database session per HTTP request."""

    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
