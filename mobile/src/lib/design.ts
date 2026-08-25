import { cloneElement, type ReactElement } from 'react';
import { Text as RNText, useColorScheme } from 'react-native';

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

export type Palette = {
  scheme: 'light' | 'dark';
  bg: string; bgDeep: string; bgRaise: string;
  p950: string; p900: string; p800: string; p700: string; p600: string;
  p500: string; p400: string; p300: string; p200: string; lilac: string;
  rose: string; amber: string; green: string; sky: string;
  text: string; textDim: string; textFaint: string;
  glass: string; glassStrong: string; glassBorder: string;
  /** Multiplier for glow(): coloured haze reads as grime on a light surface. */
  glowScale: number;
};

const C_DARK: Palette = {
  scheme: 'dark',
  bg: '#0c0716', bgDeep: '#080411', bgRaise: '#150d24',
  p950: '#2e1065', p900: '#3b0764', p800: '#4c1d95', p700: '#6d28d9', p600: '#7c3aed',
  p500: '#a855f7', p400: '#c084fc', p300: '#d8b4fe', p200: '#e9d5ff', lilac: '#b794f6',
  rose: '#fb7185', amber: '#fbbf24', green: '#34d399', sky: '#7dd3fc',
  text: '#f6f2ff', textDim: '#bca9dd', textFaint: '#7e6fa0',
  glass: 'rgba(255,255,255,0.055)', glassStrong: 'rgba(255,255,255,0.09)',
  glassBorder: 'rgba(216,180,254,0.16)',
  glowScale: 1,
};

const C_LIGHT: Palette = {
  scheme: 'light',
  bg: '#ffffff', bgDeep: '#f2eef8', bgRaise: '#faf7fd',
  p950: '#3b0764', p900: '#4c1d95', p800: '#5b21b6', p700: '#6d28d9', p600: '#6b21a8',
  p500: '#7e22ce', p400: '#9333ea', p300: '#a855f7', p200: '#c084fc', lilac: '#8b5cf6',
  rose: '#e11d48', amber: '#b45309', green: '#047857', sky: '#0369a1',
  text: '#1a1024', textDim: '#5b4b70', textFaint: '#8b7ba3',
  glass: 'rgba(88,28,135,0.045)', glassStrong: 'rgba(88,28,135,0.08)',
  glassBorder: 'rgba(88,28,135,0.14)',
  glowScale: 0.25,
};

export type BizPalette = {
  scheme: 'light' | 'dark';
  bg: string; bgDeep: string; bgRaise: string;
  slate900: string; slate800: string; slate700: string;
  accent: string; accentDeep: string; accentSoft: string;
  teal: string; amber: string; red: string; green: string;
  text: string; textDim: string; textFaint: string;
  glass: string; glassStrong: string; glassBorder: string;
  glowScale: number;
};

const B_DARK: BizPalette = {
  scheme: 'dark',
  bg: '#0a0e17', bgDeep: '#06090f', bgRaise: '#111928',
  slate900: '#0f1626', slate800: '#1a2336', slate700: '#27324a',
  accent: '#5b8cff', accentDeep: '#3b6fe0', accentSoft: '#9fbbff',
  teal: '#2dd4bf', amber: '#f5b14c', red: '#f06a6a', green: '#34d399',
  text: '#eef2fb', textDim: '#9aa7c2', textFaint: '#5f6c86',
  glass: 'rgba(255,255,255,0.045)', glassStrong: 'rgba(255,255,255,0.075)',
  glassBorder: 'rgba(120,150,210,0.16)',
  glowScale: 1,
};

const B_LIGHT: BizPalette = {
  scheme: 'light',
  bg: '#ffffff', bgDeep: '#eef1f7', bgRaise: '#f7f9fc',
  slate900: '#e8edf5', slate800: '#dde4ef', slate700: '#ccd6e5',
  accent: '#2563eb', accentDeep: '#1d4ed8', accentSoft: '#3b82f6',
  teal: '#0f766e', amber: '#b45309', red: '#dc2626', green: '#047857',
  text: '#0b1220', textDim: '#475569', textFaint: '#7b8798',
  glass: 'rgba(15,35,80,0.04)', glassStrong: 'rgba(15,35,80,0.07)',
  glassBorder: 'rgba(15,35,80,0.12)',
  glowScale: 0.25,
};

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
