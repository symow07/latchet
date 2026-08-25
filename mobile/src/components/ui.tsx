import {
  Text as RNText,
  View,
  Pressable,
  type TextProps,
  type ViewProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { F, R, glow, mix, useB, useC } from '@/lib/design';

/**
 * Reusable "bubbly modern" UI primitives. Purple-forward, rounded, frosted.
 */

type Weight = 'regular' | 'medium' | 'semibold' | 'bold';
const FAMILY: Record<Weight, string> = {
  regular: F.regular,
  medium: F.medium,
  semibold: F.semibold,
  bold: F.bold,
};

export function Txt({
  weight = 'medium',
  size = 14,
  color,
  style,
  children,
  ...rest
}: TextProps & {
  weight?: Weight;
  size?: number;
  color?: string;
}) {
  const C = useC();
  return (
    <RNText
      {...rest}
      style={[{ fontFamily: FAMILY[weight], fontSize: size, color: color ?? C.text, letterSpacing: 0.1 }, style]}
    >
      {children}
    </RNText>
  );
}

/** Frosted translucent card with a soft purple border and big radius. */
export function GlassCard({
  children,
  style,
  radius = R.lg,
  padding = 18,
  tint,
  border,
  glowColor,
  ...rest
}: ViewProps & {
  radius?: number;
  padding?: number;
  tint?: string;
  border?: string;
  glowColor?: string;
}) {
  const C = useC();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: tint ?? C.glass,
          borderRadius: radius,
          padding,
          borderWidth: 1,
          borderColor: border ?? C.glassBorder,
        },
        glowColor ? glow(glowColor, 0.25, 24, C.glowScale) : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A rounded "squircle" icon chip. */
export function IconBubble({
  children,
  color,
  size = 44,
  radius = 16,
  style,
}: {
  children: React.ReactNode;
  color?: string;
  size?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const C = useC();
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${color ?? C.p500}22`,
          borderWidth: 1,
          borderColor: `${color ?? C.p500}33`,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Small rounded label/tag. */
export function Pill({
  label,
  color,
  filled = false,
  style,
  textStyle,
}: {
  label: string;
  color?: string;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const C = useC();
  return (
    <View
      style={[
        {
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: R.pill,
          backgroundColor: filled ? (color ?? C.p400) : `${color ?? C.p400}1f`,
          borderWidth: filled ? 0 : 1,
          borderColor: `${color ?? C.p400}33`,
        },
        style,
      ]}
    >
      <Txt weight="bold" size={11} color={filled ? C.bgDeep : (color ?? C.p400)} style={textStyle}>
        {label}
      </Txt>
    </View>
  );
}

const AView = Animated.createAnimatedComponent(View);

/**
 * Squishy button with spring press feedback + haptics. Variants:
 *  - solid: purple gradient fill (primary)
 *  - soft:  translucent purple
 *  - ghost: bordered
 */
export function BubbleButton({
  label,
  onPress,
  icon,
  variant = 'solid',
  disabled = false,
  full = true,
  radius = R.md,
  colors,
  glowColor,
  accentColor,
  style,
}: {
  label: string;
  onPress?: () => void;
  icon?: React.ReactNode;
  variant?: 'solid' | 'soft' | 'ghost';
  disabled?: boolean;
  full?: boolean;
  radius?: number;
  /** gradient colors for the solid variant (theme override) */
  colors?: readonly [string, string, ...string[]];
  /** glow + soft/ghost border color */
  glowColor?: string;
  /** text color for soft/ghost variants */
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const C = useC();
  const fill = colors ?? ([C.p600, C.p500, C.p400] as const);
  const halo = glowColor ?? C.p500;
  const ink = accentColor ?? C.p300;
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const press = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress?.();
  };

  const inner = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 16,
        paddingHorizontal: 22,
      }}
    >
      {icon}
      <Txt weight="bold" size={16} color={variant === 'solid' ? '#fff' : ink}>
        {label}
      </Txt>
    </View>
  );

  return (
    <AView style={[full ? { width: '100%' } : null, aStyle, style, { opacity: disabled ? 0.5 : 1 }]}>
      <Pressable
        onPress={press}
        onPressIn={() => (scale.value = withSpring(0.96, { damping: 14, stiffness: 320 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 12, stiffness: 260 }))}
      >
        {variant === 'solid' ? (
          <LinearGradient
            colors={fill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[{ borderRadius: radius }, glow(halo, 0.5, 20, C.glowScale)]}
          >
            {inner}
          </LinearGradient>
        ) : (
          <View
            style={{
              borderRadius: radius,
              backgroundColor: variant === 'soft' ? `${halo}24` : 'transparent',
              borderWidth: 1.5,
              borderColor: `${halo}55`,
            }}
          >
            {inner}
          </View>
        )}
      </Pressable>
    </AView>
  );
}

/**
 * Full-screen atmospheric background: deep plum gradient + soft floating purple
 * blobs. Place as the first child of a screen with `flex: 1`.
 */
/**
 * Emoji, rendered in the system emoji font.
 *
 * Every other text component sets an explicit fontFamily (Plus Jakarta Sans),
 * and a font with no glyph for a codepoint renders a missing-glyph box rather
 * than falling back — which is why every emoji in the app showed as a tofu
 * square on device. Leaving fontFamily unset lets iOS pick Apple Color Emoji.
 *
 * Use this for emoji that are *data* — the category icons, and the palette a
 * user picks from when creating their own category. Decorative emoji in copy
 * were removed rather than wrapped.
 */
export function Emoji({ children, size = 15, style }: { children?: React.ReactNode; size?: number; style?: StyleProp<TextStyle> }) {
  return <RNText style={[{ fontSize: size }, style]}>{children}</RNText>;
}

/**
 * The panel a screen shows instead of a list, a chart or a score when there is
 * nothing to put in it.
 *
 * Every screen grew its own version of this — same icon bubble, same bold
 * title, same dim body, five slightly different paddings and two of them with
 * untranslated English baked in. One component means the copy is the only
 * thing a screen has to decide.
 *
 * `action` matters more than it looks: an empty state that only apologises
 * leaves the user to work out what to do next, which on a finance app's first
 * run is the whole job.
 */
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  accent,
  compact = false,
  style,
}: {
  /** A lucide icon element, e.g. <Inbox size={38} color={C.textFaint} />. */
  icon: React.ReactNode;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  accent?: string;
  /** Tighter spacing, for an empty card rather than an empty screen. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const C = useC();
  const hue = accent ?? C.p500;
  const bubble = compact ? 56 : 84;
  return (
    <View
      className="items-center justify-center"
      style={[{ paddingVertical: compact ? 28 : 70, paddingHorizontal: 24 }, style]}
    >
      <View
        style={{
          width: bubble,
          height: bubble,
          borderRadius: bubble / 3,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: compact ? 12 : 16,
          backgroundColor: `${hue}1f`,
          borderWidth: 1,
          borderColor: `${hue}2e`,
        }}
      >
        {icon}
      </View>
      <Txt weight="bold" size={compact ? 15 : 18} color={C.text} style={{ marginBottom: 6, textAlign: 'center' }}>
        {title}
      </Txt>
      {body ? (
        <Txt size={13} color={C.textFaint} style={{ textAlign: 'center', lineHeight: 19 }}>
          {body}
        </Txt>
      ) : null}
      {actionLabel && onAction ? (
        <BubbleButton
          label={actionLabel}
          onPress={onAction}
          variant="soft"
          full={false}
          glowColor={hue}
          accentColor={hue}
          style={{ marginTop: compact ? 14 : 20 }}
        />
      ) : null}
    </View>
  );
}

export function ScreenBackground({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const C = useC();
  return (
    // No backgroundColor: the gradient below covers the same box, so painting a
    // fill first is a whole extra screen of overdraw nothing ever sees.
    <View style={[{ flex: 1 }, style]}>
      {/* Purple atmosphere via static gradient washes — no per-frame shadow
          rasterization (large shadowRadius blobs caused scroll jank on device).
          The lower wash used to be a second full-width layer stacked on this
          one; it is now folded into the last stop, which is the same pixels
          with one less layer to composite while the page scrolls under it. */}
      <LinearGradient
        colors={[C.bgDeep, C.bg, mix(C.bg, C.bgFoot, 0.67), mix(C.bgFoot, C.p800, 0.086)]}
        // The wash this replaces lived in a 420pt box pinned to the bottom with
        // its own start/end as fractions of that box, so it held at zero for
        // most of the screen and only tinted the very bottom.
        //
        // These two numbers are fitted to what that stack actually rendered,
        // not derived from its geometry: the box is laid out against a
        // container taller than the visible screen, so the ramp starts lower
        // (0.835, not the 0.76 the arithmetic predicts) and never reaches its
        // end colour (0.086 of the way to p800, not the nominal 0.149).
        // Sampling the built app was the only way to see that. Verified
        // against the pre-fold build at ten heights; worst channel 1/255.
        locations={[0, 0.5, 0.835, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* Kept separate: this one runs diagonally, so it cannot fold into a
          vertical ramp. */}
      <LinearGradient
        colors={[`${C.p600}3a`, `${C.p600}00`]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 0.45 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 380 }}
      />
      {children}
    </View>
  );
}

/**
 * Professional business background: deep navy gradient with a single restrained
 * accent glow at the top. Intentionally calmer/more structured than the playful
 * personal ScreenBackground.
 */
export function BizBackground({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const B = useB();
  return (
    <View style={[{ flex: 1 }, style]}>
      <LinearGradient
        colors={[B.slate900, B.bg, B.bgDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* one calm accent wash near the top */}
      <LinearGradient
        colors={[`${B.accent}22`, `${B.accent}00`]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 0.5 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320 }}
      />
      {children}
    </View>
  );
}

