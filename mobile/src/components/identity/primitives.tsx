/**
 * The identity's building blocks: glyphs, text, press feedback, settling
 * content, count-ups, the self-drawing check, a progress line, and lifted
 * surfaces with layered shadows and a silver edge.
 *
 * Only the identity preview uses these during Step 2a. They read tokens from
 * src/lib/identity and nothing from palettes.ts or kit.tsx, so the old look
 * cannot leak in.
 *
 * Every animation takes its duration and curve from MOTION, never a literal,
 * and none of them springs.
 */
import { useEffect, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { amountScale, currencyParts, formatWithParts } from '@/lib/motion';
import {
  DARK_SHADOW_GAIN,
  ELEVATION,
  GLYPH,
  MAX_FONT_SCALE,
  RADIUS,
  TYPE,
  glyphStroke,
  type Elevation,
  type IdentityPalette,
  type Shadow,
  type TypeRole,
} from '@/lib/identity/tokens';
import { EASE, MOTION, settleDelay, type EaseName, type Tween } from '@/lib/identity/motion';
import { CHECK_TICK, CHECK_TICK_LENGTH, GLYPHS, type GlyphName } from '@/lib/identity/glyph-paths';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

// Reanimated writes only allow-listed props from the UI thread, and a
// TextInput's `text` is not on its list. Without this the count-up's shared
// value animates and the label never changes: the symptom the old CountUp in
// components/motion.tsx documents and fails safe around, now fixed at the cause.
Animated.addWhitelistedNativeProps({ text: true });
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function ease(name: EaseName) {
  const [x1, y1, x2, y2] = EASE[name];
  return Easing.bezier(x1, y1, x2, y2);
}

function timing(t: Tween) {
  return { duration: t.duration, easing: ease(t.ease) };
}

/** Rewind to 0 and run to 1. A raw write and an animated write in one tick race; this does not. */
function replayTo1(t: Tween, delay = 0) {
  return withSequence(withTiming(0, { duration: 0 }), withDelay(delay, withTiming(1, timing(t))));
}

// ── Text ────────────────────────────────────────────────────────────────────

export function textStyle(role: TypeRole): TextStyle {
  const spec = TYPE[role];
  return {
    fontSize: spec.size,
    lineHeight: spec.line,
    fontWeight: spec.weight,
    letterSpacing: spec.tracking,
    ...(spec.tabular ? { fontVariant: ['tabular-nums'] } : null),
  };
}

export function Type({
  role,
  color,
  style,
  numberOfLines,
  children,
}: {
  role: TypeRole;
  color: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children: ReactNode;
}) {
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      numberOfLines={numberOfLines}
      style={[textStyle(role), { color }, style]}
    >
      {children}
    </Text>
  );
}

// ── Glyph ───────────────────────────────────────────────────────────────────

export function Glyph({
  name,
  size = GLYPH.sizes.action,
  color,
  style,
}: {
  name: GlyphName;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  const art = GLYPHS[name];
  const stroke = glyphStroke(size);
  const dots = 'dots' in art ? art.dots : [];
  return (
    <View style={style} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox={`0 0 ${GLYPH.grid} ${GLYPH.grid}`} fill="none">
        {art.strokes.map((d) => (
          <Path
            key={d}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {dots.map(([cx, cy]) => (
          <Circle key={`${cx},${cy}`} cx={cx} cy={cy} r={GLYPH.dot} fill={color} />
        ))}
      </Svg>
    </View>
  );
}

// ── Press ───────────────────────────────────────────────────────────────────

/**
 * Press feedback: a 3% shrink in 90 ms, released in 160 ms. With Reduce
 * Motion the surface dims a little instead of moving.
 */
export function Press({
  onPress,
  haptic = true,
  style,
  children,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const held = useSharedValue(0);

  const animated = useAnimatedStyle(() =>
    reduced
      ? { opacity: 1 - 0.18 * held.value }
      : { transform: [{ scale: 1 - (1 - MOTION.press.scale) * held.value }] }
  );

  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      onPressIn={(e) => {
        held.value = withTiming(1, timing(MOTION.press.in));
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        held.value = withTiming(0, timing(MOTION.press.out));
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

// ── Settle ──────────────────────────────────────────────────────────────────

/**
 * Content arriving in reading order: 8 pt of rise and a fade, 200 ms, each
 * block 30 ms behind the one above. Four blocks land inside 290 ms.
 * Change `replay` to run it again.
 */
export function Settle({
  index = 0,
  replay = 0,
  style,
  children,
}: {
  index?: number;
  replay?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const shown = useSharedValue(0);

  useEffect(() => {
    shown.value = replayTo1(reduced ? MOTION.reduced.fade : MOTION.settle.tween, settleDelay(index));
    return () => cancelAnimation(shown);
  }, [index, replay, reduced, shown]);

  const animated = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: reduced ? 0 : (1 - shown.value) * MOTION.settle.distance }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

// ── Count-up ────────────────────────────────────────────────────────────────

/**
 * A number that counts to its value in 280 ms, on the UI thread.
 *
 * The declared text is the final figure, so if the animated write ever fails
 * to land the reader still gets the right number (the lesson from the old
 * CountUp in components/motion.tsx, whose formatting helpers this reuses).
 */
export function CountUp({
  value,
  format,
  role = 'display',
  color,
  replay = 0,
  delay = 0,
  fit,
  style,
}: {
  value: number;
  format: (n: number) => string;
  role?: TypeRole;
  color: string;
  replay?: number;
  delay?: number;
  /**
   * How many characters fit at full size. Past it the figure shrinks (to 55%
   * at most, the app's existing amountScale rule) rather than clipping.
   */
  fit?: number;
  style?: StyleProp<TextStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  // Derived every render, not memoised on `format`: the app's formatCurrency
  // is one module function whose currency changes underneath it (onboarding,
  // Settings), and a cache keyed on the function kept counting in the old
  // currency — "CN¥" beside a "$" balance. It is a handful of format() calls.
  const parts = currencyParts(format);
  const spec = TYPE[role];
  const scale = fit ? amountScale(format(value).length, fit) : 1;

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = replayTo1(MOTION.countUp, delay);
    return () => cancelAnimation(progress);
  }, [value, replay, delay, reduced, progress]);

  const animatedProps = useAnimatedProps(() => {
    return { text: formatWithParts(value * progress.value, parts) } as never;
  });

  return (
    <AnimatedTextInput
      key={`${value}:${replay}`}
      editable={false}
      pointerEvents="none"
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      value={format(value)}
      animatedProps={animatedProps}
      style={[
        textStyle(role),
        { color, padding: 0, fontSize: spec.size * scale, lineHeight: spec.line * scale },
        style,
      ]}
    />
  );
}

// ── Check ───────────────────────────────────────────────────────────────────

/**
 * The self-drawing check. The ring warms from silver to the tint in 160 ms,
 * then the tick traces itself along its own length in 240 ms, and a success
 * haptic lands as it finishes. With Reduce Motion it is simply drawn.
 */
export function DrawCheck({
  P,
  size = GLYPH.sizes.row,
  replay = 0,
  delay = 0,
  haptic = true,
}: {
  P: Pick<IdentityPalette, 'silver' | 'tint'>;
  size?: number;
  replay?: number;
  delay?: number;
  haptic?: boolean;
}) {
  const reduced = useReducedMotion();
  const ring = useSharedValue(reduced ? 1 : 0);
  const tick = useSharedValue(reduced ? 1 : 0);
  const stroke = glyphStroke(size);

  useEffect(() => {
    if (reduced) {
      ring.value = 1;
      tick.value = 1;
      return;
    }
    const buzz = () => {
      if (haptic) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    };
    ring.value = replayTo1(MOTION.check.ring, delay);
    tick.value = withSequence(
      withTiming(0, { duration: 0 }),
      withDelay(
        delay + MOTION.check.tick.delay,
        withTiming(1, timing(MOTION.check.tick), (finished) => {
          if (finished) runOnJS(buzz)();
        })
      )
    );
    return () => {
      cancelAnimation(ring);
      cancelAnimation(tick);
    };
  }, [replay, delay, reduced, haptic, ring, tick]);

  const ringProps = useAnimatedProps(() => ({ strokeOpacity: ring.value }));
  const tickProps = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_TICK_LENGTH * (1 - tick.value),
  }));

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox={`0 0 ${GLYPH.grid} ${GLYPH.grid}`} fill="none">
        <Circle cx={12} cy={12} r={8.75} fill="none" stroke={P.silver} strokeWidth={stroke} />
        <AnimatedCircle
          cx={12}
          cy={12}
          r={8.75}
          fill="none"
          stroke={P.tint}
          strokeWidth={stroke}
          animatedProps={ringProps}
        />
        <AnimatedPath
          d={CHECK_TICK}
          fill="none"
          stroke={P.tint}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={[CHECK_TICK_LENGTH, CHECK_TICK_LENGTH]}
          animatedProps={tickProps}
        />
      </Svg>
    </View>
  );
}

// ── Progress line ───────────────────────────────────────────────────────────

/**
 * A rounded line that fills to `value` (0–1) in 280 ms. With `sheen`, the fill
 * is metallic: a vertical gradient from `sheen` down to `fill`, which is what
 * makes silver read as silver rather than as grey.
 */
export function ProgressLine({
  value,
  track,
  fill,
  sheen,
  height = 6,
  replay = 0,
  delay = 0,
  style,
}: {
  value: number;
  track: string;
  fill: string;
  sheen?: string;
  height?: number;
  replay?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const target = Math.min(Math.max(value, 0), 1);
  const shown = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      shown.value = 1;
      return;
    }
    shown.value = replayTo1(MOTION.progress, delay);
    return () => cancelAnimation(shown);
  }, [target, replay, delay, reduced, shown]);

  const animated = useAnimatedStyle(() => ({ width: `${target * shown.value * 100}%` }));

  return (
    <View
      style={[{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }, style]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}
    >
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: fill, overflow: 'hidden' }, animated]}>
        {sheen ? (
          <LinearGradient colors={[sheen, fill]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ flex: 1 }} />
        ) : null}
      </Animated.View>
    </View>
  );
}

// ── Depth ───────────────────────────────────────────────────────────────────

/**
 * What depth needs from a palette. Structural, so the app's own Palette
 * (lib/palettes.ts, which carries these roles) works as well as the identity's.
 */
export type DepthPalette = Pick<IdentityPalette, 'scheme' | 'shadow' | 'silverEdge'>;

/** One shadow layer, warm in light and gained up in dark. */
export function shadow(P: DepthPalette, s: Shadow): ViewStyle {
  const gain = P.scheme === 'dark' ? DARK_SHADOW_GAIN : 1;
  return {
    shadowColor: P.shadow,
    shadowOffset: { width: 0, height: s.y },
    shadowRadius: s.blur / 2,
    shadowOpacity: Math.min(s.opacity * gain, 0.9),
  };
}

/**
 * The two nested layers of a lifted surface. iOS draws one shadow per view, so
 * the ambient shadow sits on `outer` and the contact shadow on `inner`; both
 * carry the fill and the corner so each shadow follows the shape exactly.
 * `inner` also wears the silver edge. Lay content out inside `inner`.
 */
export function lift(
  P: DepthPalette,
  elevation: Elevation,
  fill: string,
  radius: number,
  edge: string | null = P.silverEdge
): { outer: ViewStyle; inner: ViewStyle } {
  const shape: ViewStyle = { backgroundColor: fill, borderRadius: radius, borderCurve: 'continuous' };
  return {
    outer: { ...shape, ...shadow(P, elevation[1]) },
    inner: {
      ...shape,
      ...shadow(P, elevation[0]),
      ...(edge ? { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: edge } : null),
    },
  };
}

/**
 * A card lifted off the page: layered warm shadow, a silver hairline edge.
 * `style` places the card (margins); `contentStyle` lays out what is in it.
 */
export function Surface({
  P,
  radius = RADIUS.card,
  elevation = ELEVATION.rest,
  style,
  contentStyle,
  children,
}: {
  P: IdentityPalette;
  radius?: number;
  elevation?: Elevation;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { outer, inner } = lift(P, elevation, P.surface, radius);
  return (
    <View style={[outer, style]}>
      <View style={[inner, contentStyle]}>{children}</View>
    </View>
  );
}
