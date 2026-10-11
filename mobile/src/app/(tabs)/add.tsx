import { View, ScrollView, Pressable, Text as RNText } from 'react-native';
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { addTransaction, getSettings, getAccounts, addCustomCategory } from '@/lib/db';
import { Calendar, Wallet, Zap, FileText } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { BAR, F, R, S, useC } from '@/lib/design';
import { currencyParts } from '@/lib/motion';
import {
  Card, ChoiceRow, Field, FilterChip, Group, Header, Keypad, LinkRow,
  PrimaryButton, Screen, Segmented, Sheet, SwitchRow, Type,
} from '@/components/kit';
import {
  getCategories, DEFAULT_CATEGORIES, CATEGORY_EMOJIS, CATEGORY_COLORS, categoryLabel,
} from '@/lib/categories';
import { formatCurrency, formatTimeCost, calculateTimeCost } from '@/lib/calculations';
import { t, getDateFnsLocale } from '@/lib/i18n/core';
import { accountTypeLabel } from '@/lib/tx-display';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Two decimal places, one separator, and a ceiling that fits the display. */
const MAX_DIGITS = 9;

/**
 * The amount, drawn from what was actually typed.
 *
 * `Amount` renders a *number*, which is right everywhere the figure is being
 * read and wrong here: it would show "12.00" the instant someone typed "12",
 * and turn "12.5" into "12.50" while their finger was still moving. An entry
 * display has to echo the keystrokes, so this one renders the raw string and
 * only borrows the number rules — dimmed decimals, raised symbol, tabular
 * figures, and the separator the user's own locale uses.
 */
function AmountDisplay({ raw, color, dim }: { raw: string; color: string; dim: string }) {
  const parts = useMemo(() => currencyParts(formatCurrency), []);
  const [whole = '', fraction] = raw.split('.');
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, parts.group);

  const size = 52;
  const big = {
    ...F.bold,
    fontSize: size,
    lineHeight: size * 1.1,
    letterSpacing: size * -0.02,
    fontVariant: ['tabular-nums' as const],
  };
  const symbol = {
    ...big,
    fontSize: size * 0.65,
    lineHeight: size * 0.72,
    marginTop: size * 0.12,
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' }}>
      {parts.prefix.trim() ? (
        <RNText style={[symbol, { color: whole ? color : dim }]}>{parts.prefix.trim()}</RNText>
      ) : null}
      <RNText style={[big, { color: whole ? color : dim }]}>{grouped}</RNText>
      {fraction !== undefined ? (
        <RNText style={[big, { color, opacity: 0.55 }]}>
          {parts.decimal}
          {fraction}
        </RNText>
      ) : null}
      {parts.suffix.trim() ? (
        <RNText style={[symbol, { color: whole ? color : dim, marginStart: size * 0.08 }]}>
          {parts.suffix.trim()}
        </RNText>
      ) : null}
    </View>
  );
}

/**
 * Add — DESIGN-PROMPT.md §15, artboard #15.
 *
 * The old screen was a seven-field form under a purple gradient hero: a text
 * input for the amount, two outlined type buttons, an inline account dropdown,
 * a wrapped grid of outlined category chips, a date card, a note box, an
 * impulse card and a submit button — all stacked, all visible at once.
 *
 * This is an amount, and the interface should mirror what it changes: a
 * display and a keypad. Everything else is a decision with a sensible default,
 * so the defaults are shown as one line of summary rows and each opens a
 * sheet. Nothing was removed; four things moved one tap away.
 *
 * The time cost gets its own quiet line under the number, which §15 asks for
 * by name — it is the one place the app says something about a purchase that
 * the amount alone does not.
 */
export default function AddTransactionScreen() {
  const insets = useSafeAreaInsets();
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Food');
  const [type, setType] = useState<'Expense' | 'Income'>('Expense');
  const [isImpulse, setIsImpulse] = useState(false);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date());
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'account' | 'date' | 'note' | 'category' | null>(null);

  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState(CATEGORY_EMOJIS[0]);
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[0]);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getAccounts });
  const { data: categories = DEFAULT_CATEGORIES } = useQuery({ queryKey: ['categories'], queryFn: getCategories });

  const decimalSeparator = useMemo(() => currencyParts(formatCurrency).decimal, []);
  const value = parseFloat(amount) || 0;

  const defaultAccount = accounts.find((a) => a.isDefault === 1);
  const currentAccountId = selectedAccountId ?? defaultAccount?.id;
  const selectedAccount = accounts.find((a) => a.id === currentAccountId);

  function pressDigit(digit: string) {
    setAmount((current) => {
      const [whole = '', fraction] = current.split('.');
      if (fraction !== undefined && fraction.length >= 2) return current;
      if (fraction === undefined && whole.replace(/\D/g, '').length >= MAX_DIGITS) return current;
      if (current === '0') return digit;
      return current + digit;
    });
  }

  function pressDecimal() {
    setAmount((current) => (current.includes('.') ? current : `${current || '0'}.`));
  }

  function pressBackspace() {
    setAmount((current) => current.slice(0, -1));
  }

  async function createCategory() {
    const name = newCatName.trim();
    if (!name) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await addCustomCategory({ name, icon: newCatEmoji, color: newCatColor });
    await queryClient.invalidateQueries({ queryKey: ['categories'] });
    setCategory(name);
    setNewCatName('');
    setSheet(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (value <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        throw new Error('Invalid amount');
      }
      await addTransaction({
        amount: value,
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
        amount: value,
        category,
        type,
        isImpulse,
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

  const showTimeCost = !!settings?.showTimeCost && settings.hourlyValue > 0 && value > 0;
  const locale = getDateFnsLocale();

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: BAR.clearance(insets.bottom) }}
        keyboardShouldPersistTaps="handled"
      >
        <Header pal={C} title={t('addTransaction.title')} />

        <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
          <Segmented
            pal={C}
            value={type}
            onChange={setType}
            options={[
              { key: 'Expense' as const, label: t('txTypes.Expense') },
              { key: 'Income' as const, label: t('txTypes.Income') },
            ]}
          />
        </View>

        {/* The hero: one display-sized number, sitting on the ground with no
            card around it (§1.2), and one quiet line beneath. */}
        <View style={{ alignItems: 'center', marginTop: 34, minHeight: 92 }}>
          <AmountDisplay raw={amount} color={C.ink} dim={C.inkFaint} />
          <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
            {showTimeCost
              ? t('addTx.timeCostLine', {
                  time: formatTimeCost(calculateTimeCost(value, settings.hourlyValue)),
                })
              : t('addTransaction.howMuch')}
          </Type>
        </View>

        {/* Category is the field people change most, so it is the one that
            stays on the surface. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginTop: 24 }}
          contentContainerStyle={{ paddingHorizontal: S.screen, gap: 8 }}
        >
          {categories.map((cat) => (
            <FilterChip
              key={cat.name}
              pal={C}
              label={categoryLabel(cat.name, categories)}
              active={category === cat.name}
              onPress={() => setCategory(cat.name)}
            />
          ))}
          <FilterChip
            pal={C}
            label={t('addTx.newAccount')}
            active={false}
            onPress={() => setSheet('category')}
          />
        </ScrollView>

        <Keypad
          pal={C}
          decimalSeparator={decimalSeparator}
          onDigit={pressDigit}
          onDecimal={pressDecimal}
          onBackspace={pressBackspace}
          style={{ marginTop: 16, paddingHorizontal: S.screen }}
        />

        <Group pal={C} style={{ marginTop: 12 }}>
          {accounts.length > 0 ? (
            <LinkRow
              pal={C}
              icon={<Wallet size={20} color={C.inkDim} strokeWidth={S.stroke} />}
              title={t('addTx.account')}
              body={selectedAccount
                ? `${selectedAccount.name} · ${accountTypeLabel(selectedAccount.type)}`
                : t('addTransaction.selectAccount')}
              onPress={() => setSheet('account')}
            />
          ) : null}
          <LinkRow
            pal={C}
            icon={<Calendar size={20} color={C.inkDim} strokeWidth={S.stroke} />}
            title={t('addTx.dateLabel')}
            body={format(date, 'd MMMM yyyy', { locale })}
            onPress={() => setSheet('date')}
          />
          <LinkRow
            pal={C}
            icon={<FileText size={20} color={C.inkDim} strokeWidth={S.stroke} />}
            title={t('addTx.noteOptional')}
            body={note.trim() || t('addTx.spentOnWhat')}
            onPress={() => setSheet('note')}
          />
          <SwitchRow
            pal={C}
            icon={<Zap size={20} color={C.inkDim} strokeWidth={S.stroke} />}
            title={t('addTransaction.impulse')}
            body={t('addTransaction.impulseHint')}
            value={isImpulse}
            onValueChange={setIsImpulse}
          />
        </Group>

        <PrimaryButton
          pal={C}
          label={mutation.isPending ? t('addTx.logging') : t('addTx.logIt')}
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending || value <= 0}
          style={{ marginHorizontal: S.screen, marginTop: 24 }}
        />
      </ScrollView>

      <Sheet
        pal={C}
        visible={sheet === 'account'}
        onClose={() => setSheet(null)}
        title={t('addTx.account')}
      >
        <View style={{ paddingHorizontal: S.card, gap: 8 }}>
          {accounts.map((account) => (
            <ChoiceRow
              key={account.id}
              pal={C}
              title={account.name}
              body={`${accountTypeLabel(account.type)} · ${formatCurrency(account.balance)}`}
              selected={account.id === currentAccountId}
              onPress={() => {
                setSelectedAccountId(account.id);
                setSheet(null);
              }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet
        pal={C}
        visible={sheet === 'date'}
        onClose={() => setSheet(null)}
        title={t('addTx.dateLabel')}
      >
        <View style={{ paddingHorizontal: S.card, alignItems: 'center' }}>
          <DateTimePicker
            value={date}
            mode="date"
            display="inline"
            themeVariant={C.scheme}
            maximumDate={new Date()}
            onChange={(_, next) => next && setDate(next)}
            style={{ alignSelf: 'stretch' }}
          />
          <PrimaryButton
            pal={C}
            label={t('common.done')}
            onPress={() => setSheet(null)}
            style={{ alignSelf: 'stretch', marginTop: 12 }}
          />
        </View>
      </Sheet>

      <Sheet
        pal={C}
        visible={sheet === 'note'}
        onClose={() => setSheet(null)}
        title={t('addTx.noteOptional')}
      >
        <View style={{ paddingHorizontal: S.card }}>
          <Field
            pal={C}
            label={t('addTx.spentOnWhat')}
            value={note}
            onChangeText={setNote}
            placeholder={t('addTx.notePlaceholder')}
            autoFocus
          />
          <PrimaryButton
            pal={C}
            label={t('common.done')}
            onPress={() => setSheet(null)}
            style={{ marginTop: 16 }}
          />
        </View>
      </Sheet>

      <Sheet
        pal={C}
        visible={sheet === 'category'}
        onClose={() => setSheet(null)}
        title={t('addTransaction.newCategory')}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: S.card }}
        >
          <Field
            pal={C}
            label={t('addTx.category')}
            value={newCatName}
            onChangeText={setNewCatName}
            placeholder={t('addTx.notePlaceholder')}
            maxLength={20}
          />

          <Type role="meta" color={C.inkDim} style={{ marginTop: 16, marginBottom: 12 }}>
            {t('addTransaction.icon')}
          </Type>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CATEGORY_EMOJIS.map((emoji) => (
              <Card
                key={emoji}
                pal={C}
                padding={0}
                radius={R.sm}
                style={{ opacity: newCatEmoji === emoji ? 1 : 0.55 }}
                contentStyle={{
                  width: 44,
                  height: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: newCatEmoji === emoji ? C.accentSoft : C.groundSunk,
                }}
              >
                <RNText
                  onPress={() => setNewCatEmoji(emoji)}
                  style={{ fontSize: 20, lineHeight: 26 }}
                >
                  {emoji}
                </RNText>
              </Card>
            ))}
          </View>

          <Type role="meta" color={C.inkDim} style={{ marginTop: 16, marginBottom: 12 }}>
            {t('addTransaction.color')}
          </Type>
          {/* The eight tones of the warm `cat` ramp, never a rainbow. Each
              swatch draws the active scheme's tone and saves the light-ramp
              value at the same index (CATEGORY_COLORS), so what is stored does
              not depend on the scheme it was picked in. The selection is an
              ink ring around the swatch, which reads on every tone. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {C.cat.map((tone, i) => {
              const stored = CATEGORY_COLORS[i] ?? tone;
              const selected = newCatColor === stored;
              return (
                <Pressable
                  key={stored}
                  onPress={() => setNewCatColor(stored)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={{
                    width: 44,
                    height: 44,
                    padding: 4,
                    borderRadius: R.pill,
                    borderCurve: 'continuous',
                    borderWidth: 2,
                    borderColor: selected ? C.ink : 'transparent',
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      borderRadius: R.pill,
                      borderCurve: 'continuous',
                      backgroundColor: tone,
                    }}
                  />
                </Pressable>
              );
            })}
          </View>

          <PrimaryButton
            pal={C}
            label={t('addTx.createCat')}
            onPress={createCategory}
            disabled={!newCatName.trim()}
            style={{ marginTop: 24 }}
          />
        </ScrollView>
      </Sheet>
    </Screen>
  );
}
