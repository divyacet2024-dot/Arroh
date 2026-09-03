"""Emergency voice session orchestration for rural trauma and road accidents."""

import uuid
from typing import Any

from app.schemas.referral import ReferralRecommendationRequestSchema
from app.schemas.voice_agent import EmergencyCallRequest
from app.services.emergency_rag_service import get_rag_first_aid_guidance
from app.services.referral_service import recommend_referral_facilities
from app.services.triage_service import assess_triage
from app.services.voice_service import parse_spoken_text_to_clinical_data

_TRAUMA_KEYWORDS: dict[str, tuple[str, ...]] = {
    "hemorrhage": ("heavy bleeding", "bleeding", "hemorrhage", "blood loss"),
    "unconsciousness": ("unconscious", "unresponsive", "not responding"),
    "head injury": ("head injury", "head trauma", "head hit"),
    "spinal trauma": ("spine", "spinal", "neck injury", "back injury"),
    "fracture": ("fracture", "broken bone", "broken leg", "crush injury"),
    "burns": ("burn", "scald", "fire injury"),
}


def _augment_trauma_symptoms(transcript: str, parsed: dict[str, Any]) -> list[str]:
    """Add trauma intents missed by routine intake vocabulary without external NLP."""

    text = transcript.lower()
    symptoms = list(parsed.get("symptoms", []))
    for clinical_term, phrases in _TRAUMA_KEYWORDS.items():
        if any(phrase in text for phrase in phrases) and clinical_term not in symptoms:
            symptoms.append(clinical_term)
    if any(phrase in text for phrase in ("accident", "collision", "bike accident", "road accident")) and "trauma" not in symptoms:
        symptoms.append("trauma")
    return symptoms


def _elevate_trauma_triage(triage: dict[str, Any], symptoms: list[str]) -> dict[str, Any]:
    """Ensure obvious trauma danger signs cannot be under-prioritized by sparse vitals."""

    critical = {"hemorrhage", "unconsciousness", "head injury", "spinal trauma", "trauma"}
    if critical.intersection(symptoms):
        triage["risk_score"] = max(int(triage["risk_score"]), 85)
        triage["triage_level"] = "RED"
        triage["recommended_actions"] = list(dict.fromkeys([
            "Activate emergency referral and keep the patient under continuous observation.",
            *triage["recommended_actions"],
        ]))
    return triage


def create_emergency_voice_session(request: EmergencyCallRequest) -> dict[str, Any]:
    """Parse a trauma call, retrieve safe first aid, and plan ambulance fallback transport."""

    if not request.spoken_emergency_text.strip():
        raise ValueError("Spoken emergency text cannot be empty")
    parsed = parse_spoken_text_to_clinical_data(request.spoken_emergency_text, request.language)
    symptoms = _augment_trauma_symptoms(request.spoken_emergency_text, parsed)
    parsed["symptoms"] = symptoms
    triage = _elevate_trauma_triage(assess_triage(symptoms, parsed["vitals"]), symptoms)
    rag_guidance = get_rag_first_aid_guidance(symptoms, parsed["vitals"])
    recommendation_request = ReferralRecommendationRequestSchema(
        patient_id=uuid.uuid4(),
        triage_level=triage["triage_level"],
        required_capabilities=["TRAUMA_CARE", "EMERGENCY_SURGERY", "BLOOD_BANK"],
        vitals=parsed["vitals"],
        high_risk_respiratory=triage["high_risk_respiratory"],
        origin_phc_id=request.current_phc_id,
    )
    facilities = recommend_referral_facilities(recommendation_request)
    facility = facilities[0] if facilities else None
    is_delayed = request.ambulance_eta_minutes > 20
    if is_delayed and facility:
        transport_advice = f"ALERT: Ambulance delayed {request.ambulance_eta_minutes} mins. Immediate private vehicle dispatch recommended to {facility.facility_name}, {facility.transport_eta} away."
    elif is_delayed:
        transport_advice = f"ALERT: Ambulance delayed {request.ambulance_eta_minutes} mins. Contact the nearest CHC or district hospital for transport coordination."
    else:
        transport_advice = f"Ambulance expected in {request.ambulance_eta_minutes} mins. Continue first aid and prepare for transfer."
    first_step = rag_guidance["instructions"][0] if rag_guidance["instructions"] else "Keep the patient safe and wait for emergency support."
    spoken = f"Emergency status {triage['triage_level']}. Ambulance ETA {request.ambulance_eta_minutes} minutes. {transport_advice} First aid now: {first_step}"
    return {
        "status": "EMERGENCY_SESSION_ACTIVE",
        "parsed_clinical_data": parsed,
        "triage_result": triage,
        "rag_first_aid": rag_guidance,
        "recommended_facility": facility,
        "ambulance_status": {"eta_minutes": request.ambulance_eta_minutes, "is_delayed": is_delayed, "actionable_transport_advice": transport_advice},
        "agent_spoken_voice_response": spoken,
    }
