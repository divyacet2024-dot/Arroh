"""Validated contracts for smart facility matching and referral handoffs."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


FacilityType = Literal["SUB_CENTER", "PHC", "CHC", "DISTRICT_HOSPITAL"]
ReferralPriority = Literal["RED", "YELLOW", "GREEN"]
ReferralStatus = Literal[
    "CREATED", "PATIENT_INFORMED", "SCHEDULED", "TRAVEL_STARTED", "REACHED",
    "CONSULTATION_COMPLETED", "DIAGNOSTIC_COMPLETED", "TREATMENT_STARTED",
    "FOLLOW_UP_REQUIRED", "COMPLETED", "CANCELLED", "EXPIRED",
    "INITIATED", "EN_ROUTE", "ACCEPTED",
]
ReferralLifecycleStatus = Literal[
    "CREATED", "PATIENT_INFORMED", "SCHEDULED", "TRAVEL_STARTED", "REACHED",
    "CONSULTATION_COMPLETED", "DIAGNOSTIC_COMPLETED", "TREATMENT_STARTED",
    "FOLLOW_UP_REQUIRED", "COMPLETED", "CANCELLED", "EXPIRED",
]


class ReferralRecommendationRequestSchema(BaseModel):
    """Clinical data used to rank safe destination facilities."""

    model_config = ConfigDict(extra="forbid")

    patient_id: uuid.UUID
    triage_level: ReferralPriority
    required_capabilities: list[str] = Field(default_factory=list)
    vitals: dict[str, Any] = Field(default_factory=dict)
    high_risk_respiratory: bool = False
    origin_phc_id: str | None = Field(default=None, max_length=128)


class FacilityRecommendationSchema(BaseModel):
    """A ranked destination with transparent transport and capability rationale."""

    facility_id: str
    facility_name: str
    facility_type: FacilityType
    capabilities: list[str]
    distance_km: float
    transport_eta: str
    match_reason: str


class ReferralRecommendationResponseSchema(BaseModel):
    """Ranked facilities available for a referral decision."""

    patient_id: uuid.UUID
    required_capabilities: list[str]
    recommendations: list[FacilityRecommendationSchema]


class ReferralCreateSchema(BaseModel):
    """Payload that locks a selected clinical referral into the care record."""

    model_config = ConfigDict(extra="forbid")

    patient_id: uuid.UUID
    origin_phc_id: str = Field(min_length=1, max_length=128)
    target_facility_id: str = Field(min_length=1, max_length=128)
    target_facility_name: str = Field(min_length=1, max_length=255)
    target_facility_type: FacilityType
    referral_priority: ReferralPriority
    reason_for_referral: str = Field(min_length=5, max_length=2_000)
    specialty_service: str | None = Field(default=None, max_length=128)
    required_capabilities: list[str] = Field(default_factory=list)
    status: ReferralStatus = "CREATED"


class ReferralReadSchema(ReferralCreateSchema):
    """Persisted referral record returned to PHC and transport workflows."""

    model_config = ConfigDict(from_attributes=True)

    referral_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    next_allowed_transitions: list[str] = Field(default_factory=list)


class ReferralTransitionRequestSchema(BaseModel):
    """Validated request for one server-authorized lifecycle transition."""

    model_config = ConfigDict(extra="forbid")

    target_status: ReferralLifecycleStatus
    actor_id: str = Field(min_length=1, max_length=128)
    actor_role: str = Field(min_length=1, max_length=32)
    reason: str | None = Field(default=None, max_length=2_000)
    notes: str | None = Field(default=None, max_length=4_000)
    idempotency_key: str = Field(min_length=1, max_length=255)


class ReferralTransitionReadSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    referral_id: uuid.UUID
    from_status: str
    to_status: str
    actor_id: str
    actor_role: str
    reason: str | None
    notes: str | None
    occurred_at: datetime
    idempotency_key: str


class ReferralTransitionResponseSchema(BaseModel):
    referral: ReferralReadSchema
    previous_status: str
    current_status: str
    transition: ReferralTransitionReadSchema
    next_allowed_transitions: list[str]
