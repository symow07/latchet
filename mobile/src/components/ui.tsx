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
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { F, R, S, SHADOW, useB, useC } from '@/lib/design';

/**
 * The previous component set — deprecated in favour of components/kit.tsx.
 *
 * These were authored for the dark, purple-forward, frosted direction. That
 * direction is gone (DESIGN-PROMPT.md §1, "what to leave behind"), but ~24
 * screens still import from here, and converting all of them at once is not
 * the same task as making them presentable.
 *
 * So each primitive below has been re-pointed at the calm language: flat bone
 * ground, white cards separated by soft shadow rather than by a tinted 1.5px
 * border, ink instead of gradient-and-glow. A screen that has not been
 * individually redesigned still lands somewhere coherent, and the ones that
 * have been converted are strictly better than the ones that haven't rather
 * than merely different from them.
 *
 * Do not add new uses. New screens import from kit.tsx.
 */

type Weight = 'regular' | 'medium' | 'semibold' | 'bold';
const FAMILY = F;

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
      style={[{ ...FAMILY[weight], fontSize: size, color: color ?? C.text, letterSpacing: 0.1 }, style]}
    >
      {children}
    </RNText>
  );
}

/**
 * A card. White and floating by default; a flat wash when tinted.
 *
 * `border` and `glowColor` are accepted and ignored. Roughly forty call sites
 * pass a tinted fill with a matching 1.5px coloured border, and that pairing
 * is most of why the unconverted screens read as cheap — a screen of six
 * outlined pastel boxes has six things competing to be looked at and no
 * hierarchy at all. §1.5 is explicit: separate surfaces with soft shadow, and
 * keep a hairline for where two white surfaces actually touch.
 *
 * `tint` is still honoured, because it is mostly carrying *state* — over
 * budget, urgent, paid, selected — and dropping it would delete meaning
 * rather than decoration. A tinted card renders flat, exactly as the kit's
 * selected `ChoiceRow` does: a raised shadow under a coloured wash reads as
 * two different claims about the same surface.
 */
export function GlassCard({
  children,
  style,
  radius = R.md,
  padding = S.card,
  tint,
  border: _border,
  glowColor: _glowColor,
  ...rest
}: ViewProps & {
  radius?: number;
  padding?: number;
  tint?: string;
  /** @deprecated Ignored — §1.5 separates surfaces with shadow, not borders. */
  border?: string;
  /** @deprecated Ignored — the calm direction has no glows. */
  glowColor?: string;
}) {
  const C = useC();
  return (
    <View
      {...rest}
      style={[
        tint ? null : SHADOW.near,
        {
          backgroundColor: tint ?? C.groundAlt,
          borderRadius: radius,
          padding,
        },
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
          // No border. A pale fill already separates the chip from a white
          // card; outlining it as well makes a 44px square shout (§1.6).
          backgroundColor: `${color ?? C.accent}1f`,
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
          backgroundColor: filled ? (color ?? C.accent) : `${color ?? C.accent}1a`,
        },
        style,
      ]}
    >
      {/* 13/18 medium — §3 defines eight sizes and none of them is a tracked
          11px caption. The tags that used one all read as a dashboard. */}
      <Txt weight="semibold" size={13} color={filled ? C.onAccent : (color ?? C.accent)} style={textStyle}>
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
  radius: _radius = R.md,
  colors,
  glowColor: _glowColor,
  accentColor,
  style,
}: {
  label: string;
  onPress?: () => void;
  icon?: React.ReactNode;
  variant?: 'solid' | 'soft' | 'ghost';
  disabled?: boolean;
  full?: boolean;
  /** @deprecated Ignored — every button in the calm direction is a pill. */
  radius?: number;
  /**
   * Only the first stop is used, as a flat fill. §1.10 spends the screen's one
   * gradient on the dark balance card, so a button never gets one.
   */
  colors?: readonly [string, string, ...string[]];
  /** @deprecated Ignored — the calm direction has no glows. */
  glowColor?: string;
  /** text color for soft/ghost variants */
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const C = useC();
  // `colors` used to be a three-stop gradient. §1.10 allows one gradient
  // moment per screen and puts it on the dark balance card, so a button is
  // never it: the first stop becomes a flat fill and the rest are dropped.
  const solidFill = colors ? colors[0] : C.ink;
  const ink = accentColor ?? C.accent;
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
      <Txt weight="semibold" size={17} color={variant === 'solid' ? C.onInk : ink}>
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
          // §6.11: a full-width ink pill. The old solid was a purple gradient
          // wearing a coloured glow, which is the single loudest object the
          // previous direction had.
          <View style={[SHADOW.near, { borderRadius: R.pill, backgroundColor: solidFill }]}>
            {inner}
          </View>
        ) : (
          // Secondary: a white pill with a hairline. The tinted fill and the
          // 1.5px accent border both go — a button next to an ink one does not
          // need to argue for itself.
          <View
            style={[
              variant === 'soft' ? SHADOW.near : null,
              {
                borderRadius: R.pill,
                backgroundColor: variant === 'soft' ? C.groundAlt : 'transparent',
                borderWidth: 1,
                borderColor: C.hairline,
              },
            ]}
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

/**
 * The screen. A flat bone ground and nothing else.
 *
 * This used to paint four gradient layers: a plum vertical ramp fitted stop by
 * stop against a sampled build, plus a 380pt purple wash across the top. All
 * of it was atmosphere for a dark theme that no longer exists, and on the bone
 * ground it read as a stain over the top third of every screen it touched.
 *
 * §1 lists what to leave behind: no glows, no grain, no saturated washes. The
 * ground is the ground. Deleting the layers also removes two full-screen
 * gradients from the composite of twenty-four screens.
 *
 * Kept as a component rather than inlined because those screens still call it,
 * and because it is the one place their background is decided. Prefer
 * `Screen` from kit.tsx, which also applies the safe-area inset; this one does
 * not, since its callers apply `insets.top` themselves.
 */
export function ScreenBackground({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const C = useC();
  return <View style={[{ flex: 1, backgroundColor: C.ground }, style]}>{children}</View>;
}

/**
 * The same ground, mint side.
 *
 * §0: the two profiles share one neutral ground and differ only in a quiet
 * accent hue — switching profiles should feel like changing rooms in the same
 * house. A navy-to-green gradient on one side and a plum one on the other made
 * them two different apps that happened to share a login.
 */
export function BizBackground({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const B = useB();
  return <View style={[{ flex: 1, backgroundColor: B.ground }, style]}>{children}</View>;
}

