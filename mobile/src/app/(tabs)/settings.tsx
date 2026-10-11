import { View, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { getSettings, updateSettings, getAccounts, resetAllData } from '@/lib/db';
import { exportTransactionsCSV, exportTransactionsJSON } from '@/lib/export-data';
import {
  Award, Bell, Cloud, CreditCard, Download, Eye, Fingerprint, Flame,
  HeartPulse, Home, LogOut, Moon, PieChart, Repeat, RotateCcw, Smartphone,
  Sparkles, Sun, Trash2, TrendingUp, Upload,
} from '@/components/icons';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAccountTypeStore } from '@/lib/account-type-store';
import { isBiometricAvailable } from '@/lib/biometric';
import { BAR, S, useC } from '@/lib/design';
import { DeleteAccountModal, UnrevokedGrantsNotice } from '@/components/DeleteAccountModal';
import {
  ChoiceRow, Field, Group, Header, IconTile, LinkRow, PrimaryButton, Screen,
  SwitchRow, Touchable, Type,
} from '@/components/kit';
import { useEntitlement } from '@/lib/useEntitlement';
import { t, SUPPORTED_LOCALES, LOCALE_LABELS } from '@/lib/i18n/core';
import { useLocaleStore } from '@/lib/i18n/locale-store';
import { useThemeStore, type ThemePreference } from '@/lib/theme-store';
import type { UnrevokedGrant } from '@/lib/accountApi';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * System first: it is the default, and putting an explicit choice above it
 * invites people to override a setting they never needed to touch.
 */
const THEME_OPTIONS: ThemePreference[] = ['system', 'light', 'dark'];

/**
 * Settings — DESIGN-PROMPT.md §17.
 *
 * Grouped cards on the off-white ground. What this replaces was the same
 * information wearing eleven different colours: every row was a card tinted
 * and outlined in its own hue, its icon chip tinted to match, and the section
 * headings were 11px tracked-out caps in `lilac`. The destructive rows were
 * pink-on-pink; the save button was a green gradient with a glow.
 *
 * Feature rows get one platinum squircle (kit IconTile), surfaces separate by
 * a soft shadow and a silver hairline rather than coloured outlines, and §3
 * has no uppercase caption style at all. Colour now appears exactly twice on
 * this screen: the tint on the icon tiles, and `negative` on the three things
 * that destroy data, which also say so in words.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidateSession = useInvalidateSession();
  const resetAccountType = useAccountTypeStore((s) => s.reset);
  const [monthlyBudget, setMonthlyBudget] = useState('');
  const [startingBalance, setStartingBalance] = useState('');
  const [hourlyValue, setHourlyValue] = useState('');
  const [showTimeCost, setShowTimeCost] = useState(false);
  const [saved, setSaved] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const locale = useLocaleStore((s) => s.locale);
  const chooseLanguage = useLocaleStore((s) => s.choose);
  const themePreference = useThemeStore((s) => s.preference);
  const chooseTheme = useThemeStore((s) => s.choose);
  const { isPro, presentPaywall, restore } = useEntitlement();
  const [unrevokedGrants, setUnrevokedGrants] = useState<UnrevokedGrant[] | null>(null);

  /**
   * The server has already deleted the account. Clear everything on-device too
   * — the local SQLite copy would otherwise survive the account it belongs to —
   * and drop the (now invalid) session.
   */
  const handleAccountDeleted = async (unrevoked: UnrevokedGrant[]) => {
    setShowDeleteAccount(false);
    try {
      await resetAllData();
    } catch (e) {
      console.error('[delete-account] local wipe failed:', e);
    }
    queryClient.clear();
    resetAccountType();
    await authClient.signOut().catch(() => {});
    await invalidateSession();

    // Shown over the signed-out screen; the account is gone either way.
    if (unrevoked.length > 0) setUnrevokedGrants(unrevoked);
  };

  useEffect(() => {
    AsyncStorage.getItem('@biometric_lock').then((val) => {
      if (val === 'true') setBiometricEnabled(true);
    });
  }, []);

  async function runExport(kind: 'csv' | 'json') {
    try {
      const count = kind === 'csv' ? await exportTransactionsCSV() : await exportTransactionsJSON();
      if (count === 0) Alert.alert(t('dialogs.exportNothing'), t('dialogs.exportNoneBody'));
    } catch (error) {
      console.error('Failed to export transactions:', error);
      Alert.alert(t('dialogs.exportFailed'), t('dialogs.exportFailedBody', { format: kind.toUpperCase() }));
    }
  }

  function handleExportData() {
    Alert.alert(t('dialogs.exportTitle'), t('dialogs.exportBody'), [
      { text: t('dialogs.exportCsv'), onPress: () => runExport('csv') },
      { text: t('dialogs.exportJson'), onPress: () => runExport('json') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  async function handleBiometricToggle(val: boolean) {
    if (val && !(await isBiometricAvailable())) {
      Alert.alert(t('dialogs.biometricsUnavailable'), t('settingsToggles.biometricUnavailableBody'));
      return;
    }
    setBiometricEnabled(val);
    await AsyncStorage.setItem('@biometric_lock', val ? 'true' : 'false');
  }

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getAccounts });

  useEffect(() => {
    if (settings) {
      setMonthlyBudget(settings.monthlyBudget.toString());
      setStartingBalance(settings.startingBalance.toString());
      setHourlyValue(settings.hourlyValue.toString());
      setShowTimeCost(Boolean(settings.showTimeCost));
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: async () => {
      await updateSettings({
        monthlyBudget: parseFloat(monthlyBudget) || 0,
        startingBalance: parseFloat(startingBalance) || 0,
        hourlyValue: parseFloat(hourlyValue) || 0,
        showTimeCost: showTimeCost ? 1 : 0,
      });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  });

  function handleReset() {
    Alert.alert(t('dialogs.resetTitle'), t('dialogs.resetBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('dialogs.resetTitle'),
        style: 'destructive',
        onPress: async () => {
          try {
            await resetAllData();
            setMonthlyBudget('0');
            setStartingBalance('0');
            setHourlyValue('0');
            setShowTimeCost(false);
            for (const key of ['transactions', 'settings', 'accounts']) {
              queryClient.invalidateQueries({ queryKey: [key] });
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(t('dialogs.done'), t('dialogs.resetDone'));
          } catch (e) {
            console.error('[Reset] error:', e);
            Alert.alert(t('common.error'), t('dialogs.resetWebOnly'));
          }
        },
      },
    ]);
  }

  // Every row's glyph sits on the same tile, so titles align down the screen.
  // The destructive rows pass `negative`; everything else is the tint.
  const tile = (
    Icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>,
    color: string = C.accent,
  ) => (
    <IconTile pal={C}>
      <Icon size={20} color={color} strokeWidth={S.stroke} />
    </IconTile>
  );

  const tools = [
    { label: t('settingsRows.billRemindersLabel'), desc: t('settingsRows.billRemindersDesc'), Icon: Bell, route: '/bill-reminders' },
    { label: t('settingsRows.recurringLabel'), desc: t('settingsRows.recurringDesc'), Icon: Repeat, route: '/recurring' },
    { label: t('settingsRows.netWorthLabel'), desc: t('settingsRows.netWorthDesc'), Icon: TrendingUp, route: '/net-worth' },
    { label: t('settingsRows.categoryBudgetsLabel'), desc: t('settingsRows.categoryBudgetsDesc'), Icon: PieChart, route: '/category-budgets' },
  ];

  const features = [
    { Icon: Flame, label: t('settingsRows.streakLabel'), desc: t('settingsRows.streakDesc') },
    { Icon: Award, label: t('settingsRows.badgesLabel'), desc: t('settingsRows.badgesDesc') },
    { Icon: Cloud, label: t('settingsRows.cloudLabel'), desc: t('settingsRows.cloudDesc') },
  ];

  return (
    <Screen pal={C}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8, paddingBottom: BAR.clearance(insets.bottom) }}>
        <Header
          pal={C}
          title={t('settingsHeader.title')}
          subtitle={t('settingsHeader.subtitle')}
        />

        <Group pal={C} title={t('settings.sections.numbers')} style={{ marginTop: 24 }}>
          <Field
            pal={C}
            label={t('settings.monthlyBudget')}
            value={monthlyBudget}
            onChangeText={setMonthlyBudget}
            placeholder="5000"
            keyboardType="decimal-pad"
            style={{ paddingVertical: 14 }}
          />
          <Field
            pal={C}
            label={t('settings.startingBalance')}
            value={startingBalance}
            onChangeText={setStartingBalance}
            placeholder="0"
            keyboardType="decimal-pad"
            style={{ paddingVertical: 14 }}
          />
          <Field
            pal={C}
            label={t('settings.hourlyRate')}
            value={hourlyValue}
            onChangeText={setHourlyValue}
            placeholder="0"
            keyboardType="decimal-pad"
            style={{ paddingVertical: 14 }}
          />
        </Group>

        <Type role="meta" color={C.inkDim} style={{ paddingHorizontal: S.screen + 4, marginTop: 12 }}>
          {t('settings.hourlyRateInputHint')}
        </Type>

        <PrimaryButton
          pal={C}
          label={saved
            ? t('settings.savedLabel')
            : mutation.isPending ? t('settings.savingLabel') : t('settings.saveLabel')}
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending}
          style={{ marginHorizontal: S.screen, marginTop: 16 }}
        />

        <Group pal={C} title={t('settings.sections.accounts')} style={{ marginTop: S.section }}>
          <LinkRow
            pal={C}
            icon={tile(CreditCard)}
            title={t('settings.manageAccounts')}
            body={t('settingsHeader.accountsLinked', { count: accounts.length })}
            onPress={() => router.push('/accounts')}
          />
          <LinkRow
            pal={C}
            icon={tile(Home)}
            title={t('household.title')}
            body={t('settings.householdDesc')}
            onPress={() => router.push('/household')}
          />
          <LinkRow
            pal={C}
            icon={tile(HeartPulse)}
            title={t('advisorProfile.title')}
            body={t('settings.advisorProfileDesc')}
            onPress={() => router.push('/advisor-profile')}
          />
          <LinkRow
            pal={C}
            icon={tile(Upload)}
            title={t('settings.importTransactions')}
            body={t('settingsHeader.importDesc')}
            onPress={() => router.push('/import')}
          />
          <LinkRow
            pal={C}
            icon={tile(Download)}
            title={t('settings.exportData')}
            body={t('misc2.exportDesc')}
            onPress={handleExportData}
          />
        </Group>

        <Group pal={C} title={t('settings.sections.tools')} style={{ marginTop: S.section }}>
          {tools.map((item) => (
            <LinkRow
              key={item.route}
              pal={C}
              icon={tile(item.Icon)}
              title={item.label}
              body={item.desc}
              onPress={() => router.push(item.route as never)}
            />
          ))}
        </Group>

        <Group pal={C} title={t('settings.sections.preferences')} style={{ marginTop: S.section }}>
          <SwitchRow
            pal={C}
            icon={tile(Eye)}
            title={t('settingsToggles.timeCost')}
            body={t('settings.hourlyRateHint')}
            value={showTimeCost}
            onValueChange={setShowTimeCost}
          />
          <SwitchRow
            pal={C}
            icon={tile(Fingerprint)}
            title={t('settingsToggles.biometric')}
            body={t('settingsToggles.biometricSub')}
            value={biometricEnabled}
            onValueChange={handleBiometricToggle}
          />
        </Group>

        {/* The example only helps while the rate is set and the feature is on;
            the rest of the time it is a sentence about nothing. */}
        {showTimeCost && parseFloat(hourlyValue) > 0 ? (
          <Type role="meta" color={C.inkDim} style={{ paddingHorizontal: S.screen + 4, marginTop: 12 }}>
            {t('settings.timeCostExample', {
              minutes: t('settings.minutesCount', {
                count: Math.round((50 / parseFloat(hourlyValue)) * 60),
              }),
            })}
          </Type>
        ) : null}

        <Group pal={C} title={t('settings.sections.appearance')} style={{ marginTop: S.section }}>
          {THEME_OPTIONS.map((option) => (
            <ChoiceRow
              key={option}
              pal={C}
              title={t(`appearance.${option}`)}
              body={option === 'system' ? t('appearance.systemHint') : undefined}
              selected={themePreference === option}
              // No remount and no restart: every screen reads its palette
              // through useC(), which subscribes to this store, so the whole
              // app repaints on the next render.
              onPress={() => chooseTheme(option)}
              icon={
                option === 'light' ? <Sun size={20} color={C.inkDim} strokeWidth={S.stroke} />
                  : option === 'dark' ? <Moon size={20} color={C.inkDim} strokeWidth={S.stroke} />
                  : <Smartphone size={20} color={C.inkDim} strokeWidth={S.stroke} />
              }
            />
          ))}
        </Group>
        <Type role="meta" color={C.inkDim} style={{ paddingHorizontal: S.screen + 4, marginTop: 12 }}>
          {t('appearance.subtitle')}
        </Type>

        <Group pal={C} title={t('settings.sections.language')} style={{ marginTop: S.section }}>
          {SUPPORTED_LOCALES.map((code) => (
            <ChoiceRow
              key={code}
              pal={C}
              title={LOCALE_LABELS[code]}
              selected={locale === code}
              onPress={async () => {
                if (locale === code) return;
                // The store persists the choice and bumps the key the root
                // navigator is mounted on, which is what actually re-renders
                // the other screens. Invalidating queries here was not enough:
                // it only re-renders what subscribes to them.
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
        <Type role="meta" color={C.inkDim} style={{ paddingHorizontal: S.screen + 4, marginTop: 12 }}>
          {t('language.subtitle')}
        </Type>

        <Group pal={C} title={t('settings.sections.subscription')} style={{ marginTop: S.section }}>
          <LinkRow
            pal={C}
            icon={tile(Sparkles)}
            title={isPro ? t('subscription.proTitle') : t('subscription.upgradeTitle')}
            body={isPro ? t('subscription.proSubtitle') : t('subscription.upgradeSubtitle')}
            onPress={isPro ? undefined : presentPaywall}
          />
          {/* Apple requires a restore path for previously-purchased
              subscriptions — an app without one is rejected. */}
          <Touchable
            pal={C}
            accessibilityLabel={t('subscription.restore')}
            onPress={restoring ? undefined : async () => {
              setRestoring(true);
              try {
                const restored = await restore();
                Alert.alert(
                  restored ? t('dialogs.restoreOkTitle') : t('dialogs.restoreNoneTitle'),
                  restored ? t('dialogs.restoreOkBody') : t('dialogs.restoreNoneBody'),
                );
              } finally {
                setRestoring(false);
              }
            }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 56 }}
          >
            {restoring
              ? <ActivityIndicator size="small" color={C.inkDim} />
              : <RotateCcw size={17} color={C.inkDim} strokeWidth={S.stroke} />}
            <Type role="meta" color={C.inkDim}>{t('subscription.restore')}</Type>
          </Touchable>
        </Group>

        <Group pal={C} title={t('settings.sections.features')} style={{ marginTop: S.section }}>
          {features.map((f) => (
            // No chevron and no press: these describe what the app does for
            // you, they are not places to go. Laid out like the kit's LinkRow
            // and SwitchRow (InfoRow would clip the description to one line).
            <View
              key={f.label}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 6 }}
            >
              {tile(f.Icon)}
              <View style={{ flex: 1 }}>
                <Type role="body" color={C.ink}>{f.label}</Type>
                <Type role="meta" color={C.inkDim}>{f.desc}</Type>
              </View>
            </View>
          ))}
        </Group>

        <Group pal={C} title={t('settings.sections.danger')} style={{ marginTop: S.section }}>
          <LinkRow
            pal={C}
            icon={tile(RotateCcw, C.negative)}
            title={t('common.reset')}
            body={t('common.resetHint')}
            onPress={handleReset}
          />
          <LinkRow
            pal={C}
            icon={tile(Trash2, C.negative)}
            title={t('deleteAccount.entry')}
            body={t('deleteAccount.entryHint')}
            onPress={() => setShowDeleteAccount(true)}
          />
          <Touchable
            pal={C}
            accessibilityLabel={t('settings.logOut')}
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              resetAccountType();
              await authClient.signOut();
              await invalidateSession();
            }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 56 }}
          >
            <LogOut size={19} color={C.negative} strokeWidth={S.stroke} />
            <Type role="cardTitle" color={C.negative}>{t('settings.logOut')}</Type>
          </Touchable>
        </Group>

        {/* inkDim, not inkFaint: inkFaint never carries text. */}
        <Type
          role="meta"
          color={C.inkDim}
          style={{ textAlign: 'center', marginTop: S.section }}
        >
          {t('settings.version')}
        </Type>
      </ScrollView>

      <DeleteAccountModal
        visible={showDeleteAccount}
        onClose={() => setShowDeleteAccount(false)}
        onDeleted={handleAccountDeleted}
      />
      {unrevokedGrants && (
        <UnrevokedGrantsNotice
          grants={unrevokedGrants}
          onDismiss={() => setUnrevokedGrants(null)}
        />
      )}
    </Screen>
  );
}
