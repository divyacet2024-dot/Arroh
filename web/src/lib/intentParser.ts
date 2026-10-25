/**
 * intentParser — structured spoken-language intent classifier for ARROH.
 *
 * Design: a data-driven pattern table, not a giant if/else chain.
 * Each intent has a priority weight so that more specific phrases win.
 *
 * Auth intents (Welcome screen):
 *   ROLE_PATIENT / ROLE_DOCTOR / ROLE_ASHA
 *   AUTH_PHONE_OTP / AUTH_EMAIL / AUTH_HELP / LANGUAGE_CHANGE
 *
 * Healthcare intents (PatientHome agent):
 *   GREET           — general greeting / hello
 *   COLLECT_SYMPTOMS — patient describing symptoms / illness
 *   BOOK_APPOINTMENT — patient wants to see a doctor / book a slot
 *   GET_PRESCRIPTION — patient asking about medicines / prescription
 *   FIND_FACILITY    — patient asking about hospital / PHC / clinic
 *   EMERGENCY        — urgent / emergency indicators
 *   GET_FOLLOWUP     — asking about follow-up date / reminder
 *   UNKNOWN          — could not classify
 */

export type Intent =
  | 'ROLE_PATIENT'
  | 'ROLE_DOCTOR'
  | 'ROLE_ASHA'
  | 'AUTH_PHONE_OTP'
  | 'AUTH_EMAIL'
  | 'AUTH_HELP'
  | 'LANGUAGE_CHANGE'
  | 'GREET'
  | 'COLLECT_SYMPTOMS'
  | 'BOOK_APPOINTMENT'
  | 'GET_PRESCRIPTION'
  | 'FIND_FACILITY'
  | 'EMERGENCY'
  | 'GET_FOLLOWUP'
  | 'UNKNOWN';

export interface IntentResult {
  intent: Intent;
  confidence: 'high' | 'medium' | 'low';
  matched: string;
}

interface IntentRule {
  intent: Intent;
  priority: number;          // higher = checked first
  patterns: RegExp[];
}

// ── Rule table ───────────────────────────────────────────────────────────────
// Each RegExp is tested against the lowercased, whitespace-normalised input.
// Use non-capturing groups. Do NOT use greedy anchors unless the phrase is
// always a full utterance.

const RULES: IntentRule[] = [
  // ── Email authentication (checked before generic login)
  {
    intent: 'AUTH_EMAIL',
    priority: 90,
    patterns: [
      /email.*log[io]n/,
      /login.*email/,
      /log.*email/,
      /email.*log/,
      /email.*login/,
      /sign.*email/,
      /ಇಮೇಲ್.*ಲಾಗಿನ್/,
      /ಇಮೇಲ್.*ಮೂಲಕ/,
      /email.*use/,
      /use.*email/,
      /have.*email/,
      /i.*have.*email/,
      /email.*account/,
      /doctor.*login/,
      /login.*doctor/,
      /staff.*login/,
    ],
  },

  // ── Phone OTP authentication
  {
    intent: 'AUTH_PHONE_OTP',
    priority: 85,
    patterns: [
      /mobile.*otp/,
      /otp.*mobile/,
      /phone.*otp/,
      /otp.*phone/,
      /ಮೊಬೈಲ್.*otp/,
      /ಮೊಬೈಲ್.*login/,
      /otp.*login/,
      /mobile.*login/,
      /ಮೊಬೈಲ್.*ಮೂಲಕ/,
      /mobile.*number/,
      /phone.*number/,
    ],
  },

  // ── Role: Doctor (check before patient because "doctor patient" should be doctor)
  {
    intent: 'ROLE_DOCTOR',
    priority: 70,
    patterns: [
      /\bdoctor\b/,
      /\bdr\b/,
      /\bphysician\b/,
      /\bsurgeon\b/,
      /ವೈದ್ಯ/,
      /ಡಾಕ್ಟರ್/,
      /डॉक्टर/,
      /மருத்துவர்/,
      /వైద్యుడు/,
      /ഡോക്ടർ/,
      /docter/,
    ],
  },

  // ── Role: ASHA / health worker
  {
    intent: 'ROLE_ASHA',
    priority: 75,
    patterns: [
      /\basha\b/,
      /\banm\b/,
      /health.*worker/,
      /worker.*health/,
      /field.*worker/,
      /community.*health/,
      /ಆರೋಗ್ಯ.*ಕಾರ್ಯಕರ್ತ/,
      /स्वास्थ्यकर्मी/,
      /ஆரோக்கியம்.*பணியாளர்/,
    ],
  },

  // ── Role: Patient
  {
    intent: 'ROLE_PATIENT',
    priority: 60,
    patterns: [
      /\bpatient\b/,
      /\bpatients\b/,
      /ರೋಗಿ/,
      /रोगी/,
      /நோயாளி/,
      /రోగి/,
      /രോഗി/,
      /\bsick\b/,
      /\bill\b/,
      /unwell/,
      /treatment/,
      /medicine/,
      /hospital/,
      /ಆಸ್ಪತ್ರೆ/,
      /ಔಷಧ/,
    ],
  },

  // ── Language change
  {
    intent: 'LANGUAGE_CHANGE',
    priority: 50,
    patterns: [
      /kannada/,
      /hindi/,
      /telugu/,
      /tamil/,
      /english/,
      /malayalam/,
      /\blanguage\b/,
      /ಕನ್ನಡ/,
      /हिन्दी/,
      /change.*language/,
      /language.*change/,
    ],
  },

  // ── Help / confused
  {
    intent: 'AUTH_HELP',
    priority: 30,
    patterns: [
      /help/,
      /don.*know/,
      /\bwhat\b/,
      /confused/,
      /ಸಹಾಯ/,
      /मदद/,
      /how.*login/,
      /how.*use/,
    ],
  },

  // ── Greeting
  {
    intent: 'GREET',
    priority: 20,
    patterns: [
      /^(hi|hello|hey|namaskara|namaskar|vanakkam|namaste)\b/,
      /^ನಮಸ್ಕಾರ/,
      /^నమస్కారం/,
      /^வணக்கம்/,
      /^नमस्ते/,
    ],
  },

  // ── Emergency (highest healthcare priority — check before symptoms)
  {
    intent: 'EMERGENCY',
    priority: 100,
    patterns: [
      /\bemergency\b/,
      /\burgent\b/,
      /chest.*pain/,
      /heart.*attack/,
      /can.*breathe/,
      /not.*breathing/,
      /unconscious/,
      /bleeding/,
      /accident/,
      /ತುರ್ತು/,
      /ಎದೆ.*ನೋವು/,
      /ಉಸಿರಾಟ/,
      /तुरंत/,
      /आपात/,
      /అత్యవసరం/,
      /அவசரம்/,
    ],
  },

  // ── Symptom collection (patient describing illness)
  {
    intent: 'COLLECT_SYMPTOMS',
    priority: 80,
    patterns: [
      // English
      /fever|temperature|headache|pain|cough|cold|vomit|nausea|diarrhea|diarrhoea|weak|tired|rash|swelling|breathless|dizzy|sore|ache/,
      /i.*feel|feeling.*sick|not.*well|unwell|i.*have.*problem/,
      /symptom|illness|sick|disease|problem/,
      // Kannada
      /ಜ್ವರ|ಜ್ವರಮ|ತಲೆನೋವು|ನೋವು|ಕೆಮ್ಮು|ವಾಂತಿ|ದೌರ್ಬಲ್ಯ|ಶೀತ|ಬೇನೆ|ತೊಂದರೆ|ಅನಾರೋಗ್ಯ/,
      /ನನಗೆ.*ಇದೆ|ನನಗೆ.*ಆಗಿದೆ|ನಾನು.*ಅನಾರೋಗ್ಯ/,
      // Hindi
      /बुखार|सिरदर्द|दर्द|खांसी|उल्टी|थकान|कमज़ोरी|ठंड|बीमार|तकलीफ/,
      // Telugu
      /జ్వరం|తలనొప్పి|నొప్పి|దగ్గు|వాంతి|బలహీనత/,
      // Tamil
      /காய்ச்சல்|தலைவலி|வலி|இருமல்|வாந்தி|பலவீனம்/,
    ],
  },

  // ── Appointment booking
  {
    intent: 'BOOK_APPOINTMENT',
    priority: 75,
    patterns: [
      /appointment|book.*doctor|see.*doctor|meet.*doctor|visit.*doctor|doctor.*appointment/,
      /schedule|slot|available|when.*doctor/,
      // Kannada
      /ಅಪಾಯಿಂಟ್ಮೆಂಟ್|ವೈದ್ಯರನ್ನು.*ಭೇಟಿ|ವೈದ್ಯರ.*ಬಳಿ|appointment.*ಬೇಕು/,
      /ಡಾಕ್ಟರ್.*ಬೇಕು|ಡಾಕ್ಟರ್.*ತೋರಿಸು/,
      // Hindi
      /अपॉइंटमेंट|डॉक्टर.*मिलना|डॉक्टर.*दिखाना/,
      // Telugu
      /అపాయింట్‌మెంట్|డాక్టర్.*కలవాలి/,
      // Tamil
      /சந்திப்பு|டாக்டரை.*சந்திக்க/,
    ],
  },

  // ── Prescription / medicine query
  {
    intent: 'GET_PRESCRIPTION',
    priority: 72,
    patterns: [
      /medicine|medication|prescription|tablet|tablet|capsule|drug|dose|dosage/,
      /what.*take|which.*medicine|how.*take.*medicine/,
      // Kannada
      /ಔಷಧ|ಮಾತ್ರೆ|ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್|ಔಷಧಿ.*ಯಾವುದು|ಔಷಧ.*ಹೇಳಿ/,
      // Hindi
      /दवाई|दवा|गोली|प्रिस्क्रिप्शन/,
      // Telugu
      /మందు|మాత్రలు|ప్రిస్క్రిప్షన్/,
      // Tamil
      /மருந்து|மாத்திரை|மருந்து.*கேட்கிறேன்/,
    ],
  },

  // ── Find nearby facility / hospital
  {
    intent: 'FIND_FACILITY',
    priority: 70,
    patterns: [
      /hospital|clinic|phc|health.*center|health.*centre|nearest.*doctor|nearby.*doctor/,
      /where.*hospital|how.*reach|get.*directions|directions.*hospital/,
      // Kannada
      /ಆಸ್ಪತ್ರೆ|ಆರೋಗ್ಯ.*ಕೇಂದ್ರ|PHC|ಹತ್ತಿರದ.*ಆಸ್ಪತ್ರೆ|ದಿಕ್ಕು/,
      // Hindi
      /अस्पताल|स्वास्थ्य.*केंद्र|पास.*अस्पताल/,
      // Telugu
      /ఆసుపత్రి|ఆరోగ్య.*కేంద్రం/,
      // Tamil
      /மருத்துவமனை|சுகாதார.*மையம்/,
    ],
  },

  // ── Follow-up reminders
  {
    intent: 'GET_FOLLOWUP',
    priority: 65,
    patterns: [
      /follow.?up|next.*visit|when.*come.*back|reminder|next.*appointment/,
      /ಮುಂದಿನ.*ಭೇಟಿ|follow.*up|ಮತ್ತೆ.*ಯಾವಾಗ/,
      /अगली.*बार|फॉलो.*अप/,
      /తదుపరి.*సందర్శన/,
    ],
  },
];

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a natural-language utterance into a structured IntentResult.
 *
 * @param text  Raw transcribed text from STT (any language/script)
 */
export function parseIntent(text: string): IntentResult {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

  // Sort rules by descending priority so higher-priority rules win.
  const sorted = [...RULES].sort((a, b) => b.priority - a.priority);

  for (const rule of sorted) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) {
        return {
          intent: rule.intent,
          confidence: rule.priority >= 70 ? 'high' : rule.priority >= 50 ? 'medium' : 'low',
          matched: normalized,
        };
      }
    }
  }

  return { intent: 'UNKNOWN', confidence: 'low', matched: normalized };
}

/**
 * Combine a role intent with an auth intent when both appear in one utterance.
 * Example: "ನಾನು ರೋಗಿ. ಮೊಬೈಲ್ ಮೂಲಕ login ಮಾಡುತ್ತೇನೆ."
 * Returns the more specific (higher-priority) combined intent.
 */
export function parseIntentWithContext(
  text: string,
  previousIntent?: Intent,
): IntentResult {
  const primary = parseIntent(text);

  // If the new text refines a previous ambiguous role intent with auth info,
  // return the auth intent (it is more actionable).
  if (
    previousIntent === 'ROLE_PATIENT' &&
    primary.intent === 'AUTH_PHONE_OTP'
  ) {
    return { ...primary, confidence: 'high' };
  }
  if (
    previousIntent === 'ROLE_PATIENT' &&
    primary.intent === 'AUTH_EMAIL'
  ) {
    return { ...primary, confidence: 'high' };
  }

  return primary;
}

/**
 * Build a natural Kannada/Hindi/English ARROH response for each intent.
 */
export function intentResponse(intent: Intent, lang: string): string {
  const isKn = lang.startsWith('kn');
  const isHi = lang.startsWith('hi');

  switch (intent) {
    case 'ROLE_PATIENT':
      return isKn ? 'ಸರಿ. ನೀವು ರೋಗಿ. ನಿಮ್ಮ ಮೊಬೈಲ್ ನಂಬರ್ ಹೇಳಿ.'
           : isHi ? 'ठीक है। आप रोगी हैं। अपना मोबाइल नंबर बताएं।'
           : 'Understood. You are a patient. Please say your mobile number.';

    case 'ROLE_DOCTOR':
      return isKn ? 'ಸರಿ. ನೀವು ವೈದ್ಯ. ಇಮೇಲ್ ಮೂಲಕ login ತೆರೆಯುತ್ತೇನೆ.'
           : isHi ? 'ठीक है। आप डॉक्टर हैं। Email से login खोलता हूँ।'
           : 'Understood. You are a doctor. Opening email login.';

    case 'ROLE_ASHA':
      return isKn ? 'ಸರಿ. ನೀವು ಆರೋಗ್ಯ ಕಾರ್ಯಕರ್ತ. ಇಮೇಲ್ ಮೂಲಕ login ತೆರೆಯುತ್ತೇನೆ.'
           : 'You are a health worker. Opening staff login.';

    case 'AUTH_PHONE_OTP':
      return isKn ? 'ಸರಿ. ಮೊಬೈಲ್ OTP ಮೂಲಕ login. ನಿಮ್ಮ ಮೊಬೈಲ್ ನಂಬರ್ ಹೇಳಿ.'
           : isHi ? 'ठीक है। Mobile OTP से login। अपना नंबर बताएं।'
           : 'OK. Mobile OTP login. Please say your mobile number.';

    case 'AUTH_EMAIL':
      return isKn ? 'ಸರಿ. ನೀವು ಇಮೇಲ್ ಮೂಲಕ login ಮಾಡಲು ಬಯಸುತ್ತೀರಿ. ಡಾಕ್ಟರ್ login ತೆರೆಯುತ್ತೇನೆ.'
           : isHi ? 'ठीक है। Email से login। Doctor login खोलता हूँ।'
           : 'Sure. You want to login with email. Opening doctor login.';

    case 'AUTH_HELP':
      return isKn ? 'ನೀವು ರೋಗಿಯಾದರೆ ಮೊಬೈಲ್ OTP ಆಯ್ಕೆ ಮಾಡಿ. ವೈದ್ಯರಾದರೆ ಇಮೇಲ್ ಆಯ್ಕೆ ಮಾಡಿ.'
           : 'If you are a patient, choose mobile OTP. If you are a doctor, choose email login.';

    case 'LANGUAGE_CHANGE':
      return isKn ? 'ಯಾವ ಭಾಷೆ ಬೇಕು? ಕನ್ನಡ, ಹಿಂದಿ, ತೆಲುಗು, ತಮಿಳು, ಅಥವಾ English?'
           : 'Which language? Kannada, Hindi, Telugu, Tamil, or English?';

    case 'GREET':
      return isKn ? 'ನಮಸ್ಕಾರ! ನಿಮಗೆ ಏನು ಸಹಾಯ ಮಾಡಲಿ?'
           : isHi ? 'नमस्ते! मैं आपकी कैसे मदद करूँ?'
           : 'Hello! How can I help you today?';

    case 'COLLECT_SYMPTOMS':
      return isKn ? 'ಸರಿ. ನಿಮಗೆ ಯಾವ ತೊಂದರೆ ಇದೆ? ವಿವರವಾಗಿ ಹೇಳಿ.'
           : isHi ? 'ठीक है। आपको क्या तकलीफ है? विस्तार से बताएं।'
           : 'I understand. Please tell me more about your symptoms.';

    case 'BOOK_APPOINTMENT':
      return isKn ? 'ಸರಿ. ನಿಮಗಾಗಿ ವೈದ್ಯರ appointment ನೋಡೋಣ.'
           : isHi ? 'ठीक है। आपके लिए डॉक्टर का appointment देखते हैं।'
           : 'Sure. Let me find an appointment for you.';

    case 'GET_PRESCRIPTION':
      return isKn ? 'ಸರಿ. ನಿಮ್ಮ ಔಷಧಿ ವಿವರ ತೋರಿಸುತ್ತೇನೆ.'
           : isHi ? 'ठीक है। आपकी दवाई का विवरण दिखाता हूँ।'
           : 'Let me show you your prescription details.';

    case 'FIND_FACILITY':
      return isKn ? 'ಸರಿ. ನಿಮ್ಮ ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆ ಮತ್ತು PHC ತೋರಿಸುತ್ತೇನೆ.'
           : isHi ? 'ठीक है। आपके पास के अस्पताल और PHC दिखाता हूँ।'
           : 'Let me show you nearby hospitals and health centers.';

    case 'EMERGENCY':
      return isKn ? 'ತುರ್ತು ಪರಿಸ್ಥಿತಿ ಇರಬಹುದು. ಸುರಕ್ಷತೆಗಾಗಿ ಕೆಲವು ಪ್ರಶ್ನೆ ಕೇಳುತ್ತೇನೆ.'
           : isHi ? 'यह आपात स्थिति हो सकती है। सुरक्षा के लिए कुछ सवाल पूछता हूँ।'
           : 'This may be urgent. Let me ask a few safety questions.';

    case 'GET_FOLLOWUP':
      return isKn ? 'ಸರಿ. ನಿಮ್ಮ follow-up ವಿವರ ತೋರಿಸುತ್ತೇನೆ.'
           : isHi ? 'ठीक है। आपका फॉलो-अप विवरण दिखाता हूँ।'
           : 'Let me check your follow-up details.';

    default:
      return isKn ? 'ನನಗೆ ಸರಿಯಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ನೀವು ರೋಗಿಯಾ ಅಥವಾ ವೈದ್ಯರಾ?'
           : isHi ? 'मुझे ठीक से समझ नहीं आया। क्या आप रोगी हैं या डॉक्टर?'
           : 'I did not quite understand. Are you a patient or a doctor?';
  }
}
