"""Visit lifecycle service.

The visit is the umbrella entity for a single ASHA/ANM home encounter. It
records who visited which patient, what was observed, and what was decided.
Decisions are deliberately delegated to the existing ``FollowUp``,
``Referral``, and ``FollowUpTask`` services — this module must never invent
parallel lifecycles.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.follow_up import FollowUp, FollowUpTask
from app.db.models.patient import Patient
from app.db.models.referral import Referral
from app.db.models.visit import (
    Visit,
    VisitSymptom,
    VisitTimelineEvent,
    VisitVitals,
    _is_valid_outcome,
)
from app.services.ai_triage import assess_symptom_triage
from app.services.follow_up_service import (
    FollowUpLifecycleError,
    create_follow_up,
    ensure_task,
    transition_follow_up,
)
from app.services.referral_lifecycle_service import (
    ReferralLifecycleError,
    create_referral_event,
    transition_referral,
)
from app.services.referral_service import recommend_facilities
from app.schemas.referral import ReferralRecommendationRequestSchema


_VISIT_OUTCOMES = ("COMPLETED", "FOLLOW_UP_REQUIRED", "REFERRAL_REQUIRED", "ESCALATION_REQUIRED")

_VISIT_TYPES = frozenset(
    {
        "general follow-up",
        "pregnancy / maternal health",
        "child health",
        "elderly care",
        "post-discharge",
        "medication/treatment follow-up",
        "referral follow-up",
    }
)

# ``HOME`` was the historical name in the offline sync envelope. Accept it
# as a synonym so older field clients keep working without forcing an
# upgrade before the demo.
_VISIT_TYPE_ALIASES = {"HOME": "general follow-up"}

_ALLOWED_ROLES = frozenset({"ASHA", "ANM", "DOCTOR", "NURSE", "SYSTEM", "FACILITY", "ADMIN"})


class VisitLifecycleError(ValueError):
    """Raised when a visit transition request is invalid."""


class VisitValidationError(ValueError):
    """Raised when a visit payload is missing required fields."""


@dataclass
class VisitCompletion:
    visit_id: uuid.UUID
    outcome: str
    follow_up_id: uuid.UUID | None
    referral_id: uuid.UUID | None
    follow_up_task_id: uuid.UUID | None
    risk_level: str
    risk_score: int


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _validate_actor(actor_id: str, actor_role: str) -> None:
    if not actor_id or not actor_id.strip():
        raise VisitValidationError("actor_id is required")
    if actor_role not in _ALLOWED_ROLES:
        raise VisitValidationError(
            f"actor_role must be one of: {', '.join(sorted(_ALLOWED_ROLES))}"
        )


def validate_visit_type(visit_type: str) -> str:
    if visit_type in _VISIT_TYPES:
        return visit_type
    if visit_type in _VISIT_TYPE_ALIASES:
        return _VISIT_TYPE_ALIASES[visit_type]
    # The architecture must allow future checklist types. Reject only
    # obvious junk (empty / non-string) so the typed-sync envelope remains
    # forward-compatible.
    if not visit_type or not isinstance(visit_type, str):
        raise VisitValidationError("visit_type is required")
    return visit_type


async def _record_event(
    session: AsyncSession,
    *,
    visit: Visit,
    patient_id: uuid.UUID,
    event_type: str,
    actor_id: str,
    actor_role: str,
    summary: str,
    details: dict[str, Any] | None = None,
) -> VisitTimelineEvent:
    event = VisitTimelineEvent(
        visit_id=visit.id,
        patient_id=patient_id,
        event_type=event_type,
        actor_id=actor_id,
        actor_role=actor_role,
        summary=summary,
        details=details or {},
    )
    session.add(event)
    await session.flush()
    return event


def compute_risk(symptoms: Iterable[str], vitals: dict[str, Any] | None) -> dict[str, Any]:
    """Delegate to the deterministic safety engine; never downgrade RED.

    The same function powers the offline triage endpoint, so the visit's
    risk_level is computed with the identical rules the field app uses
    while online. We do not consult any AI here; this is explainable
    rules-based prioritisation.
    """

    vitals = vitals or {}
    return assess_symptom_triage(list(symptoms), vitals)


async def start_visit(
    session: AsyncSession,
    *,
    patient_local_uuid: str,
    actor_id: str,
    actor_role: str,
    visit_type: str,
    local_uuid: str | None = None,
    phc_id: str | None = None,
) -> Visit:
    """Create a new visit in the ``IN_PROGRESS`` state (no completion yet)."""

    _validate_actor(actor_id, actor_role)
    validate_visit_type(visit_type)
    if not patient_local_uuid or not patient_local_uuid.strip():
        raise VisitValidationError("patient_local_uuid is required")
    patient: Patient | None = None
    try:
        patient_uuid = uuid.UUID(patient_local_uuid)
    except (TypeError, ValueError):
        patient_uuid = None
    if patient_uuid is not None:
        patient = await session.scalar(
            select(Patient).where(
                (Patient.offline_client_uuid == patient_uuid) | (Patient.id == patient_uuid)
            )
        )
    if patient is None:
        raise VisitValidationError("Patient not found for the supplied local uuid")
    visit = Visit(
        patient_id=patient.id,
        actor_id=actor_id,
        actor_role=actor_role,
        phc_id=phc_id,
        visit_type=visit_type,
        local_uuid=local_uuid,
        outcome=None,
    )
    session.add(visit)
    await session.flush()
    await _record_event(
        session,
        visit=visit,
        patient_id=patient.id,
        event_type="VISIT_STARTED",
        actor_id=actor_id,
        actor_role=actor_role,
        summary=f"{actor_role} {actor_id} started a {visit_type} visit.",
        details={"visit_type": visit_type, "local_uuid": local_uuid},
    )
    return visit


async def record_vitals(
    session: AsyncSession,
    *,
    visit_id: uuid.UUID,
    actor_id: str,
    actor_role: str,
    vitals: dict[str, Any],
) -> VisitVitals:
    _validate_actor(actor_id, actor_role)
    visit = await session.get(Visit, visit_id)
    if visit is None:
        raise VisitValidationError("Visit not found")
    if visit.completed_at is not None:
        raise VisitLifecycleError("Visit is already completed; vitals cannot change")
    existing = await session.scalar(select(VisitVitals).where(VisitVitals.visit_id == visit.id))
    if existing is None:
        existing = VisitVitals(visit_id=visit.id)
        session.add(existing)
    for field in (
        "temperature_c",
        "pulse_bpm",
        "respiratory_rate",
        "systolic_bp",
        "diastolic_bp",
        "spo2",
        "weight_kg",
    ):
        value = vitals.get(field)
        if value is None or value == "":
            continue
        try:
            if field in {"pulse_bpm", "respiratory_rate", "systolic_bp", "diastolic_bp"}:
                setattr(existing, field, int(value))
            else:
                setattr(existing, field, float(value))
        except (TypeError, ValueError) as exc:
            raise VisitValidationError(f"vitals.{field} must be numeric") from exc
    await session.flush()
    await _record_event(
        session,
        visit=visit,
        patient_id=visit.patient_id,
        event_type="VITALS_RECORDED",
        actor_id=actor_id,
        actor_role=actor_role,
        summary="Visit vitals recorded.",
        details={"vitals": vitals},
    )
    return existing


async def record_symptoms(
    session: AsyncSession,
    *,
    visit_id: uuid.UUID,
    actor_id: str,
    actor_role: str,
    symptoms: list[str],
) -> list[VisitSymptom]:
    _validate_actor(actor_id, actor_role)
    visit = await session.get(Visit, visit_id)
    if visit is None:
        raise VisitValidationError("Visit not found")
    if visit.completed_at is not None:
        raise VisitLifecycleError("Visit is already completed; symptoms cannot change")
    cleaned: list[VisitSymptom] = []
    for entry in symptoms or []:
        if isinstance(entry, str):
            label = entry.strip()
            severity = "MODERATE"
        elif isinstance(entry, dict):
            label = str(entry.get("symptom", "")).strip()
            severity = str(entry.get("severity", "MODERATE")).upper() or "MODERATE"
        else:
            continue
        if not label:
            continue
        record = VisitSymptom(visit_id=visit.id, symptom=label, severity=severity)
        session.add(record)
        cleaned.append(record)
    await session.flush()
    if cleaned:
        await _record_event(
            session,
            visit=visit,
            patient_id=visit.patient_id,
            event_type="VITALS_RECORDED",
            actor_id=actor_id,
            actor_role=actor_role,
            summary=f"{len(cleaned)} symptom(s) recorded during visit.",
            details={"symptoms": [{"symptom": row.symptom, "severity": row.severity} for row in cleaned]},
        )
    return cleaned


async def complete_visit(
    session: AsyncSession,
    *,
    visit_id: uuid.UUID,
    actor_id: str,
    actor_role: str,
    outcome: str,
    findings: str | None = None,
    next_visit_date: datetime | None = None,
    follow_up_payload: dict[str, Any] | None = None,
    referral_payload: dict[str, Any] | None = None,
    task_payload: dict[str, Any] | None = None,
) -> VisitCompletion:
    """Finalise a visit and link the outcome to follow-up / referral / task rows.

    Behaviour:
      * ``FOLLOW_UP_REQUIRED`` — creates a ``FollowUp`` (and, when high risk, a
        ``FollowUpTask``).
      * ``REFERRAL_REQUIRED`` — creates a ``Referral`` and records the
        ``REFERRAL_CREATED`` event.
      * ``ESCALATION_REQUIRED`` — creates an urgent follow-up + task and
        flags the visit as escalated.
      * ``COMPLETED`` — only writes a closing event.
    RED risk cannot be downgraded: if the deterministic engine reports RED we
    force ``ESCALATION_REQUIRED`` and emit a notification of the override.
    """

    _validate_actor(actor_id, actor_role)
    if not _is_valid_outcome(outcome):
        raise VisitValidationError(
            f"outcome must be one of: {', '.join(sorted(_VISIT_OUTCOMES))}"
        )
    visit = await session.scalar(
        select(Visit).where(Visit.id == visit_id).with_for_update()
    )
    if visit is None:
        raise VisitValidationError("Visit not found")
    if visit.completed_at is not None:
        raise VisitLifecycleError("Visit is already completed")
    symptoms = list(
        (
            await session.scalars(
                select(VisitSymptom.symptom).where(VisitSymptom.visit_id == visit.id)
            )
        ).all()
    )
    vitals_row = await session.scalar(
        select(VisitVitals).where(VisitVitals.visit_id == visit.id)
    )
    vitals_payload: dict[str, Any] = {}
    if vitals_row is not None:
        for attr, key in (
            ("temperature_c", "temperature_c"),
            ("pulse_bpm", "pulse_bpm"),
            ("respiratory_rate", "respiratory_rate"),
            ("systolic_bp", "systolic_bp"),
            ("diastolic_bp", "diastolic_bp"),
            ("spo2", "spo2"),
            ("weight_kg", "weight_kg"),
        ):
            value = getattr(vitals_row, attr)
            if value is not None:
                vitals_payload[key] = value
    risk = compute_risk(symptoms, vitals_payload)
    risk_level = str(risk.get("triage_level", "GREEN")).upper()
    risk_score = int(risk.get("risk_score", 0))
    safety_override_note: str | None = None
    if risk_level == "RED" and outcome in {"COMPLETED", "FOLLOW_UP_REQUIRED"}:
        # Safety engine wins. RED cannot be silently closed by an ASHA
        # outcome decision; the visit must escalate.
        outcome = "ESCALATION_REQUIRED"
        safety_override_note = (
            "Safety engine reported RED; visit outcome was automatically escalated to "
            "ESCALATION_REQUIRED."
        )

    follow_up_id: uuid.UUID | None = None
    referral_id: uuid.UUID | None = None
    follow_up_task_id: uuid.UUID | None = None
    follow_up_local_uuid: str | None = None
    referral_local_uuid: str | None = None
    follow_up_payload = follow_up_payload or {}
    referral_payload = referral_payload or {}
    task_payload = task_payload or {}

    if outcome in {"FOLLOW_UP_REQUIRED", "ESCALATION_REQUIRED"}:
        due_at_raw = follow_up_payload.get("due_at")
        if not due_at_raw:
            due_at = (next_visit_date or datetime.now(timezone.utc) + timedelta(days=1))
        else:
            try:
                due_at = datetime.fromisoformat(str(due_at_raw).replace("Z", "+00:00"))
            except (TypeError, ValueError) as exc:
                raise VisitValidationError("follow_up_payload.due_at is not a valid ISO-8601 timestamp") from exc
        priority = "URGENT" if outcome == "ESCALATION_REQUIRED" else str(follow_up_payload.get("priority", "ROUTINE")).upper()
        high_risk = bool(follow_up_payload.get("high_risk", risk_level == "RED"))
        follow_up_local_uuid = follow_up_payload.get("local_uuid")
        follow_up, _duplicate = await create_follow_up(
            session,
            patient_id=visit.patient_id,
            follow_up_type=str(follow_up_payload.get("follow_up_type", visit.visit_type)),
            due_at=due_at,
            priority=priority,
            high_risk=high_risk,
            notes=findings or follow_up_payload.get("notes"),
            source_reference=f"visit:{visit.id}",
            local_uuid=follow_up_local_uuid,
        )
        follow_up_id = follow_up.id
        # Advance the new follow-up into DUE so it shows up in the worker's
        # queue. This is a real lifecycle transition (idempotent) and uses
        # the existing transition machinery.
        try:
            await transition_follow_up(
                session,
                follow_up_id=follow_up.id,
                target_status="DUE",
                actor_id=actor_id,
                actor_role=actor_role,
                reason="Visit outcome",
                notes=findings,
                idempotency_key=f"visit:{visit.id}:follow_up:{follow_up.id}:DUE",
            )
        except FollowUpLifecycleError:
            # The follow-up may already be DUE; ignore the duplicate.
            pass
        if outcome == "ESCALATION_REQUIRED" or high_risk:
            task, _created = await ensure_task(
                session,
                follow_up,
                actor_id=actor_id,
                actor_role=actor_role,
                escalation=True,
            )
            follow_up_task_id = task.id

    if outcome == "REFERRAL_REQUIRED" or (outcome == "ESCALATION_REQUIRED" and not referral_id):
        target_facility_id = referral_payload.get("target_facility_id") or "PHC-BEL-01"
        target_facility_name = referral_payload.get("target_facility_name")
        if not target_facility_name:
            try:
                recommendations = recommend_facilities(
                    ReferralRecommendationRequestSchema(
                        triage_level=risk_level,
                        required_capabilities=referral_payload.get("required_capabilities", ["BASIC_EMERGENCY"]),
                        vitals=vitals_payload,
                        high_risk_respiratory=bool(risk.get("high_risk_respiratory", False)),
                    )
                )
            except Exception:  # pragma: no cover — defensive: never block a referral on the recommender
                recommendations = []
            target_facility_name = (
                recommendations[0].facility_name if recommendations else referral_payload.get("target_facility_name", "PHC Belthangady")
            )
            target_facility_id = recommendations[0].facility_id if recommendations else target_facility_id
        referral = Referral(
            patient_id=visit.patient_id,
            origin_phc_id=visit.phc_id or "PHC-LOCAL",
            target_facility_id=target_facility_id,
            target_facility_name=target_facility_name,
            target_facility_type=referral_payload.get("target_facility_type", "PHC"),
            referral_priority=("URGENT" if outcome == "ESCALATION_REQUIRED" else str(referral_payload.get("referral_priority", "ROUTINE")).upper()),
            reason_for_referral=referral_payload.get("reason_for_referral") or findings or "Visit outcome requires referral",
            specialty_service=referral_payload.get("specialty_service"),
            required_capabilities=list(referral_payload.get("required_capabilities", [])) or ["BASIC_EMERGENCY"],
            status="CREATED",
            local_uuid=referral_payload.get("local_uuid"),
        )
        session.add(referral)
        await session.flush()
        referral_id = referral.referral_id
        referral_local_uuid = referral.local_uuid
        await create_referral_event(
            session,
            referral,
            actor_id=actor_id,
            actor_role=actor_role,
        )
        # Inform the patient about the referral so the lifecycle is not stuck
        # at CREATED. This mirrors how ASHAs hand a referral to the household.
        try:
            await transition_referral(
                session,
                referral_id=referral.referral_id,
                target_status="PATIENT_INFORMED",
                actor_id=actor_id,
                actor_role=actor_role,
                reason="Household informed during ASHA visit",
                notes=findings,
                idempotency_key=f"visit:{visit.id}:referral:{referral.referral_id}:PATIENT_INFORMED",
            )
        except ReferralLifecycleError:
            pass

    if task_payload and outcome != "ESCALATION_REQUIRED":
        # Optional explicit task creation tied to a follow-up. Re-uses the
        # existing FollowUpTask model. Caller must supply a follow_up_id.
        explicit_follow_up_id = task_payload.get("follow_up_id")
        explicit_due_at_raw = task_payload.get("due_at")
        if explicit_follow_up_id and explicit_due_at_raw:
            try:
                explicit_follow_up = await session.get(FollowUp, uuid.UUID(str(explicit_follow_up_id)))
            except (TypeError, ValueError):
                explicit_follow_up = None
            if explicit_follow_up is not None:
                try:
                    explicit_due_at = datetime.fromisoformat(str(explicit_due_at_raw).replace("Z", "+00:00"))
                except ValueError:
                    explicit_due_at = datetime.now(timezone.utc)
                task_row = FollowUpTask(
                    follow_up_id=explicit_follow_up.id,
                    patient_id=explicit_follow_up.patient_id,
                    task_type=str(task_payload.get("task_type", "HOME_VISIT")),
                    status="PENDING",
                    priority=str(task_payload.get("priority", "ROUTINE")).upper(),
                    assigned_worker_id=actor_id,
                    due_at=explicit_due_at,
                    details={"source": "visit", "visit_id": str(visit.id), "notes": task_payload.get("notes")},
                )
                session.add(task_row)
                await session.flush()
                follow_up_task_id = task_row.id

    visit.completed_at = datetime.now(timezone.utc)
    visit.outcome = outcome
    visit.risk_level = risk_level
    visit.risk_score = risk_score
    visit.findings = findings
    visit.next_visit_date = next_visit_date
    visit.follow_up_id = follow_up_id
    visit.referral_id = referral_id
    visit.follow_up_task_id = follow_up_task_id
    visit.escalated = outcome == "ESCALATION_REQUIRED"
    visit.details = {
        "safety_override_note": safety_override_note,
        "high_risk_respiratory": bool(risk.get("high_risk_respiratory", False)),
        "high_risk_maternal": bool(risk.get("high_risk_maternal", False)),
        "maternal_conditions": list(risk.get("maternal_conditions", [])),
        "missing_vitals": list(risk.get("missing_vitals", [])),
        "follow_up_local_uuid": follow_up_local_uuid,
        "referral_local_uuid": referral_local_uuid,
    }
    await session.flush()
    await _record_event(
        session,
        visit=visit,
        patient_id=visit.patient_id,
        event_type="VISIT_COMPLETED",
        actor_id=actor_id,
        actor_role=actor_role,
        summary=f"Visit completed with outcome {outcome} (risk: {risk_level}).",
        details={
            "outcome": outcome,
            "risk_level": risk_level,
            "risk_score": risk_score,
            "follow_up_id": str(follow_up_id) if follow_up_id else None,
            "referral_id": str(referral_id) if referral_id else None,
            "follow_up_task_id": str(follow_up_task_id) if follow_up_task_id else None,
            "safety_override_note": safety_override_note,
        },
    )
    if follow_up_id is not None:
        await _record_event(
            session,
            visit=visit,
            patient_id=visit.patient_id,
            event_type="FOLLOW_UP_CREATED",
            actor_id=actor_id,
            actor_role=actor_role,
            summary="Follow-up scheduled from visit outcome.",
            details={"follow_up_id": str(follow_up_id), "outcome": outcome},
        )
    if referral_id is not None:
        await _record_event(
            session,
            visit=visit,
            patient_id=visit.patient_id,
            event_type="REFERRAL_CREATED",
            actor_id=actor_id,
            actor_role=actor_role,
            summary="Referral created from visit outcome.",
            details={"referral_id": str(referral_id), "outcome": outcome},
        )
    if follow_up_task_id is not None:
        await _record_event(
            session,
            visit=visit,
            patient_id=visit.patient_id,
            event_type="TASK_CREATED",
            actor_id=actor_id,
            actor_role=actor_role,
            summary="Visit outcome generated a follow-up task.",
            details={"task_id": str(follow_up_task_id), "outcome": outcome},
        )
    if outcome == "ESCALATION_REQUIRED":
        await _record_event(
            session,
            visit=visit,
            patient_id=visit.patient_id,
            event_type="ESCALATION_CREATED",
            actor_id=actor_id,
            actor_role=actor_role,
            summary="Visit escalated to urgent care.",
            details={"risk_level": risk_level, "risk_score": risk_score},
        )
    return VisitCompletion(
        visit_id=visit.id,
        outcome=outcome,
        follow_up_id=follow_up_id,
        referral_id=referral_id,
        follow_up_task_id=follow_up_task_id,
        risk_level=risk_level,
        risk_score=risk_score,
    )


async def get_visit(session: AsyncSession, visit_id: uuid.UUID) -> Visit | None:
    return await session.get(Visit, visit_id)


async def get_visit_by_local_uuid(session: AsyncSession, local_uuid: str) -> Visit | None:
    return await session.scalar(select(Visit).where(Visit.local_uuid == local_uuid))


async def list_visits_for_patient(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    limit: int = 50,
) -> list[Visit]:
    return list(
        (
            await session.scalars(
                select(Visit)
                .where(Visit.patient_id == patient_id)
                .order_by(Visit.started_at.desc())
                .limit(limit)
            )
        ).all()
    )


async def list_visits_for_worker(
    session: AsyncSession,
    *,
    actor_id: str,
    since: datetime | None = None,
    limit: int = 100,
) -> list[Visit]:
    query = select(Visit).where(Visit.actor_id == actor_id)
    if since is not None:
        query = query.where(Visit.started_at >= _as_utc(since))
    return list((await session.scalars(query.order_by(Visit.started_at.desc()).limit(limit))).all())


async def list_today_visits_for_worker(
    session: AsyncSession,
    *,
    actor_id: str,
    now: datetime | None = None,
) -> list[Visit]:
    moment = _as_utc(now or datetime.now(timezone.utc))
    start_of_day = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    return list(
        (
            await session.scalars(
                select(Visit)
                .where(Visit.actor_id == actor_id, Visit.started_at >= start_of_day)
                .order_by(Visit.started_at.desc())
            )
        ).all()
    )
