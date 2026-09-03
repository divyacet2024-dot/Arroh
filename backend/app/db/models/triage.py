"""Durable triage observations used for auditability and PHC demand forecasting."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.patient import TriageStatus
from app.db.session import Base


class TriageLog(Base):
    """One accepted clinical observation from sync, SMS fallback, or a PHC workflow."""

    __tablename__ = "triage_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    phc_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    triage_status: Mapped[TriageStatus] = mapped_column(Enum(TriageStatus, name="triage_status"), nullable=False, index=True)
    vitals: Mapped[dict[str, object] | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    symptoms: Mapped[list[str] | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    raw_transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    assessment: Mapped[dict[str, object] | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
