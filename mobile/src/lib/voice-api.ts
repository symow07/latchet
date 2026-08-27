/**
 * Recording speech and sending it for extraction.
 *
 * The recorder itself is a hook — `useAudioRecorder` — so it lives in the
 * component that owns the button. This module keeps the two parts that are not
 * hooks: asking for the microphone, and turning a finished recording into
 * transactions.
 *
 * Ported from expo-av, which Expo deprecated in favour of expo-audio. The old
 * API handed out a Recording object a plain module could own; the new one does
 * not, which is why the shape here changed rather than just the imports.
 */
import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import type { RecordingOptions } from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import { api } from './api/api';
import { todayISO } from './dates';
import { getLocale } from './i18n/core';
import type { VoiceResult, VoiceRow } from './voice-capture';

/**
 * Recording settings tuned for speech, not music.
 *
 * Mono at 22 kHz and 32 kbps is well inside what Whisper needs and keeps a
 * two-minute recording to a few hundred kilobytes — it has to survive being
 * base64'd into a JSON body, which inflates it by a third.
 */
export const SPEECH_RECORDING: RecordingOptions = {
  isMeteringEnabled: true,
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    extension: '.m4a',
    outputFormat: 'mp4f',
    audioQuality: 96,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

export type MicPermission = 'granted' | 'denied';

/** Ask for the microphone, and configure the session so iOS records at all. */
export async function requestMicrophone(): Promise<MicPermission> {
  const { granted } = await requestRecordingPermissionsAsync();
  if (!granted) return 'denied';
  // Without allowsRecording the recording starts and captures silence.
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  return 'granted';
}

/** Release the recording session so other audio can play normally again. */
export async function releaseMicrophone(): Promise<void> {
  await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
}

/**
 * Send a finished recording for transcription and extraction.
 *
 * The file is deleted once uploaded. It is a voice note about someone's
 * finances and there is no reason to keep it on disk after the transcript has
 * been read back.
 */
export async function extractFromRecording(uri: string): Promise<VoiceResult> {
  await releaseMicrophone();
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const res = await api.post<{ transcript?: string; transactions?: VoiceRow[] }>(
      '/api/ai/voice-transactions',
      {
        audio: base64,
        format: 'm4a',
        // The device's local date, not the server's: someone recording at
        // 08:00 in Shanghai is a day ahead of a UTC server, and "today" has
        // to mean theirs.
        todayISO: todayISO(),
        // A hint, not a constraint — Whisper detects the language anyway, but
        // telling it the app's language improves accuracy on short clips.
        language: getLocale(),
      },
    );

    return {
      transcript: typeof res?.transcript === 'string' ? res.transcript : '',
      rows: Array.isArray(res?.transactions) ? res.transactions : [],
    };
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

/** Throw away a recording without uploading it. */
export async function discardRecording(uri: string | null): Promise<void> {
  await releaseMicrophone();
  if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}
