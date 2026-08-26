import { View, Text, Pressable, ScrollView, TextInput, Modal } from 'react-native';
import { useC } from '@/lib/design';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Plus,
  Wallet,
  Building2,
  PiggyBank,
  CreditCard,
  TrendingUp,
  MoreHorizontal,
  Check,
  Trash2,
  X,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { getAccounts, createAccount, updateAccount, deleteAccount, getSettings, type Account } from '@/lib/db';
import { formatCurrencyAmount } from '@/lib/currencies';
import { t } from '@/lib/i18n/core';

// Built per call, not at module scope: t() at module scope resolves
// once at import and freezes the startup language.
function ACCOUNT_TYPES() {
  return [
  { id: 'cash', label: t('accountTypes.cash'), icon: Wallet, color: '#22c55e' },
  { id: 'checking', label: t('accountTypes.checking'), icon: Building2, color: '#3b82f6' },
  { id: 'savings', label: t('accountTypes.savings'), icon: PiggyBank, color: '#9333ea' },
  { id: 'credit', label: t('accountTypes.creditCard'), icon: CreditCard, color: '#ef4444' },
  { id: 'investment', label: t('accountTypes.investment'), icon: TrendingUp, color: '#f59e0b' },
  { id: 'other', label: 'Other', icon: MoreHorizontal, color: '#6b7280' },
];
}

const ACCOUNT_COLORS = [
  '#22c55e', '#3b82f6', '#9333ea', '#ef4444', '#f59e0b',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

export default function AccountsScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('cash');
  const [balance, setBalance] = useState('');
  const [color, setColor] = useState('#22c55e');

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: getAccounts,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  const currencyCode = settings?.currency || 'USD';

  const totalBalance = accounts.reduce((sum, acc) => {
    // Credit cards show as negative
    const adjustedBalance = acc.type === 'credit' ? -acc.balance : acc.balance;
    return sum + adjustedBalance;
  }, 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      await createAccount({
        name,
        type,
        balance: parseFloat(balance) || 0,
        currency: currencyCode,
        color,
        icon: type,
      });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      resetForm();
      setShowAddModal(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingAccount) return;
      await updateAccount(editingAccount.id, {
        name,
        type: type as Account['type'],
        balance: parseFloat(balance) || 0,
        color,
      });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      resetForm();
      setEditingAccount(null);
      setShowAddModal(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteAccount(id);
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const resetForm = () => {
    setName('');
    setType('cash');
    setBalance('');
    setColor('#22c55e');
  };

  const openEditModal = (account: Account) => {
    setEditingAccount(account);
    setName(account.name);
    setType(account.type);
    setBalance(account.balance.toString());
    setColor(account.color);
    setShowAddModal(true);
  };

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (editingAccount) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const handleDelete = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    deleteMutation.mutate(id);
  };

  const getAccountIcon = (accountType: string) => {
    const typeConfig = ACCOUNT_TYPES().find(t => t.id === accountType);
    return typeConfig?.icon || Wallet;
  };

  return (
    <View className="flex-1" style={{ backgroundColor: C.bg }}>
      {/* Header */}
      <LinearGradient
        colors={[C.p600, C.p500, C.p400, C.scheme === 'light' ? C.p300 : '#1e1b2e']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 12,
          paddingBottom: 24,
          paddingHorizontal: 20,
          borderBottomLeftRadius: 32,
          borderBottomRightRadius: 32,
        }}
      >
        <View className="flex-row items-center mb-4">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            className="w-10 h-10 rounded-full bg-white/10 items-center justify-center mr-3"
          >
            <ArrowLeft size={20} color="white" />
          </Pressable>
          <Text className="text-white text-xl font-bold flex-1">{t('accounts.title')}</Text>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              resetForm();
              setEditingAccount(null);
              setShowAddModal(true);
            }}
            className="w-10 h-10 rounded-full bg-white/20 items-center justify-center"
          >
            <Plus size={20} color="white" />
          </Pressable>
        </View>

        {/* Total Balance Card */}
        <View
          className="rounded-2xl p-4"
          style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
        >
          <Text className="text-white/70 text-sm mb-1">{t('accounts.totalNetWorth')}</Text>
          <Text className="text-white text-3xl font-bold">
            {formatCurrencyAmount(totalBalance, currencyCode)}
          </Text>
          <Text className="text-white/60 text-sm mt-1">
            Across {accounts.length} account{accounts.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </LinearGradient>

      {/* Account List */}
      <ScrollView className="flex-1 px-5 pt-6" showsVerticalScrollIndicator={false}>
        {accounts.length === 0 ? (
          <View className="items-center py-12">
            <Wallet size={48} color="#4b5563" />
            <Text style={{ color: C.textFaint }} className="text-center mt-4">
              No accounts yet.{'\n'}Tap + to add your first account.
            </Text>
          </View>
        ) : (
          accounts.map((account) => {
            const Icon = getAccountIcon(account.type);
            return (
              <Pressable
                key={account.id}
                onPress={() => openEditModal(account)}
                className="mb-3"
              >
                <View
                  className="rounded-2xl p-4 flex-row items-center"
                  style={{ backgroundColor: C.glass }}
                >
                  <View
                    className="w-12 h-12 rounded-xl items-center justify-center mr-4"
                    style={{ backgroundColor: `${account.color}20` }}
                  >
                    <Icon size={24} color={account.color} />
                  </View>
                  <View className="flex-1">
                    <Text style={{ color: C.text }} className="font-semibold text-lg">{account.name}</Text>
                    <Text style={{ color: C.textFaint }} className="text-sm capitalize">{account.type}</Text>
                  </View>
                  <View className="items-end">
                    <Text
                      className={`text-lg font-bold ${
                        account.type === 'credit' ? 'text-red-400' : ''
                      }`}
                    >
                      {account.type === 'credit' ? '-' : ''}
                      {formatCurrencyAmount(account.balance, currencyCode)}
                    </Text>
                    {account.isDefault === 1 && (
                      <View className="bg-purple-500/20 px-2 py-0.5 rounded-full mt-1">
                        <Text className="text-purple-400 text-xs">{t('accounts.default')}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setShowAddModal(false);
          setEditingAccount(null);
        }}
      >
        <View className="flex-1" style={{ backgroundColor: C.bg }}>
          <View
            className="flex-row items-center justify-between px-5 py-4 border-b border-gray-800"
            style={{ paddingTop: 16 }}
          >
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowAddModal(false);
                setEditingAccount(null);
              }}
            >
              <X size={24} color="#9ca3af" />
            </Pressable>
            <Text style={{ color: C.text }} className="text-lg font-semibold">
              {editingAccount ? 'Edit Account' : 'Add Account'}
            </Text>
            <Pressable
              onPress={handleSave}
              disabled={!name.trim()}
            >
              <Text
                className={`text-lg font-semibold ${
                  name.trim() ? 'text-purple-400' : ''
                }`}
              >
                Save
              </Text>
            </Pressable>
          </View>

          <ScrollView className="flex-1 px-5 py-6">
            {/* Account Name */}
            <View className="mb-6">
              <Text style={{ color: C.textDim }} className="text-sm mb-2 ml-1">{t('accounts.accountName')}</Text>
              <View
                className="rounded-2xl px-4 py-4"
                style={{ backgroundColor: C.glass }}
              >
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder={t('accounts.namePlaceholder')}
                  placeholderTextColor="#555"
                  className="text-lg"
                  selectionColor={C.p500}
                />
              </View>
            </View>

            {/* Account Type */}
            <View className="mb-6">
              <Text style={{ color: C.textDim }} className="text-sm mb-2 ml-1">{t('accounts.accountType')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {ACCOUNT_TYPES().map((t) => {
                  const Icon = t.icon;
                  const isSelected = type === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setType(t.id);
                        setColor(t.color);
                      }}
                      className="mb-2"
                    >
                      <View
                        className="rounded-xl px-4 py-3 flex-row items-center"
                        style={{
                          backgroundColor: isSelected
                            ? 'rgba(168, 85, 247, 0.2)'
                            : 'rgba(255,255,255,0.05)',
                          borderWidth: isSelected ? 1 : 0,
                          borderColor: 'rgba(168, 85, 247, 0.5)',
                        }}
                      >
                        <Icon size={18} color={isSelected ? C.p500 : '#9ca3af'} />
                        <Text
                          className={`ml-2 ${isSelected ? 'text-purple-400' : ''}`}
                        >
                          {t.label}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Current Balance */}
            <View className="mb-6">
              <Text style={{ color: C.textDim }} className="text-sm mb-2 ml-1">
                {type === 'credit' ? 'Current Balance (Amount Owed)' : 'Current Balance'}
              </Text>
              <View
                className="flex-row items-center rounded-2xl px-4 py-4"
                style={{ backgroundColor: C.glass }}
              >
                <Text style={{ color: C.text }} className="text-xl mr-1">{settings?.currencySymbol || '$'}</Text>
                <TextInput
                  value={balance}
                  onChangeText={setBalance}
                  placeholder="0.00"
                  placeholderTextColor="#555"
                  keyboardType="decimal-pad"
                  className="flex-1 text-xl font-semibold"
                  selectionColor={C.p500}
                />
              </View>
            </View>

            {/* Color */}
            <View className="mb-6">
              <Text style={{ color: C.textDim }} className="text-sm mb-2 ml-1">{t('accounts.color')}</Text>
              <View className="flex-row flex-wrap gap-3">
                {ACCOUNT_COLORS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setColor(c);
                    }}
                  >
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center"
                      style={{
                        backgroundColor: c,
                        borderWidth: color === c ? 3 : 0,
                        borderColor: 'white',
                      }}
                    >
                      {color === c && <Check size={18} color="white" />}
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Delete Button */}
            {editingAccount && (
              <Pressable
                onPress={() => {
                  handleDelete(editingAccount.id);
                  setShowAddModal(false);
                  setEditingAccount(null);
                }}
                className="mt-6"
              >
                <View className="flex-row items-center justify-center py-4 rounded-2xl bg-red-500/10">
                  <Trash2 size={20} color="#ef4444" />
                  <Text className="text-red-400 font-semibold ml-2">{t('accounts.delete')}</Text>
                </View>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
