"""Follow-up lifecycle API."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.follow_up import FollowUp, FollowUpTask, FollowUpTransition
from app.db.session import get_db_session
from app.schemas.follow_up import (
    FollowUpCreateSchema, FollowUpDueResponseSchema, FollowUpReadSchema,
    FollowUpTransitionReadSchema, FollowUpTransitionRequestSchema, FollowUpTransitionResponseSchema,
)
from app.services.follow_up_service import FollowUpLifecycleError, create_follow_up, next_allowed, refresh_due_statuses, transition_follow_up

router = APIRouter(tags=["Follow-ups"])


async def _read(session: AsyncSession, follow_up: FollowUp) -> FollowUpReadSchema:
    task = await session.scalar(select(FollowUpTask).where(FollowUpTask.follow_up_id == follow_up.id))
    return FollowUpReadSchema(
        **{field: getattr(follow_up, field) for field in FollowUpCreateSchema.model_fields},
        id=follow_up.id, status=follow_up.status, created_at=follow_up.created_at, updated_at=follow_up.updated_at,
        linked_task_id=task.id if task else None, next_allowed_transitions=next_allowed(follow_up.status),
    )


@router.post("/follow-ups", response_model=FollowUpReadSchema, status_code=status.HTTP_201_CREATED)
async def create(payload: FollowUpCreateSchema, db: AsyncSession = Depends(get_db_session)):
    try:
        follow_up, duplicate = await create_follow_up(db, **payload.model_dump())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.refresh(follow_up)
    return await _read(db, follow_up)


@router.get("/follow-ups/due", response_model=FollowUpDueResponseSchema)
async def due_follow_ups(db: AsyncSession = Depends(get_db_session)):
    await refresh_due_statuses(db, datetime.now(timezone.utc))
    due = (await db.scalars(select(FollowUp).where(FollowUp.status == "DUE").order_by(FollowUp.due_at.asc()))).all()
    overdue = (await db.scalars(select(FollowUp).where(FollowUp.status == "MISSED").order_by(FollowUp.due_at.asc()))).all()
    return FollowUpDueResponseSchema(due=[await _read(db, row) for row in due], overdue=[await _read(db, row) for row in overdue])


@router.get("/follow-ups/{follow_up_id}", response_model=FollowUpReadSchema)
async def get(follow_up_id: uuid.UUID, db: AsyncSession = Depends(get_db_session)):
    follow_up = await db.get(FollowUp, follow_up_id)
    if follow_up is None:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return await _read(db, follow_up)


@router.get("/patients/{patient_id}/follow-ups", response_model=list[FollowUpReadSchema])
async def patient_follow_ups(patient_id: uuid.UUID, db: AsyncSession = Depends(get_db_session)):
    rows = (await db.scalars(select(FollowUp).where(FollowUp.patient_id == patient_id).order_by(FollowUp.due_at.asc()))).all()
    return [await _read(db, row) for row in rows]


@router.post("/follow-ups/{follow_up_id}/transition", response_model=FollowUpTransitionResponseSchema)
async def transition(follow_up_id: uuid.UUID, payload: FollowUpTransitionRequestSchema, db: AsyncSession = Depends(get_db_session)):
    try:
        follow_up, history, previous, _ = await transition_follow_up(db, follow_up_id, **payload.model_dump())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FollowUpLifecycleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.refresh(follow_up)
    return FollowUpTransitionResponseSchema(follow_up=await _read(db, follow_up), previous_status=previous, current_status=follow_up.status, transition=history, next_allowed_transitions=next_allowed(follow_up.status))


@router.get("/follow-ups/{follow_up_id}/history", response_model=list[FollowUpTransitionReadSchema])
async def history(follow_up_id: uuid.UUID, db: AsyncSession = Depends(get_db_session)):
    if await db.get(FollowUp, follow_up_id) is None:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return list((await db.scalars(select(FollowUpTransition).where(FollowUpTransition.follow_up_id == follow_up_id).order_by(FollowUpTransition.occurred_at.asc(), FollowUpTransition.id.asc()))).all())


