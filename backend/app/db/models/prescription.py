"""FHIR MedicationRequest persistence projection for tele-consultation prescriptions."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Prescription(Base):
    """Signed doctor order stored in fields directly mappable to FHIR MedicationRequest."""

    __tablename__ = "prescriptions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    prescriber_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    medication_code: Mapped[str] = mapped_column(String(100), nullable=False)
    medication_display: Mapped[str] = mapped_column(String(255), nullable=False)
    dosage_instruction: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    intent: Mapped[str] = mapped_column(String(32), nullable=False, default="order")
    authored_on: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
