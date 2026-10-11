import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { PiggyBank, Plus } from '@/components/icons';
import * as Haptics from 'expo-haptics';

import { addNetWorthEntry, deleteNetWorthEntry, getNetWorthEntries, getSettings, type NetWorthEntry } from '@/lib/db';
import { todayISO } from '@/lib/dates';
import {
  ASSET_KEYS,
  EMPTY_SNAPSHOT_FORM,
  LIABILITY_KEYS,
  breakdownLines,
  snapshotFromForm,
  snapshotTotals,
  sortSnapshotsNewestFirst,
  type BreakdownKey,
  type SnapshotForm,
  type SnapshotInput,
} from '@/lib/offline/net-worth';
import { formatCurrency } from '@/lib/calculations';
import { F, R, S, useC, type Palette } from '@/lib/design';
import {
  Amount,
  BalanceCard,
  Card,
  CircleAction,
  Empty,
  FormError,
  InfoRow,
  PrimaryButton,
  Screen,
  SectionHeader,
  Stat,
  SubHeader,
  SwipeRow,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

// ─── Types ───────────────────────────────────────────────────────────────────

/** The label key for each form field. `otherLiabilities` is the one that does
 *  not match its string key, which is why this is a table and not a template. */
const FIELD_LABEL: Record<BreakdownKey, string> = {
  cashSavings: 'netWorthCats.cashSavings',
  investments: 'netWorthCats.investments',
  realEstate: 'netWorthCats.realEstate',
  otherAssets: 'netWorthCats.otherAssets',
  creditCardDebt: 'netWorthCats.creditCardDebt',
  loans: 'netWorthCats.loans',
  mortgage: 'netWorthCats.mortgage',
  otherLiabilities: 'netWorthCats.otherLiab',
};

/** A stored `YYYY-MM-DD`, read as a local date rather than a UTC instant. */
function readDate(dateStr: string): Date {
  return parseISO(`${dateStr}T00:00:00`);
}

function longDate(dateStr: string): string {
  return format(readDate(dateStr), 'd MMM yyyy', { locale: getDateFnsLocale() });
}

// ─── History chart ───────────────────────────────────────────────────────────

/**
 * Twelve bars, no gridlines, no axis beyond the first and last date (§6.14).
 *
 * Net worth is the one series in the app that can go below zero, so this
 * cannot be `BarChart` from the kit: it needs a baseline and a second tone.
 * A negative bar is `negative`. The rest come from the palette's warm ramp:
 * the history in its quiet platinum end, the most recent bar in `accentMark`
 * (the ramp's espresso end) so the eye lands on where you are now.
 */
function HistoryChart({ pal, entries }: { pal: Palette; entries: NetWorthEntry[] }) {
  // Oldest to newest, the last twelve.
  const data = useMemo(() => sortSnapshotsNewestFirst(entries).slice(0, 12).reverse(), [entries]);

  const height = 120;
  /** The ramp's platinum end: present, but quieter than the latest bar. */
  const past = pal.cat[pal.cat.length - 1] ?? pal.accentMark;
  if (data.length < 2) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Type role="meta" color={pal.inkDim}>
          {data.length === 0 ? t('netWorth.noHistory') : t('netWorth.needMore')}
        </Type>
      </View>
    );
  }

  const values = data.map((e) => e.netWorth);
  const minVal = Math.min(...values, 0);
  const maxVal = Math.max(...values, 0);
  const span = maxVal - minVal || 1;
  // Where zero sits, measured from the bottom of the plot.
  const zeroY = ((0 - minVal) / span) * height;

  return (
    <View>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
        {data.map((entry, i) => {
          const last = i === data.length - 1;
          const negative = entry.netWorth < 0;
          const barHeight = Math.max(3, (Math.abs(entry.netWorth) / span) * height);
          return (
            <View key={entry.id ?? i} style={{ flex: 1, height, justifyContent: 'flex-end' }}>
              <View
                style={{
                  height: barHeight,
                  borderRadius: 4,
                  borderCurve: 'continuous',
                  // A negative bar hangs from the zero line rather than
                  // standing on the floor, which is the only way the sign
                  // reads without a legend.
                  marginBottom: negative ? Math.max(0, zeroY - barHeight) : zeroY,
                  backgroundColor: negative
                    ? pal.negative
                    : last
                      ? pal.accentMark
                      : past,
                }}
              />
            </View>
          );
        })}
      </View>

      {minVal < 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: pal.hairline,
            bottom: zeroY,
          }}
        />
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
        <Type role="meta" color={pal.inkDim}>
          {format(readDate(data[0]!.date), 'MMM yy', { locale: getDateFnsLocale() })}
        </Type>
        <Type role="meta" color={pal.inkDim}>
          {format(readDate(data[data.length - 1]!.date), 'MMM yy', { locale: getDateFnsLocale() })}
        </Type>
      </View>
    </View>
  );
}

// ─── Amount entry row ────────────────────────────────────────────────────────

/**
 * Label left, a sunk well with a right-aligned figure on the right.
 *
 * Eight stacked `Field`s would run past the bottom of the phone; the form is
 * a column of figures, and a column of figures reads as rows. The symbol
 * comes from the user's settings — the old form printed a literal `$` beside
 * every input regardless of the currency they had chosen.
 */
function AmountRow({
  pal,
  label,
  value,
  onChange,
  symbol,
}: {
  pal: Palette;
  label: string;
  value: string;
  onChange: (next: string) => void;
  symbol: string;
}) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 }}
    >
      <Type role="body" color={pal.ink} style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Type>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minWidth: 128,
          paddingHorizontal: 14,
          borderRadius: R.control,
          borderCurve: 'continuous',
          backgroundColor: pal.groundSunk,
        }}
      >
        <Type role="meta" color={pal.inkDim}>
          {symbol}
        </Type>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="0"
          placeholderTextColor={pal.inkFaint}
          keyboardType="decimal-pad"
          returnKeyType="done"
          selectionColor={pal.accent}
          accessibilityLabel={label}
          style={{
            flex: 1,
            paddingVertical: 12,
            textAlign: 'right',
            ...F.semibold,
            fontSize: 16,
            color: pal.ink,
          }}
        />
      </View>
    </View>
  );
}

// ─── Add snapshot ────────────────────────────────────────────────────────────

/**
 * Eight figures and a total. A full-screen form rather than a bottom sheet:
 * §6.21 keeps the sheet for short things, and this one is a screen's worth of
 * input that a keyboard has to sit under.
 */
function AddSnapshot({
  pal,
  visible,
  onClose,
  onSubmit,
  isSubmitting,
  symbol,
}: {
  pal: Palette;
  visible: boolean;
  onClose: () => void;
  onSubmit: (snapshot: SnapshotInput) => void;
  isSubmitting: boolean;
  symbol: string;
}) {
  const [form, setForm] = useState<SnapshotForm>(EMPTY_SNAPSHOT_FORM);
  const [error, setError] = useState('');
  const set = (key: BreakdownKey) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const { assets: totalAssets, liabilities: totalLiabilities, netWorth } = snapshotTotals(form);
  const nothingEntered = totalAssets === 0 && totalLiabilities === 0;

  function handleSubmit() {
    // Dated today on the device's own calendar, not UTC's.
    const parsed = snapshotFromForm(form);
    if (!parsed.ok) {
      setError(parsed.error ? t(parsed.error) : '');
      return;
    }
    setError('');
    onSubmit(parsed.snapshot);
    setForm(EMPTY_SNAPSHOT_FORM);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: pal.ground }}>
        {/* One dismiss control, not two: the back circle and a trailing ×
            both called `onClose`, which is the same door drawn twice. */}
        <SubHeader
          pal={pal}
          title={t('netWorth.newSnapshot')}
          onBack={onClose}
          style={{ marginTop: 12 }}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ paddingBottom: 48, paddingTop: 8 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Type role="meta" color={pal.inkDim} style={{ paddingHorizontal: S.screen, marginTop: 12 }}>
              {longDate(todayISO())}
            </Type>

            {(
              [
                { title: t('netWorth.assets'), keys: ASSET_KEYS, total: totalAssets, totalLabel: t('netWorth.totalAssets') },
                { title: t('netWorth.liabilities'), keys: LIABILITY_KEYS, total: totalLiabilities, totalLabel: t('netWorth.totalLiabilities') },
              ] as const
            ).map((section) => (
              <View key={section.title} style={{ marginTop: S.section }}>
                <SectionHeader pal={pal} title={section.title} />
                <View style={{ paddingHorizontal: S.screen }}>
                  <Card pal={pal} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                    {section.keys.map((key) => (
                      <AmountRow
                        key={key}
                        pal={pal}
                        label={t(FIELD_LABEL[key])}
                        value={form[key]}
                        onChange={set(key)}
                        symbol={symbol}
                      />
                    ))}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 14,
                        borderTopWidth: 1,
                        borderTopColor: pal.hairline,
                        gap: 12,
                      }}
                    >
                      <Type role="cardTitle" color={pal.ink}>
                        {section.totalLabel}
                      </Type>
                      <Amount
                        value={section.total}
                        format={formatCurrency}
                        size={17}
                        weight="semibold"
                        color={pal.ink}
                      />
                    </View>
                  </Card>
                </View>
              </View>
            ))}

            {/* The preview was a green-or-red gradient block. It is a sum, and
                a sum reads better as one sentence with the figure in it. */}
            <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
              <Type role="meta" color={pal.inkDim}>
                {t('netWorth.preview')}
              </Type>
              <Amount
                value={netWorth}
                format={formatCurrency}
                size={32}
                color={netWorth < 0 ? pal.negative : pal.ink}
                style={{ marginTop: 6 }}
              />
              <Type role="meta" color={pal.inkDim} style={{ marginTop: 8 }}>
                {t('netWorth.assetsMinus', {
                  assets: formatCurrency(totalAssets),
                  liabilities: formatCurrency(totalLiabilities),
                })}
              </Type>

              <FormError pal={pal} message={error} />

              <PrimaryButton
                pal={pal}
                label={t('netWorth.saveSnapshot')}
                onPress={handleSubmit}
                disabled={isSubmitting || nothingEntered}
                style={{ marginTop: 24 }}
              />
              {isSubmitting ? (
                <ActivityIndicator color={pal.accent} style={{ marginTop: 12 }} />
              ) : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

/**
 * Net worth — DESIGN-PROMPT.md §24.
 *
 * The old screen changed the colour of its entire header depending on the
 * sign of one number: deep green when positive, deep red when negative, in
 * hues from no palette. Under it were two tinted stat tiles, a chart in
 * `#22c55e`/`#ef4444`, a breakdown in the same two colours, a snapshot list
 * where every row carried a coloured spine, and a blue gradient FAB with a
 * blue glow — on a screen whose accent was violet.
 *
 * Every amount was also `$`, hardcoded, in five different local formatters,
 * two of which called `toLocaleString('en-US')`. A user in euros read their
 * net worth in dollars.
 *
 * Now: one espresso anchor with the figure, assets and liabilities as two
 * plain stats beneath it, and the sign carried by the number's own minus sign
 * and `negative` — not by the room's lighting. A change between snapshots is
 * a delta, so it is signed and coloured: green up, red down.
 *
 * Since Phase 4 the snapshots live in this phone's database and sync like the
 * ledger, so the screen works offline; a snapshot is dated on the device's
 * own calendar, and one taken by mistake can be swiped away.
 */
export default function NetWorthScreen() {
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  // Read from this phone's database, so the screen works offline; a pull
  // that changes it refreshes every query (cloud-sync's onRemoteChange).
  const { data, isLoading, isError } = useQuery({
    queryKey: ['net-worth'],
    queryFn: getNetWorthEntries,
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const symbol = settings?.currencySymbol || '$';

  const entries = useMemo(() => (data ? sortSnapshotsNewestFirst(data) : []), [data]);

  const latest = entries[0] ?? null;
  const previous = entries[1] ?? null;
  const delta = latest && previous ? latest.netWorth - previous.netWorth : null;

  const addMutation = useMutation({
    mutationFn: (snapshot: SnapshotInput) => addNetWorthEntry(snapshot),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['net-worth'] });
      setAdding(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  });

  // A snapshot taken by mistake used to stay for good: there was no way to
  // remove one. The same swipe, and the same question, as bills and
  // recurring items.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNetWorthEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['net-worth'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const confirmDelete = (entry: NetWorthEntry) => {
    Alert.alert(longDate(entry.date), t('dialogs.areYouSure'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('dialogs.delete'), style: 'destructive', onPress: () => deleteMutation.mutate(entry.id) },
    ]);
  };

  // The breakdown is stored as JSON text, as the server has always kept it;
  // db.ts hands it over parsed. The screen used to read the text as if it
  // were an object, so this section never appeared.
  const lines = breakdownLines(latest?.breakdown ?? null);

  // The change since the previous snapshot once there are two. With one,
  // "add your first snapshot" was wrong the moment it was taken.
  const caption =
    delta !== null
      ? t('netWorth.sinceLast', {
          delta: `${delta >= 0 ? '+' : '−'}${formatCurrency(Math.abs(delta))}`,
        })
      : latest
        ? t('netWorth.firstSnapshot')
        : t('netWorth.addFirstSnapshot');

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
      >
        <SubHeader
          pal={C}
          title={t('netWorth.title')}
          onBack={() => router.back()}
          action={
            <CircleAction pal={C} label={t('netWorth.newSnapshot')} onPress={() => setAdding(true)}>
              <Plus size={20} color={C.ink} strokeWidth={S.stroke} />
            </CircleAction>
          }
        />

        <BalanceCard
          pal={C}
          label={t('netWorth.title')}
          amount={latest?.netWorth ?? 0}
          format={formatCurrency}
          caption={caption}
          style={{ paddingHorizontal: S.screen, marginTop: 24 }}
        />

        <View
          style={{
            flexDirection: 'row',
            gap: 32,
            paddingHorizontal: S.screen,
            marginTop: 16,
          }}
        >
          <Stat
            pal={C}
            label={t('netWorth.assets')}
            value={latest?.assets ?? 0}
            format={formatCurrency}
            size={20}
          />
          <Stat
            pal={C}
            label={t('netWorth.liabilities')}
            value={latest?.liabilities ?? 0}
            format={formatCurrency}
            size={20}
          />
        </View>

        {entries.length >= 2 ? (
          <View style={{ marginTop: S.section }}>
            <SectionHeader pal={C} title={t('netWorth.historyTitle')} />
            <View style={{ paddingHorizontal: S.screen }}>
              <Card pal={C}>
                <Type role="meta" color={C.inkDim} style={{ marginBottom: 16 }}>
                  {t('netWorth.lastSnapshots', { count: Math.min(entries.length, 12) })}
                </Type>
                <HistoryChart pal={C} entries={entries} />
              </Card>
            </View>
          </View>
        ) : null}

        {lines.length > 0 ? (
          <View style={{ marginTop: S.section }}>
            <SectionHeader pal={C} title={t('netWorth.latestBreakdown')} />
            <View style={{ paddingHorizontal: S.screen }}>
              <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                {lines.map((line, i) => {
                  const isLiability = line.liability;
                  return (
                    <View
                      key={line.key}
                      style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                    >
                      <InfoRow
                        pal={C}
                        title={t(FIELD_LABEL[line.key])}
                        // Signed, so an asset and a debt are told apart by the
                        // number rather than by two shades of the same row.
                        amount={isLiability ? -line.value : line.value}
                        format={formatCurrency}
                        tone={isLiability ? C.negative : C.ink}
                      />
                    </View>
                  );
                })}
              </Card>
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: S.section }}>
          <SectionHeader pal={C} title={t('netWorth.snapshotHistory')} />

          {isLoading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : isError ? (
            <Type role="body" color={C.negative} style={{ paddingHorizontal: S.screen }}>
              {t('netWorth.loadFailed')}
            </Type>
          ) : entries.length === 0 ? (
            <Empty
              pal={C}
              // The anchor above is already this screen's espresso block.
              actionVariant="secondary"
              icon={<PiggyBank size={26} color={C.accent} strokeWidth={S.stroke} />}
              title={t('netWorth.noSnapshots')}
              body={t('common.netWorthEmptyBody')}
              actionLabel={t('netWorth.newSnapshot')}
              onAction={() => setAdding(true)}
              style={{ marginTop: 24 }}
            />
          ) : (
            <View style={{ paddingHorizontal: S.screen }}>
              <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: 0 }}>
                {entries.map((entry, i) => {
                  const step = entries[i + 1] ? entry.netWorth - entries[i + 1]!.netWorth : null;
                  const meta = [
                    `${t('netWorth.assets')} ${formatCurrency(entry.assets)}`,
                    `${t('netWorth.liabilities')} ${formatCurrency(entry.liabilities)}`,
                  ].join(' · ');
                  // The change since the snapshot before: its own line, so it
                  // can carry its colour — and its sign, so colour is never
                  // the only thing saying which way it went.
                  const stepTone =
                    step === null || step === 0 ? C.inkDim : step > 0 ? C.positive : C.negative;

                  return (
                    <View
                      key={entry.id}
                      style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                    >
                      <SwipeRow pal={C} onDelete={() => confirmDelete(entry)} actionLabel={t('dialogs.delete')}>
                        <View style={{ paddingHorizontal: S.card }}>
                          <InfoRow
                            pal={C}
                            title={longDate(entry.date)}
                            meta={meta}
                            amount={entry.netWorth}
                            format={formatCurrency}
                            tone={entry.netWorth < 0 ? C.negative : C.ink}
                            footer={
                              step !== null ? (
                                <Type role="meta" color={stepTone} numberOfLines={1}>
                                  {t('netWorth.sinceLast', {
                                    delta: `${step >= 0 ? '+' : '−'}${formatCurrency(Math.abs(step))}`,
                                  })}
                                </Type>
                              ) : null
                            }
                          />
                        </View>
                      </SwipeRow>
                    </View>
                  );
                })}
              </Card>
            </View>
          )}
        </View>
      </ScrollView>

      <AddSnapshot
        pal={C}
        visible={adding}
        onClose={() => setAdding(false)}
        onSubmit={(body) => addMutation.mutate(body)}
        isSubmitting={addMutation.isPending}
        symbol={symbol}
      />
    </Screen>
  );
}
