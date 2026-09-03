"""Triage state is stored on the patient projection and sync observations."""

from app.db.models.patient import TriageStatus
from app.db.models.triage import TriageLog

__all__ = ["TriageLog", "TriageStatus"]
