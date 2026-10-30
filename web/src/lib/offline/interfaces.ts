/**
 * Offline-first abstraction layer.
 *
 * These interfaces describe the *capabilities* a real on-device stack must
 * provide. A browser cannot satisfy the speech/AI requirements on its own
 * (browser SpeechRecognition and cloud APIs need a network or are
 * approximation). Anything below the `available: false` boundary therefore
 * MUST be backed by a native runtime (Capacitor plugin, Flutter platform
 * channel, whisper.cpp, Vosk, llama.cpp, etc.) — NOT by a cloud call dressed
 * up as "offline".
 *
 * The app never calls a cloud API inside these paths. When no native runtime
 * is plugged in, services report `available: false` and the UI falls back to
 * the deterministic, network-free triage rule layer.
 */

/** Small cross-cutting error that callers can surface without leaking stack traces. */
export type OfflineErrorCode =
  | 'runtime_unavailable'
  | 'model_not_loaded'
  | 'language_unsupported'
  | 'audio_capture_failed'
  | 'no_speech'
  | 'permission_denied'
  | 'model_unavailable';

export interface OfflineError extends Error {
  code: OfflineErrorCode;
  language?: string;
}

function offlineError(code: OfflineErrorCode, message: string, language?: string): OfflineError {
  const error = new Error(message) as OfflineError;
  error.code = code;
  if (language) error.language = language;
  return error;
}

/** A single recognised/local understanding result. */
export interface OfflineSpeechResult {
  text: string;
  language: string;
  confidence: number;
}

/** How the on-device Whisper model is currently available on this device. */
export type OfflineModelStatus =
  | 'available'
  | 'model_unavailable'
  | 'loading'
  | 'error';

/** State of the microphone permission on the device. */
export type OfflinePermissionState =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'prompt-with-rationale';

/**
 * Local speech recognition via whisper.cpp. `start` begins capture from the
 * device microphone; `stop` ends capture and returns the transcript. Never
 * falls back to a network transcription.
 */
export interface OfflineSpeechService {
  readonly available: boolean;
  /**
   * Check whether the on-device Whisper model is present/loaded. Must never
   * report "available" unless the model genuinely exists on the device.
   */
  getModelStatus(): Promise<OfflineModelStatus>;
  /** Load (or confirm already loaded) the on-device Whisper model. */
  loadModel(): Promise<OfflineModelStatus>;
  /** Report the microphone permission state. */
  checkPermission(): Promise<OfflinePermissionState>;
  /** Request microphone permission; resolves with the resulting state. */
  requestPermission(): Promise<OfflinePermissionState>;
  /** Begin capturing from the microphone. */
  start(options: { language: string }): Promise<void>;
  /** Stop capture and return the recognised text for the recorded utterance. */
  stop(): Promise<OfflineSpeechResult>;
  /** Discard the current capture without transcribing. */
  cancel(): Promise<void>;
}

/** Local text-to-speech. `speak` synthesises only from on-device voices. */
export interface OfflineTTSService {
  readonly available: boolean;
  /** List voices with their actual device installation and network requirements. */
  getVoices(): Promise<{
    language: string;
    label: string;
    available: boolean;
    requiresNetworkConnection: boolean;
  }[]>;
  /**
   * Truthfully report whether an offline voice exists for this language.
   * Network-only voices are reported separately and are never presented as offline.
   */
  checkLanguage(language: string): Promise<{
    available: boolean;
    label: string;
    requiresNetworkConnection: boolean;
    voiceName: string | null;
  }>;
  /** Resolves after playback finishes; onStart fires only after Android confirms playback started. */
  speak(text: string, options: { language: string; rate?: number; onStart?: () => void }): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Local language understanding (no-network NLP). Takes raw transcript + a
 * target language and returns structured symptoms/vitals — or an error when
 * it cannot confidently understand the input.
 */
export interface OfflineAIService {
  readonly available: boolean;
  parseTranscript(input: { transcript: string; language: string }): Promise<OfflineParseResult>;
}

export interface OfflineParseResult {
  language: string;
  symptoms: string[];
  vitals: Record<string, number | string>;
  confidence: number;
  unableToAssess: boolean;
}

/**
 * Network-free triage classification. This is the medically-safe deterministic
 * rule layer, NOT a free-form chatbot. Returns a fixed triage level and a
 * constrained set of actions.
 */
export interface OfflineTriageService {
  readonly available: boolean;
  assess(input: { symptoms: string[]; vitals: Record<string, number | string> }): OfflineTriageVerdict;
}

export interface OfflineTriageVerdict {
  risk_score: number;
  triage_level: 'RED' | 'YELLOW' | 'GREEN';
  recommended_actions: string[];
  maternal_conditions: string[];
  unableToAssess: boolean;
}

/** Reports real network reachability (navigator.onLine + network events). */
export interface ConnectivityService {
  readonly online: boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

/** Durable outbox that survives a restart (persisted to localStorage). */
export interface SyncQueueService {
  enqueue(record: unknown): void;
  peek(): unknown[];
  remove(record: unknown): void;
  clear(): void;
  get size(): number;
}

/**
 * Describes the native runtime the platform must provide before any
 * `Offline*Service` may report `available: true`. Reading this list makes it
 * explicit that a browser-only build cannot truthfully expose offline AI.
 */
export const OFFLINE_RUNTIME_REQUIREMENTS = {
  speech: 'on-device ASR runtime (e.g. whisper.cpp / Vosk / native STT plugin)',
  nlp: 'on-device language understanding model (no-cloud NLP runtime)',
  tts: 'on-device TTS voice pack for the selected language',
  triage: 'deterministic rules engine (bundled, network-free)',
} as const;

export { offlineError };
