/**
 * The component set, in the design identity (DESIGN-IDENTITY.md).
 *
 * An off-white page; cards lifted off it by two layered warm shadows and a
 * hairline silver edge; one espresso anchor per screen; ink for text; soft
 * continuous corners; motion that is timed, eased and under 300 ms with
 * nothing that springs. Personal and business share every component and the
 * one palette, so nothing here knows which profile is active.
 *
 * Every screen imports from here. The previous set, ui.tsx, was deleted once
 * the last screen moved off it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  I18nManager,
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
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronLeft, ChevronRight, Delete, Trash2, type IconComponent } from '@/components/icons';
import {
  amountScale,
  currencyParts,
  project,
  rubberband,
  splitAmount,
} from '@/lib/motion';
import { CountUp, PressableScale } from '@/components/motion';
import { DrawCheck, lift, shadow } from '@/components/identity/primitives';
import { DARK as ON_ESPRESSO, ELEVATION, RADIUS } from '@/lib/identity/tokens';
import { EASE, MOTION, type EaseName, type Tween } from '@/lib/identity/motion';
import { F, R, S, T, type Palette } from '@/lib/design';
import { t } from '@/lib/i18n/core';

/** Either profile's palette — one and the same object now. */
export type Pal = Palette;

/**
 * An identity tween as a Reanimated timing config. No springs anywhere here.
 *
 * A worklet: the Sheet and swipe-row pan gestures call it in onEnd, on the UI
 * thread. Without the directive, Reanimated throws on the first drag-to-dismiss
 * and the gesture freezes mid-way. worklets.test.ts holds every UI-thread body
 * to this.
 */
function timed(tween: Tween) {
  'worklet';
  const [x1, y1, x2, y2] = EASE[tween.ease as EaseName];
  return { duration: tween.duration, easing: Easing.bezier(x1, y1, x2, y2) };
}

/** `#RRGGBB` plus an alpha channel, as the 8-digit hex RN accepts. */
function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0')}`;
}

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
 * The screen: the calm off-white page (roasted espresso-black in dark), and
 * nothing else — no wash, no bloom, no grain. Depth comes from what is lifted
 * off it, not from the page itself.
 */
export function Screen({
  pal,
  children,
  plain: _plain = false,
  style,
}: {
  pal: Pal;
  children?: React.ReactNode;
  /** No longer does anything: the page has no ambient wash to drop. */
  plain?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[{ flex: 1, backgroundColor: pal.ground, paddingTop: insets.top }, style]}>
      {children}
    </View>
  );
}

/**
 * A card lifted off the page: two layered warm shadows (the wide ambient one
 * on the outer view, the tight contact one on the inner) and a hairline silver
 * edge. In dark mode the shadows deepen and the edge does most of the work.
 *
 * `anchor` makes it the screen's one espresso block, lifted and edged exactly
 * as BalanceCard is: the anchor elevation, the anchor radius and a half-silver
 * edge. Text on it is `onEspresso`, secondary text `onEspressoDim`.
 */
export function Card({
  pal,
  children,
  anchor = false,
  radius = anchor ? R.lg : R.md,
  padding = S.card,
  style,
  contentStyle,
}: {
  pal: Pal;
  children?: React.ReactNode;
  anchor?: boolean;
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
  const { outer, inner } = anchor
    ? lift(pal, ELEVATION.anchor, pal.espresso, radius, withAlpha(pal.silver, 0.5))
    : lift(pal, ELEVATION.rest, pal.groundAlt, radius);
  return (
    <View style={[outer, style]}>
      <View
        style={[
          inner,
          {
            padding,
            // Clips a row's press wash to the card's corners. Only the inner
            // view clips; the ambient shadow lives on the wrapper outside it.
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
  weight = 'semibold',
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

/**
 * A lifted squircle carrying one outline glyph: the advisor, back, next.
 * Same lift and silver edge as a card, at button size.
 */
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
      style={[lift(pal, ELEVATION.rest, pal.groundAlt, RADIUS.tile).outer, { width: size, height: size }]}
    >
      <View
        style={[
          lift(pal, ELEVATION.rest, pal.groundAlt, RADIUS.tile).inner,
          { flex: 1, alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        {children}
      </View>
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
          color={pal.ink}
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

/** A section header on the page: 17 semibold, a tint link with a chevron. */
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
      <Type role="cardTitle" color={pal.ink}>
        {title}
      </Type>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={12}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          <Type role="meta" color={pal.accent} style={{ fontSize: 15, lineHeight: 20 }}>
            {actionLabel}
          </Type>
          <ChevronRight size={16} color={pal.accent} style={mirror} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Buttons (§6.11) ──────────────────────────────────────────────────────────

/**
 * Full-width primary button, 56pt tall: espresso, the identity's signature,
 * with off-white text. `accent` fills with the tint instead (espresso in light,
 * latte in dark); `secondary` is a lifted card-coloured button with a silver
 * edge.
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
  /**
   * `destructive` is the one control that loses something: a red label on a
   * lifted card-coloured pill, never a red fill, so it reads as a warning
   * rather than as the screen's call to action.
   */
  variant?: 'ink' | 'accent' | 'secondary' | 'destructive';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const quiet = variant === 'secondary' || variant === 'destructive';
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
    : quiet
      ? pal.groundAlt
      : variant === 'accent'
        ? pal.accent
        : pal.espresso;
  const label_ = disabled
    ? pal.inkDim
    : variant === 'destructive'
      ? pal.negative
      : variant === 'secondary'
        ? pal.ink
        : variant === 'accent'
          ? pal.onAccent
          : pal.onEspresso;
  // The caller's layout goes on a plain View, not on the PressableScale.
  // PressableScale wraps its Pressable in an Animated.View that carries only
  // the press transform, so a width, a flex or an alignSelf passed to it lands
  // on the inner element inside a parent that has already shrink-wrapped —
  // which silently turned this "full-width pill" (§6.11) into one the width of
  // its own label.
  return (
    <View style={style}>
      <PressableScale
        onPress={onPress}
        disabled={disabled}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={[
          disabled ? null : shadow(pal, ELEVATION.rest[0]),
          {
            height: 56,
            borderRadius: R.control,
            borderCurve: 'continuous',
            backgroundColor: fill,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: quiet && !disabled ? StyleSheet.hairlineWidth * 2 : 0,
            borderColor: pal.silverEdge,
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
 * A soft tint pill: the suggested reply, and the action chip under an
 * insight. The label is the tint on its own wash, as in the identity sample.
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
      // 40 tall to sit quietly under a sentence; the slop makes the target 44.
      hitSlop={2}
      style={[
        {
          minHeight: 40,
          justifyContent: 'center',
          paddingHorizontal: 16,
          borderRadius: R.pill,
          backgroundColor: pal.accentSoft,
        },
        style,
      ]}
    >
      <Type role="meta" color={pal.accent} style={{ fontSize: 15, lineHeight: 20 }}>
        {label}
      </Type>
    </PressableScale>
  );
}

/**
 * Segmented toggle. A sunk track; the active segment is a lifted card-coloured
 * pill with a silver edge, ink label; inactive labels are inkDim.
 *
 * The pill *slides*. A control whose highlight teleports between positions
 * tells you the selection changed; one that travels tells you which way it
 * went, and that is the whole difference between a toggle you have to read
 * and one you can feel. It is one transform, on the compositor, on a control
 * people tap constantly.
 *
 * Timed, not sprung: 200 ms ease-in-out (MOTION.slide), arriving without
 * overshoot. A tap carries no momentum, so bounce here would read as a tic
 * rather than as physics, and the identity has no springs at all.
 *
 * The pill is measured, not laid out: it is one absolutely-positioned view
 * translated across the row, so there is a single element moving rather than
 * n backgrounds cross-fading.
 */
/** The track's inset around the sliding pill. */
const SEG_PAD = 3;

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
  // The track is inset by SEG_PAD on every side; the pill travels inside it.
  const seg = width > 0 ? (width - SEG_PAD * 2) / options.length : 0;
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
    // Timed, not sprung: the identity has no springs (200 ms, ease-in-out).
    x.value = withTiming(target, timed(MOTION.slide));
  }, [index, seg, dir, reduced, x]);

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[
        { flexDirection: 'row', padding: SEG_PAD, borderRadius: R.pill, backgroundColor: pal.groundSunk },
        style,
      ]}
    >
      {seg > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            shadow(pal, ELEVATION.rest[0]),
            {
              position: 'absolute',
              top: SEG_PAD,
              bottom: SEG_PAD,
              start: SEG_PAD,
              width: seg,
              borderRadius: R.pill,
              backgroundColor: pal.groundAlt,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: pal.silverEdge,
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
              minHeight: 40,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Type role="meta" color={active ? pal.ink : pal.inkDim} numberOfLines={1}>
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
          borderRadius: R.control,
          borderCurve: 'continuous',
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
            fontSize: 17,
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

// ── Balance card: the anchor ─────────────────────────────────────────────────

/**
 * The screen's one anchor: espresso, lifted highest, with a silver edge. The
 * balance counts up in 280 ms; whatever the caller passes as `children` (the
 * month's budget, on Home) sits beneath it inside the card, as in the
 * identity's sample. No gradient, no sheen, no grain.
 */
export function BalanceCard({
  pal,
  label,
  amount,
  format,
  caption,
  badge,
  onPress,
  plain: _plain = false,
  children,
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
  /** No longer does anything: the anchor carries no gradient arc to drop. */
  plain?: boolean;
  /** Extra content inside the card, under the caption. */
  children?: React.ReactNode;
  /**
   * Layout only: margins, padding, width. It goes on a plain wrapper, never on
   * the filled shadow layer, so `paddingHorizontal: S.screen` insets the card
   * rather than stretching an espresso slab to both screen edges behind it.
   */
  style?: StyleProp<ViewStyle>;
}) {
  const { outer, inner } = lift(pal, ELEVATION.anchor, pal.espresso, R.lg, withAlpha(pal.silver, 0.5));
  // The figure shrinks rather than clipping past about twelve characters.
  const size = 44 * amountScale(format(amount).length, 12);
  const body = (
    <View style={[inner, { padding: S.card + 4 }]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <Type role="meta" color={pal.onEspressoDim} style={{ fontSize: 15, lineHeight: 20 }}>
          {label}
        </Type>
        {badge}
      </View>
      <CountUp value={amount} format={format} size={size} weight="semibold" color={pal.onEspresso} />
      {caption ? (
        <Type role="meta" color={pal.onEspressoDim} style={{ marginTop: 4 }}>
          {caption}
        </Type>
      ) : null}
      {children}
    </View>
  );

  // Without an action it used to put `style` on `outer`, and five screens
  // passing their gutter as padding drew the anchor twice: a full-width
  // espresso slab with the real card inset inside it.
  if (!onPress) {
    return (
      <View style={style}>
        <View style={outer}>{body}</View>
      </View>
    );
  }
  return (
    <View style={style}>
      <PressableScale onPress={onPress} accessibilityRole="button" style={outer}>
        {body}
      </PressableScale>
    </View>
  );
}

/**
 * The month's budget, inside the anchor, as in the identity's sample: a
 * metallic silver line and the silver "Remaining" figure (counting up) beside
 * the budget. Close to or over the budget the line and figure turn warning and
 * red — the dark scheme's tones, which are the ones that read on espresso.
 * `sentence` is the screen-reader summary; the figures say the same thing.
 */
export function AnchorBudget({
  pal,
  spent,
  budget,
  format,
  remainingLabel,
  budgetLabel,
  sentence,
  style,
}: {
  pal: Pal;
  spent: number;
  budget: number;
  format: (n: number) => string;
  remainingLabel: string;
  budgetLabel: string;
  sentence: string;
  style?: StyleProp<ViewStyle>;
}) {
  const ratio = budget > 0 ? Math.min(1, Math.max(0, spent / budget)) : 0;
  const remaining = budget - spent;
  const state = remaining < 0 ? 'over' : ratio > 0.85 ? 'close' : 'comfortable';
  const tone =
    state === 'over' ? ON_ESPRESSO.negative : state === 'close' ? ON_ESPRESSO.warning : pal.silver;
  return (
    <View style={style} accessible accessibilityLabel={sentence}>
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: withAlpha(pal.silver, 0.22),
          overflow: 'hidden',
          flexDirection: 'row',
        }}
      >
        <View style={{ width: `${ratio * 100}%`, backgroundColor: tone, borderRadius: 4, overflow: 'hidden' }}>
          {state === 'comfortable' ? (
            <View style={{ height: '45%', backgroundColor: withAlpha(pal.silverHi, 0.7) }} />
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 16 }}>
        <View style={{ flex: 1 }}>
          <Type role="meta" color={pal.onEspressoDim}>
            {remainingLabel}
          </Type>
          <CountUp value={remaining} format={format} size={22} weight="semibold" color={tone} style={{ marginTop: 2 }} />
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Type role="meta" color={pal.onEspressoDim}>
            {budgetLabel}
          </Type>
          {/* 2 + (28 − 20): this figure's foot sits on the silver figure's. */}
          <Type role="meta" color={pal.onEspressoDim} style={{ marginTop: 10, fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'] }}>
            {format(budget)}
          </Type>
        </View>
      </View>
    </View>
  );
}

// ── Budget line (§6.2) ───────────────────────────────────────────────────────

/**
 * One sentence and one track. No segments, no percentage ring.
 *
 * `comfortable` fills in the tint, `close` in warning, `over` in negative —
 * and the sentence says which it is too, so the state never depends on
 * telling colours apart. On espresso (`onAnchor`) the track turns metallic
 * silver, as in the identity's balance card.
 */
export function BudgetLine({
  pal,
  sentence,
  spent,
  budget,
  onAnchor = false,
  style,
}: {
  pal: Pal;
  /** Written by the caller, e.g. "$840 left of $1,200 this month." */
  sentence: string;
  spent: number;
  budget: number;
  /** Drawn inside the espresso anchor: silver on espresso, no side padding. */
  onAnchor?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const ratio = budget > 0 ? Math.min(1, Math.max(0, spent / budget)) : 0;
  const state = budget > 0 && spent > budget ? 'over' : ratio > 0.85 ? 'close' : 'comfortable';
  const fill = onAnchor
    ? state === 'comfortable'
      ? pal.silver
      : state === 'over'
        ? pal.negative
        : pal.warning
    : state === 'over'
      ? pal.negative
      : state === 'close'
        ? pal.warning
        : pal.accentMark;

  return (
    <View style={[{ paddingHorizontal: onAnchor ? 0 : S.screen }, style]}>
      {onAnchor ? null : (
        <Type role="body" color={pal.ink} style={{ marginBottom: 12 }}>
          {sentence}
        </Type>
      )}
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={sentence}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
        style={{
          height: onAnchor ? 8 : 6,
          borderRadius: 4,
          backgroundColor: onAnchor ? withAlpha(pal.silver, 0.22) : pal.groundSunk,
          overflow: 'hidden',
          // The track fills from the reading direction, so it mirrors in
          // Arabic rather than draining backwards.
          flexDirection: 'row',
        }}
      >
        <View style={{ width: `${ratio * 100}%`, backgroundColor: fill, borderRadius: 4, overflow: 'hidden' }}>
          {/* Silver's metallic sheen: the bright end at the top of the fill. */}
          {onAnchor && state === 'comfortable' ? (
            <View style={{ height: '45%', backgroundColor: withAlpha(pal.silverHi, 0.7) }} />
          ) : null}
        </View>
      </View>
      {onAnchor ? (
        <Type role="meta" color={pal.onEspressoDim} style={{ marginTop: 12 }}>
          {sentence}
        </Type>
      ) : null}
    </View>
  );
}

// ── Insight (§6.3) ───────────────────────────────────────────────────────────

/**
 * One sentence of plain English on a lifted card, with up to two chips
 * beneath. When the news is good (`check`), the sentence is led by the
 * identity's self-drawing check.
 */
export function Insight({
  pal,
  text,
  actions = [],
  check = false,
  style,
}: {
  pal: Pal;
  text: string;
  actions?: readonly { label: string; onPress: () => void }[];
  /** Lead with the self-drawing check: the insight is good news. */
  check?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ paddingHorizontal: S.screen }, style]}>
      <Card pal={pal} padding={S.card}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {check ? (
            <View style={{ paddingTop: 1 }}>
              <DrawCheck P={pal} size={22} delay={MOTION.settle.tween.duration} />
            </View>
          ) : null}
          <Type role="body" color={pal.ink} style={{ flex: 1 }}>
            {text}
          </Type>
        </View>
        {actions.length > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 8,
              marginTop: 16,
              marginStart: check ? 34 : 0,
            }}
          >
            {actions.slice(0, 2).map((a) => (
              <Chip key={a.label} pal={pal} label={a.label} onPress={a.onPress} />
            ))}
          </View>
        ) : null}
      </Card>
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
        on.value = withTiming(0, timed(MOTION.press.out));
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
 * A transaction. A 40px glyph tile, title at 17, date at 13, signed amount
 * right — green in, red out, and always with its sign.
 *
 * The identity marks a category by its glyph on a soft tile (`icon`), not by a
 * colour. `markColor` (a coloured circle with an initial) remains for callers
 * that have no glyph; a merchant logo goes in `mark`.
 */
export function Row({
  pal,
  title,
  meta,
  amount,
  format,
  mark,
  markColor,
  icon: Glyph,
  onPress,
  style,
}: {
  pal: Pal;
  title: string;
  meta?: string;
  amount: number;
  format: (n: number) => string;
  /** Overrides the tile — a merchant logo, when we have one. */
  mark?: React.ReactNode;
  markColor?: string;
  /** The category's glyph, drawn on a soft tile. */
  icon?: IconComponent;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  // Green in, red out: the convention kept on purpose. The sign carries it
  // too, so colour is never the only signal.
  const tone = amount < 0 ? pal.negative : pal.positive;
  const initial = title.trim().charAt(0).toUpperCase() || '?';
  const tile = Glyph ? (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: RADIUS.tile,
        borderCurve: 'continuous',
        backgroundColor: pal.groundSunk,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Glyph size={22} color={pal.ink} />
    </View>
  ) : null;
  const inner = (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', minHeight: 60, gap: 12 },
        style,
      ]}
    >
      {mark ?? tile ?? (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: RADIUS.tile,
            borderCurve: 'continuous',
            backgroundColor: markColor ?? pal.groundSunk,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RNText style={{ ...F.semibold, fontSize: 15, color: markColor ? pal.groundAlt : pal.ink }}>
            {initial}
          </RNText>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Type role="body" color={pal.ink} numberOfLines={1}>
          {title}
        </Type>
        {meta ? (
          <Type role="meta" color={pal.inkDim} numberOfLines={1}>
            {meta}
          </Type>
        ) : null}
      </View>
      <Amount value={amount} format={format} size={17} color={tone} signed weight="medium" />
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
  signed = false,
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
  /**
   * The amount is money moving rather than a figure: it carries its + or −
   * and takes the money colours, green in and red out (DESIGN-IDENTITY.md).
   */
  signed?: boolean;
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
          <Type role="body" color={pal.ink} numberOfLines={1}>
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
            weight="medium"
            color={tone ?? (signed ? (amount < 0 ? pal.negative : pal.positive) : pal.ink)}
            signed={signed}
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
        <Type role="body" color={pal.ink}>
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

/** The 44px platinum squircle that fronts a feature or permission row. */
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
          borderCurve: 'continuous',
          backgroundColor: pal.silverSoft,
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

// ── Quick actions ────────────────────────────────────────────────────────────

export interface QuickActionProps {
  pal: Pal;
  /**
   * The glyph, as a component rather than an element, so the tile owns its
   * size and colour and a row of these can never drift apart.
   */
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * A shortcut, as in the identity's sample: a lifted card with a silver edge,
 * a platinum glyph tile at its top, the label beneath. Laid out in a row,
 * each takes an equal share of the width. The glyph sits above the label so a
 * long label (French, Arabic) wraps by word rather than breaking mid-word.
 */
export function QuickAction({ pal, Icon, label, onPress, style }: QuickActionProps) {
  const { outer, inner } = lift(pal, ELEVATION.rest, pal.groundAlt, R.control);
  // The `flex: 1` goes on a plain View, not on the PressableScale: its
  // Animated.View wrapper carries only the press transform, and a flex handed
  // to it lands inside a parent that has already shrink-wrapped.
  return (
    <View style={[{ flex: 1 }, style]}>
      <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={outer}>
        <View style={[inner, { padding: 16 }]}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: RADIUS.tile,
              borderCurve: 'continuous',
              backgroundColor: pal.silverSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={22} color={pal.ink} />
          </View>
          <Type role="meta" color={pal.ink} numberOfLines={2} style={{ fontSize: 15, lineHeight: 20, marginTop: 12 }}>
            {label}
          </Type>
        </View>
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
 * Bars are drawn in `accentMark` (espresso in light, latte in dark), a mark
 * whose shape has to be read; silver is about 1.6:1 on the page and may not
 * carry one. On the anchor (`onAnchor`) the roles swap: espresso would vanish
 * there and silver reads at 7.75:1.
 */
export function BarChart({
  pal,
  data,
  height = 120,
  onAnchor = false,
  style,
}: {
  pal: Pal;
  /** Oldest first. `label` is shown only for the first and last bar. */
  data: readonly { value: number; label: string }[];
  height?: number;
  /**
   * Drawn inside the espresso anchor. The bars are `accentMark`, espresso in
   * light, which would vanish there, so on the anchor they take its own fill:
   * silver bars, a silver sliver at low alpha for an empty day, and
   * `onEspressoDim` labels.
   */
  onAnchor?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bar = onAnchor ? pal.silver : pal.accentMark;
  const empty = onAnchor ? pal.glassStrong : pal.groundSunk;
  const labelColor = onAnchor ? pal.onEspressoDim : pal.inkDim;
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
              borderCurve: 'continuous',
              backgroundColor: d.value > 0 ? bar : empty,
            }}
          />
        ))}
      </View>
      {first && last ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <Type role="meta" color={labelColor}>{first.label}</Type>
          <Type role="meta" color={labelColor}>{last.label}</Type>
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
        <Type role="body" color={selected ? pal.accent : pal.ink}>{title}</Type>
        {body ? <Type role="meta" color={pal.inkDim}>{body}</Type> : null}
      </View>
      {/* The outline check in the tint: never a filled disc. */}
      {selected ? <Check size={24} color={pal.accent} /> : null}
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
            backgroundColor: i <= current ? pal.accent : pal.groundSunk,
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
  actionVariant = 'ink',
  style,
}: {
  pal: Pal;
  icon: React.ReactNode;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * `secondary` when the screen already has its espresso anchor above the
   * empty state: one espresso block per screen, so the action steps down to
   * the lifted card-coloured button.
   */
  actionVariant?: 'ink' | 'secondary';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ alignItems: 'center', paddingHorizontal: S.screen }, style]}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          borderCurve: 'continuous',
          backgroundColor: pal.silverSoft,
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
          variant={actionVariant}
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
            ...F.semibold,
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
 * A filter. Inactive is a `groundSunk` pill; active fills with the tint
 * (espresso in light, latte in dark).
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
          backgroundColor: active ? pal.accent : pal.groundSunk,
        },
        style,
      ]}
    >
      {mark ? (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: mark }} />
      ) : null}
      <Type role="meta" color={active ? pal.onAccent : pal.inkDim} numberOfLines={1}>
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
 *   **A soft landing.** From wherever the finger lets go, the row settles
 *   on the identity's 200 ms ease-out (MOTION.settle), with no overshoot.
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
    reveal.value = withTiming(0, timed(MOTION.settle.tween));
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
      // Settles on a timed ease-out, not a spring: the identity never
      // overshoots. The projection above still lets a flick decide the
      // outcome from a short throw.
      reveal.value = withTiming(target, timed(reduced ? MOTION.crossfade : MOTION.settle.tween));
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
 * A sheet that rises from the bottom edge and can be thrown back to it.
 *
 * Two rules shape it. **Spatial consistency**: it arrives from the bottom and
 * leaves to the bottom, along the same path, so where it went is never a
 * question. **Dim to focus**: a sheet is a modal task, so the ground behind it
 * is dimmed rather than merely covered — a parallel, non-blocking panel would
 * use translucency and no scrim, and this is not one.
 *
 * The drag is the same physics as `SwipeRow`: 1:1 tracking, resistance past
 * the top, and a decision made on the *projected* resting point rather than
 * the release point. A sheet you can flick away with a short fast gesture
 * feels like an object; one that demands you drag it 40% of the way down
 * feels like a form. It rises in 280 ms and leaves in 200 (MOTION.sheet).
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
      // Rises in 280 ms on the identity's ease-out; no spring, no overshoot.
      y.value = withTiming(0, timed(reduced ? MOTION.crossfade : MOTION.sheet.open));
    }
  }, [mounted, height, visible, reduced, y]);

  useEffect(() => {
    if (visible || !mounted || height === 0) return;
    entered.current = false;
    y.value = withTiming(height, timed(MOTION.sheet.close), (finished) => {
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
        y.value = withTiming(height, timed(MOTION.sheet.close), (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else {
        y.value = withTiming(0, timed(MOTION.settle.tween));
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
            // The dark scheme's ground at 40%, a roasted espresso-black
            // rather than a cold navy, so the scrim stays warm in both schemes.
            style={{ flex: 1, backgroundColor: withAlpha(ON_ESPRESSO.ground, 0.4) }}
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
                borderCurve: 'continuous',
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
        <Type role="body" color={pal.ink}>
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
        <Type role="cardTitle" color={pal.ink} style={{ marginBottom: 12 }}>
          {title}
        </Type>
      ) : null}
      <Card pal={pal} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
        {items.map((child, i) => (
          <View
            key={i}
            style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: pal.hairline } : undefined}
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
  // Four rows of three equal keys, each a flex cell. Two things this replaces
  // did nothing on this build: `width: '33.333%'` in one wrapping row, and
  // any style given to Pressable as a function — NativeWind's JSX wrapper
  // (react-native-css-interop) drops a function `style`, so the keys lost
  // their width and height and collapsed into one line of text,
  // "123456789.0", with the backspace after it. Static styles only.
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['decimal', '0', 'back'],
  ] as const;

  return (
    <View style={style}>
      {rows.map((row) => (
        <View key={row.join('')} style={{ flexDirection: 'row' }}>
          {row.map((key) => {
            const isBack = key === 'back';
            const isDecimal = key === 'decimal';
            const label = isDecimal ? decimalSeparator : key;
            return (
              <View key={key} style={{ flex: 1 }}>
                {/* The identity's press: a 0.97 scale and a selection tick
                    (PressableScale), not a fade, which reads as disabled. */}
                <PressableScale
                  onPress={() => {
                    if (isBack) onBackspace();
                    else if (isDecimal) onDecimal();
                    else onDigit(key);
                  }}
                  onLongPress={isBack ? onBackspace : undefined}
                  accessibilityRole="button"
                  accessibilityLabel={isBack ? t('dialogs.delete') : label}
                  style={{ height: 62, alignItems: 'center', justifyContent: 'center' }}
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
                </PressableScale>
              </View>
            );
          })}
        </View>
      ))}
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
