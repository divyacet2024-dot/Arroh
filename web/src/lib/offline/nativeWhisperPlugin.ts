/**
 * Typed facade over the native `Whisper` Capacitor plugin (see
 * android/app/.../WhisperPlugin.java). Nothing here does speech itself — it's a
 * thin, typed view of the bridge. The model + audio all live on-device.
 */
import { registerPlugin } from '@capacitor/core';

export type NativeModelStatus = 'available' | 'model_unavailable' | 'loading' | 'error';
export type NativePermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

export interface NativeWhisperPlugin {
  /** Report whether the on-device model is present/loaded. */
  getModelStatus(): Promise<{ status: NativeModelStatus; path?: string }>;
  /** Load the model on-device; resolves with the resulting status. */
  loadModel(): Promise<{ status: NativeModelStatus; path?: string }>;
  /** Free the model from memory. */
  unloadModel(): Promise<void>;
  /** Report microphone permission state. */
  checkPermission(): Promise<{ state: NativePermissionState }>;
  /** Request microphone permission. */
  requestPermission(): Promise<{ state: NativePermissionState }>;
  /** Begin capturing from the microphone. */
  start(options: { language: string }): Promise<void>;
  /** Stop capture and return the transcript for the recorded utterance. */
  stop(options: { language: string }): Promise<{ text: string; language?: string; cancelled?: boolean }>;
  /** Discard the current capture without transcribing. */
  cancel(): Promise<void>;
}

export const Whisper = registerPlugin<NativeWhisperPlugin>('Whisper');
