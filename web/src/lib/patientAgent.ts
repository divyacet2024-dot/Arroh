/**
 * patientAgent — ARROH's agentic healthcare tool dispatcher.
 *
 * Architecture:
 *   User speech/tap
 *     ↓  useArrohVoice (STT)
 *   patientAgent.dispatch(text, context)
 *     ↓  parseIntent → intent + entities
 *   Tool lookup (structured table, NOT if/else)
 *     ↓  backend service call (real API)
 *   AgentResponse { text, action, data }
 *     ↓  useArrohVoice.speak(text)
 *     ↓  ArrohHumanAvatar SPEAKING state
 *
 * Rules:
 *   - AI never modifies the DB directly — all writes go via backend APIs
 *   - Sensitive actions require confirmation before execution
 *   - Clinical decisions remain with authorized professionals
 *   - Errors are surfaced as human-readable Kannada/language messages
 *   - No fake data — if a backend call fails, say so honestly
 */

import { parseIntent, type Intent } from './intentParser';
import { request, ApiError } from '../services/api';

// ── Conversation context ──────────────────────────────────────────────────────

export interface SymptomEntry {
  symptom: string;
  duration?: string;
  severity?: 'mild' | 'moderate' | 'severe';
  source: 'voice' | 'tap' | 'text';
}

export interface AgentContext {
  patientId: string | null;
  patientToken: string | null;
  language: string;
  symptoms: SymptomEntry[];
  lastIntent: Intent | null;
  /** Whether the current action is awaiting user confirmation */
  awaitingConfirmation: boolean;
  pendingConfirmAction: (() => Promise<AgentResponse>) | null;
}

export function createContext(
  patientId: string | null,
  patientToken: string | null,
  language = 'kn-IN',
): AgentContext {
  return {
    patientId,
    patientToken,
    language,
    symptoms: [],
    lastIntent: null,
    awaitingConfirmation: false,
    pendingConfirmAction: null,
  };
}

// ── Response types ────────────────────────────────────────────────────────────

export type AgentAction =
  | 'NONE'
  | 'SHOW_SYMPTOM_PICKER'
  | 'SHOW_APPOINTMENT_BOOKING'
  | 'SHOW_PRESCRIPTION'
  | 'SHOW_FACILITIES'
  | 'SHOW_FOLLOWUP'
  | 'EMERGENCY_ESCALATE'
  | 'CONFIRM_REQUIRED'
  | 'NAVIGATE_PATIENT_HOME';

export interface AgentResponse {
  /** Text for ARROH to speak aloud (in the user's language) */
  text: string;
  /** UI action to trigger after speaking */
  action: AgentAction;
  /** Any structured data the UI needs */
  data?: Record<string, unknown>;
  /** If true, UI should show confirmation buttons before proceeding */
  requiresConfirmation?: boolean;
}

// ── Natural language responses per language ──────────────────────────────────

function t(
  lang: string,
  kn: string,
  hi: string,
  te: string,
  ta: string,
  en: string,
): string {
  if (lang.startsWith('kn')) return kn;
  if (lang.startsWith('hi')) return hi;
  if (lang.startsWith('te')) return te;
  if (lang.startsWith('ta')) return ta;
  return en;
}

// ── Symptom duration extraction ───────────────────────────────────────────────

const DURATION_PATTERNS: Array<[RegExp, string]> = [
  [/(\d+)\s*(?:days?|ದಿನ|दिन|రోజులు|நாட்கள்)/i, '$1 days'],
  [/(\d+)\s*(?:weeks?|ವಾರ|सप्ताह|వారాలు|வாரங்கள்)/i, '$1 weeks'],
  [/(\d+)\s*(?:hours?|ಗಂಟೆ|घंटे|గంటలు|மணி)/i, '$1 hours'],
  [/(?:today|ಇಂದು|आज|ఈ రోజు|இன்று)/i, 'today'],
  [/(?:yesterday|ನಿನ್ನೆ|कल|నిన్న|நேற்று)/i, '1 day'],
  [/(?:two|ಎರಡು|दो|రెండు|இரண்டு)\s+(?:days?|ದಿನ|दिन)/i, '2 days'],
  [/(?:three|ಮೂರು|तीन|మూడు|மூன்று)\s+(?:days?|ದಿನ|दिन)/i, '3 days'],
];

function extractDuration(text: string): string | undefined {
  for (const [pattern, result] of DURATION_PATTERNS) {
    const m = text.match(pattern);
    if (m) return result.replace('$1', m[1] ?? '');
  }
  return undefined;
}

// ── Triage call (real backend) ────────────────────────────────────────────────

async function runTriage(
  symptoms: SymptomEntry[],
  token: string | null,
  language: string,
): Promise<{ triage_level: string; patient_reply: string; recommended_actions: string[] }> {
  const symptomList = symptoms.map((s) => s.symptom);
  const transcript  = symptomList.join(', ');

  const res = await request<{
    patient_reply: string;
    triage_assessment: { triage_level: string; recommended_actions: string[] };
  }>({
    method: 'POST',
    url: '/api/v1/voice/parse-and-triage',
    data: { transcript, language: language.split('-')[0] },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  return {
    triage_level: res.triage_assessment.triage_level,
    patient_reply: res.patient_reply,
    recommended_actions: res.triage_assessment.recommended_actions,
  };
}

// ── Tool table ────────────────────────────────────────────────────────────────

interface Tool {
  intent: Intent;
  /**
   * Execute the tool.
   * Receives the raw text + current context; returns an AgentResponse.
   * May mutate context (e.g. accumulate symptoms).
   */
  execute: (text: string, ctx: AgentContext) => Promise<AgentResponse>;
}

const TOOLS: Tool[] = [
  // ── Emergency — highest priority, no confirmation gate needed
  {
    intent: 'EMERGENCY',
    execute: async (_text, ctx) => ({
      text: t(
        ctx.language,
        'ತುರ್ತು ಪರಿಸ್ಥಿತಿ ಇರಬಹುದು. ಈಗಲೇ ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆಗೆ ಹೋಗಿ ಅಥವಾ 108 ಕರೆ ಮಾಡಿ.',
        'यह आपात स्थिति हो सकती है। तुरंत नजदीकी अस्पताल जाएं या 108 पर कॉल करें।',
        'అత్యవసరం కావచ్చు. వెంటనే దగ్గర్లోని ఆసుపత్రికి వెళ్ళండి లేదా 108 కి కాల్ చేయండి.',
        'அவசரநிலை இருக்கலாம். உடனே அருகிலுள்ள மருத்துவமனைக்கு செல்லுங்கள் அல்லது 108 அழைக்கவும்.',
        'This may be an emergency. Please go to the nearest hospital immediately or call 108.',
      ),
      action: 'EMERGENCY_ESCALATE',
    }),
  },

  // ── Symptom collection → triage
  {
    intent: 'COLLECT_SYMPTOMS',
    execute: async (text, ctx) => {
      const duration = extractDuration(text);
      // Add new symptoms from text (avoid duplicates)
      const entry: SymptomEntry = { symptom: text, duration, source: 'voice' };
      const alreadyHas = ctx.symptoms.some(
        (s) => s.symptom.toLowerCase() === text.toLowerCase(),
      );
      if (!alreadyHas) ctx.symptoms.push(entry);

      // If we have at least one symptom, offer to run triage
      if (ctx.symptoms.length >= 1) {
        const symptomSummary = ctx.symptoms.map((s) => s.symptom).join(', ');
        const confirmText = t(
          ctx.language,
          `ನೀವು ಹೇಳಿದ ತೊಂದರೆಗಳು: ${symptomSummary}. ಇದನ್ನು ವೈದ್ಯರಿಗಾಗಿ ಸಿದ್ಧಪಡಿಸಲಾ?`,
          `आपकी तकलीफें: ${symptomSummary}. इसे डॉक्टर के लिए तैयार करूँ?`,
          `మీరు చెప్పిన లక్షణాలు: ${symptomSummary}. వైద్యుడి కోసం తయారు చేయనా?`,
          `நீங்கள் சொன்ன அறிகுறிகள்: ${symptomSummary}. மருத்துவருக்காக தயார் செய்யட்டுமா?`,
          `You mentioned: ${symptomSummary}. Shall I prepare this summary for the doctor?`,
        );

        ctx.awaitingConfirmation = true;
        ctx.pendingConfirmAction = async () => {
          ctx.awaitingConfirmation = false;
          try {
            const result = await runTriage(ctx.symptoms, ctx.patientToken, ctx.language);
            const level = result.triage_level;
            const urgency =
              level === 'RED'
                ? t(ctx.language, 'ತುರ್ತು ಪರೀಕ್ಷೆ ಅಗತ್ಯ.', 'तुरंत जांच जरूरी है।', 'వెంటనే పరీక్ష అవసరం.', 'உடனடி பரிசோதனை தேவை.', 'Urgent medical review needed.')
                : level === 'YELLOW'
                ? t(ctx.language, 'ಇಂದು ವೈದ್ಯರನ್ನು ನೋಡಿ.', 'आज डॉक्टर से मिलें।', 'ఈ రోజు డాక్టర్‌ను చూడండి.', 'இன்றே டாக்டரை சந்தியுங்கள்.', 'Please see a doctor today.')
                : t(ctx.language, 'ಸದ್ಯ ತೀವ್ರ ಅಲ್ಲ. ಆದರೂ ವೈದ್ಯರ ಸಲಹೆ ಪಡೆಯಿರಿ.', 'अभी गंभीर नहीं, पर डॉक्टर से मिलें।', 'ఇప్పుడు తీవ్రంగా లేదు. అయినా డాక్టర్‌ను చూడండి.', 'இப்போது தீவிரமில்லை. டாக்டரை சந்தியுங்கள்.', 'Not urgent now, but please consult a doctor.');

            return {
              text: `${result.patient_reply} ${urgency}`,
              action: 'SHOW_APPOINTMENT_BOOKING' as AgentAction,
              data: { triage_level: level, symptoms: ctx.symptoms },
            };
          } catch {
            return {
              text: t(
                ctx.language,
                'ಮಾಹಿತಿ ಪಡೆಯಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
                'जानकारी नहीं मिली। कृपया फिर से प्रयास करें।',
                'సమాచారం పొందలేకపోయాను. దయచేసి మళ్ళీ ప్రయత్నించండి.',
                'தகவல் பெற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
                'Could not get information. Please try again.',
              ),
              action: 'NONE' as AgentAction,
            };
          }
        };

        return {
          text: confirmText,
          action: 'SHOW_SYMPTOM_PICKER',
          requiresConfirmation: true,
          data: { symptoms: ctx.symptoms },
        };
      }

      return {
        text: t(
          ctx.language,
          'ಇನ್ನೂ ಯಾವ ತೊಂದರೆ ಇದೆ? ಹೇಳಿ ಅಥವಾ ಕೆಳಗೆ ಆರಿಸಿ.',
          'और क्या तकलीफ है? बताएं या नीचे चुनें।',
          'ఇంకా ఏమి ఇబ్బంది ఉంది? చెప్పండి లేదా దిగువ ఎంచుకోండి.',
          'இன்னும் என்ன பிரச்சனை இருக்கிறது? சொல்லுங்கள் அல்லது கீழே தேர்ந்தெடுங்கள்.',
          'Any other symptoms? Tell me or tap below.',
        ),
        action: 'SHOW_SYMPTOM_PICKER',
        data: { symptoms: ctx.symptoms },
      };
    },
  },

  // ── Book appointment
  {
    intent: 'BOOK_APPOINTMENT',
    execute: async (_text, ctx) => ({
      text: t(
        ctx.language,
        'ಸರಿ. ವೈದ್ಯರ appointment ಆಯ್ಕೆ ಮಾಡಿ.',
        'ठीक है। डॉक्टर का appointment बुक करें।',
        'సరే. డాక్టర్ appointment ఎంచుకోండి.',
        'சரி. டாக்டர் appointment பதிவு செய்யுங்கள்.',
        'Sure. Please choose a doctor appointment.',
      ),
      action: 'SHOW_APPOINTMENT_BOOKING',
    }),
  },

  // ── Prescription / medicines
  {
    intent: 'GET_PRESCRIPTION',
    execute: async (_text, ctx) => {
      if (!ctx.patientId || !ctx.patientToken) {
        return {
          text: t(
            ctx.language,
            'ಔಷಧಿ ಮಾಹಿತಿ ಪಡೆಯಲು ದಯವಿಟ್ಟು ಮೊದಲು login ಮಾಡಿ.',
            'दवाई की जानकारी पाने के लिए पहले login करें।',
            'మందుల సమాచారం పొందడానికి దయచేసి ముందు login చేయండి.',
            'மருந்து தகவல் பெற முதலில் login செய்யவும்.',
            'Please log in first to view your prescription.',
          ),
          action: 'NONE',
        };
      }
      try {
        const prescriptions = await request<unknown[]>({
          method: 'GET',
          url: '/api/v1/patient-auth/prescriptions',
          headers: { Authorization: `Bearer ${ctx.patientToken}` },
        });
        if (!prescriptions.length) {
          return {
            text: t(
              ctx.language,
              'ಇನ್ನೂ ಯಾವ ಔಷಧಿ ದಾಖಲೆ ಇಲ್ಲ.',
              'अभी कोई दवाई का रिकॉर्ड नहीं है।',
              'ఇంకా మందుల రికార్డు లేదు.',
              'இன்னும் மருந்து பதிவு இல்லை.',
              'No prescription records found yet.',
            ),
            action: 'NONE',
          };
        }
        return {
          text: t(
            ctx.language,
            'ನಿಮ್ಮ ಔಷಧಿ ವಿವರ ತೋರಿಸುತ್ತಿದ್ದೇನೆ.',
            'आपकी दवाई का विवरण दिखा रहा हूँ।',
            'మీ మందుల వివరాలు చూపిస్తున్నాను.',
            'உங்கள் மருந்து விவரங்களைக் காட்டுகிறேன்.',
            'Showing your prescription details.',
          ),
          action: 'SHOW_PRESCRIPTION',
          data: { prescriptions },
        };
      } catch (err) {
        return {
          text: t(
            ctx.language,
            'ಔಷಧಿ ಮಾಹಿತಿ ತರಲು ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
            'दवाई की जानकारी नहीं मिली। दोबारा कोशिश करें।',
            'మందుల సమాచారం పొందలేకపోయాను. మళ్ళీ ప్రయత్నించండి.',
            'மருந்து தகவல் கிடைக்கவில்லை. மீண்டும் முயற்சிக்கவும்.',
            'Could not load prescription. Please try again.',
          ),
          action: 'NONE',
        };
      }
    },
  },

  // ── Find nearby facility
  {
    intent: 'FIND_FACILITY',
    execute: async (_text, ctx) => ({
      text: t(
        ctx.language,
        'ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆ ಮತ್ತು PHC ತೋರಿಸುತ್ತಿದ್ದೇನೆ.',
        'पास के अस्पताल और PHC दिखा रहा हूँ।',
        'దగ్గర్లోని ఆసుపత్రి మరియు PHC చూపిస్తున్నాను.',
        'அருகிலுள்ள மருத்துவமனை மற்றும் PHC காட்டுகிறேன்.',
        'Showing nearby hospitals and health centers.',
      ),
      action: 'SHOW_FACILITIES',
    }),
  },

  // ── Follow-up
  {
    intent: 'GET_FOLLOWUP',
    execute: async (_text, ctx) => ({
      text: t(
        ctx.language,
        'ನಿಮ್ಮ follow-up ವಿವರ ತೋರಿಸುತ್ತಿದ್ದೇನೆ.',
        'आपका फॉलो-अप विवरण दिखा रहा हूँ।',
        'మీ ఫాలో-అప్ వివరాలు చూపిస్తున్నాను.',
        'உங்கள் follow-up விவரங்களைக் காட்டுகிறேன்.',
        'Showing your follow-up details.',
      ),
      action: 'SHOW_FOLLOWUP',
    }),
  },

  // ── Greet
  {
    intent: 'GREET',
    execute: async (_text, ctx) => ({
      text: t(
        ctx.language,
        'ನಮಸ್ಕಾರ! ನಿಮಗೆ ಹೇಗಿದ್ದೀರಿ? ನಾನು ಸಹಾಯ ಮಾಡಲು ಸಿದ್ಧ.',
        'नमस्ते! आप कैसे हैं? मैं मदद के लिए तैयार हूँ।',
        'నమస్కారం! మీకు ఎలా ఉన్నారు? నేను సహాయం చేయడానికి సిద్ధంగా ఉన్నాను.',
        'வணக்கம்! நீங்கள் எப்படி இருக்கிறீர்கள்? நான் உதவ தயாராக இருக்கிறேன்.',
        'Hello! How are you feeling? I am here to help.',
      ),
      action: 'NONE',
    }),
  },
];

// Build a Map for O(1) lookup by intent
const TOOL_MAP = new Map<Intent, Tool>(TOOLS.map((t) => [t.intent, t]));

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Dispatch a user utterance through the agent.
 *
 * If context.awaitingConfirmation is true and the text matches an
 * affirmative response, the pending confirm action is executed.
 *
 * @param text     Raw transcribed or typed text
 * @param ctx      Mutable conversation context (symptoms, patientId, etc.)
 * @returns        AgentResponse with text to speak + UI action
 */
export async function dispatch(
  text: string,
  ctx: AgentContext,
): Promise<AgentResponse> {
  const lang = ctx.language;

  // ── Handle confirmation response ────────────────────────────────────────
  if (ctx.awaitingConfirmation && ctx.pendingConfirmAction) {
    const normalized = text.toLowerCase().trim();
    const isYes =
      /^(yes|yeah|sure|ok|okay|correct|right|haan|ha|ಹೌದು|ಸರಿ|हाँ|हां|అవును|ఆ|ஆம்|சரி)/.test(
        normalized,
      );
    const isNo =
      /^(no|nope|cancel|wrong|change|ಇಲ್ಲ|ಬದಲಾಯಿಸಿ|नहीं|कैंसल|కాదు|மாற்று|இல்லை)/.test(
        normalized,
      );

    if (isYes) {
      const action = ctx.pendingConfirmAction;
      ctx.pendingConfirmAction = null;
      return action();
    }
    if (isNo) {
      ctx.awaitingConfirmation = false;
      ctx.pendingConfirmAction = null;
      return {
        text: t(
          lang,
          'ಸರಿ. ಬೇರೆ ಏನಾದರೂ ಹೇಳಿ.',
          'ठीक है। कुछ और बताएं।',
          'సరే. ఇంకేమైనా చెప్పండి.',
          'சரி. வேறு ஏதாவது சொல்லுங்கள்.',
          'Alright. Please tell me anything else.',
        ),
        action: 'NONE',
      };
    }
    // Unclear — ask again
    return {
      text: t(
        lang,
        'ಹೌದು ಅಥವಾ ಇಲ್ಲ ಹೇಳಿ.',
        'हाँ या नहीं बताएं।',
        'అవును లేదా కాదు చెప్పండి.',
        'ஆம் அல்லது இல்லை சொல்லுங்கள்.',
        'Please say yes or no.',
      ),
      action: 'NONE',
      requiresConfirmation: true,
    };
  }

  // ── Classify intent ──────────────────────────────────────────────────────
  const result = parseIntent(text);
  ctx.lastIntent = result.intent;

  const tool = TOOL_MAP.get(result.intent);

  if (tool) {
    try {
      return await tool.execute(text, ctx);
    } catch (err) {
      const friendly =
        err instanceof ApiError ? err.friendly : 'Something went wrong.';
      return {
        text: t(
          lang,
          `ತೊಂದರೆ ಆಗಿದೆ: ${friendly} ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.`,
          `समस्या हुई: ${friendly} फिर से कोशिश करें।`,
          `సమస్య ఏర్పడింది. మళ్ళీ ప్రయత్నించండి.`,
          `சிக்கல் ஏற்பட்டது. மீண்டும் முயற்சிக்கவும்.`,
          `Something went wrong. Please try again.`,
        ),
        action: 'NONE',
      };
    }
  }

  // ── UNKNOWN — clarify ────────────────────────────────────────────────────
  return {
    text: t(
      lang,
      'ನನಗೆ ಸರಿಯಾಗಿ ಅರ್ಥ ಆಗಲಿಲ್ಲ. ನಿಧಾನವಾಗಿ ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ.',
      'मुझे ठीक से समझ नहीं आया। धीरे से फिर बताएं।',
      'నాకు సరిగ్గా అర్థం కాలేదు. నెమ్మదిగా మళ్ళీ చెప్పండి.',
      'எனக்கு சரியாக புரியவில்லை. மெதுவாக மீண்டும் சொல்லுங்கள்.',
      'I did not quite understand. Please say that again slowly.',
    ),
    action: 'NONE',
  };
}

/** Add tapped symptoms from the SymptomPicker to the context */
export function addTappedSymptoms(
  ctx: AgentContext,
  symptoms: string[],
): void {
  for (const s of symptoms) {
    if (!ctx.symptoms.some((e) => e.symptom === s)) {
      ctx.symptoms.push({ symptom: s, source: 'tap' });
    }
  }
}

/** Confirm current pending action (called when user taps ✓ button) */
export async function confirmPending(
  ctx: AgentContext,
): Promise<AgentResponse | null> {
  if (!ctx.awaitingConfirmation || !ctx.pendingConfirmAction) return null;
  const action = ctx.pendingConfirmAction;
  ctx.pendingConfirmAction = null;
  ctx.awaitingConfirmation = false;
  return action();
}

/** Cancel current pending action */
export function cancelPending(ctx: AgentContext, lang: string): AgentResponse {
  ctx.awaitingConfirmation = false;
  ctx.pendingConfirmAction = null;
  return {
    text: t(
      lang,
      'ಸರಿ, ಬಿಡೋಣ. ಬೇರೆ ಏನಾದರೂ ಸಹಾಯ ಬೇಕೇ?',
      'ठीक है। कुछ और मदद चाहिए?',
      'సరే. ఇంకేమైనా సహాయం కావాలా?',
      'சரி. வேறு ஏதாவது உதவி வேண்டுமா?',
      'Alright. Is there anything else I can help with?',
    ),
    action: 'NONE',
  };
}
