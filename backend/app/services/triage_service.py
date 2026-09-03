"""Compatibility façade for the explainable edge-triage engine."""

from typing import Any

from app.services.ai_triage import assess_symptom_triage


def assess_triage(symptoms: list[str], vitals: dict[str, Any]) -> dict[str, Any]:
    """Assess a field observation using ARROH's deterministic edge rules."""

    return assess_symptom_triage(symptoms, vitals)
