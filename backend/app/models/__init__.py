"""Compatibility domain-model exports for the ARROH architecture."""

from app.db.models.patient import Patient, TriageStatus
from app.db.models.prescription import Prescription

__all__ = ["Patient", "Prescription", "TriageStatus"]
