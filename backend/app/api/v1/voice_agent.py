"""Emergency voice-agent endpoint for rural trauma and ambulance fallback support."""

from fastapi import APIRouter, HTTPException, status

from app.schemas.voice_agent import EmergencyCallRequest, EmergencySessionResponse
from app.services.voice_agent_service import create_emergency_voice_session

router = APIRouter(prefix="/voice-agent", tags=["AI Emergency Voice Agent"])


@router.post("/emergency-session", response_model=EmergencySessionResponse, summary="Start trauma emergency voice-agent session")
async def emergency_voice_session(payload: EmergencyCallRequest) -> EmergencySessionResponse:
    """Return triage, conservative first aid, and ambulance-delay transport fallback guidance."""

    if not payload.spoken_emergency_text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Spoken emergency text cannot be empty")
    try:
        return EmergencySessionResponse.model_validate(create_emergency_voice_session(payload))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
