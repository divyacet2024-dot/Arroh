"""Durable case-taking storage.

Case-taking sessions, the extracted symptom list, and patient/doctor
confirmations are stored here so the doctor web review and the patient
timeline can re-hydrate the full session.

This module deliberately uses SQLAlchemy ORM (consistent with the rest of
the backend) and adds the two new tables via ``Base.metadata.create_all``
during startup. The existing migration story for PostgreSQL remains
unchanged; new tables simply appear alongside the existing schema.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, Uuid, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# ORM models
# ---------------------------------------------------------------------------


class CaseSessionRow(Base):
    """Durable record of one conversational case-taking session."""

    __tablename__ = "case_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    local_uuid: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True, index=True)
    case_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), unique=True, nullable=False, index=True)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=True, index=True)
    patient_local_uuid: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="unknown")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ai_provider: Mapped[str] = mapped_column(String(32), nullable=False, default="mock")
    raw_transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_proposed_case: Mapped[dict[str, Any]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=dict)
    patient_case: Mapped[dict[str, Any]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=dict)
    doctor_case: Mapped[dict[str, Any] | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    triage_result: Mapped[dict[str, Any]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=dict)
    safety_flags: Mapped[list[str]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=list)
    follow_up_questions: Mapped[list[dict[str, Any]]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=list)
    answers: Mapped[list[dict[str, Any]]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=list)
    timeline_events: Mapped[list[dict[str, Any]]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=list)
    completed: Mapped[bool] = mapped_column(default=False, nullable=False)
    emergency_intent: Mapped[bool] = mapped_column(default=False, nullable=False)


class CaseSymptomRow(Base):
    """One structured symptom inside a case session.

    Stored as a separate table so the doctor web review and timeline can
    query per-symptom without scanning the JSONB blob, and so future
    analytics (e.g. ``COUNT(*) GROUP BY clinical_term``) can run directly
    in SQL.
    """

    __tablename__ = "case_symptoms"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_session_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("case_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=True, index=True)
    symptom: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    body_location: Mapped[str | None] = mapped_column(String(32), nullable=True)
    onset: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duration: Mapped[str | None] = mapped_column(String(64), nullable=True)
    severity: Mapped[str | None] = mapped_column(String(16), nullable=True)
    associated: Mapped[list[str]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False, default=list)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="USER_TEXT")
    confidence: Mapped[float] = mapped_column(default=0.0, nullable=False)
    confirmed_by_user: Mapped[bool] = mapped_column(default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------


def _coerce(value: Any) -> Any:
    """Make dataclass / pydantic objects JSON serialisable."""

    if hasattr(value, "to_dict"):
        return value.to_dict()
    if isinstance(value, list):
        return [_coerce(item) for item in value]
    if isinstance(value, dict):
        return {key: _coerce(item) for key, item in value.items()}
    if isinstance(value, datetime):
        return value.isoformat()
    return value


async def persist_case_session(
    session: AsyncSession,
    *,
    case_session_dict: dict[str, Any],
    patient_db_id: uuid.UUID | None,
) -> CaseSessionRow:
    """Insert or update a case-taking session row.

    Idempotency is keyed on ``case_id``; the mobile client always sends the
    same UUID so a retry cannot create duplicates.
    """

    case_id = uuid.UUID(case_session_dict["case_id"])
    existing = (
        await session.scalars(select(CaseSessionRow).where(CaseSessionRow.case_id == case_id))
    ).first()
    if existing is not None:
        return existing

    row = CaseSessionRow(
        case_id=case_id,
        patient_id=patient_db_id,
        patient_local_uuid=case_session_dict.get("patient_local_uuid"),
        language=case_session_dict.get("language", "unknown"),
        ai_provider=case_session_dict.get("ai_provider", "mock"),
        raw_transcript=case_session_dict.get("raw_transcript") or (case_session_dict.get("patient_case") or {}).get("raw_transcript"),
        ai_proposed_case=_coerce(case_session_dict.get("ai_proposed_case", {})),
        patient_case=_coerce(case_session_dict.get("patient_case", {})),
        doctor_case=_coerce(case_session_dict.get("doctor_case")) if case_session_dict.get("doctor_case") else None,
        triage_result=_coerce(case_session_dict.get("triage_result", {})),
        safety_flags=list(case_session_dict.get("safety_flags", [])),
        follow_up_questions=list(case_session_dict.get("follow_up_questions", [])),
        answers=list(case_session_dict.get("answers", [])),
        timeline_events=list(case_session_dict.get("timeline_events", [])),
        completed=bool(case_session_dict.get("completed", False)),
        emergency_intent=bool(case_session_dict.get("emergency_intent_detected", False)),
    )
    if case_session_dict.get("completed_at"):
        row.completed_at = datetime.fromisoformat(case_session_dict["completed_at"])
    session.add(row)
    await session.flush()
    return row


async def persist_case_symptoms(
    session: AsyncSession,
    *,
    case_session_row: CaseSessionRow,
    patient_case: dict[str, Any],
) -> None:
    """Replace the symptom rows for a case session with the patient-confirmed list."""

    from sqlalchemy import delete

    await session.execute(delete(CaseSymptomRow).where(CaseSymptomRow.case_session_id == case_session_row.id))
    for symptom in patient_case.get("symptoms", []):
        if not isinstance(symptom, dict):
            continue
        session.add(
            CaseSymptomRow(
                case_session_id=case_session_row.id,
                patient_id=case_session_row.patient_id,
                symptom=str(symptom.get("symptom", "")).strip().lower() or "unspecified",
                body_location=symptom.get("body_location"),
                onset=symptom.get("onset"),
                duration=symptom.get("duration"),
                severity=symptom.get("severity"),
                associated=list(symptom.get("associated", [])),
                source=str(symptom.get("source", "USER_TEXT")),
                confidence=float(symptom.get("confidence", 0.0) or 0.0),
                confirmed_by_user=bool(symptom.get("confirmed_by_user", False)),
            )
        )


async def list_case_sessions_for_patient(
    session: AsyncSession, patient_id: uuid.UUID
) -> list[CaseSessionRow]:
    return list((await session.scalars(select(CaseSessionRow).where(CaseSessionRow.patient_id == patient_id))).all())


async def get_case_session(session: AsyncSession, case_id: uuid.UUID) -> CaseSessionRow | None:
    return await session.get(CaseSessionRow, case_id)


def serialise_case_session(row: CaseSessionRow) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "case_id": str(row.case_id),
        "patient_id": str(row.patient_id) if row.patient_id else None,
        "patient_local_uuid": row.patient_local_uuid,
        "language": row.language,
        "ai_provider": row.ai_provider,
        "raw_transcript": row.raw_transcript,
        "ai_proposed_case": row.ai_proposed_case,
        "patient_case": row.patient_case,
        "doctor_case": row.doctor_case,
        "triage_result": row.triage_result,
        "safety_flags": row.safety_flags,
        "follow_up_questions": row.follow_up_questions,
        "answers": row.answers,
        "timeline_events": row.timeline_events,
        "completed": row.completed,
        "emergency_intent_detected": row.emergency_intent,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }
