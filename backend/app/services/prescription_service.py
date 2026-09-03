"""Multilingual, low-literacy prescription guidance and follow-up scheduling."""

from app.schemas.prescription import MedicationInstructionSchema

_FREQUENCY_TEXT = {
    "english": {"ONCE_DAILY": "once a day", "TWICE_DAILY": "twice a day", "THRICE_DAILY": "three times a day", "AS_NEEDED": "when needed"},
    "hindi": {"ONCE_DAILY": "दिन में एक बार", "TWICE_DAILY": "दिन में दो बार", "THRICE_DAILY": "दिन में तीन बार", "AS_NEEDED": "ज़रूरत पड़ने पर"},
    "kannada": {"ONCE_DAILY": "ದಿನಕ್ಕೆ ಒಮ್ಮೆ", "TWICE_DAILY": "ದಿನಕ್ಕೆ ಎರಡು ಬಾರಿ", "THRICE_DAILY": "ದಿನಕ್ಕೆ ಮೂರು ಬಾರಿ", "AS_NEEDED": "ಅಗತ್ಯವಿದ್ದಾಗ"},
    "tamil": {"ONCE_DAILY": "ஒரு நாளுக்கு ஒரு முறை", "TWICE_DAILY": "ஒரு நாளுக்கு இரண்டு முறை", "THRICE_DAILY": "ஒரு நாளுக்கு மூன்று முறை", "AS_NEEDED": "தேவைப்படும் போது"},
    "telugu": {"ONCE_DAILY": "రోజుకు ఒకసారి", "TWICE_DAILY": "రోజుకు రెండుసార్లు", "THRICE_DAILY": "రోజుకు మూడుసార్లు", "AS_NEEDED": "అవసరమైనప్పుడు"},
}


def generate_audio_prescription_script(language: str, medications: list[MedicationInstructionSchema]) -> str:
    """Create a short, speakable medicine script using visual identifiers for recall."""

    normalized_language = language.lower() if language.lower() in _FREQUENCY_TEXT else "english"
    frequency_map = _FREQUENCY_TEXT[normalized_language]
    instructions = [
        f"{medicine.visual_identifier}: {medicine.name}, {medicine.dosage}, {frequency_map[medicine.frequency]}, for {medicine.duration_days} days."
        for medicine in medications
    ]
    prefix = {
        "english": "Medicine guidance:", "hindi": "दवा की सलाह:", "kannada": "ಔಷಧಿ ಸೂಚನೆ:", "tamil": "மருந்து வழிகாட்டுதல்:", "telugu": "మందుల సూచన:",
    }[normalized_language]
    return f"{prefix} " + " ".join(instructions) + " Contact your ASHA worker if symptoms worsen."
