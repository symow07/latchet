import {
  View,
  Text,
  ScrollView,
  TextInput,
  Switch,
  Pressable,
  Share,
  Alert,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { getSettings, updateSettings, getAccounts, getTransactions, resetAllData } from '@/lib/db';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DollarSign, Wallet, Clock, Eye, Flame, Award, Cloud, Check, ChevronRight, CreditCard, LogOut, Upload, Download, Fingerprint, PieChart, RotateCcw } from 'lucide-react-native';
import { authClient } from '@/lib/auth/auth-client';
import { useInvalidateSession } from '@/lib/auth/use-session';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAccountTypeStore } from '@/lib/account-type-store';
import { isBiometricAvailable } from '@/lib/biometric';

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

  useEffect(() => {
    AsyncStorage.getItem('@biometric_lock').then((val) => {
      if (val === 'true') setBiometricEnabled(true);
    });
  }, []);

  async function handleExportData() {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const txs = await getTransactions();
      const header = 'id,date,category,type,amount,isImpulse,note';
      const rows = txs.map((tx) =>
        [
          tx.id,
          tx.dateISO,
          tx.category,
          tx.type,
          tx.amount.toString(),
          tx.isImpulse ? '1' : '0',
          (tx.note ?? '').replace(/,/g, ';'),
        ].join(',')
      );
      const csv = [header, ...rows].join('\n');
      await Share.share({ message: csv, title: 'Budget Transactions' });
    } catch (error) {
      console.error('Failed to export transactions:', error);
      Alert.alert('Export Failed', 'Could not export transactions to CSV');
    }
  }

  async function handleBiometricToggle(val: boolean) {
    if (val) {
      const available = await isBiometricAvailable();
      if (!available) {
        Alert.alert(
          'Biometrics Unavailable',
          'Your device does not support biometric authentication or none are enrolled. Please set up Face ID / Fingerprint in device settings.',
          [{ text: 'OK' }]
        );
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
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  return (
    <View className="flex-1" style={{ backgroundColor: '#06060f' }}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Deep Purple Gradient Header */}
        <LinearGradient
          colors={['#2e1065', '#4c1d95', '#7c3aed', '#06060f']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            paddingTop: insets.top + 16,
            paddingBottom: 24,
            paddingHorizontal: 20,
            borderBottomLeftRadius: 36,
            borderBottomRightRadius: 36,
          }}
        >
          <Text className="text-3xl font-bold text-white mb-1">Settings ⚙️</Text>
          <Text className="text-purple-200/70">Make it yours — we won't judge! 😄</Text>
        </LinearGradient>

        {/* Account Management */}
        <View className="px-4 pt-6">
          <Text className="text-purple-400/70 text-xs font-bold mb-3 ml-1 tracking-wider">ACCOUNTS 👛</Text>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/accounts'); }}>
            <View
              className="rounded-3xl p-4 flex-row items-center justify-between"
              style={{ backgroundColor: 'rgba(168,85,247,0.1)', borderWidth: 1, borderColor: 'rgba(168,85,247,0.2)' }}
            >
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-2xl bg-purple-500/15 items-center justify-center mr-3">
                  <CreditCard size={20} color="#c084fc" />
                </View>
                <View>
                  <Text className="text-white font-semibold">Manage Accounts</Text>
                  <Text className="text-gray-500 text-xs mt-0.5">
                    {accounts.length} account{accounts.length !== 1 ? 's' : ''} linked
                  </Text>
                </View>
              </View>
              <ChevronRight size={20} color="#c084fc" />
            </View>
          </Pressable>
        </View>

        {/* Import Transactions */}
        <View className="px-4 pt-5">
          <Text className="text-purple-400/70 text-xs font-bold mb-3 ml-1 tracking-wider">IMPORT DATA 📥</Text>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/import'); }}>
            <View
              className="rounded-3xl p-4 flex-row items-center justify-between"
              style={{ backgroundColor: 'rgba(109,40,217,0.1)', borderWidth: 1, borderColor: 'rgba(109,40,217,0.2)' }}
            >
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-2xl bg-violet-500/15 items-center justify-center mr-3">
                  <Upload size={20} color="#a78bfa" />
                </View>
                <View>
                  <Text className="text-white font-semibold">Import Transactions</Text>
                  <Text className="text-gray-500 text-xs mt-0.5">Upload CSV from your bank</Text>
                </View>
              </View>
              <ChevronRight size={20} color="#a78bfa" />
            </View>
          </Pressable>
          <Text className="text-gray-700 text-xs mt-2 ml-1">
            Securely import without sharing credentials 🔒
          </Text>
        </View>

        {/* Tools */}
        <View className="px-4 pt-5">
          <Text className="text-purple-400/70 text-xs font-bold mb-3 ml-1 tracking-wider">TOOLS 🛠️</Text>
          <View className="gap-2">
            {[
              { label: 'Bill Reminders', desc: 'Track upcoming bills & due dates', icon: 'bell', color: '#c084fc', bg: 'rgba(192,132,252,0.1)', border: 'rgba(192,132,252,0.2)', route: '/bill-reminders' },
              { label: 'Recurring Transactions', desc: 'Auto-create scheduled expenses', icon: 'refresh', color: '#34d399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.2)', route: '/recurring' },
              { label: 'Net Worth', desc: 'Track assets vs liabilities', icon: 'trending', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.2)', route: '/net-worth' },
              { label: 'Category Budgets', desc: 'Set per-category monthly limits', icon: 'piechart', color: '#f472b6', bg: 'rgba(244,114,182,0.1)', border: 'rgba(244,114,182,0.2)', route: '/category-budgets' },
            ].map((item) => (
              <Pressable key={item.route} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(item.route as any); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <View
                  className="rounded-3xl p-4 flex-row items-center justify-between"
                  style={{ backgroundColor: item.bg, borderWidth: 1, borderColor: item.border }}
                >
                  <View className="flex-row items-center">
                    <View className="w-10 h-10 rounded-2xl items-center justify-center mr-3" style={{ backgroundColor: `${item.color}18` }}>
                      {item.icon === 'bell' && <Award size={20} color={item.color} />}
                      {item.icon === 'refresh' && <Upload size={20} color={item.color} />}
                      {item.icon === 'trending' && <Wallet size={20} color={item.color} />}
                      {item.icon === 'piechart' && <PieChart size={20} color={item.color} />}
                    </View>
                    <View>
                      <Text className="text-white font-semibold">{item.label}</Text>
                      <Text className="text-gray-500 text-xs mt-0.5">{item.desc}</Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color={item.color} />
                </View>
              </Pressable>
            ))}

            {/* Export Data */}
            <Pressable onPress={handleExportData}>
              <View
                className="rounded-3xl p-4 flex-row items-center justify-between"
                style={{ backgroundColor: 'rgba(109,40,217,0.1)', borderWidth: 1, borderColor: 'rgba(109,40,217,0.2)' }}
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-2xl items-center justify-center mr-3" style={{ backgroundColor: 'rgba(109,40,217,0.15)' }}>
                    <Download size={20} color="#a78bfa" />
                  </View>
                  <View>
                    <Text className="text-white font-semibold">Export Data</Text>
                    <Text className="text-gray-500 text-xs mt-0.5">Download transactions as CSV</Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#a78bfa" />
              </View>
            </Pressable>
          </View>
        </View>

        {/* Budget Settings */}
        <View className="px-4 pt-5">
          <Text className="text-purple-400/70 text-xs font-bold mb-3 ml-1 tracking-wider">YOUR NUMBERS 💰</Text>

          {/* Monthly Budget */}
          <View className="mb-3">
            <View className="flex-row items-center mb-2">
              <Wallet size={16} color="#c084fc" />
              <Text className="text-purple-300/80 text-sm ml-2">Monthly Budget</Text>
            </View>
            <View
              className="flex-row items-center rounded-3xl px-4 py-4"
              style={{ backgroundColor: 'rgba(168,85,247,0.08)', borderWidth: 1, borderColor: 'rgba(168,85,247,0.18)' }}
            >
              <View className="w-10 h-10 rounded-2xl bg-purple-500/15 items-center justify-center mr-3">
                <DollarSign size={20} color="#c084fc" />
              </View>
              <TextInput
                value={monthlyBudget}
                onChangeText={setMonthlyBudget}
                placeholder="5000"
                placeholderTextColor="#374151"
                keyboardType="decimal-pad"
                className="flex-1 text-white text-xl font-semibold bg-transparent"
                selectionColor="#c084fc"
              />
            </View>
            <Text className="text-gray-700 text-xs mt-1.5 ml-1">Your target monthly spending limit</Text>
          </View>

          {/* Starting Balance */}
          <View className="mb-3">
            <View className="flex-row items-center mb-2">
              <Wallet size={16} color="#34d399" />
              <Text className="text-emerald-300/80 text-sm ml-2">Starting Balance</Text>
            </View>
            <View
              className="flex-row items-center rounded-3xl px-4 py-4"
              style={{ backgroundColor: 'rgba(52,211,153,0.07)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.15)' }}
            >
              <View className="w-10 h-10 rounded-2xl bg-emerald-500/15 items-center justify-center mr-3">
                <DollarSign size={20} color="#34d399" />
              </View>
              <TextInput
                value={startingBalance}
                onChangeText={setStartingBalance}
                placeholder="0"
                placeholderTextColor="#374151"
                keyboardType="decimal-pad"
                className="flex-1 text-white text-xl font-semibold bg-transparent"
                selectionColor="#34d399"
              />
            </View>
            <Text className="text-gray-700 text-xs mt-1.5 ml-1">Your initial account balance</Text>
          </View>

          {/* Hourly Value */}
          <View className="mb-3">
            <View className="flex-row items-center mb-2">
              <Clock size={16} color="#a78bfa" />
              <Text className="text-violet-300/80 text-sm ml-2">Hourly Rate</Text>
            </View>
            <View
              className="flex-row items-center rounded-3xl px-4 py-4"
              style={{ backgroundColor: 'rgba(139,92,246,0.08)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.18)' }}
            >
              <View className="w-10 h-10 rounded-2xl bg-violet-500/15 items-center justify-center mr-3">
                <Clock size={20} color="#a78bfa" />
              </View>
              <TextInput
                value={hourlyValue}
                onChangeText={setHourlyValue}
                placeholder="0"
                placeholderTextColor="#374151"
                keyboardType="decimal-pad"
                className="flex-1 text-white text-xl font-semibold bg-transparent"
                selectionColor="#a78bfa"
              />
              <Text className="text-gray-500 text-lg">/hr</Text>
            </View>
            <Text className="text-gray-700 text-xs mt-1.5 ml-1">Used to calculate time cost of purchases ⏱️</Text>
          </View>
        </View>

        {/* Toggles */}
        <View className="px-4 pt-5">
          <Text className="text-purple-400/70 text-xs font-bold mb-3 ml-1 tracking-wider">PREFERENCES 🎛️</Text>

          <View
            className="rounded-3xl p-4 flex-row justify-between items-center mb-3"
            style={{ backgroundColor: 'rgba(109,40,217,0.1)', borderWidth: 1, borderColor: 'rgba(109,40,217,0.2)' }}
          >
            <View className="flex-row items-center flex-1">
              <View className="w-10 h-10 rounded-2xl bg-violet-500/15 items-center justify-center mr-3">
                <Eye size={20} color="#a78bfa" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold">Show Time Cost ⏱️</Text>
                <Text className="text-gray-500 text-xs mt-0.5">See purchases in work hours</Text>
              </View>
            </View>
            <Switch
              value={showTimeCost}
              onValueChange={(val) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowTimeCost(val);
              }}
              trackColor={{ false: '#1e1b2e', true: '#a78bfa' }}
              thumbColor={showTimeCost ? '#fff' : '#4b5563'}
            />
          </View>

          <View
            className="rounded-3xl p-4 flex-row justify-between items-center"
            style={{ backgroundColor: 'rgba(168,85,247,0.08)', borderWidth: 1, borderColor: 'rgba(168,85,247,0.18)' }}
          >
            <View className="flex-row items-center flex-1">
              <View className="w-10 h-10 rounded-2xl bg-purple-500/15 items-center justify-center mr-3">
                <Fingerprint size={20} color="#c084fc" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold">Biometric Lock 🔒</Text>
                <Text className="text-gray-500 text-xs mt-0.5">Require Face ID / Fingerprint on open</Text>
              </View>
            </View>
            <Switch
              value={biometricEnabled}
              onValueChange={handleBiometricToggle}
              trackColor={{ false: '#1e1b2e', true: '#c084fc' }}
              thumbColor={biometricEnabled ? '#fff' : '#4b5563'}
            />
          </View>
        </View>

        {/* Time Cost Preview */}
        {hourlyValue && parseFloat(hourlyValue) > 0 && showTimeCost && (
          <View className="px-4 pt-5">
            <View
              className="rounded-3xl p-4"
              style={{ backgroundColor: 'rgba(109,40,217,0.1)', borderWidth: 1, borderColor: 'rgba(109,40,217,0.22)' }}
            >
              <Text className="text-purple-300/70 text-xs mb-1">Example 💡</Text>
              <Text className="text-white text-sm">
                $50 purchase = <Text className="text-purple-400 font-bold">{Math.round((50 / parseFloat(hourlyValue)) * 60)} minutes</Text> of work
              </Text>
            </View>
          </View>
        )}

        {/* Save Button */}
        <View className="px-4 pt-8">
          <Pressable onPress={() => mutation.mutate()} disabled={mutation.isPending} className="active:scale-98">
            <LinearGradient
              colors={saved ? ['#34d399', '#059669'] : mutation.isPending ? ['#1e1b2e', '#1e1b2e'] : ['#6d28d9', '#a855f7']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 20,
                paddingVertical: 18,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
              }}
            >
              {saved && <Check size={20} color="white" style={{ marginRight: 8 }} />}
              <Text className="text-white font-bold text-lg">
                {saved ? 'Saved! 🎉' : mutation.isPending ? 'Saving...' : 'Save! ✨'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* Features Info */}
        <View className="px-4 pt-8">
          <Text className="text-purple-400/70 text-xs font-bold mb-4 ml-1 tracking-wider">FEATURES ✨</Text>
          <View className="gap-3">
            <View
              className="rounded-3xl p-4 flex-row items-center"
              style={{ backgroundColor: 'rgba(109,40,217,0.1)', borderWidth: 1, borderColor: 'rgba(109,40,217,0.18)' }}
            >
              <View className="w-12 h-12 rounded-2xl bg-violet-500/15 items-center justify-center mr-4">
                <Flame size={24} color="#a78bfa" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold">Logging Streak 🔥</Text>
                <Text className="text-gray-500 text-xs mt-0.5">Build streaks by logging transactions daily</Text>
              </View>
            </View>

            <View
              className="rounded-3xl p-4 flex-row items-center"
              style={{ backgroundColor: 'rgba(168,85,247,0.08)', borderWidth: 1, borderColor: 'rgba(168,85,247,0.18)' }}
            >
              <View className="w-12 h-12 rounded-2xl bg-purple-500/15 items-center justify-center mr-4">
                <Award size={24} color="#c084fc" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold">Achievement Badges 🏆</Text>
                <Text className="text-gray-500 text-xs mt-0.5">Unlock badges for good financial habits</Text>
              </View>
            </View>

            <View
              className="rounded-3xl p-4 flex-row items-center"
              style={{ backgroundColor: 'rgba(91,33,182,0.1)', borderWidth: 1, borderColor: 'rgba(91,33,182,0.2)' }}
            >
              <View className="w-12 h-12 rounded-2xl bg-violet-600/15 items-center justify-center mr-4">
                <Cloud size={24} color="#8b5cf6" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold">Cloud Synced ☁️</Text>
                <Text className="text-gray-500 text-xs mt-0.5">Data backed up securely to the cloud</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Version */}
        <View className="px-4 pt-8 pb-2">
          <Text className="text-gray-700 text-xs text-center">Budget v1.0.0 — made with care 💜</Text>
        </View>

        {/* Danger Zone */}
        <View className="px-4 pt-4">
          <Text className="text-gray-600 text-xs font-bold mb-3 ml-1 tracking-wider">CAREFUL ZONE ⚠️</Text>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              Alert.alert(
                'Reset All Activity',
                'This will permanently delete all your transactions, accounts, and reset your settings to zero. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Reset Everything',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await resetAllData();
                        setMonthlyBudget('0');
                        setStartingBalance('0');
                        setHourlyValue('0');
                        setShowTimeCost(false);
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
                ]
              );
            }}
          >
            <View
              className="rounded-3xl p-4 flex-row items-center"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.15)' }}
            >
              <View className="w-10 h-10 rounded-2xl bg-red-500/10 items-center justify-center mr-3">
                <RotateCcw size={20} color="#ef4444" />
              </View>
              <View className="flex-1">
                <Text className="text-red-400 font-semibold">Reset All Activity</Text>
                <Text className="text-red-400/50 text-xs mt-0.5">Delete all transactions & reset to zero</Text>
              </View>
            </View>
          </Pressable>
        </View>

        {/* Logout Button */}
        <View className="px-4 pt-3 pb-8">
          <Pressable
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              resetAccountType();
              await authClient.signOut();
              await invalidateSession();
            }}
          >
            <View
              className="rounded-3xl p-4 flex-row items-center justify-center"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.07)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.13)' }}
            >
              <LogOut size={20} color="#ef4444" />
              <Text className="text-red-400 font-semibold ml-2">Log Out</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
