"""Offline bulk-sync and emergency SMS fallback endpoints."""

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.patient import Patient, TriageStatus
from app.db.models.triage import TriageLog
from app.db.session import get_db_session
from app.schemas.sync import SMSFallbackPayloadSchema, SyncPayloadSchema, SyncResponseSchema
from app.services.sms_parser import decode_sms_payload
from app.services.sync_service import synchronize_batch

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sync", tags=["Offline Synchronization"])


@router.post("/bulk", response_model=SyncResponseSchema, summary="Synchronize an offline field-worker batch")
async def bulk_sync(payload: SyncPayloadSchema, db: AsyncSession = Depends(get_db_session)) -> SyncResponseSchema:
    """Atomically reconcile a reconnecting worker's queued patient observations."""

    return await synchronize_batch(db, payload)


@router.post("/sms-fallback", summary="Ingest a compact emergency SMS record")
async def sms_fallback(payload: SMSFallbackPayloadSchema, db: AsyncSession = Depends(get_db_session)) -> dict[str, object]:
    """Decode, log, and persist emergency triage data when the internet is unavailable."""

    try:
        emergency = decode_sms_payload(payload.compressed_payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    predicates = []
    if emergency["abha_id"]:
        predicates.append(Patient.abha_id == emergency["abha_id"])
    if emergency["phone_number"]:
        predicates.append(Patient.phone_number == emergency["phone_number"])
    patient = await db.scalar(select(Patient).where(or_(*predicates)).with_for_update())

    if patient is None:
        identifier = emergency["abha_id"] or emergency["phone_number"]
        patient = Patient(
            name=f"Emergency SMS {identifier}",
            gender="unknown",
            birth_date=date(1900, 1, 1),
            abha_id=emergency["abha_id"],
            phone_number=emergency["phone_number"],
            district="UNKNOWN",
            state="UNKNOWN",
            triage_status=TriageStatus(emergency["triage_status"]),
            vitals=emergency["vitals"],
            symptoms=[str(emergency["primary_symptom_code"])],
            is_synced_offline=True,
        )
        db.add(patient)
        resolution = "Created provisional emergency patient"
    else:
        patient.triage_status = TriageStatus(emergency["triage_status"])
        patient.vitals = emergency["vitals"]
        patient.symptoms = [str(emergency["primary_symptom_code"])]
        patient.is_synced_offline = True
        resolution = "Updated matched emergency patient"

    await db.flush()
    db.add(
        TriageLog(
            patient_id=patient.id,
            phc_id=patient.current_phc_id,
            triage_status=patient.triage_status,
            vitals=patient.vitals,
            symptoms=patient.symptoms,
            source="sms_fallback",
        )
    )
    logger.warning("Emergency SMS triage recorded: patient_id=%s triage=%s", patient.id, emergency["triage_status"])
    return {"patient_id": str(patient.id), "triage_status": emergency["triage_status"], "resolution": resolution}
