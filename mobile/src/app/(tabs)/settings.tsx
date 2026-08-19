import {
  View,
  ScrollView,
  TextInput,
  Switch,
  Pressable,
  Alert,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { getSettings, updateSettings, getAccounts, resetAllData } from '@/lib/db';
import { exportTransactionsCSV, exportTransactionsJSON } from '@/lib/export-data';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DollarSign, Wallet, Clock, Eye, Flame, Award, Cloud, Check, ChevronRight, CreditCard, LogOut, Upload, Download, Fingerprint, PieChart, RotateCcw, Bell, Repeat, TrendingUp, Trash2 } from 'lucide-react-native';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAccountTypeStore } from '@/lib/account-type-store';
import { isBiometricAvailable } from '@/lib/biometric';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { C, R, glow } from '@/lib/design';
import { DeleteAccountModal, UnrevokedGrantsNotice } from '@/components/DeleteAccountModal';
import type { UnrevokedGrant } from '@/lib/accountApi';
import { Txt, GlassCard, IconBubble, BubbleButton, ScreenBackground } from '@/components/ui';

function SectionLabel({ children }: { children: string }) {
  return <Txt weight="bold" size={11} color={C.lilac} style={{ marginBottom: 12, marginLeft: 4, letterSpacing: 1.2 }}>{children}</Txt>;
}

function NavRow({ icon, color, label, desc, onPress }: { icon: React.ReactNode; color: string; label: string; desc: string; onPress: () => void }) {
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
      <Txt size={11} color={C.textFaint} style={{ marginTop: 6, marginLeft: 4 }}>{hint}</Txt>
    </View>
  );
}

function ToggleRow({ icon, color, label, desc, value, onValueChange }: { icon: React.ReactNode; color: string; label: string; desc: string; value: boolean; onValueChange: (v: boolean) => void }) {
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
      if (count === 0) Alert.alert('Nothing to Export', 'You have no transactions yet.');
    } catch (error) {
      console.error('Failed to export transactions:', error);
      Alert.alert('Export Failed', `Could not export transactions to ${kind.toUpperCase()}`);
    }
  }

  function handleExportData() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Export Data', 'Choose a format to share or back up your transactions.', [
      { text: 'CSV (re-importable)', onPress: () => runExport('csv') },
      { text: 'JSON (full backup)', onPress: () => runExport('json') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleBiometricToggle(val: boolean) {
    if (val) {
      const available = await isBiometricAvailable();
      if (!available) {
        Alert.alert('Biometrics Unavailable', 'Your device does not support biometric authentication or none are enrolled. Please set up Face ID / Fingerprint in device settings.', [{ text: 'OK' }]);
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
    { label: 'Bill Reminders', desc: 'Track upcoming bills & due dates', Icon: Bell, color: C.p400, route: '/bill-reminders' },
    { label: 'Recurring Transactions', desc: 'Auto-create scheduled expenses', Icon: Repeat, color: C.green, route: '/recurring' },
    { label: 'Net Worth', desc: 'Track assets vs liabilities', Icon: TrendingUp, color: C.sky, route: '/net-worth' },
    { label: 'Category Budgets', desc: 'Set per-category monthly limits', Icon: PieChart, color: C.rose, route: '/category-budgets' },
  ];

  return (
    <ScreenBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* ── Header ── */}
        <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 20 }}>
          <Txt weight="bold" size={30} color={C.text}>Settings ⚙️</Txt>
          <Txt weight="medium" size={13} color={C.textDim} style={{ marginTop: 2 }}>Make it yours — we won't judge! 😄</Txt>
        </View>

        {/* ── Accounts ── */}
        <Animated.View entering={FadeInUp.delay(40).springify().damping(16)} style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <SectionLabel>ACCOUNTS 👛</SectionLabel>
          <NavRow icon={<CreditCard size={20} color={C.p400} />} color={C.p400} label="Manage Accounts" desc={`${accounts.length} account${accounts.length !== 1 ? 's' : ''} linked`} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/accounts'); }} />
        </Animated.View>

        {/* ── Import ── */}
        <Animated.View entering={FadeInUp.delay(70).springify().damping(16)} style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <SectionLabel>IMPORT DATA 📥</SectionLabel>
          <NavRow icon={<Upload size={20} color={C.lilac} />} color={C.lilac} label="Import Transactions" desc="Upload CSV from your bank 🔒" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/import'); }} />
        </Animated.View>

        {/* ── Tools ── */}
        <Animated.View entering={FadeInUp.delay(100).springify().damping(16)} style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <SectionLabel>TOOLS 🛠️</SectionLabel>
          <View style={{ gap: 10 }}>
            {tools.map((item) => (
              <NavRow key={item.route} icon={<item.Icon size={20} color={item.color} />} color={item.color} label={item.label} desc={item.desc} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(item.route as any); }} />
            ))}
            <NavRow icon={<Download size={20} color={C.lilac} />} color={C.lilac} label="Export Data" desc="Download transactions as CSV/JSON" onPress={handleExportData} />
          </View>
        </Animated.View>

        {/* ── Numbers ── */}
        <Animated.View entering={FadeInUp.delay(130).springify().damping(16)} style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <SectionLabel>YOUR NUMBERS 💰</SectionLabel>
          <MoneyInput icon={<Wallet size={15} color={C.p400} />} color={C.p400} label="Monthly Budget" hint="Your target monthly spending limit" value={monthlyBudget} onChangeText={setMonthlyBudget} placeholder="5000" />
          <MoneyInput icon={<Wallet size={15} color={C.green} />} color={C.green} label="Starting Balance" hint="Your initial account balance" value={startingBalance} onChangeText={setStartingBalance} placeholder="0" />
          <MoneyInput icon={<Clock size={15} color={C.lilac} />} color={C.lilac} label="Hourly Rate" hint="Used to calculate time cost of purchases ⏱️" value={hourlyValue} onChangeText={setHourlyValue} placeholder="0" suffix="/hr" />
        </Animated.View>

        {/* ── Preferences ── */}
        <Animated.View entering={FadeInUp.delay(160).springify().damping(16)} style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <SectionLabel>PREFERENCES 🎛️</SectionLabel>
          <View style={{ gap: 12 }}>
            <ToggleRow icon={<Eye size={20} color={C.lilac} />} color={C.lilac} label="Show Time Cost ⏱️" desc="See purchases in work hours" value={showTimeCost} onValueChange={(val) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowTimeCost(val); }} />
            <ToggleRow icon={<Fingerprint size={20} color={C.p400} />} color={C.p400} label="Biometric Lock 🔒" desc="Require Face ID / Fingerprint on open" value={biometricEnabled} onValueChange={handleBiometricToggle} />
          </View>
        </Animated.View>

        {/* ── Time cost preview ── */}
        {hourlyValue && parseFloat(hourlyValue) > 0 && showTimeCost && (
          <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
            <GlassCard tint={`${C.p700}16`} border={`${C.p700}2e`}>
              <Txt size={11} color={C.textDim} style={{ marginBottom: 3 }}>Example 💡</Txt>
              <Txt size={14} color={C.text}>$50 purchase = <Txt weight="bold" size={14} color={C.p400}>{Math.round((50 / parseFloat(hourlyValue)) * 60)} minutes</Txt> of work</Txt>
            </GlassCard>
          </View>
        )}

        {/* ── Save ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 26 }}>
          {saved ? (
            <LinearGradient colors={[C.green, '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[{ borderRadius: R.md, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, glow(C.green, 0.4, 18)]}>
              <Check size={20} color="#fff" />
              <Txt weight="bold" size={16} color="#fff">Saved! 🎉</Txt>
            </LinearGradient>
          ) : (
            <BubbleButton label={mutation.isPending ? 'Saving…' : 'Save! ✨'} onPress={() => mutation.mutate()} disabled={mutation.isPending} />
          )}
        </View>

        {/* ── Features ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
          <SectionLabel>FEATURES ✨</SectionLabel>
          <View style={{ gap: 12 }}>
            {[
              { Icon: Flame, color: C.lilac, label: 'Logging Streak 🔥', desc: 'Build streaks by logging transactions daily' },
              { Icon: Award, color: C.p400, label: 'Achievement Badges 🏆', desc: 'Unlock badges for good financial habits' },
              { Icon: Cloud, color: C.p600, label: 'Cloud Synced ☁️', desc: 'Data backed up securely to the cloud' },
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
          <Txt size={11} color={C.textFaint} style={{ textAlign: 'center' }}>Budget v1.0.0 — made with care 💜</Txt>
        </View>

        {/* ── Danger zone ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
          <SectionLabel>CAREFUL ZONE ⚠️</SectionLabel>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              Alert.alert('Reset All Activity', 'This will permanently delete all your transactions, accounts, and reset your settings to zero. This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Reset Everything', style: 'destructive',
                  onPress: async () => {
                    try {
                      await resetAllData();
                      setMonthlyBudget('0'); setStartingBalance('0'); setHourlyValue('0'); setShowTimeCost(false);
                      queryClient.invalidateQueries({ queryKey: ['transactions'] });
                      queryClient.invalidateQueries({ queryKey: ['settings'] });
                      queryClient.invalidateQueries({ queryKey: ['accounts'] });
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      Alert.alert('Done', 'All your activity has been reset to zero.');
                    } catch (e) {
                      console.error('[Reset] error:', e);
                      Alert.alert('Error', 'Reset is only available on the mobile app, not in the browser preview.');
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
                  <Txt weight="semibold" size={15} color="#f87171">Reset All Activity</Txt>
                  <Txt size={11} color="rgba(248,113,113,0.6)" style={{ marginTop: 1 }}>Delete all transactions & reset to zero</Txt>
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
                  <Txt weight="semibold" size={15} color="#f87171">Delete Account</Txt>
                  <Txt size={11} color="rgba(248,113,113,0.6)" style={{ marginTop: 1 }}>Permanently erase your account and all data</Txt>
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
                <Txt weight="semibold" size={15} color="#f87171">Log Out</Txt>
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
