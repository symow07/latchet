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
import { C, B, F, R, glow } from '@/lib/design';

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
  color = C.text,
  style,
  children,
  ...rest
}: TextProps & {
  weight?: Weight;
  size?: number;
  color?: string;
}) {
  return (
    <RNText
      {...rest}
      style={[{ fontFamily: FAMILY[weight], fontSize: size, color, letterSpacing: 0.1 }, style]}
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
  tint = C.glass,
  border = C.glassBorder,
  glowColor,
  ...rest
}: ViewProps & {
  radius?: number;
  padding?: number;
  tint?: string;
  border?: string;
  glowColor?: string;
}) {
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: tint,
          borderRadius: radius,
          padding,
          borderWidth: 1,
          borderColor: border,
        },
        glowColor ? glow(glowColor, 0.25, 24) : null,
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
  color = C.p500,
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
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${color}22`,
          borderWidth: 1,
          borderColor: `${color}33`,
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
  color = C.p400,
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
  return (
    <View
      style={[
        {
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: R.pill,
          backgroundColor: filled ? color : `${color}1f`,
          borderWidth: filled ? 0 : 1,
          borderColor: `${color}33`,
        },
        style,
      ]}
    >
      <Txt weight="bold" size={11} color={filled ? '#1a0b2e' : color} style={textStyle}>
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
  colors = [C.p600, C.p500, C.p400],
  glowColor = C.p500,
  accentColor = C.p300,
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
      <Txt weight="bold" size={16} color={variant === 'solid' ? '#fff' : accentColor}>
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
            colors={colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[{ borderRadius: radius }, glow(glowColor, 0.5, 20)]}
          >
            {inner}
          </LinearGradient>
        ) : (
          <View
            style={{
              borderRadius: radius,
              backgroundColor: variant === 'soft' ? `${glowColor}24` : 'transparent',
              borderWidth: 1.5,
              borderColor: `${glowColor}55`,
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
export function ScreenBackground({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flex: 1, backgroundColor: C.bg }, style]}>
      <LinearGradient
        colors={[C.bgDeep, C.bg, '#120a20']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* floating blobs */}
      <Blob color={C.p600} size={300} top={-90} left={-70} opacity={0.4} />
      <Blob color={C.p400} size={240} top={120} left={240} opacity={0.22} />
      <Blob color={C.p800} size={360} top={520} left={-120} opacity={0.3} />
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
  return (
    <View style={[{ flex: 1, backgroundColor: B.bg }, style]}>
      <LinearGradient
        colors={[B.slate900, B.bg, B.bgDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* one calm accent wash near the top */}
      <LinearGradient
        colors={[`${B.accent}22`, 'transparent']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 0.5 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320 }}
      />
      {children}
    </View>
  );
}

function Blob({
  color,
  size,
  top,
  left,
  opacity,
}: {
  color: string;
  size: number;
  top: number;
  left: number;
  opacity: number;
}) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        // big soft shadow fakes a blurred glow cheaply on both platforms
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 80,
      }}
    />
  );
}
