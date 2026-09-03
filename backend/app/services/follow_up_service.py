"""Authoritative follow-up lifecycle and deterministic due processing."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models.follow_up import FollowUp, FollowUpTask, FollowUpTimelineEvent, FollowUpTransition
from app.db.models.patient import Patient

_TRANSITIONS = {
    "SCHEDULED": {"DUE", "CANCELLED"},
    "DUE": {"IN_PROGRESS", "RESCHEDULED", "MISSED", "CANCELLED"},
    "IN_PROGRESS": {"COMPLETED", "RESCHEDULED", "MISSED"},
    "RESCHEDULED": {"DUE", "CANCELLED"},
    "COMPLETED": set(),
    "MISSED": set(),
    "CANCELLED": set(),
}


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class FollowUpLifecycleError(ValueError):
    pass


def next_allowed(status: str) -> list[str]:
    return sorted(_TRANSITIONS.get(status, set()))


async def _event(session, follow_up, event_type, actor_id, actor_role, *, task_id=None, details=None):
    session.add(FollowUpTimelineEvent(
        follow_up_id=follow_up.id,
        patient_id=follow_up.patient_id,
        task_id=task_id,
        event_type=event_type,
        actor_id=actor_id,
        actor_role=actor_role,
        details=details or {"follow_up_id": str(follow_up.id)},
    ))


async def create_follow_up(session: AsyncSession, *, patient_id, follow_up_type, due_at, priority="ROUTINE", high_risk=False, notes=None, source_reference=None, local_uuid=None):
    if await session.get(Patient, patient_id) is None:
        raise LookupError("Patient not found")
    if source_reference:
        existing = await session.scalar(select(FollowUp).where(FollowUp.source_reference == source_reference))
        if existing:
            return existing, True
    follow_up = FollowUp(patient_id=patient_id, follow_up_type=follow_up_type, due_at=due_at, priority=priority, high_risk=high_risk, notes=notes, source_reference=source_reference, local_uuid=local_uuid)
    session.add(follow_up)
    await session.flush()
    await _event(session, follow_up, "FOLLOW_UP_CREATED", "SYSTEM", "SYSTEM", details={"follow_up_id": str(follow_up.id), "patient_id": str(patient_id)})
    await _event(session, follow_up, "FOLLOW_UP_SCHEDULED", "SYSTEM", "SYSTEM")
    return follow_up, False


async def transition_follow_up(session: AsyncSession, follow_up_id, target_status, actor_id, actor_role, reason=None, notes=None, idempotency_key=None):
    if not actor_id.strip() or not actor_role.strip():
        raise FollowUpLifecycleError("actor_id and actor_role are required")
    if not idempotency_key or not idempotency_key.strip():
        raise FollowUpLifecycleError("idempotency_key is required")
    existing_transition = await session.scalar(select(FollowUpTransition).where(FollowUpTransition.idempotency_key == idempotency_key))
    if existing_transition:
        if existing_transition.follow_up_id != follow_up_id:
            raise FollowUpLifecycleError("idempotency key belongs to another follow-up")
        follow_up = await session.get(FollowUp, follow_up_id)
        return follow_up, existing_transition, existing_transition.from_status, True
    follow_up = await session.scalar(select(FollowUp).where(FollowUp.id == follow_up_id).with_for_update())
    if follow_up is None:
        raise LookupError("Follow-up not found")
    if target_status not in _TRANSITIONS.get(follow_up.status, set()):
        raise FollowUpLifecycleError(f"Invalid follow-up transition: {follow_up.status} -> {target_status}")
    now = datetime.now(timezone.utc)
    transition = FollowUpTransition(follow_up_id=follow_up.id, from_status=follow_up.status, to_status=target_status, actor_id=actor_id, actor_role=actor_role, reason=reason, notes=notes, occurred_at=now, idempotency_key=idempotency_key)
    follow_up.status = target_status
    follow_up.updated_at = now
    session.add(transition)
    await session.flush()
    event_name = "FOLLOW_UP_STARTED" if target_status == "IN_PROGRESS" else f"FOLLOW_UP_{target_status}"
    await _event(session, follow_up, event_name, actor_id, actor_role, details={"follow_up_id": str(follow_up.id), "reason": reason, "notes": notes})
    if target_status in {"DUE", "MISSED"}:
        await ensure_task(session, follow_up, actor_id=actor_id, actor_role=actor_role, escalation=target_status == "MISSED" or (target_status == "DUE" and follow_up.high_risk))
    return follow_up, transition, transition.from_status, False


async def ensure_task(session, follow_up, *, actor_id, actor_role, escalation=False):
    task = await session.scalar(select(FollowUpTask).where(FollowUpTask.follow_up_id == follow_up.id))
    if task:
        return task, False
    task = FollowUpTask(follow_up_id=follow_up.id, patient_id=follow_up.patient_id, task_type="ESCALATION" if escalation else "HOME_VISIT", status="PENDING", priority="URGENT" if escalation or follow_up.high_risk else follow_up.priority, due_at=follow_up.due_at, details={"source": "follow_up", "follow_up_id": str(follow_up.id), "escalation": escalation})
    session.add(task)
    await session.flush()
    await _event(session, follow_up, "FOLLOW_UP_TASK_CREATED", actor_id, actor_role, task_id=task.id, details={"follow_up_id": str(follow_up.id), "task_id": str(task.id), "escalation": escalation})
    if escalation:
        await _event(session, follow_up, "FOLLOW_UP_ESCALATED", actor_id, actor_role, task_id=task.id, details={"follow_up_id": str(follow_up.id), "task_id": str(task.id)})
    return task, True


async def refresh_due_statuses(session: AsyncSession, now=None):
    now = now or datetime.now(timezone.utc)
    threshold = timedelta(hours=get_settings().follow_up_overdue_hours)
    rows = list((await session.scalars(select(FollowUp).where(FollowUp.status.in_(["SCHEDULED", "DUE"]), FollowUp.due_at <= now))).all())
    changed = []
    for follow_up in rows:
        if follow_up.status == "SCHEDULED":
            follow_up.status = "DUE"
            await _event(session, follow_up, "FOLLOW_UP_DUE", "SYSTEM", "SYSTEM")
            if _as_utc(follow_up.due_at) + threshold <= now:
                follow_up.status = "MISSED"
                await _event(session, follow_up, "FOLLOW_UP_MISSED", "SYSTEM", "SYSTEM")
                await ensure_task(session, follow_up, actor_id="SYSTEM", actor_role="SYSTEM", escalation=True)
            else:
                await ensure_task(session, follow_up, actor_id="SYSTEM", actor_role="SYSTEM", escalation=follow_up.high_risk)
            changed.append(follow_up)
        elif follow_up.status == "DUE" and follow_up.due_at + threshold <= now:
            follow_up.status = "MISSED"
            await _event(session, follow_up, "FOLLOW_UP_MISSED", "SYSTEM", "SYSTEM")
            await ensure_task(session, follow_up, actor_id="SYSTEM", actor_role="SYSTEM", escalation=True)
            changed.append(follow_up)
    await session.flush()
    return changed
