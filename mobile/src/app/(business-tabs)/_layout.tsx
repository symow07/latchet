import { Tabs } from 'expo-router';
import { LayoutDashboard, Receipt, Users, Wallet, PieChart, Settings } from 'lucide-react-native';

function TabIcon({
  name,
  color,
  focused,
}: {
  name: string;
  color: string;
  focused: boolean;
}) {
  const size = 22;
  const props = { size, color };

  const icon = (() => {
    switch (name) {
      case 'dashboard':     return <LayoutDashboard {...props} />;
      case 'expenses':      return <Receipt {...props} />;
      case 'team':          return <Users {...props} />;
      case 'payroll':       return <Wallet {...props} />;
      case 'budget':        return <PieChart {...props} />;
      case 'settings':      return <Settings {...props} />;
      default:              return <LayoutDashboard {...props} />;
    }
  })();

  return icon;
}

export default function BusinessTabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#60a5fa',
        tabBarInactiveTintColor: '#374151',
        tabBarStyle: {
          backgroundColor: '#080f1a',
          borderTopColor: '#0f1f35',
          borderTopWidth: 1,
          height: 85,
          paddingTop: 8,
          paddingBottom: 24,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="dashboard" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: 'Expenses',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="expenses" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: 'Team',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="team" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{
          title: 'Payroll',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="payroll" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Budget',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="budget" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="settings" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
