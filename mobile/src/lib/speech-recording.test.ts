import { test, expect } from 'bun:test';
// The enums alone: this file imports nothing, unlike expo-audio's index.
import { IOSOutputFormat } from 'expo-audio/build/Audio.types';
import { SPEECH_RECORDING } from './speech-recording';

test('iOS records in an audio format iOS knows, not a file type', () => {
  // AVAudioRecorder refuses an unknown format ('fmt?'), and expo-audio hands
  // back a recorder that never records.
  expect(Object.values(IOSOutputFormat)).toContain(SPEECH_RECORDING.ios!.outputFormat as IOSOutputFormat);
});

test('iOS records AAC, which is what an .m4a file holds', () => {
  expect(SPEECH_RECORDING.ios!.outputFormat).toBe(IOSOutputFormat.MPEG4AAC);
  expect(SPEECH_RECORDING.ios!.extension).toBe('.m4a');
});
