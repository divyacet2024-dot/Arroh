/**
 * PatientLogin — MEDORA patient authentication.
 *
 * Screens (linear state machine, no nested routing):
 *   PHONE   → enter / speak mobile number
 *   CONFIRM → review number before requesting OTP
 *   OTP     → enter 6-digit code (type, paste, or speak)
 *   SUCCESS → brief success before navigating to /patient
 *
 * Design decisions:
 *   - Single-column card on all viewports; max-width 420 px
 *   - MEDORA wordmark + tagline at top instead of a generic icon
 *   - ArrohHumanAvatar reflects actual voice state (IDLE/LISTENING/SPEAKING/…)
 *   - Voice status banner shown when ttsVoiceAvailable = false
 *   - All error messages use i18n keys or humaniseError()
 *   - Dev OTP clearly labelled so no patient confuses it for a real SMS
 *   - No token, phone, or OTP values logged or shown in prod
 *   - 44 px+ touch targets throughout
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Mic, MicOff, VolumeX } from 'lucide-react';
import { ArrohHumanAvatar }         from '../components/ArrohHumanAvatar';
import { PatientLanguageSelect }    from '../components/PatientLanguageSelect';
import { useArrohVoice }            from '../lib/useArrohVoice';
import { extractMobileFromSpeech, formatMobileDisplay } from '../lib/kannadaNumbers';
import { useI18n }                  from '../i18n';
import { usePatientAuth }           from '../lib/patientAuth';
import { requestOtp, verifyOtp, type OtpErrorDetail } from '../services/patientAuth';
import { ApiError }                 from '../services/api';
import { cn }                       from '../lib/cn';

type Screen = 'PHONE' | 'CONFIRM' | 'OTP' | 'SUCCESS';

const PHONE_RE = /^[6-9]\d{9}$/;

function humaniseError(err: unknown, lang: string): string {
  const isKn = lang.startsWith('kn');
  if (err instanceof ApiError) {
    const d = err.details as OtpErrorDetail | undefined;
    if (d?.code === 'otp_expired')
      return isKn
        ? 'OTP ಅವಧಿ ಮುಗಿದಿದೆ. ಹೊಸ OTP ತರಿಸಿ.'
        : 'The code has expired. Please request a new one.';
    if (d?.code === 'otp_locked')
      return isKn
        ? 'ತಪ್ಪು OTP ಹಲವು ಬಾರಿ. ಹೊಸ OTP ತರಿಸಿ.'
        : 'Too many incorrect attempts. Please request a new code.';
    if (d?.code === 'otp_delivery_unavailable')
      return isKn
        ? 'OTP ಸೇವೆ ಸಿದ್ಧವಾಗಿಲ್ಲ. ಸೇವಾ ನಿರ್ವಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.'
        : 'OTP delivery is not configured. Please contact the service administrator.';
    if (d?.code === 'otp_wrong')
      return isKn
        ? `OTP ತಪ್ಪಾಗಿದೆ. ${d.message ?? ''}`
        : d.message ?? 'Incorrect code. Please try again.';
    if (d?.message) return d.message;
    if (err.status === 429)
      return isKn ? 'ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಕಾಯಿರಿ.' : 'Please wait a moment before retrying.';
  }
  return isKn
    ? 'ಕ್ಷಮಿಸಿ, ತೊಂದರೆ ಆಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.'
    : 'Something went wrong. Please try again.';
}

export function PatientLogin() {
  const { language, t }              = useI18n();
  const navigate                     = useNavigate();
  const { applySession, isAuthenticated, isSessionReady } = usePatientAuth();

  const isKn = language.startsWith('kn');
  const isHi = language.startsWith('hi');

  const [screen, setScreen]       = useState<Screen>('PHONE');
  const [phone, setPhone]         = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [otp, setOtp]             = useState(['', '', '', '', '', '']);
  const [otpError, setOtpError]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [cooldown, setCooldown]   = useState(0);
  const [devOtp, setDevOtp]       = useState<string | null>(null);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (isSessionReady && isAuthenticated) navigate('/patient', { replace: true });
  }, [isAuthenticated, isSessionReady, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // ── Voice ─────────────────────────────────────────────────────────────────

  const handleVoicePhone = useCallback(
    (text: string) => {
      const num = extractMobileFromSpeech(text);
      if (num) {
        setPhone(num);
        setPhoneError('');
        const confirmMsg = isKn
          ? `ನೀವು ಹೇಳಿದ ನಂಬರ್ ${num.split('').join(' ')}. ಸರಿಯೇ?`
          : `You said ${num}. Is that correct?`;
        voice.speak(confirmMsg);
        setScreen('CONFIRM');
      } else {
        const errMsg = isKn
          ? 'ನಂಬರ್ ಸರಿಯಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ.'
          : 'Could not catch that number. Please say it again.';
        voice.speak(errMsg);
      }
    },
    // voice is stable; isKn derived from language which doesn't change mid-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isKn],
  );

  const handleVoiceOtp = useCallback((text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    if (digits.length === 6) {
      setOtp(digits.split(''));
      otpRefs.current[5]?.focus();
    }
  }, []);

  const voice = useArrohVoice({
    language,
    onTranscript: screen === 'OTP' ? handleVoiceOtp : handleVoicePhone,
  });

  // Speak initial prompt once on mount (queued until user interacts)
  const promptedRef = useRef(false);
  useEffect(() => {
    if (promptedRef.current) return;
    promptedRef.current = true;
    const msg = isKn
      ? 'ನಿಮ್ಮ ಮೊಬೈಲ್ ನಂಬರ್ ಹೇಳಿ ಅಥವಾ ಟೈಪ್ ಮಾಡಿ.'
      : isHi
      ? 'अपना मोबाइल नंबर बताएं या टाइप करें।'
      : 'Please say or type your mobile number.';
    voice.speak(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Phone submit ──────────────────────────────────────────────────────────

  const submitPhone = useCallback(() => {
    const clean = phone.replace(/\D/g, '').slice(-10);
    if (!PHONE_RE.test(clean)) {
      setPhoneError(
        isKn ? 'ಸರಿಯಾದ 10 ಅಂಕಿಯ ಮೊಬೈಲ್ ನಂಬರ್ ಹಾಕಿ.' : 'Enter a valid 10-digit mobile number.',
      );
      return;
    }
    setPhone(clean);
    setPhoneError('');
    const msg = isKn
      ? `ನಿಮ್ಮ ನಂಬರ್ ${clean.split('').join(' ')}. ಸರಿಯೇ?`
      : `Your number is ${clean}. Is that correct?`;
    voice.speak(msg);
    setScreen('CONFIRM');
  }, [phone, isKn, voice]);

  // ── Send OTP ──────────────────────────────────────────────────────────────

  const sendOtp = useCallback(async () => {
    setLoading(true);
    try {
      const res = await requestOtp(phone);
      setCooldown(res.resend_after_seconds ?? 60);
      setDevOtp(res.dev_otp ?? null);
      const msg = res.dev_otp
        ? t('auth.otp.devSpoken')
        : t('auth.otp.promptSpoken');
      voice.speak(msg);
      setScreen('OTP');
    } catch (err) {
      const msg = humaniseError(err, language);
      setPhoneError(msg);
      voice.speak(msg);
      setScreen('PHONE');
    } finally {
      setLoading(false);
    }
  }, [phone, language, t, voice]);

  // ── Verify OTP ────────────────────────────────────────────────────────────

  const submitOtp = useCallback(async () => {
    const code = otp.join('');
    if (code.length < 6) {
      setOtpError(isKn ? '6 ಅಂಕಿಯ ಕೋಡ್ ಹಾಕಿ.' : 'Please enter all 6 digits.');
      return;
    }
    setLoading(true);
    try {
      const res = await verifyOtp(phone, code);
      applySession(res.user, res.token);
      voice.speak(isKn ? 'ಲಾಗಿನ್ ಆಯಿತು. ಸ್ವಾಗತ!' : 'Login successful. Welcome!');
      setScreen('SUCCESS');
      setTimeout(() => navigate('/patient', { replace: true }), 1400);
    } catch (err) {
      const msg = humaniseError(err, language);
      setOtpError(msg);
      voice.speak(msg);
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }, [otp, phone, isKn, language, voice, applySession, navigate]);

  const handleResend = useCallback(async () => {
    if (cooldown > 0) return;
    setDevOtp(null);
    setOtp(['', '', '', '', '', '']);
    setOtpError('');
    await sendOtp();
  }, [cooldown, sendOtp]);

  // ── OTP input helpers ─────────────────────────────────────────────────────

  const handleOtpChange = (i: number, val: string) => {
    const d = val.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[i] = d;
    setOtp(next);
    setOtpError('');
    if (d && i < 5) otpRefs.current[i + 1]?.focus();
  };
  const handleOtpKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  };
  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const p = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (p.length === 6) {
      setOtp(p.split(''));
      otpRefs.current[5]?.focus();
    }
  };

  // ── Back navigation ───────────────────────────────────────────────────────

  const handleBack = () => {
    voice.cancel();
    if (screen === 'OTP' || screen === 'CONFIRM') setScreen('PHONE');
    else navigate('/');
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="pl-root"
      onClick={() => voice.markInteracted()}
    >
      {/* ── Header ── */}
      <header className="pl-header">
        {screen !== 'SUCCESS' && (
          <button
            type="button"
            className="pl-back-btn"
            aria-label={t('auth.back')}
            onClick={(e) => { e.stopPropagation(); handleBack(); }}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">{t('auth.back')}</span>
          </button>
        )}
        <div className="pl-brand">
          <span className="pl-brand-name">MEDORA</span>
          <span className="pl-brand-tagline">{t('app.tagline')}</span>
        </div>
        <div className="pl-header-spacer" aria-hidden="true" />
      </header>

      <div className="pl-language-row">
        <PatientLanguageSelect />
      </div>

      {/* ── Voice status banner ── */}
      {!voice.ttsVoiceAvailable && voice.ttsSupported && (
        <div className="pl-voice-banner" role="status">
          <VolumeX className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-sm leading-snug">
            {voice.ttsVoiceRequiresNetwork
              ? 'The installed voice requires internet access. MEDORA is using text instead.'
              : isKn
              ? 'ಈ ಸಾಧನದಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಇಲ್ಲ. ಪ್ರತಿಕ್ರಿಯೆ ಪರದೆಯಲ್ಲಿ ಓದಬಹುದು.'
              : 'No voice found for this language. Responses are shown on screen.'}
          </p>
        </div>
      )}
      {!voice.ttsSupported && (
        <div className="pl-voice-banner" role="status">
          <VolumeX className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-sm leading-snug">
            {isKn
              ? 'ಈ browser ಭಾಷಣ ಬೆಂಬಲಿಸುವುದಿಲ್ಲ. ಪ್ರತಿಕ್ರಿಯೆ ಪರದೆಯಲ್ಲಿ ಓದಬಹುದು.'
              : 'Speech is not supported in this browser. Responses are shown on screen.'}
          </p>
        </div>
      )}

      {/* ── Avatar ── */}
      <div className="pl-avatar-section">
        <ArrohHumanAvatar state={voice.state} size="lg" />
        {/* Voice state label */}
        <p className="pl-avatar-status" aria-live="polite" aria-atomic="true">
          {voice.state === 'LISTENING'
            ? (isKn ? 'ಕೇಳುತ್ತಿದ್ದೇನೆ…' : 'Listening…')
            : voice.state === 'SPEAKING'
            ? (isKn ? 'ಮಾತಾಡುತ್ತಿದ್ದೇನೆ…' : 'Speaking…')
            : voice.state === 'PROCESSING'
            ? (isKn ? 'ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…' : 'Thinking…')
            : '\u00A0' /* non-breaking space to preserve height */}
        </p>
        {/* TTS / STT error — shown below avatar, not as a disruptive alert */}
        {voice.error && (
          <p className="pl-voice-error" role="status">
            {voice.error}
          </p>
        )}
      </div>

      {/* ── Screens ── */}
      <div className="pl-card-area">

        {/* ──────── PHONE ──────── */}
        {screen === 'PHONE' && (
          <section className="pl-card" aria-label={isKn ? 'ಮೊಬೈಲ್ ನಂಬರ್' : 'Mobile number'}>
            <h1 className="pl-card-title">{t('auth.mobile.title')}</h1>
            <p className="pl-card-hint">{t('auth.mobile.help')}</p>

            <div className={cn('pl-phone-row', phoneError && 'pl-phone-row--error')}>
              <span className="pl-phone-prefix" aria-hidden="true">+91</span>
              <input
                id="phone-input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                value={phone}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                  setPhoneError('');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') submitPhone(); }}
                placeholder="9876543210"
                aria-label={t('auth.mobile.label')}
                aria-describedby={phoneError ? 'phone-error' : 'phone-hint'}
                aria-invalid={phoneError ? 'true' : undefined}
                className="pl-phone-input"
                autoFocus
              />
            </div>
            <p id="phone-hint" className="sr-only">{t('auth.mobile.help')}</p>
            {phoneError && (
              <p id="phone-error" role="alert" className="pl-field-error">
                {phoneError}
              </p>
            )}

            <button
              type="button"
              disabled={loading || phone.length < 10}
              onClick={submitPhone}
              className="pl-btn-primary"
            >
              {loading ? t('common.loading') : t('auth.mobile.submit')}
            </button>

            {/* Mic button — only when STT supported */}
            {voice.sttSupported && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  voice.markInteracted();
                  if (voice.state === 'LISTENING') voice.stopListening();
                  else voice.listen();
                }}
                aria-label={
                  voice.state === 'LISTENING'
                    ? (isKn ? 'ಕೇಳುವಿಕೆ ನಿಲ್ಲಿಸಿ' : 'Stop listening')
                    : (isKn ? 'ನಂಬರ್ ಹೇಳಿ' : 'Say your number')
                }
                aria-pressed={voice.state === 'LISTENING'}
                className={cn('pl-mic-btn', voice.state === 'LISTENING' && 'pl-mic-btn--active')}
              >
                {voice.state === 'LISTENING' ? (
                  <>
                    <MicOff className="h-5 w-5" aria-hidden="true" />
                    <span>{isKn ? 'ಕೇಳುತ್ತಿದ್ದೇನೆ…' : 'Listening…'}</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-5 w-5" aria-hidden="true" />
                    <span>{isKn ? 'ನಂಬರ್ ಹೇಳಿ' : 'Say your number'}</span>
                  </>
                )}
              </button>
            )}

            <p className="pl-privacy-note">
              {isKn
                ? 'ನಿಮ್ಮ ಫೋನ್ ನಂಬರ್ ಸುರಕ್ಷಿತವಾಗಿ ಬಳಸಲಾಗುತ್ತದೆ. ಮೂರನೇ ವ್ಯಕ್ತಿಗಳಿಗೆ ಹಂಚಿಕೊಳ್ಳಲಾಗುವುದಿಲ್ಲ.'
                : 'Your phone number is used only to verify your identity and is never shared with third parties.'}
            </p>
          </section>
        )}

        {/* ──────── CONFIRM ──────── */}
        {screen === 'CONFIRM' && (
          <section className="pl-card" aria-label={isKn ? 'ನಂಬರ್ ದೃಢೀಕರಣ' : 'Confirm number'}>
            <h1 className="pl-card-title">
              {isKn ? 'ನಂಬರ್ ಸರಿಯಾಗಿದೆಯೇ?' : 'Is this your number?'}
            </h1>
            <div className="pl-confirm-number">
              <span>{formatMobileDisplay(phone)}</span>
            </div>
            <p className="pl-card-hint">
              {isKn
                ? 'ಈ ನಂಬರ್‌ಗೆ ಒಂದು ಬಾರಿ ಬಳಸುವ ಕೋಡ್ ಕಳಿಸಲಾಗುತ್ತದೆ.'
                : isHi
                ? 'इस नंबर पर एक बार इस्तेमाल होने वाला कोड भेजा जाएगा।'
                : 'A one-time code will be sent to this number.'}
            </p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void sendOtp(); }}
              disabled={loading}
              className="pl-btn-primary"
            >
              {loading ? t('common.loading') : (isKn ? 'ಹೌದು, ಕೋಡ್ ಕಳಿಸಿ' : t('auth.mobile.confirm.correct'))}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); voice.cancel(); setScreen('PHONE'); }}
              disabled={loading}
              className="pl-btn-secondary"
            >
              {isKn ? 'ಬದಲಾಯಿಸಿ' : t('auth.mobile.confirm.change')}
            </button>
          </section>
        )}

        {/* ──────── OTP ──────── */}
        {screen === 'OTP' && (
          <section className="pl-card" aria-label={isKn ? 'OTP ಕೋಡ್' : 'OTP code'}>
            <h1 className="pl-card-title">{t('auth.otp.title')}</h1>
            <p className="pl-card-hint">
              {devOtp ? t('auth.otp.devPrompt') : t('auth.otp.prompt')}{' '}
              <strong>{formatMobileDisplay(phone)}</strong>
            </p>

            {/* Dev OTP — clearly marked, not styled as a success */}
            {devOtp && (
              <div className="pl-dev-otp" role="note" aria-label="Development code">
                <span className="pl-dev-otp-label">{t('auth.otp.dev')}</span>
                <span className="pl-dev-otp-code">{devOtp}</span>
              </div>
            )}

            <div
              className="pl-otp-row"
              onPaste={handleOtpPaste}
              role="group"
              aria-label={t('auth.otp.label')}
            >
              {otp.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKey(i, e)}
                  aria-label={`Digit ${i + 1} of 6`}
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  autoFocus={i === 0}
                  className={cn('pl-otp-box', otpError && 'pl-otp-box--error')}
                />
              ))}
            </div>

            {otpError && (
              <p role="alert" className="pl-field-error">
                {otpError}
              </p>
            )}

            <button
              type="button"
              disabled={loading || otp.join('').length < 6}
              onClick={(e) => { e.stopPropagation(); void submitOtp(); }}
              className="pl-btn-primary"
            >
              {loading ? t('common.loading') : t('auth.otp.verify')}
            </button>

            {/* Voice OTP entry */}
            {voice.sttSupported && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  voice.markInteracted();
                  if (voice.state === 'LISTENING') voice.stopListening();
                  else voice.listen();
                }}
                aria-label={
                  voice.state === 'LISTENING'
                    ? (isKn ? 'ಕೇಳುವಿಕೆ ನಿಲ್ಲಿಸಿ' : 'Stop listening')
                    : (isKn ? 'ಕೋಡ್ ಹೇಳಿ' : 'Say the code')
                }
                aria-pressed={voice.state === 'LISTENING'}
                className={cn('pl-mic-btn', voice.state === 'LISTENING' && 'pl-mic-btn--active')}
              >
                {voice.state === 'LISTENING' ? (
                  <>
                    <MicOff className="h-5 w-5" aria-hidden="true" />
                    <span>{isKn ? 'ಕೇಳುತ್ತಿದ್ದೇನೆ…' : 'Listening…'}</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-5 w-5" aria-hidden="true" />
                    <span>{isKn ? 'ಕೋಡ್ ಹೇಳಿ' : 'Say the code'}</span>
                  </>
                )}
              </button>
            )}

            {/* Resend */}
            <div className="pl-resend-row">
              {cooldown > 0 ? (
                <span className="pl-resend-timer">
                  {t('auth.otp.resend.wait')} {cooldown}s
                </span>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleResend(); }}
                  disabled={loading}
                  className="pl-resend-btn"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {t('auth.otp.resend')}
                </button>
              )}
            </div>
          </section>
        )}

        {/* ──────── SUCCESS ──────── */}
        {screen === 'SUCCESS' && (
          <section
            className="pl-card pl-card--center"
            aria-label={isKn ? 'ಯಶಸ್ವಿ' : 'Success'}
            aria-live="polite"
          >
            <ArrohHumanAvatar state="SUCCESS" size="lg" />
            <h1 className="pl-success-title">
              {isKn ? 'ಸ್ವಾಗತ!' : isHi ? 'स्वागत है!' : 'Welcome!'}
            </h1>
            <p className="pl-card-hint">
              {isKn ? 'MEDORA ತೆರೆಯುತ್ತಿದೆ…' : 'Opening MEDORA…'}
            </p>
          </section>
        )}
      </div>

      {/* ── Medical disclaimer ── */}
      {screen !== 'SUCCESS' && (
        <p className="pl-disclaimer">{t('medical.disclaimer')}</p>
      )}
    </div>
  );
}
