"""Transactional conflict resolution for ARROH's offline-first sync protocol."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.case_taking import CaseSessionRow, persist_case_session
from app.db.models.consultation import Consultation, DiagnosticRequest, DiagnosticResult, DischargePlan
from app.db.models.follow_up import FollowUp, FollowUpTask
from app.db.models.patient import Patient
from app.db.models.referral import Referral
from app.db.models.synced_entity import OfflineSyncError, OfflineTask, OfflineVisit
from app.db.models.triage import TriageLog
from app.db.models.visit import Visit, VisitVitals
from app.schemas.sync import ResolvedConflictSchema, SyncPayloadSchema, SyncOperationResultSchema, SyncRecordSchema, SyncResponseSchema, TypedSyncRecordSchema
from app.services.follow_up_service import FollowUpLifecycleError, create_follow_up, ensure_task
from app.services.referral_lifecycle_service import ReferralLifecycleError, create_referral_event
from app.services.visit_service import (
    VisitLifecycleError,
    VisitValidationError,
    complete_visit,
    start_visit,
)


def _as_utc(value: datetime) -> datetime:
    """Normalize client timestamps so timestamp comparisons are deterministic."""

    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


async def _find_matching_patient(session: AsyncSession, record: SyncRecordSchema) -> Patient | None:
    """Find and lock the best identity match using the SIH reconciliation order."""

    patient = await session.scalar(
        select(Patient).where(Patient.offline_client_uuid == record.local_client_uuid).with_for_update()
    )
    if patient is not None:
        return patient
    if record.abha_id:
        patient = await session.scalar(select(Patient).where(Patient.abha_id == record.abha_id).with_for_update())
        if patient is not None:
            return patient
    if record.phone_number:
        patient = await session.scalar(
            select(Patient)
            .where(
                and_(
                    Patient.name.ilike(record.name.strip()),
                    Patient.birth_date == record.birth_date,
                    Patient.phone_number == record.phone_number,
                )
            )
            .with_for_update()
        )
        if patient is not None:
            return patient
    return None


def _apply_offline_record(patient: Patient, record: SyncRecordSchema, phc_id: str) -> None:
    """Copy the latest field observation onto the server-side patient projection."""

    patient.name = record.name.strip()
    patient.gender = record.gender
    patient.birth_date = record.birth_date
    patient.abha_id = record.abha_id or patient.abha_id
    patient.abha_address = record.abha_address or patient.abha_address
    patient.phone_number = record.phone_number or patient.phone_number
    patient.current_phc_id = phc_id
    patient.district = record.district.strip()
    patient.state = record.state.strip()
    patient.vitals = record.vitals
    patient.symptoms = record.symptoms
    patient.triage_status = record.triage_status
    patient.is_synced_offline = True
    patient.offline_client_uuid = record.local_client_uuid
    patient.last_offline_timestamp = _as_utc(record.local_timestamp)


def _triage_log(patient: Patient, record: SyncRecordSchema, phc_id: str) -> TriageLog:
    """Create an auditable triage log for each accepted offline observation."""

    return TriageLog(
        patient_id=patient.id,
        phc_id=phc_id,
        triage_status=record.triage_status,
        vitals=record.vitals,
        symptoms=record.symptoms,
        source="offline_sync",
        observed_at=_as_utc(record.local_timestamp),
    )


async def synchronize_batch(session: AsyncSession, payload: SyncPayloadSchema) -> SyncResponseSchema:
    """Merge an offline batch atomically for the SIH reconnection demonstration.

    A batch runs in one transaction. Identity resolution prefers the stable client
    UUID, then ABHA, then name/birth-date/phone. The device's timestamp wins only
    when it is newer than the last accepted offline observation; stale events are
    acknowledged as duplicates, making retries safe after an interrupted upload.
    """

    response = SyncResponseSchema()
    async with session.begin():
        for record in payload.records:
            if isinstance(record, TypedSyncRecordSchema):
                try:
                    async with session.begin_nested():
                        server_id, duplicate = await _persist_typed_entity(session, record)
                    response.results.append(SyncOperationResultSchema(
                        entity_type=record.entity_type,
                        local_uuid=record.local_uuid,
                        status="DUPLICATE" if duplicate else "SYNCED",
                        server_id=server_id,
                    ))
                    if duplicate:
                        response.duplicate_count += 1
                    else:
                        response.synced_count += 1
                except ValueError as exc:
                    session.add(OfflineSyncError(local_uuid=record.local_uuid, entity_type=record.entity_type, error=str(exc), payload=record.payload))
                    response.failed_count += 1
                    response.results.append(SyncOperationResultSchema(entity_type=record.entity_type, local_uuid=record.local_uuid, status="FAILED", error=str(exc)))
                continue
            patient = await _find_matching_patient(session, record)
            if patient is None:
                patient = Patient(
                    name=record.name.strip(),
                    gender=record.gender,
                    birth_date=record.birth_date,
                    abha_id=record.abha_id,
                    abha_address=record.abha_address,
                    district=record.district.strip(),
                    state=record.state.strip(),
                    phone_number=record.phone_number,
                    current_phc_id=payload.phc_id,
                    vitals=record.vitals,
                    symptoms=record.symptoms,
                    triage_status=record.triage_status,
                    is_synced_offline=True,
                    offline_client_uuid=record.local_client_uuid,
                    last_offline_timestamp=_as_utc(record.local_timestamp),
                )
                session.add(patient)
                await session.flush()
                session.add(_triage_log(patient, record, payload.phc_id))
                response.synced_count += 1
                response.results.append(SyncOperationResultSchema(entity_type="patient", local_uuid=str(record.local_client_uuid), status="SYNCED", server_id=str(patient.id)))
                continue

            incoming_timestamp = _as_utc(record.local_timestamp)
            accepted_timestamp = patient.last_offline_timestamp
            if accepted_timestamp and incoming_timestamp <= _as_utc(accepted_timestamp):
                response.duplicate_count += 1
                response.results.append(SyncOperationResultSchema(entity_type="patient", local_uuid=str(record.local_client_uuid), status="DUPLICATE", server_id=str(patient.id)))
                continue

            _apply_offline_record(patient, record, payload.phc_id)
            session.add(_triage_log(patient, record, payload.phc_id))
            response.synced_count += 1
            response.results.append(SyncOperationResultSchema(entity_type="patient", local_uuid=str(record.local_client_uuid), status="SYNCED", server_id=str(patient.id)))
            response.resolved_conflicts.append(
                ResolvedConflictSchema(
                    local_client_uuid=record.local_client_uuid,
                    patient_id=patient.id,
                    resolution="Updated existing patient because offline record was newer",
                )
            )

    return response


async def _persist_typed_entity(session: AsyncSession, record: TypedSyncRecordSchema) -> tuple[str, bool]:
    """Persist a typed payload without converting it into a patient observation."""

    payload = dict(record.payload)
    payload["local_uuid"] = record.local_uuid
    patient_local_uuid = payload.get("patient_local_uuid")
    if record.entity_type == "case_session":
        raw_case_id = payload.get("case_id")
        if not raw_case_id:
            raise ValueError("case_session payload requires case_id")
        try:
            case_id = __import__("uuid").UUID(str(raw_case_id))
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError("case_session case_id must be a UUID") from exc
        existing = await session.scalar(select(CaseSessionRow).where(CaseSessionRow.case_id == case_id))
        if existing:
            return str(existing.id), True
        patient_id = None
        if patient_local_uuid:
            try:
                patient_id = await session.scalar(select(Patient.id).where(Patient.id == uuid.UUID(str(patient_local_uuid))))
            except (TypeError, ValueError, AttributeError):
                patient_id = await session.scalar(select(Patient.id).where(Patient.offline_client_uuid == str(patient_local_uuid)))
        payload["case_id"] = str(case_id)
        row = await persist_case_session(session, case_session_dict=payload, patient_db_id=patient_id)
        row.local_uuid = record.local_uuid
        return str(row.id), False

    if record.entity_type == "referral":
        existing = await session.scalar(select(Referral).where(Referral.local_uuid == record.local_uuid))
        if existing:
            return str(existing.referral_id), True
        if not payload.get("patient_id") and patient_local_uuid:
            patient = await session.scalar(select(Patient).where(Patient.offline_client_uuid == patient_local_uuid))
            if patient:
                payload["patient_id"] = str(patient.id)
        required = ("patient_id", "origin_phc_id", "target_facility_id", "target_facility_name", "target_facility_type", "referral_priority", "reason_for_referral")
        if any(not payload.get(field) for field in required):
            raise ValueError("referral payload is missing required fields")
        try:
            payload["patient_id"] = uuid.UUID(str(payload["patient_id"]))
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError("referral patient_id must identify a server patient") from exc
        referral = Referral(local_uuid=record.local_uuid, **{field: payload[field] for field in required}, required_capabilities=payload.get("required_capabilities", []), status=payload.get("status", "CREATED"), specialty_service=payload.get("specialty_service"))
        session.add(referral)
        await session.flush()
        return str(referral.referral_id), False

    if record.entity_type == "follow_up":
        existing = await session.scalar(select(FollowUp).where(FollowUp.local_uuid == record.local_uuid))
        if existing:
            return str(existing.id), True
        raw_due_at = payload.get("due_at") or payload.get("scheduled_for")
        if not patient_local_uuid or not raw_due_at:
            raise ValueError("follow_up payload requires patient_local_uuid and due_at")
        try:
            due_at = datetime.fromisoformat(str(raw_due_at).replace("Z", "+00:00"))
            patient_id = uuid.UUID(str(patient_local_uuid))
        except (ValueError, TypeError) as exc:
            patient = await session.scalar(select(Patient).where(Patient.offline_client_uuid == str(patient_local_uuid)))
            if not patient:
                raise ValueError("follow_up patient_local_uuid and due_at are invalid") from exc
            patient_id = patient.id
        follow_up, duplicate = await create_follow_up(session, patient_id=patient_id, follow_up_type=payload.get("follow_up_type", "COMMUNITY"), due_at=due_at, priority=payload.get("priority", "ROUTINE"), high_risk=bool(payload.get("high_risk", False)), notes=payload.get("notes"), source_reference=payload.get("source_reference"), local_uuid=record.local_uuid)
        return str(follow_up.id), duplicate

    clinical_models = {"consultation": Consultation, "diagnostic_request": DiagnosticRequest, "diagnostic_result": DiagnosticResult, "discharge_plan": DischargePlan}
    if record.entity_type in clinical_models:
        model = clinical_models[record.entity_type]
        existing = await session.scalar(select(model).where(model.local_uuid == record.local_uuid))
        if existing:
            if record.operation == "update":
                for key, value in payload.items():
                    if key not in {"id", "local_uuid"} and hasattr(model, key):
                        setattr(existing, key, value)
                await session.flush()
            return str(existing.id), True
        required = {
            "consultation": ("patient_id", "doctor_id"),
            "diagnostic_request": ("consultation_id", "investigation_name", "requested_by"),
            "diagnostic_result": ("investigation_id", "result_value", "performed_at"),
            "discharge_plan": ("consultation_id", "doctor_id", "diagnosis", "treatment_instructions", "emergency_return_instructions"),
        }[record.entity_type]
        if any(not payload.get(field) for field in required):
            raise ValueError(f"{record.entity_type} payload is missing required fields")
        for key in {"patient_id", "consultation_id", "investigation_id"}.intersection(payload):
            payload[key] = uuid.UUID(str(payload[key]))
        entity = model(local_uuid=record.local_uuid, **{key: value for key, value in payload.items() if hasattr(model, key) and key not in {"id", "local_uuid"}})
        session.add(entity)
        await session.flush()
        return str(entity.id), False

    if record.entity_type == "visit":
        existing = await session.scalar(select(Visit).where(Visit.local_uuid == record.local_uuid))
        if existing is not None:
            return str(existing.id), True
        if not patient_local_uuid:
            raise ValueError("visit payload requires patient_local_uuid")
        actor_id = str(payload.get("actor_id", "ASHA-OFFLINE"))
        actor_role = str(payload.get("actor_role", "ASHA")).upper()
        visit_type = str(payload.get("visit_type", "general follow-up"))
        phc_id = payload.get("phc_id")
        visit = await start_visit(
            session,
            patient_local_uuid=str(patient_local_uuid),
            actor_id=actor_id,
            actor_role=actor_role,
            visit_type=visit_type,
            local_uuid=record.local_uuid,
            phc_id=phc_id,
        )
        vitals_payload = payload.get("vitals")
        if isinstance(vitals_payload, dict) and vitals_payload:
            from app.services.visit_service import record_vitals as _record_vitals
            await _record_vitals(
                session,
                visit_id=visit.id,
                actor_id=actor_id,
                actor_role=actor_role,
                vitals=vitals_payload,
            )
        symptoms_payload = payload.get("symptoms")
        if isinstance(symptoms_payload, list) and symptoms_payload:
            from app.services.visit_service import record_symptoms as _record_symptoms
            await _record_symptoms(
                session,
                visit_id=visit.id,
                actor_id=actor_id,
                actor_role=actor_role,
                symptoms=[row if isinstance(row, dict) else {"symptom": str(row)} for row in symptoms_payload],
            )
        outcome = payload.get("outcome")
        if outcome:
            try:
                next_visit_date_raw = payload.get("next_visit_date")
                next_visit_date = None
                if next_visit_date_raw:
                    next_visit_date = datetime.fromisoformat(str(next_visit_date_raw).replace("Z", "+00:00"))
                await complete_visit(
                    session,
                    visit_id=visit.id,
                    actor_id=actor_id,
                    actor_role=actor_role,
                    outcome=str(outcome),
                    findings=payload.get("findings"),
                    next_visit_date=next_visit_date,
                    follow_up_payload=payload.get("follow_up"),
                    referral_payload=payload.get("referral"),
                    task_payload=payload.get("task"),
                )
            except (VisitValidationError, VisitLifecycleError) as exc:
                raise ValueError(str(exc)) from exc
        # Preserve a write-through row in the legacy offline_visits table so
        # older readers can still see the payload. The canonical record is
        # the Visit row above; this is a mirror, not a duplicate source.
        existing_offline = await session.scalar(select(OfflineVisit).where(OfflineVisit.local_uuid == record.local_uuid))
        if existing_offline is None:
            session.add(OfflineVisit(local_uuid=record.local_uuid, patient_local_uuid=str(patient_local_uuid), payload=payload))
        return str(visit.id), False

    if record.entity_type == "task":
        # ``task`` is re-pointed to the existing FollowUpTask model so we
        # never create a parallel task lifecycle. Newer payloads always
        # supply ``follow_up_id`` and we materialise a FollowUpTask. Older
        # payloads (no follow_up_id) fall back to the legacy OfflineTask
        # JSON mirror for backward compatibility with deployed devices.
        follow_up_id = payload.get("follow_up_id")
        if not follow_up_id:
            existing = await session.scalar(select(OfflineTask).where(OfflineTask.local_uuid == record.local_uuid))
            if existing:
                return str(existing.id), True
            if not patient_local_uuid and not payload.get("patient_local_uuid"):
                raise ValueError("task payload requires patient_local_uuid")
            row = OfflineTask(local_uuid=record.local_uuid, patient_local_uuid=str(patient_local_uuid or payload.get("patient_local_uuid") or ""), payload=payload)
            session.add(row)
            await session.flush()
            return str(row.id), False
        try:
            follow_up_uuid = uuid.UUID(str(follow_up_id))
        except (TypeError, ValueError) as exc:
            raise ValueError("task follow_up_id is not a valid UUID") from exc
        follow_up_row = await session.get(FollowUp, follow_up_uuid)
        if follow_up_row is None:
            raise ValueError("task follow_up_id does not reference an existing follow-up")
        visit_id_for_dedupe = str(payload.get("visit_id", ""))
        existing_task = await session.scalar(
            select(FollowUpTask).where(FollowUpTask.follow_up_id == follow_up_row.id)
        )
        if existing_task is not None:
            return str(existing_task.id), True
        try:
            due_at_value = datetime.fromisoformat(str(payload.get("due_at")).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            due_at_value = follow_up_row.due_at
        task_row = FollowUpTask(
            follow_up_id=follow_up_row.id,
            patient_id=follow_up_row.patient_id,
            task_type=str(payload.get("task_type", "HOME_VISIT")),
            status="PENDING",
            priority=str(payload.get("priority", "ROUTINE")).upper(),
            assigned_worker_id=str(payload.get("actor_id", "ASHA-OFFLINE")),
            due_at=due_at_value,
            details={"source": "visit", "visit_id": visit_id_for_dedupe, "notes": payload.get("notes")},
        )
        session.add(task_row)
        await session.flush()
        return str(task_row.id), False

    # Backward-compat fallback for older clients that still target the JSON
    # mirror. Newer payloads must use the typed routes above.
    model = {"visit_legacy": OfflineVisit, "task_legacy": OfflineTask}.get(record.entity_type)
    if model is None:
        raise ValueError(f"Unsupported entity_type: {record.entity_type}")
    existing = await session.scalar(select(model).where(model.local_uuid == record.local_uuid))
    if existing:
        if record.operation == "update":
            existing.payload = payload
            await session.flush()
            return str(existing.id), False
        return str(existing.id), True
    if model is OfflineVisit and not patient_local_uuid:
        raise ValueError(f"{record.entity_type} payload requires patient_local_uuid")
    entity = model(local_uuid=record.local_uuid, patient_local_uuid=patient_local_uuid, payload=payload)
    session.add(entity)
    await session.flush()
    return str(entity.id), False
