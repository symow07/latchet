import { Tabs } from 'expo-router';
import { useLocaleStore } from '@/lib/i18n/locale-store';
import { t } from '@/lib/i18n/core';
import { View, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { LayoutDashboard, Receipt, Sparkles, Wallet, Settings } from 'lucide-react-native';
import { useB } from '@/lib/design';

function TabIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  const B = useB();
  const props = { size: 21, color, strokeWidth: focused ? 2.5 : 2 };
  const icon = (() => {
    switch (name) {
      case 'dashboard': return <LayoutDashboard {...props} />;
      case 'expenses': return <Receipt {...props} />;
      case 'advisor': return <Sparkles {...props} />;
      case 'money': return <Wallet {...props} />;
      case 'settings': return <Settings {...props} />;
      default: return <LayoutDashboard {...props} />;
    }
  })();
  return (
    <View
      style={{
        width: 44, height: 32, borderRadius: 10,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: focused ? `${B.accent}22` : 'transparent',
      }}
    >
      {icon}
    </View>
  );
}

export default function BusinessTabLayout() {
  // React Navigation caches a screen's `options`, so the remount the locale
  // change triggers higher up does not reach these titles — the tab bar kept
  // the language the app started in. Keying the navigator forces it.
  const localeVersion = useLocaleStore((s) => s.version);
  const B = useB();
  return (
    <Tabs
      key={localeVersion}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: B.accentSoft,
        tabBarInactiveTintColor: B.textFaint,
        tabBarBackground: () => (
          // Same reasoning as the personal bar: the fill above it is ~87%
          // opaque, so most of this blur was never visible, and it re-samples
          // every frame the page scrolls beneath.
          <BlurView
            intensity={Platform.OS === 'ios' ? 18 : 12}
            tint={B.scheme === 'light' ? 'light' : 'dark'}
            style={{
              flex: 1,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              overflow: 'hidden',
              backgroundColor: B.scheme === 'light' ? 'rgba(255,255,255,0.90)' : 'rgba(12,18,30,0.89)',
              borderTopWidth: 1,
              borderColor: B.glassBorder,
            }}
          />
        ),
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          height: 86,
          paddingTop: 9,
          paddingBottom: 24,
          elevation: 0,
        },
        tabBarLabelStyle: { fontSize: 10, fontFamily: 'PlusJakartaSans_600SemiBold', marginTop: 2 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.dashboard'), tabBarIcon: ({ color, focused }) => <TabIcon name="dashboard" color={color} focused={focused} /> }} />
      <Tabs.Screen name="expenses" options={{ title: t('tabs.expenses'), tabBarIcon: ({ color, focused }) => <TabIcon name="expenses" color={color} focused={focused} /> }} />
      <Tabs.Screen name="advisor" options={{ title: t('tabs.advisor'), tabBarIcon: ({ color, focused }) => <TabIcon name="advisor" color={color} focused={focused} /> }} />
      <Tabs.Screen name="money" options={{ title: t('tabs.money'), tabBarIcon: ({ color, focused }) => <TabIcon name="money" color={color} focused={focused} /> }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), tabBarIcon: ({ color, focused }) => <TabIcon name="settings" color={color} focused={focused} /> }} />

      {/* Still routes, deliberately off the bar. Payroll and Budget are hosted
          by the Money tab, which renders them with `embedded`; keeping them
          registered means a deep link or a stale navigation state still
          resolves instead of 404ing. */}
      <Tabs.Screen name="subscriptions" options={{ href: null }} />
      <Tabs.Screen name="insights" options={{ href: null }} />
    </Tabs>
  );
}
