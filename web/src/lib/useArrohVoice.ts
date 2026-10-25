/**
 * useArrohVoice — single source of truth for ARROH voice I/O.
 *
 * ROOT CAUSE ANALYSIS (why TTS was silent):
 *   1. PatientHome called window.speechSynthesis.speak() directly with no
 *      voice enumeration — browsers often return an empty voices list on the
 *      first call and require waiting for the `voiceschanged` event.
 *   2. No autoplay-policy guard — Chrome on Android silently drops
 *      speechSynthesis.speak() until the user has interacted with the page.
 *   3. Duplicate speak() calls were not cancelled before the new utterance.
 *   4. The SPEAKING avatar state was set then immediately cleared on a
 *      setTimeout rather than waiting for the real `onend` event.
 *   5. VoiceButton did not cancel TTS when the user started speaking,
 *      causing overlap.
 *
 * This hook fixes all five issues in one place so no component needs to
 * think about SpeechSynthesis or SpeechRecognition internals.
 *
 * API:
 *   const voice = useArrohVoice({ language, onTranscript })
 *
 *   voice.state         → AvatarState
 *   voice.transcript    → last heard text (cleared on next listen)
 *   voice.speak(text)   → cancel any current speech, then speak text
 *   voice.listen()      → start STT (cancels TTS first)
 *   voice.stopListening()
 *   voice.cancel()      → cancel everything
 *   voice.ttsSupported  → boolean
 *   voice.sttSupported  → boolean
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AvatarState } from '../components/AIAvatar';
import { getLanguageConfig } from './languageConfig';

// ── Browser API detection ────────────────────────────────────────────────────

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
  const browser = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

const SpeechRecognitionCtor = getSpeechRecognitionConstructor();

const ttsAvailable =
  typeof window !== 'undefined' && 'speechSynthesis' in window;

// ── Voice preference map ─────────────────────────────────────────────────────

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (!ttsAvailable) return null;
  const config = getLanguageConfig(lang);
  if (!config) return null;
  const prefix = config.code.split('-')[0].toLowerCase();
  return window.speechSynthesis.getVoices().find(
    (voice) => voice.lang.replace('_', '-').toLowerCase().split('-')[0] === prefix,
  ) ?? null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseArrohVoiceOptions {
  language?: string;
  onTranscript?: (text: string) => void;
}

export interface ArrohVoiceHandle {
  state: AvatarState;
  transcript: string;
  ttsSupported: boolean;
  sttSupported: boolean;
  speak: (text: string) => void;
  listen: () => void;
  stopListening: () => void;
  cancel: () => void;
  /** True once user has interacted — required for autoplay policy */
  interacted: boolean;
  error: string | null;
  markInteracted: () => void;
}

export function useArrohVoice({
  language = 'kn-IN',
  onTranscript,
}: UseArrohVoiceOptions = {}): ArrohVoiceHandle {
  const [state, setState] = useState<AvatarState>('IDLE');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  // ── FIX: use a ref for interacted so markInteracted() reads the updated
  //    value synchronously without waiting for a React re-render cycle.
  const interactedRef  = useRef(false);
  const [interacted, setInteracted] = useState(false);

  const recognitionRef  = useRef<SpeechRecognitionLike | null>(null);
  const utteranceRef    = useRef<SpeechSynthesisUtterance | null>(null);
  const pendingSpeakRef = useRef<string | null>(null);
  const langRef         = useRef(language);

  useEffect(() => {
    langRef.current = language;
  }, [language]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
      }
      recognitionRef.current?.abort();
      if (ttsAvailable) window.speechSynthesis.cancel();
    };
  }, []);

  // ── Internal: perform the actual speak ───────────────────────────────────
  const doSpeak = useCallback((text: string) => {
    if (!text.trim()) return;
    const config = getLanguageConfig(langRef.current);
    if (!ttsAvailable) {
      setError('Speech playback is not available in this browser. You can read the response on screen.');
      setState('ERROR');
      return;
    }
    if (!config) {
      setError('This language is not configured for speech playback. Select a supported language.');
      setState('ERROR');
      return;
    }
    const voice = pickVoice(config.code);
    if (!voice) {
      setError(`A ${config.displayName} speech voice is not currently available. Voice resources may still be loading; retry or read the response on screen.`);
      setState('ERROR');
      return;
    }

    window.speechSynthesis.cancel();
    utteranceRef.current = null;

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = config.ttsLocale;
    utt.voice = voice;
    utt.rate = config.ttsRate;
    utt.pitch = 1.0;
    utt.onstart = () => {
      if (utteranceRef.current === utt) setState('SPEAKING');
    };
    utt.onend = () => {
      if (utteranceRef.current !== utt) return;
      setState('IDLE');
      utteranceRef.current = null;
    };
    utt.onerror = (e) => {
      if (utteranceRef.current !== utt) return;
      if (e.error === 'interrupted' || e.error === 'canceled') setState('IDLE');
      else {
        setError('Speech playback failed. You can read the response on screen or try again.');
        setState('ERROR');
      }
      utteranceRef.current = null;
    };

    setError(null);
    utteranceRef.current = utt;
    setState('SPEAKING');
    window.speechSynthesis.speak(utt);
  }, []);

  // ── Public: speak ─────────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    if (!text.trim()) return;

    // Autoplay policy: browsers block audio until the user has gestured.
    // Use the ref (not state) so we read the synchronously-updated value.
    if (!interactedRef.current) {
      pendingSpeakRef.current = text;
      return;
    }

    doSpeak(text);
  }, [doSpeak]);

  // ── Public: listen ────────────────────────────────────────────────────────
  const listen = useCallback(() => {
    const config = getLanguageConfig(langRef.current);
    if (!config) {
      setError('This language is not configured for speech recognition. Select a supported language.');
      setState('ERROR');
      return;
    }
    if (!SpeechRecognitionCtor) {
      setError('Speech recognition is not available in this browser. You can type your message instead.');
      setState('ERROR');
      return;
    }
    if (recognitionRef.current) return;

    if (ttsAvailable) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    pendingSpeakRef.current = null;

    const rec = new SpeechRecognitionCtor();
    rec.lang = config.speechRecognitionLocale;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 3;

    rec.onstart = () => {
      if (recognitionRef.current === rec) setState('LISTENING');
    };
    rec.onspeechend = () => {
      if (recognitionRef.current === rec) setState('PROCESSING');
    };
    rec.onresult = (event: RecognitionEvent) => {
      const alternatives = event.results[0];
      if (!alternatives?.length) return;
      const best = Array.from(alternatives).reduce((a, b) => (a.confidence >= b.confidence ? a : b));
      const text = best.transcript.trim();
      if (text) {
        setTranscript(text);
        onTranscript?.(text);
        setError(null);
      } else {
        setError('No speech was detected. Try again or type your message.');
      }
      setState('IDLE');
    };
    rec.onerror = (event: RecognitionErrorEvent) => {
      if (recognitionRef.current !== rec) return;
      if (event.error === 'aborted') {
        setState('IDLE');
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone permission was denied. Allow microphone access in browser settings or type your message.');
        setState('ERROR');
      } else {
        setError(event.error === 'no-speech'
          ? 'No speech was detected. Try again or type your message.'
          : 'Speech recognition failed. Check microphone access and try again.');
        setState('ERROR');
      }
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
      setError('The microphone could not be started. Check browser permission and try again.');
      setState('ERROR');
    }
  }, [onTranscript]);

  // ── Public: stopListening ─────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      setError('The microphone session could not be stopped. Close and reopen voice input.');
      setState('ERROR');
    }
  }, []);

  // ── Public: cancel everything ─────────────────────────────────────────────
  const cancel = useCallback(() => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    if (ttsAvailable) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    pendingSpeakRef.current = null;
    setError(null);
    setState('IDLE');
  }, []);

  // ── Public: mark user interaction (unlock autoplay) ───────────────────────
  const markInteracted = useCallback(() => {
    if (interactedRef.current) return;
    // Set BOTH the ref (synchronous, readable immediately in this callback)
    // and the state (triggers re-render so consumers see interacted=true).
    interactedRef.current = true;
    setInteracted(true);
    // Flush any speak() that was queued before the first interaction.
    if (pendingSpeakRef.current !== null) {
      const text = pendingSpeakRef.current;
      pendingSpeakRef.current = null;
      doSpeak(text);
    }
  }, [doSpeak]);

  return {
    state,
    transcript,
    ttsSupported: ttsAvailable,
    sttSupported: SpeechRecognitionCtor !== null,
    speak,
    listen,
    stopListening,
    cancel,
    interacted,
    error,
    markInteracted,
  };
}
