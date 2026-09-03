"""Strict contracts for ARROH's AI emergency voice-calling agent."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.referral import FacilityRecommendationSchema
from app.schemas.triage import TriageResponseSchema


class EmergencyCallRequest(BaseModel):
    """One low-bandwidth emergency voice session initiated by a caller or ASHA worker."""

    model_config = ConfigDict(extra="forbid")

    caller_phone: str | None = Field(default=None, max_length=20)
    spoken_emergency_text: str = Field(max_length=5_000)
    language: str = Field(default="en", min_length=2, max_length=32)
    current_phc_id: str = Field(default="PHC-LOCAL", min_length=1, max_length=128)
    ambulance_eta_minutes: int = Field(default=30, ge=0, le=240)


class RAGFirstAidSchema(BaseModel):
    """Protocol title and safe first-aid steps selected for spoken delivery."""

    protocol_title: str
    instructions: list[str]


class AmbulanceStatusSchema(BaseModel):
    """Ambulance timing and the fallback transport decision."""

    eta_minutes: int
    is_delayed: bool
    actionable_transport_advice: str


class EmergencySessionResponse(BaseModel):
    """Complete emergency agent state supplied to a TTS or caller UI."""

    status: Literal["EMERGENCY_SESSION_ACTIVE"] = "EMERGENCY_SESSION_ACTIVE"
    parsed_clinical_data: dict[str, Any]
    triage_result: TriageResponseSchema
    rag_first_aid: RAGFirstAidSchema
    recommended_facility: FacilityRecommendationSchema | None = None
    ambulance_status: AmbulanceStatusSchema
    agent_spoken_voice_response: str
