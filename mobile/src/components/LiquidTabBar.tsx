import React, { useCallback, useEffect, useMemo } from 'react';
import { I18nManager, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { BAR, S, capsuleInset, tabCentre, travelInset } from '@/lib/design';
import type { Pal } from '@/components/kit';
import { shadow } from '@/components/identity/primitives';
import { BAR_BLUR, ELEVATION, GLYPH } from '@/lib/identity/tokens';
import { EASE, MOTION } from '@/lib/identity/motion';

/**
 * The tab bar.
 *
 * Clear glass, with the selected tab marked by a capsule that slides between
 * them. Nothing protrudes, and nothing moves except the capsule; the icons stay
 * where they are.
 *
 * The material is a blur under a tint, not UIKit's Liquid Glass.
 *
 * `expo-glass-effect` was wired up and reverted: every published version's
 * `GlassContainer.swift` overrides `mountChildComponentView`, which exists on
 * SDK 53's *New Architecture* view classes only. This app runs
 * `newArchEnabled: false`, so it does not compile — at any version, since the
 * podspec builds every Swift file in the package whether or not the container
 * is used. Reaching real Liquid Glass means enabling the New Architecture or
 * moving to SDK 54+, neither of which is a tab-bar change.
 *
 * The consolation is that this path's legibility is *measured*: `barTint`'s
 * alpha bounds how far the backdrop can drag the foreground, and
 * palettes.test.ts checks it against the extremes. A system material would have
 * been Apple's to guarantee, not this codebase's.
 *
 * This replaces a bar whose surface rose into a socket around a bead riding
 * above it. That was faithful to its reference and it cost a great deal: a
 * module of tangent-circle geometry, a masked blur because the shape had a
 * moving bump no corner radius could describe, and a path rebuilt on the UI
 * thread every frame. A capsule needs one animated transform, so the mask, the
 * glow, the meniscus and all of its geometry went with it.
 *
 * The glass got clearer in the same change, and not by loosening anything —
 * see `barTint`. Dimming the inactive tabs was what forced the tint opaque,
 * because a mid-grey needs far more backing than the foreground does. The
 * capsule marks the selection instead, so every icon sits at full contrast and
 * the bar can be as clear as its measurement allows.
 */

/** React Navigation's event name — an API constant, not display text. */
const TAB_PRESS = 'tabPress' as const;

/**
 * The selection capsule.
 *
 * Sized from the bar rather than picked, and then clamped by its own slot: past
 * a point the bar's height is no longer the binding constraint, the slot's width
 * is. Without the clamp a taller bar grows a capsule *taller than it is wide* —
 * a vertical lozenge around a square icon, which reads as a mistake.
 */
const CAPSULE_MAX = BAR.height - 12;
/**
 * Trimmed from the slot, so neighbouring capsules never meet.
 *
 * Small: the reference's capsule is a wide pill because it carries a label
 * beside the glyph. This bar has no labels, so the most it can do is fill its
 * own slot.
 */
const CAPSULE_GUTTER = 4;

/**
 * The slide: the identity's 200 ms ease-in-out (MOTION.slide). It used to be a
 * lightly under-damped spring; the identity never overshoots.
 */
const [SX1, SY1, SX2, SY2] = EASE[MOTION.slide.ease];
const SLIDE = { duration: MOTION.slide.duration, easing: Easing.bezier(SX1, SY1, SX2, SY2) };

export interface LiquidTab {
  /**
   * Not rendered — the bar is icons only. It is still required, and matters
   * more for it: with nothing written on the bar this string is the only name
   * the tab has, for VoiceOver and for the accessibility tree.
   */
  label: string;
  /** The selected tab's glyph (the same outline as `Line` in the identity). */
  Fill: React.ComponentType<{ size?: number; color?: string }>;
  Line: React.ComponentType<{ size?: number; color?: string }>;
}

export function LiquidTabBar({
  state,
  navigation,
  pal,
  tabs,
}: Pick<BottomTabBarProps, 'state' | 'navigation'> & {
  pal: Pal;
  /** Keyed by route name, so this does not depend on the navigator's order. */
  tabs: Record<string, LiquidTab>;
}) {
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const reduced = useReducedMotion();

  const routes = useMemo(() => state.routes.filter((r) => tabs[r.name]), [state.routes, tabs]);
  const active = Math.max(
    0,
    routes.findIndex((r) => r.key === state.routes[state.index]?.key)
  );

  const width = Math.max(1, screen - S.screen * 2);
  const count = Math.max(1, routes.length);

  // The capsule has to stay inside the bar's rounded ends; past that the inset
  // is chosen for rhythm rather than clearance. See `travelInset`.
  // The inset uses the unclamped height, which is conservative: a taller
  // capsule needs more clearance, so reserving for it can only be safe.
  const pad = travelInset(width, count, capsuleInset(BAR.height, CAPSULE_MAX) + 4);
  const slot = (width - pad * 2) / count;
  const capsuleHeight = Math.min(CAPSULE_MAX, slot - CAPSULE_GUTTER);

  // The buttons are a flex row, which React Native mirrors under RTL; the
  // capsule's position is arithmetic, which nothing mirrors. See `tabCentre`.
  const rtl = I18nManager.isRTL;
  const x = useSharedValue(tabCentre(width, pad, slot, active, rtl));

  useEffect(() => {
    const to = tabCentre(width, pad, slot, active, rtl);
    x.value = reduced ? to : withTiming(to, SLIDE);
  }, [active, width, pad, slot, rtl, reduced, x]);

  const capsule = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value - (slot - CAPSULE_GUTTER) / 2 }],
  }));

  const goTo = useCallback(
    (i: number) => {
      const route = routes[i];
      if (!route) return;
      Haptics.selectionAsync();
      const event = navigation.emit({
        type: TAB_PRESS,
        target: route.key,
        canPreventDefault: true,
      });
      if (i !== active && !event.defaultPrevented) navigation.navigate(route.name as never);
    },
    [routes, navigation, active]
  );

  /**
   * The buttons in the order they are *drawn*, each carrying its true index.
   *
   * Reversed by hand under RTL because the interior is pinned to LTR below.
   * Mixing the two coordinate systems is what broke this in Arabic: React
   * Native mirrors a flex row on its own and swaps `left` for `right` on
   * absolutely positioned children, while the capsule's x and its `translateX`
   * are plain arithmetic that nothing mirrors. One explicit reversal is easier
   * to reason about than three implicit ones that disagree.
   */
  const order = useMemo(() => {
    const withIndex = routes.map((route, i) => ({ route, i }));
    return rtl ? withIndex.reverse() : withIndex;
  }, [routes, rtl]);

  return (
    <View
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',
          left: S.screen,
          right: S.screen,
          bottom: BAR.lift(insets.bottom),
          height: BAR.height,
          borderRadius: BAR.height / 2,
        },
        // Lifted like every surface in the identity: the wide ambient layer
        // here, the tight contact layer on the frame inside. Neither view may
        // clip, or it would clip its own shadow — the glass clips one level in.
        shadow(pal, ELEVATION.raised[1]),
      ]}
    >
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: BAR.height / 2 }, shadow(pal, ELEVATION.raised[0])]}
      >
        <View style={[StyleSheet.absoluteFill, { borderRadius: BAR.height / 2, overflow: 'hidden' }]}>
          <BlurView intensity={60} tint={BAR_BLUR[pal.scheme]} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: pal.barTint }]} />
          {/* The silver edge every lifted surface wears. */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: BAR.height / 2,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: pal.silverEdge,
              },
            ]}
          />
        </View>
      </View>

      {/* See `order` — the interior is pinned to one writing direction. */}
      <View style={{ flex: 1, direction: 'ltr' }}>
        {/*
          The selection — a clear chip on the glass, not a coloured one.

          `barSelection` carries its own alpha, and that alpha is what keeps the
          glyph on it measurable: two translucent layers over an unverifiable
          backdrop, checked as a stack. It also always pushes *away* from the
          glyph — lighter in light, darker in dark. See palettes.ts.
        */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0,
              top: (BAR.height - capsuleHeight) / 2,
              width: slot - CAPSULE_GUTTER,
              height: capsuleHeight,
              borderRadius: capsuleHeight / 2,
              backgroundColor: pal.barSelection,
            },
            capsule,
          ]}
        />

        <View style={{ flex: 1, flexDirection: 'row', paddingHorizontal: pad }}>
          {order.map(({ route, i }) => {
            const tab = tabs[route.name];
            const isActive = i === active;
            const Glyph = isActive ? tab.Fill : tab.Line;
            return (
              <Pressable
                key={route.key}
                onPress={() => goTo(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={tab.label}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
              >
                <Glyph size={GLYPH.sizes.nav} color={isActive ? pal.onBarActive : pal.onBar} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
