"""Strict contracts for ARROH's offline-compatible voice intake API."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.triage import TriageResponseSchema


class VoiceParseRequestSchema(BaseModel):
    """Locally transcribed ASHA-worker utterance and optional ABDM identity hint."""

    model_config = ConfigDict(extra="forbid")

    transcript: str = Field(max_length=5_000)
    language: str = Field(default="unknown", min_length=2, max_length=32)
    abha_id: str | None = Field(default=None, max_length=20)


class VoiceParseResponseSchema(BaseModel):
    """Original voice input, locally extracted data, and explainable triage result."""

    transcript: str
    extracted_clinical_data: dict[str, Any]
    triage_assessment: TriageResponseSchema
    # Patient-friendly spoken reply in the patient's language (for TTS playback).
    patient_reply: str
    # Canonical language code the reply was composed in (e.g. "hi", "kn").
    reply_language: str
