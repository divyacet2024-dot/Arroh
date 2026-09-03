"""HTTP interface for ARROH's offline-capable edge-triage rules engine."""

from fastapi import APIRouter

from app.schemas.triage import TriageRequestSchema, TriageResponseSchema
from app.services.ai_triage import assess_symptom_triage

router = APIRouter(prefix="/triage", tags=["AI Edge Triage"])


@router.post("/assess", response_model=TriageResponseSchema, summary="Assess symptom severity at the edge")
async def assess_triage(payload: TriageRequestSchema) -> dict[str, object]:
    """Return explainable RED/YELLOW/GREEN prioritization from partial patient observations."""

    return assess_symptom_triage(payload.symptoms, payload.vitals)
