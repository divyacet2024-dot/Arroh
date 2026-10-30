"""Longitudinal FHIR-aligned patient encounter timeline endpoint."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth_deps import get_current_staff_user
from app.db.models.user import User
from app.db.session import get_db_session
from app.schemas.timeline import PatientTimelineResponseSchema
from app.services.timeline_service import build_patient_timeline

router = APIRouter(tags=["Patient Timeline"])


@router.get(
    "/patients/{patient_id}/timeline",
    response_model=PatientTimelineResponseSchema,
    summary="Get unified patient encounter history",
    # Security: requires a valid staff bearer token.
    # A patient's complete clinical history must never be accessible to
    # unauthenticated callers.  Only authenticated staff (doctor, ASHA, admin)
    # may retrieve the timeline.
)
async def get_patient_timeline(
    patient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    # Staff auth enforced — raises 401 if token is missing or invalid.
    _staff: User = Depends(get_current_staff_user),
) -> PatientTimelineResponseSchema:
    """Return chronological Patient, Observation, Encounter, MedicationRequest,
    and referral events for the given patient.

    Requires a valid staff bearer token obtained via POST /api/v1/auth/login.
    """

    timeline = await build_patient_timeline(db, patient_id)
    if timeline is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return timeline
