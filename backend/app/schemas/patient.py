"""ABDM-aware request and FHIR-compatible response schemas for patients."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

from app.db.models.patient import TriageStatus

FHIRGender = Literal["male", "female", "other", "unknown"]


class PatientBase(BaseModel):
    """Common fields from a FHIR Patient resource and its PHC context."""

    name: str = Field(min_length=1, max_length=255, description="FHIR Patient.name.text")
    gender: FHIRGender
    birth_date: date = Field(description="FHIR Patient.birthDate")
    abha_id: str | None = Field(default=None, pattern=r"^\d{14}$", description="14-digit ABHA number, without spaces")
    abha_address: str | None = Field(default=None, min_length=3, max_length=255)
    phone_number: str | None = Field(default=None, min_length=10, max_length=20)
    village: str | None = Field(default=None, min_length=2, max_length=120)
    phc_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
        validation_alias=AliasChoices("phc_id", "current_phc_id"),
    )
    district: str = Field(min_length=2, max_length=120)
    state: str = Field(min_length=2, max_length=120)
    triage_status: TriageStatus = TriageStatus.GREEN

    @field_validator("abha_id", mode="before")
    @classmethod
    def normalize_abha_id(cls, value: str | None) -> str | None:
        """Accept displayed ABHA numbers while storing their canonical 14 digits."""

        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("ABHA ID must be a string")
        normalized = value.replace("-", "").replace(" ", "")
        if not normalized.isdigit() or len(normalized) != 14:
            raise ValueError("ABHA ID must contain exactly 14 digits")
        return normalized

    @field_validator("abha_address")
    @classmethod
    def normalize_abha_address(cls, value: str | None) -> str | None:
        """Canonicalize optional ABHA address for duplicate detection."""

        return value.strip().lower() if value else None

    @field_validator("phone_number", mode="before")
    @classmethod
    def normalize_phone_number(cls, value: str | None) -> str | None:
        """Store mobile numbers as digits for safe ABDM fallback matching."""

        if value in (None, ""):
            return None
        if not isinstance(value, str):
            raise ValueError("Phone number must be a string")
        normalized = "".join(character for character in value if character.isdigit())
        if not 10 <= len(normalized) <= 15:
            raise ValueError("Phone number must contain 10 to 15 digits")
        return normalized


class PatientCreate(PatientBase):
    """Payload used to register a new patient at a PHC."""

    abha_id: str | None = Field(default=None, pattern=r"^\d{14}$", description="Optional 14-digit ABHA number")
    is_synced_offline: bool = False


class PatientUpdate(BaseModel):
    """Partial update payload reserved for the next CRUD expansion."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    district: str | None = Field(default=None, min_length=2, max_length=120)
    state: str | None = Field(default=None, min_length=2, max_length=120)
    triage_status: TriageStatus | None = None
    is_synced_offline: bool | None = None


class PatientRead(PatientBase):
    """FHIR-compatible patient representation returned by the REST API."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    is_synced_offline: bool
    created_at: datetime
