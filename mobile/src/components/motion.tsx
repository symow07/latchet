import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedProps, withTiming,
  withSequence, Easing, useDerivedValue, cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { PRESS_SCALE, countDuration, currencyParts, formatWithParts } from '@/lib/motion';
import { EASE, MOTION } from '@/lib/identity/motion';
import { F } from '@/lib/design';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

// Reanimated writes a prop from the UI thread only if it is allow-listed, and
// a TextInput's `text` is not. Without this the count's shared value animated
// and the label never changed — the failure this file's CountUp used to
// document and fail safe around. Idempotent; identity/primitives does the same.
Animated.addWhitelistedNativeProps({ text: true });

const [OUT_X1, OUT_Y1, OUT_X2, OUT_Y2] = EASE.out;
const [PRESS_X1, PRESS_Y1, PRESS_X2, PRESS_Y2] = EASE.press;
const easeOut = Easing.bezier(OUT_X1, OUT_Y1, OUT_X2, OUT_Y2);
const easePress = Easing.bezier(PRESS_X1, PRESS_Y1, PRESS_X2, PRESS_Y2);

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
  // Derived every render, not memoised on `format`: the app's formatCurrency
  // is one module function whose currency changes underneath it (onboarding,
  // Settings), and a cache keyed on the function kept counting in the old
  // currency — "CN¥" beside a "$" balance. It is a handful of format() calls.
  const parts = currencyParts(format);

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
        // The identity's count-up: 280 ms, ease-out-quint.
        duration: countDuration(value),
        easing: easeOut,
      })
    );
    return () => cancelAnimation(progress);
  }, [value, reduced, progress]);

  const animatedProps = useAnimatedProps(() => {
    return { text: formatWithParts(value * progress.value, parts) } as never;
  });
  const textStyle = [{ ...F[weight], fontSize: size, color, padding: 0, letterSpacing: 0.1 }, style];

  // Sized by an invisible copy of the final figure. On the New Architecture
  // Reanimated writes `text` straight to the native view without a new layout,
  // so the field kept the width of the count's first frame ("0") and the final
  // figure was cut to "…" (the health score showed "•••").
  return (
    <View>
      <Text style={[textStyle, styles.sizer]} accessible={false} importantForAccessibility="no-hide-descendants">
        {format(value)}
      </Text>
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
        style={[textStyle, StyleSheet.absoluteFill]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Takes the final figure's size and is never seen or read out.
  sizer: { opacity: 0 },
});

/**
 * Press feedback.
 *
 * Not decoration — this is the only thing that tells a finger the tap landed
 * before the screen changes. Scale rather than opacity, because a dimming
 * surface reads as "disabled" and a shrinking one reads as "pressed". With
 * Reduce Motion on, nothing may move, so the surface dims a little instead
 * (DESIGN-IDENTITY.md §Motion), the same as the identity's own `Press`.
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
  // 0 at rest, 1 while held: a scale normally, a slight dim under Reduce Motion.
  const held = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() =>
    reduced
      ? { opacity: 1 - 0.18 * held.value }
      : { transform: [{ scale: 1 - (1 - PRESS_SCALE) * held.value }] }
  );
  // Nothing to do, so nothing to acknowledge. A disabled button, or one whose
  // caller passes `onPress={busy ? undefined : run}`, used to shrink and buzz
  // anyway, because the haptic lived in this component's own onPress, which
  // was always set. A press that does nothing should feel like nothing.
  const inert = !!rest.disabled || (!onPress && !rest.onLongPress);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        {...rest}
        style={style}
        // Timed, not sprung: 90 ms in, 160 ms out, no overshoot (MOTION.press).
        onPressIn={(e) => {
          if (!inert) held.value = withTiming(1, { duration: MOTION.press.in.duration, easing: easePress });
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          held.value = withTiming(0, { duration: MOTION.press.out.duration, easing: easeOut });
          onPressOut?.(e);
        }}
        onPress={(e) => {
          if (inert || !onPress) return;
          if (haptic === 'selection') Haptics.selectionAsync();
          else if (haptic === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress(e);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** Re-exported so screens import motion from one place. */
export { useDerivedValue };
