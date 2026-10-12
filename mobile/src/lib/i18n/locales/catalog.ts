/**
 * The full string catalogue: each language's base file plus the feature
 * fragments.
 *
 * A fragment is one file holding one namespace in all four languages
 * (`{ "en": {...}, "fr": {...}, "zh": {...}, "ar": {...} }`), mounted at the
 * top level under the file's name: the keys of `subsUi.json` are read as subsUi.<key>.
 * Fragments exist so that features built at the same time each own their own
 * strings instead of all editing the same four 1,700-line files.
 *
 * Metro needs static imports, so a new fragment is added here by hand. A
 * fragment's name must not already be a top-level key of the base files; a
 * test fails if it is, because the fragment would silently replace it.
 */
import enBase from './en.json';
import frBase from './fr.json';
import zhBase from './zh.json';
import arBase from './ar.json';

import bankLink from './fragments/bankLink.json';
import emailConnect from './fragments/emailConnect.json';
import onboardingFlow from './fragments/onboardingFlow.json';
import subsNotify from './fragments/subsNotify.json';
import subsUi from './fragments/subsUi.json';

type Lang = 'en' | 'fr' | 'zh' | 'ar';
type Fragment = Record<Lang, Record<string, unknown>>;

export const FRAGMENTS: Record<string, Fragment> = {
  bankLink,
  emailConnect,
  onboardingFlow,
  subsNotify,
  subsUi,
};

function withFragments<T extends Record<string, unknown>>(base: T, lang: Lang): T {
  const merged: Record<string, unknown> = { ...base };
  for (const [ns, fragment] of Object.entries(FRAGMENTS)) merged[ns] = fragment[lang];
  return merged as T;
}

export const BASE = { en: enBase, fr: frBase, zh: zhBase, ar: arBase };

export const en = withFragments(enBase, 'en');
export const fr = withFragments(frBase, 'fr');
export const zh = withFragments(zhBase, 'zh');
export const ar = withFragments(arBase, 'ar');
