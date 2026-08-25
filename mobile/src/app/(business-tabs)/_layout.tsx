import { Tabs } from 'expo-router';
import { View, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { LayoutDashboard, Receipt, Users, Wallet, PieChart, Settings } from 'lucide-react-native';
import { useB } from '@/lib/design';

function TabIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  const B = useB();
  const props = { size: 21, color, strokeWidth: focused ? 2.5 : 2 };
  const icon = (() => {
    switch (name) {
      case 'dashboard': return <LayoutDashboard {...props} />;
      case 'expenses': return <Receipt {...props} />;
      case 'team': return <Users {...props} />;
      case 'payroll': return <Wallet {...props} />;
      case 'budget': return <PieChart {...props} />;
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
  const B = useB();
  return (
    <Tabs
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
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: ({ color, focused }) => <TabIcon name="dashboard" color={color} focused={focused} /> }} />
      <Tabs.Screen name="expenses" options={{ title: 'Expenses', tabBarIcon: ({ color, focused }) => <TabIcon name="expenses" color={color} focused={focused} /> }} />
      <Tabs.Screen name="team" options={{ title: 'Team', tabBarIcon: ({ color, focused }) => <TabIcon name="team" color={color} focused={focused} /> }} />
      <Tabs.Screen name="subscriptions" options={{ title: 'Payroll', tabBarIcon: ({ color, focused }) => <TabIcon name="payroll" color={color} focused={focused} /> }} />
      <Tabs.Screen name="insights" options={{ title: 'Budget', tabBarIcon: ({ color, focused }) => <TabIcon name="budget" color={color} focused={focused} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, focused }) => <TabIcon name="settings" color={color} focused={focused} /> }} />
    </Tabs>
  );
}
