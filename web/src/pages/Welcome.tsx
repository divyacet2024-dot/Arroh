/**
 * Welcome — MEDORA's AI-first landing experience.
 *
 * Visual hierarchy:
 *   MEDORA wordmark + tagline
 *   → AI Orb (centrepiece)
 *   → Greeting + AI transcript line
 *   → Microphone CTA
 *   → Three role buttons (patient / doctor / ASHA)
 *   → Language strip
 *
 * Voice flow:
 *   1. Page loads → AI greets in Kannada (speaks on first interaction)
 *   2. Tap mic → listen for intent
 *   3. Intent classified → appropriate response spoken → navigate
 *   4. Or tap a role card directly
 *   5. Or tap a language button
 *
 * No static forms. No email fields. Just: open MEDORA → the assistant speaks → user speaks.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, Volume2 } from 'lucide-react';
import { ArrohHumanAvatar } from '../components/ArrohHumanAvatar';
import { useArrohVoice } from '../lib/useArrohVoice';
import { parseIntent, intentResponse, type Intent } from '../lib/intentParser';
import { useI18n, LANGUAGE_CODES, LANGUAGE_LABELS, type LanguageCode } from '../i18n';
import { useAuth } from '../lib/auth';
import { usePatientAuth } from '../lib/patientAuth';
import { cn } from '../lib/cn';

// ── Greeting per language ────────────────────────────────────────────────────
function greeting(lang: string): string {
  if (lang.startsWith('kn')) return 'ನಮಸ್ಕಾರ. ನಾನು MEDORA. ನೀವು ರೋಗಿಯಾ, ಡಾಕ್ಟರಾ, ಅಥವಾ ಆರೋಗ್ಯ ಕಾರ್ಯಕರ್ತರಾ?';
  if (lang.startsWith('hi')) return 'नमस्ते। मैं MEDORA हूँ। आप रोगी हैं, डॉक्टर हैं, या स्वास्थ्यकर्मी?';
  if (lang.startsWith('te')) return 'నమస్కారం. నేను MEDORA. మీరు రోగా, వైద్యుడా, లేదా ఆరోగ్య కార్యకర్తా?';
  if (lang.startsWith('ta')) return 'வணக்கம். நான் MEDORA. நீங்கள் நோயாளியா, மருத்துவரா, அல்லது சுகாதார பணியாளரா?';
  return 'Hello. I am MEDORA. Are you a patient, a doctor, or a health worker?';
}

export function Welcome() {
  const { language, setLanguage, t } = useI18n();
  const navigate = useNavigate();
  const { isAuthenticated: isDoctor, isSessionReady: isDoctorSessionReady } = useAuth();
  const { isAuthenticated: isPatient, isSessionReady: isPatientSessionReady } = usePatientAuth();

  const [aiText, setAiText] = useState('');
  const [userText, setUserText] = useState('');
  const [pendingIntent, setPendingIntent] = useState<Intent | null>(null);
  const hasGreetedRef = useRef(false);

  // Redirect already-authenticated users.
  useEffect(() => {
    if (!isDoctorSessionReady || !isPatientSessionReady) return;
    if (isPatient) navigate('/patient', { replace: true });
    else if (isDoctor) navigate('/doctor', { replace: true });
  }, [isPatient, isDoctor, isDoctorSessionReady, isPatientSessionReady, navigate]);

  const handleTranscript = useCallback((text: string) => {
    setUserText(text);
    const result = parseIntent(text);
    const response = intentResponse(result.intent, language);
    setAiText(response);
    setPendingIntent(result.intent);
    voice.speak(response);
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  const voice = useArrohVoice({ language, onTranscript: handleTranscript });

  // Speak greeting once the user first interacts (autoplay policy).
  // greetOnce is also called as the onClick on the whole welcome-root div,
  // so the very first tap/click anywhere will trigger the greeting.
  const greetOnce = useCallback(() => {
    // markInteracted() must be called BEFORE voice.speak() — this is the
    // user gesture that satisfies browser autoplay policy.
    voice.markInteracted();
    if (!hasGreetedRef.current) {
      hasGreetedRef.current = true;
      const g = greeting(language);
      setAiText(g);
      // speak() now succeeds because markInteracted() set interactedRef.current
      // synchronously before returning.
      voice.speak(g);
    }
  }, [language, voice]);

  // Navigate after MEDORA has finished speaking the intent response.
  useEffect(() => {
    if (!pendingIntent || voice.state !== 'IDLE') return;
    const t = setTimeout(() => {
      if (pendingIntent === 'ROLE_PATIENT' || pendingIntent === 'AUTH_PHONE_OTP') {
        navigate('/patient-login');
      } else if (
        pendingIntent === 'ROLE_DOCTOR' ||
        pendingIntent === 'ROLE_ASHA' ||
        pendingIntent === 'AUTH_EMAIL'
      ) {
        navigate('/login');
      }
      setPendingIntent(null);
    }, 400);
    return () => clearTimeout(t);
  }, [pendingIntent, voice.state, navigate]);

  // When language changes, reset and re-greet.
  const handleLangChange = useCallback((code: LanguageCode) => {
    setLanguage(code);
    hasGreetedRef.current = false;
    const g = greeting(code);
    setAiText(g);
    setUserText('');
    setPendingIntent(null);
    voice.cancel();
  }, [setLanguage, voice]);

  const handleMicClick = useCallback(() => {
    voice.markInteracted();
    if (voice.state === 'LISTENING') {
      voice.stopListening();
    } else if (voice.state === 'SPEAKING') {
      voice.cancel();
    } else {
      greetOnce();
      voice.listen();
    }
  }, [voice, greetOnce]);

  const handleRoleCard = useCallback((role: 'patient' | 'doctor' | 'worker') => {
    voice.markInteracted();
    voice.cancel();
    if (role === 'patient') {
      const msg = intentResponse('ROLE_PATIENT', language);
      setAiText(msg);
      voice.speak(msg);
      setTimeout(() => navigate('/patient-login'), 900);
    } else {
      const msg = intentResponse('ROLE_DOCTOR', language);
      setAiText(msg);
      voice.speak(msg);
      setTimeout(() => navigate('/login'), 900);
    }
  }, [voice, language, navigate]);

  const isListening  = voice.state === 'LISTENING';
  const isSpeaking   = voice.state === 'SPEAKING';
  const isProcessing = voice.state === 'PROCESSING';

  return (
    <div className="welcome-root" onClick={greetOnce}>
      {/* Brand header */}
      <header className="welcome-header">
        <span className="welcome-logo-text">MEDORA</span>
        <span className="welcome-tagline">Smarter Care. Healthier Futures.</span>
      </header>

      {/* Language strip */}
      <nav className="welcome-lang-strip" aria-label="Language">
        {LANGUAGE_CODES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={(e) => { e.stopPropagation(); handleLangChange(code); }}
            aria-pressed={language === code}
            className={cn('welcome-lang-btn', language === code && 'welcome-lang-btn--active')}
          >
            {LANGUAGE_LABELS[code]}
          </button>
        ))}
      </nav>

      {/* Main stage */}
      <main className="welcome-stage">
        {/* AI Avatar — human digital assistant */}
        <div className="welcome-orb-wrap">
          <ArrohHumanAvatar state={voice.state} size="xl" label={`MEDORA — ${voice.state}`} />
        </div>

        {/* AI speech transcript */}
        <div className="welcome-transcript-area" aria-live="polite" aria-atomic="true">
          {aiText && (
            <p className={cn(
              'welcome-ai-text',
              isSpeaking && 'welcome-ai-text--speaking',
            )}>
              {aiText}
            </p>
          )}
          {userText && !isProcessing && (
            <p className="welcome-user-text">
              <span className="welcome-user-bubble">{userText}</span>
            </p>
          )}
          {isProcessing && (
            <p className="welcome-processing-dots">
              <span className="orb-neural-dot-inline" style={{ '--dot-angle': '0deg' } as React.CSSProperties} />
              <span className="orb-neural-dot-inline" style={{ '--dot-angle': '0deg', animationDelay: '.2s' } as React.CSSProperties} />
              <span className="orb-neural-dot-inline" style={{ '--dot-angle': '0deg', animationDelay: '.4s' } as React.CSSProperties} />
            </p>
          )}
        </div>

        {/* ── Autoplay fallback: shown before first user gesture ── */}
        {!voice.interacted && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); greetOnce(); }}
            className="welcome-tap-to-hear"
            aria-label={language.startsWith('kn') ? 'MEDORA ಕೇಳಲು ಟ್ಯಾಪ್ ಮಾಡಿ' : 'Tap to hear MEDORA'}
          >
            <Volume2 className="h-5 w-5" aria-hidden="true" />
            <span>
              {language.startsWith('kn') ? '🔊 MEDORA ಕೇಳಲು ಒತ್ತಿ' :
               language.startsWith('hi') ? '🔊 MEDORA सुनने के लिए टैप करें' :
               '🔊 Tap to hear MEDORA'}
            </span>
          </button>
        )}

        {/* Microphone CTA */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleMicClick(); }}
          aria-label={isListening ? 'Stop listening' : 'Tap to speak'}
          aria-pressed={isListening}
          className={cn(
            'welcome-mic-btn',
            isListening  && 'welcome-mic-btn--listening',
            isSpeaking   && 'welcome-mic-btn--speaking',
            isProcessing && 'welcome-mic-btn--processing',
          )}
        >
          {isListening ? (
            <MicOff className="h-8 w-8" aria-hidden="true" />
          ) : (
            <Mic className="h-8 w-8" aria-hidden="true" />
          )}
        </button>

        {voice.error && <p role="status" className="text-sm text-amber-800">{voice.error}</p>}

        <p className="welcome-mic-label">
          {isListening  ? (language.startsWith('kn') ? 'ಕೇಳುತ್ತಿದ್ದೇನೆ…'     : 'Listening…')
           : isSpeaking  ? (language.startsWith('kn') ? 'MEDORA ಮಾತಾಡುತ್ತಿದೆ…' : 'Speaking…')
           : isProcessing ? (language.startsWith('kn') ? 'ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…'   : 'Thinking…')
           : (language.startsWith('kn') ? 'ಮಾತನಾಡಲು ಒತ್ತಿ'                       : 'Tap to speak')}
        </p>

        {!voice.sttSupported && (
          <p className="welcome-no-stt">
            {language.startsWith('kn')
              ? 'ಧ್ವನಿ ಬೆಂಬಲ ಇಲ್ಲ. Chrome ಅಥವಾ Edge ಬಳಸಿ.'
              : 'Voice not supported. Use Chrome or Edge.'}
          </p>
        )}

        {/* Role cards */}
        <div className="welcome-role-row" role="group" aria-label={t('welcome.who')}>
          <RoleCard
            emoji="🧑‍⚕️"
            label={t('welcome.patient')}
            tone="teal"
            onClick={() => handleRoleCard('patient')}
          />
          <RoleCard
            emoji="👨‍⚕️"
            label={t('welcome.doctor')}
            tone="blue"
            onClick={() => handleRoleCard('doctor')}
          />
          <RoleCard
            emoji="🏥"
            label={language.startsWith('kn') ? 'ಆರೋಗ್ಯ ಕಾರ್ಯಕರ್ತ' : 'Health Worker'}
            tone="emerald"
            onClick={() => handleRoleCard('worker')}
            soon
          />
        </div>

        {/* Disclosure */}
        <p className="welcome-disclosure">
          {language.startsWith('kn')
            ? 'ನಾನು MEDORA AI. ಅಗತ್ಯವಿದ್ದಾಗ ನಿಮ್ಮನ್ನು healthcare professional ಜೊತೆ connect ಮಾಡುತ್ತೇನೆ.'
            : 'I am the MEDORA AI assistant — not a licensed doctor. When needed, I connect you with a healthcare professional.'}
        </p>
      </main>
    </div>
  );
}

// ── Role card ─────────────────────────────────────────────────────────────────

interface RoleCardProps {
  emoji: string;
  label: string;
  tone: 'teal' | 'blue' | 'emerald';
  onClick: () => void;
  soon?: boolean;
}

function RoleCard({ emoji, label, tone, onClick, soon }: RoleCardProps) {
  return (
    <button
      type="button"
      onClick={soon ? undefined : onClick}
      disabled={soon}
      className={cn('welcome-role-card', `welcome-role-card--${tone}`, soon && 'opacity-50 cursor-not-allowed')}
    >
      <span className="welcome-role-emoji">{emoji}</span>
      <span className="welcome-role-label">{label}</span>
      {soon && <span className="welcome-role-soon">ಶೀಘ್ರ</span>}
    </button>
  );
}
