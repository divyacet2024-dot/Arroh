"""Strict doctor consultation, diagnostic, and discharge contracts."""

import uuid
from datetime import datetime
from typing import Literal, Any

from pydantic import BaseModel, ConfigDict, Field


class ConsultationCreateSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_id: uuid.UUID
    doctor_id: str = Field(min_length=1, max_length=128)
    referral_id: uuid.UUID | None = None
    chief_complaint: str | None = Field(default=None, max_length=4000)
    history: str | None = Field(default=None, max_length=10000)
    findings: str | None = Field(default=None, max_length=10000)
    vitals: dict[str, Any] = Field(default_factory=dict)
    assessment: str | None = Field(default=None, max_length=10000)
    clinical_impression: str | None = Field(default=None, max_length=4000)
    treatment_plan: str | None = Field(default=None, max_length=10000)
    local_uuid: str | None = Field(default=None, max_length=128)


class ConsultationReadSchema(ConsultationCreateSchema):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: str
    started_at: datetime
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ConsultationCompleteSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    doctor_id: str = Field(min_length=1, max_length=128)


class DiagnosticRequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    consultation_id: uuid.UUID
    investigation_name: str = Field(min_length=1, max_length=255)
    indication: str | None = Field(default=None, max_length=4000)
    requested_by: str = Field(min_length=1, max_length=128)
    local_uuid: str | None = Field(default=None, max_length=128)


class DiagnosticRequestReadSchema(DiagnosticRequestSchema):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: str
    created_at: datetime


class DiagnosticResultSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    investigation_id: uuid.UUID
    result_value: str = Field(min_length=1, max_length=4000)
    units: str | None = Field(default=None, max_length=64)
    reference_range: str | None = Field(default=None, max_length=128)
    performed_at: datetime
    verified_by: str | None = Field(default=None, max_length=128)
    local_uuid: str | None = Field(default=None, max_length=128)


class DiagnosticResultReadSchema(DiagnosticResultSchema):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime


class DischargePlanCreateSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    consultation_id: uuid.UUID
    doctor_id: str = Field(min_length=1, max_length=128)
    diagnosis: str = Field(min_length=1, max_length=4000)
    treatment_instructions: str = Field(min_length=1, max_length=10000)
    medication_instructions: list[dict[str, Any]] = Field(default_factory=list)
    activity_diet_instructions: str | None = Field(default=None, max_length=4000)
    warning_signs: list[str] = Field(default_factory=list)
    emergency_return_instructions: str = Field(min_length=1, max_length=4000)
    follow_up_required: bool = False
    follow_up_due_at: datetime | None = None
    referral_instructions: str | None = Field(default=None, max_length=4000)
    local_uuid: str | None = Field(default=None, max_length=128)


class DischargePlanReadSchema(DischargePlanCreateSchema):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    authored_at: datetime
    status: str
    created_at: datetime


class ConsultationSummarySchema(BaseModel):
    consultation: ConsultationReadSchema
    diagnostics: list[DiagnosticRequestReadSchema]
    discharge_plan: DischargePlanReadSchema | None
    follow_up_id: uuid.UUID | None
