import { create } from 'zustand';

/**
 * Which theme the app uses, as something React can subscribe to.
 *
 * Until now the scheme came straight from `useColorScheme()`, so the app
 * simply obeyed the OS and offered no way to disagree with it. That is a
 * problem for this redesign in particular: DESIGN-PROMPT.md §2 says "light is
 * the app" and dark is a derivation of it, so a user whose phone is set to
 * dark had no way to see the design as it was drawn.
 *
 * Three states, not a switch. "System" has to remain distinct from an explicit
 * choice — a toggle that starts in whatever position the OS happens to be in
 * silently converts every user into a permanent override the first time they
 * touch it, and they stop following the OS without being told.
 *
 * The resolution is a pure function so it can be tested; the persistence
 * imports AsyncStorage lazily, inside the call, so importing this module
 * stays free of native code.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

const KEY = 'theme.preference';

/**
 * The scheme actually rendered, given the preference and what the OS reports.
 *
 * `system` with an unknown OS value resolves to light rather than dark: light
 * is the designed default, and falling back to the derivation would show the
 * wrong app to anyone whose platform does not report a scheme.
 */
export function resolveScheme(
  preference: ThemePreference,
  systemScheme: Scheme | null | undefined
): Scheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

/** Narrow a stored string, so a corrupt value falls back rather than throwing. */
export function parsePreference(stored: string | null | undefined): ThemePreference {
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

export interface ThemeStore {
  preference: ThemePreference;
  /** False until the stored choice has been read, so nothing flashes first. */
  loaded: boolean;
  choose: (preference: ThemePreference) => Promise<void>;
  load: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  preference: 'system',
  loaded: false,

  choose: async (preference: ThemePreference) => {
    if (get().preference === preference) return;
    // Set first, persist after: the palette should follow the tap immediately,
    // and a storage failure is not a reason to leave the UI on the old theme.
    set({ preference });
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem(KEY, preference);
    } catch {
      // Preference is lost on next launch; the current session still honours it.
    }
  },

  load: async () => {
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      set({ preference: parsePreference(await AsyncStorage.getItem(KEY)), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
