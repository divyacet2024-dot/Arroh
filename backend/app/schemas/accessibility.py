"""Request and response contracts for the Accessible Triage Layer.

These contracts let a triage assessment be re-formatted for a patient's
communication mode: bold visual captions for deaf users, a simple read-aloud
script for low-literacy users, and icon-like action chips for speech-impaired
users. They also persist a patient's last-used mode so future visits default to
it.
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

CommunicationMode = Literal["deaf", "speech_impaired", "low_literacy", "standard"]


class FormatTriageRequestSchema(BaseModel):
    """A completed triage assessment plus the patient's preferred intake mode."""

    model_config = ConfigDict(extra="forbid")

    patient_id: uuid.UUID
    communication_mode: CommunicationMode
    triage_payload: dict[str, Any]


class FormatTriageResponseSchema(BaseModel):
    """Mode-appropriate output plus an interpreter-request flag for doctor alerts."""

    communication_mode: CommunicationMode
    sign_interpreter_requested: bool
    visual_captions: list[str] = Field(default_factory=list)
    read_aloud_script: str = ""
    simplified_actions: list[str] = Field(default_factory=list)


class PreferenceSaveSchema(BaseModel):
    """Persist a patient's preferred communication mode for future visits."""

    model_config = ConfigDict(extra="forbid")

    patient_id: uuid.UUID
    communication_mode: CommunicationMode


class PreferenceReadSchema(BaseModel):
    """The stored communication preference keyed by patient."""

    model_config = ConfigDict(from_attributes=True)

    patient_id: uuid.UUID
    communication_mode: CommunicationMode
    updated_at: datetime
