"""Capability-aware facility matching for rural emergency referrals.

The local facility directory is deliberately deterministic for SIH demonstrations.
In production it can be replaced by a state facility registry/GIS provider while
retaining the same safety rules and endpoint contracts.
"""

from typing import Any

from app.schemas.referral import FacilityRecommendationSchema, ReferralRecommendationRequestSchema

_FACILITIES: tuple[dict[str, Any], ...] = (
    {"facility_id": "PHC-BEL-01", "facility_name": "Belthangady Primary Health Centre", "facility_type": "PHC", "capabilities": ["OXYGEN_CYLINDER", "BASIC_EMERGENCY", "MATERNAL_CARE", "BASIC_OBSTETRIC"], "distance_km": 7.0},
    {"facility_id": "CHC-BEL-01", "facility_name": "CHC Belthangady", "facility_type": "CHC", "capabilities": ["OXYGEN_CYLINDER", "ICU", "CPAP", "SNAKE_ANTIVENOM", "BLOOD_BANK", "TRAUMA_CARE", "EMERGENCY_SURGERY", "MATERNAL_CARE", "OBSTETRIC_CARE", "C_SECTION", "MATERNAL_RECEPTION"], "distance_km": 18.0},
    {"facility_id": "DH-MNG-01", "facility_name": "Mangalore District Hospital", "facility_type": "DISTRICT_HOSPITAL", "capabilities": ["OXYGEN_CYLINDER", "ICU", "CPAP", "SNAKE_ANTIVENOM", "BLOOD_BANK", "VENTILATOR", "TRAUMA_CARE", "EMERGENCY_SURGERY", "MATERNAL_CARE", "OBSTETRIC_CARE", "C_SECTION", "MATERNAL_RECEPTION"], "distance_km": 45.0},
)


def _spo2(vitals: dict[str, Any]) -> float | None:
    """Read a valid SpO2 number from partial field-worker vital data."""

    for key in ("spo2", "spO2", "oxygen_saturation"):
        value = vitals.get(key)
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                return None
    return None


def recommend_facilities(request: ReferralRecommendationRequestSchema) -> list[FacilityRecommendationSchema]:
    """Rank facilities by capability and mock travel distance using emergency safeguards."""

    spo2 = _spo2(request.vitals)
    emergency = request.triage_level == "RED" or request.high_risk_respiratory or (spo2 is not None and spo2 < 85)
    required = {capability.upper() for capability in request.required_capabilities}
    if emergency:
        required.update({"OXYGEN_CYLINDER", "ICU"})
    candidates: list[FacilityRecommendationSchema] = []
    for facility in _FACILITIES:
        capabilities = set(facility["capabilities"])
        if emergency and facility["facility_type"] not in {"CHC", "DISTRICT_HOSPITAL"}:
            continue
        if not required.issubset(capabilities):
            continue
        distance = float(facility["distance_km"])
        eta_minutes = max(10, round(distance * (1.0 if emergency else 1.4)))
        reason = "Emergency capability match: ICU and oxygen available." if emergency else "Matches requested referral capabilities."
        candidates.append(
            FacilityRecommendationSchema(**{
                **facility,
                "distance_km": distance,
                "transport_eta": f"{eta_minutes} mins by {'emergency ambulance' if emergency else 'available transport'}",
                "match_reason": reason,
            })
        )
    # Graceful fallback when an uncommon capability has no exact local match.
    if not candidates:
        for facility in _FACILITIES:
            if facility["facility_type"] in ({"CHC", "DISTRICT_HOSPITAL"} if emergency else {"PHC", "CHC", "DISTRICT_HOSPITAL"}):
                distance = float(facility["distance_km"])
                candidates.append(
                    FacilityRecommendationSchema(**{
                        **facility,
                        "distance_km": distance,
                        "transport_eta": f"{max(10, round(distance * 1.2))} mins by emergency ambulance",
                        "match_reason": "Closest higher-level facility; confirm requested capability by phone.",
                    })
                )
    return sorted(candidates, key=lambda facility: facility.distance_km)


def recommend_referral_facilities(request: ReferralRecommendationRequestSchema) -> list[FacilityRecommendationSchema]:
    """Explicit emergency-agent alias for capability-aware facility matching."""

    return recommend_facilities(request)
