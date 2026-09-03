"""ASHA/ANM home-visit lifecycle, vitals, symptoms, and timeline events.

Step 5 of the ARROH platform introduces a first-class home-visit model that
captures the field worker's full encounter: symptoms reported during the visit,
vitals observed, and a visit outcome that re-uses the existing ``FollowUp``,
``Referral``, and ``FollowUpTask`` services instead of inventing parallel
lifecycles. The visit timeline mirrors the patient-level timeline event types
so the Web/desktop surface can render the same field observations.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


_VISIT_OUTCOMES = frozenset(
    {"COMPLETED", "FOLLOW_UP_REQUIRED", "REFERRAL_REQUIRED", "ESCALATION_REQUIRED"}
)


class Visit(Base):
    """A single home-visit encounter by an ASHA or ANM worker.

    The visit is the canonical surface for Step 5. Outcome is enforced at the
    service layer; the database stores it verbatim so the audit history is
    preserved even if business rules change.
    """

    __tablename__ = "visits"
    __table_args__ = (
        Index("ix_visits_local_uuid", "local_uuid", unique=True),
        Index("ix_visits_patient_started", "patient_id", "started_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    local_uuid: Mapped[str | None] = mapped_column(String(128), nullable=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    phc_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    visit_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False, default="GREEN", index=True)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    findings: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_visit_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    follow_up_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("follow_ups.id"), nullable=True, index=True)
    referral_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("referrals.referral_id"), nullable=True, index=True)
    follow_up_task_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("follow_up_tasks.id"), nullable=True, index=True)
    escalated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class VisitVitals(Base):
    """Optional vitals recorded during a visit.

    Every column is nullable — field workers may only observe a subset. The
    visit itself must be persistable with no vitals at all (a 'general
    follow-up' may not include any measurement).
    """

    __tablename__ = "visit_vitals"
    __table_args__ = (Index("ix_visit_vitals_visit", "visit_id", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("visits.id", ondelete="CASCADE"), nullable=False, index=True)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    pulse_bpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    respiratory_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    systolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diastolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    spo2: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class VisitSymptom(Base):
    """A single symptom reported during a visit. Multiple rows per visit allowed."""

    __tablename__ = "visit_symptoms"
    __table_args__ = (Index("ix_visit_symptoms_visit", "visit_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("visits.id", ondelete="CASCADE"), nullable=False, index=True)
    symptom: Mapped[str] = mapped_column(String(255), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="MODERATE")
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class VisitTimelineEvent(Base):
    """A discrete event in a visit's lifecycle. Mirrors the patient-level timeline."""

    __tablename__ = "visit_timeline_events"
    __table_args__ = (Index("ix_visit_timeline_patient_occurred", "patient_id", "occurred_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("visits.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    summary: Mapped[str] = mapped_column(String(512), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


def _is_valid_outcome(value: str) -> bool:
    return value in _VISIT_OUTCOMES


__all__ = [
    "Visit",
    "VisitVitals",
    "VisitSymptom",
    "VisitTimelineEvent",
    "_VISIT_OUTCOMES",
    "_is_valid_outcome",
]
