"""Multilingual prescription and ASHA follow-up scheduling endpoints."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.care_prescription import CarePrescription
from app.db.models.consultation import Consultation
from app.db.models.patient import Patient
from app.db.session import get_db_session
from app.schemas.prescription import CarePrescriptionCreateSchema, CarePrescriptionReadSchema
from app.services.prescription_service import generate_audio_prescription_script
from app.services.follow_up_service import create_follow_up

router = APIRouter(prefix="/prescriptions", tags=["Care Prescriptions"])


@router.post("/create", response_model=CarePrescriptionReadSchema, status_code=status.HTTP_201_CREATED, summary="Create multilingual prescription and follow-up")
async def create_care_prescription(payload: CarePrescriptionCreateSchema, db: AsyncSession = Depends(get_db_session)) -> CarePrescription:
    """Store medicines, generate local-language guidance, and schedule an ASHA follow-up."""

    if await db.get(Patient, payload.patient_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    consultation_id = payload.consultation_id
    if consultation_id is None and payload.consultation_local_uuid:
        consultation = await db.scalar(
            select(Consultation).where(Consultation.local_uuid == payload.consultation_local_uuid)
        )
        if consultation is not None:
            consultation_id = consultation.id

    created_at = datetime.now(timezone.utc)
    prescription = CarePrescription(
        consultation_id=consultation_id,
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        diagnosis=payload.diagnosis,
        medications=[medicine.model_dump() for medicine in payload.medications],
        language=payload.language,
        audio_prescription_script=generate_audio_prescription_script(payload.language, payload.medications),
        follow_up_date=created_at + timedelta(days=payload.follow_up_in_days),
        follow_up_status="PENDING",
    )
    db.add(prescription)
    await db.flush()
    await db.refresh(prescription)
    await create_follow_up(
        db,
        patient_id=prescription.patient_id,
        follow_up_type="POST_TREATMENT",
        due_at=prescription.follow_up_date,
        priority="ROUTINE",
        source_reference=f"prescription:{prescription.prescription_id}",
    )
    return prescription
