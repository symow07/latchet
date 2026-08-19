import { cloneElement, type ReactElement } from 'react';
import { Text as RNText } from 'react-native';

/**
 * Shared design language for the "modern & clean bubbly" redesign.
 * Purple-forward, generous radii, frosted glass, Plus Jakarta Sans typography.
 */

// ── Palette ──────────────────────────────────────────────────────────────────
// Purple is the identity. Shades run from near-black plum backgrounds up to soft
// lilac highlights. A few muted accents are used sparingly for status only.
export const C = {
  bg: '#0c0716',        // app background (deep plum-black)
  bgDeep: '#080411',    // darkest layer
  bgRaise: '#150d24',   // raised surface base

  // purple shades
  p950: '#2e1065',
  p900: '#3b0764',
  p800: '#4c1d95',
  p700: '#6d28d9',
  p600: '#7c3aed',
  p500: '#a855f7',
  p400: '#c084fc',
  p300: '#d8b4fe',
  p200: '#e9d5ff',
  lilac: '#b794f6',

  // sparing accents (status only)
  rose: '#fb7185',
  amber: '#fbbf24',
  green: '#34d399',
  sky: '#7dd3fc',

  // text
  text: '#f6f2ff',
  textDim: '#bca9dd',
  textFaint: '#7e6fa0',

  // glass
  glass: 'rgba(255,255,255,0.055)',
  glassStrong: 'rgba(255,255,255,0.09)',
  glassBorder: 'rgba(216,180,254,0.16)',
};

// ── Business palette ─────────────────────────────────────────────────────────
// Professional, serious-but-modern. Deep navy/steel surfaces with one confident
// blue accent + restrained teal/amber/red for status. Less playful than the
// personal (purple) theme: tighter, more structured, fintech-dashboard feel.
export const B = {
  bg: '#0a0e17',
  bgDeep: '#06090f',
  bgRaise: '#111928',

  slate900: '#0f1626',
  slate800: '#1a2336',
  slate700: '#27324a',

  // primary accent (modern professional blue)
  accent: '#5b8cff',
  accentDeep: '#3b6fe0',
  accentSoft: '#9fbbff',

  // status accents
  teal: '#2dd4bf',
  amber: '#f5b14c',
  red: '#f06a6a',
  green: '#34d399',

  text: '#eef2fb',
  textDim: '#9aa7c2',
  textFaint: '#5f6c86',

  glass: 'rgba(255,255,255,0.045)',
  glassStrong: 'rgba(255,255,255,0.075)',
  glassBorder: 'rgba(120,150,210,0.16)',
};

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
export function glow(color: string = C.p500, opacity = 0.45, radius = 22) {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: opacity,
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
 * This used to set Text.defaultProps, which does nothing here. React 19 still
 * honours defaultProps via createElement, but JSX compiles to jsx() from
 * react/jsx-runtime — the app is on the automatic runtime, since babel.config
 * sets jsxImportSource — and jsx() ignores them. Verified against the project's
 * own React 19.0.0: createElement applies them, jsx() does not. So the font
 * rollout only ever reached components that set fontFamily themselves.
 *
 * Wrapping the forwardRef's render is the path that actually runs. The default
 * goes first in the style array so any caller-supplied style still wins.
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
