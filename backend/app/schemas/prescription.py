"""Pydantic v2 contracts for multilingual medication guidance and follow-up."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MedicationInstructionSchema(BaseModel):
    """A medicine instruction with an easy visual identifier for patient recall."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    dosage: str = Field(min_length=1, max_length=255)
    frequency: Literal["ONCE_DAILY", "TWICE_DAILY", "THRICE_DAILY", "AS_NEEDED"]
    duration_days: int = Field(ge=1, le=365)
    visual_identifier: str = Field(min_length=1, max_length=255)


class CarePrescriptionCreateSchema(BaseModel):
    """Doctor prescription that generates local-language adherence guidance."""

    model_config = ConfigDict(extra="forbid")

    patient_id: uuid.UUID
    doctor_id: str = Field(min_length=1, max_length=128)
    diagnosis: str = Field(min_length=2, max_length=2_000)
    medications: list[MedicationInstructionSchema] = Field(min_length=1, max_length=20)
    language: Literal["english", "hindi", "kannada", "tamil", "telugu"] = "english"
    follow_up_in_days: int = Field(default=3, ge=1, le=90)


class CarePrescriptionReadSchema(BaseModel):
    """Persisted prescription, voice script, and scheduled ASHA follow-up reminder."""

    model_config = ConfigDict(from_attributes=True)

    prescription_id: uuid.UUID
    patient_id: uuid.UUID
    doctor_id: str
    diagnosis: str
    medications: list[MedicationInstructionSchema]
    language: str
    audio_prescription_script: str
    follow_up_date: datetime
    follow_up_status: str
    created_at: datetime
