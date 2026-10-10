/**
 * The component set — DESIGN-PROMPT.md §6.
 *
 * This is the calm direction: one neutral ground, white cards separated by
 * soft shadow rather than borders, one dark object per screen, prose over
 * data. Both profiles share every component here and differ only in the
 * accent they are handed, so a screen reads `useC()` or `useB()` and passes
 * the palette down without any component knowing which profile is active.
 *
 * Every screen imports from here. The previous set, ui.tsx, was deleted once
 * the last screen moved off it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  I18nManager,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text as RNText,
  TextInput,
  View,
  Pressable,
  Switch,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronLeft, ChevronRight, Delete, Trash2 } from '@/components/icons';
import {
  SPRING_FLICK,
  SPRING_MOVE,
  SPRING_SHEET,
  TILE_GLINT_MS,
  amountScale,
  currencyParts,
  project,
  rubberband,
  splitAmount,
} from '@/lib/motion';
import { PressableScale } from '@/components/motion';
import { F, R, S, T, SHADOW, type Palette, type BizPalette } from '@/lib/design';
import { MESH_ALPHA, TILE_PRESS_ALPHA } from '@/lib/palettes';

/** Either profile's palette. Every component here takes one and asks nothing else. */
export type Pal = Palette | BizPalette;

/**
 * A tiling film grain, laid over a coloured surface.
 *
 * This is the difference between a gradient and a material. A three-stop ramp
 * interpolated by the GPU is mathematically smooth, and mathematically smooth
 * is exactly what reads as cheap: flat, plasticky, and on a wide surface
 * visibly banded. Every expensive-looking gradient in the references has grain
 * over it, and it is doing most of the work.
 *
 * Bidirectional — the texture carries both white and black pixels — so it
 * breaks the ramp up in both directions rather than fogging it with a haze.
 * 128px and purely high-frequency, so it tiles without a seam.
 */
const GRAIN = require('../../assets/grain.png');

function Grain({ opacity, radius }: { opacity: number; radius?: number }) {
  return (
    <Image
      source={GRAIN}
      resizeMode="repeat"
      style={[StyleSheet.absoluteFill, { opacity, borderRadius: radius }]}
    />
  );
}

/** `#RRGGBB` plus an alpha channel, as the 8-digit hex RN accepts. */
function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0')}`;
}

/** Mirror a directional glyph under RTL (§7 — all chevrons must mirror). */
/**
 * Mirror a directional glyph under RTL (§7 — all chevrons must mirror).
 *
 * A half-turn, not `scaleX: -1`. Every glyph this is applied to — the
 * chevrons, the backspace — points horizontally and is symmetric about that
 * axis, so the two are visually identical for them. The difference is that
 * react-native-svg renders the icon into its own coordinate space, and a
 * negative scale there flips the drawing out of its viewport rather than
 * about its centre: the back chevron simply vanished, leaving a blank white
 * circle where the only way off the screen should be. A rotation turns about
 * the centre and stays in bounds.
 */
export const mirror = {
  transform: [{ rotate: I18nManager.isRTL ? '180deg' : '0deg' }],
} as const;

// ── Type (§3) ────────────────────────────────────────────────────────────────

type Role = keyof typeof T;

/**
 * Text at one of the eight sizes. There is no ninth: a screen that needs one
 * is a screen doing too much.
 */
export function Type({
  role = 'body',
  color,
  style,
  children,
  ...rest
}: {
  role?: Role;
  color?: string;
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
  numberOfLines?: number;
}) {
  const spec = T[role];
  return (
    <RNText
      {...rest}
      style={[
        {
          ...F[spec.weight],
          fontSize: spec.fontSize,
          lineHeight: spec.lineHeight,
          letterSpacing: spec.letterSpacing,
          color,
        },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

/**
 * The screen. A flat bone ground and nothing else — no gradient wash, no
 * bloom, no grain (§1, "what to leave behind").
 */
export function Screen({
  pal,
  children,
  plain = false,
  style,
}: {
  pal: Pal;
  children?: React.ReactNode;
  /** Drop the ambient wash, for a screen that is already carrying a large
   *  coloured surface of its own. */
  plain?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, backgroundColor: pal.ground, paddingTop: insets.top }, style]}>
      {/* Two blooms, no shapes.
          A flat bone field reads as paper stock; these give it somewhere for
          light to be coming from, which is most of what "cosy" means on a
          light ground. They are full-bleed linear gradients rather than
          circles on purpose — a `borderRadius` blob always ends on a visible
          arc, and an edge is exactly what an atmosphere must not have.
          Each fades to nothing well before the middle, so the strength lives
          in the corners and the region that carries text stays near-bone. */}
      {plain ? null : (
        <>
          <LinearGradient
            colors={[withAlpha(pal.mesh[0], MESH_ALPHA[0]), withAlpha(pal.mesh[0], 0)] as const}
            locations={[0, 0.45]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0.1, y: 0.75 }}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[withAlpha(pal.mesh[1], MESH_ALPHA[1]), withAlpha(pal.mesh[1], 0)] as const}
            locations={[0, 0.42]}
            start={{ x: 0, y: 1 }}
            end={{ x: 0.85, y: 0.25 }}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          />
        </>
      )}
      {/* The same texture at a whisper. A bone field with nothing in it is
          the other half of why this read as flat — paper has tooth. */}
      {plain ? null : <Grain opacity={0.035} />}
      {children}
    </View>
  );
}

/**
 * A white card floating on the ground.
 *
 * React Native paints one shadow per view, and §1.5 specifies two. The outer
 * view carries the far shadow and the inner the near one; the fill sits on
 * the inner so the two shadows stack around a single visible edge.
 */
export function Card({
  pal,
  children,
  radius = R.md,
  padding = S.card,
  style,
  contentStyle,
}: {
  pal: Pal;
  children?: React.ReactNode;
  radius?: number;
  padding?: number;
  /** Positions the card. Applied to the outer wrapper. */
  style?: StyleProp<ViewStyle>;
  /**
   * Applied to the white surface itself — use this for padding, not `style`.
   * `style` sits on the shadow wrapper, so padding there insets the card
   * rather than its contents, which reads as a mysteriously narrow card.
   */
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[SHADOW.far, { borderRadius: radius }, style]}>
      <View
        style={[
          SHADOW.near,
          {
            backgroundColor: pal.groundAlt,
            borderRadius: radius,
            padding,
            // §1.5 reserves borders for where two white surfaces touch, and
            // that rule is why these looked soft. `groundAlt` is #FFFFFF and
            // the ground is #F7F5F1 — a three percent step. A shadow alone
            // cannot define an edge across that little luminance, so the cards
            // read as blurred patches rather than as objects sitting on
            // something. One hairline is what turns a patch into a card.
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: pal.hairline,
            // Clips a row's press wash to the card's corners. Only the inner
            // view clips; the shadows live on the wrapper outside it.
            overflow: 'hidden',
          },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

// ── Numbers (§1.8, §3) ───────────────────────────────────────────────────────

/**
 * An amount, set to the number rules.
 *
 * Decimals stay the same size and drop to 55% opacity; the currency symbol is
 * 65% size and raised toward the cap line. Tabular figures throughout, so a
 * column of amounts aligns.
 *
 * The symbol's position comes from the locale, not from a guess: currencyParts
 * formats probe values and reads back where the symbol landed, which is how
 * "1 234,56 €" keeps its trailing symbol and its comma decimal.
 *
 * `signed` prints an explicit + or −. §3 requires a sign on every transaction
 * amount rather than relying on colour, which is also what makes the red/green
 * readable to someone who cannot tell them apart.
 */
export function Amount({
  value,
  format,
  size: requested = 40,
  color,
  signed = false,
  weight = 'bold',
  maxChars = 11,
  style,
}: {
  value: number;
  /** The screen's own formatter — locale, currency symbol and all. */
  format: (n: number) => string;
  size?: number;
  /**
   * Roughly how many characters fit where this is being used. Past it the
   * figure shrinks rather than overflowing — see `amountScale`.
   */
  maxChars?: number;
  color?: string;
  signed?: boolean;
  weight?: keyof typeof F;
  style?: StyleProp<ViewStyle>;
}) {
  const parts = useMemo(() => currencyParts(format), [format]);
  const { sign, prefix, whole, fraction, suffix } = splitAmount(value, parts, signed);

  const size =
    requested *
    amountScale(sign.length + prefix.length + whole.length + fraction.length + suffix.length, maxChars);

  const big: TextStyle = {
    ...F[weight],
    fontSize: size,
    lineHeight: size * 1.1,
    letterSpacing: size * -0.02,
    color,
    fontVariant: ['tabular-nums'],
  };
  // 65% size, lifted toward the cap line rather than sitting on the baseline.
  // The offset is tuned by eye against Plus Jakarta Sans at display sizes; it
  // scales with the number so it holds at 17px and at 40px.
  const symbol: TextStyle = {
    ...big,
    fontSize: size * 0.65,
    lineHeight: size * 0.72,
    marginTop: size * 0.12,
  };

  return (
    <View
      style={[
        {
          // `row` is mirrored by the layout engine under RTL, which reverses
          // the pieces this component just carefully split apart — a Yen
          // balance rendered as ".000¥". Numbers do not mirror in any script:
          // Arabic runs right-to-left but its digits still read left-to-right,
          // so the row has to counteract the flip rather than inherit it.
          flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
          alignItems: 'flex-start',
        },
        style,
      ]}
    >
      {sign ? <RNText style={big}>{sign}</RNText> : null}
      {prefix ? <RNText style={symbol}>{prefix}</RNText> : null}
      <RNText style={big}>{whole}</RNText>
      {/* Same size, 55% opacity — §3. Not a smaller font: shrinking the cents
          makes a column of amounts stop aligning. */}
      {fraction ? <RNText style={[big, { opacity: 0.55 }]}>{fraction}</RNText> : null}
      {suffix ? (
        <RNText style={[symbol, { marginStart: size * 0.08 }]}>{suffix}</RNText>
      ) : null}
    </View>
  );
}

// ── Header (§6.12) ───────────────────────────────────────────────────────────

/** A 40px white circle carrying one thin-stroke icon. */
export function CircleAction({
  pal,
  children,
  onPress,
  size = 40,
  label,
}: {
  pal: Pal;
  children: React.ReactNode;
  onPress?: () => void;
  size?: number;
  /** Screen-reader name. A bare icon has none otherwise. */
  label: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // §7: ≥44×44pt. The circle is 40, so the hit box is widened rather than
      // the circle, which would break the header's rhythm.
      hitSlop={Math.max(0, (44 - size) / 2)}
      style={[
        SHADOW.near,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: pal.groundAlt,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: pal.hairline,
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
    >
      {children}
    </PressableScale>
  );
}

/** Screen title left, up to two circle actions right. */
/**
 * A screen's top row: what this is, and what you can do to it.
 *
 * `role` exists because the title is not always the headline. On a screen whose
 * subject is a number — either home — the top row holds a *greeting*, and at
 * `title` that greeting was 32px bold over two lines: the largest thing on
 * screen was the least useful information on it, and the balance underneath had
 * to compete with it. Those screens pass `section` and get out of the hero's
 * way. A screen the title genuinely names keeps the default.
 *
 * Personal home briefly hand-rolled this row to escape the hardcoded `title`,
 * which fixed one screen and left business home with the same inverted
 * hierarchy. One prop here fixes both.
 */
export function Header({
  pal,
  title,
  subtitle,
  actions,
  role = 'title',
  style,
}: {
  pal: Pal;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** Demote to `section` when the title is a greeting rather than the subject. */
  role?: 'title' | 'section';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: S.screen,
          gap: 12,
        },
        style,
      ]}
    >
      <View style={{ flex: 1 }}>
        {subtitle ? (
          <Type role="meta" color={pal.inkDim} style={{ marginBottom: 2 }}>
            {subtitle}
          </Type>
        ) : null}
        <Type
          role={role}
          color={role === 'section' ? pal.inkDim : pal.ink}
          // A demoted greeting wraps to two lines on a long name and pushes the
          // hero down the screen; it is the one line here that may be clipped.
          numberOfLines={role === 'section' ? 1 : undefined}
        >
          {title}
        </Type>
      </View>
      {actions ? <View style={{ flexDirection: 'row', gap: 10 }}>{actions}</View> : null}
    </View>
  );
}

/** A 20px bold section header, sitting directly on the ground. */
export function SectionHeader({
  pal,
  title,
  actionLabel,
  onAction,
  style,
}: {
  pal: Pal;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: S.screen,
          marginBottom: 12,
        },
        style,
      ]}
    >
      <Type role="section" color={pal.ink}>
        {title}
      </Type>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button">
          <Type role="meta" color={pal.accent}>
            {actionLabel}
          </Type>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Buttons (§6.11) ──────────────────────────────────────────────────────────

/**
 * Full-width ink pill, 56pt tall.
 *
 * `accent` fills with the profile's accent instead of ink — for the one place
 * a screen wants the CTA to carry the hue rather than the neutral.
 */
export function PrimaryButton({
  pal,
  label,
  onPress,
  variant = 'ink',
  disabled = false,
  style,
}: {
  pal: Pal;
  label: string;
  onPress?: () => void;
  variant?: 'ink' | 'accent' | 'secondary';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  /**
   * Disabled is its own pair of tokens, not the enabled pair at 40% opacity.
   *
   * Fading the whole pill fades the label with it — an ink fill at 0.4 over
   * bone is a mid grey, and white text at 0.4 on that mid grey is close to
   * unreadable. It also stops reading as "disabled" and starts reading as a
   * *differently styled* button, which is worse than either.
   *
   * A sunk fill with a faint label is inert on sight and still legible, and it
   * is the same "off" pair `FilterChip` and the keypad already use.
   */
  const fill = disabled
    ? pal.groundSunk
    : variant === 'secondary'
      ? pal.groundAlt
      : variant === 'accent'
        ? pal.accent
        : pal.ink;
  const label_ = disabled
    ? pal.inkFaint
    : variant === 'secondary'
      ? pal.ink
      : variant === 'accent'
        ? pal.onAccent
        : pal.onInk;
  // The caller's layout goes on a plain View, not on the PressableScale.
  // PressableScale wraps its Pressable in an Animated.View that carries only
  // the press transform, so a width, a flex or an alignSelf passed to it lands
  // on the inner element inside a parent that has already shrink-wrapped —
  // which silently turned this "full-width pill" (§6.11) into one the width of
  // its own label.
  return (
    <View style={style}>
      <PressableScale
        onPress={disabled ? undefined : onPress}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={[
          SHADOW.near,
          {
            height: 56,
            borderRadius: R.pill,
            backgroundColor: fill,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: variant === 'secondary' && !disabled ? 1 : 0,
            borderColor: pal.hairline,
          },
        ]}
      >
        <Type role="cardTitle" color={label_}>
          {label}
        </Type>
      </PressableScale>
    </View>
  );
}

/**
 * A white pill with a hairline — the suggested reply, and the action chip
 * under an insight (§6.4).
 */
export function Chip({
  pal,
  label,
  onPress,
  style,
}: {
  pal: Pal;
  label: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        SHADOW.near,
        {
          minHeight: 44, // §7 touch target
          justifyContent: 'center',
          paddingHorizontal: 16,
          borderRadius: R.pill,
          backgroundColor: pal.groundAlt,
          borderWidth: 1,
          borderColor: pal.hairline,
        },
        style,
      ]}
    >
      <Type role="meta" color={pal.ink}>
        {label}
      </Type>
    </PressableScale>
  );
}

/**
 * Segmented toggle (§6.5). Active is a solid ink pill with a soft shadow;
 * inactive is plain text on the ground with no chrome at all.
 *
 * The pill *slides*. A control whose highlight teleports between positions
 * tells you the selection changed; one that travels tells you which way it
 * went, and that is the whole difference between a toggle you have to read
 * and one you can feel. It is also the cheapest place in the app to spend a
 * spring — one transform, on the compositor, on a control people tap
 * constantly.
 *
 * Critically damped, because a tap carries no momentum. Apple's rule is that
 * overshoot is earned by a gesture that threw something — a flick, a drag
 * release — and a discrete tap threw nothing, so bounce here would read as a
 * tic rather than as physics. (DESIGN-PROMPT §4 asked for damping 20 /
 * stiffness 250, a ratio of 0.63; the brief predates this rule and the rule
 * wins.)
 *
 * The pill is measured, not laid out: it is one absolutely-positioned view
 * translated across the row, so there is a single element moving rather than
 * n backgrounds cross-fading.
 */
export function Segmented<Key extends string>({
  pal,
  options,
  value,
  onChange,
  style,
}: {
  pal: Pal;
  options: readonly { key: Key; label: string }[];
  value: Key;
  onChange: (key: Key) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  // The first measurement must place the pill, not animate it there — a
  // control that slides in from the left on mount is announcing itself.
  const placed = useRef(false);

  const index = Math.max(0, options.findIndex((o) => o.key === value));
  const seg = width > 0 ? width / options.length : 0;
  // translateX is not mirrored by the layout engine the way `flexDirection`
  // is, so under RTL the pill has to travel the other way itself (§7).
  const dir = I18nManager.isRTL ? -1 : 1;

  useEffect(() => {
    if (seg === 0) return;
    const target = dir * index * seg;
    if (!placed.current || reduced) {
      placed.current = true;
      x.value = target;
      return;
    }
    x.value = withSpring(target, SPRING_MOVE);
  }, [index, seg, dir, reduced, x]);

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[{ flexDirection: 'row' }, style]}
    >
      {seg > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            SHADOW.near,
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              start: 0,
              width: seg,
              borderRadius: R.pill,
              backgroundColor: pal.ink,
            },
            pillStyle,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              if (!active) Haptics.selectionAsync();
              onChange(o.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Type role="meta" color={active ? pal.onInk : pal.inkDim} numberOfLines={1}>
              {o.label}
            </Type>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Fields ──────────────────────────────────────────────────────────────────

/**
 * A labelled input.
 *
 * The well is `groundSunk` rather than a bordered box: §1.5 uses shadow and
 * surface to separate things, and reserves a hairline for where two white
 * surfaces touch. The label is sentence case at meta size — §3 has no
 * uppercase caption style, and the screens that used one read as a dashboard.
 */
export function Field({
  pal,
  label,
  icon,
  trailing,
  style,
  ...input
}: TextInputProps & {
  pal: Pal;
  /**
   * Omitted for a search field, where the placeholder already names the
   * control and a label above it would be the same word twice.
   */
  label?: string;
  icon?: React.ReactNode;
  /** A reveal toggle, a unit, a clear button. */
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      {label ? (
        <Type role="meta" color={pal.inkDim} style={{ marginBottom: 8 }}>
          {label}
        </Type>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          // A multiline well grows downward, so its icon and trailing slot sit
          // at the first line rather than floating in the middle of a
          // half-filled paragraph.
          alignItems: input.multiline ? 'flex-start' : 'center',
          gap: 12,
          minHeight: input.multiline ? 96 : 56,
          paddingHorizontal: 16,
          borderRadius: R.md,
          backgroundColor: pal.groundSunk,
        }}
      >
        {icon}
        <TextInput
          {...input}
          placeholderTextColor={pal.inkFaint}
          selectionColor={pal.accent}
          style={{
            flex: 1,
            ...F.regular,
            fontSize: 16,
            color: pal.ink,
            // Without this the field is ~20pt tall on Android and the icon
            // floats beside a text box that is not there.
            paddingVertical: 14,
            // Android centres multiline text vertically without this, so a
            // one-line answer sits in the middle of an empty box.
            ...(input.multiline ? { textAlignVertical: 'top' as const, lineHeight: 22 } : null),
          }}
        />
        {trailing}
      </View>
    </View>
  );
}

/** One line of error text beneath a form. Never colour alone — it is prose. */
export function FormError({ pal, message }: { pal: Pal; message: string }) {
  if (!message) return null;
  return (
    <Type role="meta" color={pal.negative} style={{ marginTop: 4 }}>
      {message}
    </Type>
  );
}

// ── Balance card (§6.1) ──────────────────────────────────────────────────────

/**
 * The one dark object.
 *
 * Everything else on the screen is white, bone or grey; this is where the eye
 * lands (§1.1). It carries the single gradient moment, which bleeds off a
 * corner and never sits behind text — and which lives here rather than on the
 * ground because `accentGlow` is 1.60:1 (mint) against bone and would simply
 * not be visible there (§2.3.1).
 *
 * In dark mode `inkSoft` is a bone colour and `onInk` is near-black, so the
 * same component becomes the one *light* object without a branch.
 */
export function BalanceCard({
  pal,
  label,
  amount,
  format,
  caption,
  badge,
  onPress,
  plain = false,
  style,
}: {
  pal: Pal;
  label: string;
  amount: number;
  format: (n: number) => string;
  caption?: string;
  /** The small brand mark in the corner. */
  badge?: React.ReactNode;
  onPress?: () => void;
  /**
   * Drop the gradient arc. §1.10 allows one gradient moment per screen, so in
   * a carousel only the first card carries it — repeating it on every card
   * turns the one moment into a pattern.
   */
  plain?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const body = (
    <LinearGradient
      colors={pal.heroGradient as unknown as readonly [string, string, string]}
      // Along the diagonal, deep end under the text. The label, the amount and
      // the caption all live top-left; the vivid end is thrown to the far
      // corner where nothing is written — and held to the last quarter, so it
      // reads as light falling on a dark surface rather than as a purple card.
      locations={[0, 0.74, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        SHADOW.far,
        {
          borderRadius: R.lg,
          padding: S.card + 2,
          overflow: 'hidden',
          // §12: "a bright top edge = light catching the material". The brief
          // asked for this and nothing had implemented it. One hairline is the
          // whole difference between a coloured rectangle and an object with a
          // lit surface.
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.22)',
        },
      ]}
    >
      {/* Sheen, then grain — in that order, so the texture sits over both the
          ramp and the highlight rather than under one of them. */}
      <LinearGradient
        colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0.00)'] as const}
        locations={[0, 0.55]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <Grain opacity={0.09} />
      {/* The gradient moment: one arc, clipped by the card's corner,
          decorative, never behind the number.

          The first stop is the gradient's own first colour at zero alpha, so
          the disc dissolves into the card instead of ending on a circular
          edge. Without it the arc reads as a solid half-circle stamped on the
          corner — the shape is only "an arc bleeding off" (§1.10) if the side
          facing the card has no edge at all. The dense end sits off the
          top-right corner, where `overflow: hidden` cuts it. */}
      {plain ? null : <LinearGradient
        // Ordered corner-first: the brightest stop sits off the top-right and
        // the last one is the darkest stop at zero alpha, so the wash reaches
        // nothing before it gets anywhere near the number on the left.
        colors={[pal.gradient[2], pal.gradient[1], `${pal.gradient[0]}00`] as const}
        // Wound tight to the corner. The card is far wider than it is tall, so
        // a diagonal covers a lot of width per unit of progress — at even a
        // third of the way across, the wash stops being a moment and becomes a
        // second surface.
        locations={[0, 0.06, 0.28]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, opacity: 0.75 }}
      />}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <Type role="meta" color={pal.onHero} style={{ opacity: 0.78 }}>
          {label}
        </Type>
        {badge}
      </View>
      <Amount value={amount} format={format} size={40} color={pal.onHero} />
      {caption ? (
        <Type role="meta" color={pal.onHero} style={{ opacity: 0.78, marginTop: 6 }}>
          {caption}
        </Type>
      ) : null}
    </LinearGradient>
  );

  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <View style={style}>
      <PressableScale onPress={onPress} accessibilityRole="button">
        {body}
      </PressableScale>
    </View>
  );
}

// ── Budget line (§6.2) ───────────────────────────────────────────────────────

/**
 * One sentence and one 6px track. No segments, no percentage ring.
 *
 * The three states are the whole point: `comfortable` reads in the accent,
 * `close` in warning, `over` in negative — but the sentence says which it is
 * too, so the state does not depend on telling the colours apart.
 */
export function BudgetLine({
  pal,
  sentence,
  spent,
  budget,
  style,
}: {
  pal: Pal;
  /** Written by the caller, e.g. "$840 left of $1,200 this month." */
  sentence: string;
  spent: number;
  budget: number;
  style?: StyleProp<ViewStyle>;
}) {
  const ratio = budget > 0 ? Math.min(1, Math.max(0, spent / budget)) : 0;
  const state = budget > 0 && spent > budget ? 'over' : ratio > 0.85 ? 'close' : 'comfortable';
  const fill =
    state === 'over' ? pal.negative : state === 'close' ? pal.warning : pal.accentMark;

  return (
    <View style={[{ paddingHorizontal: S.screen }, style]}>
      <Type role="body" color={pal.ink} style={{ marginBottom: 12 }}>
        {sentence}
      </Type>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: pal.groundSunk,
          overflow: 'hidden',
          // The track fills from the reading direction, so it mirrors in
          // Arabic rather than draining backwards (§7).
          flexDirection: 'row',
        }}
      >
        <View style={{ width: `${ratio * 100}%`, backgroundColor: fill, borderRadius: 3 }} />
      </View>
    </View>
  );
}

// ── Insight (§6.3) ───────────────────────────────────────────────────────────

/**
 * Prose on the ground, with up to two chips beneath. No icon, no card.
 *
 * This is the Milo idea at small scale, and it is the reason the home screen
 * can drop a dashboard's worth of widgets: one sentence of plain English says
 * more than a health score, a streak and a sparkline together.
 */
export function Insight({
  pal,
  text,
  actions = [],
  style,
}: {
  pal: Pal;
  text: string;
  actions?: readonly { label: string; onPress: () => void }[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ paddingHorizontal: S.screen }, style]}>
      <Type role="body" color={pal.ink}>
        {text}
      </Type>
      {actions.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {actions.slice(0, 2).map((a) => (
            <Chip key={a.label} pal={pal} label={a.label} onPress={a.onPress} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── Press feedback ───────────────────────────────────────────────────────────

/**
 * A row-shaped press target that answers on touch-down.
 *
 * The moment feedback waits for touch-*up*, directness "falls off a cliff" —
 * the finger is down, the screen has not moved, and for that fraction of a
 * second the app is a picture of an app. So the wash goes to full opacity on
 * `onPressIn` with no animation at all, and only the release is eased. That
 * asymmetry is not sloppiness: it is what a physical button does, and it is
 * what every iOS list row does.
 *
 * Scale would be wrong here where `PressableScale` is right elsewhere — a row
 * inside a card cannot shrink without lifting off its neighbours, so list
 * rows highlight and free-standing objects scale.
 */
export function Touchable({
  pal,
  onPress,
  children,
  style,
  bleed = S.card,
  accessibilityLabel,
  accessibilityRole = 'button',
}: {
  pal: Pal;
  onPress?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * How far the wash extends past the content on each side, so it reaches the
   * edge of the card the row sits in rather than floating inside it.
   */
  bleed?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
}) {
  const on = useSharedValue(0);
  const wash = useAnimatedStyle(() => ({ opacity: on.value }));

  if (!onPress) return <View style={style}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        on.value = 1;
      }}
      onPressOut={() => {
        on.value = withTiming(0, { duration: 240 });
      }}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            start: -bleed,
            end: -bleed,
            backgroundColor: pal.groundSunk,
          },
          wash,
        ]}
      />
      {children}
    </Pressable>
  );
}

// ── Rows (§6.7) ──────────────────────────────────────────────────────────────

/**
 * A transaction. 40px mark, title at 17, date at 13, signed amount right.
 *
 * The mark is a category-coloured circle carrying an initial; a real merchant
 * logo replaces it where one is known (§2.5), which is why `mark` is a slot
 * rather than a colour.
 */
export function Row({
  pal,
  title,
  meta,
  amount,
  format,
  mark,
  markColor,
  onPress,
  style,
}: {
  pal: Pal;
  title: string;
  meta?: string;
  amount: number;
  format: (n: number) => string;
  /** Overrides the coloured initial — a merchant logo, when we have one. */
  mark?: React.ReactNode;
  markColor?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const tone = amount < 0 ? pal.negative : pal.positive;
  const initial = title.trim().charAt(0).toUpperCase() || '?';
  const inner = (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: 12 },
        style,
      ]}
    >
      {mark ?? (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: markColor ?? pal.groundSunk,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RNText style={{ ...F.semibold, fontSize: 15, color: pal.groundAlt }}>
            {initial}
          </RNText>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Type role="cardTitle" color={pal.ink} numberOfLines={1}>
          {title}
        </Type>
        {meta ? (
          <Type role="meta" color={pal.inkDim} numberOfLines={1}>
            {meta}
          </Type>
        ) : null}
      </View>
      <Amount value={amount} format={format} size={17} color={tone} signed weight="semibold" />
    </View>
  );

  if (!onPress) return inner;
  return (
    <Touchable pal={pal} onPress={onPress} accessibilityLabel={title}>
      {inner}
    </Touchable>
  );
}

/**
 * Title, one line of meta, an optional figure on the right.
 *
 * `Row` above is the *transaction* row: it always signs the amount and
 * colours it by direction, because a transaction is money moving. This is the
 * row for everything that is a figure rather than a movement — a
 * subscription's price, a category's total, a bill that is due — where a
 * green `+$9.99` would simply be wrong.
 *
 * `lead` takes a rank chip or a mark; `trailing` takes anything that is not a
 * number, like a chevron or a checkmark.
 */
export function InfoRow({
  pal,
  title,
  meta,
  amount,
  format,
  tone,
  lead,
  trailing,
  footer,
  onPress,
  style,
}: {
  pal: Pal;
  title: string;
  meta?: string;
  amount?: number;
  format?: (n: number) => string;
  /** Defaults to `ink`. A figure is not red unless something is wrong. */
  tone?: string;
  lead?: React.ReactNode;
  trailing?: React.ReactNode;
  /** A meter, a confidence track — anything that spans the row's full width. */
  footer?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const inner = (
    <View style={[{ paddingVertical: 10 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
        {lead}
        <View style={{ flex: 1 }}>
          <Type role="cardTitle" color={pal.ink} numberOfLines={1}>
            {title}
          </Type>
          {meta ? (
            <Type role="meta" color={pal.inkDim} numberOfLines={1}>
              {meta}
            </Type>
          ) : null}
        </View>
        {amount !== undefined && format ? (
          <Amount
            value={amount}
            format={format}
            size={17}
            weight="semibold"
            color={tone ?? pal.ink}
          />
        ) : null}
        {trailing}
      </View>
      {footer}
    </View>
  );

  if (!onPress) return inner;
  return (
    <Touchable pal={pal} onPress={onPress} accessibilityLabel={title}>
      {inner}
    </Touchable>
  );
}

/**
 * A 6px track. The same bar the budget line and the score breakdown draw, so
 * a proportion looks the same everywhere in the app.
 *
 * Fills from the reading direction, so it mirrors under RTL rather than
 * draining backwards (§7).
 */
export function Meter({
  pal,
  ratio,
  tone,
  label,
  style,
}: {
  pal: Pal;
  /** 0–1. Values outside are clamped rather than overflowing the track. */
  ratio: number;
  tone?: string;
  /** Screen-reader name; a bare bar has none. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const clamped = Math.min(1, Math.max(0, ratio));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[
        {
          height: 6,
          borderRadius: 3,
          backgroundColor: pal.groundSunk,
          overflow: 'hidden',
          flexDirection: 'row',
        },
        style,
      ]}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          backgroundColor: tone ?? pal.accentMark,
          borderRadius: 3,
        }}
      />
    </View>
  );
}

/** A tappable row that opens something else — title, body, chevron. */
export function LinkRow({
  pal,
  icon,
  title,
  body,
  onPress,
  style,
}: {
  pal: Pal;
  /** A 44px squircle in a pale accent fill, per §6.9. */
  icon?: React.ReactNode;
  title: string;
  body?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Touchable
      pal={pal}
      onPress={onPress}
      accessibilityLabel={title}
      style={[{ flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: 14 }, style]}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Type role="cardTitle" color={pal.ink}>
          {title}
        </Type>
        {body ? (
          <Type role="meta" color={pal.inkDim}>
            {body}
          </Type>
        ) : null}
      </View>
      <ChevronRight size={18} color={pal.inkFaint} strokeWidth={S.stroke} style={mirror} />
    </Touchable>
  );
}

/** The 44px pale squircle that fronts a feature or permission row (§6.9). */
export function IconTile({
  pal,
  children,
  size = 44,
  style,
}: {
  pal: Pal;
  children: React.ReactNode;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: R.sm,
          backgroundColor: pal.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ── Quick actions (§6.8) ─────────────────────────────────────────────────────

/**
 * The tile.
 *
 * 56, up from 48. The row is four columns of ~81pt on this handset, so the
 * limit was never space — 48 was simply the number §6.6 wrote down when the
 * chrome was white circles holding hairline strokes. A filled duotone glyph
 * needs more room around it than a stroke does, and at 48 the tiles read as
 * small buttons rather than as the four places the screen sends you.
 */
const TILE = 56;
/**
 * The glyph inside it — 46% of the tile.
 *
 * It was 21-in-48 (44%), passed by hand at all eight call sites, which is how
 * a row ends up with one icon at a different weight from its neighbours and
 * nobody notices. The size and the colour both live here now; the call sites
 * pass a component, not a rendered node.
 */
const TILE_GLYPH = 26;

export interface QuickActionProps {
  pal: Pal;
  /**
   * The glyph, as a component rather than an element.
   *
   * Deliberate: an `icon` node let each call site choose its own size and
   * colour, and on the home screen they diverged — a 21px hairline plus beside
   * three solid duotone shapes, and mint's glyph left at `accent`, which is
   * 4.31:1 on its own tile. Handing over the component lets the tile paint it.
   */
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * A 56px accent-tinted circle with a 12px label beneath.
 *
 * **The glyph is neutral and the tile carries the colour.** It was the accent
 * in both, which made four saturated marks on four saturated discs — the tint
 * and the thing on it competing to be the coloured object. `inkDim` is the
 * app's secondary ink and it is what a mark on a tinted ground should be: the
 * tile is the colour, the glyph is just legible on it. That measures 6.53:1 on
 * lavender and 7.19:1 on mint, better than the accent managed on either.
 *
 * Note this is *not* a return to §6.6's original — those were grey glyphs on
 * **white** discs, which is what made the row the largest neutral block on a
 * screen whose only colour was the hero. The colour did not leave; it moved
 * from the 26px mark to the 56px surface, which is more of it, not less.
 *
 * **It moves in two ways, and only one of them is idle.** Held, the tile takes
 * on `TILE_PRESS_ALPHA` of the accent and its highlight rolls off, the way
 * light leaves a surface pushed in. At rest the highlight drifts, slowly and by
 * very little — see TILE_DRIFT_MS for why it is as slow as it is.
 */
export function QuickAction({ pal, Icon, label, onPress, style }: QuickActionProps) {
  const reduced = useReducedMotion();
  const press = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      spin.value = 0;
      return;
    }
    spin.value = withRepeat(
      // Linear, and it has to be: an eased rotation would visibly slow at the
      // ends of each turn, which reads as a stutter rather than as a glint
      // going round.
      withTiming(360, { duration: TILE_GLINT_MS, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(spin);
  }, [reduced, spin]);

  // Both worklets read `.value` directly. Hoisting either read into a helper
  // leaves the worklet subscribed to nothing and it runs exactly once — see
  // CLAUDE.md; this codebase has lost an animation to that already.
  const glintStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value}deg` }],
    // The glint goes out under a finger along with the sheen: the tile is
    // pressed in, so nothing is catching light on its edge.
    opacity: 1 - press.value,
  }));
  const sheenStyle = useAnimatedStyle(() => ({ opacity: 1 - press.value * 0.7 }));
  const washStyle = useAnimatedStyle(() => ({ opacity: press.value }));

  const radius = TILE / 2;

  // The `flex: 1` goes on a plain View, not on the PressableScale — the same
  // trap `PrimaryButton` documents. PressableScale wraps its Pressable in an
  // Animated.View carrying only the press transform, so a flex handed to it
  // lands on the inner element inside a parent that has already shrink-wrapped,
  // and a row of these bunches up against the left edge instead of spreading.
  return (
    <View style={[{ flex: 1 }, style]}>
      <PressableScale
        onPress={onPress}
        onPressIn={() => {
          press.value = withTiming(1, { duration: 110 });
        }}
        onPressOut={() => {
          press.value = withSpring(0, SPRING_MOVE);
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{ alignItems: 'center', gap: 8 }}
      >
        <View
          style={[
            SHADOW.near,
            {
              width: TILE,
              height: TILE,
              borderRadius: radius,
              // The pale accent wash, not white. On a screen whose only colour
              // was the hero, four grey glyphs on four white discs were the
              // largest neutral block on it — and the references carry colour
              // right through the layout rather than parking it in one object.
              backgroundColor: pal.accentSoft,
              // A lit ring, not the neutral hairline this used to carry. A grey
              // line on a lavender disc describes a cut-out; a light one
              // describes an edge the light has reached. §12, and the same move
              // the hero card makes with `borderTopColor`.
              //
              // Every layer below rounds itself to the tile rather than being
              // clipped by it: `overflow: hidden` sets `masksToBounds` on the
              // iOS layer, which would take this view's shadow with it.
              borderWidth: 1,
              borderColor: pal.tileRim,
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
        >
          {/* The press wash, under the light: the accent comes up through the
              surface rather than being painted over the highlight. */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: radius, backgroundColor: withAlpha(pal.accent, TILE_PRESS_ALPHA) },
              washStyle,
            ]}
          />
          {/*
            The sheen. It stops at 0.62 — a highlight that reaches the bottom is
            a lighter flat disc, not a lit one. The glyph sits at the centre,
            under about half of the alpha; the token is measured at the full
            first stop anyway, which is the conservative end.
          */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, sheenStyle]}>
            <LinearGradient
              colors={[pal.tileSheen, 'rgba(255,255,255,0)'] as const}
              locations={[0, 0.62]}
              start={{ x: 0.35, y: 0 }}
              end={{ x: 0.65, y: 1 }}
              style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
            />
          </Animated.View>
          {/*
            The glint: a bright arc that travels round the rim.

            Drawn as an SVG stroke rather than a border because a border cannot
            be a gradient. The gradient is defined in the circle's own space, so
            rotating this view carries the bright arc round the ring while the
            ring itself — being a circle — maps onto itself and appears not to
            move at all.
          */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glintStyle]}>
            <Svg width="100%" height="100%" viewBox="0 0 100 100">
              <Defs>
                <SvgGradient id="tileGlint" x1="0.5" y1="0" x2="0.5" y2="1">
                  <Stop offset="0" stopColor={pal.tileGlint} />
                  {/* Gone by a third of the way down, so what travels is an arc
                      and not a lit half of the ring. */}
                  <Stop offset="0.34" stopColor={pal.tileGlint} stopOpacity={0} />
                </SvgGradient>
              </Defs>
              <Circle cx="50" cy="50" r="49" fill="none" stroke="url(#tileGlint)" strokeWidth="2.5" />
            </Svg>
          </Animated.View>
          <Icon size={TILE_GLYPH} color={pal.inkDim} />
        </View>
        <RNText numberOfLines={1} style={{ ...F.medium, fontSize: 12, color: pal.inkDim }}>
          {label}
        </RNText>
      </PressableScale>
    </View>
  );
}

// ── Bar chart (§6.14) ────────────────────────────────────────────────────────

/**
 * Fourteen rounded bars. No gridlines, and no axis labels beyond the first and
 * the last — the shape is the point, and a reader who needs the exact figure
 * for a Tuesday is on the wrong screen.
 *
 * Bars are drawn in `accentMark`, not `accentGlow`: §2.3.1 is explicit that
 * the glow colours are 1.60:1 (mint) and 2.50:1 (violet) against the bone
 * ground and may never carry a mark whose shape has to be read.
 */
export function BarChart({
  pal,
  data,
  height = 120,
  style,
}: {
  pal: Pal;
  /** Oldest first. `label` is shown only for the first and last bar. */
  data: readonly { value: number; label: string }[];
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const first = data[0];
  const last = data[data.length - 1];
  return (
    <View style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height }}>
        {data.map((d, i) => (
          <View
            key={`${d.label}-${i}`}
            style={{
              flex: 1,
              // A zero day still draws a sliver, so the row reads as fourteen
              // days with nothing spent rather than as missing data.
              height: Math.max(3, (d.value / max) * height),
              borderRadius: 4,
              backgroundColor: d.value > 0 ? pal.accentMark : pal.groundSunk,
            }}
          />
        ))}
      </View>
      {first && last ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <Type role="meta" color={pal.inkDim}>{first.label}</Type>
          <Type role="meta" color={pal.inkDim}>{last.label}</Type>
        </View>
      ) : null}
    </View>
  );
}

/** A small ink pill carrying one earned badge. */
export function BadgePill({ pal, label }: { pal: Pal; label: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: R.pill,
        backgroundColor: pal.accentSoft,
      }}
    >
      <Type role="meta" color={pal.ink}>{label}</Type>
    </View>
  );
}

// ── Choice rows and progress ─────────────────────────────────────────────────

/**
 * A selectable row — a goal, a spending style, a currency.
 *
 * Selection is a pale `accentSoft` wash plus a filled check, not a coloured
 * border: §1.5 keeps borders for where two white surfaces touch. The check
 * matters as much as the wash — a wash alone is colour carrying meaning on
 * its own, which fails the same test §3 applies to signed amounts.
 */
/**
 * One option in a list of options.
 *
 * A **row**, not a card. It used to carry its own fill, shadow and radius, so
 * every call site had to switch those off again with
 * `{ backgroundColor: 'transparent', paddingHorizontal: 0 }` — a component
 * fighting the container it is always used in. Worse, that override also threw
 * away the selected state's wash, since the wash *was* the background: the
 * chosen option lost its tint and was left marked by the tick alone.
 *
 * The selection now reads on the title and the tick, which survive being
 * dropped into a Group.
 */
export function ChoiceRow({
  pal,
  title,
  body,
  icon,
  selected,
  onPress,
  style,
}: {
  pal: Pal;
  title: string;
  body?: string;
  icon?: React.ReactNode;
  selected: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          // The same 56 every other row in the kit uses. It was 64 with 12pt of
          // padding on top — the tallest row in the app, for its plainest
          // content — which is why the Appearance and Language lists read as
          // loose next to the settings rows directly above them.
          minHeight: 56,
          paddingVertical: 8,
        },
        style,
      ]}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Type role="cardTitle" color={selected ? pal.accent : pal.ink}>{title}</Type>
        {body ? <Type role="meta" color={pal.inkDim}>{body}</Type> : null}
      </View>
      {selected ? (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: pal.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Check size={14} color={pal.groundAlt} strokeWidth={2.5} />
        </View>
      ) : null}
    </PressableScale>
  );
}

/**
 * Step segments for a wizard. Ink for done, sunk for not — no gradient bar.
 *
 * `flexDirection: row` rather than absolute widths, so the run mirrors under
 * RTL instead of filling from the wrong end (§7).
 */
export function StepProgress({
  pal,
  total,
  current,
  style,
}: {
  pal: Pal;
  total: number;
  /** Zero-based. */
  current: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: current + 1 }}
      style={[{ flexDirection: 'row', gap: 6 }, style]}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: i <= current ? pal.ink : pal.groundSunk,
          }}
        />
      ))}
    </View>
  );
}

// ── Empty state (§6.17) ──────────────────────────────────────────────────────

/**
 * Warm, never apologetic.
 *
 * This app has many "you haven't connected anything yet" moments, and they are
 * where minimal designs fail — an empty state that only apologises leaves the
 * user to work out what to do next.
 */
export function Empty({
  pal,
  icon,
  title,
  body,
  actionLabel,
  onAction,
  style,
}: {
  pal: Pal;
  icon: React.ReactNode;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ alignItems: 'center', paddingHorizontal: S.screen }, style]}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          backgroundColor: pal.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        {icon}
      </View>
      <Type role="section" color={pal.ink} style={{ textAlign: 'center', marginBottom: 6 }}>
        {title}
      </Type>
      {body ? (
        <Type role="body" color={pal.inkDim} style={{ textAlign: 'center' }}>
          {body}
        </Type>
      ) : null}
      {actionLabel && onAction ? (
        <PrimaryButton
          pal={pal}
          label={actionLabel}
          onPress={onAction}
          style={{ marginTop: 22, alignSelf: 'stretch' }}
        />
      ) : null}
    </View>
  );
}

// ── Sub-screen header (§6.12) ────────────────────────────────────────────────

/**
 * Back circle, centred 17px title, optional trailing action.
 *
 * Every screen has to answer "how do I get out?", and the answer is always in
 * the same corner. The chevron mirrors under RTL; the title is centred so the
 * back circle and a trailing action balance around it.
 */
export function SubHeader({
  pal,
  title,
  onBack,
  action,
  style,
}: {
  pal: Pal;
  title: string;
  onBack: () => void;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: S.screen,
          gap: 12,
          minHeight: 44,
        },
        style,
      ]}
    >
      <CircleAction pal={pal} label={title} onPress={onBack}>
        <ChevronLeft size={20} color={pal.ink} strokeWidth={S.stroke} style={mirror} />
      </CircleAction>
      <Type role="cardTitle" color={pal.ink} numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
        {title}
      </Type>
      {/* Balances the back circle so the title sits optically centred rather
          than pushed left by an absent action. */}
      {action ?? <View style={{ width: 40 }} />}
    </View>
  );
}

// ── Stat ─────────────────────────────────────────────────────────────────────

/**
 * A small figure with a label under it.
 *
 * This exists to kill the uppercase caption. §3 defines eight sizes and none
 * of them is a tracked-out 11px all-caps label, and the screens that invented
 * one all ended up looking like a dashboard — which is the exact word §1
 * lists as the anti-tone. Sentence case, `inkDim`, meta size, under the
 * number rather than above it: the figure is what you came for, the label is
 * what tells you which figure it is.
 */
export function Stat({
  pal,
  label,
  value,
  format,
  tone,
  labelTone,
  size = 22,
  align = 'flex-start',
  style,
}: {
  pal: Pal;
  label: string;
  /** A number is set with the number rules; a string is set as-is. */
  value: number | string;
  format?: (n: number) => string;
  tone?: string;
  /**
   * The label's colour. `inkDim` is a mid grey chosen against the bone
   * ground; on the dark card it measures 1.9:1 and vanishes, so a Stat placed
   * there has to hand in its own.
   */
  labelTone?: string;
  size?: number;
  align?: 'flex-start' | 'center' | 'flex-end';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ alignItems: align, gap: 2 }, style]}>
      {typeof value === 'number' && format ? (
        <Amount value={value} format={format} size={size} color={tone ?? pal.ink} />
      ) : (
        <RNText
          style={{
            ...F.bold,
            fontSize: size,
            lineHeight: size * 1.15,
            letterSpacing: size * -0.02,
            color: tone ?? pal.ink,
            fontVariant: ['tabular-nums'],
          }}
        >
          {value}
        </RNText>
      )}
      <Type role="meta" color={labelTone ?? pal.inkDim} numberOfLines={1}>
        {label}
      </Type>
    </View>
  );
}

// ── Filter chips (§6.6) ──────────────────────────────────────────────────────

/**
 * A filter. Inactive is a `groundSunk` pill; active fills with ink.
 *
 * Not a tinted fill behind a 1.5px coloured border — that pattern reads as
 * eight competing buttons, and §1.5 reserves borders for where two white
 * surfaces touch. One filled pill in a row of sunk ones says "this one" with
 * no colour vocabulary to learn.
 */
export function FilterChip({
  pal,
  label,
  active,
  onPress,
  mark,
  style,
}: {
  pal: Pal;
  label: string;
  active: boolean;
  onPress: () => void;
  /** A 8px category dot, when the chip stands for a category. */
  mark?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={[
        {
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          paddingHorizontal: 16,
          borderRadius: R.pill,
          backgroundColor: active ? pal.ink : pal.groundSunk,
        },
        style,
      ]}
    >
      {mark ? (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: mark }} />
      ) : null}
      <Type role="meta" color={active ? pal.onInk : pal.inkDim} numberOfLines={1}>
        {label}
      </Type>
    </PressableScale>
  );
}

// ── Swipe to delete (§6.7) ───────────────────────────────────────────────────

/**
 * A row that can be swiped back to reveal one destructive action.
 *
 * This is the app's one piece of true direct manipulation, and it is built to
 * the rules that make direct manipulation feel like an object rather than a
 * trigger:
 *
 *   **1:1 tracking.** The row is glued to the finger for the whole gesture,
 *   not animated once at the end.
 *
 *   **Rubber-banding at both bounds.** Past fully-open and past fully-closed
 *   the row keeps moving but resists more the further it goes. A hard stop
 *   reads as frozen; resistance reads as "there is nothing more here".
 *
 *   **Momentum projection.** The release point does not decide the outcome —
 *   the *projected* resting point does, using the same exponential decay iOS
 *   scrolling uses. So a fast flick opens the row from barely a centimetre,
 *   which is what makes a flick feel like a throw rather than a short drag.
 *
 *   **Velocity handoff.** The settling spring starts at the finger's exact
 *   release speed, so there is no seam between dragging and animating. This
 *   is the single detail that separates fluid from merely fine.
 *
 * It replaces a delete button parked on every row. A destructive control that
 * is permanently one tap away from the amount you are reading is both noise
 * and a hazard; behind a deliberate sideways gesture it is neither.
 */
export function SwipeRow({
  pal,
  children,
  onDelete,
  actionLabel,
  actionWidth = 88,
  style,
}: {
  pal: Pal;
  children: React.ReactNode;
  onDelete: () => void;
  actionLabel: string;
  actionWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const { width: screenWidth } = useWindowDimensions();
  const reveal = useSharedValue(0);
  const startReveal = useSharedValue(0);
  const [open, setOpen] = useState(false);
  // The gesture is horizontal in *reading* order: in Arabic the row opens from
  // the other side, so every translation is multiplied through here (§7).
  const dir = I18nManager.isRTL ? -1 : 1;

  const tick = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const close = useCallback(() => {
    reveal.value = withSpring(0, SPRING_MOVE);
    setOpen(false);
  }, [reveal]);

  const pan = Gesture.Pan()
    // ~12px of hysteresis before committing to a direction, and a vertical
    // escape hatch, so the list still scrolls under a slightly diagonal drag.
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onBegin(() => {
      // Start from where the row actually *is*, not from where it was last
      // told to go — grabbing a row mid-flight must not make it jump.
      startReveal.value = reveal.value;
    })
    .onUpdate((e) => {
      const raw = startReveal.value - e.translationX * dir;
      if (raw < 0) {
        reveal.value = -rubberband(-raw, screenWidth);
      } else if (raw > actionWidth) {
        reveal.value = actionWidth + rubberband(raw - actionWidth, screenWidth);
      } else {
        reveal.value = raw;
      }
    })
    .onEnd((e) => {
      const velocity = -e.velocityX * dir;
      const projected = reveal.value + project(velocity);
      const target = projected > actionWidth / 2 ? actionWidth : 0;
      reveal.value = withSpring(target, {
        // Bounce is earned here: the finger threw the row. Under reduced
        // motion it settles flat instead.
        ...(reduced ? SPRING_MOVE : SPRING_FLICK),
        velocity,
      });
      runOnJS(setOpen)(target > 0);
      // The tick fires on the decision, not on arrival — the haptic has to
      // land on the same frame as the commit or it reads as a second event.
      runOnJS(tick)();
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -reveal.value * dir }],
  }));

  // The action grows toward the finger as it is revealed rather than simply
  // appearing at full size — intermediate frames should point at the outcome.
  const actionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(reveal.value, [0, actionWidth * 0.4], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(reveal.value, [0, actionWidth], [0.7, 1], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            end: 0,
            width: actionWidth,
            alignItems: 'center',
            justifyContent: 'center',
          },
          actionStyle,
        ]}
      >
        <Trash2 size={20} color={pal.negative} strokeWidth={S.stroke} />
        <Type role="meta" color={pal.negative} style={{ marginTop: 4 }}>
          {actionLabel}
        </Type>
      </Animated.View>

      {/* Tappable only once revealed, so it can never be hit by accident while
          the row is closed. */}
      {open ? (
        <Pressable
          onPress={() => {
            close();
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={{ position: 'absolute', top: 0, bottom: 0, end: 0, width: actionWidth }}
        />
      ) : null}

      <GestureDetector gesture={pan}>
        <Animated.View style={[{ backgroundColor: pal.groundAlt }, rowStyle]}>
          {/* While the row is open, a tap anywhere on it closes rather than
              opening whatever the row points at — the same forgiveness iOS
              gives a revealed row. */}
          {open ? (
            <Pressable
              onPress={close}
              accessibilityLabel={actionLabel}
              style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, zIndex: 1 }}
            />
          ) : null}
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// ── Bottom sheet (§6.21) ─────────────────────────────────────────────────────

/**
 * A sheet that springs from the bottom edge and can be thrown back to it.
 *
 * Two rules shape it. **Spatial consistency**: it arrives from the bottom and
 * leaves to the bottom, along the same path, so where it went is never a
 * question. **Dim to focus**: a sheet is a modal task, so the ground behind it
 * is dimmed rather than merely covered — a parallel, non-blocking panel would
 * use translucency and no scrim, and this is not one.
 *
 * The drag is the same physics as `SwipeRow`: 1:1 tracking, resistance past
 * the top, a decision made on the *projected* resting point rather than the
 * release point, and the settling spring seeded with the release velocity. A
 * sheet you can flick away with a short fast gesture feels like an object; one
 * that demands you drag it 40% of the way down feels like a form.
 *
 * The backdrop tracks the sheet's live position rather than fading on a timer,
 * so an interrupted dismissal has a correct backdrop at every instant.
 */
export function Sheet({
  pal,
  visible,
  onClose,
  title,
  children,
}: {
  pal: Pal;
  visible: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const [height, setHeight] = useState(0);
  // Offscreen until measured. One frame at 9999 is a frame nobody can see;
  // one frame at 0 is the sheet appearing without arriving.
  const y = useSharedValue(9999);
  const startY = useSharedValue(0);
  const entered = useRef(false);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted || height === 0) return;
    if (visible && !entered.current) {
      entered.current = true;
      y.value = height;
      y.value = reduced ? withTiming(0, { duration: 180 }) : withSpring(0, SPRING_SHEET);
    }
  }, [mounted, height, visible, reduced, y]);

  useEffect(() => {
    if (visible || !mounted || height === 0) return;
    entered.current = false;
    y.value = withSpring(height, SPRING_SHEET, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  }, [visible, mounted, height, y]);

  const pan = Gesture.Pan()
    .onBegin(() => {
      startY.value = y.value;
    })
    .onUpdate((e) => {
      const raw = startY.value + e.translationY;
      // Above the resting position the sheet resists rather than lifting off
      // the bottom edge, which would break the "arrived from below" reading.
      y.value = raw < 0 ? -rubberband(-raw, screenHeight) : raw;
    })
    .onEnd((e) => {
      const projected = y.value + project(e.velocityY);
      if (projected > height * 0.4) {
        y.value = withSpring(height, { ...SPRING_SHEET, velocity: e.velocityY }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else {
        y.value = withSpring(0, { ...SPRING_SHEET, velocity: e.velocityY });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: height === 0 ? 0 : interpolate(y.value, [0, height], [1, 0], Extrapolation.CLAMP),
  }));

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, scrimStyle]}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={title ?? ''}
            style={{ flex: 1, backgroundColor: 'rgba(18,23,43,0.4)' }}
          />
        </Animated.View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <GestureDetector gesture={pan}>
          <Animated.View
            onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
            style={[
              {
                backgroundColor: pal.groundAlt,
                borderTopLeftRadius: R.xl,
                borderTopRightRadius: R.xl,
                paddingBottom: insets.bottom + 12,
                maxHeight: screenHeight * 0.86,
              },
              sheetStyle,
            ]}
          >
            {/* 40×4 grabber — the affordance that says this thing is draggable
                before anyone has tried to drag it. */}
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: pal.groundSunk }} />
            </View>
            {title ? (
              <Type
                role="section"
                color={pal.ink}
                style={{ paddingHorizontal: S.card, paddingTop: 6, paddingBottom: 14 }}
              >
                {title}
              </Type>
            ) : null}
            {children}
          </Animated.View>
        </GestureDetector>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Settings rows ────────────────────────────────────────────────────────────

/**
 * A labelled switch. The label is the control's name, not an instruction —
 * if a row needs a sentence to explain what the switch does, `body` carries
 * it and the mapping was weak to begin with.
 */
export function SwitchRow({
  pal,
  icon,
  title,
  body,
  value,
  onValueChange,
  style,
}: {
  pal: Pal;
  icon?: React.ReactNode;
  title: string;
  body?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: 14, paddingVertical: 6 },
        style,
      ]}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Type role="cardTitle" color={pal.ink}>
          {title}
        </Type>
        {body ? (
          <Type role="meta" color={pal.inkDim}>
            {body}
          </Type>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={(next) => {
          Haptics.selectionAsync();
          onValueChange(next);
        }}
        accessibilityLabel={title}
        trackColor={{ false: pal.groundSunk, true: pal.accent }}
        thumbColor={pal.groundAlt}
        ios_backgroundColor={pal.groundSunk}
      />
    </View>
  );
}

/**
 * A group of rows on one white card, under a plain sentence-case heading.
 *
 * Settings is the screen most likely to drift back into a dashboard, because
 * it is a long list of unrelated switches. Grouping is what keeps it legible:
 * proximity implies relationship, so the groups have to be real ones.
 */
export function Group({
  pal,
  title,
  children,
  style,
}: {
  pal: Pal;
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <View style={[{ paddingHorizontal: S.screen }, style]}>
      {title ? (
        <Type role="section" color={pal.ink} style={{ marginBottom: 12 }}>
          {title}
        </Type>
      ) : null}
      <Card pal={pal} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
        {items.map((child, i) => (
          <View
            key={i}
            style={i > 0 ? { borderTopWidth: 1, borderTopColor: pal.hairline } : undefined}
          >
            {child}
          </View>
        ))}
      </Card>
    </View>
  );
}

// ── Amount entry (§6.16) ─────────────────────────────────────────────────────

/**
 * The keypad behind the amount display. No field chrome, no cursor.
 *
 * A number pad rather than a text field, for the reason Apple gives about
 * mapping: the control should mirror what it changes. Typing an amount into a
 * bordered box is a form; pressing digits under a number that grows is
 * entering an amount. It also removes the entire class of bugs where a
 * keyboard covers the thing it is editing.
 *
 * The decimal key prints the *locale's* separator, so a French user types a
 * comma and sees a comma.
 */
export function Keypad({
  pal,
  onDigit,
  onDecimal,
  onBackspace,
  decimalSeparator = '.',
  style,
}: {
  pal: Pal;
  onDigit: (digit: string) => void;
  onDecimal: () => void;
  onBackspace: () => void;
  decimalSeparator?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'decimal', '0', 'back'] as const;

  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap' }, style]}>
      {keys.map((key) => {
        const isBack = key === 'back';
        const isDecimal = key === 'decimal';
        const label = isDecimal ? decimalSeparator : key;
        return (
          <Pressable
            key={key}
            onPress={() => {
              Haptics.selectionAsync();
              if (isBack) onBackspace();
              else if (isDecimal) onDecimal();
              else onDigit(key);
            }}
            onLongPress={isBack ? onBackspace : undefined}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => ({
              width: '33.333%',
              height: 62,
              alignItems: 'center',
              justifyContent: 'center',
              // Feedback the instant the finger lands, not on release.
              opacity: pressed ? 0.35 : 1,
            })}
          >
            {isBack ? (
              <Delete size={24} color={pal.inkDim} strokeWidth={S.stroke} style={mirror} />
            ) : (
              <RNText
                style={{
                  ...F.medium,
                  fontSize: 28,
                  lineHeight: 34,
                  color: pal.ink,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {label}
              </RNText>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Period stepper ───────────────────────────────────────────────────────────

/** Previous / next around a centred label — a month, a week, a quarter. */
export function Stepper({
  pal,
  label,
  caption,
  onPrev,
  onNext,
  nextDisabled = false,
  style,
}: {
  pal: Pal;
  label: string;
  caption?: string;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: S.screen,
        },
        style,
      ]}
    >
      <CircleAction pal={pal} label={label} onPress={onPrev} size={36}>
        <ChevronLeft size={18} color={pal.ink} strokeWidth={S.stroke} style={mirror} />
      </CircleAction>
      <View style={{ alignItems: 'center' }}>
        <Type role="cardTitle" color={pal.ink}>
          {label}
        </Type>
        {caption ? (
          <Type role="meta" color={pal.inkDim}>
            {caption}
          </Type>
        ) : null}
      </View>
      <View style={{ opacity: nextDisabled ? 0.3 : 1 }}>
        <CircleAction pal={pal} label={label} onPress={nextDisabled ? undefined : onNext} size={36}>
          <ChevronRight size={18} color={pal.ink} strokeWidth={S.stroke} style={mirror} />
        </CircleAction>
      </View>
    </View>
  );
}
