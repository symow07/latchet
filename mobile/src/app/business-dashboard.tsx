import { View, Text, Pressable, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Briefcase, Clock, BarChart3, FileText, Users, Zap, LogOut,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession, useSession } from '@/lib/auth/use-session';
import { useAccountTypeStore } from '@/lib/account-type-store';

const COMING_SOON_FEATURES = [
  { icon: BarChart3, label: 'Business Analytics', desc: 'P&L, cash flow, and revenue dashboards' },
  { icon: FileText, label: 'Invoicing', desc: 'Create and send professional invoices' },
  { icon: Users, label: 'Team Expenses', desc: 'Manage expenses across your whole team' },
  { icon: Zap, label: 'Automations', desc: 'Auto-categorize and reconcile transactions' },
];

export default function BusinessDashboard() {
  const insets = useSafeAreaInsets();
  const invalidateSession = useInvalidateSession();
  const reset = useAccountTypeStore(s => s.reset);
  const { data: session } = useSession();

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    reset();
    await authClient.signOut();
    await invalidateSession();
  };

  return (
    <View className="flex-1 bg-[#030b18]" style={{ paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <LinearGradient
          colors={['#031a38', '#042d60', '#031a38']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingHorizontal: 24,
            paddingTop: 32,
            paddingBottom: 48,
            borderBottomLeftRadius: 40,
            borderBottomRightRadius: 40,
            marginBottom: 28,
          }}
        >
          {/* Top bar */}
          <View className="flex-row items-center justify-between mb-8">
            <View
              style={{
                width: 48, height: 48, borderRadius: 16,
                backgroundColor: 'rgba(59,130,246,0.2)',
                borderWidth: 1.5, borderColor: 'rgba(59,130,246,0.35)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Briefcase size={22} color="#60a5fa" />
            </View>
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
                gap: 6,
              })}
            >
              <LogOut size={15} color="#9ca3af" />
              <Text style={{ color: '#9ca3af', fontSize: 14, fontWeight: '600' }}>Log out</Text>
            </Pressable>
          </View>

          <Text style={{ color: '#93c5fd', fontSize: 13, fontWeight: '700', letterSpacing: 2, marginBottom: 10 }}>
            BUSINESS
          </Text>
          <Text className="text-white font-bold" style={{ fontSize: 30, lineHeight: 38, marginBottom: 8 }}>
            Business Dashboard
          </Text>
          <Text className="text-gray-400 text-base leading-6">
            {session?.user?.name ? `Welcome, ${session.user.name}.` : 'Welcome.'}{' '}
            Your business tools are being built.
          </Text>
        </LinearGradient>

        {/* Coming Soon Banner */}
        <View className="mx-5 mb-6">
          <LinearGradient
            colors={['rgba(59,130,246,0.12)', 'rgba(29,78,216,0.12)']}
            style={{
              borderRadius: 20,
              padding: 24,
              borderWidth: 1.5,
              borderColor: 'rgba(59,130,246,0.25)',
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: 64, height: 64, borderRadius: 20,
                backgroundColor: 'rgba(59,130,246,0.18)',
                borderWidth: 1.5, borderColor: 'rgba(59,130,246,0.3)',
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Clock size={30} color="#60a5fa" />
            </View>
            <Text className="text-white font-bold text-2xl text-center mb-2">
              Coming Soon
            </Text>
            <Text className="text-gray-400 text-sm text-center leading-5">
              We're building powerful business features.{'\n'}
              You'll be notified when they're ready.
            </Text>
          </LinearGradient>
        </View>

        {/* Feature Preview */}
        <View className="px-5 mb-8">
          <Text className="text-gray-400 text-xs font-semibold mb-4 tracking-widest uppercase">
            What's coming
          </Text>
          <View className="gap-3">
            {COMING_SOON_FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <View
                  key={feature.label}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.06)',
                    gap: 14,
                  }}
                >
                  <View
                    style={{
                      width: 44, height: 44, borderRadius: 14,
                      backgroundColor: 'rgba(59,130,246,0.12)',
                      alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={20} color="#60a5fa" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white font-semibold text-base mb-0.5">{feature.label}</Text>
                    <Text className="text-gray-500 text-sm">{feature.desc}</Text>
                  </View>
                  <View
                    style={{
                      paddingHorizontal: 10, paddingVertical: 4,
                      borderRadius: 8, backgroundColor: 'rgba(59,130,246,0.15)',
                    }}
                  >
                    <Text style={{ color: '#60a5fa', fontSize: 11, fontWeight: '700' }}>SOON</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
