"""HTTP surface for the AI-assisted case-taking flow."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.case_taking import (
    CaseSessionRow,
    persist_case_session,
    persist_case_symptoms,
    serialise_case_session,
)
from app.db.models.patient import Patient
from app.db.session import get_db_session as get_db
from app.schemas.case_taking import (
    AnswerRequest,
    ConfirmCaseRequest,
    DoctorEditRequest,
    StartCaseRequest,
    StartCaseResponse,
)
from app.services.case_taking_service import CaseTakingService, get_case_taking_service
from app.services.rag_service import get_knowledge_base
from app.services.timeline_service import build_patient_timeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/case-taking", tags=["AI Case-Taking"])


def _patient_db_id(payload) -> uuid.UUID | None:
    if payload is None:
        return None
    if hasattr(payload, "to_dict"):
        payload = payload.to_dict()
    if not isinstance(payload, dict):
        return None
    raw = payload.get("patient_id") or payload.get("patient_db_id")
    if not raw:
        return None
    try:
        return uuid.UUID(str(raw))
    except (TypeError, ValueError):
        return None


@router.post("/start", response_model=StartCaseResponse)
async def start_case_session(
    request: StartCaseRequest,
    service: CaseTakingService = Depends(get_case_taking_service),
) -> StartCaseResponse:
    """Begin a new case-taking session and return the structured case."""

    session = service.start_session(
        transcript=request.transcript,
        language=request.language,
        patient_local_uuid=request.patient_local_uuid,
    )
    rag_result = None
    if session.triage_result.get("triage_level") == "GREEN" and session.patient_case.symptoms:
        query = ", ".join(symptom.symptom for symptom in session.patient_case.symptoms)
        rag = get_knowledge_base().generate_response(
            query=query,
            language=session.language,
        )
        rag_result = rag.to_dict()
        service.attach_rag(session, rag_result)
    return StartCaseResponse(session=session.to_dict(), rag=rag_result)


@router.post("/answer", response_model=None)
async def answer_question(
    request: AnswerRequest,
    service: CaseTakingService = Depends(get_case_taking_service),
) -> dict[str, Any]:
    """Record one answer and return the updated session."""

    case_session = request.session
    session = service.answer_question(
        session=service._coerce_session(case_session),
        question_id=request.question_id,
        answer=request.answer,
    )
    return {"session": session.to_dict()}


@router.post("/confirm", response_model=None)
async def confirm_case(
    request: ConfirmCaseRequest,
    service: CaseTakingService = Depends(get_case_taking_service),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Mark the session complete, persist it, and attach it to the patient timeline."""

    case_session = service.confirm_case(
        session=service._coerce_session(request.session),
        patient_case=service._coerce_structured(request.patient_case) if request.patient_case else None,
        doctor_case=service._coerce_structured(request.doctor_case) if request.doctor_case else None,
    )
    patient_db_id = _patient_db_id(case_session.patient_case) or _patient_db_id(case_session.ai_proposed_case)
    if patient_db_id is None and case_session.patient_local_uuid:
        try:
            patient_db_id = uuid.UUID(case_session.patient_local_uuid)
        except (TypeError, ValueError):
            patient_db_id = None
    row = await persist_case_session(db, case_session_dict=case_session.to_dict(), patient_db_id=patient_db_id)
    await persist_case_symptoms(db, case_session_row=row, patient_case=case_session.patient_case.to_dict())
    await db.commit()
    await db.refresh(row)
    return {
        "case_session": serialise_case_session(row),
        "triage_result": row.triage_result,
    }


@router.post("/doctor-edit", response_model=None)
async def doctor_edit_case(
    request: DoctorEditRequest,
    service: CaseTakingService = Depends(get_case_taking_service),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Doctor (clinician) authoritative edit of a case-taking session.

    The doctor's case is stored alongside the patient's case and the AI
    proposal. The patient timeline is refreshed so the new triage result
    shows up alongside other events.
    """

    try:
        patient_db_id = uuid.UUID(request.patient_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid patient_id") from exc

    patient = await db.get(Patient, patient_db_id)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    case_session = service.confirm_case(
        session=service._coerce_session(request.session),
        doctor_case=service._coerce_structured(request.session.doctor_case) if request.session.doctor_case else None,
    )
    if request.notes:
        case_session.notes.append(f"doctor:{request.notes}")

    case_session.patient_local_uuid = case_session.patient_local_uuid or str(patient.offline_client_uuid or patient_db_id)
    row = await persist_case_session(db, case_session_dict=case_session.to_dict(), patient_db_id=patient_db_id)
    await persist_case_symptoms(db, case_session_row=row, patient_case=case_session.patient_case.to_dict())
    await db.commit()
    await db.refresh(row)

    timeline = await build_patient_timeline(db, patient_db_id)
    return {
        "case_session": serialise_case_session(row),
        "triage_result": row.triage_result,
        "timeline": timeline.model_dump(mode="json") if timeline else None,
    }


@router.get("/patient/{patient_id}/cases", response_model=None)
async def list_patient_cases(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        patient_db_id = uuid.UUID(patient_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid patient_id") from exc

    rows = (await db.scalars(
        __import__("sqlalchemy").select(CaseSessionRow).where(CaseSessionRow.patient_id == patient_db_id)
    )).all()
    return {
        "patient_id": patient_id,
        "cases": [serialise_case_session(row) for row in rows],
    }


@router.get("/case/{case_id}", response_model=None)
async def get_case(
    case_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        case_uuid = uuid.UUID(case_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid case_id") from exc
    from sqlalchemy import select
    row = (await db.scalars(select(CaseSessionRow).where(CaseSessionRow.case_id == case_uuid))).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    return serialise_case_session(row)


@router.get("/knowledge/search", response_model=None)
async def search_knowledge(
    q: str,
    language: str = "en",
    topic: str | None = None,
) -> dict[str, Any]:
    """Direct knowledge-base search for the doctor web review."""

    result = get_knowledge_base().generate_response(query=q, language=language, topic=topic)
    return result.to_dict()
