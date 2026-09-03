"""Multilingual care prescription and ASHA follow-up persistence model."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class CarePrescription(Base):
    """Doctor prescription enriched with local-language guidance and follow-up state."""

    __tablename__ = "care_prescriptions"

    prescription_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    doctor_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    diagnosis: Mapped[str] = mapped_column(Text, nullable=False)
    medications: Mapped[list[dict[str, object]]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    language: Mapped[str] = mapped_column(String(32), nullable=False, default="english")
    audio_prescription_script: Mapped[str] = mapped_column(Text, nullable=False)
    follow_up_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    follow_up_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    patient: Mapped["Patient"] = relationship("Patient")
