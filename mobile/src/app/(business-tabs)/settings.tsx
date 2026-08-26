import { View, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Briefcase, ChevronRight, Bell, Shield, Globe,
  FileText, HelpCircle, LogOut, Building2, Check,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession, useSession } from '@/lib/auth/use-session';
import { useAccountTypeStore } from '@/lib/account-type-store';
import { R, glow, useB } from '@/lib/design';
import { Txt, GlassCard, IconBubble, Pill, BizBackground } from '@/components/ui';
import { t, SUPPORTED_LOCALES, LOCALE_LABELS } from '@/lib/i18n/core';
import { useLocaleStore } from '@/lib/i18n/locale-store';

export default function BusinessSettingsScreen() {
  const B = useB();
  // Built per render, not at module scope. t() at module scope resolves once
  // at import and freezes whatever language was active then, so these rows
  // would survive a locale change that remounts everything else.
  const SECTIONS = [
    {
      title: t('bizSettings.sectionBusiness'),
      items: [
        { icon: Building2, label: t('bizSettings.companyLabel'), sub: t('bizSettings.companySub'), color: '#3b82f6' },
        { icon: FileText, label: t('bizSettings.taxLabel'), sub: t('bizSettings.taxSub'), color: '#14b8a6' },
        { icon: Globe, label: t('bizSettings.regionLabel'), sub: t('bizSettings.regionSub'), color: '#f59e0b' },
      ],
    },
    {
      title: t('bizSettings.sectionPreferences'),
      items: [
        { icon: Bell, label: t('bizSettings.notifLabel'), sub: t('bizSettings.notifSub'), color: '#a78bfa' },
        { icon: Shield, label: t('bizSettings.securityLabel'), sub: t('bizSettings.securitySub'), color: '#ef4444' },
      ],
    },
    {
      title: t('bizSettings.sectionSupport'),
      items: [
        { icon: HelpCircle, label: t('bizSettings.helpLabel'), sub: t('bizSettings.helpSub'), color: '#94a3b8' },
      ],
    },
  ];
  const insets = useSafeAreaInsets();
  const { data: session } = useSession();
  const locale = useLocaleStore((s) => s.locale);
  const chooseLanguage = useLocaleStore((s) => s.choose);
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
          <LinearGradient colors={[B.heroFrom, B.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: R.lg, padding: 18, borderWidth: 1, borderColor: `${B.accent}30`, flexDirection: 'row', alignItems: 'center', gap: 14 }, glow(B.accentDeep, 0.25, 18, B.glowScale)]}>
            <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: `${B.accent}2e`, borderWidth: 1.5, borderColor: `${B.accent}55`, alignItems: 'center', justifyContent: 'center' }}>
              <Briefcase size={24} color={B.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={16} color="#fff">{session?.user?.name ?? t('bizSettings.businessAccount')}</Txt>
              <Txt size={13} color={B.textFaint} style={{ marginTop: 2 }}>{session?.user?.email ?? ''}</Txt>
              <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                <Pill label={t('business.label')} color={B.accent} />
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

        {/* Language — a real control, unlike the rows above, which are stubs.
            Business accounts previously had no way to change the app language
            at all: the picker lived only on the personal settings screen. */}
        <View style={{ paddingHorizontal: 20, marginBottom: 18 }}>
          <Txt weight="bold" size={11} color={B.textFaint} style={{ letterSpacing: 1.4, marginBottom: 10 }}>
            {t('settings.sections.language')}
          </Txt>
          <GlassCard padding={6} radius={R.md}>
            {SUPPORTED_LOCALES.map((code, i) => {
              const active = locale === code;
              return (
                <Pressable
                  key={code}
                  onPress={async () => {
                    if (active) return;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    // The store persists the choice and bumps the key the root
                    // navigator is mounted on. That remount is what re-renders
                    // the rest of the app, including this screen's own rows,
                    // which are built per render for exactly that reason.
                    await chooseLanguage(code);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 12,
                    paddingHorizontal: 10,
                    borderBottomWidth: i < SUPPORTED_LOCALES.length - 1 ? 1 : 0,
                    borderBottomColor: B.glassBorder,
                  }}
                >
                  <Txt size={15} color={active ? B.text : B.textFaint}>{LOCALE_LABELS[code]}</Txt>
                  {active && <Check size={18} color={B.teal} />}
                </Pressable>
              );
            })}
          </GlassCard>
          <Txt size={11} color={B.textFaint} style={{ marginTop: 6, marginLeft: 4 }}>
            {t('language.subtitle')}
          </Txt>
        </View>

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
