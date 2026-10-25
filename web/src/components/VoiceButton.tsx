/**
 * VoiceButton — large, accessible microphone button.
 *
 * Uses the Web Speech API (SpeechRecognition) where available.
 * Degrades gracefully: when the API is not supported the button is still
 * rendered but shows a tooltip and opens the fallback text input.
 *
 * Props:
 *   onTranscript   — called with the recognised text
 *   language       — BCP-47 language code (e.g. "kn-IN")
 *   disabled       — prevents starting a new session
 *   size           — visual size variant
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';
import { getLanguageConfig } from '../lib/languageConfig';

export interface VoiceButtonProps {
  onTranscript: (text: string) => void;
  language?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Label shown below the button */
  label?: string;
}

type RecordState = 'idle' | 'listening' | 'processing' | 'error' | 'unsupported';

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionConstructor = new () => RecognitionLike;

function getRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

const SpeechRecognitionAPI = getRecognitionConstructor();

const SIZE_CLASSES = {
  sm: { btn: 'h-12 w-12', icon: 'h-5 w-5' },
  md: { btn: 'h-16 w-16', icon: 'h-7 w-7' },
  lg: { btn: 'h-20 w-20', icon: 'h-9 w-9' },
};

export function VoiceButton({
  onTranscript,
  language = 'kn-IN',
  disabled = false,
  size = 'lg',
  className,
  label,
}: VoiceButtonProps) {
  const [recState, setRecState] = useState<RecordState>(
    SpeechRecognitionAPI ? 'idle' : 'unsupported',
  );
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const s = SIZE_CLASSES[size];

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      setError('The microphone session could not be stopped. Close and reopen voice input.');
      setRecState('error');
    }
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognitionAPI || disabled || recognitionRef.current) return;
    const config = getLanguageConfig(language);
    if (!config) {
      setError('This language is not configured for speech recognition. Select a supported language.');
      setRecState('error');
      return;
    }
    const rec = new SpeechRecognitionAPI();
    rec.lang = config.speechRecognitionLocale;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      if (recognitionRef.current === rec) setRecState('listening');
    };
    rec.onspeechend = () => {
      if (recognitionRef.current === rec) setRecState('processing');
    };
    rec.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? '';
      if (text.trim()) {
        onTranscript(text.trim());
        setError(null);
      } else setError('No speech was detected. Try again or type your message.');
      setRecState('idle');
    };
    rec.onerror = (event) => {
      if (recognitionRef.current !== rec) return;
      setError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone permission was denied. Allow access in browser settings or type your message.'
        : event.error === 'no-speech'
          ? 'No speech was detected. Try again or type your message.'
          : 'Speech recognition failed. Check microphone access and try again.');
      setRecState('error');
    };
    rec.onend = () => {
      if (recognitionRef.current !== rec) return;
      recognitionRef.current = null;
      setRecState((current) => current === 'error' ? current : 'idle');
    };

    recognitionRef.current = rec;
    try {
      setError(null);
      rec.start();
    } catch {
      recognitionRef.current = null;
      setError('The microphone could not be started. Check browser permission and try again.');
      setRecState('error');
    }
  }, [disabled, language, onTranscript]);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      recognitionRef.current.abort();
    }
  }, []);

  const isListening   = recState === 'listening';
  const isProcessing  = recState === 'processing';
  const isUnsupported = recState === 'unsupported';
  const isError       = recState === 'error';

  const handleClick = () => {
    if (isListening || isProcessing) { stop(); return; }
    if (isError) { setRecState('idle'); return; }
    start();
  };

  const btnColor =
    isListening  ? 'bg-brand-600 hover:bg-brand-700 shadow-brand-300/50 shadow-lg' :
    isProcessing ? 'bg-slate-500 cursor-wait' :
    isError      ? 'bg-rose-500 hover:bg-rose-600' :
    isUnsupported? 'bg-slate-300 cursor-not-allowed opacity-60' :
    'bg-brand-500 hover:bg-brand-600 active:bg-brand-700';

  const ariaLabel =
    isListening  ? 'ಕೇಳುವಿಕೆ ನಿಲ್ಲಿಸಿ' :
    isProcessing ? 'ಪ್ರಕ್ರಿಯೆ ನಡೆಯುತ್ತಿದೆ' :
    isUnsupported? 'ವಾಯ್ಸ್ ಬೆಂಬಲಿತವಾಗಿಲ್ಲ' :
    'ಮಾತನಾಡಲು ಒತ್ತಿ';

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isUnsupported || isProcessing}
        aria-label={ariaLabel}
        aria-pressed={isListening}
        className={cn(
          'relative rounded-full text-white transition-all duration-200 flex items-center justify-center',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          s.btn,
          btnColor,
        )}
      >
        {/* Ripple ring while listening */}
        {isListening && (
          <>
            <span className="absolute inset-0 rounded-full border-2 border-brand-300 opacity-0 avatar-pulse-1" aria-hidden="true" />
            <span className="absolute inset-[-6px] rounded-full border border-brand-200 opacity-0 avatar-pulse-2" aria-hidden="true" />
          </>
        )}
        {isProcessing ? (
          <Loader2 className={cn(s.icon, 'animate-spin')} aria-hidden="true" />
        ) : isError ? (
          <MicOff className={s.icon} aria-hidden="true" />
        ) : (
          <Mic className={s.icon} aria-hidden="true" />
        )}
      </button>

      {label && (
        <p className="text-sm text-slate-500 text-center max-w-[10rem] leading-tight">
          {isListening ? (
            <span className="text-brand-600 font-medium animate-pulse">{label}</span>
          ) : label}
        </p>
      )}

      {isUnsupported && (
        <p className="text-xs text-slate-400 text-center max-w-[14rem]">
          ಈ browser ಧ್ವನಿ ಬೆಂಬಲಿಸುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು Chrome ಬಳಸಿ.
        </p>
      )}
      {error && <p role="status" className="max-w-[14rem] text-center text-xs text-rose-700">{error}</p>}
    </div>
  );
}
