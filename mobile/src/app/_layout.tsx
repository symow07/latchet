import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Pressable, ActivityIndicator, AppState } from 'react-native';
import { activeUserId } from '@/lib/db';
import { activateUser, deactivateUser } from '@/lib/user-session';
import { UserDatabaseSupersededError } from '@/lib/user-db';
import { clearUserQueries } from '@/lib/use-sign-out';
import { needsFirstPull, requestPull, startCloudSync, syncNow } from '@/lib/cloud-sync';
import { restoreReturningAccount } from '@/lib/returning-account';
import { loadRates } from '@/lib/rates';
import { applyUserLocale, initDeviceLocale } from '@/lib/i18n/bootstrap';
import { useLocaleStore } from '@/lib/i18n/locale-store';
import { useThemeStore } from '@/lib/theme-store';
import { useSession, SESSION_QUERY_KEY } from '@/lib/auth/use-session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBiometricAvailable, authenticateWithBiometrics } from '@/lib/biometric';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { useAccountTypeStore, type AccountTypeStore } from '@/lib/account-type-store';
import { profileRedirect } from '@/lib/profile-route';
import {
  applyDefaultStreakReminder,
  clearSubscriptionNotifications,
  registerForPushNotifications,
  registerSubscriptionCategory,
} from '@/lib/notifications';
import { onDetectionChange, runDetection, SUBSCRIPTIONS_QUERY_KEY } from '@/lib/subscription-detection';
import { syncEmailIfDue } from '@/lib/email-connections';
import { setUserId, logoutUser } from '@/lib/revenuecatClient';
import { S, useC, useScheme, type Palette } from '@/lib/design';
import { IconTile, PrimaryButton, Type } from '@/components/kit';
import { t } from '@/lib/i18n/core';
import { Lock } from '@/components/icons';
import { drainPendingCaptures } from '@/lib/pending-drain';
import { drainSharedItems } from '@/lib/share-drain';
import { shouldRelock } from '@/lib/biometric-relock';
import { usePendingNavigationStore } from '@/lib/pending-navigation-store';
import { listenForQuickAdd } from '@/lib/quick-add-notify';
import { listenForNotificationTaps } from '@/lib/notification-taps';
import * as Sentry from '@sentry/react-native';
import { initCrashReporting, setCrashReportingUser } from '@/lib/crash-reporting';

// Crash reporting first, so the rest of startup is covered. Off unless the
// build has a DSN; nothing personal is sent (lib/crash-reporting.ts).
initCrashReporting(Sentry);

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

/**
 * How long activation waits for a fresh database's first pull before showing
 * the app anyway. Long enough for a normal restore; the pull carries on in the
 * background after it.
 */
const FIRST_PULL_WAIT_MS = 10_000;

/**
 * The user whose account language has been applied. Module scope, not state:
 * RootLayoutNav remounts on every language change (it is keyed on the locale
 * version), and re-applying the stored language on each remount could undo
 * the very choice that caused it.
 */
let localeAppliedFor: string | null = null;

/**
 * The user whose database's first subscription detection has run, in module
 * scope for the same reason: a language change remounts RootLayoutNav, and
 * "once after the database activates" must not become once per language.
 */
let detectionStartedFor: string | null = null;

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

/** Resolves `true` once `promise` settles within `ms`, `false` if it is still running. */
function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    promise.then(
      () => {
        clearTimeout(t);
        resolve(true);
      },
      () => {
        clearTimeout(t);
        resolve(true);
      },
    );
  });
}

/**
 * A fresh database's first pull: the account's ledger, accounts, settings,
 * categories and subscriptions come down before any screen reads them. Then,
 * if the server shows the account has been here before, its profile and
 * onboarding are restored instead of asked again (returning-account.ts) — the
 * picker and onboarding would otherwise write a new account's settings over
 * the ones it has.
 */
async function restoreAccount(userId: string): Promise<boolean> {
  const report = await syncNow();
  const pulled = !!report?.pulled.complete && activeUserId() === userId;
  await restoreReturningAccount(userId, pulled).catch((e) =>
    console.warn('[mobile:gate:restore] returning-account check failed', e),
  );
  return pulled;
}

/** Apply the account's language (it lives in the synced settings row) and tell the store. */
async function applyAccountLocale(remount: boolean): Promise<void> {
  const applied = await applyUserLocale();
  if (!remount) {
    useLocaleStore.getState().sync(applied);
    return;
  }
  // Screens are already up: t() is read at render, so they remount in it.
  if (useLocaleStore.getState().locale !== applied) {
    useLocaleStore.setState((s) => ({ locale: applied, version: s.version + 1 }));
  }
}

/**
 * React Navigation's chrome in the identity's colours rather than its stock
 * themes, whose iOS-blue primary and near-black dark background would show
 * behind every screen transition and in any system header.
 */
function navigationTheme(C: Palette, dark: boolean): Theme {
  const base = dark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark,
    colors: {
      ...base.colors,
      background: C.ground,
      card: C.groundAlt,
      text: C.ink,
      border: C.hairline,
      primary: C.accent,
      notification: C.negative,
    },
  };
}

/** What the boot sequence is doing, shown under the spinner. */
type BootStage = 'starting' | 'biometrics' | 'ready';

function bootStageLabel(stage: BootStage): string {
  if (stage === 'biometrics') return t('startup.stageBiometrics');
  if (stage === 'ready') return t('startup.stageReady');
  return t('startup.stageStarting');
}

/** The first thing painted after the splash: the page, a tint spinner, ink. */
function StartupScreen({ stage }: { stage: string }) {
  const C = useC();
  return (
    <View style={{ flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center', padding: S.screen }}>
      <ActivityIndicator size="large" color={C.accent} />
      <Type role="cardTitle" color={C.ink} style={{ marginTop: 24 }}>
        {t('startup.starting')}
      </Type>
      <Type role="meta" color={C.inkDim} style={{ marginTop: 8 }}>
        {stage}
      </Type>
    </View>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const C = useC();
  const insets = useSafeAreaInsets();
  const [authenticating, setAuthenticating] = useState(false);
  const authenticatingRef = useRef(false);

  // The latest onUnlock, read when a prompt succeeds. Held in a ref so that
  // tryAuthenticate never changes identity: a parent passing a new arrow on
  // each render would otherwise re-run the effect below and raise Face ID
  // again on every render while the lock is up.
  const onUnlockRef = useRef(onUnlock);
  useEffect(() => {
    onUnlockRef.current = onUnlock;
  }, [onUnlock]);

  const tryAuthenticate = useCallback(async () => {
    if (authenticatingRef.current) return;
    authenticatingRef.current = true;
    setAuthenticating(true);
    const success = await authenticateWithBiometrics();
    authenticatingRef.current = false;
    setAuthenticating(false);
    if (success) onUnlockRef.current();
  }, []);

  // Prompt once, when the lock appears. tryAuthenticate is stable, so this
  // runs on mount only — with its dependencies complete rather than waived.
  useEffect(() => {
    tryAuthenticate();
  }, [tryAuthenticate]);

  // The same off-white ground as everything behind it. This used to be a
  // brown gradient with an amber lock and amber outlined button — a colour
  // scheme that appears nowhere else in the product, on the first screen a
  // returning user sees. Now: the page, a platinum tile with an ink lock, and
  // the espresso button as the screen's one anchor.
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
        <IconTile pal={C} size={56} style={{ marginBottom: 16 }}>
          <Lock size={26} color={C.ink} strokeWidth={S.stroke} />
        </IconTile>
        <Type role="headline" color={C.ink} style={{ marginBottom: 6 }}>
          Budget
        </Type>
        <Type role="body" color={C.inkDim} style={{ textAlign: 'center' }}>
          {t('startup.authenticate')}
        </Type>
      </View>

      <PrimaryButton
        pal={C}
        label={authenticating ? t('startup.authenticating') : t('startup.unlockBiometrics')}
        onPress={tryAuthenticate}
        style={{ alignSelf: 'stretch' }}
      />
    </View>
  );
}

function RootLayoutNav({ colorScheme }: { colorScheme: 'light' | 'dark' | null | undefined }) {
  const C = useC();
  // Memoised so the navigation context only changes when the scheme does.
  const navTheme = useMemo(() => navigationTheme(C, colorScheme === 'dark'), [C, colorScheme]);
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

  const userId = session?.user?.id ?? null;
  const resetAccountType = useAccountTypeStore((s: AccountTypeStore) => s.reset);

  // The user whose database is open and ready: the gate every screen behind
  // the auth guard waits on, because every one of them reads it. Seeded from
  // the registry so the remount a language change causes (this component is
  // keyed on the locale) does not flash the startup screen.
  const [dbUser, setDbUser] = useState<string | null>(() => activeUserId());
  const [dbError, setDbError] = useState<string | null>(null);
  const [activationAttempt, setActivationAttempt] = useState(0);
  const previousUser = useRef<string | null>(activeUserId());

  // Open the signed-in user's own database once the session says who that is,
  // switch when it names someone else, and close it when it names nobody.
  // Nothing opens a database before this: there is no shared one any more.
  useEffect(() => {
    if (sessionLoading) return;

    if (previousUser.current !== null && previousUser.current !== userId) {
      // A different user, or none: what the previous user's screens loaded is
      // still cached, and must not be shown to whoever comes next. (Explicit
      // sign-out has already done this; a session that simply ended has not.)
      clearUserQueries(queryClient);
      resetAccountType();
      // Their subscription reminders too: the next person on this phone must
      // not be told when the last one's Netflix renews.
      clearSubscriptionNotifications().catch(() => {});
    }
    previousUser.current = userId;

    if (!userId) {
      setDbUser(null);
      localeAppliedFor = null;
      detectionStartedFor = null;
      deactivateUser().catch((e) => console.warn('[mobile:gate:db] close failed', e));
      return;
    }

    let cancelled = false;
    setDbError(null);
    if (activeUserId() !== userId) setDbUser(null);
    (async () => {
      const t0 = Date.now();
      try {
        await withTimeout(activateUser(userId), DB_INIT_TIMEOUT_MS, 'activateUser');
        if (cancelled) return;
        // A database this phone has never pulled into (a first sign-in, a
        // reinstall, a sign-in after sign-out) restores the account before
        // anything renders — bounded, so a slow network cannot hold the app.
        if (await needsFirstPull()) {
          const restoring = restoreAccount(userId);
          if (!(await settledWithin(restoring, FIRST_PULL_WAIT_MS))) {
            console.warn('[mobile:gate:db] first pull still running; continuing');
            // When it lands, the account's language follows it.
            restoring
              .then((pulled) => (pulled && activeUserId() === userId ? applyAccountLocale(true) : undefined))
              .catch(() => {});
          }
          if (cancelled) return;
        }
        // The account's own language, once per activation — it lives in the
        // user's settings row, so it is read after that row has been pulled.
        if (localeAppliedFor !== userId) {
          localeAppliedFor = userId;
          await applyAccountLocale(false);
        }
        if (cancelled) return;
        console.log(`[mobile:gate:db] ready userId=${userId} in ${Date.now() - t0}ms`);
        setDbUser(userId);
      } catch (e) {
        // Superseded: a sign-out or another user overtook this activation.
        if (cancelled || e instanceof UserDatabaseSupersededError) return;
        // The detail is for the log; the screen says it in the user's language.
        console.error('[mobile:gate:db] activation failed', e);
        setDbError(t('errors.dbInit'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionLoading, userId, activationAttempt, queryClient, resetAccountType]);

  /** The signed-in user's database is open: screens behind the auth guard may render. */
  const dbReady = userId !== null && dbUser === userId;
  const signedIn = !!session?.user;

  // On a cold start the navigator is not mounted until the signed-in user's
  // database is open, as it used to wait for the shared one: expo-router
  // resolves the launch URL (a deep link, or "/") when the navigator first
  // mounts, and every screen that URL can name reads the database. After that
  // — signing in from the login screen, or the session changing hands — the
  // navigator is already up and has to stay up, so the gate covers it instead.
  const [navigatorUp, setNavigatorUp] = useState(false);
  const showNavigator = navigatorUp || !(signedIn && !dbReady);
  useEffect(() => {
    if (showNavigator && !navigatorUp) setNavigatorUp(true);
  }, [showNavigator, navigatorUp]);

  // Siri and share-sheet captures, only into an open user database.
  usePendingCaptures(dbUser);

  // Subscription detection by itself, for the user whose database is open.
  useSubscriptionTriggers(dbUser);

  // Two-way sync for the user whose database is open: local writes, the app
  // coming to the front and a 60 s interval (lib/cloud-sync.ts), and one
  // cycle now. Torn down when the user changes, so nothing scheduled for one
  // user runs in the next one's session. A pull that changed local data
  // refreshes every screen's queries (the session's excepted).
  useEffect(() => {
    if (!dbUser) return;
    const stop = startCloudSync({
      onRemoteChange: () => {
        queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0] });
      },
    });
    requestPull();
    return stop;
  }, [dbUser, queryClient]);

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

  // Keep each account on its own profile's screens. Both tab groups have an
  // index, so "/" is ambiguous, and on a cold start it resolved to the
  // business tabs for a personal account; this used to redirect business
  // accounts only, assuming "/" meant personal. profileRedirect decides from
  // the route the app is actually on (profile-route.ts, tested), so it also
  // runs when the route changes, and does nothing once the account is home.
  const segments = useSegments();
  useEffect(() => {
    if (sessionLoading || !session?.user) return;
    if (!accountTypeLoaded) return;
    // The signed-in screens only exist once the user's database is open (see
    // the guards below); redirecting before then would name a screen that is
    // not there.
    if (!dbReady) return;

    const target = profileRedirect(accountType, segments);
    if (!target) return;
    console.log(
      `[mobile:gate:redirect] target=${target} accountType=${accountType ?? 'null'} from=/${segments.join('/')}`,
    );
    router.replace(target);
  }, [sessionLoading, session?.user, accountType, accountTypeLoaded, dbReady, router, segments]);

  // Open a receipt shared in from another app, once the auth gate has settled.
  // Any earlier and the redirect below replaces the route out from under it.
  const pendingRoute = usePendingNavigationStore((s) => s.route);
  const clearPendingRoute = usePendingNavigationStore((s) => s.setRoute);
  useEffect(() => {
    if (!pendingRoute || sessionLoading || !accountTypeLoaded || !dbReady) return;
    clearPendingRoute(null);
    router.push(pendingRoute as Parameters<typeof router.push>[0]);
  }, [pendingRoute, sessionLoading, accountTypeLoaded, dbReady, router, clearPendingRoute]);

  // Register the device for push notifications (bill reminders, badge alerts)
  // and turn the daily streak nudge on by default the first time on this
  // device — after that the Settings switch alone decides. Neither asks for
  // permission any more: both go ahead only when it was already granted. The
  // first prompt comes with the first reminder worth scheduling
  // (notifications.ts). The subscription reminders' actions are registered
  // here too; registering a category asks for nothing.
  const pushRegisteredFor = useRef<string | null>(null);
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || pushRegisteredFor.current === userId) return;
    pushRegisteredFor.current = userId;
    registerForPushNotifications().catch(() => {});
    applyDefaultStreakReminder().catch(() => {});
    registerSubscriptionCategory().catch(() => {});
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

  // Crashes carry the signed-in account's opaque id and nothing else about
  // them — no email, no name — and no one once the session ends.
  useEffect(() => {
    if (sessionLoading) return;
    setCrashReportingUser(userId);
  }, [sessionLoading, userId]);

  // Surface session-fetch errors with a visible Retry instead of silently
  // forcing a logged-out state. The 6s sessionTimedOut backstop below remains
  // as the final escape hatch ("Continue offline" → fall through to public stack).
  if (!sessionLoading && sessionError && !sessionTimedOut) {
    return (
      <View style={{ flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center', padding: S.screen }}>
        <Type role="section" color={C.negative} style={{ marginBottom: 8, textAlign: 'center' }}>
          {t('startup.serverUnreachable')}
        </Type>
        <Type role="meta" color={C.inkDim} style={{ textAlign: 'center', marginBottom: 24 }}>
          {sessionError instanceof Error ? sessionError.message : t('errors.unknown')}
        </Type>
        <PrimaryButton
          pal={C}
          label={t('startup.retry')}
          onPress={() => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })}
          style={{ alignSelf: 'stretch' }}
        />
        <Pressable
          onPress={() => setSessionTimedOut(true)}
          accessibilityRole="button"
          style={{ marginTop: 12, paddingHorizontal: 32, paddingVertical: 14 }}
        >
          <Type role="meta" color={C.accent}>{t('startup.continueOffline')}</Type>
        </Pressable>
      </View>
    );
  }

  if (sessionLoading && !sessionTimedOut) return <StartupScreen stage={t('startup.stageSession')} />;

  // Signed in, but this user's database is not open yet, or failed to open.
  const activationGate = dbError ? (
    <View style={{ flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center', padding: S.screen }}>
      <Type role="section" color={C.negative} style={{ marginBottom: 12, textAlign: 'center' }}>
        {t('startup.errorTitle')}
      </Type>
      <Type role="meta" color={C.inkDim} style={{ textAlign: 'center', marginBottom: 24 }}>
        {dbError}
      </Type>
      <PrimaryButton
        pal={C}
        label={t('startup.retry')}
        onPress={() => setActivationAttempt((n) => n + 1)}
        style={{ alignSelf: 'stretch' }}
      />
    </View>
  ) : (
    <StartupScreen stage={t('startup.stageData')} />
  );

  if (!showNavigator) return activationGate;

  return (
    <ThemeProvider value={navTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Protected: only once signed in AND that user's own database is
            open, since every one of these screens reads it. A screen mounted
            any earlier would query a database that is still opening — or,
            right after another user signed out, one that is closed. */}
        <Stack.Protected guard={signedIn && dbReady}>
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
          {/* These read or write the signed-in user's own data — the health
              profile, the ledger, the household's accounts — so they wait for
              that user's database like the rest. Left undeclared they were
              reachable signed out, and stayed mounted across a change of
              session with the previous user's data in their state. */}
          <Stack.Screen name="advisor-profile" options={{ headerShown: false }} />
          <Stack.Screen name="receipt-scan" options={{ headerShown: false }} />
          <Stack.Screen name="household" options={{ headerShown: false }} />
          <Stack.Screen name="business-team" options={{ headerShown: false }} />
        </Stack.Protected>

        {/* Public: when not signed in — and while a signed-in user's database
            is still opening, so the navigator always has a screen to stand
            on. That moment is covered by the overlay below; once the database
            is open this group closes and the guard above takes over. */}
        <Stack.Protected guard={!signedIn || !dbReady}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="signup" options={{ headerShown: false }} />
          {/* Signed-out only, like sign-in: signing in closes this group, so
              a forgot-password screen still in the stack goes with it rather
              than being left on top of the app. */}
          <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
        </Stack.Protected>

        {/* Where the emailed links land: outside both guards. A reset or
            verification link opens whether or not anyone is signed in on this
            phone — even when someone else is. Neither reads the user's
            database. Declared after the public group so that login stays the
            first screen a signed-out launch can show; profile-route.ts leaves
            both alone (AUTH_LANDINGS). */}
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="verify-email" options={{ headerShown: false }} />
      </Stack>

      {/* The navigator is up but this user's database is not: cover it, rather
          than unmount it under the redirect that follows. */}
      {signedIn && !dbReady ? (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>{activationGate}</View>
      ) : null}
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

/**
 * Subscription detection without a Scan tap (lib/subscription-detection.ts).
 *
 * Once each time a user's database activates — for a phone whose first pull
 * has not completed, the run waits for it (cloud-sync runs it then). And email:
 * once per activation the server is asked which inboxes there are, and on
 * every return to the front, an inbox whose last sync is over half an hour old
 * is synced, which pulls its findings and runs detection. Imports and sync
 * pulls trigger their own runs (import.tsx, cloud-sync.ts). Every run, and
 * every decision, refreshes the screens that show subscriptions.
 */
function useSubscriptionTriggers(dbUser: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!dbUser) return;
    const stopListening = onDetectionChange(() => {
      queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['subscription-occurrences'] });
      queryClient.invalidateQueries({ queryKey: ['email-detected-biz'] });
    });

    if (detectionStartedFor !== dbUser) {
      detectionStartedFor = dbUser;
      void runDetection('startup');
      void syncEmailIfDue({ refresh: true });
    }

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncEmailIfDue();
    });
    return () => {
      stopListening();
      sub.remove();
    };
  }, [dbUser, queryClient]);
}

function usePendingCaptures(dbUser: string | null) {
  // Parked, not navigated to. The drain runs as soon as the user's database is
  // ready, which is before the auth gate has decided where the user belongs — a
  // push here is wiped by the router.replace that follows. RootLayoutNav opens
  // it once that has settled.
  const setPendingRoute = usePendingNavigationStore((s) => s.setRoute);

  useEffect(() => {
    // The queues are files on the phone, written while nobody may have been
    // signed in. They are drained only into an open user database, and each
    // drain is bound to that user: a switch tears this effect down, and a
    // drain already running stops rather than write into the next ledger.
    if (!dbUser) return;

    let cancelled = false;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    };

    const drain = async () => {
      try {
        const inserted = await drainPendingCaptures(dbUser);
        if (inserted > 0 && !cancelled) refresh();
      } catch (e) {
        // Capture is a convenience. Failing it must never break a launch.
        console.warn('[pending-capture] drain failed', e);
      }

      try {
        const { inserted, receiptUri } = await drainSharedItems(dbUser);
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
  }, [dbUser, setPendingRoute]);
}

function RootLayout() {
  const localeVersion = useLocaleStore((s) => s.version);
  // The user's theme choice, not the raw OS value: otherwise React
  // Navigation paints dark chrome underneath a light-themed app.
  const colorScheme = useScheme();
  // Boot is only what needs no user: language, splash, the biometric lock.
  // No database opens here. Each user's own database is opened by
  // RootLayoutNav once the session says who is signed in.
  const [booted, setBooted] = useState(false);
  const [locked, setLocked] = useState(false);
  // A step, not its words: the words are read at render, so once the
  // device's language is applied the next step shows in it.
  const [stage, setStage] = useState<BootStage>('starting');

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
  // inside initApp: the theme has nothing to do with anything initApp waits
  // on — gating it there would paint one frame of the wrong scheme behind the
  // startup screen.
  const loadTheme = useThemeStore((s) => s.load);
  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  const initApp = useCallback(async () => {
    setStage('starting');
    try {
      // Language before any screen renders, so nothing flashes in English
      // first: the phone's own until a user is known (the login screen), then
      // the account's, applied when that user's database opens. Startup
      // applies it directly to i18n-js, so the store has to be told what it
      // landed on or the first change looks like a no-op.
      await initDeviceLocale()
        .then((applied) => useLocaleStore.getState().sync(applied))
        .catch(() => {});
    } finally {
      // Always hide the splash once we get here. Backstop in the module also
      // covers this.
      SplashScreen.hideAsync().catch(() => {});
      console.log('[startup] SplashScreen.hideAsync called (after boot)');
    }

    // Biometric check — must never hang the app. Bound to 2s.
    setStage('biometrics');
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

    setStage('ready');
    setBooted(true);
    console.log('[startup] booted');
  }, []);

  useEffect(() => {
    initApp();
  }, [initApp]);

  // Exchange rates are the phone's, not a user's. Best-effort: conversions
  // fall back to the cached or bundled table.
  useEffect(() => {
    if (!booted) return;
    loadRates().catch(() => {});
  }, [booted]);

  if (!booted) {
    return (
      <SafeAreaProvider>
        <StartupScreen stage={bootStageLabel(stage)} />
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

// Wrapped for crash reporting. Its touch breadcrumbs name the component
// touched, never what is on it; while crash reporting is off it records nothing.
export default Sentry.wrap(RootLayout);
