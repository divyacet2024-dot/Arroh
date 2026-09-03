"""Authoritative referral lifecycle transitions."""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.referral import Referral
from app.db.models.referral_transition import ReferralTimelineEvent, ReferralTransition


class ReferralLifecycleStatus(str, enum.Enum):
    CREATED = "CREATED"
    PATIENT_INFORMED = "PATIENT_INFORMED"
    SCHEDULED = "SCHEDULED"
    TRAVEL_STARTED = "TRAVEL_STARTED"
    REACHED = "REACHED"
    CONSULTATION_COMPLETED = "CONSULTATION_COMPLETED"
    DIAGNOSTIC_COMPLETED = "DIAGNOSTIC_COMPLETED"
    TREATMENT_STARTED = "TREATMENT_STARTED"
    FOLLOW_UP_REQUIRED = "FOLLOW_UP_REQUIRED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"


# Compatibility policy: legacy values remain stored exactly as received. They
# are readable by existing consumers but cannot enter the new lifecycle until
# an explicit migration decision is made; no status is silently remapped.
LEGACY_REFERRAL_STATUSES = frozenset({"INITIATED", "EN_ROUTE", "ACCEPTED"})
_ALLOWED_ROLES = frozenset({"ASHA", "DOCTOR", "NURSE", "SYSTEM", "FACILITY", "ADMIN"})

_TRANSITIONS: dict[str, frozenset[str]] = {
    "CREATED": frozenset({"PATIENT_INFORMED", "CANCELLED", "EXPIRED"}),
    "PATIENT_INFORMED": frozenset({"SCHEDULED", "CANCELLED", "EXPIRED"}),
    "SCHEDULED": frozenset({"TRAVEL_STARTED", "CANCELLED", "EXPIRED"}),
    "TRAVEL_STARTED": frozenset({"REACHED", "CANCELLED", "EXPIRED"}),
    "REACHED": frozenset({"CONSULTATION_COMPLETED", "CANCELLED", "EXPIRED"}),
    "CONSULTATION_COMPLETED": frozenset({"DIAGNOSTIC_COMPLETED", "CANCELLED", "EXPIRED"}),
    "DIAGNOSTIC_COMPLETED": frozenset({"TREATMENT_STARTED", "CANCELLED", "EXPIRED"}),
    "TREATMENT_STARTED": frozenset({"FOLLOW_UP_REQUIRED", "CANCELLED", "EXPIRED"}),
    "FOLLOW_UP_REQUIRED": frozenset({"COMPLETED", "CANCELLED", "EXPIRED"}),
    "COMPLETED": frozenset(),
    "CANCELLED": frozenset(),
    "EXPIRED": frozenset(),
}


class ReferralLifecycleError(ValueError):
    """Raised when a referral transition request is invalid."""


def next_allowed_transitions(status: str) -> list[str]:
    """Return server-owned next states; legacy statuses intentionally have none."""

    return sorted(_TRANSITIONS.get(status, frozenset()))


def _validate_actor(actor_id: str, actor_role: str) -> None:
    if not actor_id.strip():
        raise ReferralLifecycleError("actor_id is required")
    if actor_role not in _ALLOWED_ROLES:
        raise ReferralLifecycleError(f"actor_role must be one of: {', '.join(sorted(_ALLOWED_ROLES))}")


async def create_referral_event(
    session: AsyncSession,
    referral: Referral,
    *,
    actor_id: str,
    actor_role: str,
) -> ReferralTimelineEvent:
    """Record referral creation without adding a transition-history row."""

    _validate_actor(actor_id, actor_role)
    event = ReferralTimelineEvent(
        referral_id=referral.referral_id,
        event_type="REFERRAL_CREATED",
        actor_id=actor_id,
        actor_role=actor_role,
        summary=f"Referral created for {referral.target_facility_name}.",
        details={"status": referral.status, "patient_id": str(referral.patient_id)},
    )
    session.add(event)
    return event


async def transition_referral(
    session: AsyncSession,
    referral_id: uuid.UUID,
    target_status: str,
    actor_id: str,
    actor_role: str,
    reason: str | None = None,
    notes: str | None = None,
    idempotency_key: str | None = None,
) -> tuple[Referral, ReferralTransition, str, bool]:
    """Apply one validated, durable, idempotent referral transition."""

    _validate_actor(actor_id, actor_role)
    if target_status not in ReferralLifecycleStatus.__members__:
        raise ReferralLifecycleError(f"Unknown referral status: {target_status}")
    if not idempotency_key or not idempotency_key.strip():
        raise ReferralLifecycleError("idempotency_key is required")

    existing = await session.scalar(select(ReferralTransition).where(ReferralTransition.idempotency_key == idempotency_key))
    if existing is not None:
        if existing.referral_id != referral_id:
            raise ReferralLifecycleError("Idempotency key is already used for another referral")
        referral = await session.get(Referral, existing.referral_id)
        if referral is None:
            raise ReferralLifecycleError("Idempotency record references a missing referral")
        return referral, existing, existing.from_status, True

    referral = await session.scalar(select(Referral).where(Referral.referral_id == referral_id).with_for_update())
    if referral is None:
        raise LookupError("Referral not found")
    current_status = referral.status
    if target_status not in _TRANSITIONS.get(current_status, frozenset()):
        if current_status in LEGACY_REFERRAL_STATUSES:
            message = f"Legacy referral status {current_status} cannot transition; migrate it explicitly before using the new lifecycle"
        else:
            message = f"Invalid referral transition: {current_status} -> {target_status}"
        raise ReferralLifecycleError(message)

    occurred_at = datetime.now(timezone.utc)
    transition = ReferralTransition(
        referral_id=referral.referral_id,
        from_status=current_status,
        to_status=target_status,
        actor_id=actor_id,
        actor_role=actor_role,
        reason=reason,
        notes=notes,
        occurred_at=occurred_at,
        idempotency_key=idempotency_key,
    )
    referral.status = target_status
    referral.updated_at = occurred_at
    session.add(transition)
    session.add(ReferralTimelineEvent(
        referral_id=referral.referral_id,
        event_type=f"REFERRAL_{target_status}",
        actor_id=actor_id,
        actor_role=actor_role,
        summary=f"Referral status changed to {target_status.lower().replace('_', ' ')}.",
        details={"referral_id": str(referral.referral_id), "from_status": current_status, "to_status": target_status, "reason": reason, "notes": notes},
        occurred_at=occurred_at,
    ))
    await session.flush()
    return referral, transition, current_status, False
