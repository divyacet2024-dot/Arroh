"""Doctor-authoritative consultation workflow and discharge integration."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.consultation import Consultation, ConsultationTimelineEvent, DiagnosticRequest, DiagnosticResult, DischargePlan
from app.db.models.follow_up import FollowUp
from app.db.models.referral import Referral
from app.services.follow_up_service import create_follow_up
from app.services.referral_lifecycle_service import transition_referral
from app.db.models.patient import Patient


class ConsultationLifecycleError(ValueError):
    pass


async def create_consultation(session: AsyncSession, **data) -> Consultation:
    if await session.get(Patient, data['patient_id']) is None:
        raise LookupError('Patient not found')
    if data.get('referral_id') and await session.get(Referral, data['referral_id']) is None:
        raise LookupError('Referral not found')
    consultation = Consultation(**data)
    session.add(consultation)
    await session.flush()
    session.add(ConsultationTimelineEvent(consultation_id=consultation.id, patient_id=consultation.patient_id, event_type="CONSULTATION_STARTED", actor_id=consultation.doctor_id, actor_role="DOCTOR", reference_id=str(consultation.id), details={"referral_id": str(consultation.referral_id) if consultation.referral_id else None}))
    return consultation


async def complete_consultation(session: AsyncSession, consultation_id: uuid.UUID, doctor_id: str) -> Consultation:
    consultation = await session.scalar(select(Consultation).where(Consultation.id == consultation_id).with_for_update())
    if consultation is None:
        raise LookupError('Consultation not found')
    if consultation.status != 'STARTED':
        raise ConsultationLifecycleError(f'Invalid consultation transition: {consultation.status} -> COMPLETED')
    consultation.status = 'COMPLETED'
    consultation.completed_at = datetime.now(timezone.utc)
    session.add(ConsultationTimelineEvent(consultation_id=consultation.id, patient_id=consultation.patient_id, event_type="CONSULTATION_COMPLETED", actor_id=doctor_id, actor_role="DOCTOR", reference_id=str(consultation.id), details={"clinical_impression": consultation.clinical_impression, "assessment": consultation.assessment}))
    if consultation.referral_id:
        referral = await session.get(Referral, consultation.referral_id)
        if referral and referral.status == 'REACHED':
            await transition_referral(session, referral.referral_id, 'CONSULTATION_COMPLETED', doctor_id, 'DOCTOR', reason='Consultation completed', idempotency_key=f'consultation:{consultation.id}:referral-completed')
    await session.flush()
    return consultation


async def create_diagnostic_request(session: AsyncSession, **data) -> DiagnosticRequest:
    if await session.get(Consultation, data['consultation_id']) is None:
        raise LookupError('Consultation not found')
    item = DiagnosticRequest(**data)
    session.add(item)
    await session.flush()
    consultation = await session.get(Consultation, item.consultation_id)
    session.add(ConsultationTimelineEvent(consultation_id=item.consultation_id, patient_id=consultation.patient_id, event_type="DIAGNOSTIC_REQUESTED", actor_id=item.requested_by, actor_role="DOCTOR", reference_id=str(item.id), details={"investigation_name": item.investigation_name, "indication": item.indication}))
    return item


async def create_diagnostic_result(session: AsyncSession, **data) -> DiagnosticResult:
    if await session.get(DiagnosticRequest, data['investigation_id']) is None:
        raise LookupError('Diagnostic request not found')
    item = DiagnosticResult(**data)
    session.add(item)
    await session.flush()
    consultation_id = await session.scalar(select(DiagnosticRequest.consultation_id).where(DiagnosticRequest.id == item.investigation_id))
    patient_id = await session.scalar(select(Consultation.patient_id).where(Consultation.id == consultation_id))
    session.add(ConsultationTimelineEvent(consultation_id=consultation_id, patient_id=patient_id, event_type="DIAGNOSTIC_RESULT_RECORDED", actor_id=data.get("verified_by") or "CLINICIAN", actor_role="DOCTOR", reference_id=str(item.id), details={"result_value": item.result_value, "units": item.units}))
    return item


async def create_discharge_plan(session: AsyncSession, **data) -> tuple[DischargePlan, FollowUp | None]:
    consultation = await session.get(Consultation, data['consultation_id'])
    if consultation is None:
        raise LookupError('Consultation not found')
    if consultation.status != 'COMPLETED':
        raise ConsultationLifecycleError('Consultation must be completed before discharge')
    existing = await session.scalar(select(DischargePlan).where(DischargePlan.consultation_id == consultation.id))
    if existing:
        return existing, await session.scalar(select(FollowUp).where(FollowUp.source_reference == f'discharge:{existing.id}'))
    plan = DischargePlan(**data)
    session.add(plan)
    await session.flush()
    session.add(ConsultationTimelineEvent(consultation_id=plan.consultation_id, patient_id=consultation.patient_id, event_type="DISCHARGE_PLAN_CREATED", actor_id=plan.doctor_id, actor_role="DOCTOR", reference_id=str(plan.id), details={"diagnosis": plan.diagnosis, "follow_up_required": plan.follow_up_required}))
    follow_up = None
    if plan.follow_up_required:
        if plan.follow_up_due_at is None:
            raise ConsultationLifecycleError('follow_up_due_at is required when follow_up_required is true')
        follow_up, _ = await create_follow_up(session, patient_id=consultation.patient_id, follow_up_type='POST_DISCHARGE', due_at=plan.follow_up_due_at, priority='URGENT' if consultation.vitals.get('triage_level') == 'RED' else 'ROUTINE', high_risk=consultation.vitals.get('triage_level') == 'RED', notes='Doctor-authored discharge follow-up', source_reference=f'discharge:{plan.id}')
    return plan, follow_up
