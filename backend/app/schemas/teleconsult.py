"""WebRTC signaling and FHIR MedicationRequest contracts for tele-consultation."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.patient import TriageStatus


class SDPMessageSchema(BaseModel):
    """WebRTC SDP offer/answer relayed between an ASHA client and doctor portal."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["SDP_OFFER", "SDP_ANSWER"]
    sdp: str = Field(min_length=1, max_length=100_000)
    recipient_id: str | None = Field(default=None, max_length=128)


class ICECandidateSchema(BaseModel):
    """ICE candidate payload required to establish a peer-to-peer media path."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["ICE_CANDIDATE"] = "ICE_CANDIDATE"
    candidate: str = Field(min_length=1, max_length=10_000)
    sdp_mid: str | None = None
    sdp_mline_index: int | None = Field(default=None, ge=0)
    recipient_id: str | None = Field(default=None, max_length=128)


class QueueJoinSchema(BaseModel):
    """Request to add an assessed patient to a PHC doctor's priority queue."""

    patient_id: uuid.UUID
    triage_status: TriageStatus
    phc_id: str = Field(min_length=1, max_length=128)


class QueuePatientSchema(BaseModel):
    """Queue item returned when a doctor claims the next consultation."""

    patient_id: uuid.UUID
    triage_status: TriageStatus
    phc_id: str
    joined_at: datetime


class PrescriptionCreateSchema(BaseModel):
    """FHIR R4 MedicationRequest fields needed to issue a digital prescription."""

    model_config = ConfigDict(extra="forbid")

    patient_id: uuid.UUID
    prescriber_id: str = Field(min_length=1, max_length=128)
    medication_code: str = Field(min_length=1, max_length=100, description="FHIR medicationCodeableConcept.coding.code")
    medication_display: str = Field(min_length=1, max_length=255)
    dosage_instruction: str = Field(min_length=1, max_length=2_000)
    status: Literal["active", "on-hold", "cancelled", "completed", "stopped"] = "active"
    intent: Literal["proposal", "plan", "order", "original-order", "reflex-order", "filler-order", "instance-order", "option"] = "order"


class PrescriptionResponseSchema(BaseModel):
    """FHIR-shaped MedicationRequest response returned to the doctor portal."""

    model_config = ConfigDict(populate_by_name=True)

    resource_type: Literal["MedicationRequest"] = Field(default="MedicationRequest", serialization_alias="resourceType")
    id: uuid.UUID
    status: str
    intent: str
    subject: dict[str, str]
    authored_on: datetime = Field(serialization_alias="authoredOn")
    medication_codeable_concept: dict[str, object] = Field(serialization_alias="medicationCodeableConcept")
    dosage_instruction: list[dict[str, str]] = Field(serialization_alias="dosageInstruction")
