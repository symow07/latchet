import {
  View,
  Pressable,
  ScrollView,
  TextInput,
  Switch,
  Modal,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addTransaction, getSettings, getAccounts, addCustomCategory } from '@/lib/db';
import { Calendar, Clock, Zap, DollarSign, Tag, FileText, ArrowDownCircle, ArrowUpCircle, Wallet, ChevronDown, Building2, PiggyBank, CreditCard, TrendingUp, MoreHorizontal, Plus, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { R, glow, useC } from '@/lib/design';
import { Txt, GlassCard, IconBubble, BubbleButton, ScreenBackground, Emoji } from '@/components/ui';
import { getCategories, DEFAULT_CATEGORIES, CATEGORY_EMOJIS, CATEGORY_COLORS, categoryLabel } from '@/lib/categories';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

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

function FieldLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  const C = useC();
  return (
    <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
      {icon}
      <Txt weight="semibold" size={12} color={C.textDim}>{label}</Txt>
    </View>
  );
}

export default function AddTransactionScreen() {
  const C = useC();
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

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getAccounts });
  const { data: categories = DEFAULT_CATEGORIES } = useQuery({ queryKey: ['categories'], queryFn: getCategories });

  const queryClient = useQueryClient();

  // Create-category modal
  const [showCatModal, setShowCatModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState(CATEGORY_EMOJIS[0]);
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[0]);

  async function handleCreateCategory() {
    const name = newCatName.trim();
    if (!name) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await addCustomCategory({ name, icon: newCatEmoji, color: newCatColor });
    await queryClient.invalidateQueries({ queryKey: ['categories'] });
    setCategory(name);
    setNewCatName('');
    setShowCatModal(false);
  }

  const defaultAccount = accounts.find(a => a.isDefault === 1);
  const currentAccountId = selectedAccountId || defaultAccount?.id;
  const selectedAccount = accounts.find(a => a.id === currentAccountId);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!amount || parseFloat(amount) <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        throw new Error('Invalid amount');
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
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] });
      const previousTransactions = queryClient.getQueryData(['transactions']);
      const optimisticTx = {
        id: `temp_${Date.now()}`,
        amount: parseFloat(amount || '0'),
        category,
        type,
        isImpulse: isImpulse ? 1 : 0,
        note: note || null,
        dateISO: format(date, 'yyyy-MM-dd'),
        accountId: currentAccountId || null,
        currency: settings?.currency || 'USD',
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData(['transactions'], (old: any[] | undefined) =>
        old ? [optimisticTx, ...old] : [optimisticTx]
      );
      return { previousTransactions };
    },
    onError: (_error, _vars, context) => {
      if (context?.previousTransactions) {
        queryClient.setQueryData(['transactions'], context.previousTransactions);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (selectedDate) setDate(selectedDate);
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
    <ScreenBackground>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 130 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header + amount ── */}
        <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 20 }}>
          <Txt weight="bold" size={30} color={C.text}>{t('addTransaction.title')}</Txt>
          <Txt weight="medium" size={13} color={C.textDim} style={{ marginTop: 2 }}>{t('addTransaction.subtitle')}</Txt>

          <Animated.View entering={FadeInUp.delay(40).springify().damping(16)}>
            <LinearGradient
              colors={[C.p700, C.p600, C.p800]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[{ borderRadius: R.xl, padding: 22, marginTop: 18, overflow: 'hidden' }, glow(C.p600, 0.4, 24, C.glowScale)]}
            >
              <View style={{ position: 'absolute', top: -50, right: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: C.glassStrong }} />
              <View className="flex-row items-center mb-2" style={{ gap: 6 }}>
                <DollarSign size={15} color="rgba(255,255,255,0.75)" />
                <Txt weight="semibold" size={13} color="rgba(255,255,255,0.8)">{t('addTransaction.howMuch')}</Txt>
              </View>
              <View className="flex-row items-center">
                <Txt weight="bold" size={40} color="#fff">$</Txt>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0.00"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  keyboardType="decimal-pad"
                  style={{ flex: 1, marginLeft: 8, fontSize: 52, fontFamily: 'PlusJakartaSans_700Bold', color: '#fff', padding: 0 }}
                  selectionColor={C.p300}
                />
              </View>
            </LinearGradient>
          </Animated.View>
        </View>

        {/* ── Type ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <FieldLabel icon={<Tag size={15} color={C.textFaint} />} label={t('addTx.type')} />
          <View className="flex-row" style={{ gap: 12 }}>
            {([
              { t: 'Expense' as const, Icon: ArrowDownCircle, color: C.rose },
              { t: 'Income' as const, Icon: ArrowUpCircle, color: C.green },
            ]).map(({ t, Icon, color }) => {
              const active = type === t;
              return (
                <Pressable key={t} onPress={() => handleTypeChange(t)} style={{ flex: 1 }}>
                  <View style={{ paddingVertical: 16, borderRadius: R.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: active ? `${color}24` : C.glass, borderWidth: 1.5, borderColor: active ? `${color}77` : 'transparent' }}>
                    <Icon size={20} color={active ? color : C.textFaint} />
                    <Txt weight="bold" size={15} color={active ? color : C.textFaint}>{t}</Txt>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── Account ── */}
        {accounts.length > 0 && (
          <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
            <FieldLabel icon={<Wallet size={15} color={C.textFaint} />} label={t('addTx.account')} />
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowAccountPicker(!showAccountPicker); }}>
              <GlassCard padding={14} radius={R.md}>
                <View className="flex-row items-center justify-between">
                  {selectedAccount ? (
                    <View className="flex-row items-center" style={{ gap: 12 }}>
                      {(() => { const Icon = getAccountIcon(selectedAccount.type); return (
                        <IconBubble color={selectedAccount.color} size={40}><Icon size={19} color={selectedAccount.color} /></IconBubble>
                      ); })()}
                      <View>
                        <Txt weight="semibold" size={14} color={C.text}>{selectedAccount.name}</Txt>
                        <Txt size={11} color={C.textFaint} style={{ textTransform: 'capitalize' }}>{selectedAccount.type}</Txt>
                      </View>
                    </View>
                  ) : <Txt color={C.textFaint}>{t('addTransaction.selectAccount')}</Txt>}
                  <ChevronDown size={20} color={C.textFaint} />
                </View>
              </GlassCard>
            </Pressable>

            {showAccountPicker && (
              <View style={{ marginTop: 8, gap: 8 }}>
                {accounts.map((account) => {
                  const Icon = getAccountIcon(account.type);
                  const isSelected = account.id === currentAccountId;
                  return (
                    <Pressable key={account.id} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedAccountId(account.id); setShowAccountPicker(false); }}>
                      <View style={{ borderRadius: R.sm, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: isSelected ? `${C.p500}22` : C.glass, borderWidth: 1, borderColor: isSelected ? `${C.p500}44` : 'transparent' }}>
                        <View className="flex-row items-center" style={{ gap: 12 }}>
                          <IconBubble color={account.color} size={34} radius={12}><Icon size={16} color={account.color} /></IconBubble>
                          <View>
                            <Txt size={13} color={C.text}>{account.name}</Txt>
                            <Txt size={11} color={C.textFaint}>{settings?.currencySymbol}{account.balance.toFixed(2)}</Txt>
                          </View>
                        </View>
                        {isSelected && (
                          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: C.p500, alignItems: 'center', justifyContent: 'center' }}>
                            <Txt size={11} color="#fff">✓</Txt>
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

        {/* ── Category ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <FieldLabel icon={<Tag size={15} color={C.textFaint} />} label={t('addTx.category')} />
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            {categories.map(cat => {
              const isSelected = category === cat.name;
              return (
                <Pressable key={cat.name} onPress={() => handleCategoryChange(cat.name)}>
                  <View style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: isSelected ? `${cat.color}26` : C.glass, borderWidth: 1.5, borderColor: isSelected ? `${cat.color}77` : 'transparent' }}>
                    <Emoji size={14}>{cat.icon}</Emoji>
                    <Txt weight="semibold" size={13} color={isSelected ? cat.color : C.textFaint}>{categoryLabel(cat.name, categories)}</Txt>
                  </View>
                </Pressable>
              );
            })}
            {/* Add a personalized category */}
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowCatModal(true); }}>
              <View style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: `${C.p500}55`, borderStyle: 'dashed' }}>
                <Plus size={15} color={C.p400} />
                <Txt weight="semibold" size={13} color={C.p400}>New</Txt>
              </View>
            </Pressable>
          </View>
        </View>

        {/* ── Create-category modal ── */}
        <Modal visible={showCatModal} transparent animationType="fade" onRequestClose={() => setShowCatModal(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 }} onPress={() => setShowCatModal(false)}>
            <Pressable onPress={() => {}} style={{ backgroundColor: C.bgRaise, borderRadius: R.xl, padding: 22, borderWidth: 1, borderColor: C.glassBorder }}>
              <View className="flex-row items-center justify-between" style={{ marginBottom: 18 }}>
                <Txt weight="bold" size={19} color={C.text}>{t('addTransaction.newCategory')}</Txt>
                <Pressable onPress={() => setShowCatModal(false)} hitSlop={10}><X size={22} color={C.textFaint} /></Pressable>
              </View>

              {/* Live preview */}
              <View style={{ alignSelf: 'flex-start', paddingVertical: 12, paddingHorizontal: 16, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: `${newCatColor}26`, borderWidth: 1.5, borderColor: `${newCatColor}77`, marginBottom: 18 }}>
                <Emoji size={16}>{newCatEmoji}</Emoji>
                <Txt weight="semibold" size={14} color={newCatColor}>{newCatName.trim() || 'Category name'}</Txt>
              </View>

              <TextInput
                value={newCatName}
                onChangeText={setNewCatName}
                placeholder={t('addTx.notePlaceholder')}
                placeholderTextColor={C.textFaint}
                maxLength={20}
                style={{ color: C.text, fontSize: 16, fontFamily: 'PlusJakartaSans_600SemiBold', backgroundColor: C.glass, borderRadius: R.md, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: C.glassBorder, marginBottom: 16 }}
                selectionColor={C.p500}
              />

              <Txt weight="semibold" size={12} color={C.textDim} style={{ marginBottom: 8 }}>{t('addTransaction.icon')}</Txt>
              <View className="flex-row flex-wrap" style={{ gap: 8, marginBottom: 16 }}>
                {CATEGORY_EMOJIS.map(e => (
                  <Pressable key={e} onPress={() => setNewCatEmoji(e)}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: newCatEmoji === e ? `${C.p500}30` : C.glass, borderWidth: 1.5, borderColor: newCatEmoji === e ? C.p400 : 'transparent' }}>
                      <Emoji size={18}>{e}</Emoji>
                    </View>
                  </Pressable>
                ))}
              </View>

              <Txt weight="semibold" size={12} color={C.textDim} style={{ marginBottom: 8 }}>{t('addTransaction.color')}</Txt>
              <View className="flex-row flex-wrap" style={{ gap: 10, marginBottom: 22 }}>
                {CATEGORY_COLORS.map(col => (
                  <Pressable key={col} onPress={() => setNewCatColor(col)}>
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: col, borderWidth: 3, borderColor: newCatColor === col ? '#fff' : 'transparent' }} />
                  </Pressable>
                ))}
              </View>

              <BubbleButton label={t('addTx.createCat')} onPress={handleCreateCategory} disabled={!newCatName.trim()} />
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── Date ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <FieldLabel icon={<Calendar size={15} color={C.textFaint} />} label="Date" />
          <Pressable onPress={() => setShowDatePicker(true)}>
            <GlassCard padding={14} radius={R.md}>
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <IconBubble color={C.p500} size={40}><Calendar size={19} color={C.p400} /></IconBubble>
                <Txt weight="semibold" size={16} color={C.text}>{format(date, 'MMMM d, yyyy', { locale: getDateFnsLocale() })}</Txt>
              </View>
            </GlassCard>
          </Pressable>
          {showDatePicker && (
            <DateTimePicker value={date} mode="date" display="spinner" onChange={handleDateChange} maximumDate={new Date()} />
          )}
        </View>

        {/* ── Impulse ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <GlassCard padding={14} radius={R.md} tint={isImpulse ? `${C.rose}16` : C.glass} border={isImpulse ? `${C.rose}3a` : C.glassBorder}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1" style={{ gap: 12 }}>
                <IconBubble color={C.rose} size={40}><Zap size={19} color={C.rose} /></IconBubble>
                <View className="flex-1">
                  <Txt weight="semibold" size={14} color={C.text}>{t('addTransaction.impulse')}</Txt>
                  <Txt size={11} color={C.textFaint} style={{ marginTop: 1 }}>{t('addTransaction.impulseHint')}</Txt>
                </View>
              </View>
              <Switch
                value={isImpulse}
                onValueChange={(val) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsImpulse(val); }}
                trackColor={{ false: C.bgRaise, true: C.rose }}
                thumbColor={isImpulse ? '#fff' : '#6b5f86'}
              />
            </View>
          </GlassCard>
        </View>

        {/* ── Note ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <FieldLabel icon={<FileText size={15} color={C.textFaint} />} label={t('addTx.noteOptional')} />
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t('addTx.spentOnWhat')}
            placeholderTextColor={C.textFaint}
            multiline
            numberOfLines={3}
            style={{ color: C.text, borderRadius: R.md, padding: 16, fontSize: 15, fontFamily: 'PlusJakartaSans_500Medium', minHeight: 88, textAlignVertical: 'top', backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder }}
            selectionColor={C.p500}
          />
        </View>

        {/* ── Time cost ── */}
        {!!settings?.showTimeCost && settings?.hourlyValue > 0 && amount && parseFloat(amount) > 0 && (
          <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
            <GlassCard padding={14} radius={R.md} tint={`${C.p500}14`} border={`${C.p500}2e`}>
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <IconBubble color={C.p500} size={40}><Clock size={19} color={C.p400} /></IconBubble>
                <View>
                  <Txt size={11} color={C.textFaint}>{t('addTransaction.timeCost')}</Txt>
                  <Txt weight="bold" size={17} color={C.p400}>{Math.round((parseFloat(amount) / settings.hourlyValue) * 60)} minutes of work</Txt>
                </View>
              </View>
            </GlassCard>
          </View>
        )}

        {/* ── Submit ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
          <BubbleButton
            label={mutation.isPending ? 'Logging…' : 'Log it!'}
            onPress={() => mutation.mutate()}
            disabled={!canSubmit}
          />
        </View>
      </ScrollView>
    </ScreenBackground>
  );
}
