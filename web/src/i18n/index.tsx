import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export const LANGUAGE_CODES = ['en-IN', 'kn-IN', 'hi-IN', 'ta-IN', 'te-IN', 'ml-IN'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  'en-IN': 'English',
  'kn-IN': 'ಕನ್ನಡ',
  'hi-IN': 'हिन्दी',
  'ta-IN': 'தமிழ்',
  'te-IN': 'తెలుగు',
  'ml-IN': 'മലയാളം',
};

export const DEFAULT_LANGUAGE: LanguageCode = 'kn-IN';

type Dictionary = Record<string, string>;

// ─────────────────────────── English (fallback) ────────────────────────────
const enIN: Dictionary = {
  'app.name': 'MEDORA',
  'app.tagline': 'Smarter Care. Healthier Futures.',

  // Welcome screen
  'welcome.greeting': 'Namaskara 👋',
  'welcome.intro': 'I am the MEDORA assistant.',
  'welcome.help': 'I am here to help you.',
  'welcome.who': 'Who are you?',
  'welcome.patient': 'I am a Patient',
  'welcome.doctor': 'I am a Doctor',
  'welcome.worker': 'I am a Health Worker',
  'welcome.language': 'Choose your language',

  // Patient auth
  'auth.mobile.title': 'Enter your mobile number',
  'auth.mobile.label': 'Mobile number',
  'auth.mobile.placeholder': '9876543210',
  'auth.mobile.help': 'We will send a one-time code to this number.',
  'auth.mobile.submit': 'Send OTP',
  'auth.mobile.confirm.prefix': 'You entered:',
  'auth.mobile.confirm.correct': 'Yes, correct',
  'auth.mobile.confirm.change': 'Change number',
  'auth.otp.title': 'Enter the code',
  'auth.otp.sent': 'We sent a 6-digit code to',
  'auth.otp.label': 'Enter code',
  'auth.otp.verify': 'Verify',
  'auth.otp.resend': 'Resend code',
  'auth.otp.resend.wait': 'Resend in',
  'auth.otp.wrong': 'The code is incorrect. Please try again.',
  'auth.otp.expired': 'The code has expired. Please request a new one.',
  'auth.otp.locked': 'Too many wrong attempts. Please request a new code.',
  'auth.otp.dev': 'Development code:',
  'auth.back': 'Go back',

  // Doctor auth
  'auth.doctor.title': 'Doctor sign in',
  'auth.doctor.email': 'Email address',
  'auth.doctor.password': 'Password',
  'auth.doctor.submit': 'Sign in',
  'auth.doctor.register': 'Create an account',
  'auth.doctor.register.title': 'Create doctor account',
  'auth.doctor.name': 'Full name',

  // Patient dashboard
  'patient.home.greeting': 'Hello',
  'patient.home.talk': 'Talk to MEDORA',
  'patient.home.talk.sub': 'Tell me your symptoms',
  'patient.home.health': 'My Health',
  'patient.home.appointments': 'Appointments',
  'patient.home.reports': 'My Reports',
  'patient.home.referrals': 'Referrals',
  'patient.home.medicines': 'Medicines',
  'patient.home.emergency': 'Emergency Help',
  'patient.home.emergency.sub': 'Call for urgent help',
  'patient.home.offline': 'No internet. Your information is saved safely. It will sync when connection returns.',

  // AI states
  'ai.idle': 'How can I help you?',
  'ai.listening': 'I am listening…',
  'ai.processing': 'One moment, let me check…',
  'ai.speaking': 'MEDORA is speaking…',
  'ai.confirming': 'Please confirm',
  'ai.error': 'Something went wrong. Please try again.',
  'ai.success': 'Done.',

  // Disclaimer
  'medical.disclaimer': 'AI-assisted triage is guidance only and is not a confirmed medical diagnosis. For emergencies, seek professional medical care.',

  // Common
  'common.loading': 'Loading…',
  'common.tryAgain': 'Try again',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.confirm': 'Confirm',

  // Nav
  'nav.dashboard': 'Dashboard',
  'nav.patients': 'Patients',
  'nav.triage': 'AI Triage',
  'nav.voice': 'Voice Assistant',
  'nav.emergency': 'Emergency',
  'nav.teleconsult': 'Tele-Consult',
  'nav.inventory': 'PHC Inventory',
  'nav.sync': 'Offline Sync',

  // Status
  'status.online': 'ONLINE',
  'status.offline': 'OFFLINE',
  'status.fieldMode': 'Field mode',

  // Doctor dashboard
  'doctor.queue': 'Patient Queue',
  'doctor.queue.empty': 'No patients waiting.',
  'doctor.triage.red': 'Priority cases',
  'doctor.consult': 'Start consultation',
  'doctor.referrals': 'Referrals',
  'doctor.followups': 'Follow-ups',

  // Errors — human-readable, never technical
  'error.network': 'Unable to connect. Please check your internet.',
  'error.server': 'Something went wrong. Please try again in a moment.',
  'error.auth': 'Your session has ended. Please sign in again.',
  'error.notfound': 'This information could not be found.',
};

// ──────────────────────────── Kannada ──────────────────────────────────────
// Simple conversational Kannada — NOT formal literary Kannada.
// Short sentences. Respectful but warm. Rural-accessible.
const knIN: Dictionary = {
  'app.name': 'MEDORA',
  'app.tagline': 'ಗ್ರಾಮೀಣ ಆರೋಗ್ಯ ಸೇವೆ',

  // Welcome
  'welcome.greeting': 'ನಮಸ್ಕಾರ 👋',
  'welcome.intro': 'ನಾನು MEDORA ಸಹಾಯಕ.',
  'welcome.help': 'ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ನಾನು ಇಲ್ಲಿದ್ದೇನೆ.',
  'welcome.who': 'ನೀವು ಯಾರು?',
  'welcome.patient': 'ನಾನು ರೋಗಿ',
  'welcome.doctor': 'ನಾನು ವೈದ್ಯ',
  'welcome.worker': 'ನಾನು ಆರೋಗ್ಯ ಕಾರ್ಯಕರ್ತ',
  'welcome.language': 'ನಿಮ್ಮ ಭಾಷೆ ಆರಿಸಿ',

  // Patient auth
  'auth.mobile.title': 'ನಿಮ್ಮ ಮೊಬೈಲ್ ನಂಬರ್ ಹೇಳಿ',
  'auth.mobile.label': 'ಮೊಬೈಲ್ ನಂಬರ್',
  'auth.mobile.placeholder': '9876543210',
  'auth.mobile.help': 'ಈ ನಂಬರ್‌ಗೆ ಒಂದು ಕೋಡ್ ಕಳಿಸುತ್ತೇವೆ.',
  'auth.mobile.submit': 'OTP ಕಳಿಸಿ',
  'auth.mobile.confirm.prefix': 'ನೀವು ಹೇಳಿದ ನಂಬರ್:',
  'auth.mobile.confirm.correct': 'ಹೌದು, ಸರಿಯಾಗಿದೆ',
  'auth.mobile.confirm.change': 'ನಂಬರ್ ಬದಲಾಯಿಸಿ',
  'auth.otp.title': 'ಕೋಡ್ ಹಾಕಿ',
  'auth.otp.sent': 'ನಿಮ್ಮ ನಂಬರ್‌ಗೆ 6 ಅಂಕಿಯ ಕೋಡ್ ಕಳಿಸಿದ್ದೇವೆ:',
  'auth.otp.label': 'ಕೋಡ್ ಹಾಕಿ',
  'auth.otp.verify': 'ಮುಂದುವರಿಸಿ',
  'auth.otp.resend': 'ಮತ್ತೆ ಕೋಡ್ ಕಳಿಸಿ',
  'auth.otp.resend.wait': 'ಕೋಡ್ ಕಳಿಸಲು',
  'auth.otp.wrong': 'ಕೋಡ್ ತಪ್ಪಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  'auth.otp.expired': 'ಕೋಡ್ ಅವಧಿ ಮುಗಿದಿದೆ. ಹೊಸ ಕೋಡ್ ತರಿಸಿ.',
  'auth.otp.locked': 'ತಪ್ಪು ಕೋಡ್ ಹಲವು ಬಾರಿ ಹಾಕಿದ್ದೀರಿ. ಹೊಸ ಕೋಡ್ ತರಿಸಿ.',
  'auth.otp.dev': 'ಪರೀಕ್ಷಾ ಕೋಡ್:',
  'auth.back': 'ಹಿಂದೆ ಹೋಗಿ',

  // Doctor auth
  'auth.doctor.title': 'ವೈದ್ಯ ಲಾಗಿನ್',
  'auth.doctor.email': 'ಇಮೇಲ್ ವಿಳಾಸ',
  'auth.doctor.password': 'ಪಾಸ್‌ವರ್ಡ್',
  'auth.doctor.submit': 'ಒಳಗೆ ಹೋಗಿ',
  'auth.doctor.register': 'ಹೊಸ ಖಾತೆ ತೆರೆಯಿರಿ',
  'auth.doctor.register.title': 'ವೈದ್ಯ ಖಾತೆ ತೆರೆಯಿರಿ',
  'auth.doctor.name': 'ಪೂರ್ಣ ಹೆಸರು',

  // Patient dashboard
  'patient.home.greeting': 'ನಮಸ್ಕಾರ',
  'patient.home.talk': 'MEDORA ಜೊತೆ ಮಾತಾಡಿ',
  'patient.home.talk.sub': 'ನಿಮ್ಮ ತೊಂದರೆ ಹೇಳಿ',
  'patient.home.health': 'ನನ್ನ ಆರೋಗ್ಯ',
  'patient.home.appointments': 'ಅಪಾಯಿಂಟ್ಮೆಂಟ್',
  'patient.home.reports': 'ನನ್ನ ರಿಪೋರ್ಟ್',
  'patient.home.referrals': 'ರೆಫರಲ್',
  'patient.home.medicines': 'ಔಷಧ',
  'patient.home.emergency': 'ತುರ್ತು ಸಹಾಯ',
  'patient.home.emergency.sub': 'ತಕ್ಷಣ ಸಹಾಯಕ್ಕಾಗಿ',
  'patient.home.offline': 'Internet ಇಲ್ಲ. ನಿಮ್ಮ ಮಾಹಿತಿ ಸುರಕ್ಷಿತವಾಗಿ save ಆಗುತ್ತದೆ. Connection ಬಂದಾಗ sync ಆಗುತ್ತದೆ.',

  // AI states
  'ai.idle': 'ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?',
  'ai.listening': 'ನಾನು ಕೇಳುತ್ತಿದ್ದೇನೆ…',
  'ai.processing': 'ಒಂದು ಕ್ಷಣ, ನಾನು ನೋಡುತ್ತಿದ್ದೇನೆ…',
  'ai.speaking': 'MEDORA ಮಾತಾಡುತ್ತಿದೆ…',
  'ai.confirming': 'ದಯವಿಟ್ಟು ದೃಢಪಡಿಸಿ',
  'ai.error': 'ತೊಂದರೆ ಆಯಿತು. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  'ai.success': 'ಆಯಿತು.',

  // Disclaimer
  'medical.disclaimer': 'MEDORA AI ಮಾರ್ಗದರ್ಶನ ಮಾತ್ರ ನೀಡುತ್ತದೆ. ಇದು ವೈದ್ಯಕೀಯ ರೋಗನಿರ್ಣಯ ಅಲ್ಲ. ತುರ್ತು ಸಂದರ್ಭದಲ್ಲಿ ವೈದ್ಯರ ಸಹಾಯ ಪಡೆಯಿರಿ.',

  // Common
  'common.loading': 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…',
  'common.tryAgain': 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
  'common.cancel': 'ರದ್ದು',
  'common.save': 'ಉಳಿಸಿ',
  'common.yes': 'ಹೌದು',
  'common.no': 'ಇಲ್ಲ',
  'common.back': 'ಹಿಂದೆ',
  'common.next': 'ಮುಂದೆ',
  'common.confirm': 'ಖಚಿತಪಡಿಸಿ',

  // Nav
  'nav.dashboard': 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
  'nav.patients': 'ರೋಗಿಗಳು',
  'nav.triage': 'AI ತ್ರಿಯಾಜ್',
  'nav.voice': 'ಧ್ವನಿ ಸಹಾಯಕ',
  'nav.emergency': 'ತುರ್ತು',
  'nav.teleconsult': 'ಟೆಲಿ-ಕನ್ಸಲ್ಟ್',
  'nav.inventory': 'PHC ಸ್ಟಾಕ್',
  'nav.sync': 'Offline Sync',

  // Status
  'status.online': 'ಆನ್‌ಲೈನ್',
  'status.offline': 'ಆಫ್‌ಲೈನ್',
  'status.fieldMode': 'ಕ್ಷೇತ್ರ ಕ್ರಮ',

  // Doctor dashboard
  'doctor.queue': 'ರೋಗಿಗಳ ಸರದಿ',
  'doctor.queue.empty': 'ಈಗ ಯಾರೂ ಕಾಯುತ್ತಿಲ್ಲ.',
  'doctor.triage.red': 'ತುರ್ತು ಪ್ರಕರಣಗಳು',
  'doctor.consult': 'ಸಮಾಲೋಚನೆ ಪ್ರಾರಂಭಿಸಿ',
  'doctor.referrals': 'ರೆಫರಲ್‌ಗಳು',
  'doctor.followups': 'ಅನುಸರಣೆ',

  // Errors
  'error.network': 'ಸಂಪರ್ಕ ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ. Internet ಪರಿಶೀಲಿಸಿ.',
  'error.server': 'ತೊಂದರೆ ಆಗಿದೆ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.',
  'error.auth': 'Session ಮುಗಿದಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಒಳಗೆ ಬನ್ನಿ.',
  'error.notfound': 'ಈ ಮಾಹಿತಿ ಸಿಗಲಿಲ್ಲ.',
};

// ───────────────────────────── Hindi ──────────────────────────────────────
const hiIN: Dictionary = {
  'app.tagline': 'ग्रामीण स्वास्थ्य सेवा',
  'welcome.greeting': 'नमस्ते 👋',
  'welcome.intro': 'मैं MEDORA सहायक हूँ।',
  'welcome.help': 'मैं आपकी मदद के लिए यहाँ हूँ।',
  'welcome.who': 'आप कौन हैं?',
  'welcome.patient': 'मैं रोगी हूँ',
  'welcome.doctor': 'मैं डॉक्टर हूँ',
  'welcome.worker': 'मैं स्वास्थ्यकर्मी हूँ',
  'welcome.language': 'अपनी भाषा चुनें',
  'auth.mobile.title': 'अपना मोबाइल नंबर बताएं',
  'auth.mobile.help': 'इस नंबर पर एक कोड भेजेंगे।',
  'auth.mobile.submit': 'OTP भेजें',
  'auth.mobile.confirm.correct': 'हाँ, सही है',
  'auth.mobile.confirm.change': 'नंबर बदलें',
  'auth.otp.title': 'कोड डालें',
  'auth.otp.verify': 'आगे बढ़ें',
  'auth.otp.resend': 'दोबारा कोड भेजें',
  'auth.otp.wrong': 'कोड गलत है। फिर से कोशिश करें।',
  'auth.otp.expired': 'कोड की समय-सीमा समाप्त हो गई। नया कोड मँगाएं।',
  'ai.idle': 'मैं आपकी कैसे सहायता करूँ?',
  'ai.listening': 'मैं सुन रहा हूँ…',
  'ai.processing': 'एक पल, देख रहा हूँ…',
  'ai.speaking': 'MEDORA बोल रहा है…',
  'ai.error': 'कुछ गड़बड़ हुई। कृपया दोबारा कोशिश करें।',
  'patient.home.talk': 'MEDORA से बात करें',
  'patient.home.talk.sub': 'अपनी परेशानी बताएं',
  'patient.home.emergency': 'आपातकालीन सहायता',
  'patient.home.offline': 'Internet नहीं है। आपकी जानकारी सुरक्षित है। Connection आने पर sync होगा।',
  'medical.disclaimer': 'MEDORA AI केवल मार्गदर्शन देता है। यह चिकित्सीय निदान नहीं है। आपात स्थिति में डॉक्टर से मिलें।',
  'common.loading': 'लोड हो रहा है…',
  'common.tryAgain': 'पुनः प्रयास करें',
  'common.cancel': 'रद्द करें',
  'common.yes': 'हाँ',
  'common.no': 'नहीं',
  'common.back': 'वापस',
  'common.confirm': 'पुष्टि करें',
  'status.online': 'ऑनलाइन',
  'status.offline': 'ऑफ़लाइन',
  'status.fieldMode': 'फ़ील्ड मोड',
  'error.network': 'कनेक्ट नहीं हो सका। Internet जाँचें।',
  'error.server': 'कुछ गड़बड़ हुई। थोड़ी देर बाद कोशिश करें।',
  'error.auth': 'Session समाप्त हो गया। कृपया फिर से sign in करें।',
};

// ────────────────────────────── Tamil ─────────────────────────────────────
const taIN: Dictionary = {
  'app.tagline': 'கிராமப்புற சுகாதார சேவை',
  'welcome.greeting': 'வணக்கம் 👋',
  'welcome.intro': 'நான் MEDORA உதவியாளர்.',
  'welcome.help': 'உங்களுக்கு உதவ இங்கே இருக்கிறேன்.',
  'welcome.who': 'நீங்கள் யார்?',
  'welcome.patient': 'நான் நோயாளி',
  'welcome.doctor': 'நான் மருத்துவர்',
  'welcome.worker': 'நான் சுகாதார பணியாளர்',
  'welcome.language': 'உங்கள் மொழியை தேர்வு செய்யவும்',
  'auth.mobile.title': 'உங்கள் தொலைபேசி எண் கூறுங்கள்',
  'auth.mobile.submit': 'OTP அனுப்பு',
  'auth.mobile.confirm.correct': 'ஆம், சரியானது',
  'auth.mobile.confirm.change': 'எண்ணை மாற்று',
  'auth.otp.title': 'குறியீட்டை உள்ளிடுக',
  'auth.otp.verify': 'தொடரவும்',
  'auth.otp.resend': 'மீண்டும் குறியீடு அனுப்பு',
  'auth.otp.wrong': 'குறியீடு தவறானது. மீண்டும் முயற்சிக்கவும்.',
  'ai.idle': 'உங்களுக்கு எவ்வாறு உதவலாம்?',
  'ai.listening': 'நான் கேட்கிறேன்…',
  'ai.processing': 'ஒரு நிமிடம், பார்க்கிறேன்…',
  'ai.error': 'ஏதோ தவறு நடந்தது. மீண்டும் முயற்சிக்கவும்.',
  'patient.home.talk': 'MEDORA உடன் பேசுங்கள்',
  'patient.home.emergency': 'அவசர உதவி',
  'patient.home.offline': 'Internet இல்லை. தகவல் பாதுகாப்பாக சேமிக்கப்படும்.',
  'medical.disclaimer': 'MEDORA AI வழிகாட்டுதல் மட்டுமே. இது மருத்துவ நோயறிதல் அல்ல.',
  'common.loading': 'ஏற்றுகிறது…',
  'common.tryAgain': 'மீண்டும் முயற்சிக்கவும்',
  'common.cancel': 'ரத்து',
  'common.yes': 'ஆம்',
  'common.no': 'இல்லை',
  'common.back': 'திரும்பு',
  'status.online': 'இணையத்தில்',
  'status.offline': 'ஆஃப்லைன்',
  'status.fieldMode': 'கள பயன்முறை',
  'error.network': 'இணைக்க முடியவில்லை. Internet சரிபார்க்கவும்.',
  'error.server': 'சிக்கல் ஏற்பட்டது. சிறிது நேரம் கழித்து முயற்சிக்கவும்.',
  'error.auth': 'Session முடிந்தது. மீண்டும் உள்நுழையவும்.',
};

// ─────────────────────────── Telugu ───────────────────────────────────────
const teIN: Dictionary = {
  'app.tagline': 'గ్రామీణ ఆరోగ్య సేవ',
  'welcome.greeting': 'నమస్కారం 👋',
  'welcome.intro': 'నేను MEDORA సహాయకుడిని.',
  'welcome.help': 'మీకు సహాయం చేయడానికి ఇక్కడ ఉన్నాను.',
  'welcome.who': 'మీరు ఎవరు?',
  'welcome.patient': 'నేను రోగిని',
  'welcome.doctor': 'నేను వైద్యుడిని',
  'welcome.worker': 'నేను ఆరోగ్య కార్యకర్తను',
  'welcome.language': 'మీ భాష ఎంచుకోండి',
  'auth.mobile.title': 'మీ మొబైల్ నంబర్ చెప్పండి',
  'auth.mobile.submit': 'OTP పంపండి',
  'auth.mobile.confirm.correct': 'అవును, సరైనది',
  'auth.mobile.confirm.change': 'నంబర్ మార్చండి',
  'auth.otp.title': 'కోడ్ నమోదు చేయండి',
  'auth.otp.verify': 'కొనసాగించండి',
  'auth.otp.resend': 'మళ్ళీ కోడ్ పంపండి',
  'auth.otp.wrong': 'కోడ్ తప్పు. మళ్ళీ ప్రయత్నించండి.',
  'ai.idle': 'మీకు ఎలా సహాయం చేయాలి?',
  'ai.listening': 'నేను వింటున్నాను…',
  'ai.processing': 'ఒక్క క్షణం, చూస్తున్నాను…',
  'ai.error': 'ఏదో తప్పు జరిగింది. మళ్ళీ ప్రయత్నించండి.',
  'patient.home.talk': 'MEDORA తో మాట్లాడండి',
  'patient.home.emergency': 'అత్యవసర సహాయం',
  'patient.home.offline': 'Internet లేదు. మీ సమాచారం సురక్షితంగా save అవుతుంది.',
  'medical.disclaimer': 'MEDORA AI మార్గదర్శనం మాత్రమే. ఇది వైద్య నిర్ధారణ కాదు.',
  'common.loading': 'లోడ్ అవుతోంది…',
  'common.tryAgain': 'మళ్ళీ ప్రయత్నించండి',
  'common.cancel': 'రద్దు',
  'common.yes': 'అవును',
  'common.no': 'కాదు',
  'common.back': 'వెనక్కు',
  'status.online': 'ఆన్‌లైన్',
  'status.offline': 'ఆఫ్‌లైన్',
  'status.fieldMode': 'ఫీల్డ్ మోడ్',
  'error.network': 'కనెక్ట్ కాలేదు. Internet తనిఖీ చేయండి.',
  'error.server': 'సమస్య ఏర్పడింది. కొంత సమయం తర్వాత ప్రయత్నించండి.',
  'error.auth': 'Session ముగిసింది. దయచేసి మళ్ళీ sign in చేయండి.',
};

// ─────────────────────────── Malayalam ────────────────────────────────────
const mlIN: Dictionary = {
  'app.tagline': 'ഗ്രാമീണ ആരോഗ്യ സേവനം',
  'welcome.greeting': 'നമസ്കാരം 👋',
  'welcome.intro': 'ഞാൻ MEDORA സഹായകനാണ്.',
  'welcome.help': 'നിങ്ങളെ സഹായിക്കാൻ ഇവിടെ ഉണ്ട്.',
  'welcome.who': 'നിങ്ങൾ ആരാണ്?',
  'welcome.patient': 'ഞാൻ രോഗിയാണ്',
  'welcome.doctor': 'ഞാൻ ഡോക്ടറാണ്',
  'welcome.worker': 'ഞാൻ ആരോഗ്യ പ്രവർത്തകനാണ്',
  'welcome.language': 'നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക',
  'auth.mobile.title': 'നിങ്ങളുടെ മൊബൈൽ നമ്പർ പറയൂ',
  'auth.mobile.submit': 'OTP അയക്കൂ',
  'auth.mobile.confirm.correct': 'അതെ, ശരിയാണ്',
  'auth.mobile.confirm.change': 'നമ്പർ മാറ്റൂ',
  'auth.otp.title': 'കോഡ് നൽകൂ',
  'auth.otp.verify': 'തുടരൂ',
  'auth.otp.resend': 'വീണ്ടും കോഡ് അയക്കൂ',
  'auth.otp.wrong': 'കോഡ് തെറ്റാണ്. വീണ്ടും ശ്രമിക്കൂ.',
  'ai.idle': 'ഞാൻ എങ്ങനെ സഹായിക്കണം?',
  'ai.listening': 'ഞാൻ കേൾക്കുന്നു…',
  'ai.processing': 'ഒരു നിമിഷം, നോക്കുന്നു…',
  'ai.error': 'എന്തോ തകരാർ ഉണ്ടായി. വീണ്ടും ശ്രമിക്കൂ.',
  'patient.home.talk': 'MEDORA ഒടൊപ്പം സംസാരിക്കൂ',
  'patient.home.emergency': 'അടിയന്തര സഹായം',
  'patient.home.offline': 'Internet ഇല്ല. നിങ്ങളുടെ വിവരം സുരക്ഷിതമായി save ആകും.',
  'medical.disclaimer': 'MEDORA AI മാർഗ്ഗനിർദ്ദേശം മാത്രം. ഇത് രോഗനിർണ്ണയം അല്ല.',
  'common.loading': 'ലോഡ് ചെയ്യുന്നു…',
  'common.tryAgain': 'വീണ്ടും ശ്രമിക്കൂ',
  'common.cancel': 'റദ്ദാക്കൂ',
  'common.yes': 'അതെ',
  'common.no': 'ഇല്ല',
  'common.back': 'തിരിച്ചു',
  'status.online': 'ഓൺലൈൻ',
  'status.offline': 'ഓഫ്‌ലൈൻ',
  'status.fieldMode': 'ഫീൽഡ് മോഡ്',
  'error.network': 'കണക്‌റ്റ് ചെയ്യാൻ കഴിഞ്ഞില്ല. Internet പരിശോധിക്കൂ.',
  'error.server': 'ഒരു പ്രശ്നം ഉണ്ടായി. കുറച്ചു നേരം കഴിഞ്ഞ് ശ്രമിക്കൂ.',
  'error.auth': 'Session അവസാനിച്ചു. വീണ്ടും sign in ചെയ്യൂ.',
};

const DICTIONARIES: Record<LanguageCode, Dictionary> = {
  'en-IN': enIN,
  'kn-IN': knIN,
  'hi-IN': hiIN,
  'ta-IN': taIN,
  'te-IN': teIN,
  'ml-IN': mlIN,
};

const STORAGE_KEY = 'arroh.language';

function readStoredLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LANGUAGE_CODES.includes(stored as LanguageCode)) {
      return stored as LanguageCode;
    }
  } catch { /* ignore */ }
  return DEFAULT_LANGUAGE;
}

export interface I18n {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18n>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => undefined,
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(() => readStoredLanguage());

  const setLanguage = useCallback((lang: LanguageCode) => {
    setLanguageState(lang);
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  }, []);

  // Update <html lang=""> for screen readers and font rendering.
  useEffect(() => {
    document.documentElement.lang = language.split('-')[0];
  }, [language]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const dict = DICTIONARIES[language];
      let text = dict[key] ?? enIN[key] ?? key;
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        });
      }
      return text;
    },
    [language],
  );

  const value = useMemo<I18n>(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
