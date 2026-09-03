"""Deterministic RAG-style retrieval of verified trauma first-aid protocol cards.

The embedded cards are intentionally constrained to short, conservative actions
appropriate for spoken delivery in a rural emergency. They are not a substitute
for emergency services, clinician direction, or locally approved protocols.
"""

from typing import Any

_PROTOCOLS: tuple[dict[str, object], ...] = (
    {
        "title": "BLEEDING / HEMORRHAGE",
        "keywords": ("bleeding", "hemorrhage", "blood", "wound", "leg injury", "cut"),
        "steps": [
            "Apply firm, continuous direct pressure with a clean cloth or dressing.",
            "If blood soaks through, add more cloth on top; do not remove the first cloth.",
            "For life-threatening limb bleeding, use a tourniquet only if trained and note the application time; do not loosen it.",
            "Keep the person warm and arrange urgent transport.",
        ],
    },
    {
        "title": "UNCONSCIOUSNESS / AIRWAY",
        "keywords": ("unconscious", "not responding", "unresponsive", "airway", "choking", "breathing"),
        "steps": [
            "Check whether the person responds and is breathing normally; activate emergency help immediately.",
            "Keep the airway clear of visible obstruction only; do not put fingers blindly into the mouth.",
            "If breathing and no spinal injury is suspected, place the person in the recovery position.",
            "Do not give food, water, or medicines by mouth to an unconscious person.",
        ],
    },
    {
        "title": "SPINAL & HEAD TRAUMA",
        "keywords": ("head injury", "head trauma", "spine", "spinal", "neck", "bike accident", "road accident", "trauma"),
        "steps": [
            "Assume a spine injury after major trauma: keep the head, neck, and body aligned.",
            "Do not move or sit the person up unless there is immediate danger.",
            "Prevent unnecessary movement and wait for trained transport support.",
            "Do not give food, water, or medicines by mouth.",
        ],
    },
    {
        "title": "FRACTURE / CRUSH INJURY",
        "keywords": ("fracture", "broken", "crush", "limb injury", "bone"),
        "steps": [
            "Keep the injured part still in the position found.",
            "Support it with a padded splint only if it does not require moving the person.",
            "Control visible bleeding with direct pressure around, not over, a protruding bone.",
            "Do not try to straighten a deformed limb.",
        ],
    },
    {
        "title": "BURNS",
        "keywords": ("burn", "scald", "fire", "chemical burn"),
        "steps": [
            "Cool the burn with clean cool running water as soon as possible.",
            "Remove loose jewelry or clothing near the burn only if it is not stuck to skin.",
            "Cover loosely with a clean cloth or non-fluffy dressing.",
            "Do not apply oils, ointments, toothpaste, or ice.",
        ],
    },
)


def get_rag_first_aid_guidance(symptoms: list[str], vitals: dict[str, Any]) -> dict[str, object]:
    """Retrieve the highest matching zero-hallucination first-aid protocol card.

    Keyword scoring is transparent and deterministic, which lets a PHC validate
    every spoken instruction without an external model or network connection.
    """

    symptom_text = " ".join(str(symptom).lower() for symptom in symptoms)
    spo2_value = vitals.get("spo2", vitals.get("spO2"))
    try:
        low_oxygen = float(spo2_value) < 90 if spo2_value is not None else False
    except (TypeError, ValueError):
        low_oxygen = False
    ranked = sorted(
        _PROTOCOLS,
        key=lambda protocol: sum(keyword in symptom_text for keyword in protocol["keywords"]),
        reverse=True,
    )
    selected = ranked[0]
    if low_oxygen and selected["title"] != "UNCONSCIOUSNESS / AIRWAY":
        airway = next(protocol for protocol in _PROTOCOLS if protocol["title"] == "UNCONSCIOUSNESS / AIRWAY")
        steps = ["Low oxygen reading: prioritize urgent airway and breathing assessment.", *airway["steps"], *selected["steps"][:1]]
        return {"protocol_title": airway["title"], "instructions": steps}
    return {"protocol_title": selected["title"], "instructions": selected["steps"]}
