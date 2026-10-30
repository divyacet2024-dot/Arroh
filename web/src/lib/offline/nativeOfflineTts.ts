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

type TtsPlatform = Pick<typeof Tts, 'isReady' | 'getVoices' | 'checkLanguage' | 'speak' | 'stop' | 'addListener'>;

interface TtsServiceError extends Error {
  code: string;
}

function createTtsError(code: string, message: string): TtsServiceError {
  return Object.assign(new Error(message), { code });
}

async function waitForEngine(plugin: TtsPlatform): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const status = await plugin.isReady();
    if (status.ready) return;
    if (status.error) {
      throw createTtsError('initialization_failed', 'Android text-to-speech could not be initialized.');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw createTtsError('initialization_failed', 'Android text-to-speech is taking too long to initialize.');
}

export function createNativeOfflineTTSService(
  platform = Capacitor.getPlatform(),
  plugin: TtsPlatform = Tts,
): OfflineTTSService {
  const isAndroid = platform === 'android';

  return {
    get available(): boolean {
      return isAndroid;
    },

    async getVoices() {
      if (!isAndroid) return [];
      await waitForEngine(plugin);
      const { voices } = await plugin.getVoices();
      return voices.map(({ language, label, available, requiresNetworkConnection }) => ({
        language,
        label,
        available,
        requiresNetworkConnection,
      }));
    },

    async checkLanguage(language: string) {
      if (!isAndroid) {
        return { available: false, label: language, requiresNetworkConnection: false, voiceName: null };
      }
      await waitForEngine(plugin);
      const result = await plugin.checkLanguage({ language });
      return {
        available: result.available,
        label: result.label,
        requiresNetworkConnection: result.requiresNetworkConnection,
        voiceName: result.voiceName,
      };
    },

    async speak(text, options) {
      if (!isAndroid) {
        throw createTtsError('runtime_unavailable', 'Android text-to-speech is unavailable on this platform.');
      }
      await waitForEngine(plugin);
      const capability = await plugin.checkLanguage({ language: options.language });
      if (!capability.available) {
        throw createTtsError(
          capability.requiresNetworkConnection ? 'network_required' : 'voice_unavailable',
          capability.requiresNetworkConnection
            ? `The installed ${capability.label} voice requires a network connection; MEDORA only uses offline Android voices.`
            : `An offline ${capability.label} voice is not installed on this device.`,
        );
      }

      const utteranceId = `medora-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const completionListeners = new Map<string, () => void>();
      let timeoutId: ReturnType<typeof setTimeout>;
      const completion = new Promise<void>((resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(createTtsError('playback_timeout', 'Android speech playback did not finish.')),
          120_000,
        );
        completionListeners.set('ttsStart', () => options.onStart?.());
        completionListeners.set('ttsDone', resolve);
        completionListeners.set('ttsStop', () => reject(createTtsError('cancelled', 'Speech was stopped.')));
        completionListeners.set('ttsError', () => reject(createTtsError('playback_failed', 'Android speech playback failed.')));
      });
      void completion.catch(() => undefined);

      const handles: Awaited<ReturnType<TtsPlatform['addListener']>>[] = [];
      try {
        for (const eventName of ['ttsStart', 'ttsDone', 'ttsStop', 'ttsError'] as const) {
          handles.push(await plugin.addListener(eventName, (event) => {
            if (event.utteranceId !== utteranceId) return;
            const callback = completionListeners.get(eventName);
            callback?.();
          }));
        }
        const result = await plugin.speak({
          text,
          language: options.language,
          rate: options.rate,
          utteranceId,
        });
        if (!result.success) {
          throw createTtsError('playback_failed', 'Android speech playback could not be started.');
        }
        await completion;
      } finally {
        clearTimeout(timeoutId!);
        await Promise.all(handles.map((handle) => handle.remove()));
      }
    },

    async stop() {
      if (isAndroid) await plugin.stop();
    },
  };
}
