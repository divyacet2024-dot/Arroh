/**
 * useArrohVoice — single source of truth for MEDORA voice I/O.
 *
 * Key fixes in this version:
 *   1. pickVoice() uses voiceNameHints from languageConfig for better matching.
 *   2. doSpeak() queues the text if voices haven't loaded yet (voiceschanged).
 *   3. Exposes ttsVoiceAvailable (bool) and ttsVoiceName (string) so components
 *      can show an honest "Kannada voice not available" message instead of
 *      silently failing or faking speech.
 *   4. Never fakes SPEAKING state: only set from SpeechSynthesisUtterance.onstart.
 *   5. interactedRef ensures markInteracted() flushes pendingSpeakRef synchronously.
 *   6. Duplicate recognition sessions prevented by ref guard.
 *   7. All errors are human-readable, never raw API error strings.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNativeOfflineTTSService } from './offline/nativeOfflineTts';
import type { AvatarState } from '../components/AIAvatar';
import { getLanguageConfig, prepareSpeechText } from './languageConfig';

// ── Browser API types (cross-browser) ────────────────────────────────────────

interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface RecognitionResult extends ArrayLike<RecognitionAlternative> {}
interface RecognitionEvent {
  results: ArrayLike<RecognitionResult>;
}
interface RecognitionErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
const ttsAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;

// ── Voice selection using voiceNameHints ──────────────────────────────────────
//
// Strategy (each step falls back to the next):
//   1. Exact lang match ("kn-IN" === voice.lang normalised)
//   2. Language prefix match ("kn" === voice.lang prefix)
//   3. Any voiceNameHint appears in voice.name (case-insensitive)
//   4. null — no suitable voice found
//
// IMPORTANT: never returns a voice for a different language family.
// If no match is found, we return null and doSpeak() surfaces an honest error.

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (!ttsAvailable) return null;
  const config = getLanguageConfig(lang);
  if (!config) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const normalise = (s: string) => s.replace('_', '-').toLowerCase();
  const configCode  = normalise(config.code);
  const configPfx   = configCode.split('-')[0];

  // 1. Exact lang match
  const exact = voices.find((v) => normalise(v.lang) === configCode);
  if (exact) return exact;

  // 2. Lang prefix match (e.g. voice.lang = "kn" matches config "kn-IN")
  const prefix = voices.find((v) => normalise(v.lang).split('-')[0] === configPfx);
  if (prefix) return prefix;

  // 3. Name hint substring match
  for (const hint of config.voiceNameHints) {
    const byName = voices.find((v) => v.name.toLowerCase().includes(hint.toLowerCase()));
    if (byName) return byName;
  }

  return null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseArrohVoiceOptions {
  language?: string;
  onTranscript?: (text: string) => void;
}

export interface ArrohVoiceHandle {
  /** Current avatar/voice state */
  state: AvatarState;
  /** Last successfully recognised transcript */
  transcript: string;
  /** True if the browser supports SpeechSynthesis */
  ttsSupported: boolean;
  /** True if the browser supports SpeechRecognition */
  sttSupported: boolean;
  /**
   * True if a TTS voice for the current language was found.
   * IMPORTANT: this can change after voiceschanged fires.
   */
  ttsVoiceAvailable: boolean;
  /** Human-readable name of the selected TTS voice, or null */
  ttsVoiceName: string | null;
  /** True when a matching native voice exists but requires network access. */
  ttsVoiceRequiresNetwork: boolean;
  speak: (text: string) => void;
  listen: () => void;
  stopListening: () => void;
  cancel: () => void;
  /** True once the user has gestured — required by browser autoplay policy */
  interacted: boolean;
  /** Human-readable error string, or null */
  error: string | null;
  markInteracted: () => void;
}

export function useArrohVoice({
  language = 'kn-IN',
  onTranscript,
}: UseArrohVoiceOptions = {}): ArrohVoiceHandle {
  const [state, setState]                   = useState<AvatarState>('IDLE');
  const [transcript, setTranscript]         = useState('');
  const [error, setError]                   = useState<string | null>(null);
  const [ttsVoiceAvailable, setTtsVoiceAvailable] = useState(false);
  const [ttsVoiceName, setTtsVoiceName]     = useState<string | null>(null);
  const [ttsVoiceRequiresNetwork, setTtsVoiceRequiresNetwork] = useState(false);
  const nativeTts = useMemo(() => createNativeOfflineTTSService(), []);
  const usesAndroidTts = nativeTts.available;

  // Refs so callbacks always read the current values without stale closures
  const interactedRef   = useRef(false);
  const [interacted, setInteracted] = useState(false);
  const recognitionRef  = useRef<SpeechRecognitionLike | null>(null);
  const utteranceRef    = useRef<SpeechSynthesisUtterance | null>(null);
  // Pending text queued before voices loaded or before first interaction
  const pendingSpeakRef = useRef<string | null>(null);
  // Whether the voices list has been populated
  const voicesReadyRef  = useRef(false);
  const langRef         = useRef(language);
  const previousLanguageRef = useRef(language);
  const speechOperationRef = useRef(0);
  const capabilityRequestRef = useRef(0);

  useEffect(() => {
    langRef.current = language;
    if (previousLanguageRef.current !== language) {
      previousLanguageRef.current = language;
      speechOperationRef.current += 1;
      pendingSpeakRef.current = null;

      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // A language change still resets the UI if the browser already ended capture.
        }
      }

      utteranceRef.current = null;
      if (usesAndroidTts) {
        void nativeTts.stop().catch(() => {
          setError('Speech could not be stopped after the language changed.');
        });
      } else if (ttsAvailable) {
        window.speechSynthesis.cancel();
      }
      setState('IDLE');
      setError(null);
    }

    if (usesAndroidTts) {
      const requestId = ++capabilityRequestRef.current;
      const config = getLanguageConfig(language);
      setTtsVoiceAvailable(false);
      setTtsVoiceName(null);
      setTtsVoiceRequiresNetwork(false);
      if (!config) {
        setError('This language is not configured for speech.');
        return;
      }
      void nativeTts.checkLanguage(config.ttsLocale).then((capability) => {
        if (requestId !== capabilityRequestRef.current) return;
        setTtsVoiceAvailable(capability.available);
        setTtsVoiceName(capability.voiceName);
        setTtsVoiceRequiresNetwork(capability.requiresNetworkConnection);
        setError(capability.requiresNetworkConnection
          ? `The installed ${capability.label} voice requires a network connection. MEDORA uses only offline Android voices.`
          : null);
      }).catch(() => {
        if (requestId !== capabilityRequestRef.current) return;
        setTtsVoiceAvailable(false);
        setTtsVoiceName(null);
        setError('Android text-to-speech is unavailable. Check the installed speech engine and try again.');
      });
    } else if (voicesReadyRef.current) {
      const v = pickVoice(language);
      setTtsVoiceAvailable(v !== null);
      setTtsVoiceName(v?.name ?? null);
      setTtsVoiceRequiresNetwork(false);
    }
  }, [language, nativeTts, usesAndroidTts]);

  // ── voiceschanged: populate voice list asynchronously ────────────────────
  useEffect(() => {
    if (usesAndroidTts || !ttsAvailable) return;

    const onVoicesChanged = () => {
      voicesReadyRef.current = true;
      const v = pickVoice(langRef.current);
      setTtsVoiceAvailable(v !== null);
      setTtsVoiceName(v?.name ?? null);
      // Flush pending speak if the user has already interacted
      if (pendingSpeakRef.current !== null && interactedRef.current) {
        const text = pendingSpeakRef.current;
        pendingSpeakRef.current = null;
        doSpeak(text);
      }
    };

    // Some browsers (Chrome desktop) populate voices synchronously
    const initialVoices = window.speechSynthesis.getVoices();
    if (initialVoices.length > 0) {
      voicesReadyRef.current = true;
      const v = pickVoice(langRef.current);
      setTtsVoiceAvailable(v !== null);
      setTtsVoiceName(v?.name ?? null);
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    }

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
    };
  // doSpeak is stable (defined below with useCallback + no deps that change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usesAndroidTts]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror  = null;
        recognitionRef.current.onend    = null;
        recognitionRef.current.abort();
      }
      speechOperationRef.current += 1;
      if (usesAndroidTts) {
        void nativeTts.stop().catch(() => undefined);
      } else if (ttsAvailable) {
        window.speechSynthesis.cancel();
      }
      utteranceRef.current = null;
    };
  }, [nativeTts, usesAndroidTts]);

  // ── doSpeak: internal — performs the actual TTS ───────────────────────────
  const doSpeak = useCallback((text: string) => {
    if (!text.trim()) return;
    if (!usesAndroidTts && !ttsAvailable) {
      setError(
        'Speech playback is not available in this browser. ' +
        'You can read the response on screen.',
      );
      setState((s) => (s === 'SPEAKING' ? 'IDLE' : s));
      return;
    }

    const config = getLanguageConfig(langRef.current);
    if (!config) {
      setError('This language is not configured. Please select a supported language.');
      return;
    }

    if (usesAndroidTts) {
      const operationId = ++speechOperationRef.current;
      utteranceRef.current = null;
      setError(null);
      void (async () => {
        try {
          await nativeTts.stop();
          if (operationId !== speechOperationRef.current) return;

          const capability = await nativeTts.checkLanguage(config.ttsLocale);
          if (operationId !== speechOperationRef.current) return;
          setTtsVoiceAvailable(capability.available);
          setTtsVoiceName(capability.voiceName);
          setTtsVoiceRequiresNetwork(capability.requiresNetworkConnection);
          if (!capability.available) {
            setError(capability.requiresNetworkConnection
              ? `The installed ${capability.label} voice requires a network connection. MEDORA uses only offline Android voices.`
              : `No offline ${capability.label} voice is installed. Install one in Android text-to-speech settings, or read the response on screen.`);
            return;
          }

          await nativeTts.speak(prepareSpeechText(text, langRef.current), {
            language: config.ttsLocale,
            rate: config.ttsRate,
            onStart: () => {
              if (operationId !== speechOperationRef.current) return;
              setState('SPEAKING');
              setError(null);
            },
          });
          if (operationId === speechOperationRef.current) setState('IDLE');
        } catch (cause) {
          if (operationId !== speechOperationRef.current) return;
          const code = (cause as { code?: string }).code;
          if (code === 'cancelled') {
            setState('IDLE');
            return;
          }
          setState('IDLE');
          setError(code === 'voice_unavailable' || code === 'network_required'
            ? cause instanceof Error ? cause.message : 'A compatible offline voice is not available for the selected language.'
            : 'Android speech playback failed. The response remains available as text; try again.');
        }
      })();
      return;
    }

    // If voices haven't loaded yet, queue and wait for voiceschanged
    if (!voicesReadyRef.current) {
      pendingSpeakRef.current = text;
      return;
    }

    const voice = pickVoice(langRef.current);
    if (!voice) {
      // Be honest: no voice for this language.
      const lang = config.displayName;
      setError(
        `${lang} voice is not available on this device. ` +
        `The text above is still shown. ` +
        `To hear MEDORA speak, switch to a language with a voice installed, ` +
        `or install a ${lang} TTS voice in your device settings.`,
      );
      setTtsVoiceAvailable(false);
      // Don't set ERROR state on the avatar — the conversation continues
      // and the text is visible.
      return;
    }

    // Cancel any in-progress speech before starting new utterance
    window.speechSynthesis.cancel();
    utteranceRef.current = null;

    const utt = new SpeechSynthesisUtterance(prepareSpeechText(text, langRef.current));
    utt.lang  = config.ttsLocale;
    utt.voice = voice;
    utt.rate  = config.ttsRate;
    utt.pitch = 1.0;

    utt.onstart = () => {
      if (utteranceRef.current === utt) {
        setState('SPEAKING');
        setError(null);
      }
    };
    utt.onend = () => {
      if (utteranceRef.current !== utt) return;
      setState('IDLE');
      utteranceRef.current = null;
    };
    utt.onerror = (e) => {
      if (utteranceRef.current !== utt) return;
      if (e.error === 'interrupted' || e.error === 'canceled') {
        // Normal cancellation — not an error
        setState('IDLE');
      } else {
        setError(
          'Speech playback stopped unexpectedly. ' +
          'The response text is still visible above.',
        );
        setState('IDLE');
      }
      utteranceRef.current = null;
    };

    utteranceRef.current = utt;
    setError(null);
    window.speechSynthesis.speak(utt);
    // Note: we do NOT set state='SPEAKING' here.
    // It is set only from utt.onstart so it tracks real playback.
  }, [nativeTts, usesAndroidTts]); // stable — reads current language from refs

  // ── speak: public ─────────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    if (!text.trim()) return;
    // Block speech until the user has gestured (browser autoplay policy).
    // Use the ref so we read the synchronously-updated value from markInteracted().
    if (!interactedRef.current) {
      pendingSpeakRef.current = text;
      return;
    }
    // If voices aren't ready yet, queue and let voiceschanged flush it.
    if (!usesAndroidTts && !voicesReadyRef.current) {
      pendingSpeakRef.current = text;
      return;
    }
    doSpeak(text);
  }, [doSpeak, usesAndroidTts]);

  // ── listen: public ────────────────────────────────────────────────────────
  const listen = useCallback(() => {
    const config = getLanguageConfig(langRef.current);
    if (!config) {
      setError('This language is not configured. Please select a supported language.');
      setState('ERROR');
      return;
    }
    if (!SpeechRecognitionCtor) {
      setError(
        'Speech recognition is not available in this browser. ' +
        'You can type your message instead.',
      );
      setState('ERROR');
      return;
    }
    // Prevent duplicate recognition sessions
    if (recognitionRef.current) return;

    // Cancel TTS so speech and listening don't overlap
    if (usesAndroidTts) {
      speechOperationRef.current += 1;
      void nativeTts.stop().catch(() => {
        setError('Speech could not be stopped. Try again.');
      });
    } else if (ttsAvailable) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current   = null;
    pendingSpeakRef.current = null;

    const rec           = new SpeechRecognitionCtor();
    rec.lang            = config.speechRecognitionLocale;
    rec.continuous      = false;
    rec.interimResults  = false;
    rec.maxAlternatives = 3;

    rec.onstart = () => {
      if (recognitionRef.current === rec) setState('LISTENING');
    };
    rec.onspeechend = () => {
      if (recognitionRef.current === rec) setState('PROCESSING');
    };
    rec.onresult = (event: RecognitionEvent) => {
      const alts = event.results[0];
      if (!alts?.length) return;
      // Pick the alternative with highest confidence
      const best = Array.from(alts).reduce((a, b) =>
        a.confidence >= b.confidence ? a : b,
      );
      const text = best.transcript.trim();
      if (text) {
        setTranscript(text);
        onTranscript?.(text);
        setError(null);
      } else {
        setError('No speech was detected. Please try again or type your message.');
      }
      setState('IDLE');
    };
    rec.onerror = (event: RecognitionErrorEvent) => {
      if (recognitionRef.current !== rec) return;
      if (event.error === 'aborted') {
        setState('IDLE');
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError(
          'Microphone permission was denied. ' +
          'Please allow microphone access in your browser settings ' +
          'and try again, or type your message below.',
        );
      } else if (event.error === 'no-speech') {
        setError('No speech was detected. Please try again or type your message.');
      } else {
        setError(
          'Speech recognition stopped. Check your microphone and try again.',
        );
      }
      setState('ERROR');
    };
    rec.onend = () => {
      if (recognitionRef.current !== rec) return;
      recognitionRef.current = null;
      setState((s) => (s === 'PROCESSING' || s === 'LISTENING' ? 'IDLE' : s));
    };

    recognitionRef.current = rec;
    try {
      setError(null);
      rec.start();
    } catch {
      recognitionRef.current = null;
      setError(
        'The microphone could not be started. ' +
        'Check browser permission and try again, or type your message.',
      );
      setState('ERROR');
    }
  }, [nativeTts, onTranscript, usesAndroidTts]);

  // ── stopListening: public ─────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Ignore — onend will still fire and clean up
    }
  }, []);

  // ── cancel: public — stops both TTS and STT ───────────────────────────────
  const cancel = useCallback(() => {
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    recognitionRef.current  = null;
    speechOperationRef.current += 1;
    if (usesAndroidTts) {
      void nativeTts.stop().catch(() => {
        setError('Speech could not be stopped. Try again.');
      });
    } else if (ttsAvailable) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current    = null;
    pendingSpeakRef.current = null;
    setError(null);
    setState('IDLE');
  }, [nativeTts, usesAndroidTts]);

  // ── markInteracted: public — call on first user gesture ───────────────────
  const markInteracted = useCallback(() => {
    if (interactedRef.current) return;
    // Set both ref (synchronous) and state (triggers re-render)
    interactedRef.current = true;
    setInteracted(true);
    // Flush pending speak if voices are ready
    if (pendingSpeakRef.current !== null) {
      const text = pendingSpeakRef.current;
      pendingSpeakRef.current = null;
      if (usesAndroidTts || voicesReadyRef.current) {
        doSpeak(text);
      }
      // If voices aren't ready, voiceschanged will flush it
    }
  }, [doSpeak, usesAndroidTts]);

  return {
    state,
    transcript,
    ttsSupported: usesAndroidTts || ttsAvailable,
    sttSupported: SpeechRecognitionCtor !== null,
    ttsVoiceAvailable,
    ttsVoiceName,
    ttsVoiceRequiresNetwork,
    speak,
    listen,
    stopListening,
    cancel,
    interacted,
    error,
    markInteracted,
  };
}
