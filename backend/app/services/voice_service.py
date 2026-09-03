"""Offline transcription parser for hands-free ASHA worker patient intake.

No external speech or language model is required after transcription. Indic and
English symptom phrases are normalized locally, then vital measurements are
extracted with tolerant regular expressions for low-bandwidth deployments.
"""

import re
from typing import Any

_SYMPTOM_MAP: dict[str, tuple[str, ...]] = {
    "chest pain": ("chest pain", "nenju vali", "seene mein dard", "chati mein dard", "ಮೆದೆ ನೋವು", "ಎದೆ ನೋವು", "மார்பு வலி", "ఛాతీ నొప్పి"),
    "shortness of breath": ("shortness of breath", "breathlessness", "difficulty breathing", "saans ki takleef", "ಉಸಿರಾಟದ ತೊಂದರೆ", "மூச்சுத்திணறல்", "శ్వాస ఇబ్బంది"),
    "high fever": ("high fever", "fever", "bukhar", "jwara", "ಜ್ವರ", "ಜ್ವరం", "காய்ச்சல்", "జ్వరం"),
    "abnormal bleeding": ("abnormal bleeding", "heavy bleeding", "raktasrava", "ರಕ್ತಸ್ರಾವ", "அதிக இரத்தப்போக்கு", "అధిక రక్తస్రావం"),
    "snakebite": ("snakebite", "snake bite", "saamp kaat", "ಹಾವು ಕಚ್ಚಿದೆ", "பாம்பு கடி", "పాము కాటు"),
    "pregnancy": ("pregnant", "pregnancy", "expecting", "antepartum", "in labour", "in labor"),
    "pre-eclampsia": ("pre-eclampsia", "preeclampsia", "pre eclampsia", "eclampsia", "pregnancy hypertension"),
    "antepartum hemorrhage": ("antepartum hemorrhage", "antepartum haemorrhage", "vaginal bleeding in pregnancy", "bleeding during pregnancy", "placenta previa", "placental abruption"),
    "severe anemia": ("severe anemia", "severe anaemia", "pallor", "extreme fatigue", "severe weakness", "severe tiredness"),
}

_VITAL_PATTERNS: dict[str, re.Pattern[str]] = {
    "spo2": re.compile(r"(?:spo\s*2|oxygen(?:\s+saturation)?|o2)\s*(?:is|of|equals)?\s*(\d{2,3}(?:\.\d+)?)", re.IGNORECASE),
    "heart_rate": re.compile(r"(?:heart\s*rate|pulse|hr)\s*(?:is|of|equals)?\s*(\d{2,3}(?:\.\d+)?)", re.IGNORECASE),
    "temperature": re.compile(r"(?:temperature|temp)\s*(?:is|of|equals)?\s*(\d{2,3}(?:\.\d+)?)", re.IGNORECASE),
    # Hemoglobin is reported in g/dL for obstetric anemia screening (e.g. "hemoglobin 6.4").
    "hemoglobin": re.compile(r"(?:hemoglobin|haemoglobin|hgb)(?:\s*(?:is|of|equals|level))?\s*(\d{1,2}(?:\.\d+)?)", re.IGNORECASE),
}

_BLOOD_PRESSURE_PATTERN = re.compile(r"(?:blood\s*pressure|bp)(?:\s*(?:is|of|reads|shows|is\s*showing))?\s*(\d{2,3})\s*(?:/|over|by)\s*(\d{2,3})", re.IGNORECASE)


def parse_voice_transcript(transcript: str, language: str = "unknown") -> dict[str, Any]:
    """Extract standardized symptoms and vitals from a local spoken-text transcript."""

    text = transcript.strip().lower()
    if not text:
        raise ValueError("Transcript cannot be empty")
    symptoms = [clinical_term for clinical_term, terms in _SYMPTOM_MAP.items() if any(term in text for term in terms)]
    vitals: dict[str, float] = {}
    for vital_name, pattern in _VITAL_PATTERNS.items():
        match = pattern.search(text)
        if match:
            value = float(match.group(1))
            # A spoken temperature such as "103" is conventionally Fahrenheit.
            vitals[vital_name] = round((value - 32) * 5 / 9, 1) if vital_name == "temperature" and value > 45 else value
    bp_match = _BLOOD_PRESSURE_PATTERN.search(text)
    if bp_match:
        vitals["bp"] = f"{bp_match.group(1)}/{bp_match.group(2)}"
    return {"language": language, "symptoms": symptoms, "vitals": vitals}


def parse_spoken_text_to_clinical_data(transcript: str, language: str = "unknown") -> dict[str, Any]:
    """Compatibility name for local spoken-intake parsing used by emergency agents."""

    return parse_voice_transcript(transcript, language)
