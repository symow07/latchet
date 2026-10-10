import { useEffect, useMemo } from 'react';
import { Pressable, TextInput, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedProps, withSpring, withTiming,
  withRepeat, withSequence, Easing, useDerivedValue, interpolate, cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  PRESS_SCALE, SPRING, BREATH_MS, BREATH_MIN, BREATH_MAX, countDuration,
  currencyParts, formatWithParts,
} from '@/lib/motion';
import { F } from '@/lib/design';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * A number that counts to its value.
 *
 * The app's one authored moment. It writes through `text` on an animated
 * TextInput rather than React state, so the count runs on the UI thread — a
 * setState per frame would re-render the whole screen sixty times to move one
 * label.
 *
 * Editable is false and pointerEvents none, so it is a label that happens to
 * be a TextInput, not an input.
 */
export function CountUp({
  value,
  format,
  size = 38,
  weight = 'bold',
  color,
  style,
}: {
  value: number;
  /** The screen's own formatter — locale, currency symbol and all. */
  format: (n: number) => string;
  size?: number;
  weight?: keyof typeof F;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  // Derived once per formatter, on the JS thread, because Intl cannot run in a
  // worklet — see currencyParts.
  const parts = useMemo(() => currencyParts(format), [format]);

  useEffect(() => {
    if (reduced) { progress.value = 1; return; }
    // The rewind is an animation, not a plain write.
    //
    // This was `progress.value = 0` followed by `progress.value =
    // withTiming(...)` in the same synchronous block. A raw assignment and an
    // animation assignment to one shared value in a single tick race, the raw
    // one wins, and the count sits at zero forever — which is what it did.
    // Nothing rendered this component until now, so nobody saw it.
    progress.value = withSequence(
      withTiming(0, { duration: 0 }),
      withTiming(1, {
        duration: countDuration(value),
        // Exponential ease-out: arrives fast, settles long.
        easing: Easing.out(Easing.exp),
      })
    );
    return () => cancelAnimation(progress);
  }, [value, reduced, progress]);

  const animatedProps = useAnimatedProps(() => {
    return { text: formatWithParts(value * progress.value, parts) } as never;
  });

  return (
    <AnimatedTextInput
      editable={false}
      pointerEvents="none"
      /**
       * `key` and `value` — both deliberate, and both about the failure mode.
       *
       * Writing `text` through `animatedProps` is the standard way to move a
       * number without re-rendering, but it is a native-side write that this
       * component cannot verify landed. It did not land here: the shared value
       * animated correctly (the ring on the same screen proves it) while the
       * label stayed on whatever it was first given. With `defaultValue={0}`
       * that meant a permanent, confident zero next to a grade of B.
       *
       * So the declared text is now the *answer*, not the starting point. If
       * the animated write works, it takes over from frame one and counts up
       * to the same figure. If it does not, the reader gets the right number
       * instead of a wrong one — which is the only acceptable way round for a
       * decoration to fail.
       *
       * `key` remounts the input when the value changes, because a TextInput
       * ignores a changed `value` once the native side has been written to by
       * animatedProps.
       */
      key={String(value)}
      value={format(value)}
      animatedProps={animatedProps}
      style={[
        { ...F[weight], fontSize: size, color, padding: 0, letterSpacing: 0.1 },
        style,
      ]}
    />
  );
}

/**
 * Press feedback.
 *
 * Not decoration — this is the only thing that tells a finger the tap landed
 * before the screen changes. Scale rather than opacity, because a dimming
 * surface reads as "disabled" and a shrinking one reads as "pressed".
 */
export function PressableScale({
  children,
  onPress,
  // Taken by name rather than left in `...rest`. They were in `rest`, which is
  // spread *above* this component's own handlers, so a caller that passed
  // either one had it silently overwritten — the prop typechecked, went in,
  // and never fired. Now the scale runs first and the caller's handler after,
  // which is what a component that adds behaviour to Pressable owes.
  onPressIn,
  onPressOut,
  haptic = 'selection',
  style,
  ...rest
}: PressableProps & {
  haptic?: 'selection' | 'light' | 'none';
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        {...rest}
        style={style}
        onPressIn={(e) => { if (!reduced) scale.value = withSpring(PRESS_SCALE, SPRING); onPressIn?.(e); }}
        onPressOut={(e) => { if (!reduced) scale.value = withSpring(1, SPRING); onPressOut?.(e); }}
        onPress={(e) => {
          if (haptic === 'selection') Haptics.selectionAsync();
          else if (haptic === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress?.(e);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/**
 * A light that breathes, inside the card.
 *
 * The first version of this animated the card's outer shadow. It worked, in
 * the sense that the pixels changed — and measured a peak difference of 6/255
 * against the near-black background, which is to say nobody would ever see
 * it. An outer shadow has no luminance to trade on a dark theme.
 *
 * So the breath moved inside, onto a pale blob sitting on the hero's gradient,
 * where there is contrast to work with. The card still does not move: a hero
 * that pulses in size is a distraction on a screen you read numbers off.
 */
export function BreathingLight({
  color,
  size = 160,
  top = -40,
  right = -30,
  peakOpacity = 1,
}: {
  /** The blob's colour — pale, against the card's own gradient. */
  color: string;
  size?: number;
  top?: number;
  right?: number;
  peakOpacity?: number;
}) {
  const reduced = useReducedMotion();
  const phase = useSharedValue(1);

  useEffect(() => {
    if (reduced) { phase.value = 1; return; }
    phase.value = withRepeat(
      withSequence(
        withTiming(BREATH_MIN, { duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin) }),
        withTiming(BREATH_MAX, { duration: BREATH_MS / 2, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    return () => cancelAnimation(phase);
  }, [reduced, phase]);

  const lightStyle = useAnimatedStyle(() => ({
    opacity: peakOpacity * phase.value,
    transform: [{ scale: interpolate(phase.value, [BREATH_MIN, BREATH_MAX], [0.88, 1.06]) }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top, right,
          width: size, height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        lightStyle,
      ]}
    />
  );
}

/** Re-exported so screens import motion from one place. */
export { useDerivedValue };
