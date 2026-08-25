import { View, ScrollView, Pressable } from 'react-native';
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
import { R, glow, useB } from '@/lib/design';
import { Txt, GlassCard, IconBubble, Pill, BizBackground } from '@/components/ui';
import { t } from '@/lib/i18n/core';

const SECTIONS = [
  {
    title: 'Business',
    items: [
      { icon: Building2, label: 'Company Profile', sub: 'Name, logo, address', color: '#3b82f6' },
      { icon: FileText, label: 'Tax Settings', sub: 'VAT, tax ID, fiscal year', color: '#14b8a6' },
      { icon: Globe, label: 'Currency & Region', sub: 'USD · United States', color: '#f59e0b' },
    ],
  },
  {
    title: 'Preferences',
    items: [
      { icon: Bell, label: 'Notifications', sub: 'Alerts and reminders', color: '#a78bfa' },
      { icon: Shield, label: 'Security', sub: 'Password, 2FA', color: '#ef4444' },
    ],
  },
  {
    title: 'Support',
    items: [
      { icon: HelpCircle, label: 'Help & Feedback', sub: 'Get support or report an issue', color: '#94a3b8' },
    ],
  },
];

export default function BusinessSettingsScreen() {
  const B = useB();
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
    <BizBackground style={{ paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 }}>
          <Txt weight="bold" size={12} color={B.accent} style={{ letterSpacing: 1.6 }}>{t('business.label')}</Txt>
          <Txt weight="bold" size={25} color={B.text} style={{ marginTop: 2 }}>{t('businessSettings.title')}</Txt>
        </View>

        {/* Profile card */}
        <View style={{ marginHorizontal: 20, marginBottom: 22 }}>
          <LinearGradient colors={[B.slate800, '#16365f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: R.lg, padding: 18, borderWidth: 1, borderColor: `${B.accent}30`, flexDirection: 'row', alignItems: 'center', gap: 14 }, glow(B.accentDeep, 0.25, 18, B.glowScale)]}>
            <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: `${B.accent}2e`, borderWidth: 1.5, borderColor: `${B.accent}55`, alignItems: 'center', justifyContent: 'center' }}>
              <Briefcase size={24} color={B.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={16} color="#fff">{session?.user?.name ?? 'Business Account'}</Txt>
              <Txt size={13} color={B.textFaint} style={{ marginTop: 2 }}>{session?.user?.email ?? ''}</Txt>
              <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                <Pill label="BUSINESS" color={B.accent} />
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* Sections */}
        {SECTIONS.map((section) => (
          <View key={section.title} style={{ paddingHorizontal: 20, marginBottom: 18 }}>
            <Txt weight="bold" size={11} color={B.textFaint} style={{ letterSpacing: 1.4, marginBottom: 10 }}>{section.title.toUpperCase()}</Txt>
            <View style={{ gap: 10 }}>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Pressable key={item.label} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                    <GlassCard padding={14} radius={R.md}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <IconBubble color={item.color} size={38} radius={12} style={{ marginRight: 13 }}><Icon size={17} color={item.color} /></IconBubble>
                        <View style={{ flex: 1 }}>
                          <Txt weight="semibold" size={15} color={B.text}>{item.label}</Txt>
                          <Txt size={12} color={B.textFaint} style={{ marginTop: 1 }}>{item.sub}</Txt>
                        </View>
                        <ChevronRight size={16} color={B.textFaint} />
                      </View>
                    </GlassCard>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {/* Logout */}
        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          <Pressable onPress={handleLogout} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <GlassCard padding={16} radius={R.md} tint={`${B.red}12`} border={`${B.red}28`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <LogOut size={17} color={B.red} />
                <Txt weight="bold" size={15} color={B.red}>{t('businessSettings.signOut')}</Txt>
              </View>
            </GlassCard>
          </Pressable>
        </View>
      </ScrollView>
    </BizBackground>
  );
}
