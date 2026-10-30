import { View, ScrollView, Alert } from 'react-native';
import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { getTransactions, deleteTransaction, getSettings } from '@/lib/db';
import type { Transaction } from '@/lib/transaction';
import { categoryLabel } from '@/lib/category-meta';
import { getCategories, DEFAULT_CATEGORIES } from '@/lib/categories';
import { formatCurrency, formatTimeCost, calculateTimeCost } from '@/lib/calculations';
import { Inbox, SlidersHorizontal } from '@/components/icons';
import { categoryIcon } from '@/components/category-icon';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { BAR, S, useC } from '@/lib/design';
import {
  Amount, Card, CircleAction, Empty, FilterChip, Header, PrimaryButton,
  Row, Screen, Sheet, SwipeRow, Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Activity — DESIGN-PROMPT.md §14.
 *
 * The old screen put three filter controls between you and your own
 * transactions: two date pickers in bordered boxes, a horizontal row of
 * emoji-and-outline category chips, and a full-width impulse toggle. That is
 * roughly 260pt of furniture above the first row of content, on the screen
 * people open to look at what they spent.
 *
 * §4's density budget allows a long list but not long furniture around it, so
 * the dates moved one tap away into a sheet and everything else collapsed into
 * one scrollable row of chips. What is left above the fold is the title, the
 * filters, and transactions.
 *
 * The per-row delete button is gone too. A destructive control parked beside
 * every amount is both noise and a hazard; it now lives behind a deliberate
 * sideways swipe (§6.7), which is the gesture people already try.
 */
export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const C = useC();
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterImpulseOnly, setFilterImpulseOnly] = useState(false);
  const [startDate, setStartDate] = useState(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState(endOfMonth(new Date()));
  const [showDates, setShowDates] = useState(false);
  const queryClient = useQueryClient();
  const hasMounted = useRef(false);

  // Refetch on focus without changing the query keys — see the note in the
  // dashboard. Keying on a counter dropped the cache and rendered the empty
  // state for a frame on every return to the tab.
  useFocusEffect(
    useCallback(() => {
      if (!hasMounted.current) {
        hasMounted.current = true;
        return;
      }
      for (const key of ['transactions', 'settings', 'categories']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    }, [queryClient])
  );

  const { data: transactions = [] } = useQuery({ queryKey: ['transactions'], queryFn: getTransactions });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const { data: allCategories = DEFAULT_CATEGORIES } = useQuery({ queryKey: ['categories'], queryFn: getCategories });

  const deleteMutation = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  // Still confirmed. The swipe is deliberate, but there is no undo behind it,
  // and §16.2 reserves a dialog for exactly that case: irreversible.
  const handleDelete = (id: string) => {
    Alert.alert(t('dialogs.deleteTx'), t('dialogs.areYouSure'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('dialogs.delete'), style: 'destructive', onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  const filtered = transactions.filter((tx) => {
    const txDate = parseISO(`${tx.dateISO}T00:00:00`);
    const inRange = txDate >= startDate && txDate <= endDate;
    const matchesCategory = !filterCategory || tx.category === filterCategory;
    const matchesImpulse = !filterImpulseOnly || tx.isImpulse;
    return inRange && matchesCategory && matchesImpulse;
  });

  const grouped = filtered.reduce((acc, tx) => {
    (acc[tx.dateISO] ??= []).push(tx);
    return acc;
  }, {} as Record<string, Transaction[]>);

  const days = Object.entries(grouped)
    .map(([date, txs]) => ({
      date,
      transactions: txs,
      total: txs.reduce((sum, tx) => sum + (tx.type === 'Expense' ? -tx.amount : tx.amount), 0),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const categories = Array.from(new Set(transactions.map((tx) => tx.category))).sort();
  const locale = getDateFnsLocale();
  const rangeLabel = `${format(startDate, 'd MMM', { locale })} – ${format(endDate, 'd MMM', { locale })}`;

  return (
    <Screen pal={C}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8, paddingBottom: BAR.clearance(insets.bottom) }}>
        <Header
          pal={C}
          title={t('transactionsScreen.historyTitle')}
          subtitle={
            filtered.length > 0
              ? t('transactionsScreen.recordsFound', { count: filtered.length })
              : t('transactionsScreen.noRecords')
          }
          actions={
            <CircleAction pal={C} label={rangeLabel} onPress={() => setShowDates(true)}>
              <SlidersHorizontal size={18} color={C.ink} strokeWidth={S.stroke} />
            </CircleAction>
          }
        />

        {/* One row of chips instead of three stacked controls. The date range
            is a chip too, so the current filter state is one line you can read
            rather than something you have to remember opening. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginTop: 16 }}
          contentContainerStyle={{ paddingHorizontal: S.screen, gap: 8 }}
        >
          <FilterChip
            pal={C}
            label={t('transactionsScreen.allCategories')}
            active={filterCategory === null && !filterImpulseOnly}
            onPress={() => {
              setFilterCategory(null);
              setFilterImpulseOnly(false);
            }}
          />
          <FilterChip
            pal={C}
            label={t('transactionsScreen.impulsePill')}
            active={filterImpulseOnly}
            onPress={() => setFilterImpulseOnly((v) => !v)}
          />
          {categories.map((cat) => (
            <FilterChip
              key={cat}
              pal={C}
              label={categoryLabel(cat, allCategories)}
              active={filterCategory === cat}
              onPress={() => setFilterCategory((current) => (current === cat ? null : cat))}
            />
          ))}
        </ScrollView>

        {days.length === 0 ? (
          <Empty
            pal={C}
            icon={<Inbox size={26} color={C.accent} strokeWidth={S.stroke} />}
            title={t('common.nothingYet')}
            body={t('common.transactionsEmptyBody')}
            style={{ marginTop: 80 }}
          />
        ) : (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
            {days.map((day) => (
              <View key={day.date} style={{ marginBottom: 24 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                  }}
                >
                  <Type role="meta" color={C.inkDim}>
                    {format(parseISO(day.date), 'EEEE, d MMMM', { locale })}
                  </Type>
                  <Amount
                    value={day.total}
                    format={formatCurrency}
                    size={13}
                    weight="medium"
                    color={C.inkDim}
                    signed
                  />
                </View>

                <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: 0 }}>
                  {day.transactions.map((tx, i) => {
                    const showTimeCost =
                      !!settings?.showTimeCost &&
                      settings.hourlyValue > 0 &&
                      tx.type === 'Expense';
                    const meta = [
                      categoryLabel(tx.category, allCategories),
                      tx.isImpulse ? t('transactionsScreen.impulsePill') : null,
                      showTimeCost
                        ? formatTimeCost(calculateTimeCost(tx.amount, settings.hourlyValue))
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');

                    return (
                      <View
                        key={tx.id}
                        style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                      >
                        <SwipeRow
                          pal={C}
                          onDelete={() => handleDelete(tx.id)}
                          actionLabel={t('dialogs.delete')}
                        >
                          {/* The category reads as its glyph on a soft tile,
                              never as a colour; the amount is signed and green
                              in, red out (kit Row). */}
                          <Row
                            pal={C}
                            icon={categoryIcon(tx.category, tx.type)}
                            title={tx.note?.trim() || categoryLabel(tx.category, allCategories)}
                            meta={meta}
                            amount={tx.type === 'Expense' ? -tx.amount : tx.amount}
                            format={formatCurrency}
                            style={{ paddingHorizontal: S.card }}
                          />
                        </SwipeRow>
                      </View>
                    );
                  })}
                </Card>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* The date range, one tap deeper. Two spinners and a Done button — no
          reason for it to occupy the top of the screen permanently. */}
      <Sheet pal={C} visible={showDates} onClose={() => setShowDates(false)} title={rangeLabel}>
        <View style={{ paddingHorizontal: S.card }}>
          <Type role="meta" color={C.inkDim} style={{ marginBottom: 8 }}>
            {t('misc2.dateFrom')}
          </Type>
          <DateTimePicker
            value={startDate}
            mode="date"
            display="compact"
            themeVariant={C.scheme}
            onChange={(_, date) => date && setStartDate(date)}
            style={{ alignSelf: 'flex-start' }}
          />
          <Type role="meta" color={C.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
            {t('misc2.dateTo')}
          </Type>
          <DateTimePicker
            value={endDate}
            mode="date"
            display="compact"
            themeVariant={C.scheme}
            onChange={(_, date) => date && setEndDate(date)}
            style={{ alignSelf: 'flex-start' }}
          />
          <PrimaryButton
            pal={C}
            label={t('dialogs.done')}
            onPress={() => setShowDates(false)}
            style={{ marginTop: 24 }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
