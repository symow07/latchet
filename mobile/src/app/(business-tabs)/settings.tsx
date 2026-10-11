import { useEffect, useState } from 'react';
import { View, ScrollView, Linking, Alert } from 'react-native';
import {
  Bell, Briefcase, Building2, FileText, Globe, HelpCircle, LogOut,
  Moon, Shield, Smartphone, Sun, Users,
} from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession, useSession } from '@/lib/auth/use-session';
import { useAccountTypeStore } from '@/lib/account-type-store';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBusiness } from '@/lib/businessApi';
import { getSettings } from '@/lib/db';
import { useThemeStore, type ThemePreference } from '@/lib/theme-store';
import { isBiometricAvailable } from '@/lib/biometric';
import {
  scheduleStreakReminder, cancelStreakReminder, isStreakReminderScheduled,
} from '@/lib/notifications';
import { BAR, R, S, useC } from '@/lib/design';
import {
  Card, ChoiceRow, Group, Header, IconTile, LinkRow, Screen, SwitchRow, Touchable, Type,
} from '@/components/kit';
import { t, SUPPORTED_LOCALES, LOCALE_LABELS } from '@/lib/i18n/core';
import { useLocaleStore } from '@/lib/i18n/locale-store';
import { readMembers } from '@/lib/group-members';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** System first — it is the default, and an explicit choice should be a
  * deliberate departure from it rather than the top of the list. */
const THEME_OPTIONS: ThemePreference[] = ['system', 'light', 'dark'];

/**
 * Business settings — DESIGN-PROMPT.md §17, in the one identity both profiles
 * share.
 *
 * Two things changed beyond the surface. The section headings were being run
 * through `.toUpperCase()` in code, which §3 rules out — there is no uppercase
 * caption style, and a screen of tracked-out small caps is the single clearest
 * tell of a dashboard. And every row carried its own hardcoded icon hue: seven
 * unrelated colours down one screen. Feature rows now share one platinum
 * squircle with a tint glyph, so that is what they have.
 */
export default function BusinessSettingsScreen() {
  const insets = useSafeAreaInsets();
  const B = useC();
  const { data: session } = useSession();
  const locale = useLocaleStore((s) => s.locale);
  const chooseLanguage = useLocaleStore((s) => s.choose);
  const themePreference = useThemeStore((s) => s.preference);
  const chooseTheme = useThemeStore((s) => s.choose);
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

  const memberCount = readMembers(business).length;
  const invalidateSession = useInvalidateSession();
  const reset = useAccountTypeStore((s) => s.reset);

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    reset();
    await authClient.signOut();
    await invalidateSession();
  };

  const tile = (Icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>) => (
    <IconTile pal={B}>
      <Icon size={20} color={B.accent} strokeWidth={S.stroke} />
    </IconTile>
  );

  return (
    <Screen pal={B}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8, paddingBottom: BAR.clearance(insets.bottom) }}>
        <Header pal={B} title={t('businessSettings.title')} />

        {/* The screen's one espresso anchor: who you are signed in as. The
            glyph sits on a translucent silver tile, never a white one. */}
        <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
          <Card
            pal={B}
            anchor
            contentStyle={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View
              style={{
                width: 48, height: 48, borderRadius: R.sm, borderCurve: 'continuous',
                backgroundColor: B.glassStrong,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Briefcase size={22} color={B.onEspresso} strokeWidth={S.stroke} />
            </View>
            <View style={{ flex: 1 }}>
              <Type role="cardTitle" color={B.onEspresso} numberOfLines={1}>
                {session?.user?.name ?? t('bizSettings.businessAccount')}
              </Type>
              <Type role="meta" color={B.onEspressoDim} numberOfLines={1}>
                {session?.user?.email ?? t('business.label')}
              </Type>
            </View>
          </Card>
        </View>

        <Group pal={B} title={t('bizSettings.sectionBusiness')} style={{ marginTop: S.section }}>
          <LinkRow
            pal={B}
            icon={tile(Building2)}
            title={t('bizSettings.companyLabel')}
            body={business?.name ?? t('bizSettings.companySub')}
            onPress={() => router.push('/business-profile')}
          />
          <LinkRow
            pal={B}
            icon={tile(FileText)}
            title={t('bizSettings.taxLabel')}
            body={business?.vatNumber || business?.taxId || t('bizSettings.taxSub')}
            onPress={() => router.push('/business-tax')}
          />
          <LinkRow
            pal={B}
            icon={tile(Globe)}
            title={t('bizSettings.regionLabel')}
            body={settings?.currency
              ? `${settings.currency} · ${settings.currencySymbol ?? ''}`.trim()
              : t('bizSettings.regionSub')}
            onPress={() => router.push('/currency')}
          />
        </Group>

        {/* Team moved out of the tab bar. Six tabs was too many to scan, and a
            team is managed occasionally rather than daily — but it is its own
            section rather than a row under Preferences, because it is a place
            you go, not a setting you flip. */}
        <Group pal={B} title={t('bizSettings.sectionTeam')} style={{ marginTop: S.section }}>
          <LinkRow
            pal={B}
            icon={tile(Users)}
            title={t('tabs.team')}
            body={memberCount > 0
              ? t('bizSettings.teamSub', { count: memberCount })
              : t('bizSettings.teamSubEmpty')}
            onPress={() => router.push('/business-team')}
          />
        </Group>

        <Group pal={B} title={t('bizSettings.sectionPreferences')} style={{ marginTop: S.section }}>
          <SwitchRow
            pal={B}
            icon={tile(Bell)}
            title={t('bizSettings.notifLabel')}
            body={t('bizSettings.notifSub')}
            value={remindersOn}
            onValueChange={toggleReminders}
          />
          <SwitchRow
            pal={B}
            icon={tile(Shield)}
            title={t('bizSettings.securityLabel')}
            body={t('bizSettings.securitySub')}
            value={biometricOn}
            onValueChange={toggleBiometric}
          />
        </Group>

        <Group pal={B} title={t('bizSettings.sectionSupport')} style={{ marginTop: S.section }}>
          <LinkRow
            pal={B}
            icon={tile(HelpCircle)}
            title={t('bizSettings.helpLabel')}
            body={t('bizSettings.helpSub')}
            onPress={contactSupport}
          />
        </Group>

        {/* Appearance and Language live here as well as on the personal screen
            for the same reason: a business account that only ever sees this
            screen would otherwise have no way to reach either. */}
        <Group pal={B} title={t('settings.sections.appearance')} style={{ marginTop: S.section }}>
          {THEME_OPTIONS.map((option) => (
            <ChoiceRow
              key={option}
              pal={B}
              title={t(`appearance.${option}`)}
              selected={themePreference === option}
              onPress={() => chooseTheme(option)}
              icon={
                option === 'light' ? <Sun size={20} color={B.inkDim} strokeWidth={S.stroke} />
                  : option === 'dark' ? <Moon size={20} color={B.inkDim} strokeWidth={S.stroke} />
                  : <Smartphone size={20} color={B.inkDim} strokeWidth={S.stroke} />
              }
            />
          ))}
        </Group>
        <Type role="meta" color={B.inkDim} style={{ paddingHorizontal: S.screen + 4, marginTop: 12 }}>
          {t('appearance.subtitle')}
        </Type>

        <Group pal={B} title={t('settings.sections.language')} style={{ marginTop: S.section }}>
          {SUPPORTED_LOCALES.map((code) => (
            <ChoiceRow
              key={code}
              pal={B}
              title={LOCALE_LABELS[code]}
              selected={locale === code}
              onPress={async () => {
                if (locale === code) return;
                // The store persists the choice and bumps the key the root
                // navigator is mounted on. That remount is what re-renders the
                // rest of the app, including this screen.
                if (await chooseLanguage(code)) {
                  // Direction is decided natively at launch, so nothing on
                  // screen flips until the app is reopened. Saying so beats
                  // leaving the layout facing the wrong way unexplained.
                  Alert.alert(t('language.restartTitle'), t('language.restartBody'));
                }
              }}
            />
          ))}
        </Group>
        <Type role="meta" color={B.inkDim} style={{ paddingHorizontal: S.screen + 4, marginTop: 12 }}>
          {t('language.subtitle')}
        </Type>

        {/* Signing out is not a primary action, so it is not a filled pill.
            Plain destructive text is the honest weight for it. */}
        <Group pal={B} style={{ marginTop: S.section }}>
          {/* No chevron: this row does not go anywhere, it does something. */}
          <Touchable
            pal={B}
            onPress={handleLogout}
            accessibilityLabel={t('businessSettings.signOut')}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 56 }}
          >
            <LogOut size={19} color={B.negative} strokeWidth={S.stroke} />
            <Type role="cardTitle" color={B.negative}>
              {t('businessSettings.signOut')}
            </Type>
          </Touchable>
        </Group>
      </ScrollView>
    </Screen>
  );
}
