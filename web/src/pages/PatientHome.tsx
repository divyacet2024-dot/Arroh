/**
 * PatientHome — AI-first patient experience.
 *
 * Architecture:
 *   - ArrohHumanAvatar is the primary visual, always visible
 *   - patientAgent dispatches voice/text input to real backend tools
 *   - SymptomPicker appears when agent triggers SHOW_SYMPTOM_PICKER
 *   - Confirmation gate (ಹೌದು / ಬದಲಾಯಿಸಿ) before any sensitive action
 *   - All messages show in a conversational transcript beneath the avatar
 *   - Offline status shown clearly — no false network claims
 *   - Secondary action tiles remain accessible
 */

import {
  useState, useCallback, useRef, useEffect,
  type KeyboardEvent,
} from 'react';
import {
  Heart, Calendar, FileText, ArrowUpRight,
  Pill, Siren, WifiOff, Mic, MicOff,
  CheckCircle, XCircle, Send,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { usePatientAuth } from '../lib/patientAuth';
import { useConnectivity } from '../lib/offline/connectivity';
import { ArrohHumanAvatar } from '../components/ArrohHumanAvatar';
import { SymptomPicker, type SelectedSymptom } from '../components/SymptomPicker';
import { useArrohVoice } from '../lib/useArrohVoice';
import {
  dispatch as agentDispatch,
  createContext as createAgentContext,
  addTappedSymptoms,
  confirmPending,
  cancelPending,
  type AgentContext,
  type AgentAction,
  type AgentResponse,
} from '../lib/patientAgent';
import { ARROH_GREETING } from '../lib/languageConfig';
import { cn } from '../lib/cn';

// ── Message types ─────────────────────────────────────────────────────────────
interface Message {
  role: 'ai' | 'user';
  text: string;
  action?: AgentAction;
  data?: Record<string, unknown>;
}

// ── Main PatientHome ──────────────────────────────────────────────────────────

export function PatientHome() {
  const { t, language } = useI18n();
  const { user, logout, token } = usePatientAuth();
  const { online } = useConnectivity();
  const navigate = useNavigate();

  const isKn = language.startsWith('kn');
  const isHi = language.startsWith('hi');
  const firstName = user?.name?.trim().split(' ')[0] || null;

  // ── Agent context — persistent for the session ──────────────────────────
  const agentCtxRef = useRef<AgentContext>(
    createAgentContext(user?.id ?? null, token, language),
  );
  // Keep language + token in sync when they change
  useEffect(() => {
    agentCtxRef.current.language      = language;
    agentCtxRef.current.patientToken  = token;
    agentCtxRef.current.patientId     = user?.id ?? null;
  }, [language, token, user?.id]);

  // ── Conversation state ──────────────────────────────────────────────────
  const greetingText = ARROH_GREETING[language] ?? ARROH_GREETING['en-IN'];
  const [messages, setMessages] = useState<Message[]>([]);
  const displayedMessages: Message[] = messages.length
    ? messages
    : [{ role: 'ai', text: greetingText }];
  const [activeAction, setActiveAction] = useState<AgentAction>('NONE');
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [textInput, setTextInput]       = useState('');
  const [selectedSymptoms, setSelectedSymptoms] = useState<SelectedSymptom[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  }, []);

  // ── Apply agent response ─────────────────────────────────────────────────
  const applyResponse = useCallback((resp: AgentResponse, userText?: string) => {
    if (userText) {
      setMessages((m) => [...m, { role: 'user', text: userText }]);
    }
    setMessages((m) => [...m, { role: 'ai', text: resp.text, action: resp.action, data: resp.data }]);
    setActiveAction(resp.action ?? 'NONE');
    setAwaitingConfirm(resp.requiresConfirmation ?? false);
    voice.speak(resp.text);
    scrollToBottom();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice hook ───────────────────────────────────────────────────────────
  const handleTranscript = useCallback(async (text: string) => {
    setIsProcessing(true);
    try {
      const resp = await agentDispatch(text, agentCtxRef.current);
      applyResponse(resp, text);
      // Sync selected symptoms from agent context
      setSelectedSymptoms(agentCtxRef.current.symptoms.map((s) => ({
        symptom: s.symptom,
        source: s.source,
      })));
    } catch {
      const errMsg = isKn ? 'ತೊಂದರೆ ಆಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.' : 'Something went wrong. Please try again.';
      setMessages((m) => [...m, { role: 'ai', text: errMsg }]);
      voice.speak(errMsg);
    } finally {
      setIsProcessing(false);
    }
  }, [isKn, applyResponse]); // eslint-disable-line react-hooks/exhaustive-deps

  const voice = useArrohVoice({ language, onTranscript: handleTranscript });

  // Speak greeting on first user interaction
  const hasGreeted = useRef(false);
  const greetOnFirstTouch = useCallback(() => {
    voice.markInteracted();
    if (!hasGreeted.current) {
      hasGreeted.current = true;
      voice.speak(greetingText);
    }
  }, [voice, greetingText]);

  // ── Text input submit ────────────────────────────────────────────────────
  const submitText = useCallback(async () => {
    const trimmed = textInput.trim();
    if (!trimmed || isProcessing) return;
    setTextInput('');
    voice.markInteracted();
    setIsProcessing(true);
    try {
      const resp = await agentDispatch(trimmed, agentCtxRef.current);
      applyResponse(resp, trimmed);
      setSelectedSymptoms(agentCtxRef.current.symptoms.map((s) => ({
        symptom: s.symptom, source: s.source,
      })));
    } finally {
      setIsProcessing(false);
    }
  }, [textInput, isProcessing, applyResponse, voice]);

  const handleTextKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void submitText();
  };

  // ── Mic click ────────────────────────────────────────────────────────────
  const handleMic = useCallback(() => {
    greetOnFirstTouch();
    if (voice.state === 'SPEAKING') { voice.cancel(); setTimeout(() => voice.listen(), 200); }
    else if (voice.state === 'LISTENING') { voice.stopListening(); }
    else { voice.listen(); }
  }, [voice, greetOnFirstTouch]);

  // ── Symptom picker ───────────────────────────────────────────────────────
  const handleSymptomAdd = useCallback((s: SelectedSymptom) => {
    addTappedSymptoms(agentCtxRef.current, [s.symptom]);
    setSelectedSymptoms((prev) => [...prev, s]);
  }, []);

  const handleSymptomRemove = useCallback((symptom: string) => {
    agentCtxRef.current.symptoms = agentCtxRef.current.symptoms.filter((e) => e.symptom !== symptom);
    setSelectedSymptoms((prev) => prev.filter((s) => s.symptom !== symptom));
  }, []);

  const handleSymptomDone = useCallback(async () => {
    if (selectedSymptoms.length === 0) return;
    const list = selectedSymptoms.map((s) => s.symptom).join(', ');
    const trigger = isKn
      ? `ನನಗೆ ${list} ಇದೆ.`
      : isHi ? `मुझे ${list} है।` : `I have ${list}.`;
    setIsProcessing(true);
    try {
      const resp = await agentDispatch(trigger, agentCtxRef.current);
      applyResponse(resp, trigger);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedSymptoms, isKn, isHi, applyResponse]);

  // ── Confirmation buttons ─────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    setAwaitingConfirm(false);
    const resp = await confirmPending(agentCtxRef.current);
    if (resp) applyResponse(resp);
  }, [applyResponse]);

  const handleCancel = useCallback(() => {
    const resp = cancelPending(agentCtxRef.current, language);
    setAwaitingConfirm(false);
    setActiveAction('NONE');
    applyResponse(resp);
  }, [language, applyResponse]);

  const isListening  = voice.state === 'LISTENING';
  const isSpeaking   = voice.state === 'SPEAKING';

  // ── Quick greeting to fire TTS on page-level click ───────────────────────
  useEffect(() => {
    // Pre-warm voice engines so first speak() is fast
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  return (
    <div className="patient-home-root" onClick={greetOnFirstTouch}>

      {/* Offline banner */}
      {!online && (
        <div className="patient-offline-banner" role="status" aria-live="polite">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-sm leading-snug">{t('patient.home.offline')}</p>
        </div>
      )}

      {/* Header */}
      <header className="patient-home-header">
        <div>
          <p className="patient-home-greeting">
            {isKn ? 'ನಮಸ್ಕಾರ' : isHi ? 'नमस्ते' : 'Hello'}
            {firstName ? `, ${firstName}` : ''} 👋
          </p>
          <p className="patient-home-subtitle">MEDORA · Smarter Care. Healthier Futures.</p>
        </div>
        <button type="button" onClick={logout} className="patient-home-logout">
          {isKn ? 'ಹೊರಗೆ' : isHi ? 'बाहर' : 'Sign out'}
        </button>
      </header>

      {/* ── Avatar + conversation area ── */}
      <div className="ph-conv-area">
        {/* Avatar */}
        <div className="ph-avatar-wrap" aria-live="polite" aria-label="MEDORA assistant">
          <ArrohHumanAvatar state={voice.state} size="lg" className="ph-avatar" />
          <div className="ph-avatar-label">
            <span className="ph-avatar-name">MEDORA</span>
            <span className="ph-avatar-status">
              {isListening  ? (isKn ? 'ಕೇಳುತ್ತಿದ್ದೇನೆ…'   : 'Listening…')
             : isSpeaking   ? (isKn ? 'ಮಾತಾಡುತ್ತಿದ್ದೇನೆ…' : 'Speaking…')
             : isProcessing ? (isKn ? 'ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…' : 'Thinking…')
             :                (isKn ? 'ಸಿದ್ಧ'              : 'Ready')}
            </span>
          </div>
        </div>

        {voice.error && <p role="status" className="text-sm text-amber-800">{voice.error}</p>}

        {/* Transcript */}
        <div className="ph-transcript" role="log" aria-live="polite">
          {displayedMessages.slice(-6).map((msg, i) => (
            <div
              key={i}
              className={cn('ph-msg', msg.role === 'ai' ? 'ph-msg--ai' : 'ph-msg--user')}
            >
              <p className="text-sm leading-relaxed">{msg.text}</p>
            </div>
          ))}
          {isProcessing && (
            <div className="ph-msg ph-msg--ai">
              <span className="flex gap-1.5 py-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-2 w-2 rounded-full bg-brand-400 orb-neural-dot-inline"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                ))}
              </span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Confirmation gate ── */}
        {awaitingConfirm && (
          <div className="ph-confirm-row">
            <button type="button" onClick={handleConfirm} className="ph-confirm-yes">
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              {isKn ? 'ಹೌದು' : isHi ? 'हाँ' : 'Yes'}
            </button>
            <button type="button" onClick={handleCancel} className="ph-confirm-no">
              <XCircle className="h-4 w-4" aria-hidden="true" />
              {isKn ? 'ಬದಲಾಯಿಸಿ' : isHi ? 'बदलें' : 'Change'}
            </button>
          </div>
        )}

        {/* ── Symptom picker (shown when agent requests it) ── */}
        {(activeAction === 'SHOW_SYMPTOM_PICKER' || selectedSymptoms.length > 0) && !awaitingConfirm && (
          <SymptomPicker
            language={language}
            selected={selectedSymptoms}
            onAdd={handleSymptomAdd}
            onRemove={handleSymptomRemove}
            onDone={handleSymptomDone}
            disabled={isProcessing}
          />
        )}

        {/* ── Mic + text input row ── */}
        <div className="ph-input-row" onClick={(e) => e.stopPropagation()}>
          {/* Mic button */}
          <button
            type="button"
            onClick={handleMic}
            disabled={isProcessing}
            aria-label={isListening ? (isKn ? 'ನಿಲ್ಲಿಸಿ' : 'Stop') : (isKn ? 'ಮಾತನಾಡಿ' : 'Speak')}
            aria-pressed={isListening}
            className={cn(
              'ph-mic-btn',
              isListening && 'ph-mic-btn--active',
              isSpeaking  && 'ph-mic-btn--speaking',
            )}
          >
            {isListening
              ? <MicOff className="h-6 w-6" aria-hidden="true" />
              : <Mic    className="h-6 w-6" aria-hidden="true" />}
          </button>

          {/* Text input */}
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={handleTextKey}
            onClick={(e) => { e.stopPropagation(); greetOnFirstTouch(); }}
            placeholder={isKn ? 'ಇಲ್ಲಿ ಟೈಪ್ ಮಾಡಿ…' : isHi ? 'यहाँ टाइप करें…' : 'Type here…'}
            aria-label={isKn ? 'ಸಂದೇಶ ಟೈಪ್ ಮಾಡಿ' : 'Type a message'}
            className="ph-text-input"
            disabled={isProcessing}
          />

          {/* Send button */}
          <button
            type="button"
            onClick={submitText}
            disabled={!textInput.trim() || isProcessing}
            aria-label={isKn ? 'ಕಳಿಸಿ' : 'Send'}
            className="ph-send-btn"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── Secondary action tiles ── */}
      <div className="ph-grid" role="navigation" aria-label={isKn ? 'ಮುಖ್ಯ ಮೆನು' : 'Main menu'}>
        <Tile icon={Heart}        label={t('patient.home.health')}       color="rose"    onClick={() => {}} />
        <Tile icon={Calendar}     label={t('patient.home.appointments')} color="blue"    onClick={() => {}} />
        <Tile icon={FileText}     label={t('patient.home.reports')}      color="violet"  onClick={() => {}} />
        <Tile icon={ArrowUpRight} label={t('patient.home.referrals')}    color="amber"   onClick={() => {}} />
        <Tile icon={Pill}         label={t('patient.home.medicines')}    color="emerald" onClick={() => {
          void handleTranscript(isKn ? 'ಔಷಧಿ ತೋರಿಸಿ' : 'Show my medicines');
        }} />
        <Tile
          icon={Siren}
          label={t('patient.home.emergency')}
          sub={t('patient.home.emergency.sub')}
          color="red"
          onClick={() => navigate('/emergency')}
          wide
        />
      </div>

      <p className="ph-disclaimer">{t('medical.disclaimer')}</p>
    </div>
  );
}

// ── Action tile ───────────────────────────────────────────────────────────────

const TILE_COLORS: Record<string, string> = {
  rose:    'bg-rose-50   text-rose-600   border-rose-100',
  blue:    'bg-blue-50   text-blue-600   border-blue-100',
  violet:  'bg-violet-50 text-violet-600 border-violet-100',
  amber:   'bg-amber-50  text-amber-600  border-amber-100',
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  red:     'bg-red-50    text-red-600    border-red-200',
};

function Tile({
  icon: Icon, label, sub, color, onClick, wide,
}: {
  icon: React.ElementType;
  label: string;
  sub?: string;
  color: string;
  onClick: () => void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('ph-tile', TILE_COLORS[color], wide && 'ph-tile--wide')}
    >
      <span className={cn('ph-tile-icon', wide && 'ph-tile-icon--lg')}>
        <Icon className={wide ? 'h-6 w-6' : 'h-5 w-5'} aria-hidden="true" />
      </span>
      <span className="ph-tile-label">{label}</span>
      {sub && <span className="ph-tile-sub">{sub}</span>}
    </button>
  );
}
