import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, ChevronRight, CreditCard, MoreHorizontal, PiggyBank, Plus, Tick, TrendingUp, Wallet,
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
import { accountTypeLabel, isDebtAccount, signedAccountBalance } from '@/lib/tx-display';
import { categoryMarkIndex } from '@/lib/category-meta';
import { R, S, useC } from '@/lib/design';
import { P_DARK, P_LIGHT } from '@/lib/palettes';
import { PressableScale } from '@/components/motion';
import {
  Amount,
  BadgePill,
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
  mirror,
} from '@/components/kit';
import { useEntitlement } from '@/lib/useEntitlement';
import { syncAllTransactions } from '@/lib/bank-linking';
import { syncNow } from '@/lib/cloud-sync';
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
 * What is here now: the off-white page, one espresso anchor — the total, which
 * is the number people opened this screen for — and a card of rows whose
 * marks come from the palette's warm ramp (espresso through umber and bronze
 * to platinum), never a rainbow, and every step clearing 3:1 on its own
 * ground in both schemes.
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
 * The stored form of an account's mark: a position on the palette's ramp.
 *
 * The column holds a hex, so a position is written as the *light* ramp's
 * colour at that position — the same convention the column has always used,
 * so it means one thing whichever scheme saved it. It is only ever a key:
 * what is drawn is the live palette's `cat` at the same position, so the mark
 * follows the active scheme. Never render from this table.
 */
const STORED_MARKS = P_LIGHT.cat;

/**
 * LEGACY — the retired category ramps (violet, blue, teal, green, amber,
 * orange, red, pink), light then dark, from before the design identity.
 *
 * Accounts saved under them hold these exact hexes. They are kept only so an
 * old value can be read back as the position it meant — a saved `#1E6FD9` is
 * "the second mark", whatever the second mark looks like now. Nothing is ever
 * rendered in these colours and nothing new is written with them. If the
 * ramp changes again, the outgoing one belongs here too.
 */
const LEGACY_MARKS: readonly (readonly string[])[] = [
  ['#5B3FD9', '#1E6FD9', '#0D8577', '#2E8B4E', '#A87400', '#C25A18', '#CC3B33', '#C0357A'],
  ['#A99BE8', '#7FB6E0', '#5FC4B4', '#7FC98D', '#D9B45C', '#E0996A', '#E58880', '#DB8FAF'],
];

/** Every ramp a saved value may come from: today's two, then the retired two. */
const KNOWN_MARKS: readonly (readonly string[])[] = [P_LIGHT.cat, P_DARK.cat, ...LEGACY_MARKS];

/**
 * Resolve a stored mark to its position on the ramp.
 *
 * A value from today's ramp (either scheme) or a retired one maps to the
 * position it was saved at, so a change of ramp never silently re-maps a
 * saved account. Anything else — the old form auto-assigned `#22c55e`,
 * `#3b82f6`, `#9333ea`, `#ef4444` or `#f59e0b` by account *type*, or one of
 * ten saturated picker swatches, and nobody picked those — is derived from
 * the account's own name instead. Deterministic, so a given account keeps one
 * mark for good.
 */
function markIndex(stored: string, name: string): number {
  const key = stored.trim().toUpperCase();
  for (const ramp of KNOWN_MARKS) {
    const i = ramp.findIndex((hex) => hex.toUpperCase() === key);
    if (i >= 0) return i;
  }
  return categoryMarkIndex(name, STORED_MARKS.length);
}

/** The value written to the database for the mark at `index`. */
function storedMark(index: number): string {
  return STORED_MARKS[index % STORED_MARKS.length]!;
}

/** The mark at `index`, drawn from the live palette's ramp. */
function markColor(cat: readonly string[], index: number): string {
  return cat[index % cat.length]!;
}

export default function AccountsScreen() {
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isPro } = useEntitlement();

  const [editing, setEditing] = useState<Account | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<string>('cash');
  const [balance, setBalance] = useState('');
  /** A position on the ramp; written to the database as storedMark(mark). */
  const [mark, setMark] = useState<number>(0);

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: getAccounts });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const currencyCode = settings?.currency || 'USD';
  const money = (n: number) => formatCurrencyAmount(n, currencyCode);

  // A card's or a loan's balance is what you owe, so it subtracts from the
  // total rather than adding to it.
  const total = accounts.reduce((sum, a) => sum + signedAccountBalance(a), 0);

  const closeSheet = () => {
    setSheetOpen(false);
    setEditing(null);
  };

  const openAdd = () => {
    setEditing(null);
    setName('');
    setType('cash');
    setBalance('');
    setMark(0);
    setSheetOpen(true);
  };

  const openEdit = (account: Account) => {
    setEditing(account);
    setName(account.name);
    setType(account.type);
    setBalance(account.balance.toString());
    setMark(markIndex(account.color, account.name));
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
          color: storedMark(mark),
        });
      } else {
        await createAccount({
          name,
          type,
          balance: amount,
          currency: currencyCode,
          color: storedMark(mark),
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

  // Pull to refresh: the banks first (a Pro feature; the server books what is
  // new), then this phone's own pull, which brings those rows and any other
  // device's edits into the balances above. A bank that cannot be read here
  // is the bank screen's to explain; this one just refreshes.
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (isPro) await syncAllTransactions();
      await syncNow();
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    } finally {
      setRefreshing(false);
    }
  };

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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
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

        {/* The one espresso anchor: the figure this screen exists to show. */}
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
            // The anchor above is already this screen's espresso block.
            actionVariant="secondary"
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
                const tone = markColor(C.cat, markIndex(account.color, account.name));
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
                      {/* The glyph is drawn in the card's own surface colour: the
                          ramp is dark in light mode and pale in dark, so the
                          surface is what contrasts with it in both. */}
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: R.sm,
                          borderCurve: 'continuous',
                          backgroundColor: tone,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Icon size={22} color={C.groundAlt} strokeWidth={S.stroke} />
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
                        value={signedAccountBalance(account)}
                        format={money}
                        size={17}
                        weight="semibold"
                        color={isDebtAccount(account.type) ? C.negative : C.ink}
                      />
                    </Touchable>
                  </View>
                );
              })}
            </Card>
          </View>
        )}

        {/* Linking a bank, beside the accounts it would fill. Nothing in the
            app led here after Home lost its card. Free users can open it —
            the screen offers the upgrade — so it is marked Pro, not hidden. */}
        <View style={{ paddingHorizontal: S.screen, marginTop: S.group }}>
          <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
            <Touchable
              pal={C}
              onPress={() => router.push('/link-bank')}
              accessibilityLabel={isPro
                ? t('dashboard.linkBank')
                : `${t('dashboard.linkBank')}, ${t('subscription.proBadge')}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: R.sm,
                  borderCurve: 'continuous',
                  backgroundColor: C.groundSunk,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Building2 size={22} color={C.ink} strokeWidth={S.stroke} />
              </View>
              <View style={{ flex: 1 }}>
                <Type role="cardTitle" color={C.ink} numberOfLines={1}>
                  {t('dashboard.linkBank')}
                </Type>
                <Type role="meta" color={C.inkDim} numberOfLines={1}>
                  {t('dashboard.linkBankHint')}
                </Type>
              </View>
              {isPro ? null : <BadgePill pal={C} label={t('subscription.proBadge')} />}
              <ChevronRight size={18} color={C.inkFaint} strokeWidth={S.stroke} style={mirror} />
            </Touchable>
          </Card>
        </View>
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
            label={isDebtAccount(type) ? t('accounts.balanceOwed') : t('accounts.balanceCurrent')}
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {C.cat.map((swatch, i) => {
              const selected = mark === i;
              return (
                <PressableScale
                  key={swatch}
                  onPress={() => setMark(i)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${t('accounts.color')} ${i + 1}`}
                  hitSlop={6}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: R.sm,
                    borderCurve: 'continuous',
                    backgroundColor: swatch,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {/* The check, not a ring: a ring around a filled swatch
                      reads as a second colour, and selection that is only a
                      border is selection you have to look for. */}
                  {selected ? <Tick size={17} color={C.groundAlt} strokeWidth={S.stroke} /> : null}
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
