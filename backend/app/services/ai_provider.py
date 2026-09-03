"""AI provider abstraction for ARROH case-taking.

The platform never couples the safety-critical triage path to a specific
commercial LLM. All call sites use the :class:`AIProvider` protocol so the
same structured case-taking flow can run against:

* :class:`MockAIProvider` – deterministic, network-free, used by tests and the
  default mobile build. Multilingual keyword normalisation + canned
  follow-up question generation.
* :class:`CloudLLMProvider` – activated only when an API key + base URL are
  configured through environment variables. Never used in the deterministic
  safety path; the result is *advisory* until the safety engine confirms.

Safety invariant: the :class:`app.services.ai_triage.assess_symptom_triage`
engine is the only source of ``triage_level``. The AI provider returns
``extracted_symptoms`` and ``recommended_followups``; the caller must
re-evaluate with the deterministic engine and may NEVER downgrade a RED
result based on the AI output.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Structured data classes
# ---------------------------------------------------------------------------


@dataclass
class ExtractedSymptom:
    """One structured symptom extracted by the AI provider."""

    symptom: str
    body_location: str | None = None
    onset: str | None = None
    duration: str | None = None
    severity: str | None = None
    associated: list[str] = field(default_factory=list)
    confidence: float = 0.0
    source: str = "USER_TEXT"
    confirmed_by_user: bool = False


@dataclass
class StructuredCase:
    """The full structured representation of a patient complaint.

    Every field is explicit and ``None`` is a real value meaning
    *not provided by the patient / AI* – the safety engine is responsible
    for treating those as "missing" rather than inventing a value.
    """

    symptoms: list[ExtractedSymptom] = field(default_factory=list)
    duration: str | None = None
    severity: str | None = None
    location: str | None = None
    associated_symptoms: list[str] = field(default_factory=list)
    pregnancy_status: str | None = None  # "PREGNANT" | "NOT_PREGNANT" | "UNKNOWN"
    injury: str | None = None
    medications: list[str] = field(default_factory=list)
    allergies: list[str] = field(default_factory=list)
    relevant_vitals: dict[str, float] = field(default_factory=dict)
    language: str = "unknown"
    raw_transcript: str = ""
    overall_confidence: float = 0.0
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symptoms": [self._symptom_to_dict(s) for s in self.symptoms],
            "duration": self.duration,
            "severity": self.severity,
            "location": self.location,
            "associated_symptoms": self.associated_symptoms,
            "pregnancy_status": self.pregnancy_status,
            "injury": self.injury,
            "medications": self.medications,
            "allergies": self.allergies,
            "relevant_vitals": self.relevant_vitals,
            "language": self.language,
            "raw_transcript": self.raw_transcript,
            "overall_confidence": round(self.overall_confidence, 2),
            "notes": self.notes,
        }

    @staticmethod
    def _symptom_to_dict(symptom: ExtractedSymptom) -> dict[str, Any]:
        return {
            "symptom": symptom.symptom,
            "body_location": symptom.body_location,
            "onset": symptom.onset,
            "duration": symptom.duration,
            "severity": symptom.severity,
            "associated": symptom.associated,
            "confidence": round(symptom.confidence, 2),
            "source": symptom.source,
            "confirmed_by_user": symptom.confirmed_by_user,
        }


@dataclass
class FollowUpQuestion:
    """A short, safe follow-up question to ask the patient next."""

    question_id: str
    prompt: str
    prompt_translations: dict[str, str] = field(default_factory=dict)
    expected_kind: str = "yes_no"  # "yes_no" | "text" | "choice" | "vital"
    choices: list[str] = field(default_factory=list)
    priority: int = 100  # lower = ask sooner; emergency questions are 0-9
    safety_reason: str = ""

    def localized(self, language: str) -> str:
        return self.prompt_translations.get(language, self.prompt)


# ---------------------------------------------------------------------------
# Multilingual symptom lexicon
# ---------------------------------------------------------------------------


_CLINICAL_TERMS: dict[str, dict[str, tuple[str, ...]]] = {
    "chest pain": {
        "en": ("chest pain", "chest hurts", "pain in chest"),
        "kn": ("ಎದೆ ನೋವು", "ಮೆದೆ ನೋವು", "ಎದೆಯಲ್ಲಿ ನೋವು"),
        "hi": ("seene mein dard", "chati mein dard", "chest mein dard"),
        "ta": ("மார்பு வலி", "மார்பில் வலி", "marapu vali", "marapula vali"),
        "te": ("ఛాతీ నొప్పి", "ఛాతీలో నొప్పి", "chati noppi"),
    },
    "shortness of breath": {
        "en": ("shortness of breath", "breathlessness", "difficulty breathing", "cannot breathe"),
        "kn": ("ಉಸಿರಾಡಲು ಕಷ್ಟ", "ಉಸಿರಾಟದ ತೊಂದರೆ"),
        "hi": ("saans lene mein takleef", "sans ki takleef", "sans nahi aa rahi", "saans nahi aa rahi"),
        "ta": ("மூச்சு திணறல்", "மூச்சு விடுவதில் சிரமம்"),
        "te": ("శ్వాస ఆడకపోవడం", "ఊపిరి ఇబ్బంది"),
    },
    "high fever": {
        "en": ("high fever", "fever", "temperature", "burning up"),
        "kn": ("ಜ್ವರ", "ಬಿಸಿ"),
        "hi": ("bukhar", "tej bukhar", "jwara"),
        "ta": ("காய்ச்சல்", "உடல் சூடு"),
        "te": ("జ్వరం", "వేడి"),
    },
    "severe headache": {
        "en": ("severe headache", "bad headache", "splitting headache"),
        "kn": ("ತೀವ್ರ ತಲೆನೋವು", "ತಲೆನೋವು"),
        "hi": ("tej sir dard", "sir mein dard", "sakht sar dard"),
        "ta": ("கடுமையான தலைவலி", "தலைவலி"),
        "te": ("తీవ్రమైన తలనొప్పి", "తలనొప్పి"),
    },
    "blurred vision": {
        "en": ("blurred vision", "blurry vision", "cannot see clearly"),
        "kn": ("ಮಸುಕು ದೃಷ್ಟಿ", "ಕಣ್ಣು ಮಸುಕು", "ಕಣ್ಣು ಮಸುಕಾಗಿದೆ", "ಮಸುಕಾಗಿದೆ"),
        "hi": ("dikhai nahi de raha", "aankh dhundhli"),
        "ta": ("பார்வை மங்கல்", "கண் மங்கல்"),
        "te": ("చూపు మసక", "కంటి చూపు తగ్గడం"),
    },
    "facial swelling": {
        "en": ("facial swelling", "swollen face", "puffy face"),
        "kn": ("ಮುಖ ಊದಿಕೊಂಡಿದೆ", "ಮುಖ ಬಾವು"),
        "hi": ("chehra suja hua", "muh par sujan"),
        "ta": ("முக வீக்கம்", "முகம் வீங்கியது"),
        "te": ("ముఖం వాపు", "ముఖం ఉబ్బడం"),
    },
    "abnormal bleeding": {
        "en": ("bleeding", "abnormal bleeding", "heavy bleeding", "blood loss"),
        "kn": ("ರಕ್ತಸ್ರಾವ", "ರಕ್ತ ಹೋಗುತ್ತಿದೆ"),
        "hi": ("khoon beh raha", "raktasrav"),
        "ta": ("இரத்தப்போக்கு", "இரம் வடிகிறது"),
        "te": ("రక్తస్రావం", "రక్తం పోతోంది"),
    },
    "snakebite": {
        "en": ("snakebite", "snake bite", "bitten by snake"),
        "kn": ("ಹಾವು ಕಚ್ಚಿದೆ", "ಹಾವು ಕಡಿತ"),
        "hi": ("saamp kaat", "sarp dansh"),
        "ta": ("பாம்பு கடி", "பாம்பு கடித்தது"),
        "te": ("పాము కాటు", "పాము కాటేసింది"),
    },
    "accident": {
        "en": ("accident", "road accident", "bike accident", "fell down", "met with an accident"),
        "kn": ("ಅಪಘಾತ", "ಬಿದ್ದೆ", "ಕೆಡವಿಕೊಂಡೆ"),
        "hi": ("accident", "hadsa", "gir gaya", "giri"),
        "ta": ("விபத்து", "கீழே விழுந்தேன்"),
        "te": ("ప్రమాదం", "కింద పడిపోయాను"),
    },
    "unconscious": {
        "en": ("unconscious", "not responding", "fainted", "passed out"),
        "kn": ("ಪ್ರಜ್ಞೆ ಹೋಗಿದೆ", "ಸುಸ್ತು"),
        "hi": ("behosh", "hosh nahi"),
        "ta": ("மயக்கம்", "நினைவு இல்லை"),
        "te": ("స్పృహ లేదు", "బోధ పోయింది"),
    },
    "pregnant": {
        "en": ("pregnant", "pregnancy", "expecting", "i am pregnant"),
        "kn": ("ಗರ್ಭಿಣಿ", "ಹೆರಿಗೆ"),
        "hi": ("garbhvati", "pregnant hu", "pet mein"),
        "ta": ("கர்ப்பமாக", "கர்ப்பிணி"),
        "te": ("గర్భం", "గర్భిణి"),
    },
    "vomiting": {
        "en": ("vomiting", "throwing up", "nauseous", "puking"),
        "kn": ("ವಾಂತಿ", "ವಾಕರಿಕೆ"),
        "hi": ("ulti", "ji machla"),
        "ta": ("வாந்தி", "குமட்டல்"),
        "te": ("వాంతులు", "వికారం"),
    },
    "abdominal pain": {
        "en": ("abdominal pain", "stomach pain", "tummy ache", "belly pain"),
        "kn": ("ಹೊಟ್ಟೆ ನೋವು", "ಉದರ ನೋವು"),
        "hi": ("pet dard", "tummy dard"),
        "ta": ("வயிற்று வலி", "வயிறு வலிக்கிறது"),
        "te": ("కడుపు నొప్పి", "ఉదర నొప్పి"),
    },
    "diarrhea": {
        "en": ("diarrhea", "loose stools", "watery stools"),
        "kn": ("ಅತಿಸಾರ", "ಬೇದಿ"),
        "hi": ("dast", "loose motion"),
        "ta": ("வயிற்றுப்போக்கு", "பேதி"),
        "te": ("విరేచనాలు", "డయేరియా"),
    },
}

_PREGNANCY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "en": ("pregnant", "pregnancy", "expecting", "i am pregnant"),
    "kn": ("ಗರ್ಭಿಣಿ", "ಗರ್ಭ", "ಹೆರಿಗೆ"),
    "hi": ("garbhvati", "pregnant", "pet mein bachcha"),
    "ta": ("கர்ப்பிணி", "கர்ப்பம்"),
    "te": ("గర్భిణి", "గర్భం"),
}

_EMERGENCY_INTENTS: dict[str, tuple[str, ...]] = {
    "en": (
        "i cannot breathe", "can't breathe", "unconscious", "not breathing",
        "accident", "snakebite", "snake bite", "severe bleeding", "bleeding heavily",
        "chest pain", "stroke", "seizure", "convulsion", "met with an accident",
        "fell from", "head injury",
    ),
    "kn": (
        "ಉಸಿರಾಡಲಾಗುತ್ತಿಲ್ಲ", "ಪ್ರಜ್ಞೆ ಹೋಗಿದೆ", "ಅಪಘಾತ", "ಹಾವು ಕಚ್ಚಿದೆ",
        "ರಕ್ತಸ್ರಾವ", "ಎದೆ ನೋವು", "ತಲೆ ಪೆಟ್ಟು",
    ),
    "hi": (
        "saans nahi aa rahi", "behosh", "hadsa", "saamp kaat",
        "khoon beh raha", "seene mein dard", "sar par chot",
    ),
    "ta": (
        "மூச்சு வரவில்லை", "mookku varavillai", "mookku varala", "மயக்கம்", "விபத்து", "பாம்பு கடி",
        "இரத்தப்போக்கு", "மார்பு வலி",
    ),
    "te": (
        "శ్వాస ఆడడం లేదు", "స్పృహ లేదు", "ప్రమాదం", "పాము కాటు",
        "రక్తస్రావం", "ఛాతీ నొప్పి",
    ),
}

_FOLLOWUP_QUESTIONS: dict[str, dict[str, str]] = {
    "q_chest_pain_onset": {
        "en": "When did the chest pain start?",
        "kn": "ಎದೆ ನೋವು ಯಾವಾಗ ಪ್ರಾರಂಭವಾಯಿತು?",
        "hi": "Seene mein dard kab se hai?",
        "ta": "மார்பு வலி எப்போது தொடங்கியது?",
        "te": "ఛాతీ నొప్పి ఎప్పుడు మొదలైంది?",
    },
    "q_breathing_difficulty": {
        "en": "Are you having difficulty breathing right now?",
        "kn": "ಈಗ ಉಸಿರಾಡಲು ತೊಂದರೆಯಾಗುತ್ತಿದೆಯೇ?",
        "hi": "Kya abhi saans lene mein takleef ho rahi hai?",
        "ta": "இப்போது மூச்சு விடுவதில் சிரமமா?",
        "te": "ఇప్పుడు శ్వాస తీసుకోవడంలో ఇబ్బంది ఉందా?",
    },
    "q_pregnancy_confirm": {
        "en": "Are you pregnant, or could you be pregnant?",
        "kn": "ನೀವು ಗರ್ಭಿಣಿಯಾಗಿದ್ದೀರಾ, ಅಥವಾ ಗರ್ಭಿಣಿಯಾಗಿರಬಹುದಾ?",
        "hi": "Kya aap pregnant hain, ya ho sakti hain?",
        "ta": "நீங்கள் கர்ப்பமாக இருக்கிறீர்களா?",
        "te": "మీరు గర్భిణీనా, లేదా అవ్వొచ్చా?",
    },
    "q_vitals_spo2": {
        "en": "What is the oxygen saturation (SpO2) reading, if available?",
        "kn": "ಆಮ್ಲಜನಕ ಸ್ಯಾಚುರೇಶನ್ (SpO2) ಓದು ಎಷ್ಟು?",
        "hi": "Oxygen saturation (SpO2) kitna hai?",
        "ta": "Oxygen saturation (SpO2) எவ்வளவு?",
        "te": "Oxygen saturation (SpO2) ఎంత?",
    },
    "q_injury_mechanism": {
        "en": "How did the injury happen?",
        "kn": "ಗಾಯ ಹೇಗೆ ಆಯಿತು?",
        "hi": "Chot kaise lagi?",
        "ta": "காயம் எப்படி ஏற்பட்டது?",
        "te": "గాయం ఎలా జరిగింది?",
    },
    "q_loss_of_consciousness": {
        "en": "Did the person lose consciousness, even briefly?",
        "kn": "ವ್ಯಕ್ತಿಗೆ ಪ್ರಜ್ಞೆ ಹೋಗಿತ್ತೇ, ಸ್ವಲ್ಪ ಸಮಯವಾದರೂ?",
        "hi": "Kya vyakti behosh hua, chahe thodi der ke liye?",
        "ta": "நபர் சிறிது நேரமாவது மயக்கமானாரா?",
        "te": "వ్యక్తి స్పృహ కోల్పోయారా, కొద్దిసేపైనా?",
    },
    "q_active_bleeding": {
        "en": "Is there active bleeding right now?",
        "kn": "ಈಗ ರಕ್ತಸ್ರಾವ ನಡೆಯುತ್ತಿದೆಯೇ?",
        "hi": "Kya abhi khoon beh raha hai?",
        "ta": "இப்போது இரத்தப்போக்கு உள்ளதா?",
        "te": "ఇప్పుడు రక్తస్రావం జరుగుతోందా?",
    },
    "q_pregnancy_weeks": {
        "en": "How many weeks pregnant are you?",
        "kn": "ನೀವು ಎಷ್ಟು ವಾರ ಗರ್ಭಿಣಿಯಾಗಿದ್ದೀರಿ?",
        "hi": "Aap kitne hafte ki garbhvati hain?",
        "ta": "நீங்கள் எத்தனை வாரம் கர்ப்பிணி?",
        "te": "మీరు ఎన్ని వారాలు గర్భిణీ?",
    },
    "q_last_meal": {
        "en": "When did the person last eat or drink?",
        "kn": "ವ್ಯಕ್ತಿ ಕೊನೆಯದಾಗಿ ಯಾವಾಗ ತಿಂಡಿ ಅಥವಾ ಕುಡಿದರು?",
        "hi": "Vyakti ne aakhri baar khana ya paani kab liya?",
        "ta": "நபர் கடைசியாக எப்போது சாப்பிட்டார்?",
        "te": "వ్యక్తి ఆఖరుగా ఎప్పుడు తిన్నారు/తాగారు?",
    },
}

# Lookup table for body-location / onset / severity by language.
_BODY_LOCATION_HINTS: dict[str, dict[str, tuple[str, ...]]] = {
    "en": {"chest": ("chest",), "head": ("head", "skull"), "abdomen": ("stomach", "belly", "abdomen", "tummy")},
    "kn": {"chest": ("ಎದೆ",), "head": ("ತಲೆ",), "abdomen": ("ಹೊಟ್ಟೆ",)},
    "hi": {"chest": ("seene", "chati"), "head": ("sar",), "abdomen": ("pet", "tummy")},
    "ta": {"chest": ("மார்பு",), "head": ("தலை",), "abdomen": ("வயிறு",)},
    "te": {"chest": ("ఛాతీ",), "head": ("తల",), "abdomen": ("కడుపు",)},
}

_DURATION_PATTERN = re.compile(
    r"(\d+\s*(?:minute|minutes|min|hour|hours|hr|day|days|week|weeks|month|months|ನಿಮಿಷ|ಗಂಟೆ|ದಿನ|ವಾರ|मिनट|घंटे|दिन|महीना|நிமிடம்|மணி|நாள்|నిమిషం|గంట|రోజు).*)",
    re.IGNORECASE,
)

_VITAL_PATTERNS: dict[str, re.Pattern[str]] = {
    "spo2": re.compile(r"(?:spo\s*2|oxygen(?:\s+saturation)?)\s*(?:is|of|equals)?\s*(\d{2,3}(?:\.\d+)?)", re.IGNORECASE),
    "heart_rate": re.compile(r"(?:heart\s*rate|pulse|hr)\s*(?:is|of|equals)?\s*(\d{2,3}(?:\.\d+)?)", re.IGNORECASE),
    "temperature": re.compile(r"(?:temperature|temp)\s*(?:is|of|equals)?\s*(\d{2,3}(?:\.\d+)?)", re.IGNORECASE),
    "hemoglobin": re.compile(r"(?:hemoglobin|haemoglobin|hgb)(?:\s*(?:is|of|equals))?\s*(\d{1,2}(?:\.\d+)?)", re.IGNORECASE),
}

_BP_PATTERN = re.compile(r"(?:bp|blood\s*pressure)(?:\s*(?:is|of))?\s*(\d{2,3})\s*(?:/|over)\s*(\d{2,3})", re.IGNORECASE)


def _normalise(text: str) -> str:
    return text.strip().lower()


def _pick_language(text: str) -> str:
    """Best-effort language detection for the supported four languages.

    The detection is a coarse script hint. If no language can be inferred
    we return ``unknown`` and callers should treat the result as
    language-agnostic.
    """

    for char in text:
        code = ord(char)
        if 0x0C80 <= code <= 0x0CFF:  # Kannada
            return "kn"
        if 0x0900 <= code <= 0x097F:  # Devanagari (Hindi)
            return "hi"
        if 0x0B80 <= code <= 0x0BFF:  # Tamil
            return "ta"
        if 0x0C00 <= code <= 0x0C7F:  # Telugu
            return "te"
    return "en"


# ---------------------------------------------------------------------------
# Provider protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class AIProvider(Protocol):
    """The contract every AI provider must satisfy."""

    name: str

    def extract_symptoms(
        self, text: str, language: str | None = None
    ) -> tuple[StructuredCase, list[FollowUpQuestion]]:
        """Parse a free-text transcript into a structured case + follow-ups."""

    def summarise_case(
        self, case: StructuredCase, language: str = "en"
    ) -> str:
        """Produce a short, safe patient-facing summary in the chosen language."""


# ---------------------------------------------------------------------------
# Mock implementation
# ---------------------------------------------------------------------------


class MockAIProvider:
    """Deterministic, offline-capable AI provider used by tests + mobile.

    The mock never calls a network service. It uses the multilingual keyword
    lexicon plus the regular-expression vital extractor, so tests can assert
    on the same behaviour the production mock would produce.
    """

    name = "mock"

    def extract_symptoms(
        self, text: str, language: str | None = None
    ) -> tuple[StructuredCase, list[FollowUpQuestion]]:
        if not text or not text.strip():
            raise ValueError("Cannot extract symptoms from empty text")
        detected_language = language or _pick_language(text)
        lower_text = _normalise(text)

        case = StructuredCase(
            language=detected_language,
            raw_transcript=text,
            relevant_vitals=self._extract_vitals(text),
        )

        confidence_by_term: dict[str, float] = {}
        for clinical_term, by_lang in _CLINICAL_TERMS.items():
            phrases = by_lang.get(detected_language, by_lang.get("en", ()))
            if not phrases:
                continue
            if any(phrase.lower() in lower_text for phrase in phrases):
                confidence_by_term[clinical_term] = 0.85
                location = self._infer_body_location(lower_text, detected_language)
                onset = self._extract_onset(text)
                case.symptoms.append(
                    ExtractedSymptom(
                        symptom=clinical_term,
                        body_location=location if clinical_term in {"chest pain", "abdominal pain", "severe headache", "facial swelling", "blurred vision"} else None,
                        onset=onset,
                        severity="moderate",
                        associated=[],
                        confidence=0.85,
                        source="USER_TEXT",
                        confirmed_by_user=False,
                    )
                )

        if any(p in lower_text for p in _PREGNANCY_KEYWORDS.get(detected_language, ())):
            case.pregnancy_status = "PREGNANT"
        elif any(p in lower_text for p in ("not pregnant", "not pregnant", "no pregnancy")):
            case.pregnancy_status = "NOT_PREGNANT"

        duration_match = _DURATION_PATTERN.search(text)
        if duration_match:
            case.duration = duration_match.group(1).strip()
        if "severe" in lower_text or "ತೀವ್ರ" in text or "तीव्र" in text or "கடுமையான" in text:
            case.severity = "severe"
        elif "mild" in lower_text:
            case.severity = "mild"

        if confidence_by_term:
            case.overall_confidence = max(confidence_by_term.values())

        follow_ups = self._generate_followups(case, detected_language)
        return case, follow_ups

    def summarise_case(self, case: StructuredCase, language: str = "en") -> str:
        if case.symptoms:
            chief = ", ".join(symptom.symptom for symptom in case.symptoms[:3])
        else:
            chief = "no symptoms extracted"
        if case.pregnancy_status == "PREGNANT":
            chief += " (pregnant patient)"
        return f"Chief concern: {chief}. Duration: {case.duration or 'unknown'}. Severity: {case.severity or 'unknown'}."

    # --- internal helpers ------------------------------------------------

    def _extract_vitals(self, text: str) -> dict[str, float]:
        vitals: dict[str, float] = {}
        for key, pattern in _VITAL_PATTERNS.items():
            match = pattern.search(text)
            if match:
                value = float(match.group(1))
                if key == "temperature" and value > 45:
                    value = round((value - 32) * 5 / 9, 1)
                vitals[key] = value
        bp = _BP_PATTERN.search(text)
        if bp:
            vitals["systolic_bp"] = float(bp.group(1))
            vitals["diastolic_bp"] = float(bp.group(2))
        return vitals

    def _infer_body_location(self, text: str, language: str) -> str | None:
        for location, phrases in _BODY_LOCATION_HINTS.get(language, {}).items():
            if any(phrase in text for phrase in phrases):
                return location
        return None

    def _extract_onset(self, text: str) -> str | None:
        match = _DURATION_PATTERN.search(text)
        return match.group(1).strip() if match else None

    def _generate_followups(self, case: StructuredCase, language: str) -> list[FollowUpQuestion]:
        follow_ups: list[FollowUpQuestion] = []
        symptoms = {s.symptom for s in case.symptoms}
        if "chest pain" in symptoms:
            follow_ups.append(self._build_question("q_chest_pain_onset", priority=10, safety_reason="Acute coronary syndrome"))
            follow_ups.append(self._build_question("q_breathing_difficulty", priority=5, safety_reason="Respiratory compromise"))
            follow_ups.append(self._build_question("q_loss_of_consciousness", priority=2, safety_reason="Syncope"))
        if "shortness of breath" in symptoms:
            follow_ups.append(self._build_question("q_vitals_spo2", priority=4, safety_reason="Hypoxemia"))
        if "severe headache" in symptoms or "blurred vision" in symptoms or "facial swelling" in symptoms:
            follow_ups.append(self._build_question("q_pregnancy_confirm", priority=6, safety_reason="Pre-eclampsia danger signs"))
        if case.pregnancy_status == "PREGNANT":
            follow_ups.append(self._build_question("q_pregnancy_weeks", priority=8, safety_reason="Gestational age"))
        if "abnormal bleeding" in symptoms or "snakebite" in symptoms or "accident" in symptoms:
            follow_ups.append(self._build_question("q_active_bleeding", priority=1, safety_reason="Active hemorrhage"))
            follow_ups.append(self._build_question("q_injury_mechanism", priority=3, safety_reason="Trauma triage"))
            follow_ups.append(self._build_question("q_last_meal", priority=15, safety_reason="Anesthesia planning"))
        follow_ups.sort(key=lambda question: (question.priority, question.question_id))
        return follow_ups

    def _build_question(self, key: str, *, priority: int, safety_reason: str) -> FollowUpQuestion:
        translations = _FOLLOWUP_QUESTIONS[key]
        return FollowUpQuestion(
            question_id=key,
            prompt=translations["en"],
            prompt_translations=translations,
            priority=priority,
            safety_reason=safety_reason,
            expected_kind="text" if "vitals" in key else "yes_no",
        )


# ---------------------------------------------------------------------------
# Cloud LLM implementation (advisory only)
# ---------------------------------------------------------------------------


class CloudLLMProvider:
    """Provider backed by an OpenAI-compatible chat completions endpoint.

    Disabled by default. Activated only when the ``ARROH_LLM_API_KEY`` and
    ``ARROH_LLM_BASE_URL`` environment variables are set, and when the
    explicit ``enabled=True`` flag is passed.

    The provider returns *advisory* structured data; the deterministic safety
    engine is the only source of truth for triage_level and the caller must
    re-evaluate every result.
    """

    name = "cloud"

    def __init__(self, api_key: str | None = None, base_url: str | None = None, model: str = "gpt-4o-mini", enabled: bool = False) -> None:
        self._api_key = api_key or os.environ.get("ARROH_LLM_API_KEY")
        self._base_url = base_url or os.environ.get("ARROH_LLM_BASE_URL", "https://api.openai.com/v1")
        self._model = model
        self._enabled = bool(enabled and self._api_key)

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    def extract_symptoms(
        self, text: str, language: str | None = None
    ) -> tuple[StructuredCase, list[FollowUpQuestion]]:
        # Cloud provider is advisory. When disabled (the default in any
        # environment without an explicit key) we fall back to the mock so the
        # patient never gets a degraded experience. Production deployments
        # flip ``enabled`` to True once compliance + safety review approve.
        if not self._enabled:
            logger.info("CloudLLMProvider invoked but disabled – delegating to MockAIProvider")
            return MockAIProvider().extract_symptoms(text, language=language)

        # Real call site. We intentionally do not ship the network call as
        # part of the deterministic code path: the safety engine must remain
        # runnable when the network is unavailable or when the model is
        # misconfigured. The HTTP call lives behind a guarded import so the
        # package keeps zero mandatory runtime dependencies.
        try:
            import httpx  # type: ignore[import-not-found]
        except ImportError:  # pragma: no cover - optional dependency
            logger.warning("httpx not installed – falling back to MockAIProvider")
            return MockAIProvider().extract_symptoms(text, language=language)

        system_prompt = (
            "You are an offline-first clinical intake assistant. Return a JSON object with keys "
            "symptoms, duration, severity, location, associated_symptoms, pregnancy_status, injury, "
            "medications, allergies, relevant_vitals, follow_up_questions. Do NOT diagnose. Do NOT "
            "downgrade any safety flag. Do NOT invent information; use null for unknowns."
        )
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
        }
        try:
            response = httpx.post(
                f"{self._base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=payload,
                timeout=15.0,
            )
            response.raise_for_status()
        except Exception as exc:  # pragma: no cover - network path
            logger.warning("Cloud LLM call failed: %s – falling back to mock", exc)
            return MockAIProvider().extract_symptoms(text, language=language)

        content = response.json()["choices"][0]["message"]["content"]
        try:
            data = __import__("json").loads(content)
        except ValueError:  # pragma: no cover
            return MockAIProvider().extract_symptoms(text, language=language)

        case = StructuredCase(
            symptoms=[ExtractedSymptom(**item) for item in data.get("symptoms", []) if isinstance(item, dict)],
            duration=data.get("duration"),
            severity=data.get("severity"),
            location=data.get("location"),
            associated_symptoms=list(data.get("associated_symptoms", [])),
            pregnancy_status=data.get("pregnancy_status"),
            injury=data.get("injury"),
            medications=list(data.get("medications", [])),
            allergies=list(data.get("allergies", [])),
            relevant_vitals={k: float(v) for k, v in (data.get("relevant_vitals") or {}).items()},
            language=language or "unknown",
            raw_transcript=text,
            overall_confidence=float(data.get("overall_confidence", 0.0)),
        )
        follow_ups = [
            FollowUpQuestion(
                question_id=str(item.get("id", f"q_{index}")),
                prompt=str(item.get("prompt", "")),
                prompt_translations=item.get("translations", {}) or {},
                expected_kind=str(item.get("kind", "yes_no")),
                priority=int(item.get("priority", 100)),
                safety_reason=str(item.get("safety_reason", "")),
            )
            for index, item in enumerate(data.get("follow_up_questions", []))
        ]
        return case, follow_ups

    def summarise_case(self, case: StructuredCase, language: str = "en") -> str:
        if not self._enabled:
            return MockAIProvider().summarise_case(case, language)
        return MockAIProvider().summarise_case(case, language)


# ---------------------------------------------------------------------------
# Emergency short-circuit detector
# ---------------------------------------------------------------------------


def is_emergency_intent(text: str, language: str | None = None) -> bool:
    """Return True if the transcript clearly indicates an emergency.

    The detector is intentionally narrow; false negatives are acceptable
    because the safety engine will still catch them. False positives are
    costly because they bypass the conversational questionnaire.
    """

    lang = language or _pick_language(text)
    normalised = _normalise(text)
    for phrase in _EMERGENCY_INTENTS.get(lang, ()) + _EMERGENCY_INTENTS.get("en", ()):
        if phrase.lower() in normalised:
            return True
    return False


# ---------------------------------------------------------------------------
# Module-level factory
# ---------------------------------------------------------------------------


def get_default_provider() -> AIProvider:
    """Return the provider configured for the current process.

    Order: explicit cloud env vars (if enabled) > mock. The mock is always
    available; the cloud provider is opt-in and never blocks the safety path.
    """

    cloud = CloudLLMProvider()
    if cloud.is_enabled:
        return cloud
    return MockAIProvider()
