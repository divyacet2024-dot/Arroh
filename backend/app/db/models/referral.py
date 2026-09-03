"""Referral persistence model for ARROH continuum-of-care handoffs."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Referral(Base):
    """A clinically prioritized transfer from a PHC to a capable facility."""

    __tablename__ = "referrals"

    referral_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    local_uuid: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True, index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    origin_phc_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_facility_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_facility_name: Mapped[str] = mapped_column(String(255), nullable=False)
    target_facility_type: Mapped[str] = mapped_column(String(32), nullable=False)
    referral_priority: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    reason_for_referral: Mapped[str] = mapped_column(Text, nullable=False)
    specialty_service: Mapped[str | None] = mapped_column(String(128), nullable=True)
    required_capabilities: Mapped[list[str]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="INITIATED", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    patient: Mapped["Patient"] = relationship("Patient")
