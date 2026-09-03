"""Pydantic schemas for the AI-assisted case-taking API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ExtractedSymptomSchema(BaseModel):
    symptom: str
    body_location: str | None = None
    onset: str | None = None
    duration: str | None = None
    severity: str | None = None
    associated: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    source: str = "USER_TEXT"
    confirmed_by_user: bool = False


class StructuredCaseSchema(BaseModel):
    symptoms: list[ExtractedSymptomSchema] = Field(default_factory=list)
    duration: str | None = None
    severity: str | None = None
    location: str | None = None
    associated_symptoms: list[str] = Field(default_factory=list)
    pregnancy_status: str | None = None
    injury: str | None = None
    medications: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)
    relevant_vitals: dict[str, float] = Field(default_factory=dict)
    language: str = "unknown"
    raw_transcript: str = ""
    overall_confidence: float = 0.0
    notes: list[str] = Field(default_factory=list)


class FollowUpQuestionSchema(BaseModel):
    question_id: str
    prompt: str
    prompt_translations: dict[str, str] = Field(default_factory=dict)
    expected_kind: str = "yes_no"
    choices: list[str] = Field(default_factory=list)
    priority: int = 100
    safety_reason: str = ""


class CaseSessionSchema(BaseModel):
    case_id: str
    patient_local_uuid: str | None = None
    language: str
    started_at: str
    ai_proposed_case: StructuredCaseSchema
    patient_case: StructuredCaseSchema
    doctor_case: StructuredCaseSchema | None = None
    triage_result: dict[str, Any] = Field(default_factory=dict)
    safety_flags: list[str] = Field(default_factory=list)
    follow_up_questions: list[FollowUpQuestionSchema] = Field(default_factory=list)
    answers: list[dict[str, Any]] = Field(default_factory=list)
    emergency_intent_detected: bool = False
    rag_result: dict[str, Any] | None = None
    timeline_events: list[dict[str, Any]] = Field(default_factory=list)
    completed: bool = False
    completed_at: str | None = None
    notes: list[str] = Field(default_factory=list)


class StartCaseRequest(BaseModel):
    transcript: str = Field(min_length=1)
    language: str | None = None
    patient_local_uuid: str | None = None


class StartCaseResponse(BaseModel):
    session: CaseSessionSchema
    rag: dict[str, Any] | None = None


class AnswerRequest(BaseModel):
    session: CaseSessionSchema
    question_id: str
    answer: str


class ConfirmCaseRequest(BaseModel):
    session: CaseSessionSchema
    patient_case: StructuredCaseSchema | None = None
    doctor_case: StructuredCaseSchema | None = None


class DoctorEditRequest(BaseModel):
    patient_id: str
    session: CaseSessionSchema
    notes: str | None = None
