"""Doctor consultation, lightweight diagnostics, and authoritative discharge plans."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Consultation(Base):
    __tablename__ = "consultations"
    __table_args__ = (Index("ix_consultations_local_uuid", "local_uuid", unique=True), Index("ix_consultations_patient_started", "patient_id", "started_at"))

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    local_uuid: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    referral_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("referrals.referral_id"), nullable=True, index=True)
    doctor_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="STARTED", index=True)
    chief_complaint: Mapped[str | None] = mapped_column(Text, nullable=True)
    history: Mapped[str | None] = mapped_column(Text, nullable=True)
    findings: Mapped[str | None] = mapped_column(Text, nullable=True)
    vitals: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    assessment: Mapped[str | None] = mapped_column(Text, nullable=True)
    clinical_impression: Mapped[str | None] = mapped_column(Text, nullable=True)
    treatment_plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class DiagnosticRequest(Base):
    __tablename__ = "diagnostic_requests"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    local_uuid: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    consultation_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("consultations.id"), nullable=False, index=True)
    investigation_name: Mapped[str] = mapped_column(String(255), nullable=False)
    indication: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="REQUESTED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class DiagnosticResult(Base):
    __tablename__ = "diagnostic_results"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    local_uuid: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    investigation_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("diagnostic_requests.id"), nullable=False, index=True)
    result_value: Mapped[str] = mapped_column(Text, nullable=False)
    units: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reference_range: Mapped[str | None] = mapped_column(String(128), nullable=True)
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    verified_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class DischargePlan(Base):
    __tablename__ = "discharge_plans"
    __table_args__ = (Index("ix_discharge_plans_consultation", "consultation_id", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    local_uuid: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    consultation_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("consultations.id"), nullable=False, index=True)
    doctor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    diagnosis: Mapped[str] = mapped_column(Text, nullable=False)
    treatment_instructions: Mapped[str] = mapped_column(Text, nullable=False)
    medication_instructions: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    activity_diet_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    warning_signs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    emergency_return_instructions: Mapped[str] = mapped_column(Text, nullable=False)
    follow_up_required: Mapped[bool] = mapped_column(nullable=False, default=False)
    follow_up_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    referral_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    authored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="SIGNED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ConsultationTimelineEvent(Base):
    __tablename__ = "consultation_timeline_events"
    __table_args__ = (Index("ix_consultation_events_patient_occurred", "patient_id", "occurred_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    consultation_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("consultations.id"), nullable=False, index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reference_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
