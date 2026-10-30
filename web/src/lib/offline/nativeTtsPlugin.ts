/**
 * Typed facade over the native `Tts` Capacitor plugin (see
 * android/app/.../OfflineTtsPlugin.java). Nothing here does speech itself —
 * it's a thin, typed view of the bridge. All availability/speaking is decided
 * truthfully by the Android engine.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeTtsVoice {
  /** BCP-47 language tag, e.g. "ta-IN". */
  language: string;
  /** Human-readable display label. */
  label: string;
  /** True only when the engine confirms offline voice data is present. */
  available: boolean;
  /** True when a matching voice exists but requires a network connection. */
  requiresNetworkConnection: boolean;
  /** Selected Android engine voice name, or null when no matching voice exists. */
  voiceName: string | null;
}

export interface NativeTtsPlugin {
  /** Waitable readiness status for Android's asynchronously initialized TTS engine. */
  isReady(): Promise<{ ready: boolean; error?: string }>;
  /** List the six MEDORA locales and actual installed voice capabilities. */
  getVoices(): Promise<{ voices: NativeTtsVoice[] }>;
  /** Report offline availability separately from network-only voice availability. */
  checkLanguage(options: { language: string }): Promise<{
    language: string;
    available: boolean;
    requiresNetworkConnection: boolean;
    voiceName: string | null;
    label: string;
  }>;
  /** Queue speech using an installed offline voice; progress events report playback. */
  speak(options: { text: string; language: string; rate?: number; utteranceId: string }): Promise<{
    success: boolean;
    utteranceId: string;
    message?: string;
  }>;
  /** Stop any in-progress utterance. */
  stop(): Promise<void>;
  addListener(
    eventName: 'ttsStart' | 'ttsDone' | 'ttsStop' | 'ttsError',
    listener: (event: { utteranceId: string; message?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const Tts = registerPlugin<NativeTtsPlugin>('Tts');
