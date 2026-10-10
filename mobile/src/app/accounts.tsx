import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  CreditCard,
  MoreHorizontal,
  PiggyBank,
  Plus,
  TrendingUp,
  Wallet,
} from '@/components/icons';
import * as Haptics from 'expo-haptics';
import {
  createAccount,
  deleteAccount,
  getAccounts,
  getSettings,
  updateAccount,
  type Account,
} from '@/lib/db';
import { formatCurrencyAmount } from '@/lib/currencies';
import { accountTypeLabel } from '@/lib/tx-display';
import { categoryMarkIndex } from '@/lib/category-meta';
import { S, useC } from '@/lib/design';
import { C_LIGHT } from '@/lib/palettes';
import { PressableScale } from '@/components/motion';
import {
  Amount,
  BalanceCard,
  Card,
  CircleAction,
  Empty,
  Field,
  FilterChip,
  PrimaryButton,
  Screen,
  Sheet,
  SubHeader,
  Touchable,
  Type,
} from '@/components/kit';
import { t } from '@/lib/i18n/core';

/**
 * Accounts — DESIGN-PROMPT.md §13, the balance card's own detail screen.
 *
 * What was here: a saturated violet gradient header with 32px scalloped
 * corners, a translucent white card floating on it, and a list of accounts
 * each fronted by a hand-picked colour from a ten-swatch rainbow —
 * `#22c55e`, `#3b82f6`, `#ef4444`. None of those colours are in the system,
 * none were checked against a ground, and together they made one screen carry
 * more hue than the rest of the app put together. §1 is explicit about where
 * that comes from: if a decision traces back to "make it pop", reverse it.
 *
 * What is here now: the bone ground, one dark object — the total, which is
 * the number people opened this screen for — and a white card of rows whose
 * marks come from the category ramp (§2.5), which is muted on purpose and
 * verified at 3:1 against its own ground in both schemes.
 */

/** The type choices. Built per call: `t()` at module scope freezes the
 *  startup language. */
function accountTypes() {
  return [
    { id: 'cash', label: t('accountTypes.cash'), Icon: Wallet },
    { id: 'checking', label: t('accountTypes.checking'), Icon: Building2 },
    { id: 'savings', label: t('accountTypes.savings'), Icon: PiggyBank },
    { id: 'credit', label: t('accountTypes.creditCard'), Icon: CreditCard },
    { id: 'investment', label: t('accountTypes.investment'), Icon: TrendingUp },
    { id: 'other', label: t('accountTypes.other'), Icon: MoreHorizontal },
  ] as const;
}

/**
 * The stored form of an account's mark.
 *
 * A colour has to survive a scheme change, and the two ramps are different
 * hexes for the same eight marks — the light ramp is 3.8–5.1:1 on bone, the
 * dark one 7.3–9.6:1 on near-black, and neither is legible on the other's
 * ground. So the light ramp is the canonical value written to the database,
 * and `markColor` resolves it into whichever ramp is being rendered.
 */
const MARKS = C_LIGHT.cat;

/**
 * Resolve a stored mark into the active scheme's ramp.
 *
 * A colour saved before this screen existed belongs to neither ramp — the old
 * form auto-assigned one of `#22c55e`, `#3b82f6`, `#9333ea`, `#ef4444`,
 * `#f59e0b` by account *type*, or one of ten saturated picker swatches. Those
 * pass through as-is only if you decide they were a user's choice worth
 * preserving. They were not: nobody picked them, and one `#22c55e` disc on a
 * bone screen is louder than everything else on it put together.
 *
 * So an unrecognised colour is derived from the account's own name instead.
 * Deterministic, so a given account keeps one mark for good, and always from
 * the ramp §2.5 verified at 3:1 against both grounds.
 */
function markColor(stored: string, name: string, cat: readonly string[]): string {
  const i = MARKS.indexOf(stored);
  return cat[i >= 0 ? i : categoryMarkIndex(name, cat.length)]!;
}

export default function AccountsScreen() {
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Account | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<string>('cash');
  const [balance, setBalance] = useState('');
  const [color, setColor] = useState<string>(MARKS[0]!);

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getAccounts });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const currencyCode = settings?.currency || 'USD';
  const money = (n: number) => formatCurrencyAmount(n, currencyCode);

  // A credit account's balance is what you owe, so it subtracts from the
  // total rather than adding to it.
  const total = accounts.reduce(
    (sum, a) => sum + (a.type === 'credit' ? -a.balance : a.balance),
    0
  );

  const closeSheet = () => {
    setSheetOpen(false);
    setEditing(null);
  };

  const openAdd = () => {
    setEditing(null);
    setName('');
    setType('cash');
    setBalance('');
    setColor(MARKS[0]!);
    setSheetOpen(true);
  };

  const openEdit = (account: Account) => {
    setEditing(account);
    setName(account.name);
    setType(account.type);
    setBalance(account.balance.toString());
    setColor(account.color);
    setSheetOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(balance) || 0;
      if (editing) {
        await updateAccount(editing.id, {
          name,
          type: type as Account['type'],
          balance: amount,
          color,
        });
      } else {
        await createAccount({
          name,
          type,
          balance: amount,
          currency: currencyCode,
          color,
          icon: type,
        });
      }
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      closeSheet();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      closeSheet();
    },
  });

  // Deleting an account takes its history with it and there is no undo, which
  // is the one case §16.2 reserves a dialog for. It had none before.
  const confirmDelete = (account: Account) => {
    Alert.alert(t('accounts.delete'), t('dialogs.areYouSure'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('dialogs.delete'),
        style: 'destructive',
        onPress: () => deleteMutation.mutate(account.id),
      },
    ]);
  };

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
      >
        <SubHeader
          pal={C}
          title={t('accounts.title')}
          onBack={() => router.back()}
          action={
            <CircleAction pal={C} label={t('accounts.addAccount')} onPress={openAdd}>
              <Plus size={20} color={C.ink} strokeWidth={S.stroke} />
            </CircleAction>
          }
        />

        {/* The one dark object: the figure this screen exists to show. */}
        <BalanceCard
          pal={C}
          label={t('accounts.totalNetWorth')}
          amount={total}
          format={money}
          caption={t('home.balanceCaption', { count: accounts.length })}
          style={{ paddingHorizontal: S.screen, marginTop: 24 }}
        />

        {accounts.length === 0 ? (
          <Empty
            pal={C}
            icon={<Wallet size={26} color={C.accent} strokeWidth={S.stroke} />}
            title={t('common.nothingYet')}
            body={t('accounts.emptyBody')}
            actionLabel={t('accounts.addAccount')}
            onAction={openAdd}
            style={{ marginTop: 64 }}
          />
        ) : (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
            <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
              {accounts.map((account, i) => {
                const spec = accountTypes().find((s) => s.id === account.type);
                const Icon = spec?.Icon ?? Wallet;
                const mark = markColor(account.color, account.name, C.cat);
                return (
                  <View
                    key={account.id}
                    style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                  >
                    <Touchable
                      pal={C}
                      onPress={() => openEdit(account)}
                      accessibilityLabel={account.name}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        minHeight: 64,
                      }}
                    >
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: mark,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Icon size={19} color={C.groundAlt} strokeWidth={S.stroke} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Type role="cardTitle" color={C.ink} numberOfLines={1}>
                          {account.name}
                        </Type>
                        <Type role="meta" color={C.inkDim} numberOfLines={1}>
                          {account.isDefault === 1
                            ? `${accountTypeLabel(account.type)} · ${t('accounts.default')}`
                            : accountTypeLabel(account.type)}
                        </Type>
                      </View>
                      <Amount
                        value={account.type === 'credit' ? -account.balance : account.balance}
                        format={money}
                        size={17}
                        weight="semibold"
                        color={account.type === 'credit' ? C.negative : C.ink}
                      />
                    </Touchable>
                  </View>
                );
              })}
            </Card>
          </View>
        )}
      </ScrollView>

      <Sheet
        pal={C}
        visible={sheetOpen}
        onClose={closeSheet}
        title={editing ? t('accounts.editAccount') : t('accounts.addAccount')}
      >
        <View style={{ paddingHorizontal: S.card }}>
          <Field
            pal={C}
            label={t('accounts.accountName')}
            value={name}
            onChangeText={setName}
            placeholder={t('accounts.namePlaceholder')}
          />

          <Type role="meta" color={C.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
            {t('accounts.accountType')}
          </Type>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {accountTypes().map((spec) => (
              <FilterChip
                key={spec.id}
                pal={C}
                label={spec.label}
                active={type === spec.id}
                onPress={() => setType(spec.id)}
              />
            ))}
          </View>

          <Field
            pal={C}
            label={type === 'credit' ? t('accounts.balanceOwed') : t('accounts.balanceCurrent')}
            value={balance}
            onChangeText={setBalance}
            placeholder="0"
            keyboardType="decimal-pad"
            icon={
              <Type role="cardTitle" color={C.inkDim}>
                {settings?.currencySymbol || '$'}
              </Type>
            }
            style={{ marginTop: 16 }}
          />

          <Type role="meta" color={C.inkDim} style={{ marginTop: 16, marginBottom: 12 }}>
            {t('accounts.color')}
          </Type>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {MARKS.map((stored, i) => {
              const selected = color === stored;
              return (
                <PressableScale
                  key={stored}
                  onPress={() => setColor(stored)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${t('accounts.color')} ${i + 1}`}
                  hitSlop={6}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: C.cat[i],
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {/* The check, not a white ring: a ring around a saturated
                      circle reads as a second colour, and selection that is
                      only a border is selection you have to look for. */}
                  {selected ? <Check size={17} color={C.groundAlt} strokeWidth={2.4} /> : null}
                </PressableScale>
              );
            })}
          </View>

          <PrimaryButton
            pal={C}
            label={t('common.save')}
            onPress={() => saveMutation.mutate()}
            disabled={!name.trim()}
            style={{ marginTop: 24 }}
          />

          {editing ? (
            <PressableScale
              onPress={() => confirmDelete(editing)}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel={t('accounts.delete')}
              style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}
            >
              <Type role="cardTitle" color={C.negative}>
                {t('accounts.delete')}
              </Type>
            </PressableScale>
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}
