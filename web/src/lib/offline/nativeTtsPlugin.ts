/**
 * Typed facade over the native `Tts` Capacitor plugin (see
 * android/app/.../OfflineTtsPlugin.java). Nothing here does speech itself —
 * it's a thin, typed view of the bridge. All availability/speaking is decided
 * truthfully by the Android engine.
 */
import { registerPlugin } from '@capacitor/core';

export interface NativeTtsVoice {
  /** BCP-47 language tag, e.g. "ta-IN". */
  language: string;
  /** Human-readable display label. */
  label: string;
  /** True only when the engine confirms offline voice data is present. */
  available: boolean;
}

export interface NativeTtsPlugin {
  /** List the six ARROH locales with truthful per-locale availability. */
  getVoices(): Promise<{ voices: NativeTtsVoice[] }>;
  /** Truthfully report whether a single language has offline voice data. */
  checkLanguage(options: { language: string }): Promise<{
    language: string;
    available: boolean;
    label: string;
  }>;
  /** Queue offline speech. Rejects when no usable offline voice exists. */
  speak(options: { text: string; language: string; rate?: number }): Promise<{
    success: boolean;
    message?: string;
  }>;
  /** Stop any in-progress utterance. */
  stop(): Promise<void>;
}

export const Tts = registerPlugin<NativeTtsPlugin>('Tts');
