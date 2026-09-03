/**
 * Adapter that provisions a real OfflineSpeechService backed by the native
 * Capacitor "Whisper" plugin (whisper.cpp) when running inside the Capacitor
 * shell.
 *
 * On web (browser) there is NO offline ASR runtime, so this reports
 * `available: false` and never fakes recognition. Browser SpeechRecognition is
 * deliberately NOT used (it is a cloud-backed approximation that violates the
 * offline contract). The app must not silently download a model either — if the
 * model is missing on-device, we surface `model_unavailable`.
 */
import { Capacitor } from '@capacitor/core';
import { Whisper } from './nativeWhisperPlugin';
import { offlineError } from './interfaces';
import type {
  OfflineModelStatus,
  OfflinePermissionState,
  OfflineSpeechResult,
  OfflineSpeechService,
} from './interfaces';

export function createNativeOfflineSpeechService(): OfflineSpeechService {
  const isNative = Capacitor.isNativePlatform();

  return {
    get available(): boolean {
      return isNative;
    },

    async getModelStatus(): Promise<OfflineModelStatus> {
      if (!isNative) return 'model_unavailable';
      try {
        const { status } = await Whisper.getModelStatus();
        return status;
      } catch {
        return 'error';
      }
    },

    async loadModel(): Promise<OfflineModelStatus> {
      if (!isNative) return 'model_unavailable';
      try {
        const { status } = await Whisper.loadModel();
        return status;
      } catch {
        return 'error';
      }
    },

    async checkPermission(): Promise<OfflinePermissionState> {
      if (!isNative) return 'denied';
      try {
        const { state } = await Whisper.checkPermission();
        return state;
      } catch {
        return 'denied';
      }
    },

    async requestPermission(): Promise<OfflinePermissionState> {
      if (!isNative) return 'denied';
      try {
        const { state } = await Whisper.requestPermission();
        return state;
      } catch {
        return 'denied';
      }
    },

    async start(options: { language: string }): Promise<void> {
      if (!isNative) {
        throw offlineError('runtime_unavailable', 'Offline speech is unavailable outside the native app');
      }
      const status = await this.getModelStatus();
      if (status === 'model_unavailable') {
        throw offlineError('model_unavailable', 'Whisper model is not installed on this device');
      }
      if (status === 'error') {
        throw offlineError('model_not_loaded', 'Whisper model could not be loaded');
      }
      await Whisper.start({ language: options.language });
    },

    async stop(): Promise<OfflineSpeechResult> {
      if (!isNative) {
        throw offlineError('runtime_unavailable', 'Offline speech is unavailable outside the native app');
      }
      const result = await Whisper.stop({ language: 'auto' });
      if (result.cancelled) {
        throw offlineError('audio_capture_failed', 'Capture was cancelled');
      }
      if (!result.text || result.text.trim().length === 0) {
        throw offlineError('no_speech', 'No speech detected');
      }
      return { text: result.text, language: result.language ?? 'auto', confidence: 1 };
    },

    async cancel(): Promise<void> {
      if (isNative) {
        await Whisper.cancel();
      }
    },
  };
}
