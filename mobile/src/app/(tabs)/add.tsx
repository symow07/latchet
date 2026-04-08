import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Switch,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addTransaction, getSettings, getAccounts } from '@/lib/db';
import { Calendar, Clock, Zap, DollarSign, Tag, FileText, ArrowDownCircle, ArrowUpCircle, Wallet, ChevronDown, Building2, PiggyBank, CreditCard, TrendingUp, MoreHorizontal } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

const getAccountIcon = (type: string) => {
  switch (type) {
    case 'cash': return Wallet;
    case 'checking': return Building2;
    case 'savings': return PiggyBank;
    case 'credit': return CreditCard;
    case 'investment': return TrendingUp;
    default: return MoreHorizontal;
  }
};

const CATEGORIES = [
  { name: 'Food', icon: '🍔', color: '#fb923c', bg: 'rgba(251,146,60,0.15)', border: 'rgba(251,146,60,0.35)' },
  { name: 'Gym', icon: '💪', color: '#34d399', bg: 'rgba(52,211,153,0.15)', border: 'rgba(52,211,153,0.35)' },
  { name: 'Transport', icon: '🚗', color: '#60a5fa', bg: 'rgba(96,165,250,0.15)', border: 'rgba(96,165,250,0.35)' },
  { name: 'Shopping', icon: '🛍️', color: '#f472b6', bg: 'rgba(244,114,182,0.15)', border: 'rgba(244,114,182,0.35)' },
  { name: 'Subscriptions', icon: '📱', color: '#c084fc', bg: 'rgba(192,132,252,0.15)', border: 'rgba(192,132,252,0.35)' },
  { name: 'Other', icon: '📦', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)', border: 'rgba(148,163,184,0.35)' },
];

export default function AddTransactionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Food');
  const [type, setType] = useState<'Expense' | 'Income'>('Expense');
  const [isImpulse, setIsImpulse] = useState(false);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: getAccounts,
  });

  const defaultAccount = accounts.find(a => a.isDefault === 1);
  const currentAccountId = selectedAccountId || defaultAccount?.id;
  const selectedAccount = accounts.find(a => a.id === currentAccountId);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!amount || parseFloat(amount) <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      await addTransaction({
        amount: parseFloat(amount),
        category,
        type,
        isImpulse,
        note: note || undefined,
        dateISO: format(date, 'yyyy-MM-dd'),
        accountId: currentAccountId,
        currency: settings?.currency || 'USD',
      });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    },
    onError: (error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error(error);
    },
  });

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (selectedDate) {
      setDate(selectedDate);
    }
    setShowDatePicker(false);
  };

  const handleTypeChange = (newType: 'Expense' | 'Income') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setType(newType);
  };

  const handleCategoryChange = (cat: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCategory(cat);
  };

  const canSubmit = !mutation.isPending && !!amount && parseFloat(amount) > 0;

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
            paddingBottom: 32,
            paddingHorizontal: 20,
            borderBottomLeftRadius: 36,
            borderBottomRightRadius: 36,
          }}
        >
          <Text className="text-3xl font-bold text-white mb-1">Add Transaction</Text>
          <Text className="text-purple-200/70">Let's track that spending! 📝</Text>

          {/* Amount Input Card */}
          <View
            className="mt-6 rounded-3xl p-6 overflow-hidden"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
          >
            <View className="flex-row items-center mb-3">
              <DollarSign size={16} color="rgba(255,255,255,0.7)" />
              <Text className="text-purple-200/70 text-sm ml-1">How much? 💸</Text>
            </View>
            <View className="flex-row items-baseline">
              <Text className="text-5xl font-bold text-white">$</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor="rgba(255,255,255,0.3)"
                keyboardType="decimal-pad"
                className="flex-1 ml-2 text-6xl font-bold text-white bg-transparent"
                selectionColor="#c084fc"
              />
            </View>
          </View>
        </LinearGradient>

        {/* Type Selection */}
        <View className="px-4 pt-6">
          <View className="flex-row items-center mb-3">
            <Tag size={16} color="#6b7280" />
            <Text className="text-gray-400 text-sm ml-2">Transaction Type</Text>
          </View>
          <View className="flex-row gap-3">
            <Pressable onPress={() => handleTypeChange('Expense')} className="flex-1">
              <View
                className="py-4 px-4 rounded-2xl flex-row items-center justify-center"
                style={{
                  backgroundColor: type === 'Expense' ? 'rgba(251, 113, 133, 0.18)' : 'rgba(255,255,255,0.04)',
                  borderWidth: 1.5,
                  borderColor: type === 'Expense' ? 'rgba(251, 113, 133, 0.5)' : 'transparent',
                }}
              >
                <ArrowDownCircle size={20} color={type === 'Expense' ? '#fb7185' : '#4b5563'} />
                <Text className="ml-2 font-bold" style={{ color: type === 'Expense' ? '#fb7185' : '#4b5563' }}>
                  Expense
                </Text>
              </View>
            </Pressable>
            <Pressable onPress={() => handleTypeChange('Income')} className="flex-1">
              <View
                className="py-4 px-4 rounded-2xl flex-row items-center justify-center"
                style={{
                  backgroundColor: type === 'Income' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255,255,255,0.04)',
                  borderWidth: 1.5,
                  borderColor: type === 'Income' ? 'rgba(52, 211, 153, 0.5)' : 'transparent',
                }}
              >
                <ArrowUpCircle size={20} color={type === 'Income' ? '#34d399' : '#4b5563'} />
                <Text className="ml-2 font-bold" style={{ color: type === 'Income' ? '#34d399' : '#4b5563' }}>
                  Income
                </Text>
              </View>
            </Pressable>
          </View>
        </View>

        {/* Account Selection */}
        {accounts.length > 0 && (
          <View className="px-4 pt-6">
            <View className="flex-row items-center mb-3">
              <Wallet size={16} color="#6b7280" />
              <Text className="text-gray-400 text-sm ml-2">Account</Text>
            </View>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowAccountPicker(!showAccountPicker);
              }}
            >
              <View
                className="rounded-2xl p-4 flex-row items-center justify-between"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}
              >
                {selectedAccount ? (
                  <View className="flex-row items-center">
                    {(() => {
                      const Icon = getAccountIcon(selectedAccount.type);
                      return (
                        <View
                          className="w-10 h-10 rounded-xl items-center justify-center mr-3"
                          style={{ backgroundColor: `${selectedAccount.color}20` }}
                        >
                          <Icon size={20} color={selectedAccount.color} />
                        </View>
                      );
                    })()}
                    <View>
                      <Text className="text-white font-semibold">{selectedAccount.name}</Text>
                      <Text className="text-gray-500 text-xs capitalize">{selectedAccount.type}</Text>
                    </View>
                  </View>
                ) : (
                  <Text className="text-gray-500">Select an account</Text>
                )}
                <ChevronDown size={20} color="#6b7280" />
              </View>
            </Pressable>

            {showAccountPicker && (
              <View className="mt-2">
                {accounts.map((account) => {
                  const Icon = getAccountIcon(account.type);
                  const isSelected = account.id === currentAccountId;
                  return (
                    <Pressable
                      key={account.id}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedAccountId(account.id);
                        setShowAccountPicker(false);
                      }}
                      className="mb-2"
                    >
                      <View
                        className="rounded-xl p-3 flex-row items-center justify-between"
                        style={{
                          backgroundColor: isSelected ? 'rgba(168, 85, 247, 0.15)' : 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <View className="flex-row items-center">
                          <View
                            className="w-8 h-8 rounded-lg items-center justify-center mr-3"
                            style={{ backgroundColor: `${account.color}20` }}
                          >
                            <Icon size={16} color={account.color} />
                          </View>
                          <View>
                            <Text className="text-white text-sm">{account.name}</Text>
                            <Text className="text-gray-500 text-xs">{settings?.currencySymbol}{account.balance.toFixed(2)}</Text>
                          </View>
                        </View>
                        {isSelected && (
                          <View className="w-5 h-5 rounded-full bg-purple-500 items-center justify-center">
                            <Text className="text-white text-xs">✓</Text>
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Category Selection */}
        <View className="px-4 pt-6">
          <View className="flex-row items-center mb-3">
            <Tag size={16} color="#6b7280" />
            <Text className="text-gray-400 text-sm ml-2">Category</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {CATEGORIES.map(cat => {
              const isSelected = category === cat.name;
              return (
                <Pressable key={cat.name} onPress={() => handleCategoryChange(cat.name)}>
                  <View
                    className="py-3 px-4 rounded-2xl flex-row items-center"
                    style={{
                      backgroundColor: isSelected ? cat.bg : 'rgba(255,255,255,0.04)',
                      borderWidth: 1.5,
                      borderColor: isSelected ? cat.border : 'transparent',
                    }}
                  >
                    <Text className="mr-2">{cat.icon}</Text>
                    <Text className="font-semibold" style={{ color: isSelected ? cat.color : '#4b5563' }}>
                      {cat.name}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Date Selection */}
        <View className="px-4 pt-6">
          <View className="flex-row items-center mb-3">
            <Calendar size={16} color="#6b7280" />
            <Text className="text-gray-400 text-sm ml-2">Date</Text>
          </View>
          <Pressable onPress={() => setShowDatePicker(true)}>
            <View
              className="rounded-2xl p-4 flex-row items-center"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}
            >
              <View className="w-10 h-10 rounded-xl bg-purple-500/15 items-center justify-center mr-3">
                <Calendar size={20} color="#a855f7" />
              </View>
              <Text className="text-white font-semibold text-lg">
                {format(date, 'MMMM d, yyyy')}
              </Text>
            </View>
          </Pressable>
          {showDatePicker && (
            <DateTimePicker
              value={date}
              mode="date"
              display="spinner"
              onChange={handleDateChange}
              maximumDate={new Date()}
            />
          )}
        </View>

        {/* Impulse Toggle */}
        <View className="px-4 pt-6">
          <View
            className="rounded-2xl p-4 flex-row justify-between items-center"
            style={{
              backgroundColor: isImpulse ? 'rgba(244,114,182,0.1)' : 'rgba(255,255,255,0.04)',
              borderWidth: 1,
              borderColor: isImpulse ? 'rgba(244,114,182,0.3)' : 'rgba(255,255,255,0.07)',
            }}
          >
            <View className="flex-row items-center flex-1">
              <View className="w-10 h-10 rounded-xl bg-pink-500/15 items-center justify-center mr-3">
                <Zap size={20} color="#f472b6" />
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold">Impulse Purchase ⚡</Text>
                <Text className="text-gray-500 text-xs mt-0.5">Unplanned or emotional buy</Text>
              </View>
            </View>
            <Switch
              value={isImpulse}
              onValueChange={(val) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setIsImpulse(val);
              }}
              trackColor={{ false: '#1e1b2e', true: '#f472b6' }}
              thumbColor={isImpulse ? '#fff' : '#4b5563'}
            />
          </View>
        </View>

        {/* Note Input */}
        <View className="px-4 pt-6">
          <View className="flex-row items-center mb-3">
            <FileText size={16} color="#6b7280" />
            <Text className="text-gray-400 text-sm ml-2">Note (optional)</Text>
          </View>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What did you spend on? 🤔"
            placeholderTextColor="#374151"
            multiline
            numberOfLines={3}
            className="text-white rounded-2xl p-4 text-base"
            style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}
            selectionColor="#a855f7"
          />
        </View>

        {/* Time Cost Info */}
        {!!settings?.showTimeCost && settings?.hourlyValue > 0 && amount && parseFloat(amount) > 0 && (
          <View className="px-4 pt-6">
            <View
              className="rounded-2xl p-4 flex-row items-center"
              style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)', borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.2)' }}
            >
              <View className="w-10 h-10 rounded-xl bg-purple-500/15 items-center justify-center mr-3">
                <Clock size={20} color="#a855f7" />
              </View>
              <View>
                <Text className="text-gray-400 text-xs">Time Cost ⏱️</Text>
                <Text className="text-lg font-bold text-purple-400">
                  {Math.round((parseFloat(amount) / settings.hourlyValue) * 60)} minutes of work
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Add Button */}
        <View className="px-4 pt-8">
          <Pressable onPress={() => mutation.mutate()} disabled={!canSubmit} className="active:scale-98">
            <LinearGradient
              colors={!canSubmit ? ['#1e1b2e', '#1e1b2e'] : ['#6d28d9', '#a855f7']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 20,
                paddingVertical: 18,
                alignItems: 'center',
                opacity: !canSubmit ? 0.5 : 1,
              }}
            >
              <Text className="text-white font-bold text-lg">
                {mutation.isPending ? 'Logging...' : 'Log it! 🎉'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
