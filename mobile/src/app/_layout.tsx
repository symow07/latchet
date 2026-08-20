import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from '@/lib/useColorScheme';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { initializeDatabase } from '@/lib/db';
import { startCloudSync } from '@/lib/cloud-sync';
import { loadRates } from '@/lib/rates';
import { initLocale } from '@/lib/i18n/bootstrap';
import { useSession, SESSION_QUERY_KEY } from '@/lib/auth/use-session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBiometricAvailable, authenticateWithBiometrics } from '@/lib/biometric';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { useAccountTypeStore, type AccountTypeStore } from '@/lib/account-type-store';
import { registerForPushNotifications, scheduleStreakReminder } from '@/lib/notifications';
import { setUserId, logoutUser } from '@/lib/revenuecatClient';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { patchDefaultFont } from '@/lib/design';
import { t } from '@/lib/i18n/core';

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
  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <ActivityIndicator size="large" color="#fbbf24" />
      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 24 }}>
        Starting Budget…
      </Text>
      <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 8 }}>
        {stage}
      </Text>
    </View>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
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

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#1a1410', '#2d1f0f', '#1a1410']}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View style={{ alignItems: 'center', marginBottom: 48 }}>
          <View style={{
            width: 96, height: 96, borderRadius: 32,
            backgroundColor: 'rgba(251,191,36,0.15)',
            borderWidth: 1.5, borderColor: 'rgba(251,191,36,0.3)',
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 24,
          }}>
            <Text style={{ fontSize: 48 }}>🔒</Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700', marginBottom: 8 }}>
            Budget
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15 }}>
            Authenticate to continue
          </Text>
        </View>

        <Pressable
          onPress={tryAuthenticate}
          style={({ pressed }: { pressed: boolean }) => ({
            opacity: pressed ? 0.75 : 1,
            paddingHorizontal: 40, paddingVertical: 16,
            borderRadius: 20,
            backgroundColor: 'rgba(251,191,36,0.2)',
            borderWidth: 1.5, borderColor: 'rgba(251,191,36,0.5)',
          })}
        >
          <Text style={{ color: '#fbbf24', fontWeight: '700', fontSize: 17 }}>
            {authenticating ? 'Authenticating...' : 'Unlock with Biometrics'}
          </Text>
        </Pressable>
      </LinearGradient>
    </View>
  );
}

function RootLayoutNav({ colorScheme }: { colorScheme: 'light' | 'dark' | null | undefined }) {
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
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: '#ef4444', fontSize: 20, fontWeight: '700', marginBottom: 8 }}>
          Couldn&apos;t reach the server
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
          {sessionError instanceof Error ? sessionError.message : 'Unknown error'}
        </Text>
        <Pressable
          onPress={() => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })}
          style={{ paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16, backgroundColor: '#2563eb' }}
        >
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>{t('startup.retry')}</Text>
        </Pressable>
        <Pressable
          onPress={() => setSessionTimedOut(true)}
          style={{ marginTop: 12, paddingHorizontal: 32, paddingVertical: 14 }}
        >
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{t('startup.continueOffline')}</Text>
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
        </Stack.Protected>

        {/* Public: only accessible when NOT signed in */}
        <Stack.Protected guard={!session?.user}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="verify-otp" options={{ headerShown: false }} />
          <Stack.Screen name="signup" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [stage, setStage] = useState<string>('Booting…');

  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  // Once the font is available, make it the app-wide default font.
  useEffect(() => {
    if (fontsLoaded) patchDefaultFont();
  }, [fontsLoaded]);

  useEffect(() => {
    console.log('[startup] RootLayout mounted');
  }, []);

  const initApp = useCallback(async () => {
    setDbError(null);
    setStage('Opening database…');
    console.log('[startup] initializeDatabase start');
    try {
      await withTimeout(initializeDatabase(), DB_INIT_TIMEOUT_MS, 'initializeDatabase');
      console.log('[startup] initializeDatabase success');
      // Language before any screen renders, so nothing flashes in English first.
      await initLocale().catch(() => {});
    } catch (e) {
      console.error('[startup] initializeDatabase error', e);
      setDbError(e instanceof Error ? e.message : 'Failed to initialize database');
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
        <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: '#ef4444', fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
            Startup Error
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            {dbError}
          </Text>
          <Pressable
            onPress={initApp}
            style={{ paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16, backgroundColor: '#2563eb' }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>{t('startup.retry')}</Text>
          </Pressable>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!dbReady || !fontsLoaded) {
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
          <RootLayoutNav colorScheme={colorScheme} />
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
