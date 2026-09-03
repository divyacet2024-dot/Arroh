"""Accessible Triage Layer endpoints.

Adapts an existing triage assessment for a patient's communication mode and
persists their last-used mode so future field visits default to the same
intake experience. These endpoints never re-score a patient; they only shape
how the existing clinical output is presented to an accessible boundary.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.accessibility import CommunicationMode, CommunicationPreference
from app.db.session import get_db_session
from app.schemas.accessibility import (
    FormatTriageRequestSchema,
    FormatTriageResponseSchema,
    PreferenceReadSchema,
    PreferenceSaveSchema,
)
from app.services.accessibility_service import format_triage_for_mode

router = APIRouter(prefix="/accessibility", tags=["Accessible Triage Layer"])


def _to_enum(mode: str) -> CommunicationMode:
    """Map a validated literal into the persisted enum, guarding future additions."""

    try:
        return CommunicationMode(mode)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unsupported communication mode: {mode}") from exc


@router.post("/format-triage", response_model=FormatTriageResponseSchema, summary="Format triage for a patient's communication mode")
async def format_triage(payload: FormatTriageRequestSchema, db: AsyncSession = Depends(get_db_session)) -> FormatTriageResponseSchema:
    """Return accessible output and record the patient's preferred mode as a side effect."""

    # Upsert the patient's mode so the very next visit defaults to it automatically.
    preference = (await db.scalars(select(CommunicationPreference).where(CommunicationPreference.patient_id == payload.patient_id))).first()
    if preference is None:
        preference = CommunicationPreference(patient_id=payload.patient_id, communication_mode=_to_enum(payload.communication_mode))
        db.add(preference)
    else:
        preference.communication_mode = _to_enum(payload.communication_mode)
    try:
        await db.flush()
    except IntegrityError:
        # A concurrent write may have inserted the row; a later GET will resolve it.
        await db.rollback()

    return FormatTriageResponseSchema(**format_triage_for_mode(payload.triage_payload, payload.communication_mode))


@router.post("/preferences", response_model=PreferenceReadSchema, status_code=status.HTTP_201_CREATED, summary="Save a patient's communication preference")
async def save_preference(payload: PreferenceSaveSchema, db: AsyncSession = Depends(get_db_session)) -> CommunicationPreference:
    """Upsert the patient's preferred intake mode for future visits."""

    preference = (await db.scalars(select(CommunicationPreference).where(CommunicationPreference.patient_id == payload.patient_id))).first()
    if preference is None:
        preference = CommunicationPreference(patient_id=payload.patient_id, communication_mode=_to_enum(payload.communication_mode))
        db.add(preference)
    else:
        preference.communication_mode = _to_enum(payload.communication_mode)
    await db.flush()
    await db.refresh(preference)
    return preference


@router.get("/preferences/{patient_id}", response_model=PreferenceReadSchema, summary="Get a patient's saved communication preference")
async def get_preference(patient_id: uuid.UUID, db: AsyncSession = Depends(get_db_session)) -> CommunicationPreference:
    """Return the last saved mode, defaulting to voice-first when none is stored."""

    preference = (await db.scalars(select(CommunicationPreference).where(CommunicationPreference.patient_id == patient_id))).first()
    if preference is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No communication preference saved for this patient")
    return preference
