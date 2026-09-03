"""Smart referral endpoints for clinical escalation and facility matching."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.patient import Patient, TriageStatus
from app.db.models.referral import Referral
from app.db.session import get_db_session
from app.schemas.referral import (
    ReferralCreateSchema,
    ReferralReadSchema,
    ReferralRecommendationRequestSchema,
    ReferralRecommendationResponseSchema,
    ReferralTransitionReadSchema,
    ReferralTransitionRequestSchema,
    ReferralTransitionResponseSchema,
)
from app.services.referral_lifecycle_service import (
    ReferralLifecycleError,
    create_referral_event,
    next_allowed_transitions,
    transition_referral,
)
from app.db.models.referral_transition import ReferralTransition
from app.services.referral_service import recommend_facilities

router = APIRouter(prefix="/referrals", tags=["Smart Referrals"])


@router.post("/recommend", response_model=ReferralRecommendationResponseSchema, summary="Recommend capable referral facilities")
async def recommend_referral(payload: ReferralRecommendationRequestSchema, db: AsyncSession = Depends(get_db_session)) -> ReferralRecommendationResponseSchema:
    """Rank nearby facility options while enforcing RED-respiratory safety constraints."""

    if await db.get(Patient, payload.patient_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    recommendations = recommend_facilities(payload)
    return ReferralRecommendationResponseSchema(
        patient_id=payload.patient_id,
        required_capabilities=payload.required_capabilities,
        recommendations=recommendations,
    )


@router.post("/create", response_model=ReferralReadSchema, status_code=status.HTTP_201_CREATED, summary="Create and lock a referral")
async def create_referral(payload: ReferralCreateSchema, db: AsyncSession = Depends(get_db_session)) -> dict[str, object]:
    """Persist a selected destination and align the patient record with escalation priority."""

    patient = await db.get(Patient, payload.patient_id)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    patient.current_phc_id = payload.origin_phc_id
    patient.triage_status = TriageStatus(payload.referral_priority)
    referral = Referral(**payload.model_dump())
    db.add(referral)
    await db.flush()
    await create_referral_event(db, referral, actor_id="SYSTEM", actor_role="SYSTEM")
    await db.refresh(referral)
    return {
        **{field: getattr(referral, field) for field in ReferralCreateSchema.model_fields},
        "referral_id": referral.referral_id,
        "created_at": referral.created_at,
        "updated_at": referral.updated_at,
        "next_allowed_transitions": next_allowed_transitions(referral.status),
    }


@router.post("/{referral_id}/transition", response_model=ReferralTransitionResponseSchema, summary="Transition a referral lifecycle state")
async def transition_referral_endpoint(
    referral_id: uuid.UUID,
    payload: ReferralTransitionRequestSchema,
    db: AsyncSession = Depends(get_db_session),
) -> ReferralTransitionResponseSchema:
    try:
        referral, transition, previous_status, _ = await transition_referral(
            db, referral_id, **payload.model_dump()
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ReferralLifecycleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await db.refresh(referral)
    return ReferralTransitionResponseSchema(
        referral=referral,
        previous_status=previous_status,
        current_status=referral.status,
        transition=transition,
        next_allowed_transitions=next_allowed_transitions(referral.status),
    )


@router.get("/{referral_id}/history", response_model=list[ReferralTransitionReadSchema], summary="Get referral transition history")
async def referral_history(referral_id: uuid.UUID, db: AsyncSession = Depends(get_db_session)) -> list[ReferralTransition]:
    if await db.get(Referral, referral_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Referral not found")
    return list((await db.scalars(
        select(ReferralTransition)
        .where(ReferralTransition.referral_id == referral_id)
        .order_by(ReferralTransition.occurred_at.asc(), ReferralTransition.id.asc())
    )).all())
