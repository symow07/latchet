import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, ActivityIndicator, AppState } from 'react-native';
import { initializeDatabase } from '@/lib/db';
import { startCloudSync } from '@/lib/cloud-sync';
import { loadRates } from '@/lib/rates';
import { initLocale } from '@/lib/i18n/bootstrap';
import { useLocaleStore } from '@/lib/i18n/locale-store';
import { useThemeStore } from '@/lib/theme-store';
import { useSession, SESSION_QUERY_KEY } from '@/lib/auth/use-session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBiometricAvailable, authenticateWithBiometrics } from '@/lib/biometric';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { useAccountTypeStore, type AccountTypeStore } from '@/lib/account-type-store';
import { registerForPushNotifications, scheduleStreakReminder } from '@/lib/notifications';
import { setUserId, logoutUser } from '@/lib/revenuecatClient';
import { F, R, S, useC, useScheme } from '@/lib/design';
import { t } from '@/lib/i18n/core';
import { Lock } from '@/components/icons';
import { drainPendingCaptures } from '@/lib/pending-drain';
import { drainSharedItems } from '@/lib/share-drain';
import { shouldRelock } from '@/lib/biometric-relock';
import { usePendingNavigationStore } from '@/lib/pending-navigation-store';
import { listenForQuickAdd } from '@/lib/quick-add-notify';
import { listenForNotificationTaps } from '@/lib/notification-taps';

// Silence verbose console.log in release builds (startup/gate/api tracing stays
// available in dev via expo.log). warn/error still surface for crash reporting.
if (!__DEV__) {
  console.log = () => {};
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Hard backstop: native splash must never block the UI for more than 8s,
// no matter what happens in JS. After 8s the JS UI takes over even if the
// startup pipeline is still working.
setTimeout(() => {
  SplashScreen.hideAsync().catch(() => {});
  console.log('[startup] SplashScreen.hideAsync called (8s backstop)');
}, 8000);

const queryClient = new QueryClient();

const DB_INIT_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function StartupScreen({ stage }: { stage: string }) {
  const C = useC();
  return (
    <View style={{ flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <ActivityIndicator size="large" color={C.accent} />
      <Text style={{ color: C.text, fontSize: 18, fontWeight: '600', marginTop: 24 }}>
        {t('startup.starting')}
      </Text>
      <Text style={{ color: C.textDim, fontSize: 13, marginTop: 8 }}>
        {stage}
      </Text>
    </View>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const C = useC();
  const insets = useSafeAreaInsets();
  const [authenticating, setAuthenticating] = useState(false);
  const authenticatingRef = useRef(false);

  const tryAuthenticate = useCallback(async () => {
    if (authenticatingRef.current) return;
    authenticatingRef.current = true;
    setAuthenticating(true);
    const success = await authenticateWithBiometrics();
    authenticatingRef.current = false;
    setAuthenticating(false);
    if (success) onUnlock();
  }, [onUnlock]);

  useEffect(() => {
    tryAuthenticate();
  }, []);

  // The same bone ground as everything behind it. This used to be a brown
  // gradient with an amber lock and amber outlined button — a colour scheme
  // that appears nowhere else in the product, on the first screen a returning
  // user sees. §1: one ground, and the accent is the profile's own.
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.ground,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingHorizontal: S.screen,
      }}
    >
      <View style={{ alignItems: 'center', marginBottom: 44 }}>
        <View style={{
          width: 64, height: 64, borderRadius: 20,
          backgroundColor: C.accentSoft,
          alignItems: 'center', justifyContent: 'center',
          marginBottom: 16,
        }}>
          <Lock size={26} color={C.accent} strokeWidth={S.stroke} />
        </View>
        <Text style={{ ...F.bold, color: C.ink, fontSize: 28, lineHeight: 36, letterSpacing: -0.28, marginBottom: 6 }}>
          Budget
        </Text>
        <Text style={{ ...F.regular, color: C.inkDim, fontSize: 16, lineHeight: 24, textAlign: 'center' }}>
          {t('startup.authenticate')}
        </Text>
      </View>

      <Pressable
        onPress={tryAuthenticate}
        accessibilityRole="button"
        style={({ pressed }: { pressed: boolean }) => ({
          opacity: pressed ? 0.85 : 1,
          alignSelf: 'stretch',
          height: 56,
          borderRadius: R.pill,
          backgroundColor: C.ink,
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <Text style={{ ...F.semibold, color: C.onInk, fontSize: 17 }}>
          {authenticating ? t('startup.authenticating') : t('startup.unlockBiometrics')}
        </Text>
      </Pressable>
    </View>
  );
}

function RootLayoutNav({ colorScheme }: { colorScheme: 'light' | 'dark' | null | undefined }) {
  const C = useC();
  const { data: session, isLoading: sessionLoading, error: sessionError } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const loadAccountType = useAccountTypeStore((s: AccountTypeStore) => s.load);
  const accountType = useAccountTypeStore((s: AccountTypeStore) => s.accountType);
  const accountTypeLoaded = useAccountTypeStore((s: AccountTypeStore) => s.loaded);

  // Manual bail-out only: if useSession surfaces an error, the user can tap
  // "Continue offline" (below) to set sessionTimedOut=true and reach the public
  // stack. There is intentionally no auto-trigger — the new useSession config
  // (10s timeout + 1 retry) needs up to ~21s to complete, so any timed
  // backstop shorter than that races the retry and produces a fake
  // logged-out state.
  const [sessionTimedOut, setSessionTimedOut] = useState(false);

  useEffect(() => {
    console.log('[mobile:gate] state', {
      sessionLoading,
      hasUser: !!session?.user,
      userId: session?.user?.id ?? null,
      sessionTimedOut,
      accountTypeLoaded,
      accountType,
      error: sessionError?.message ?? null,
    });
  }, [sessionLoading, session?.user, sessionError, sessionTimedOut, accountTypeLoaded, accountType]);

  // Load accountType from AsyncStorage when session is ready. Awaited so the
  // redirect useEffect always runs after the store has hydrated, eliminating
  // the implicit race window.
  useEffect(() => {
    if (sessionLoading || !session?.user?.id) return;
    let cancelled = false;
    const userId = session.user.id;
    (async () => {
      console.log(`[mobile:gate:loadAccountType] start userId=${userId}`);
      const t0 = Date.now();
      try {
        await loadAccountType(userId);
      } catch (e) {
        console.warn(
          `[mobile:gate:loadAccountType:error] ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (!cancelled) {
        console.log(`[mobile:gate:loadAccountType] done in ${Date.now() - t0}ms`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionLoading, session?.user?.id, loadAccountType]);

  // Redirect based on accountType when user is authenticated
  useEffect(() => {
    if (sessionLoading || !session?.user) return;
    if (!accountTypeLoaded) return;

    if (!accountType) {
      console.log('[mobile:gate:redirect] target=/account-type reason=accountType-missing');
      router.replace('/account-type');
    } else if (accountType === 'business') {
      console.log('[mobile:gate:redirect] target=/(business-tabs) reason=accountType-business');
      router.replace('/(business-tabs)');
    } else {
      // personal: default (tabs) route is correct, no redirect needed
      console.log('[mobile:gate:redirect] target=/(tabs) reason=accountType-personal-default');
    }
  }, [sessionLoading, session?.user, accountType, accountTypeLoaded, router]);

  // Open a receipt shared in from another app, once the auth gate has settled.
  // Any earlier and the redirect below replaces the route out from under it.
  const pendingRoute = usePendingNavigationStore((s) => s.route);
  const clearPendingRoute = usePendingNavigationStore((s) => s.setRoute);
  useEffect(() => {
    if (!pendingRoute || sessionLoading || !accountTypeLoaded) return;
    clearPendingRoute(null);
    router.push(pendingRoute as Parameters<typeof router.push>[0]);
  }, [pendingRoute, sessionLoading, accountTypeLoaded, router, clearPendingRoute]);

  // Register the device for push notifications (bill reminders, badge alerts)
  // and schedule the daily streak nudge — once per authenticated user.
  const pushRegisteredFor = useRef<string | null>(null);
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || pushRegisteredFor.current === userId) return;
    pushRegisteredFor.current = userId;
    registerForPushNotifications().catch(() => {});
    scheduleStreakReminder().catch(() => {});
  }, [session?.user?.id]);

  // Tell RevenueCat who this is — once per authenticated user, and log out
  // again when the session ends.
  //
  // Load-bearing: RevenueCat's app user id must equal the Better Auth user id,
  // because that is the only thing tying a purchase to an account. Without it
  // the webhook receives an id it cannot resolve and the purchase is never
  // applied — the user pays and stays on the free tier.
  const revenueCatIdentifiedAs = useRef<string | null>(null);
  useEffect(() => {
    const userId = session?.user?.id ?? null;

    if (!userId) {
      // Signed out: detach so a subsequent sign-in on this device does not
      // inherit the previous account's purchases.
      if (revenueCatIdentifiedAs.current) {
        revenueCatIdentifiedAs.current = null;
        logoutUser().catch(() => {});
      }
      return;
    }

    if (revenueCatIdentifiedAs.current === userId) return;
    revenueCatIdentifiedAs.current = userId;
    setUserId(userId).catch(() => {});
  }, [session?.user?.id]);

  // Surface session-fetch errors with a visible Retry instead of silently
  // forcing a logged-out state. The 6s sessionTimedOut backstop below remains
  // as the final escape hatch ("Continue offline" → fall through to public stack).
  if (!sessionLoading && sessionError && !sessionTimedOut) {
    return (
      <View style={{ flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ ...F.bold, color: C.negative, fontSize: 20, marginBottom: 8 }}>
          {t('startup.serverUnreachable')}
        </Text>
        <Text style={{ color: C.textDim, fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
          {sessionError instanceof Error ? sessionError.message : t('errors.unknown')}
        </Text>
        <Pressable
          onPress={() => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })}
          style={{ paddingHorizontal: 32, height: 56, justifyContent: 'center', borderRadius: R.pill, backgroundColor: C.ink }}
        >
          <Text style={{ ...F.semibold, color: C.onInk, fontSize: 17 }}>{t('startup.retry')}</Text>
        </Pressable>
        <Pressable
          onPress={() => setSessionTimedOut(true)}
          style={{ marginTop: 12, paddingHorizontal: 32, paddingVertical: 14 }}
        >
          <Text style={{ color: C.textFaint, fontSize: 14 }}>{t('startup.continueOffline')}</Text>
        </Pressable>
      </View>
    );
  }

  if (sessionLoading && !sessionTimedOut) return <StartupScreen stage="Checking session…" />;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Protected: only accessible when signed in */}
        <Stack.Protected guard={!!session?.user}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="accounts" options={{ headerShown: false }} />
          <Stack.Screen name="analytics" options={{ headerShown: false }} />
          <Stack.Screen name="link-bank" options={{ headerShown: false }} />
          <Stack.Screen name="health-score" options={{ headerShown: false }} />
          <Stack.Screen name="import" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="net-worth" options={{ headerShown: false }} />
          <Stack.Screen name="bill-reminders" options={{ headerShown: false }} />
          <Stack.Screen name="recurring" options={{ headerShown: false }} />
          <Stack.Screen name="category-budgets" options={{ headerShown: false }} />
          <Stack.Screen name="subscriptions" options={{ headerShown: false }} />
          <Stack.Screen name="subscription-detail" options={{ headerShown: false }} />
          <Stack.Screen name="email-inbox" options={{ headerShown: false }} />
          {/* Account type & business navigation */}
          <Stack.Screen name="account-type" options={{ headerShown: false }} />
          <Stack.Screen name="(business-tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="business-tools" options={{ headerShown: false }} />
          <Stack.Screen name="business-profile" options={{ headerShown: false }} />
          <Stack.Screen name="business-tax" options={{ headerShown: false }} />
          <Stack.Screen name="currency" options={{ headerShown: false }} />
        </Stack.Protected>

        {/* Public: only accessible when NOT signed in */}
        <Stack.Protected guard={!session?.user}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="signup" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

/**
 * Transactions captured without opening the app — Siri shortcuts, and amounts
 * typed into the evening streak reminder.
 *
 * The Siri queue is drained once the database is up and again on every
 * foreground: the app can be backgrounded, a shortcut fired, and the app
 * resumed without a fresh launch, so mount alone would miss it. The
 * notification path is a listener instead, because iOS delivers the response
 * rather than leaving it somewhere to be found.
 */
/**
 * Ask for Face ID again when the app comes back from the background.
 *
 * The setting reads "Require Face ID / Fingerprint on open" and only ever
 * honoured a cold start: backgrounding and returning walked straight into the
 * user's finances, which is exactly the case the setting exists for.
 *
 * Only `background` is tracked, never `inactive`. iOS reports `inactive` while
 * the Face ID sheet itself is up, and for the app-switcher preview — treating
 * those as leaving would re-lock during the very prompt meant to unlock.
 *
 * The stored flag is re-read on each return rather than cached, so switching
 * the setting off takes effect without restarting the app.
 */
function useBiometricRelock(onRelock: () => void) {
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (state !== 'active') return;

      const wentAway = backgroundedAt.current;
      backgroundedAt.current = null;
      if (wentAway === null) return;

      AsyncStorage.getItem('@biometric_lock')
        .then((value) => {
          if (shouldRelock({ enabled: value === 'true', backgroundedAt: wentAway, now: Date.now() })) {
            onRelock();
          }
        })
        // Failing to read the flag must not lock someone out of an app they
        // never asked to lock.
        .catch(() => {});
    });
    return () => subscription.remove();
  }, [onRelock]);
}

function usePendingCaptures(dbReady: boolean) {
  // Parked, not navigated to. The drain runs as soon as the database is ready,
  // which is before the auth gate has decided where the user belongs — a push
  // here is wiped by the router.replace that follows. RootLayoutNav opens it
  // once that has settled.
  const setPendingRoute = usePendingNavigationStore((s) => s.setRoute);

  useEffect(() => {
    if (!dbReady) return;

    let cancelled = false;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    };

    const drain = async () => {
      try {
        const inserted = await drainPendingCaptures();
        if (inserted > 0 && !cancelled) refresh();
      } catch (e) {
        // Capture is a convenience. Failing it must never break a launch.
        console.warn('[pending-capture] drain failed', e);
      }

      try {
        const { inserted, receiptUri } = await drainSharedItems();
        if (cancelled) return;
        if (inserted > 0) refresh();
        // A shared photo cannot be written blind — it has to go through the
        // vision model and a review. Opening the reader is what the user asked
        // for by sharing it, so the navigation is expected rather than intrusive.
        if (receiptUri) setPendingRoute({ pathname: '/receipt-scan', params: { sharedUri: receiptUri } });
      } catch (e) {
        console.warn('[share] drain failed', e);
      }
    };

    drain();
    const stopListening = listenForQuickAdd(refresh);
    // Tapping a bill reminder used to open the app wherever it was last left.
    const stopTaps = listenForNotificationTaps((route) => setPendingRoute(route));
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') drain();
    });
    return () => {
      cancelled = true;
      stopListening();
      stopTaps();
      sub.remove();
    };
  }, [dbReady, setPendingRoute]);
}

export default function RootLayout() {
  const C = useC();
  const localeVersion = useLocaleStore((s) => s.version);
  // The user's theme choice, not the raw OS value: otherwise React
  // Navigation paints dark chrome underneath a light-themed app.
  const colorScheme = useScheme();
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [stage, setStage] = useState<string>('Booting…');

  usePendingCaptures(dbReady);
  // useCallback so the listener is not torn down and rebuilt on every render.
  useBiometricRelock(useCallback(() => setLocked(true), []));

  // No font loading. The app renders in the platform face now, which is
  // already on the device — so startup no longer waits on four webfont files
  // before it can paint anything, and there is no default-font patch to apply
  // once they land.

  useEffect(() => {
    console.log('[startup] RootLayout mounted');
  }, []);

  // Read the stored theme choice as early as possible. It is deliberately not
  // inside initApp: that waits on the database, and the theme has nothing to
  // do with the database — gating it there would paint one frame of the wrong
  // scheme behind the startup screen.
  const loadTheme = useThemeStore((s) => s.load);
  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  const initApp = useCallback(async () => {
    setDbError(null);
    setStage('Opening database…');
    console.log('[startup] initializeDatabase start');
    try {
      await withTimeout(initializeDatabase(), DB_INIT_TIMEOUT_MS, 'initializeDatabase');
      console.log('[startup] initializeDatabase success');
      // Language before any screen renders, so nothing flashes in English first.
      // Startup applies the stored language directly to i18n-js, so the
      // store has to be told what it landed on or the first change looks
      // like a no-op.
      await initLocale()
        .then((applied) => useLocaleStore.getState().sync(applied))
        .catch(() => {});
    } catch (e) {
      console.error('[startup] initializeDatabase error', e);
      setDbError(e instanceof Error ? e.message : t('errors.dbInit'));
      return;
    } finally {
      // Always hide splash once we've reached this branch — error UI or success UI both
      // need the JS surface visible. Backstop in the module also covers this.
      SplashScreen.hideAsync().catch(() => {});
      console.log('[startup] SplashScreen.hideAsync called (after DB init)');
    }

    // Biometric check — must never hang the app. Bound to 2s.
    setStage('Checking biometrics…');
    console.log('[startup] biometric check start');
    try {
      const val = await withTimeout(AsyncStorage.getItem('@biometric_lock'), 2000, 'AsyncStorage.getItem(@biometric_lock)');
      if (val === 'true') {
        const available = await withTimeout(isBiometricAvailable(), 2000, 'isBiometricAvailable');
        if (available) setLocked(true);
      }
      console.log('[startup] biometric check success');
    } catch (e) {
      console.warn('[startup] biometric check error (continuing)', e);
    }

    setStage('Ready');
    setDbReady(true);
    console.log('[startup] dbReady true');
  }, []);

  useEffect(() => {
    initApp();
  }, [initApp]);

  // Back up local writes to the cloud. Registered once the database is open so
  // the debounced push never races initialization.
  useEffect(() => {
    if (!dbReady) return;
    // Best-effort: conversions fall back to the cached or bundled table.
    loadRates().catch(() => {});
    return startCloudSync();
  }, [dbReady]);

  if (dbError) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ ...F.bold, color: C.negative, fontSize: 20, marginBottom: 12 }}>
            {t('startup.errorTitle')}
          </Text>
          <Text style={{ color: C.textDim, fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            {dbError}
          </Text>
          <Pressable
            onPress={initApp}
            style={{ paddingHorizontal: 32, height: 56, justifyContent: 'center', borderRadius: R.pill, backgroundColor: C.ink }}
          >
            <Text style={{ ...F.semibold, color: C.onInk, fontSize: 17 }}>{t('startup.retry')}</Text>
          </Pressable>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!dbReady) {
    return (
      <SafeAreaProvider>
        <StartupScreen stage={stage} />
      </SafeAreaProvider>
    );
  }

  if (locked) {
    return (
      <SafeAreaProvider>
        <LockScreen onUnlock={() => setLocked(false)} />
      </SafeAreaProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          {/* Keyed on the locale: t() reads a module singleton that no
              component subscribes to, so without a remount only the screen
              that made the change re-renders. See lib/i18n/locale-store.ts. */}
          <RootLayoutNav key={localeVersion} colorScheme={colorScheme} />
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
