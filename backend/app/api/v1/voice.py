"""Voice-assisted, offline-friendly intake endpoint for ASHA field workers."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.patient import Patient, TriageStatus
from app.db.models.triage import TriageLog
from app.db.session import get_db_session
from app.schemas.voice import VoiceParseRequestSchema, VoiceParseResponseSchema
from app.services.triage_service import assess_triage
from app.services.voice_service import parse_voice_transcript

router = APIRouter(prefix="/voice", tags=["Voice Assistant"])


@router.post("/parse-and-triage", response_model=VoiceParseResponseSchema, summary="Parse spoken intake and assess triage")
async def parse_and_triage_voice(payload: VoiceParseRequestSchema, db: AsyncSession = Depends(get_db_session)) -> VoiceParseResponseSchema:
    """Convert a local transcription into standardized clinical data and edge triage."""

    if not payload.transcript.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript cannot be empty")
    extracted = parse_voice_transcript(payload.transcript, payload.language)
    assessment = assess_triage(extracted["symptoms"], extracted["vitals"])
    if payload.abha_id:
        patient = await db.scalar(select(Patient).where(Patient.abha_id == payload.abha_id.replace("-", "").replace(" ", "")))
        if patient is not None:
            db.add(TriageLog(
                patient_id=patient.id,
                phc_id=patient.current_phc_id,
                triage_status=TriageStatus(assessment["triage_level"]),
                vitals=extracted["vitals"],
                symptoms=extracted["symptoms"],
                source="voice",
                raw_transcript=payload.transcript,
                assessment=assessment,
            ))
    return VoiceParseResponseSchema(
        transcript=payload.transcript,
        extracted_clinical_data=extracted,
        triage_assessment=assessment,
    )
