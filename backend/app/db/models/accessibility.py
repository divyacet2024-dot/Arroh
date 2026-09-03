"""Persisted communication preferences for the Accessible Triage Layer.

A patient's preferred intake mode (deaf / speech_impaired / low_literacy) is kept
so future field visits default to the same mode without being re-asked. One row
exists per patient; repeated saves upsert the same preference rather than growing
the table.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class CommunicationMode(str, enum.Enum):
    """Supported intake modes for accessible triage formatting.

    The three clinical modes required by the Accessible Triage Layer are:
    ``deaf``, ``speech_impaired`` and ``low_literacy``. ``standard`` is the
    default standard-voice flow and is stored so the UI can round-trip the
    user's choice even when no special formatting is required.
    """

    DEAF = "deaf"
    SPEECH_IMPAIRED = "speech_impaired"
    LOW_LITERACY = "low_literacy"
    STANDARD = "standard"


class CommunicationPreference(Base):
    """The last communication mode chosen for one patient.

    ``patient_id`` is stored as a plain UUID (indexed, unconstrained FK) so a
    preference can be recorded for a patient who is still being registered in a
    low-bandwidth flow, without tripping a foreign-key violation on PostgreSQL.
    """

    __tablename__ = "communication_preferences"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    communication_mode: Mapped[CommunicationMode] = mapped_column(
        Enum(CommunicationMode, name="communication_mode"), nullable=False, index=True, default=CommunicationMode.STANDARD
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
