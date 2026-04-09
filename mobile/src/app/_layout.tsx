import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from '@/lib/useColorScheme';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import { initializeDatabase } from '@/lib/db';
import { useSession } from '@/lib/auth/use-session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBiometricAvailable, authenticateWithBiometrics } from '@/lib/biometric';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { useAccountTypeStore, type AccountTypeStore } from '@/lib/account-type-store';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

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
  const { data: session, isLoading: sessionLoading } = useSession();
  const router = useRouter();
  const loadAccountType = useAccountTypeStore((s: AccountTypeStore) => s.load);
  const accountType = useAccountTypeStore((s: AccountTypeStore) => s.accountType);
  const accountTypeLoaded = useAccountTypeStore((s: AccountTypeStore) => s.loaded);

  // Load accountType from AsyncStorage when session is ready
  useEffect(() => {
    if (!sessionLoading && session?.user?.id) {
      loadAccountType(session.user.id);
    }
  }, [sessionLoading, session?.user?.id, loadAccountType]);

  // Redirect based on accountType when user is authenticated
  useEffect(() => {
    if (sessionLoading || !session?.user) return;
    if (!accountTypeLoaded) return;

    if (!accountType) {
      router.replace('/account-type');
    } else if (accountType === 'business') {
      router.replace('/(business-tabs)');
    }
    // personal: default (tabs) route is correct
  }, [sessionLoading, session?.user, accountType, accountTypeLoaded, router]);

  if (sessionLoading) return null;

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
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
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

  const initApp = useCallback(async () => {
    setDbError(null);
    try {
      await initializeDatabase();
    } catch (e) {
      console.error('[DB Init]', e);
      setDbError(e instanceof Error ? e.message : 'Failed to initialize database');
      await SplashScreen.hideAsync();
      return;
    }

    // Check if biometric lock is enabled
    try {
      const val = await AsyncStorage.getItem('@biometric_lock');
      if (val === 'true') {
        const available = await isBiometricAvailable();
        if (available) setLocked(true);
      }
    } catch {
      // silently skip if AsyncStorage fails (e.g. web)
    }

    setDbReady(true);
    await SplashScreen.hideAsync();
  }, []);

  useEffect(() => {
    initApp();
  }, []);

  if (dbError) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: '#ef4444', fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
            Database Error
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            {dbError}
          </Text>
          <Pressable
            onPress={initApp}
            style={{ paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16, backgroundColor: '#2563eb' }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!dbReady) return null;

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
