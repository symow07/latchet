import { cloneElement, type ReactElement } from 'react';
import { Text as RNText, useColorScheme } from 'react-native';
import { C_DARK, C_LIGHT, B_DARK, B_LIGHT, type Palette, type BizPalette } from './palettes';

export { mix } from './palettes';

/**
 * Shared design language. Generous radii, frosted surfaces, Plus Jakarta Sans.
 *
 * Two product surfaces, each with a light and a dark palette:
 *   C — personal, purple-forward
 *   B — business, navy/steel, calmer and more structured
 *
 * Both palettes expose the SAME keys, so a component reads `C.text` without
 * caring which scheme is active. Get the live palette from useC()/useB();
 * the bare `C`/`B` exports are the dark palettes, kept for the handful of
 * module-scope constants that cannot call a hook.
 *
 * On the shade ramps: p200→p950 and slate700→slate900 stay ordered
 * light→dark in both schemes, so a gradient written [p600, p500, p400] reads
 * the same way either way. What changes is where the ramp sits — light mode
 * shifts the accents darker so they hold contrast against a white surface
 * rather than glowing off a black one.
 */

export type { Palette, BizPalette };

/** Dark palettes. Prefer useC()/useB() — these are for module-scope constants. */
export const C = C_DARK;
export const B = B_DARK;

/** The personal palette for the device's current colour scheme. */
export function useC(): Palette {
  return useColorScheme() === 'light' ? C_LIGHT : C_DARK;
}

/** The business palette for the device's current colour scheme. */
export function useB(): BizPalette {
  return useColorScheme() === 'light' ? B_LIGHT : B_DARK;
}

// ── Typography (Plus Jakarta Sans) ──────────────────────────────────────────────────
export const F = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
};

// ── Radii ────────────────────────────────────────────────────────────────────
export const R = {
  sm: 14,
  md: 20,
  lg: 26,
  xl: 32,
  pill: 999,
};

/** Soft purple glow shadow for floating/bubbly elements. */
export function glow(color: string = C.p500, opacity = 0.45, radius = 22, scale = 1) {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: opacity * scale,
    shadowRadius: radius,
    elevation: 10,
  } as const;
}

/**
 * Make every plain <Text> render in Plus Jakarta Sans by default so the whole
 * app — even screens we don't individually restyle — inherits the typography.
 * Screens needing specific weights use <Txt> or an explicit fontFamily.
 * Called once at startup after the fonts are loaded.
 *
 * This used to set Text.defaultProps, which does nothing here.
 *
 * React 19 did not remove defaultProps outright — createElement still applies
 * them. What changed is the path JSX takes: babel.config sets jsxImportSource,
 * so JSX compiles to jsx() from react/jsx-runtime, and jsx() ignores
 * defaultProps. Verified against this project's own React 19.0.0, both ways:
 * createElement applies them, jsx() does not. On the classic runtime the old
 * code would have worked. So the font rollout only ever reached components
 * setting fontFamily themselves — which is <Txt>, and roughly half the text in
 * the app is a plain <Text>.
 *
 * Wrapping the forwardRef's render is the path that actually runs, because
 * updateForwardRef reads `Component = Component.render` on every render rather
 * than capturing it when the component is defined — see
 * ReactNativeRenderer-prod.js, which is the bundle this app ships (Paper, since
 * app.json sets newArchEnabled: false; release builds use the prod bundle). The
 * same line is present in all six renderer bundles, so this does not depend on
 * which renderer or build type is in play.
 *
 * The default goes first in the style array so any caller-supplied style still
 * wins.
 *
 * The fragile assumption is that RN's Text stays a bare forwardRef. If a future
 * version wraps it in memo, T.render is undefined, the guard below turns this
 * into a silent no-op, and mixed typography returns with no error. Migrating
 * plain <Text> to <Txt> is the version of this that cannot rot that way.
 */
export function patchDefaultFont() {
  const T = RNText as unknown as {
    render?: (...args: unknown[]) => ReactElement | null;
    __defaultFontPatched?: boolean;
  };
  // Fast refresh can re-run this; patching a patch would nest it every time.
  if (T.__defaultFontPatched || typeof T.render !== 'function') return;

  const original = T.render;
  T.render = function patchedRender(...args: unknown[]) {
    const element = original.apply(this, args);
    if (!element) return element;
    const { style } = element.props as { style?: unknown };
    return cloneElement(element, { style: [{ fontFamily: F.medium }, style] } as never);
  };
  T.__defaultFontPatched = true;
}
