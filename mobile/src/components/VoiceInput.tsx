import { Component, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { useAudioRecorder } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Mic } from '@/components/icons';
import { S, type Palette } from '@/lib/design';
import { t } from '@/lib/i18n/core';
import { discardRecording, extractFromRecording, requestMicrophone, SPEECH_RECORDING } from '@/lib/voice-api';
import type { VoiceResult } from '@/lib/voice-capture';

/**
 * The advisor's hold-to-speak button and the recorder behind it.
 *
 * Hold to talk, release to extract. Nothing is written here: the result goes
 * back to the screen, which shows it for review. Speech is the least reliable
 * input there is, and a misheard amount saved silently is worse than one the
 * user corrects.
 *
 * expo-audio hands out the recorder through a hook, and the hook throws while
 * rendering when iOS refuses to create a recorder (an unsupported format did
 * this, and the whole advisor crashed with it). So the button sits in its own
 * error boundary: if the recorder cannot be made, the button is replaced by a
 * dimmed one and the screen says voice is unavailable; everything else on the
 * screen keeps working.
 */

/** What the screen shows above the input: nothing, listening, reading back, or unavailable. */
export type VoicePhase = 'idle' | 'recording' | 'extracting' | 'unavailable';

interface Props {
  pal: Palette;
  disabled: boolean;
  onPhase: (phase: VoicePhase) => void;
  onResult: (result: VoiceResult) => void;
}

export function VoiceInput(props: Props) {
  return (
    <VoiceBoundary
      onError={() => props.onPhase('unavailable')}
      fallback={
        <View
          accessible
          accessibilityLabel={t('voice.unavailable')}
          accessibilityState={{ disabled: true }}
          style={BUTTON}
        >
          <Mic size={20} color={props.pal.inkFaint} strokeWidth={S.stroke} />
        </View>
      }
    >
      <HoldToSpeak {...props} />
    </VoiceBoundary>
  );
}

const BUTTON = { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' } as const;

function HoldToSpeak({ pal, disabled, onPhase, onResult }: Props) {
  const recorder = useAudioRecorder(SPEECH_RECORDING);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  // Refs, not state: the press and the recorder run on their own clocks. The
  // release handler used to decide from state whether anything was
  // recording, and on SDK 57 it was seen to skip the stop after a three-second
  // hold: the microphone stayed on and the screen stayed on "Listening…". A
  // quick tap can also come up before the recorder has started at all.
  const holding = useRef(false);
  const live = useRef(false);
  const busy = useRef(false);

  const report = (next: VoicePhase) => {
    setPhase(next);
    onPhase(next);
  };

  const begin = async () => {
    if (busy.current) return;
    busy.current = true;
    holding.current = true;
    try {
      if ((await requestMicrophone()) === 'denied') {
        Alert.alert(t('dialogs.permissionNeeded'), t('voice.micDenied'));
        busy.current = false;
        return;
      }
      // Let go while iOS was asking for the microphone (the first press, which
      // the prompt interrupts): start nothing. The next hold records.
      if (!holding.current) {
        busy.current = false;
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await recorder.prepareToRecordAsync();
      recorder.record();
      live.current = true;
      report('recording');
    } catch {
      busy.current = false;
      // Release the session even when preparing failed, or the next attempt
      // inherits a half-configured one.
      await discardRecording(null);
      Alert.alert(t('dialogs.error'), t('voice.failed'));
      return;
    }
    // Let go while the recorder was starting: the release found nothing to
    // stop, so stop now.
    if (!holding.current) await finish();
  };

  const end = () => {
    holding.current = false;
    if (live.current) void finish();
  };

  const finish = async () => {
    if (!live.current) return;
    live.current = false;
    report('extracting');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await recorder.stop();
      // Read after stop: the uri is only final once the file is closed.
      const uri = recorder.uri;
      if (!uri) throw new Error('Recording produced no file');
      onResult(await extractFromRecording(uri));
    } catch {
      await discardRecording(recorder.uri ?? null);
      Alert.alert(t('dialogs.error'), t('voice.failed'));
    } finally {
      busy.current = false;
      report('idle');
    }
  };

  return (
    <Pressable
      onPressIn={begin}
      onPressOut={end}
      disabled={disabled || phase === 'extracting'}
      accessibilityRole="button"
      accessibilityLabel={phase === 'recording' ? t('voice.listening') : t('voice.tapToSpeak')}
      style={BUTTON}
    >
      {phase === 'extracting'
        ? <ActivityIndicator size="small" color={pal.inkDim} />
        : <Mic size={20} color={phase === 'recording' ? pal.negative : pal.inkDim} strokeWidth={S.stroke} />}
    </Pressable>
  );
}

class VoiceBoundary extends Component<
  { fallback: ReactNode; onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[voice] no recorder:', error instanceof Error ? error.message : error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
