"""Visit lifecycle API.

Step 5 surface. Every endpoint accepts a development worker identity via
``X-Worker-Id`` / ``X-Worker-Role`` / ``X-PHC-Id`` headers so the field app
does not need a real authentication layer during the SIH demo. In
production these become the authenticated session claims.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.follow_up import FollowUpTask
from app.db.models.patient import Patient
from app.db.models.visit import (
    Visit,
    VisitSymptom,
    VisitTimelineEvent,
    VisitVitals,
    _VISIT_OUTCOMES,
)
from app.db.session import get_db_session
from app.services.visit_service import (
    VisitLifecycleError,
    VisitValidationError,
    complete_visit,
    get_visit,
    get_visit_by_local_uuid,
    list_today_visits_for_worker,
    list_visits_for_patient,
    list_visits_for_worker,
    record_symptoms,
    record_vitals,
    start_visit,
)


router = APIRouter(tags=["Visits"])


_VISIT_TYPES_PUBLIC = (
    "general follow-up",
    "pregnancy / maternal health",
    "child health",
    "elderly care",
    "post-discharge",
    "medication/treatment follow-up",
    "referral follow-up",
)


def _actor_from_request(request: Request) -> tuple[str, str, str | None]:
    actor_id = request.headers.get("X-Worker-Id", "").strip() or "ASHA-OFFLINE"
    actor_role = request.headers.get("X-Worker-Role", "").strip().upper() or "ASHA"
    phc_id = request.headers.get("X-PHC-Id", "").strip() or None
    return actor_id, actor_role, phc_id


class VisitStartSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_local_uuid: str = Field(min_length=1)
    visit_type: str = Field(min_length=1)
    local_uuid: str | None = None
    phc_id: str | None = None

    @field_validator("visit_type", mode="before")
    @classmethod
    def _normalise_visit_type(cls, value: object) -> object:
        """Map the legacy ``HOME`` synonym to the canonical ``general follow-up``."""

        if isinstance(value, str) and value.strip().upper() == "HOME":
            return "general follow-up"
        return value


class VisitVitalsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    temperature_c: float | None = None
    pulse_bpm: int | None = None
    respiratory_rate: int | None = None
    systolic_bp: int | None = None
    diastolic_bp: int | None = None
    spo2: float | None = None
    weight_kg: float | None = None


class VisitSymptomInputSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symptom: str = Field(min_length=1)
    severity: str | None = None


class VisitSymptomsPayloadSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symptoms: list[VisitSymptomInputSchema] = Field(default_factory=list)


class VisitFollowUpPayloadSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    follow_up_type: str | None = None
    due_at: str | None = None
    priority: str | None = None
    high_risk: bool | None = None
    notes: str | None = None
    local_uuid: str | None = None


class VisitReferralPayloadSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_facility_id: str | None = None
    target_facility_name: str | None = None
    target_facility_type: str | None = None
    referral_priority: str | None = None
    reason_for_referral: str | None = None
    specialty_service: str | None = None
    required_capabilities: list[str] | None = None
    local_uuid: str | None = None


class VisitTaskPayloadSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    follow_up_id: str | None = None
    task_type: str | None = None
    priority: str | None = None
    due_at: str | None = None
    notes: str | None = None


class VisitCompleteSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: str
    findings: str | None = None
    next_visit_date: datetime | None = None
    follow_up: VisitFollowUpPayloadSchema | None = None
    referral: VisitReferralPayloadSchema | None = None
    task: VisitTaskPayloadSchema | None = None


class VisitReadSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    local_uuid: str | None
    patient_id: uuid.UUID
    actor_id: str
    actor_role: str
    phc_id: str | None
    visit_type: str
    started_at: datetime
    completed_at: datetime | None
    outcome: str | None
    risk_level: str
    risk_score: int
    findings: str | None
    next_visit_date: datetime | None
    follow_up_id: uuid.UUID | None
    referral_id: uuid.UUID | None
    follow_up_task_id: uuid.UUID | None
    escalated: bool
    details: dict[str, Any]


class VisitDetailSchema(VisitReadSchema):
    vitals: VisitVitalsSchema | None = None
    symptoms: list[VisitSymptomInputSchema] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)


def _visit_public(visit: Visit) -> VisitReadSchema:
    return VisitReadSchema(
        id=visit.id,
        local_uuid=visit.local_uuid,
        patient_id=visit.patient_id,
        actor_id=visit.actor_id,
        actor_role=visit.actor_role,
        phc_id=visit.phc_id,
        visit_type=visit.visit_type,
        started_at=visit.started_at,
        completed_at=visit.completed_at,
        outcome=visit.outcome,
        risk_level=visit.risk_level,
        risk_score=visit.risk_score,
        findings=visit.findings,
        next_visit_date=visit.next_visit_date,
        follow_up_id=visit.follow_up_id,
        referral_id=visit.referral_id,
        follow_up_task_id=visit.follow_up_task_id,
        escalated=visit.escalated,
        details=visit.details or {},
    )


@router.post("/visits", response_model=VisitReadSchema, status_code=status.HTTP_201_CREATED)
async def start_visit_endpoint(payload: VisitStartSchema, request: Request, db: AsyncSession = Depends(get_db_session)):
    actor_id, actor_role, phc_id = _actor_from_request(request)
    try:
        visit = await start_visit(
            db,
            patient_local_uuid=payload.patient_local_uuid,
            actor_id=actor_id,
            actor_role=actor_role,
            visit_type=payload.visit_type,
            local_uuid=payload.local_uuid,
            phc_id=payload.phc_id or phc_id,
        )
    except VisitValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    await db.refresh(visit)
    return _visit_public(visit)


@router.get("/visits/{visit_id}", response_model=VisitDetailSchema)
async def get_visit_endpoint(visit_id: uuid.UUID, db: AsyncSession = Depends(get_db_session)):
    visit = await get_visit(db, visit_id)
    if visit is None:
        raise HTTPException(status_code=404, detail="Visit not found")
    vitals = await db.scalar(select(VisitVitals).where(VisitVitals.visit_id == visit.id))
    symptoms = (await db.scalars(select(VisitSymptom).where(VisitSymptom.visit_id == visit.id))).all()
    events = (await db.scalars(
        select(VisitTimelineEvent).where(VisitTimelineEvent.visit_id == visit.id).order_by(VisitTimelineEvent.occurred_at.asc())
    )).all()
    base = _visit_public(visit)
    return VisitDetailSchema(
        **base.model_dump(),
        vitals=VisitVitalsSchema(**{k: getattr(vitals, k) for k in VisitVitalsSchema.model_fields if vitals is not None}) if vitals else None,
        symptoms=[VisitSymptomInputSchema(symptom=row.symptom, severity=row.severity) for row in symptoms],
        events=[
            {
                "event_type": event.event_type,
                "actor_id": event.actor_id,
                "actor_role": event.actor_role,
                "occurred_at": event.occurred_at,
                "summary": event.summary,
                "details": event.details,
            }
            for event in events
        ],
    )


@router.get("/visits", response_model=list[VisitReadSchema])
async def list_visits_endpoint(
    patient_id: uuid.UUID | None = None,
    actor_id: str | None = None,
    since: datetime | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db_session),
):
    if patient_id is not None:
        rows = await list_visits_for_patient(db, patient_id=patient_id, limit=limit)
    elif actor_id:
        rows = await list_visits_for_worker(db, actor_id=actor_id, since=since, limit=limit)
    else:
        rows = []
    return [_visit_public(row) for row in rows]


@router.get("/workers/{actor_id}/today", response_model=list[VisitReadSchema])
async def today_for_worker(actor_id: str, db: AsyncSession = Depends(get_db_session)):
    rows = await list_today_visits_for_worker(db, actor_id=actor_id, now=datetime.now(timezone.utc))
    return [_visit_public(row) for row in rows]


@router.post("/visits/{visit_id}/vitals", response_model=VisitVitalsSchema)
async def record_vitals_endpoint(visit_id: uuid.UUID, payload: VisitVitalsSchema, request: Request, db: AsyncSession = Depends(get_db_session)):
    actor_id, actor_role, _ = _actor_from_request(request)
    try:
        vitals = await record_vitals(
            db,
            visit_id=visit_id,
            actor_id=actor_id,
            actor_role=actor_role,
            vitals=payload.model_dump(exclude_none=True),
        )
    except VisitValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except VisitLifecycleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.commit()
    return VisitVitalsSchema(
        temperature_c=vitals.temperature_c,
        pulse_bpm=vitals.pulse_bpm,
        respiratory_rate=vitals.respiratory_rate,
        systolic_bp=vitals.systolic_bp,
        diastolic_bp=vitals.diastolic_bp,
        spo2=vitals.spo2,
        weight_kg=vitals.weight_kg,
    )


@router.post("/visits/{visit_id}/symptoms", response_model=list[VisitSymptomInputSchema])
async def record_symptoms_endpoint(visit_id: uuid.UUID, payload: VisitSymptomsPayloadSchema, request: Request, db: AsyncSession = Depends(get_db_session)):
    actor_id, actor_role, _ = _actor_from_request(request)
    try:
        rows = await record_symptoms(
            db,
            visit_id=visit_id,
            actor_id=actor_id,
            actor_role=actor_role,
            symptoms=[row.model_dump() for row in payload.symptoms],
        )
    except VisitValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except VisitLifecycleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.commit()
    return [VisitSymptomInputSchema(symptom=row.symptom, severity=row.severity) for row in rows]


@router.post("/visits/{visit_id}/complete", response_model=VisitDetailSchema)
async def complete_visit_endpoint(visit_id: uuid.UUID, payload: VisitCompleteSchema, request: Request, db: AsyncSession = Depends(get_db_session)):
    actor_id, actor_role, _ = _actor_from_request(request)
    if payload.outcome not in _VISIT_OUTCOMES:
        raise HTTPException(status_code=400, detail=f"outcome must be one of: {', '.join(sorted(_VISIT_OUTCOMES))}")
    try:
        completion = await complete_visit(
            db,
            visit_id=visit_id,
            actor_id=actor_id,
            actor_role=actor_role,
            outcome=payload.outcome,
            findings=payload.findings,
            next_visit_date=payload.next_visit_date,
            follow_up_payload=payload.follow_up.model_dump(exclude_none=True) if payload.follow_up else None,
            referral_payload=payload.referral.model_dump(exclude_none=True) if payload.referral else None,
            task_payload=payload.task.model_dump(exclude_none=True) if payload.task else None,
        )
    except VisitValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except VisitLifecycleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.commit()
    visit = await get_visit(db, completion.visit_id)
    return await get_visit_endpoint(visit.id, db)


@router.get("/visits/by-local-uuid/{local_uuid}", response_model=VisitDetailSchema)
async def get_visit_by_local_uuid_endpoint(local_uuid: str, db: AsyncSession = Depends(get_db_session)):
    visit = await get_visit_by_local_uuid(db, local_uuid)
    if visit is None:
        raise HTTPException(status_code=404, detail="Visit not found")
    return await get_visit_endpoint(visit.id, db)
