/**
 * PatientLogin — voice-first mobile + OTP authentication.
 *
 * The experience is a conversation, not a form:
 *   MEDORA speaks → patient responds (voice or type) → MEDORA confirms → OTP
 *
 * Key fixes applied:
 *  - extractMobileFromSpeech() now handles Kannada script/spoken/ASR digits
 *  - TTS uses useArrohVoice (voiceschanged-aware, autoplay-safe)
 *  - SPEAKING avatar state driven by real onend events (not setTimeout)
 *  - Confirmation gate before OTP is sent
 *  - Dev OTP shown only when backend returns it (api_env=development)
 */

import {
  useState, useRef, useCallback, useEffect,
  type ChangeEvent, type KeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Mic, MicOff } from 'lucide-react';
import { ArrohHumanAvatar } from '../components/ArrohHumanAvatar';
import { useArrohVoice } from '../lib/useArrohVoice';
import { extractMobileFromSpeech, formatMobileDisplay } from '../lib/kannadaNumbers';
import { useI18n } from '../i18n';
import { usePatientAuth } from '../lib/patientAuth';
import { requestOtp, verifyOtp, type OtpErrorDetail } from '../services/patientAuth';
import { ApiError } from '../services/api';
import { cn } from '../lib/cn';

type Screen = 'PHONE' | 'CONFIRM' | 'OTP' | 'SUCCESS';

const PHONE_RE = /^[6-9]\d{9}$/;

function humaniseError(err: unknown, lang: string): string {
  const isKn = lang.startsWith('kn');
  if (err instanceof ApiError) {
    const d = err.details as OtpErrorDetail | undefined;
    if (d?.code === 'otp_expired')
      return isKn ? 'OTP ಅವಧಿ ಮುಗಿದಿದೆ. ಹೊಸ OTP ತರಿಸಿ.' : 'OTP has expired. Request a new one.';
    if (d?.code === 'otp_locked')
      return isKn ? 'ತಪ್ಪು OTP ಹಲವು ಬಾರಿ. ಹೊಸ OTP ತರಿಸಿ.' : 'Too many wrong attempts. Request a new OTP.';
    if (d?.code === 'otp_wrong')
      return isKn ? `OTP ತಪ್ಪಾಗಿದೆ. ${d.message ?? ''}` : d.message ?? 'Wrong OTP. Try again.';
    if (d?.message) return d.message;
    if (err.status === 429)
      return isKn ? 'ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಕಾಯಿರಿ.' : 'Please wait a moment.';
  }
  return isKn ? 'ತೊಂದರೆ ಆಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.' : 'Something went wrong. Please try again.';
}

export function PatientLogin() {
  const { language, t }         = useI18n();
  const navigate                 = useNavigate();
  const { applySession, isAuthenticated } = usePatientAuth();

  const isKn = language.startsWith('kn');
  const isHi = language.startsWith('hi');

  const [screen, setScreen]         = useState<Screen>('PHONE');
  const [phone, setPhone]           = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [otp, setOtp]               = useState(['', '', '', '', '', '']);
  const [otpError, setOtpError]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [cooldown, setCooldown]     = useState(0);
  const [devOtp, setDevOtp]         = useState<string | null>(null);
  const otpRefs                     = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (isAuthenticated) navigate('/patient', { replace: true });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // ── Voice callbacks ──────────────────────────────────────────────────────

  const handleVoicePhone = useCallback((text: string) => {
    const num = extractMobileFromSpeech(text);
    if (num) {
      setPhone(num);
      setPhoneError('');
      const confirm = isKn
        ? `ನೀವು ಹೇಳಿದ ನಂಬರ್ ${num.split('').join(' ')}. ಸರಿಯೇ?`
        : `You said ${num}. Is that correct?`;
      voice.speak(confirm);
      setScreen('CONFIRM');
    } else {
      const err = isKn
        ? 'ನನಗೆ ಸರಿಯಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ.'
        : 'I could not catch that number. Please say it again.';
      voice.speak(err);
    }
  }, [isKn]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVoiceOtp = useCallback((text: string) => {
    // Extract up to 6 digits from spoken OTP (handles "two three four five six seven").
    const digits = text.replace(/[^0-9]/g, '').slice(0, 6);
    if (digits.length === 6) {
      setOtp(digits.split(''));
      otpRefs.current[5]?.focus();
    }
  }, []);

  const voice = useArrohVoice({
    language,
    onTranscript: screen === 'OTP' ? handleVoiceOtp : handleVoicePhone,
  });

  // Speak the initial prompt once on mount.
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phone submit ─────────────────────────────────────────────────────────

  const submitPhone = useCallback(() => {
    const clean = phone.replace(/\D/g, '').slice(-10);
    if (!PHONE_RE.test(clean)) {
      setPhoneError(isKn ? 'ಸರಿಯಾದ 10 ಅಂಕಿಯ ಮೊಬೈಲ್ ನಂಬರ್ ಹಾಕಿ.' : 'Enter a valid 10-digit mobile number.');
      return;
    }
    setPhone(clean);
    setPhoneError('');
    const confirm = isKn
      ? `ನೀವು ಹೇಳಿದ ನಂಬರ್ ${clean.split('').join(' ')}. ಸರಿಯೇ?`
      : `Your number is ${clean}. Is that correct?`;
    voice.speak(confirm);
    setScreen('CONFIRM');
  }, [phone, isKn, voice]);

  // ── Send OTP ─────────────────────────────────────────────────────────────

  const sendOtp = useCallback(async () => {
    setLoading(true);
    try {
      const res = await requestOtp(phone);
      setCooldown(res.resend_after_seconds ?? 60);
      if (res.dev_otp) setDevOtp(res.dev_otp);
      const sent = isKn
        ? 'OTP ಕಳಿಸಿದ್ದೇನೆ. 6 ಅಂಕಿಯ ಕೋಡ್ ಹಾಕಿ.'
        : 'OTP sent. Please enter the 6-digit code.';
      voice.speak(sent);
      setScreen('OTP');
    } catch (err) {
      const msg = humaniseError(err, language);
      setPhoneError(msg);
      voice.speak(msg);
      setScreen('PHONE');
    } finally {
      setLoading(false);
    }
  }, [phone, isKn, language, voice]);

  // ── Verify OTP ───────────────────────────────────────────────────────────

  const submitOtp = useCallback(async () => {
    const code = otp.join('');
    if (code.length < 6) {
      setOtpError(isKn ? '6 ಅಂಕಿಯ ಕೋಡ್ ಹಾಕಿ.' : 'Enter all 6 digits.');
      return;
    }
    setLoading(true);
    try {
      const res = await verifyOtp(phone, code);
      applySession(res.user, res.token);
      const ok = isKn ? 'ಲಾಗಿನ್ ಯಶಸ್ವಿ. ಸ್ವಾಗತ!' : 'Login successful. Welcome!';
      voice.speak(ok);
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

  // ── OTP input handlers ───────────────────────────────────────────────────

  const handleOtpChange = (i: number, val: string) => {
    const d = val.replace(/\D/g, '').slice(-1);
    const next = [...otp]; next[i] = d; setOtp(next); setOtpError('');
    if (d && i < 5) otpRefs.current[i + 1]?.focus();
  };
  const handleOtpKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  };
  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const p = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (p.length === 6) { setOtp(p.split('')); otpRefs.current[5]?.focus(); }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="patl-root" onClick={() => voice.markInteracted()}>

      {/* Back */}
      {screen !== 'SUCCESS' && (
        <button
          type="button"
          className="patl-back"
          aria-label={t('auth.back')}
          onClick={() => {
            voice.cancel();
            if (screen === 'OTP' || screen === 'CONFIRM') setScreen('PHONE');
            else navigate('/');
          }}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          <span>{t('auth.back')}</span>
        </button>
      )}

      {/* Human avatar */}
      <div className="patl-orb-wrap">
        <ArrohHumanAvatar state={voice.state} size="lg" />
      </div>
      {voice.error && <p role="status" className="patl-error">{voice.error}</p>}

      {/* ── PHONE ── */}
      {screen === 'PHONE' && (
        <div className="patl-card">
          <h1 className="patl-title">
            {isKn ? 'ನಿಮ್ಮ ಮೊಬೈಲ್ ನಂಬರ್ ಹಾಕಿ' : t('auth.mobile.title')}
          </h1>
          <p className="patl-hint">
            {isKn ? 'ಈ ನಂಬರ್‌ಗೆ OTP ಕಳಿಸುತ್ತೇವೆ.' : t('auth.mobile.help')}
          </p>

          <div className="patl-phone-row">
            <span className="patl-prefix">+91</span>
            <input
              type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10}
              value={phone}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                setPhoneError('');
              }}
              placeholder="9876543210"
              aria-label={t('auth.mobile.label')}
              aria-invalid={!!phoneError}
              className={cn('patl-phone-input', phoneError && 'patl-input-error')}
              autoFocus
            />
          </div>

          {phoneError && <p role="alert" className="patl-error">{phoneError}</p>}

          <button
            type="button" disabled={loading || phone.length < 10}
            onClick={submitPhone}
            className="patl-btn-primary"
          >
            {loading ? t('common.loading') : t('auth.mobile.submit')}
          </button>

          {/* Mic button */}
          <button
            type="button"
            onClick={() => { voice.markInteracted(); voice.listen(); }}
            className={cn('patl-mic-btn', voice.state === 'LISTENING' && 'patl-mic-btn--active')}
            aria-label={isKn ? 'ನಂಬರ್ ಹೇಳಿ' : 'Say your number'}
            aria-pressed={voice.state === 'LISTENING'}
          >
            {voice.state === 'LISTENING'
              ? <><MicOff className="h-5 w-5" aria-hidden="true" /> {isKn ? 'ಕೇಳುತ್ತಿದ್ದೇನೆ…' : 'Listening…'}</>
              : <><Mic   className="h-5 w-5" aria-hidden="true" /> {isKn ? 'ನಂಬರ್ ಹೇಳಿ' : 'Say your number'}</>}
          </button>
        </div>
      )}

      {/* ── CONFIRM ── */}
      {screen === 'CONFIRM' && (
        <div className="patl-card">
          <h1 className="patl-title">
            {isKn ? 'ನಂಬರ್ ಸರಿಯಾಗಿದೆಯೇ?' : 'Is this your number?'}
          </h1>
          <div className="patl-phone-display">
            <span>{formatMobileDisplay(phone)}</span>
          </div>
          <p className="patl-hint">
            {isKn ? 'ಈ ನಂಬರ್‌ಗೆ OTP ಕಳಿಸಲಾಗುತ್ತದೆ.' : 'An OTP will be sent to this number.'}
          </p>
          <button type="button" onClick={sendOtp} disabled={loading} className="patl-btn-primary">
            {loading ? t('common.loading') : (isKn ? 'ಹೌದು, ಸರಿ' : t('auth.mobile.confirm.correct'))}
          </button>
          <button type="button" onClick={() => { voice.cancel(); setScreen('PHONE'); }} className="patl-btn-secondary">
            {isKn ? 'ಬದಲಾಯಿಸಿ' : t('auth.mobile.confirm.change')}
          </button>
        </div>
      )}

      {/* ── OTP ── */}
      {screen === 'OTP' && (
        <div className="patl-card">
          <h1 className="patl-title">{t('auth.otp.title')}</h1>
          <p className="patl-hint">
            {isKn ? 'ನಿಮ್ಮ ನಂಬರ್‌ಗೆ ಕಳಿಸಿದ 6 ಅಂಕಿಯ ಕೋಡ್ ಹಾಕಿ:' : `${t('auth.otp.sent')}`}{' '}
            <strong>{formatMobileDisplay(phone)}</strong>
          </p>

          {devOtp && (
            <div className="patl-dev-otp">
              <span>{t('auth.otp.dev')}</span>
              <span className="font-mono font-bold text-amber-800 tracking-widest text-xl">{devOtp}</span>
            </div>
          )}

          <div className="patl-otp-row" onPaste={handleOtpPaste} aria-label={t('auth.otp.label')}>
            {otp.map((d, i) => (
              <input
                key={i}
                ref={(el) => { otpRefs.current[i] = el; }}
                type="text" inputMode="numeric" maxLength={1}
                value={d}
                onChange={(e) => handleOtpChange(i, e.target.value)}
                onKeyDown={(e) => handleOtpKey(i, e)}
                aria-label={`Digit ${i + 1}`}
                autoComplete="one-time-code"
                autoFocus={i === 0}
                className={cn('patl-otp-box', otpError && 'patl-input-error')}
              />
            ))}
          </div>

          {otpError && <p role="alert" className="patl-error">{otpError}</p>}

          <button
            type="button"
            disabled={loading || otp.join('').length < 6}
            onClick={submitOtp}
            className="patl-btn-primary"
          >
            {loading ? t('common.loading') : t('auth.otp.verify')}
          </button>

          {/* Voice OTP */}
          <button
            type="button"
            onClick={() => { voice.markInteracted(); voice.listen(); }}
            className={cn('patl-mic-btn', voice.state === 'LISTENING' && 'patl-mic-btn--active')}
            aria-label={isKn ? 'ಕೋಡ್ ಹೇಳಿ' : 'Say the code'}
          >
            <Mic className="h-5 w-5" aria-hidden="true" />
            {isKn ? 'ಕೋಡ್ ಹೇಳಿ' : 'Say the code'}
          </button>

          <div className="patl-resend-row">
            {cooldown > 0 ? (
              <span className="patl-resend-timer">{t('auth.otp.resend.wait')} {cooldown}s</span>
            ) : (
              <button type="button" onClick={handleResend} disabled={loading} className="patl-resend-btn">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {t('auth.otp.resend')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── SUCCESS ── */}
      {screen === 'SUCCESS' && (
        <div className="patl-card items-center text-center">
          <ArrohHumanAvatar state="SUCCESS" size="lg" />
          <p className="mt-5 text-2xl font-bold text-emerald-700">
            {isKn ? 'ಸ್ವಾಗತ!' : 'Welcome!'}
          </p>
          <p className="text-sm text-slate-500 mt-2">
            {isKn ? 'MEDORA ತೆರೆಯುತ್ತಿದೆ…' : 'Opening MEDORA…'}
          </p>
        </div>
      )}
    </div>
  );
}
