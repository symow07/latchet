/**
 * Recording settings tuned for speech, not music.
 *
 * Mono at 22 kHz and 32 kbps is well inside what Whisper needs and keeps a
 * two-minute recording to a few hundred kilobytes — it has to survive being
 * base64'd into a JSON body, which inflates it by a third.
 *
 * Its own module, importing expo-audio for types only, so the test beside it
 * can check the values without loading the native module.
 */
import type { RecordingOptions } from 'expo-audio';

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
    // IOSOutputFormat.MPEG4AAC: AAC, the codec an .m4a carries. The type
    // accepts any string, and it held 'mp4f' (the MPEG-4 *file* type), which
    // no recorder can be created with: expo-audio swallows that and hands back
    // a recorder that never records, so nothing was ever uploaded. (From SDK
    // 57 it throws instead, and the advisor crashed on open.)
    outputFormat: 'aac ',
    audioQuality: 96,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};
