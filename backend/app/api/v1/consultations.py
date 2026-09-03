"""Doctor consultation, diagnostics, and discharge APIs."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.consultation import Consultation, DiagnosticRequest, DiagnosticResult, DischargePlan
from app.db.models.follow_up import FollowUp
from app.db.session import get_db_session
from app.schemas.consultation import (
    ConsultationCompleteSchema, ConsultationCreateSchema, ConsultationReadSchema, ConsultationSummarySchema,
    DiagnosticRequestReadSchema, DiagnosticRequestSchema, DiagnosticResultReadSchema, DiagnosticResultSchema,
    DischargePlanCreateSchema, DischargePlanReadSchema,
)
from app.services.consultation_service import ConsultationLifecycleError, complete_consultation, create_consultation, create_diagnostic_request, create_diagnostic_result, create_discharge_plan

router = APIRouter(prefix="/consultations", tags=["Doctor Consultations"])


@router.post("", response_model=ConsultationReadSchema, status_code=status.HTTP_201_CREATED)
async def start_consultation(payload: ConsultationCreateSchema, db: AsyncSession = Depends(get_db_session)):
    try:
        item = await create_consultation(db, **payload.model_dump())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.refresh(item)
    return item


@router.get("/{consultation_id}", response_model=ConsultationSummarySchema)
async def get_consultation(consultation_id: uuid.UUID, db: AsyncSession = Depends(get_db_session)):
    item = await db.get(Consultation, consultation_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Consultation not found")
    diagnostics = (await db.scalars(select(DiagnosticRequest).where(DiagnosticRequest.consultation_id == item.id))).all()
    plan = await db.scalar(select(DischargePlan).where(DischargePlan.consultation_id == item.id))
    follow_up = await db.scalar(select(FollowUp).where(FollowUp.source_reference == (f"discharge:{plan.id}" if plan else "")))
    return ConsultationSummarySchema(consultation=item, diagnostics=list(diagnostics), discharge_plan=plan, follow_up_id=follow_up.id if follow_up else None)


@router.post("/{consultation_id}/complete", response_model=ConsultationReadSchema)
async def finish_consultation(consultation_id: uuid.UUID, payload: ConsultationCompleteSchema, db: AsyncSession = Depends(get_db_session)):
    try:
        item = await complete_consultation(db, consultation_id, payload.doctor_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConsultationLifecycleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.refresh(item)
    return item


@router.post("/diagnostics", response_model=DiagnosticRequestReadSchema, status_code=status.HTTP_201_CREATED)
async def request_diagnostic(payload: DiagnosticRequestSchema, db: AsyncSession = Depends(get_db_session)):
    try:
        item = await create_diagnostic_request(db, **payload.model_dump())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.refresh(item)
    return item


@router.post("/diagnostic-results", response_model=DiagnosticResultReadSchema, status_code=status.HTTP_201_CREATED)
async def record_diagnostic_result(payload: DiagnosticResultSchema, db: AsyncSession = Depends(get_db_session)):
    try:
        item = await create_diagnostic_result(db, **payload.model_dump())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.refresh(item)
    return item


@router.post("/discharge", response_model=DischargePlanReadSchema, status_code=status.HTTP_201_CREATED)
async def create_discharge(payload: DischargePlanCreateSchema, db: AsyncSession = Depends(get_db_session)):
    try:
        plan, _ = await create_discharge_plan(db, **payload.model_dump())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ConsultationLifecycleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.refresh(plan)
    return plan
