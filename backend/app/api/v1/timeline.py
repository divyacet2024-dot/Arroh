"""Longitudinal FHIR-aligned patient encounter timeline endpoint."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.schemas.timeline import PatientTimelineResponseSchema
from app.services.timeline_service import build_patient_timeline

router = APIRouter(tags=["Patient Timeline"])


@router.get("/patients/{patient_id}/timeline", response_model=PatientTimelineResponseSchema, summary="Get unified patient encounter history")
async def get_patient_timeline(patient_id: uuid.UUID, db: AsyncSession = Depends(get_db_session)) -> PatientTimelineResponseSchema:
    """Return chronological Patient, Observation, Encounter, MedicationRequest, and referral events."""

    timeline = await build_patient_timeline(db, patient_id)
    if timeline is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return timeline
