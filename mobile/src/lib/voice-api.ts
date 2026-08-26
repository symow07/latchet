/**
 * Recording speech and sending it for extraction.
 *
 * The native half: expo-av for the microphone, the API client for the upload.
 * Kept apart from voice-capture.ts so the decision logic there — what gets
 * written, what does not — stays testable without a simulator.
 *
 * KNOWN DEBT: expo-av is deprecated. Expo's own docs say to use expo-audio
 * instead, and expo-av will not survive many more SDK bumps. It is used here
 * anyway because it is already a dependency and already compiled into the
 * native project, where expo-audio is neither — adding it means a new native
 * module and a rebuild, and its recording API is hook-based, so this file
 * would be restructured rather than edited.
 *
 * That port is worth doing before the next SDK upgrade forces it, and it is
 * cheap while this feature is new. It was not done in the same change as
 * shipping the feature because there was no way to run a build and confirm
 * the port worked, and an unverified rewrite of the recording path is a worse
 * position than a deprecation warning.
 */
import { Audio } from 'expo-av';
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
const SPEECH_RECORDING: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 32000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 32000,
  },
};

export type MicPermission = 'granted' | 'denied';

/** Ask for the microphone, and configure the session so iOS records at all. */
export async function requestMicrophone(): Promise<MicPermission> {
  const { granted } = await Audio.requestPermissionsAsync();
  if (!granted) return 'denied';
  // Without allowsRecordingIOS the recording starts and captures silence.
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  return 'granted';
}

export async function startRecording(): Promise<Audio.Recording> {
  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(SPEECH_RECORDING);
  await recording.startAsync();
  return recording;
}

/**
 * Stop, read the file, and hand it to the server.
 *
 * The recording is deleted once uploaded. It is a voice note about someone's
 * finances and there is no reason to keep it on disk after the transcript has
 * been read back.
 */
export async function finishAndExtract(recording: Audio.Recording): Promise<VoiceResult> {
  await recording.stopAndUnloadAsync();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

  const uri = recording.getURI();
  if (!uri) throw new Error('Recording produced no file');

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

/** Abandon a recording without uploading it. */
export async function cancelRecording(recording: Audio.Recording): Promise<void> {
  try {
    await recording.stopAndUnloadAsync();
  } catch {
    // Already stopped; nothing to undo.
  }
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
  const uri = recording.getURI();
  if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}
