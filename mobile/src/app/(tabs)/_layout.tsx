import React from 'react';
import { Tabs } from 'expo-router';
import { useClientOnlyValue } from '@/lib/useClientOnlyValue';
import { BarChart3, PlusCircle, List, Settings, Bot } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

function TabBarIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  const iconProps = { size: 22, color };

  const icon = (() => {
    switch (name) {
      case 'dashboard':
        return <BarChart3 {...iconProps} />;
      case 'add':
        return <PlusCircle {...iconProps} size={26} />;
      case 'transactions':
        return <List {...iconProps} />;
      case 'advisor':
        return <Bot {...iconProps} />;
      case 'settings':
        return <Settings {...iconProps} />;
      default:
        return <BarChart3 {...iconProps} />;
    }
  })();

  if (name === 'add') {
    return (
      <LinearGradient
        colors={focused ? ['#9333ea', '#a855f7'] : ['#6d28d9', '#7c3aed']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: 52,
          height: 52,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: -14,
          shadowColor: '#a855f7',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: focused ? 0.6 : 0.3,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <PlusCircle size={26} color="#fff" />
      </LinearGradient>
    );
  }

  return icon;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#c084fc',
        tabBarInactiveTintColor: '#4b5563',
        headerShown: useClientOnlyValue(false, true),
        tabBarStyle: {
          backgroundColor: '#080810',
          borderTopColor: '#1e1b2e',
          borderTopWidth: 1,
          height: 85,
          paddingTop: 8,
          paddingBottom: 24,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => <TabBarIcon name="dashboard" color={color} focused={focused} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '',
          tabBarIcon: ({ color, focused }) => <TabBarIcon name="add" color={color} focused={focused} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'History',
          tabBarIcon: ({ color, focused }) => <TabBarIcon name="transactions" color={color} focused={focused} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="advisor"
        options={{
          title: 'Advisor',
          tabBarIcon: ({ color, focused }) => <TabBarIcon name="advisor" color={color} focused={focused} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => <TabBarIcon name="settings" color={color} focused={focused} />,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}
