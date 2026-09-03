"""Patient-service helpers shared by future ABDM integrations."""

from app.db.models.patient import Patient


def patient_abha_reference(patient: Patient) -> str | None:
    """Return the canonical ABHA identifier for a patient when available."""

    return patient.abha_id
