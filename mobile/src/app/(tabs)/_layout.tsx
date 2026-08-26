import React from 'react';
import { t } from '@/lib/i18n/core';
import { Tabs } from 'expo-router';
import { View, Platform } from 'react-native';
import { useClientOnlyValue } from '@/lib/useClientOnlyValue';
import { BarChart3, PlusCircle, List, Settings, Bot } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { glow, useC } from '@/lib/design';

function TabBarIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  const C = useC();
  const iconProps = { size: 23, color, strokeWidth: focused ? 2.6 : 2.1 };

  if (name === 'add') {
    return (
      <LinearGradient
        colors={focused ? [C.p500, C.p400] : [C.p700, C.p600]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          {
            width: 58,
            height: 58,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: -22,
            borderWidth: 4,
            // Matches the tab bar's own fill so the ring punches the button out
            // of the bar. C.bgDeep is darker than the bar and read as a black
            // square sitting behind it.
            borderColor: C.scheme === 'light' ? '#ffffff' : '#120a20',
          },
          glow(C.p500, focused ? 0.7 : 0.45, 14, C.glowScale),
        ]}
      >
        <PlusCircle size={28} color="#fff" strokeWidth={2.4} />
      </LinearGradient>
    );
  }

  const icon = (() => {
    switch (name) {
      case 'dashboard': return <BarChart3 {...iconProps} />;
      case 'transactions': return <List {...iconProps} />;
      case 'advisor': return <Bot {...iconProps} />;
      case 'settings': return <Settings {...iconProps} />;
      default: return <BarChart3 {...iconProps} />;
    }
  })();

  // Soft glowing pill behind the focused icon
  return (
    <View
      style={{
        width: 46,
        height: 34,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? `${C.p500}26` : 'transparent',
      }}
    >
      {icon}
    </View>
  );
}

export default function TabLayout() {
  const C = useC();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.p400,
        tabBarInactiveTintColor: C.textFaint,
        headerShown: useClientOnlyValue(false, true),
        tabBarBackground: () => (
          // The bar is pinned over the scroll view, so iOS re-blurs whatever
          // passes behind it on every frame — and the fill on top is ~85%
          // opaque, so only a sixth of that blur was ever visible. Intensity
          // drops and the fill rises slightly to compensate: near-identical
          // composite, a much smaller blur radius to sample each frame.
          <BlurView
            intensity={Platform.OS === 'ios' ? 18 : 12}
            tint={C.scheme === 'light' ? 'light' : 'dark'}
            style={{
              flex: 1,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              overflow: 'hidden',
              backgroundColor: C.scheme === 'light' ? 'rgba(255,255,255,0.88)' : 'rgba(18,10,32,0.85)',
              borderTopWidth: 1,
              borderColor: C.glassBorder,
            }}
          />
        ),
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          height: 88,
          paddingTop: 10,
          paddingBottom: 26,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: 'PlusJakartaSans_600SemiBold',
          marginTop: 2,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
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
          title: t('tabs.history'),
          tabBarIcon: ({ color, focused }) => <TabBarIcon name="transactions" color={color} focused={focused} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="advisor"
        options={{
          title: t('tabs.advisor'),
          tabBarIcon: ({ color, focused }) => <TabBarIcon name="advisor" color={color} focused={focused} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, focused }) => <TabBarIcon name="settings" color={color} focused={focused} />,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}
