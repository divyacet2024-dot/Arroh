/**
 * languageConfig — canonical language configuration for MEDORA.
 *
 * Browser speech implementations and the health-worker voice page use this
 * registry to translate app codes into BCP-47 locales. UI dictionaries and
 * clinical-response resources remain separate and must be added independently.
 *
 * A new entry does not imply browser or backend support; validate each runtime
 * capability and add the corresponding response/UI resources separately.
 */

export interface LanguageConfig {
  /** BCP-47 code stored in i18n context, e.g. "kn-IN" */
  code: string;
  /** Locale passed to SpeechRecognition.lang */
  speechRecognitionLocale: string;
  /** Locale passed to SpeechSynthesisUtterance.lang */
  ttsLocale: string;
  /** Display name in English */
  displayName: string;
  /** Display name in the native script */
  nativeScript: string;
  /** Script tag for Noto font fallback */
  fontScript: 'Kannada' | 'Devanagari' | 'Telugu' | 'Tamil' | 'Malayalam' | 'Bengali' | 'Gujarati' | 'Latin';
  /** Rate tweak for TTS — some Indian languages sound better slower */
  ttsRate: number;
  /** Preferred TTS voice name substrings to try before falling back */
  voiceNameHints: string[];
}

export const LANGUAGE_CONFIGS: LanguageConfig[] = [
  {
    code: 'en-IN',
    speechRecognitionLocale: 'en-IN',
    ttsLocale: 'en-IN',
    displayName: 'English',
    nativeScript: 'English',
    fontScript: 'Latin',
    ttsRate: 0.95,
    voiceNameHints: ['en-IN', 'English India', 'en-GB', 'en-US'],
  },
  {
    code: 'kn-IN',
    speechRecognitionLocale: 'kn-IN',
    ttsLocale: 'kn-IN',
    displayName: 'Kannada',
    nativeScript: 'ಕನ್ನಡ',
    fontScript: 'Kannada',
    ttsRate: 0.88,
    voiceNameHints: ['Kannada', 'kn-IN', 'kn'],
  },
  {
    code: 'hi-IN',
    speechRecognitionLocale: 'hi-IN',
    ttsLocale: 'hi-IN',
    displayName: 'Hindi',
    nativeScript: 'हिन्दी',
    fontScript: 'Devanagari',
    ttsRate: 0.90,
    voiceNameHints: ['Hindi', 'hi-IN', 'hi'],
  },
  {
    code: 'te-IN',
    speechRecognitionLocale: 'te-IN',
    ttsLocale: 'te-IN',
    displayName: 'Telugu',
    nativeScript: 'తెలుగు',
    fontScript: 'Telugu',
    ttsRate: 0.90,
    voiceNameHints: ['Telugu', 'te-IN', 'te'],
  },
  {
    code: 'ta-IN',
    speechRecognitionLocale: 'ta-IN',
    ttsLocale: 'ta-IN',
    displayName: 'Tamil',
    nativeScript: 'தமிழ்',
    fontScript: 'Tamil',
    ttsRate: 0.90,
    voiceNameHints: ['Tamil', 'ta-IN', 'ta'],
  },
  {
    code: 'ml-IN',
    speechRecognitionLocale: 'ml-IN',
    ttsLocale: 'ml-IN',
    displayName: 'Malayalam',
    nativeScript: 'മലയാളം',
    fontScript: 'Malayalam',
    ttsRate: 0.90,
    voiceNameHints: ['Malayalam', 'ml-IN', 'ml'],
  },
  {
    code: 'mr-IN',
    speechRecognitionLocale: 'mr-IN',
    ttsLocale: 'mr-IN',
    displayName: 'Marathi',
    nativeScript: 'मराठी',
    fontScript: 'Devanagari',
    ttsRate: 0.90,
    voiceNameHints: ['Marathi', 'mr-IN', 'mr'],
  },
  {
    code: 'bn-IN',
    speechRecognitionLocale: 'bn-IN',
    ttsLocale: 'bn-IN',
    displayName: 'Bengali',
    nativeScript: 'বাংলা',
    fontScript: 'Bengali',
    ttsRate: 0.90,
    voiceNameHints: ['Bengali', 'bn-IN', 'bn'],
  },
  {
    code: 'gu-IN',
    speechRecognitionLocale: 'gu-IN',
    ttsLocale: 'gu-IN',
    displayName: 'Gujarati',
    nativeScript: 'ગુજરાતી',
    fontScript: 'Gujarati',
    ttsRate: 0.90,
    voiceNameHints: ['Gujarati', 'gu-IN', 'gu'],
  },
];

const BY_CODE = new Map(
  LANGUAGE_CONFIGS.flatMap((config) => [
    [config.code.toLowerCase(), config] as const,
    [config.code.split('-')[0].toLowerCase(), config] as const,
  ]),
);

/** Return the configured language for an app code or locale, or undefined if unsupported. */
export function getLanguageConfig(code: string): LanguageConfig | undefined {
  return BY_CODE.get(code.trim().replace('_', '-').toLowerCase());
}

/** Apply verified, speech-only pronunciation guidance without changing UI text. */
export function prepareSpeechText(text: string, code: string): string {
  if (getLanguageConfig(code)?.code !== 'hi-IN') return text;
  return text.replace(/\bMEDORA\b/gi, 'मेडोरा');
}

/** Default language for MEDORA — Kannada. */
export const DEFAULT_LANGUAGE_CONFIG = BY_CODE.get('kn-in')!;

// ── Greeting text per language ─────────────────────────────────────────────
// Used by Welcome screen and PatientHome on session start.
// Keep sentences short — the avatar must speak them clearly.
export const ARROH_GREETING: Record<string, string> = {
  'kn-IN': 'ನಮಸ್ಕಾರ. ನಾನು MEDORA. ನಿಮ್ಮ ಆರೋಗ್ಯ ಸಹಾಯಕ್ಕಾಗಿ ನಾನು ಇಲ್ಲಿದ್ದೇನೆ. ನಿಮಗೆ ಏನು ಸಹಾಯ ಬೇಕು?',
  'hi-IN': 'नमस्ते। मैं MEDORA हूँ। आपकी स्वास्थ्य सेवा के लिए यहाँ हूँ। मैं आपकी कैसे मदद करूँ?',
  'te-IN': 'నమస్కారం. నేను MEDORA. మీ ఆరోగ్య సహాయం కోసం ఇక్కడ ఉన్నాను. మీకు ఏమి సహాయం కావాలి?',
  'ta-IN': 'வணக்கம். நான் MEDORA. உங்கள் சுகாதார உதவிக்காக இங்கே இருக்கிறேன். உங்களுக்கு என்ன உதவி வேண்டும்?',
  'en-IN': 'Hello. I am MEDORA, your health assistant. How can I help you today?',
  'ml-IN': 'നമസ്കാരം. ഞാൻ MEDORA. നിങ്ങളുടെ ആരോഗ്യ സഹായത്തിനായി ഞാൻ ഇവിടെയുണ്ട്. എങ്ങനെ സഹായിക്കാം?',
  'mr-IN': 'नमस्कार. मी MEDORA आहे. तुमच्या आरोग्य सेवेसाठी मी येथे आहे. मी कशी मदत करू?',
  'bn-IN': 'নমস্কার। আমি MEDORA। আপনার স্বাস্থ্যসেবার জন্য আমি এখানে আছি। কীভাবে সাহায্য করতে পারি?',
  'gu-IN': 'નમસ્તે. હું MEDORA છું. તમારી આરોગ્ય સહાય માટે અહીં છું. હું કેવી રીતે મદદ કરી શકું?',
};
