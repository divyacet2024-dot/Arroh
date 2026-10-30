/**
 * PatientHome — MEDORA patient experience.
 *
 * Layout (mobile-first, single column):
 *   1. Sticky header: MEDORA brand + patient name + sign-out
 *   2. Offline / voice-unavailable banners (contextual, not permanent)
 *   3. Avatar hero: ArrohHumanAvatar + live state label + tap-to-greet
 *   4. Conversation transcript (last 6 messages, scrollable)
 *   5. Confirmation gate when agent requires it
 *   6. SymptomPicker when agent requests it
 *   7. Input row: mic + text + send (always at bottom, keyboard-aware)
 *   8. Quick-action grid for common tasks
 *   9. Medical disclaimer
 *
 * Voice single source of truth:
 *   - voice.speak(text) is called ONCE per agent response from applyResponse()
 *   - The SAME text is shown in the transcript — no dual strings
 *   - SPEAKING state on avatar driven by utt.onstart / utt.onend in useArrohVoice
 *   - Tap-to-hear replay button allows re-speaking the last response
 *
 * Duplicate-speak prevention:
 *   - applyResponse() calls voice.speak() exactly once
 *   - handleTranscript() and submitText() both go through applyResponse()
 *   - greetOnFirstTouch() sets hasGreeted guard so greeting fires once
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type KeyboardEvent,
} from 'react';
import {
  Heart,
  Calendar,
  FileText,
  ArrowUpRight,
  Pill,
  Siren,
  WifiOff,
  Mic,
  MicOff,
  Send,
  CheckCircle,
  XCircle,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useNavigate }         from 'react-router-dom';
import { useI18n }             from '../i18n';
import { usePatientAuth }      from '../lib/patientAuth';
import { useConnectivity }     from '../lib/offline/connectivity';
import { PatientLanguageSelect } from '../components/PatientLanguageSelect';
import { ArrohHumanAvatar }    from '../components/ArrohHumanAvatar';
import { SymptomPicker, type SelectedSymptom } from '../components/SymptomPicker';
import { useArrohVoice }       from '../lib/useArrohVoice';
import {
  dispatch      as agentDispatch,
  createContext as createAgentContext,
  addTappedSymptoms,
  confirmPending,
  cancelPending,
  type AgentContext,
  type AgentAction,
  type AgentResponse,
} from '../lib/patientAgent';
import { ARROH_GREETING }      from '../lib/languageConfig';
import { cn }                  from '../lib/cn';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: number;
  role: 'ai' | 'user';
  text: string;
  action?: AgentAction;
  data?: Record<string, unknown>;
}

let _msgId = 0;
const nextId = () => ++_msgId;

// ── Component ─────────────────────────────────────────────────────────────────

export function PatientHome() {
  const { t, language }             = useI18n();
  const { user, logout, token }     = usePatientAuth();
  const { online }                  = useConnectivity();
  const navigate                    = useNavigate();

  const isKn = language.startsWith('kn');
  const isHi = language.startsWith('hi');
  const firstName = user?.name?.trim().split(' ')[0] ?? null;

  // ── Agent context ─────────────────────────────────────────────────────────
  const agentCtxRef = useRef<AgentContext>(
    createAgentContext(user?.id ?? null, token, language),
  );
  useEffect(() => {
    agentCtxRef.current.language     = language;
    agentCtxRef.current.patientToken = token;
    agentCtxRef.current.patientId    = user?.id ?? null;
  }, [language, token, user?.id]);

  // ── Conversation state ────────────────────────────────────────────────────
  const greetingText = ARROH_GREETING[language] ?? ARROH_GREETING['en-IN'];
  const [messages, setMessages]           = useState<Message[]>([]);
  const [activeAction, setActiveAction]   = useState<AgentAction>('NONE');
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [isProcessing, setIsProcessing]   = useState(false);
  const [textInput, setTextInput]         = useState('');
  const [selectedSymptoms, setSelectedSymptoms] = useState<SelectedSymptom[]>([]);
  // Track last AI response text for the replay button
  const lastAiTextRef = useRef<string>(greetingText);

  const displayedMessages: Message[] = messages.length
    ? messages
    : [{ id: 0, role: 'ai', text: greetingText }];

  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  }, []);

  // ── Single applyResponse — ONLY place voice.speak() is called ────────────
  const applyResponse = useCallback(
    (resp: AgentResponse, userText?: string) => {
      if (userText) {
        setMessages((m) => [...m, { id: nextId(), role: 'user', text: userText }]);
      }
      setMessages((m) => [
        ...m,
        { id: nextId(), role: 'ai', text: resp.text, action: resp.action, data: resp.data },
      ]);
      setActiveAction(resp.action ?? 'NONE');
      setAwaitingConfirm(resp.requiresConfirmation ?? false);
      lastAiTextRef.current = resp.text;
      // Single call to voice.speak — same text as displayed
      voice.speak(resp.text);
      scrollToBottom();
    },
    // voice is stable across renders (same hook instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrollToBottom],
  );

  // ── Voice hook ────────────────────────────────────────────────────────────
  const handleTranscript = useCallback(
    async (text: string) => {
      setIsProcessing(true);
      try {
        const resp = await agentDispatch(text, agentCtxRef.current);
        applyResponse(resp, text);
        setSelectedSymptoms(
          agentCtxRef.current.symptoms.map((s) => ({ symptom: s.symptom, source: s.source })),
        );
      } catch {
        const errMsg = isKn
          ? 'ಕ್ಷಮಿಸಿ, ತೊಂದರೆ ಆಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.'
          : 'Something went wrong. Please try again.';
        setMessages((m) => [...m, { id: nextId(), role: 'ai', text: errMsg }]);
        voice.speak(errMsg);
      } finally {
        setIsProcessing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isKn, applyResponse],
  );

  const voice = useArrohVoice({ language, onTranscript: handleTranscript });

  // Greet once on first user gesture
  const hasGreeted = useRef(false);
  const greetOnFirstTouch = useCallback(() => {
    voice.markInteracted();
    if (!hasGreeted.current) {
      hasGreeted.current = true;
      // The greeting text is already shown statically when messages=[]
      // Only speak it — don't add it to messages again
      voice.speak(greetingText);
    }
  }, [voice, greetingText]);

  // Pre-warm voice engine
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  // ── Text submit ───────────────────────────────────────────────────────────
  const submitText = useCallback(async () => {
    const trimmed = textInput.trim();
    if (!trimmed || isProcessing) return;
    setTextInput('');
    voice.markInteracted();
    setIsProcessing(true);
    try {
      const resp = await agentDispatch(trimmed, agentCtxRef.current);
      applyResponse(resp, trimmed);
      setSelectedSymptoms(
        agentCtxRef.current.symptoms.map((s) => ({ symptom: s.symptom, source: s.source })),
      );
    } finally {
      setIsProcessing(false);
    }
  }, [textInput, isProcessing, applyResponse, voice]);

  const handleTextKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void submitText();
  };

  // ── Mic ───────────────────────────────────────────────────────────────────
  const handleMic = useCallback(() => {
    greetOnFirstTouch();
    if (voice.state === 'SPEAKING')  { voice.cancel(); setTimeout(() => voice.listen(), 150); }
    else if (voice.state === 'LISTENING') { voice.stopListening(); }
    else { voice.listen(); }
  }, [voice, greetOnFirstTouch]);

  // ── Symptom picker ────────────────────────────────────────────────────────
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
    const list    = selectedSymptoms.map((s) => s.symptom).join(', ');
    const trigger = isKn ? `ನನಗೆ ${list} ಇದೆ.` : isHi ? `मुझे ${list} है।` : `I have ${list}.`;
    setIsProcessing(true);
    try {
      const resp = await agentDispatch(trigger, agentCtxRef.current);
      applyResponse(resp, trigger);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedSymptoms, isKn, isHi, applyResponse]);

  // ── Confirmation ──────────────────────────────────────────────────────────
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

  // ── Replay last AI response ───────────────────────────────────────────────
  const handleReplay = useCallback(() => {
    voice.markInteracted();
    voice.cancel();
    setTimeout(() => voice.speak(lastAiTextRef.current), 80);
  }, [voice]);

  const isListening  = voice.state === 'LISTENING';
  const isSpeaking   = voice.state === 'SPEAKING';
  const isThinking   = voice.state === 'PROCESSING';

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="ph-root" onClick={greetOnFirstTouch}>

      {/* ── Sticky header ── */}
      <header className="ph-header">
        <div className="ph-header-brand">
          <span className="ph-brand-name">MEDORA</span>
          {firstName && (
            <span className="ph-brand-patient">
              {isKn ? `ನಮಸ್ಕಾರ, ${firstName}` : isHi ? `नमस्ते, ${firstName}` : `Hello, ${firstName}`}
            </span>
          )}
        </div>
        <div className="ph-header-actions">
          <PatientLanguageSelect />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); logout(); }}
            className="ph-signout-btn"
          >
            {isKn ? 'ಹೊರಗೆ' : isHi ? 'बाहर' : 'Sign out'}
          </button>
        </div>
      </header>

      {/* ── Contextual banners (only when relevant) ── */}
      {!online && (
        <div className="ph-banner ph-banner--offline" role="status" aria-live="polite">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-sm">{t('patient.home.offline')}</p>
        </div>
      )}
      {voice.ttsSupported && !voice.ttsVoiceAvailable && (
        <div className="ph-banner ph-banner--info" role="status">
          <VolumeX className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-sm">
            {voice.ttsVoiceRequiresNetwork
              ? 'The installed voice requires internet access. MEDORA is using text instead.'
              : isKn
              ? 'ಈ ಸಾಧನದಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಇಲ್ಲ. ಪ್ರತಿಕ್ರಿಯೆ ಪರದೆಯಲ್ಲಿ ಓದಬಹುದು.'
              : 'No voice available for this language. Responses are shown as text.'}
          </p>
        </div>
      )}
      {voice.error && (
        <div className="ph-banner ph-banner--warn" role="status" aria-live="polite">
          <p className="text-sm">{voice.error}</p>
        </div>
      )}

      {/* ── Avatar hero ── */}
      <div
        className="ph-avatar-hero"
        onClick={(e) => e.stopPropagation()}
      >
        <ArrohHumanAvatar state={voice.state} size="lg" className="ph-avatar" />

        {/* State label */}
        <p className="ph-avatar-label" aria-live="polite" aria-atomic="true">
          {isListening ? (isKn ? 'ಕೇಳುತ್ತಿದ್ದೇನೆ…'   : 'Listening…')
          : isSpeaking  ? (isKn ? 'ಮಾತಾಡುತ್ತಿದ್ದೇನೆ…' : 'Speaking…')
          : isThinking  ? (isKn ? 'ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…' : 'Thinking…')
          : '\u00A0'}
        </p>

        {/* Replay & stop controls */}
        <div className="ph-avatar-controls">
          {isSpeaking && (
            <button
              type="button"
              onClick={voice.cancel}
              className="ph-ctrl-btn ph-ctrl-btn--stop"
              aria-label={isKn ? 'ನಿಲ್ಲಿಸಿ' : 'Stop speaking'}
            >
              <VolumeX className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs">{isKn ? 'ನಿಲ್ಲಿಸಿ' : 'Stop'}</span>
            </button>
          )}
          {!isSpeaking && voice.ttsVoiceAvailable && lastAiTextRef.current && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleReplay(); }}
              className="ph-ctrl-btn ph-ctrl-btn--replay"
              aria-label={isKn ? 'ಮತ್ತೆ ಕೇಳಿ' : 'Replay last response'}
            >
              <Volume2 className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs">{isKn ? 'ಮತ್ತೆ ಕೇಳಿ' : 'Replay'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Conversation transcript ── */}
      <section
        className="ph-transcript-section"
        aria-label={isKn ? 'ಸಂಭಾಷಣೆ' : 'Conversation'}
      >
        <div
          className="ph-transcript"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {displayedMessages.slice(-6).map((msg) => (
            <div
              key={msg.id}
              className={cn('ph-msg', msg.role === 'ai' ? 'ph-msg--ai' : 'ph-msg--user')}
            >
              {msg.role === 'ai' && (
                <span className="ph-msg-role" aria-hidden="true">MEDORA</span>
              )}
              <p className="ph-msg-text">{msg.text}</p>
            </div>
          ))}

          {/* Thinking indicator */}
          {isProcessing && (
            <div className="ph-msg ph-msg--ai">
              <span className="ph-msg-role" aria-hidden="true">MEDORA</span>
              <span className="ph-thinking-dots" aria-label={isKn ? 'ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ' : 'Thinking'}>
                <span /><span /><span />
              </span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Confirmation gate ── */}
        {awaitingConfirm && (
          <div className="ph-confirm-gate" role="group" aria-label={isKn ? 'ದೃಢೀಕರಣ' : 'Confirm action'}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void handleConfirm(); }}
              className="ph-confirm-yes"
            >
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              {isKn ? 'ಹೌದು' : isHi ? 'हाँ' : 'Yes'}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleCancel(); }}
              className="ph-confirm-no"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              {isKn ? 'ಬದಲಾಯಿಸಿ' : isHi ? 'बदलें' : 'Change'}
            </button>
          </div>
        )}

        {/* ── Symptom picker ── */}
        {(activeAction === 'SHOW_SYMPTOM_PICKER' || selectedSymptoms.length > 0) &&
          !awaitingConfirm && (
            <SymptomPicker
              language={language}
              selected={selectedSymptoms}
              onAdd={handleSymptomAdd}
              onRemove={handleSymptomRemove}
              onDone={handleSymptomDone}
              disabled={isProcessing}
            />
          )}
      </section>

      {/* ── Input row (stays above keyboard) ── */}
      <div
        className="ph-input-bar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mic */}
        <button
          type="button"
          onClick={handleMic}
          disabled={isProcessing || !voice.sttSupported}
          aria-label={
            !voice.sttSupported
              ? (isKn ? 'ಧ್ವನಿ ಬೆಂಬಲ ಇಲ್ಲ' : 'Voice not supported')
              : isListening
              ? (isKn ? 'ನಿಲ್ಲಿಸಿ' : 'Stop listening')
              : (isKn ? 'ಮಾತನಾಡಿ' : 'Speak')
          }
          aria-pressed={isListening}
          title={!voice.sttSupported ? (isKn ? 'ಧ್ವನಿ ಬೆಂಬಲ ಇಲ್ಲ — ಟೈಪ್ ಮಾಡಿ' : 'Voice not supported — please type') : undefined}
          className={cn(
            'ph-mic-btn',
            isListening  && 'ph-mic-btn--active',
            isSpeaking   && 'ph-mic-btn--speaking',
            !voice.sttSupported && 'ph-mic-btn--disabled',
          )}
        >
          {isListening
            ? <MicOff className="h-5 w-5" aria-hidden="true" />
            : <Mic    className="h-5 w-5" aria-hidden="true" />}
        </button>

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={handleTextKey}
          onFocus={() => { voice.markInteracted(); greetOnFirstTouch(); }}
          placeholder={
            isKn ? 'ಇಲ್ಲಿ ಟೈಪ್ ಮಾಡಿ…'
            : isHi ? 'यहाँ टाइप करें…'
            : 'Type here…'
          }
          aria-label={isKn ? 'ಸಂದೇಶ ಟೈಪ್ ಮಾಡಿ' : 'Type a message'}
          className="ph-text-input"
          disabled={isProcessing}
          autoComplete="off"
        />

        {/* Send */}
        <button
          type="button"
          onClick={() => void submitText()}
          disabled={!textInput.trim() || isProcessing}
          aria-label={isKn ? 'ಕಳಿಸಿ' : 'Send'}
          className="ph-send-btn"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* ── Quick-action grid ── */}
      <nav
        className="ph-quick-grid"
        aria-label={isKn ? 'ತ್ವರಿತ ಕ್ರಿಯೆಗಳು' : 'Quick actions'}
      >
        <QuickTile
          icon={Heart}
          label={t('patient.home.health')}
          color="rose"
          onClick={() => {}}
        />
        <QuickTile
          icon={Calendar}
          label={t('patient.home.appointments')}
          color="blue"
          onClick={() => {}}
        />
        <QuickTile
          icon={FileText}
          label={t('patient.home.reports')}
          color="violet"
          onClick={() => {}}
        />
        <QuickTile
          icon={ArrowUpRight}
          label={t('patient.home.referrals')}
          color="amber"
          onClick={() => {}}
        />
        <QuickTile
          icon={Pill}
          label={t('patient.home.medicines')}
          color="emerald"
          onClick={() => {
            void handleTranscript(isKn ? 'ಔಷಧಿ ತೋರಿಸಿ' : 'Show my medicines');
          }}
        />
        <QuickTile
          icon={Siren}
          label={t('patient.home.emergency')}
          sublabel={t('patient.home.emergency.sub')}
          color="red"
          onClick={() => navigate('/emergency')}
          wide
        />
      </nav>

      <p className="ph-disclaimer">{t('medical.disclaimer')}</p>
    </div>
  );
}

// ── QuickTile ─────────────────────────────────────────────────────────────────

const TILE_COLORS: Record<string, string> = {
  rose:    'ph-tile--rose',
  blue:    'ph-tile--blue',
  violet:  'ph-tile--violet',
  amber:   'ph-tile--amber',
  emerald: 'ph-tile--emerald',
  red:     'ph-tile--red',
};

function QuickTile({
  icon: Icon,
  label,
  sublabel,
  color,
  onClick,
  wide,
}: {
  icon: React.ElementType;
  label: string;
  sublabel?: string;
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
        <Icon className={wide ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" />
      </span>
      <span className="ph-tile-label">{label}</span>
      {sublabel && <span className="ph-tile-sublabel">{sublabel}</span>}
    </button>
  );
}
