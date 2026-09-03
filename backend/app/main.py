"""FastAPI entrypoint for the ARROH rural healthcare platform."""

import logging

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import text

from app.api.v1.accessibility import router as accessibility_router
from app.api.v1.case_taking import router as case_taking_router
from app.api.v1.patients import router as patients_router
from app.api.v1.inventory import router as inventory_router
from app.api.v1.prescriptions import router as care_prescriptions_router
from app.api.v1.referrals import router as referrals_router
from app.api.v1.sync import router as sync_router
from app.api.v1.teleconsult import router as teleconsult_router, signaling_router
from app.api.v1.triage import router as triage_router
from app.api.v1.timeline import router as timeline_router
from app.api.v1.follow_ups import router as follow_ups_router
from app.api.v1.consultations import router as consultations_router
from app.api.v1.voice import router as voice_router
from app.api.v1.voice_agent import router as voice_agent_router
from app.api.v1.visits import router as visits_router
from app.core.config import get_settings
# Importing the new module registers the case_taking ORM models with ``Base``.
from app.db.models import case_taking as _case_taking_models  # noqa: F401
from app.db.models import referral_transition as _referral_transition_models  # noqa: F401
from app.db.models import follow_up as _follow_up_models  # noqa: F401
from app.db.models import consultation as _consultation_models  # noqa: F401
from app.db.models import visit as _visit_models  # noqa: F401
from app.db.session import Base, engine

logger = logging.getLogger(__name__)
settings = get_settings()


app = FastAPI(
    title="ARROH - Rural Healthcare Platform",
    version="1.0.0",
    description="ABDM-aligned, FHIR-ready backend for accessible rural and remote healthcare.",
)

# Origins that must always be allowed so the SIH demo frontends work on a fresh
# checkout even when no `.env` file is present. These are explicit (not "*")
# because ``allow_credentials=True`` and a wildcard origin are mutually exclusive
# per the CORS spec — browsers reject ``Access-Control-Allow-Origin: *`` whenever
# credentials are included in the request.
_DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# Merge origins declared in the environment with the defaults, de-duplicating.
configured_cors_origins = [str(origin) for origin in settings.cors_origins]
allow_cors_origins = list(dict.fromkeys(configured_cors_origins + _DEFAULT_CORS_ORIGINS))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def create_development_schema() -> None:
    """Create ORM tables for the SQLite local-development database at boot.

    PostgreSQL production deployments continue to use the versioned SQL migrations;
    no implicit DDL is executed for a non-SQLite ``DATABASE_URL``.
    """

    if settings.database_url.startswith("sqlite+"):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
            # ``create_all`` does not alter an existing SQLite table. Keep the
            # local file database forward-compatible with the optional village
            # demographic field without affecting PostgreSQL migrations.
            columns = (await connection.execute(text("PRAGMA table_info(patients)"))).mappings().all()
            if columns and "village" not in {column["name"] for column in columns}:
                await connection.execute(text("ALTER TABLE patients ADD COLUMN village VARCHAR(120)"))
            triage_columns = (await connection.execute(text("PRAGMA table_info(triage_logs)"))).mappings().all()
            triage_column_names = {column["name"] for column in triage_columns}
            if triage_columns and "raw_transcript" not in triage_column_names:
                await connection.execute(text("ALTER TABLE triage_logs ADD COLUMN raw_transcript TEXT"))
            if triage_columns and "assessment" not in triage_column_names:
                await connection.execute(text("ALTER TABLE triage_logs ADD COLUMN assessment JSON"))
            referral_columns = (await connection.execute(text("PRAGMA table_info(referrals)"))).mappings().all()
            referral_column_names = {column["name"] for column in referral_columns}
            if referral_columns and "updated_at" not in referral_column_names:
                await connection.execute(text("ALTER TABLE referrals ADD COLUMN updated_at DATETIME"))
            if referral_columns:
                await connection.execute(text("UPDATE referrals SET updated_at = created_at WHERE updated_at IS NULL"))
            if referral_columns and "specialty_service" not in referral_column_names:
                await connection.execute(text("ALTER TABLE referrals ADD COLUMN specialty_service VARCHAR(128)"))
            if referral_columns and "local_uuid" not in referral_column_names:
                await connection.execute(text("ALTER TABLE referrals ADD COLUMN local_uuid VARCHAR(128)"))
            case_columns = (await connection.execute(text("PRAGMA table_info(case_sessions)"))).mappings().all()
            if case_columns and "local_uuid" not in {column["name"] for column in case_columns}:
                await connection.execute(text("ALTER TABLE case_sessions ADD COLUMN local_uuid VARCHAR(128)"))
            prescription_columns = (await connection.execute(text("PRAGMA table_info(care_prescriptions)"))).mappings().all()
            if prescription_columns and "consultation_id" not in {column["name"] for column in prescription_columns}:
                await connection.execute(text("ALTER TABLE care_prescriptions ADD COLUMN consultation_id CHAR(32)"))


@app.on_event("shutdown")
async def dispose_database_engine() -> None:
    """Release database connections cleanly when the FastAPI process stops."""

    await engine.dispose()


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Return a consistent validation-error envelope."""

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=jsonable_encoder({"detail": exc.errors()}),
    )


@app.exception_handler(HTTPException)
async def http_error_handler(_: Request, exc: HTTPException) -> JSONResponse:
    """Return expected HTTP failures in the same stable error envelope."""

    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)


@app.exception_handler(SQLAlchemyError)
async def database_error_handler(_: Request, exc: SQLAlchemyError) -> JSONResponse:
    """Avoid leaking database internals while retaining an operator-visible log."""

    logger.exception("Database request failed", exc_info=exc)
    return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content={"detail": "Database temporarily unavailable"})


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    """Return a safe, standardized response for unexpected application failures."""

    logger.exception("Unhandled request failure", exc_info=exc)
    return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": "Internal server error"})


app.include_router(accessibility_router, prefix=settings.api_v1_prefix)
app.include_router(case_taking_router, prefix=settings.api_v1_prefix)
app.include_router(patients_router, prefix=settings.api_v1_prefix)
app.include_router(sync_router, prefix=settings.api_v1_prefix)
app.include_router(triage_router, prefix=settings.api_v1_prefix)
app.include_router(inventory_router, prefix=settings.api_v1_prefix)
app.include_router(teleconsult_router, prefix=settings.api_v1_prefix)
app.include_router(voice_router, prefix=settings.api_v1_prefix)
app.include_router(referrals_router, prefix=settings.api_v1_prefix)
app.include_router(care_prescriptions_router, prefix=settings.api_v1_prefix)
app.include_router(timeline_router, prefix=settings.api_v1_prefix)
app.include_router(follow_ups_router, prefix=settings.api_v1_prefix)
app.include_router(consultations_router, prefix=settings.api_v1_prefix)
app.include_router(voice_agent_router, prefix=settings.api_v1_prefix)
app.include_router(visits_router, prefix=settings.api_v1_prefix)
app.include_router(signaling_router)


@app.get("/health", tags=["Health"])
async def health_check() -> dict[str, str]:
    """Provide a lightweight process health probe."""

    return {"status": "ok", "environment": settings.api_env}
