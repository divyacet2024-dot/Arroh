"""Priority queue, WebRTC signaling, and prescription endpoints for ARROH tele-health."""

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.patient import Patient
from app.db.models.prescription import Prescription
from app.db.session import get_db_session
from app.schemas.teleconsult import (
    ICECandidateSchema,
    PrescriptionCreateSchema,
    PrescriptionResponseSchema,
    QueueJoinSchema,
    QueuePatientSchema,
    SDPMessageSchema,
)
from app.services.queue_manager import enqueue_patient, get_next_patient_for_doctor
from app.services.webrtc_signaling import signaling_manager

router = APIRouter(prefix="/teleconsult", tags=["Tele-Consultation"])
signaling_router = APIRouter(tags=["Tele-Consultation"])


@signaling_router.websocket("/ws/teleconsult/{room_id}")
async def teleconsult_signaling(room_id: str, websocket: WebSocket, client_id: str = Query(..., min_length=1, max_length=128)) -> None:
    """Relay WebRTC SDP/ICE messages and issue audio-only fallback on poor networks."""

    await signaling_manager.connect(room_id, client_id, websocket)
    try:
        await websocket.send_json({"type": "ROOM_JOINED", "room_id": room_id, "client_id": client_id})
        while True:
            message: dict[str, Any] = await websocket.receive_json()
            if not isinstance(message, dict):
                await websocket.send_json({"type": "SIGNALING_ERROR", "detail": "Signaling message must be a JSON object"})
                continue
            message_type = message.get("type")
            if message_type in {"SDP_OFFER", "SDP_ANSWER"}:
                await signaling_manager.relay(room_id, client_id, SDPMessageSchema.model_validate(message).model_dump())
            elif message_type == "ICE_CANDIDATE":
                await signaling_manager.relay(room_id, client_id, ICECandidateSchema.model_validate(message).model_dump())
            elif message_type == "NETWORK_REPORT":
                packet_loss = float(message.get("packet_loss_percent", 0))
                latency = float(message.get("latency_ms", 0))
                if packet_loss < 0 or latency < 0:
                    raise ValueError("Network metrics cannot be negative")
                degraded = await signaling_manager.report_network(room_id, client_id, packet_loss, latency)
                await websocket.send_json({"type": "NETWORK_REPORT_ACK", "degraded": degraded})
            else:
                await websocket.send_json({"type": "SIGNALING_ERROR", "detail": "Unsupported signaling message type"})
    except WebSocketDisconnect:
        pass
    except (ValidationError, ValueError, TypeError, json.JSONDecodeError) as exc:
        await websocket.send_json({"type": "SIGNALING_ERROR", "detail": str(exc)})
    finally:
        await signaling_manager.disconnect(room_id, client_id, websocket)


@router.post("/queue/join", response_model=QueuePatientSchema, status_code=status.HTTP_201_CREATED, summary="Join doctor priority queue")
async def join_doctor_queue(payload: QueueJoinSchema, db: AsyncSession = Depends(get_db_session)) -> QueuePatientSchema:
    """Confirm the patient exists, then add them to the PHC's urgency-ordered queue."""

    patient = await db.get(Patient, payload.patient_id)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    entry = await enqueue_patient(payload.patient_id, payload.triage_status, payload.phc_id)
    return QueuePatientSchema(patient_id=entry.patient_id, triage_status=entry.triage_status, phc_id=entry.phc_id, joined_at=entry.joined_at)


@router.get("/queue/next", response_model=QueuePatientSchema | None, summary="Claim next priority patient")
async def claim_next_patient(doctor_id: str = Query(..., min_length=1, max_length=128), phc_id: str = Query(..., min_length=1, max_length=128)) -> QueuePatientSchema | None:
    """Atomically claim the next RED, then YELLOW, then GREEN patient for a doctor."""

    entry = await get_next_patient_for_doctor(doctor_id, phc_id)
    if entry is None:
        return None
    return QueuePatientSchema(patient_id=entry.patient_id, triage_status=entry.triage_status, phc_id=entry.phc_id, joined_at=entry.joined_at)


@router.post("/prescription", response_model=PrescriptionResponseSchema, status_code=status.HTTP_201_CREATED, summary="Issue FHIR digital prescription")
async def issue_prescription(payload: PrescriptionCreateSchema, db: AsyncSession = Depends(get_db_session)) -> PrescriptionResponseSchema:
    """Persist a doctor-issued FHIR MedicationRequest projection for a known patient."""

    if await db.get(Patient, payload.patient_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    prescription = Prescription(**payload.model_dump())
    db.add(prescription)
    await db.flush()
    await db.refresh(prescription)
    return PrescriptionResponseSchema(
        id=prescription.id,
        status=prescription.status,
        intent=prescription.intent,
        subject={"reference": f"Patient/{prescription.patient_id}"},
        authored_on=prescription.authored_on,
        medication_codeable_concept={
            "coding": [{"code": prescription.medication_code, "display": prescription.medication_display}],
            "text": prescription.medication_display,
        },
        dosage_instruction=[{"text": prescription.dosage_instruction}],
    )
