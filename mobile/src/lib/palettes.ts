/**
 * Colour palettes, as plain data.
 *
 * Kept free of any react-native import so the values can be unit-tested
 * without a simulator — design.ts adds the hooks that pick between them.
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

export const C_DARK: Palette = {
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

export const C_LIGHT: Palette = {
  scheme: 'light',
  bg: '#ffffff', bgDeep: '#f2eef8', bgRaise: '#faf7fd',
  p950: '#2e1065', p900: '#3b0764', p800: '#4c1d95', p700: '#581c87', p600: '#6b21a8',
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

export const B_DARK: BizPalette = {
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

export const B_LIGHT: BizPalette = {
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
