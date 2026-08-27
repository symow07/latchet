import { create } from 'zustand';
import { chooseLocale } from './bootstrap';
import { getLocale, type AppLocale } from './core';

/**
 * The active language, as something React can subscribe to.
 *
 * i18n-js keeps the locale on a module singleton, and `t()` reads it at call
 * time. That is fine for correctness and useless for reactivity: changing the
 * locale mutates a variable no component is watching, so already-mounted
 * screens keep whatever strings they last rendered.
 *
 * The settings screen used to call `queryClient.invalidateQueries()` and note
 * that "every screen reads t() at render, so re-running the queries is
 * enough". It is not. Invalidating re-renders the components subscribed to
 * those queries; a screen on another tab is subscribed to nothing that
 * changed, and half the strings in the app are not inside a query result at
 * all. The visible effect was that Settings switched language and nothing
 * else did until the app was restarted — the choice was persisted correctly
 * the whole time.
 *
 * `version` is what makes a re-render unavoidable: the root keys the
 * navigation tree on it, so picking a language remounts every screen with the
 * new strings. That resets navigation to the initial route, which is the
 * accepted trade — a language change is rare, deliberate, and the alternative
 * is threading a hook through all 36 screens.
 */
export interface LocaleStore {
  locale: AppLocale;
  /** Bumped on every change; used as a remount key, never rendered. */
  version: number;
  /** Resolves true when the layout direction changed and a restart is needed. */
  choose: (locale: AppLocale) => Promise<boolean>;
  /** Sync the store to a locale applied outside it, e.g. at startup. */
  sync: (locale: AppLocale) => void;
}

export const useLocaleStore = create<LocaleStore>((set, get) => ({
  locale: getLocale(),
  version: 0,

  choose: async (locale: AppLocale) => {
    if (get().locale === locale) return false;
    const restartNeeded = await chooseLocale(locale);
    set((s) => ({ locale, version: s.version + 1 }));
    return restartNeeded;
  },

  sync: (locale: AppLocale) => {
    if (get().locale === locale) return;
    set({ locale });
  },
}));
