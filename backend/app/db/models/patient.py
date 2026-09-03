"""FHIR R4-aligned patient persistence model."""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class TriageStatus(str, enum.Enum):
    """Clinical priority assigned during rural PHC triage."""

    RED = "RED"
    YELLOW = "YELLOW"
    GREEN = "GREEN"


class Patient(Base):
    """FHIR Patient resource projection enriched with ABDM and triage data.

    ``name`` stores the patient's display name (FHIR ``Patient.name.text``).
    Offline-originated records retain their client UUID and event timestamp. This
    permits idempotent retries and deterministic last-write-wins reconciliation.
    """

    __tablename__ = "patients"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    gender: Mapped[str] = mapped_column(String(32), nullable=False)
    birth_date: Mapped[date] = mapped_column(Date, nullable=False)
    abha_id: Mapped[str | None] = mapped_column(String(14), unique=True, nullable=True, index=True)
    abha_address: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    district: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    triage_status: Mapped[TriageStatus] = mapped_column(
        Enum(TriageStatus, name="triage_status"), nullable=False, default=TriageStatus.GREEN, index=True
    )
    is_synced_offline: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    village: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    current_phc_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    offline_client_uuid: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), unique=True, nullable=True, index=True)
    last_offline_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    vitals: Mapped[dict[str, object] | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    symptoms: Mapped[list[str] | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)

    @property
    def phc_id(self) -> str | None:
        """Expose the current PHC under the API-friendly field name."""

        return self.current_phc_id
