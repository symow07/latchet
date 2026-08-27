import {
  View,
  ScrollView,
  TextInput,
  Switch,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { getSettings, updateSettings, getAccounts, resetAllData } from '@/lib/db';
import { exportTransactionsCSV, exportTransactionsJSON } from '@/lib/export-data';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DollarSign, Wallet, Clock, Eye, Flame, Award, Cloud, Check, ChevronRight, CreditCard, LogOut, Upload, Download, Fingerprint, PieChart, RotateCcw, Bell, Repeat, TrendingUp, Trash2, Sparkles } from 'lucide-react-native';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAccountTypeStore } from '@/lib/account-type-store';
import { isBiometricAvailable } from '@/lib/biometric';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { R, glow, useC } from '@/lib/design';
import { DeleteAccountModal, UnrevokedGrantsNotice } from '@/components/DeleteAccountModal';
import { useEntitlement } from '@/lib/useEntitlement';
import { t, SUPPORTED_LOCALES, LOCALE_LABELS } from '@/lib/i18n/core';
import { useLocaleStore } from '@/lib/i18n/locale-store';
import type { UnrevokedGrant } from '@/lib/accountApi';
import { Txt, GlassCard, IconBubble, BubbleButton, ScreenBackground } from '@/components/ui';

function SectionLabel({ children }: { children: string }) {
  const C = useC();
  return <Txt weight="bold" size={11} color={C.lilac} style={{ marginBottom: 12, marginStart: 4, letterSpacing: 1.2 }}>{children}</Txt>;
}

function NavRow({ icon, color, label, desc, onPress }: { icon: React.ReactNode; color: string; label: string; desc: string; onPress: () => void }) {
  const C = useC();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
      <GlassCard padding={14} tint={`${color}14`} border={`${color}2a`}>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center" style={{ gap: 12, flex: 1 }}>
            <IconBubble color={color}>{icon}</IconBubble>
            <View style={{ flex: 1 }}>
              <Txt weight="semibold" size={15} color={C.text}>{label}</Txt>
              <Txt size={11} color={C.textFaint} style={{ marginTop: 1 }}>{desc}</Txt>
            </View>
          </View>
          <ChevronRight size={20} color={color} />
        </View>
      </GlassCard>
    </Pressable>
  );
}

function MoneyInput({ icon, color, label, hint, value, onChangeText, placeholder, suffix }: {
  icon: React.ReactNode; color: string; label: string; hint: string; value: string; onChangeText: (t: string) => void; placeholder: string; suffix?: string;
}) {
  const C = useC();
  return (
    <View style={{ marginBottom: 14 }}>
      <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
        {icon}
        <Txt weight="semibold" size={13} color={C.textDim}>{label}</Txt>
      </View>
      <GlassCard padding={12} radius={R.md} tint={`${color}12`} border={`${color}28`}>
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <IconBubble color={color} size={40}><DollarSign size={19} color={color} /></IconBubble>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={C.textFaint}
            keyboardType="decimal-pad"
            style={{ flex: 1, color: C.text, fontSize: 20, fontFamily: 'PlusJakartaSans_700Bold', padding: 0 }}
            selectionColor={color}
          />
          {suffix ? <Txt size={16} color={C.textFaint}>{suffix}</Txt> : null}
        </View>
      </GlassCard>
      <Txt size={11} color={C.textFaint} style={{ marginTop: 6, marginStart: 4 }}>{hint}</Txt>
    </View>
  );
}

function ToggleRow({ icon, color, label, desc, value, onValueChange }: { icon: React.ReactNode; color: string; label: string; desc: string; value: boolean; onValueChange: (v: boolean) => void }) {
  const C = useC();
  return (
    <GlassCard padding={14} tint={`${color}12`} border={`${color}28`}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center" style={{ gap: 12, flex: 1 }}>
          <IconBubble color={color}>{icon}</IconBubble>
          <View style={{ flex: 1 }}>
            <Txt weight="semibold" size={15} color={C.text}>{label}</Txt>
            <Txt size={11} color={C.textFaint} style={{ marginTop: 1 }}>{desc}</Txt>
          </View>
        </View>
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: C.bgRaise, true: color }}
          thumbColor={value ? '#fff' : '#6b5f86'}
        />
      </View>
    </GlassCard>
  );
}

export default function SettingsScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const invalidateSession = useInvalidateSession();
  const resetAccountType = useAccountTypeStore(s => s.reset);
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
    AsyncStorage.getItem('@biometric_lock').then((val) => { if (val === 'true') setBiometricEnabled(true); });
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(t('dialogs.exportTitle'), t('dialogs.exportBody'), [
      { text: t('dialogs.exportCsv'), onPress: () => runExport('csv') },
      { text: t('dialogs.exportJson'), onPress: () => runExport('json') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  async function handleBiometricToggle(val: boolean) {
    if (val) {
      const available = await isBiometricAvailable();
      if (!available) {
        Alert.alert(t('dialogs.biometricsUnavailable'), 'Your device does not support biometric authentication or none are enrolled. Please set up Face ID / Fingerprint in device settings.', [{ text: 'OK' }]);
        return;
      }
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const tools = [
    { label: t('settingsRows.billRemindersLabel'), desc: t('settingsRows.billRemindersDesc'), Icon: Bell, color: C.p400, route: '/bill-reminders' },
    { label: t('settingsRows.recurringLabel'), desc: t('settingsRows.recurringDesc'), Icon: Repeat, color: C.green, route: '/recurring' },
    { label: t('settingsRows.netWorthLabel'), desc: t('settingsRows.netWorthDesc'), Icon: TrendingUp, color: C.sky, route: '/net-worth' },
    { label: t('settingsRows.categoryBudgetsLabel'), desc: t('settingsRows.categoryBudgetsDesc'), Icon: PieChart, color: C.rose, route: '/category-budgets' },
  ];

  return (
    <ScreenBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* ── Header ── */}
        <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 20 }}>
<Txt weight="bold" size={30} color={C.text}>{t('settingsHeader.title')}</Txt>
<Txt weight="medium" size={13} color={C.textDim} style={{ marginTop: 2 }}>{t('settingsHeader.subtitle')}</Txt>
        </View>

        {/* ── Accounts ── */}
        <Animated.View entering={FadeInUp.delay(40).springify().damping(16)} style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <SectionLabel>{t('settings.sections.accounts')}</SectionLabel>
          <NavRow icon={<CreditCard size={20} color={C.p400} />} color={C.p400} label={t('settings.manageAccounts')} desc={t('settingsHeader.accountsLinked', { count: accounts.length })} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/accounts'); }} />
        </Animated.View>

        {/* ── Import ── */}
        <Animated.View entering={FadeInUp.delay(70).springify().damping(16)} style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <SectionLabel>{t('settings.sections.import')}</SectionLabel>
          <NavRow icon={<Upload size={20} color={C.lilac} />} color={C.lilac} label={t('settings.importTransactions')} desc={t('settingsHeader.importDesc')} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/import'); }} />
        </Animated.View>

        {/* ── Tools ── */}
        <Animated.View entering={FadeInUp.delay(100).springify().damping(16)} style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <SectionLabel>{t('settings.sections.tools')}</SectionLabel>
          <View style={{ gap: 10 }}>
            {tools.map((item) => (
              <NavRow key={item.route} icon={<item.Icon size={20} color={item.color} />} color={item.color} label={item.label} desc={item.desc} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(item.route as any); }} />
            ))}
            <NavRow icon={<Download size={20} color={C.lilac} />} color={C.lilac} label={t('settings.exportData')} desc={t('misc2.exportDesc')} onPress={handleExportData} />
          </View>
        </Animated.View>

        {/* ── Numbers ── */}
        <Animated.View entering={FadeInUp.delay(130).springify().damping(16)} style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <SectionLabel>{t('settings.sections.numbers')}</SectionLabel>
          <MoneyInput icon={<Wallet size={15} color={C.p400} />} color={C.p400} label={t('settings.monthlyBudget')} hint={t('settings.monthlyBudgetHint')} value={monthlyBudget} onChangeText={setMonthlyBudget} placeholder="5000" />
          <MoneyInput icon={<Wallet size={15} color={C.green} />} color={C.green} label={t('settings.startingBalance')} hint={t('settings.startingBalanceHint')} value={startingBalance} onChangeText={setStartingBalance} placeholder="0" />
          <MoneyInput icon={<Clock size={15} color={C.lilac} />} color={C.lilac} label={t('settings.hourlyRate')} hint={t('settings.hourlyRateInputHint')} value={hourlyValue} onChangeText={setHourlyValue} placeholder="0" suffix="/hr" />
        </Animated.View>

        {/* ── Preferences ── */}
        <Animated.View entering={FadeInUp.delay(160).springify().damping(16)} style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <SectionLabel>{t('settings.sections.preferences')}</SectionLabel>
          <View style={{ gap: 12 }}>
            <ToggleRow icon={<Eye size={20} color={C.lilac} />} color={C.lilac} label={t('settingsToggles.timeCost')} desc={t('settings.hourlyRateHint')} value={showTimeCost} onValueChange={(val) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowTimeCost(val); }} />
            <ToggleRow icon={<Fingerprint size={20} color={C.p400} />} color={C.p400} label={t('settingsToggles.biometric')} desc={t('settingsToggles.biometricSub')} value={biometricEnabled} onValueChange={handleBiometricToggle} />
          </View>
        </Animated.View>

        {/* ── Time cost preview ── */}
        {hourlyValue && parseFloat(hourlyValue) > 0 && showTimeCost && (
          <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
            <GlassCard tint={`${C.p700}16`} border={`${C.p700}2e`}>
<Txt size={11} color={C.textDim} style={{ marginBottom: 3 }}>{t('misc2.example')}</Txt>
              <Txt size={14} color={C.text}>{t('settings.timeCostExample', { minutes: t('settings.minutesCount', { count: Math.round((50 / parseFloat(hourlyValue)) * 60) }) })}</Txt>
            </GlassCard>
          </View>
        )}

        {/* ── Save ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 26 }}>
          {saved ? (
            <LinearGradient colors={[C.green, '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[{ borderRadius: R.md, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, glow(C.green, 0.4, 18, C.glowScale)]}>
              <Check size={20} color="#fff" />
<Txt weight="bold" size={16} color="#fff">{t('settings.savedLabel')}</Txt>
            </LinearGradient>
          ) : (
            <BubbleButton label={mutation.isPending ? t('settings.savingLabel') : t('settings.saveLabel')} onPress={() => mutation.mutate()} disabled={mutation.isPending} />
          )}
        </View>

        {/* ── Features ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
          <SectionLabel>{t('settings.sections.features')}</SectionLabel>
          <View style={{ gap: 12 }}>
            {[
              { Icon: Flame, color: C.lilac, label: t('settingsRows.streakLabel'), desc: t('settingsRows.streakDesc') },
              { Icon: Award, color: C.p400, label: t('settingsRows.badgesLabel'), desc: t('settingsRows.badgesDesc') },
              { Icon: Cloud, color: C.p600, label: t('settingsRows.cloudLabel'), desc: t('settingsRows.cloudDesc') },
            ].map((f) => (
              <GlassCard key={f.label} padding={14} tint={`${f.color}12`} border={`${f.color}24`}>
                <View className="flex-row items-center" style={{ gap: 14 }}>
                  <IconBubble color={f.color} size={48} radius={18}><f.Icon size={23} color={f.color} /></IconBubble>
                  <View style={{ flex: 1 }}>
                    <Txt weight="semibold" size={15} color={C.text}>{f.label}</Txt>
                    <Txt size={11} color={C.textFaint} style={{ marginTop: 1 }}>{f.desc}</Txt>
                  </View>
                </View>
              </GlassCard>
            ))}
          </View>
        </View>

        {/* ── Version ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
          <Txt size={11} color={C.textFaint} style={{ textAlign: 'center' }}>{t('settings.version')}</Txt>
        </View>

        {/* ── Language ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
          <SectionLabel>{t('settings.sections.language')}</SectionLabel>
          <GlassCard padding={6}>
            {SUPPORTED_LOCALES.map((code, i) => {
              const active = locale === code;
              return (
                <Pressable
                  key={code}
                  onPress={async () => {
                    if (active) return;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    // The store persists the choice and bumps the key the root
                    // navigator is mounted on, which is what actually re-renders
                    // the other screens. Invalidating queries here was not
                    // enough: it only re-renders what subscribes to them.
                    await chooseLanguage(code);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 12,
                    paddingHorizontal: 10,
                    borderBottomWidth: i < SUPPORTED_LOCALES.length - 1 ? 1 : 0,
                    borderBottomColor: C.glassBorder,
                  }}
                >
                  <Txt size={15} color={active ? C.text : C.textFaint}>
                    {LOCALE_LABELS[code]}
                  </Txt>
                  {active && <Check size={18} color="#22c55e" />}
                </Pressable>
              );
            })}
          </GlassCard>
          <Txt size={11} color={C.textFaint} style={{ marginTop: 6, marginStart: 4 }}>
            {t('language.subtitle')}
          </Txt>
        </View>

        {/* ── Subscription ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
          <SectionLabel>{t('settings.sections.subscription')}</SectionLabel>

          <Pressable
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (isPro) return;
              await presentPaywall();
            }}
          >
            <GlassCard padding={14}>
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <IconBubble color={isPro ? '#22c55e' : C.p400}>
                  <Sparkles size={20} color={isPro ? '#22c55e' : C.p400} />
                </IconBubble>
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold" size={15} color={C.text}>
                    {isPro ? t('subscription.proTitle') : t('subscription.upgradeTitle')}
                  </Txt>
                  <Txt size={11} color={C.textFaint} style={{ marginTop: 1 }}>
                    {isPro
                      ? t('subscription.proSubtitle')
                      : t('subscription.upgradeSubtitle')}
                  </Txt>
                </View>
                {isPro ? (
                  <Check size={18} color="#22c55e" />
                ) : (
                  <ChevronRight size={18} color={C.textFaint} />
                )}
              </View>
            </GlassCard>
          </Pressable>

          {/* Apple requires a restore path for previously-purchased
              subscriptions — an app without one is rejected. */}
          <Pressable
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
            disabled={restoring}
            style={{ marginTop: 10 }}
          >
            <GlassCard padding={12}>
              <View className="flex-row items-center justify-center" style={{ gap: 8 }}>
                {restoring ? (
                  <ActivityIndicator size="small" color={C.textFaint} />
                ) : (
                  <RotateCcw size={16} color={C.textFaint} />
                )}
                <Txt size={13} color={C.textFaint}>{t('subscription.restore')}</Txt>
              </View>
            </GlassCard>
          </Pressable>
        </View>

        {/* ── Danger zone ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
          <SectionLabel>{t('settings.sections.danger')}</SectionLabel>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              Alert.alert(t('dialogs.resetTitle'), t('dialogs.resetBody'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('dialogs.resetTitle'), style: 'destructive',
                  onPress: async () => {
                    try {
                      await resetAllData();
                      setMonthlyBudget('0'); setStartingBalance('0'); setHourlyValue('0'); setShowTimeCost(false);
                      queryClient.invalidateQueries({ queryKey: ['transactions'] });
                      queryClient.invalidateQueries({ queryKey: ['settings'] });
                      queryClient.invalidateQueries({ queryKey: ['accounts'] });
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      Alert.alert(t('dialogs.done'), t('dialogs.resetDone'));
                    } catch (e) {
                      console.error('[Reset] error:', e);
                      Alert.alert(t('common.error'), t('dialogs.resetWebOnly'));
                    }
                  },
                },
              ]);
            }}
          >
            <GlassCard padding={14} tint="rgba(239,68,68,0.07)" border="rgba(239,68,68,0.18)">
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <IconBubble color="#ef4444"><RotateCcw size={20} color="#ef4444" /></IconBubble>
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold" size={15} color="#f87171">{t('common.reset')}</Txt>
                  <Txt size={11} color="rgba(248,113,113,0.6)" style={{ marginTop: 1 }}>{t('common.resetHint')}</Txt>
                </View>
              </View>
            </GlassCard>
          </Pressable>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              setShowDeleteAccount(true);
            }}
            style={{ marginTop: 12 }}
          >
            <GlassCard padding={14} tint="rgba(239,68,68,0.07)" border="rgba(239,68,68,0.18)">
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <IconBubble color="#ef4444"><Trash2 size={20} color="#ef4444" /></IconBubble>
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold" size={15} color="#f87171">{t('deleteAccount.entry')}</Txt>
                  <Txt size={11} color="rgba(248,113,113,0.6)" style={{ marginTop: 1 }}>{t('deleteAccount.entryHint')}</Txt>
                </View>
                <ChevronRight size={18} color="rgba(248,113,113,0.4)" />
              </View>
            </GlassCard>
          </Pressable>
        </View>

        {/* ── Logout ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <Pressable onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); resetAccountType(); await authClient.signOut(); await invalidateSession(); }}>
            <GlassCard padding={14} tint="rgba(239,68,68,0.07)" border="rgba(239,68,68,0.16)">
              <View className="flex-row items-center justify-center" style={{ gap: 8 }}>
                <LogOut size={20} color="#ef4444" />
                <Txt weight="semibold" size={15} color="#f87171">{t('settings.logOut')}</Txt>
              </View>
            </GlassCard>
          </Pressable>
        </View>
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
    </ScreenBackground>
  );
}
