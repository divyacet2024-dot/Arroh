"""Request and response contracts for ARROH's explainable edge-triage service."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class TriageRequestSchema(BaseModel):
    """Symptoms and available vital readings supplied by an edge client or PHC."""

    model_config = ConfigDict(extra="forbid")

    symptoms: list[str] = Field(default_factory=list, max_length=50)
    vitals: dict[str, Any] = Field(default_factory=dict)


class TriageResponseSchema(BaseModel):
    """Explainable clinical-priority output for human review, not autonomous diagnosis."""

    risk_score: int = Field(ge=0, le=100)
    triage_level: Literal["RED", "YELLOW", "GREEN"]
    recommended_actions: list[str]
    high_risk_respiratory: bool
    high_risk_maternal: bool
    maternal_conditions: list[str] = Field(default_factory=list)
    assessed_vitals: dict[str, float]
    missing_vitals: list[str]
