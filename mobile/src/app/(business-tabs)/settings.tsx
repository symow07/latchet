import { View, Text, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Briefcase, ChevronRight, Bell, Shield, Globe,
  FileText, HelpCircle, LogOut, Building2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession, useSession } from '@/lib/auth/use-session';
import { useAccountTypeStore } from '@/lib/account-type-store';

const SECTIONS = [
  {
    title: 'Business',
    items: [
      { icon: Building2, label: 'Company Profile',    sub: 'Name, logo, address',      color: '#60a5fa' },
      { icon: FileText,  label: 'Tax Settings',       sub: 'VAT, tax ID, fiscal year',  color: '#34d399' },
      { icon: Globe,     label: 'Currency & Region',  sub: 'USD · United States',       color: '#fbbf24' },
    ],
  },
  {
    title: 'Preferences',
    items: [
      { icon: Bell,      label: 'Notifications',  sub: 'Alerts and reminders',   color: '#a78bfa' },
      { icon: Shield,    label: 'Security',       sub: 'Password, 2FA',          color: '#f87171' },
    ],
  },
  {
    title: 'Support',
    items: [
      { icon: HelpCircle, label: 'Help & Feedback', sub: 'Get support or report an issue', color: '#9ca3af' },
    ],
  },
];

export default function BusinessSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { data: session } = useSession();
  const invalidateSession = useInvalidateSession();
  const reset = useAccountTypeStore(s => s.reset);

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    reset();
    await authClient.signOut();
    await invalidateSession();
  };

  return (
    <View className="flex-1 bg-[#060d18]" style={{ paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Header */}
        <View className="px-5 pt-4 pb-6">
          <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }}>
            BUSINESS
          </Text>
          <Text className="text-white font-bold" style={{ fontSize: 24, marginTop: 2 }}>
            Settings
          </Text>
        </View>

        {/* Profile card */}
        <View className="mx-5 mb-6">
          <LinearGradient
            colors={['#0c1f3d', '#0f2d58']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: 22,
              padding: 18,
              borderWidth: 1,
              borderColor: 'rgba(96,165,250,0.2)',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <View
              style={{
                width: 54, height: 54, borderRadius: 18,
                backgroundColor: 'rgba(96,165,250,0.2)',
                borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.35)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Briefcase size={24} color="#60a5fa" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
                {session?.user?.name ?? 'Business Account'}
              </Text>
              <Text style={{ color: '#4b5563', fontSize: 13, marginTop: 2 }}>
                {session?.user?.email ?? ''}
              </Text>
              <View
                style={{
                  marginTop: 6,
                  alignSelf: 'flex-start',
                  paddingHorizontal: 8, paddingVertical: 3,
                  borderRadius: 8,
                  backgroundColor: 'rgba(96,165,250,0.15)',
                }}
              >
                <Text style={{ color: '#60a5fa', fontSize: 11, fontWeight: '700' }}>BUSINESS</Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* Settings sections */}
        {SECTIONS.map((section) => (
          <View key={section.title} className="px-5 mb-5">
            <Text style={{ color: '#374151', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 }}>
              {section.title.toUpperCase()}
            </Text>
            <View
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderRadius: 18,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.06)',
                overflow: 'hidden',
              }}
            >
              {section.items.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <Pressable
                    key={item.label}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.7 : 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      borderTopWidth: idx > 0 ? 1 : 0,
                      borderTopColor: 'rgba(255,255,255,0.04)',
                    })}
                  >
                    <View
                      style={{
                        width: 38, height: 38, borderRadius: 12,
                        backgroundColor: `${item.color}18`,
                        alignItems: 'center', justifyContent: 'center',
                        marginRight: 13,
                      }}
                    >
                      <Icon size={17} color={item.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#d1d5db', fontSize: 15, fontWeight: '500' }}>
                        {item.label}
                      </Text>
                      <Text style={{ color: '#374151', fontSize: 12, marginTop: 1 }}>
                        {item.sub}
                      </Text>
                    </View>
                    <ChevronRight size={16} color="#1f2937" />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {/* Logout */}
        <View className="px-5 pt-2">
          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              backgroundColor: 'rgba(239,68,68,0.07)',
              borderRadius: 18,
              padding: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(239,68,68,0.13)',
              gap: 8,
            })}
          >
            <LogOut size={17} color="#ef4444" />
            <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 15 }}>
              Sign Out
            </Text>
          </Pressable>
        </View>

      </ScrollView>
    </View>
  );
}
