"""FHIR-aligned aggregation of ARROH encounters into one patient timeline."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.care_prescription import CarePrescription
from app.db.models.follow_up import FollowUpTimelineEvent
from app.db.models.consultation import ConsultationTimelineEvent
from app.db.models.case_taking import CaseSessionRow
from app.db.models.patient import Patient
from app.db.models.referral import Referral
from app.db.models.referral_transition import ReferralTimelineEvent
from app.db.models.triage import TriageLog
from app.db.models.visit import Visit, VisitTimelineEvent
from app.schemas.timeline import PatientTimelineResponseSchema, TimelineEventSchema
from app.services.queue_manager import get_claim_for_patient


def _as_utc(value: datetime) -> datetime:
    """Normalise naive / aware datetimes so the timeline sort is always safe.

    SQLite returns naive datetimes while PostgreSQL returns tz-aware values.
    Mixing them in a single ``sorted(...)`` raises ``TypeError``. Coercing
    everything to a UTC-aware datetime makes the response deterministic and
    keeps the sort stable.
    """

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def build_patient_timeline(session: AsyncSession, patient_id: uuid.UUID) -> PatientTimelineResponseSchema | None:
    """Aggregate durable and active care events with graceful optional-data handling."""

    patient = await session.get(Patient, patient_id)
    if patient is None:
        return None
    events: list[TimelineEventSchema] = [
        TimelineEventSchema(
            event_id=f"registration-{patient.id}", resource_type="Patient", event_type="REGISTRATION", occurred_at=_as_utc(patient.created_at),
            summary="Patient registered and ABDM identity recorded.",
            details={"abha_id": patient.abha_id, "name": patient.name, "phc_id": patient.current_phc_id, "district": patient.district},
        )
    ]
    triage_logs = (await session.scalars(select(TriageLog).where(TriageLog.patient_id == patient_id))).all()
    for log in triage_logs:
        event_type = "VOICE_INTAKE" if log.source == "voice" else "TRIAGE_ASSESSMENT"
        events.append(TimelineEventSchema(
            event_id=str(log.id), resource_type="Observation", event_type=event_type, occurred_at=_as_utc(log.observed_at),
            summary=f"{log.source} triage recorded as {log.triage_status.value}.",
            details={"vitals": log.vitals or {}, "symptoms": log.symptoms or [], "transcript": log.raw_transcript, "assessment": log.assessment or {}},
        ))
    case_sessions = (await session.scalars(select(CaseSessionRow).where(CaseSessionRow.patient_id == patient_id))).all()
    for case_session in case_sessions:
        occurred_at = _as_utc(case_session.completed_at) if case_session.completed_at else _as_utc(case_session.started_at)
        events.append(TimelineEventSchema(
            event_id=f"case-{case_session.case_id}", resource_type="Encounter", event_type="CASE_TAKING", occurred_at=occurred_at,
            summary=f"AI-assisted case-taking session ({case_session.language}) → {case_session.triage_result.get('triage_level', 'UNKNOWN') if case_session.triage_result else 'pending'}",
            details={
                "case_id": str(case_session.case_id),
                "ai_provider": case_session.ai_provider,
                "language": case_session.language,
                "safety_flags": case_session.safety_flags,
                "completed": case_session.completed,
            },
        ))
    prescriptions = (await session.scalars(select(CarePrescription).where(CarePrescription.patient_id == patient_id))).all()
    for prescription in prescriptions:
        events.append(TimelineEventSchema(
            event_id=str(prescription.prescription_id), resource_type="MedicationRequest", event_type="PRESCRIPTION", occurred_at=_as_utc(prescription.created_at),
            summary=f"Prescription issued for {prescription.diagnosis}.",
            details={"doctor_id": prescription.doctor_id, "medications": prescription.medications, "audio_script": prescription.audio_prescription_script},
        ))
        events.append(TimelineEventSchema(
            event_id=f"followup-{prescription.prescription_id}", resource_type="Task", event_type="FOLLOW_UP_REMINDER", occurred_at=_as_utc(prescription.follow_up_date),
            summary=f"ASHA follow-up is {prescription.follow_up_status.lower()}.",
            details={"status": prescription.follow_up_status, "prescription_id": str(prescription.prescription_id)},
        ))
    referrals = (await session.scalars(select(Referral).where(Referral.patient_id == patient_id))).all()
    for referral in referrals:
        events.append(TimelineEventSchema(
            event_id=str(referral.referral_id), resource_type="ServiceRequest", event_type="REFERRAL", occurred_at=_as_utc(referral.created_at),
            summary=f"Referral to {referral.target_facility_name} is {referral.status.lower()}.",
            details={"priority": referral.referral_priority, "reason": referral.reason_for_referral, "destination": referral.target_facility_name},
        ))
    referral_events = (await session.scalars(
        select(ReferralTimelineEvent)
        .join(Referral, Referral.referral_id == ReferralTimelineEvent.referral_id)
        .where(Referral.patient_id == patient_id)
    )).all()
    for event in referral_events:
        events.append(TimelineEventSchema(
            event_id=f"referral-event-{event.id}",
            resource_type="ServiceRequest",
            event_type=event.event_type,
            occurred_at=_as_utc(event.occurred_at),
            summary=event.summary,
            details={
                **event.details,
                "referral_id": str(event.referral_id),
                "actor_id": event.actor_id,
                "actor_role": event.actor_role,
            },
        ))
    follow_up_events = (await session.scalars(
        select(FollowUpTimelineEvent).where(FollowUpTimelineEvent.patient_id == patient_id)
    )).all()
    visits = (await session.scalars(
        select(Visit).where(Visit.patient_id == patient_id)
    )).all()
    for visit in visits:
        events.append(TimelineEventSchema(
            event_id=f"visit-started-{visit.id}",
            resource_type="Encounter",
            event_type="VISIT_STARTED",
            occurred_at=_as_utc(visit.started_at),
            summary=f"{visit.actor_role} {visit.actor_id} started a {visit.visit_type} visit.",
            details={
                "visit_id": str(visit.id),
                "visit_type": visit.visit_type,
                "actor_id": visit.actor_id,
                "actor_role": visit.actor_role,
            },
        ))
        if visit.completed_at is not None:
            events.append(TimelineEventSchema(
                event_id=f"visit-completed-{visit.id}",
                resource_type="Encounter",
                event_type="VISIT_COMPLETED",
                occurred_at=_as_utc(visit.completed_at),
                summary=f"Home visit ({visit.visit_type}) completed as {visit.outcome or 'PENDING'} (risk: {visit.risk_level}).",
                details={
                    "visit_id": str(visit.id),
                    "visit_type": visit.visit_type,
                    "outcome": visit.outcome,
                    "risk_level": visit.risk_level,
                    "risk_score": visit.risk_score,
                    "actor_id": visit.actor_id,
                    "actor_role": visit.actor_role,
                    "follow_up_id": str(visit.follow_up_id) if visit.follow_up_id else None,
                    "referral_id": str(visit.referral_id) if visit.referral_id else None,
                    "follow_up_task_id": str(visit.follow_up_task_id) if visit.follow_up_task_id else None,
                },
            ))
    visit_events = (await session.scalars(
        select(VisitTimelineEvent).where(VisitTimelineEvent.patient_id == patient_id)
    )).all()
    for event in visit_events:
        if event.event_type in {"VISIT_STARTED", "VISIT_COMPLETED"}:
            # The visit-level start/completion events are rendered above
            # from the canonical Visit rows; the granular timeline rows
            # add value only when they are supplemental (vitals, follow-up
            # creation, referral, task, escalation, etc.).
            continue
        events.append(TimelineEventSchema(
            event_id=f"visit-event-{event.id}",
            resource_type="Task",
            event_type=event.event_type,
            occurred_at=_as_utc(event.occurred_at),
            summary=event.summary,
            details={
                **event.details,
                "visit_id": str(event.visit_id),
                "actor_id": event.actor_id,
                "actor_role": event.actor_role,
            },
        ))
    for event in follow_up_events:
        events.append(TimelineEventSchema(
            event_id=f"follow-up-event-{event.id}",
            resource_type="Task",
            event_type=event.event_type,
            occurred_at=_as_utc(event.occurred_at),
            summary=f"Follow-up event: {event.event_type.lower().replace('_', ' ')}.",
            details={
                **event.details,
                "follow_up_id": str(event.follow_up_id),
                "patient_id": str(event.patient_id),
                "task_id": str(event.task_id) if event.task_id else None,
                "actor_id": event.actor_id,
                "actor_role": event.actor_role,
            },
        ))
    consultation_events = (await session.scalars(select(ConsultationTimelineEvent).where(ConsultationTimelineEvent.patient_id == patient_id))).all()
    for event in consultation_events:
        events.append(TimelineEventSchema(
            event_id=f"consultation-event-{event.id}", resource_type="Encounter", event_type=event.event_type,
            occurred_at=_as_utc(event.occurred_at), summary=f"Doctor event: {event.event_type.lower().replace('_', ' ')}.",
            details={**event.details, "consultation_id": str(event.consultation_id), "reference_id": event.reference_id, "actor_id": event.actor_id, "actor_role": event.actor_role},
        ))
    claim = await get_claim_for_patient(patient_id)
    if claim:
        claimed_at = datetime.fromisoformat(claim["claimed_at"])
        events.append(TimelineEventSchema(
            event_id=f"teleconsult-{patient_id}", resource_type="Encounter", event_type="TELECONSULT_CLAIM", occurred_at=_as_utc(claimed_at),
            summary=f"Teleconsultation claimed by doctor {claim['doctor_id']}.", details=claim,
        ))
    return PatientTimelineResponseSchema(patient_id=patient_id, events=sorted(events, key=lambda event: event.occurred_at))
