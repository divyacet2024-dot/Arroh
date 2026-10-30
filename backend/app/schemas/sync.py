"""Offline synchronization contracts used by ARROH field-worker clients.

The protocol is deliberately idempotent: each locally created record carries a
stable client UUID and timestamp. A device may safely submit the same payload
again after intermittent connectivity without duplicating a patient record.
"""

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.models.patient import TriageStatus


class SyncRecordSchema(BaseModel):
    """One patient/triage observation queued by an offline ARROH client."""

    model_config = ConfigDict(extra="forbid")

    local_client_uuid: uuid.UUID
    local_timestamp: datetime
    name: str = Field(min_length=1, max_length=255)
    gender: str = Field(pattern=r"^(male|female|other|unknown)$")
    birth_date: date
    abha_id: str | None = Field(default=None, description="14-digit ABHA number when available")
    phone_number: str | None = Field(default=None, max_length=20)
    abha_address: str | None = Field(default=None, max_length=255)
    district: str = Field(min_length=2, max_length=120)
    state: str = Field(min_length=2, max_length=120)
    vitals: dict[str, Any] = Field(default_factory=dict)
    symptoms: list[str] = Field(default_factory=list)
    triage_status: TriageStatus = TriageStatus.GREEN

    @field_validator("abha_id", mode="before")
    @classmethod
    def normalize_abha_id(cls, value: object) -> str | None:
        """Store ABHA numbers as 14 canonical digits, independent of display format."""

        if value in (None, ""):
            return None
        if not isinstance(value, str):
            raise ValueError("ABHA ID must be a string")
        normalized = value.replace("-", "").replace(" ", "")
        if not normalized.isdigit() or len(normalized) != 14:
            raise ValueError("ABHA ID must contain exactly 14 digits")
        return normalized

    @field_validator("phone_number", mode="before")
    @classmethod
    def normalize_phone(cls, value: object) -> str | None:
        """Normalize a phone number for deterministic household-level matching."""

        if value in (None, ""):
            return None
        if not isinstance(value, str):
            raise ValueError("Phone number must be a string")
        normalized = "".join(character for character in value if character.isdigit() or character == "+")
        if normalized.startswith("+"):
            normalized = normalized[1:]
        if not normalized.isdigit() or not 10 <= len(normalized) <= 15:
            raise ValueError("Phone number must contain 10 to 15 digits")
        return normalized

    @model_validator(mode="after")
    def require_identity_hint(self) -> "SyncRecordSchema":
        """Require ABHA or phone so an offline observation can be reconciled safely."""

        if not self.abha_id and not self.phone_number:
            raise ValueError("Either ABHA ID or phone number is required for synchronization")
        return self


class TypedSyncRecordSchema(BaseModel):
    """One domain entity queued by an offline client."""

    model_config = ConfigDict(extra="forbid")

    entity_type: Literal["referral", "visit", "task", "follow_up", "case_session", "consultation", "diagnostic_request", "diagnostic_result", "discharge_plan"]
    local_uuid: str = Field(min_length=1, max_length=128)
    operation: Literal["create", "update"] = "create"
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncPayloadSchema(BaseModel):
    """Batch sent by one field worker after an offline session reconnects."""

    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=1, max_length=128)
    phc_id: str = Field(min_length=1, max_length=128)
    sync_timestamp: datetime
    records: list[SyncRecordSchema | TypedSyncRecordSchema] = Field(min_length=0, max_length=500)


class ResolvedConflictSchema(BaseModel):
    """An auditable decision made while merging an offline record."""

    local_client_uuid: uuid.UUID
    patient_id: uuid.UUID
    resolution: str


class SyncResponseSchema(BaseModel):
    """Outcome summary returned to the reconnecting field-worker device."""

    synced_count: int = 0
    duplicate_count: int = 0
    failed_count: int = 0
    resolved_conflicts: list[ResolvedConflictSchema] = Field(default_factory=list)
    results: list["SyncOperationResultSchema"] = Field(default_factory=list)


class SyncOperationResultSchema(BaseModel):
    """Per-operation acknowledgement or structured rejection."""

    entity_type: str
    local_uuid: str
    status: Literal["SYNCED", "DUPLICATE", "FAILED", "CONFLICT"]
    server_id: str | None = None
    error: str | None = None


class SMSFallbackPayloadSchema(BaseModel):
    """Raw compact payload received from an SMS gateway during a network outage."""

    compressed_payload: str = Field(min_length=1, max_length=2048)
