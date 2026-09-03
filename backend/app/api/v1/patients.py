"""Patient registration and retrieval endpoints."""

import uuid
from collections.abc import Sequence

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.patient import Patient, TriageStatus
from app.db.session import get_db_session
from app.schemas.patient import PatientCreate, PatientRead

router = APIRouter(prefix="/patients", tags=["Patients"])


@router.get("/", response_model=list[PatientRead], summary="List PHC patient records")
async def list_patients(
    phc_id: str | None = Query(default=None, min_length=1, description="Filter by PHC code"),
    district: str | None = Query(default=None, min_length=2, description="Filter by PHC district"),
    triage_status: TriageStatus | None = Query(default=None, description="Filter by triage priority"),
    db: AsyncSession = Depends(get_db_session),
) -> Sequence[Patient]:
    """Return patient records filtered by district and/or triage priority."""

    query = select(Patient).order_by(Patient.created_at.desc())
    if phc_id:
        query = query.where(Patient.current_phc_id == phc_id.strip())
    if district:
        query = query.where(Patient.district.ilike(district.strip()))
    if triage_status:
        query = query.where(Patient.triage_status == triage_status)
    return (await db.scalars(query)).all()


@router.post("/", response_model=PatientRead, status_code=status.HTTP_201_CREATED, summary="Register patient")
async def create_patient(payload: PatientCreate, db: AsyncSession = Depends(get_db_session)) -> Patient:
    """Persist a new FHIR patient projection with its ABDM identifiers."""

    patient_data = payload.model_dump()
    patient_data["current_phc_id"] = patient_data.pop("phc_id", None)
    patient = Patient(**patient_data)
    db.add(patient)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ABHA ID or ABHA address already exists") from exc
    await db.refresh(patient)
    return patient


@router.get("/{patient_id}", response_model=PatientRead, summary="Get a FHIR patient record")
async def get_patient(patient_id: uuid.UUID, db: AsyncSession = Depends(get_db_session)) -> Patient:
    """Return one patient resource by its stable UUID identifier."""

    patient = await db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return patient
