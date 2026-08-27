import { useEffect, useState } from 'react';
import { View, ScrollView, Pressable, Switch, Linking, Alert } from 'react-native';
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
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBusiness } from '@/lib/businessApi';
import { getSettings } from '@/lib/db';
import { isBiometricAvailable } from '@/lib/biometric';
import {
  scheduleStreakReminder, cancelStreakReminder, isStreakReminderScheduled,
} from '@/lib/notifications';
import { R, glow, useB } from '@/lib/design';
import { Txt, GlassCard, IconBubble, Pill, BizBackground } from '@/components/ui';
import { t, SUPPORTED_LOCALES, LOCALE_LABELS } from '@/lib/i18n/core';
import { useLocaleStore } from '@/lib/i18n/locale-store';

interface SettingsRow {
  icon: React.ComponentType<{ size: number; color: string }>;
  label: string;
  sub: string;
  color: string;
  /** A row is either a link or a toggle. Never both, and never neither. */
  onPress?: () => void;
  toggle?: { value: boolean; onChange: (next: boolean) => void };
}

interface Section {
  title: string;
  items: SettingsRow[];
}

export default function BusinessSettingsScreen() {
  const B = useB();
  const insets = useSafeAreaInsets();
  const { data: session } = useSession();
  const locale = useLocaleStore((s) => s.locale);
  const chooseLanguage = useLocaleStore((s) => s.choose);
  const router = useRouter();

  // Subtitles that state the current value rather than a guess. The row used
  // to read "USD · United States" no matter what the user had chosen.
  const { data: business } = useQuery({ queryKey: ['business'], queryFn: getBusiness });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const [remindersOn, setRemindersOn] = useState(false);
  const [biometricOn, setBiometricOn] = useState(false);

  useEffect(() => {
    // Read from the system, not from a flag we set: a reminder cancelled in
    // iOS Settings or lost to a reinstall should show as off.
    isStreakReminderScheduled().then(setRemindersOn).catch(() => {});
    AsyncStorage.getItem('@biometric_lock')
      .then((v) => setBiometricOn(v === 'true'))
      .catch(() => {});
  }, []);

  const toggleReminders = async (next: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRemindersOn(next);
    if (next) {
      await scheduleStreakReminder();
      // Permission may have been refused, in which case nothing was
      // scheduled — reflect what actually happened rather than the tap.
      setRemindersOn(await isStreakReminderScheduled());
    } else {
      await cancelStreakReminder();
    }
  };

  const toggleBiometric = async (next: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (next && !(await isBiometricAvailable())) {
      Alert.alert(t('dialogs.biometricsUnavailable'), t('bizSettings.biometricUnavailableBody'));
      return;
    }
    setBiometricOn(next);
    await AsyncStorage.setItem('@biometric_lock', next ? 'true' : 'false');
  };

  /**
   * Support mail, pre-filled with what makes a report actionable.
   *
   * TODO(owner): support@realbudget.app does not exist yet — the domain is
   * unbought. Replace it before shipping, or this silently goes nowhere.
   */
  const contactSupport = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const subject = t('bizSettings.supportSubject');
    const body = t('bizSettings.supportBody', {
      version: '1.0.0',
      account: 'business',
      business: business?.name ?? '—',
    });
    const url = `mailto:support@realbudget.app?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    else Alert.alert(t('bizSettings.noMailTitle'), t('bizSettings.noMailBody'));
  };

  /**
   * Built per render, not at module scope: t() at module scope resolves once at
   * import and freezes whatever language was active then, so these rows would
   * survive a locale change that remounts everything else.
   *
   * Every row does something. They used to be chevrons over nothing.
   */
  const SECTIONS: Section[] = [
    {
      title: t('bizSettings.sectionBusiness'),
      items: [
        {
          icon: Building2, color: '#3b82f6',
          label: t('bizSettings.companyLabel'),
          // The name itself, when there is one — more use than a list of the
          // fields the screen contains.
          sub: business?.name ?? t('bizSettings.companySub'),
          onPress: () => router.push('/business-profile'),
        },
        {
          icon: FileText, color: '#14b8a6',
          label: t('bizSettings.taxLabel'),
          sub: business?.vatNumber || business?.taxId || t('bizSettings.taxSub'),
          onPress: () => router.push('/business-tax'),
        },
        {
          icon: Globe, color: '#f59e0b',
          label: t('bizSettings.regionLabel'),
          sub: settings?.currency
            ? `${settings.currency} · ${settings.currencySymbol ?? ''}`.trim()
            : t('bizSettings.regionSub'),
          onPress: () => router.push('/currency'),
        },
      ],
    },
    {
      title: t('bizSettings.sectionPreferences'),
      items: [
        {
          icon: Bell, color: '#a78bfa',
          label: t('bizSettings.notifLabel'), sub: t('bizSettings.notifSub'),
          toggle: { value: remindersOn, onChange: toggleReminders },
        },
        {
          icon: Shield, color: '#ef4444',
          label: t('bizSettings.securityLabel'), sub: t('bizSettings.securitySub'),
          toggle: { value: biometricOn, onChange: toggleBiometric },
        },
      ],
    },
    {
      title: t('bizSettings.sectionSupport'),
      items: [
        {
          icon: HelpCircle, color: '#94a3b8',
          label: t('bizSettings.helpLabel'), sub: t('bizSettings.helpSub'),
          onPress: contactSupport,
        },
      ],
    },
  ];

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
                const body = (
                  <GlassCard padding={14} radius={R.md}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <IconBubble color={item.color} size={38} radius={12} style={{ marginEnd: 13 }}><Icon size={17} color={item.color} /></IconBubble>
                      <View style={{ flex: 1 }}>
                        <Txt weight="semibold" size={15} color={B.text}>{item.label}</Txt>
                        <Txt size={12} color={B.textFaint} style={{ marginTop: 1 }} numberOfLines={1}>{item.sub}</Txt>
                      </View>
                      {item.toggle ? (
                        <Switch
                          value={item.toggle.value}
                          onValueChange={item.toggle.onChange}
                          trackColor={{ false: B.glassBorder, true: `${item.color}99` }}
                          thumbColor="#fff"
                        />
                      ) : (
                        <ChevronRight size={16} color={B.textFaint} />
                      )}
                    </View>
                  </GlassCard>
                );

                // A toggle handles its own press; wrapping it in a Pressable
                // would give the row a tap target that does nothing.
                return item.toggle ? (
                  <View key={item.label}>{body}</View>
                ) : (
                  <Pressable
                    key={item.label}
                    onPress={item.onPress}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    {body}
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
          <Txt size={11} color={B.textFaint} style={{ marginTop: 6, marginStart: 4 }}>
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
