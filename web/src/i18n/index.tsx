import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export const LANGUAGE_CODES = ['en-IN', 'ta-IN', 'kn-IN', 'hi-IN', 'te-IN', 'ml-IN'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  'en-IN': 'English',
  'ta-IN': 'Tamil',
  'kn-IN': 'Kannada',
  'hi-IN': 'हिन्दी',
  'te-IN': 'Telugu',
  'ml-IN': 'Malayalam',
};

/** Default language for speech/TTS when the user has not chosen one. */
export const DEFAULT_LANGUAGE: LanguageCode = 'en-IN';

type Dictionary = Record<string, string>;

/** Fallback dictionary. Every key MUST exist here — other locales override a subset. */
const enIN: Dictionary = {
  'app.name': 'ARROH',
  'app.tagline': 'Rural Healthcare',
  'nav.dashboard': 'Dashboard',
  'nav.patients': 'Patients',
  'nav.triage': 'AI Triage',
  'nav.voice': 'Voice Assistant',
  'nav.emergency': 'Emergency',
  'nav.teleconsult': 'Tele-Consult',
  'nav.inventory': 'PHC Inventory',
  'nav.sync': 'Offline Sync',
  'status.online': 'ONLINE',
  'status.offline': 'OFFLINE',
  'status.fieldMode': 'Field mode',
  'medical.disclaimer': 'AI-assisted triage is guidance only and is not a confirmed medical diagnosis. For emergencies, seek professional medical care.',
  'common.loading': 'Loading…',
  'common.tryAgain': 'Try again',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
};

const taIN: Dictionary = {
  'status.online': 'இணையம்',
  'status.offline': 'ஆஃப்லைன்',
  'status.fieldMode': 'கள பயன்முறை',
  'medical.disclaimer': 'AI மூலம் வழங்கப்படும் வகைப்படுத்தல் வழிகாட்டுதல் மட்டுமே; இது மருத்துவ நோயறிதல் அல்ல. அவசர காலங்களில் தொழில்முறை மருத்துவ உதவியை நாடுங்கள்.',
  'common.loading': 'ஏற்றுகிறது…',
  'common.tryAgain': 'மீண்டும் முயற்சிக்கவும்',
  'common.cancel': 'ரத்து',
};

const knIN: Dictionary = {
  'status.online': 'ಆನ್‌ಲೈನ್',
  'status.offline': 'ಆಫ್‌ಲೈನ್',
  'status.fieldMode': 'ಕ್ಷೇತ್ರ ಕ್ರಮ',
  'medical.disclaimer': 'AI ಆಧಾರಿತ ತ್ರಿಯಾಜ್ ಮಾರ್ಗದರ್ಶನ ಮಾತ್ರ; ಇದು ವೈದ್ಯಕೀಯ ರೋಗನಿರ್ಣಯ ಅಲ್ಲ. ತುರ್ತು ಸಂದರ್ಭಗಳಲ್ಲಿ ವೃತ್ತಿಪರ ವೈದ್ಯಕೀಯ ಸಹಾಯ ಪಡೆಯಿರಿ.',
  'common.loading': 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
  'common.tryAgain': 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
  'common.cancel': 'ರದ್ದು',
};

const hiIN: Dictionary = {
  'status.online': 'ऑनलाइन',
  'status.offline': 'ऑफ़लाइन',
  'status.fieldMode': 'फ़ील्ड मोड',
  'medical.disclaimer': 'AI-सहायित ट्राइएज केवल मार्गदर्शन है; यह पुष्ट चिकित्सकीय निदान नहीं है। आपात स्थिति में पेशेवर चिकित्सा सहायता लें।',
  'common.loading': 'लोड हो रहा है…',
  'common.tryAgain': 'पुनः प्रयास करें',
  'common.cancel': 'रद्द करें',
};

const teIN: Dictionary = {
  'status.online': 'ఆన్‌లైన్',
  'status.offline': 'ఆఫ్‌లైన్',
  'status.fieldMode': 'ఫీల్డ్ మోడ్',
  'medical.disclaimer': 'AI సహాయిత ట్రైయేజ్ మార్గదర్శనం మాత్రమే; ఇది వైద్య నిర్ధారణ కాదు. అత్యవసర సమయాల్లో వృత్తిపరమైన వైద్య సహాయం పొందండి.',
  'common.loading': 'లోడ్ అవుతోంది…',
  'common.tryAgain': 'మళ్లీ ప్రయత్నించండి',
  'common.cancel': 'రద్దు',
};

const mlIN: Dictionary = {
  'status.online': 'ഓൺലൈൻ',
  'status.offline': 'ഓഫ്‌ലൈൻ',
  'status.fieldMode': 'ഫീൽഡ് മോഡ്',
  'medical.disclaimer': 'AI-സഹായിത ട്രയാജ് മാർഗ്ഗനിർദ്ദേശം മാത്രമാണ്; ഇത് ഉറപ്പുള്ള മെഡിക്കൽ രോഗനിർണയമല്ല. അടിയന്തര സാഹചര്യങ്ങളിൽ വിദഗ്ദ്ധ മെഡിക്കൽ സഹായം തേടുക.',
  'common.loading': 'ലോഡ് ചെയ്യുന്നു…',
  'common.tryAgain': 'വീണ്ടും ശ്രമിക്കുക',
  'common.cancel': 'റദ്ദാക്കുക',
};

const DICTIONARIES: Record<LanguageCode, Dictionary> = {
  'en-IN': enIN,
  'ta-IN': taIN,
  'kn-IN': knIN,
  'hi-IN': hiIN,
  'te-IN': teIN,
  'ml-IN': mlIN,
};

export interface I18n {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18n>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => undefined,
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_LANGUAGE);

  const t = useCallback(
    (key: string): string => {
      const localized = DICTIONARIES[language][key];
      if (localized) return localized;
      return enIN[key] ?? key;
    },
    [language],
  );

  const value = useMemo<I18n>(() => ({ language, setLanguage, t }), [language, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
