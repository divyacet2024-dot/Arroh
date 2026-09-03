/**
 * Adapter that provisions a real OfflineTTSService backed by the native
 * Capacitor "Tts" plugin (Android TextToSpeech) when running inside the
 * Capacitor shell.
 *
 * On web (browser) there is NO offline TTS runtime, so this reports
 * `available: false` and never fakes speech. Browser SpeechSynthesis is not
 * used because its voice availability/offline behaviour varies by platform and
 * is sometimes network-backed — the offline contract must stay truthful.
 */
import { Capacitor } from '@capacitor/core';
import { Tts } from './nativeTtsPlugin';
import type { OfflineTTSService } from './interfaces';

export function createNativeOfflineTTSService(): OfflineTTSService {
  const isNative = Capacitor.isNativePlatform();

  return {
    get available(): boolean {
      return isNative;
    },

    async getVoices() {
      if (!isNative) return [];
      try {
        const { voices } = await Tts.getVoices();
        return voices.map((voice) => ({ language: voice.language, label: voice.label }));
      } catch {
        return [];
      }
    },

    async checkLanguage(language: string) {
      if (!isNative) return { available: false, label: language };
      try {
        const result = await Tts.checkLanguage({ language });
        return { available: result.available, label: result.label };
      } catch {
        return { available: false, label: language };
      }
    },

    async speak(text, options) {
      if (!isNative) {
        const error = new Error('Offline TTS is unavailable outside the native app');
        (error as { code?: string }).code = 'runtime_unavailable';
        throw error;
      }
      const result = await Tts.speak({
        text,
        language: options.language,
        rate: options.rate,
      });
      if (!result.success) {
        const error = new Error(result.message ?? 'Speech is not available offline for this language');
        (error as { code?: string }).code = 'language_unsupported';
        throw error;
      }
    },

    async stop() {
      if (isNative) {
        await Tts.stop();
      }
    },
  };
}
