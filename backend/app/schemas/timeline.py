"""FHIR-aligned longitudinal timeline response contracts."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TimelineEventSchema(BaseModel):
    """A time-ordered FHIR resource projection representing a care encounter."""

    event_id: str
    resource_type: str = Field(description="FHIR-aligned resource type, such as Observation or MedicationRequest")
    event_type: str
    occurred_at: datetime
    summary: str
    details: dict[str, Any] = Field(default_factory=dict)


class PatientTimelineResponseSchema(BaseModel):
    """Unified patient record returned as a chronological FHIR-aligned event feed."""

    patient_id: uuid.UUID
    events: list[TimelineEventSchema]
