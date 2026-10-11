import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import * as Haptics from 'expo-haptics';

import { deleteCategoryBudget, getCategoryBudgets, getSettings, getTransactions, setCategoryBudget } from '@/lib/db';
import { getCategories, DEFAULT_CATEGORIES } from '@/lib/categories';
import { categoryLabel } from '@/lib/category-meta';
import { formatCurrency } from '@/lib/calculations';
import { currentMonthKey } from '@/lib/dates';
import { budgetLines, parseBudgetLimit } from '@/lib/offline/category-budgets';
import { S, useC } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import { categoryIcon } from '@/components/category-icon';
import {
  Card,
  Field,
  IconTile,
  InfoRow,
  Meter,
  PrimaryButton,
  Screen,
  SectionHeader,
  Sheet,
  SubHeader,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

/** This month's spend per category, from the local ledger. */
function currentMonthSpending(
  transactions: { category: string; type: string; amount: number; dateISO: string }[]
): Record<string, number> {
  const yearMonth = currentMonthKey();
  const spending: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.type === 'Expense' && tx.dateISO.startsWith(yearMonth)) {
      spending[tx.category] = (spending[tx.category] ?? 0) + tx.amount;
    }
  }
  return spending;
}

/**
 * Category budgets — DESIGN-PROMPT.md §29: per-category lines, one over
 * budget.
 *
 * Three things were wrong here beyond the violet gradient header.
 *
 * **Every amount on the screen was hardcoded to dollars** — `$${n.toFixed(0)}`
 * in six places. A user who picked euros in onboarding saw their euro spending
 * labelled in dollars, on the screen whose entire job is comparing two
 * amounts. All of it now goes through the shared formatter, like the rest of
 * the app.
 *
 * **The categories were a hardcoded English list of six** with an `emoji`
 * field that was an empty string, so each row rendered a 48px coloured square
 * with nothing in it. The list now comes from `getCategories()`, which is what
 * every other screen reads and what the user's own custom categories live in.
 *
 * **The month heading was `toLocaleString('default')` uppercased** — English
 * month names in every language, in the one type style §3 does not have.
 *
 * What is left is one line per category: its glyph on a sunk tile (the
 * identity marks a category by its glyph, never by a colour), a name, a
 * sentence saying where you are, one meter, and the limit. Tapping a line
 * opens the sheet that sets it.
 *
 * Since Phase 4 the budgets live in this phone's database and sync, keyed by
 * category: setting a limit works offline and replaces the category's
 * previous one. A failure to read them says so, where it used to show every
 * category as having no limit. A budget whose category no longer exists is
 * listed after the rest, so it can still be removed.
 */
export default function CategoryBudgetsScreen() {
  const C = useC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState('');

  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['category-budgets'] });
    }, [queryClient])
  );

  // Read from this phone's database, so the screen works offline; a pull
  // that changes it refreshes every query (cloud-sync's onRemoteChange).
  const {
    data: budgets = [],
    isLoading: budgetsLoading,
    isError: budgetsFailed,
  } = useQuery({
    queryKey: ['category-budgets'],
    queryFn: getCategoryBudgets,
  });
  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: getTransactions,
  });
  const { data: categories = DEFAULT_CATEGORIES } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  const spending = currentMonthSpending(transactions);
  const budgetFor = (category: string) => budgets.find((b) => b.category === category);
  const lines = budgetLines(categories, budgets);

  const saveMutation = useMutation({
    // Keyed by category: a second limit for a category replaces the first.
    mutationFn: ({ category, value }: { category: string; value: number }) =>
      setCategoryBudget(category, value, 'monthly'),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['category-budgets'] });
      close();
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  });

  const deleteMutation = useMutation({
    mutationFn: (category: string) => deleteCategoryBudget(category),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['category-budgets'] });
      close();
    },
  });

  function close() {
    setEditing(null);
    setAmount('');
  }

  function open(category: string) {
    const existing = budgetFor(category);
    setAmount(existing ? String(existing.amount) : '');
    setEditing(category);
  }

  function save() {
    if (!editing) return;
    const value = parseBudgetLimit(amount);
    if (value === null) return;
    saveMutation.mutate({ category: editing, value });
  }

  const editingBudget = editing ? budgetFor(editing) : undefined;
  const monthLabel = format(new Date(), 'MMMM yyyy', { locale: getDateFnsLocale() });

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
      >
        <SubHeader pal={C} title={t('categoryBudgets.title')} onBack={() => router.back()} />

        <Type role="body" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
          {t('categoryBudgets.subtitle')}
        </Type>

        <View style={{ marginTop: S.section }}>
          <SectionHeader pal={C} title={monthLabel} />
          <View style={{ paddingHorizontal: S.screen }}>
            {budgetsLoading ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator color={C.accent} />
              </View>
            ) : budgetsFailed ? (
              // Not "no limit set" on every line: that is a claim about the
              // user's budgets the screen could not read.
              <Type role="body" color={C.negative}>
                {t('categoryBudgets.loadFailed')}
              </Type>
            ) : (
              <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                {lines.map(({ name, budget }, i) => {
                  const spent = spending[name] ?? 0;
                  const over = budget !== null && spent > budget.amount;
                  const ratio = budget && budget.amount > 0 ? spent / budget.amount : 0;
                  // A module-level glyph component, so the row keeps one identity.
                  const Glyph = categoryIcon(name);

                  const sentence = budget
                    ? over
                      ? `${t('categoryBudgets.spentOf', { amount: formatCurrency(spent) })} · ${t(
                          'categoryBudgets.overBy',
                          { amount: formatCurrency(spent - budget.amount) }
                        )}`
                      : `${t('categoryBudgets.spentOf', {
                          amount: formatCurrency(spent),
                        })}${t('categoryBudgets.remaining', {
                          amount: formatCurrency(budget.amount - spent),
                        })}`
                    : t('categoryBudgets.noLimitSet', { amount: formatCurrency(spent) });

                  return (
                    <View
                      key={name}
                      style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                    >
                      <InfoRow
                        pal={C}
                        title={categoryLabel(name, categories)}
                        meta={sentence}
                        onPress={() => open(name)}
                        amount={budget?.amount}
                        format={budget ? formatCurrency : undefined}
                        lead={
                          <IconTile pal={C} size={40} style={{ backgroundColor: C.groundSunk }}>
                            <Glyph size={22} color={C.ink} />
                          </IconTile>
                        }
                        trailing={
                          budget ? null : (
                            <Type role="meta" color={C.inkDim}>
                              {t('common.noLimit')}
                            </Type>
                          )
                        }
                        // Only a category with a limit has a proportion; a
                        // category without one has nothing to be a fraction of,
                        // and an empty track would imply it had spent nothing.
                        footer={
                          budget ? (
                            <Meter
                              pal={C}
                              ratio={ratio}
                              tone={over ? C.negative : undefined}
                              label={categoryLabel(name, categories)}
                              style={{ marginTop: 12 }}
                            />
                          ) : null
                        }
                      />
                    </View>
                  );
                })}
              </Card>
            )}

            <Type role="meta" color={C.inkDim} style={{ marginTop: 16 }}>
              {t('categoryBudgets.footnote')}
            </Type>
          </View>
        </View>
      </ScrollView>

      <Sheet
        pal={C}
        visible={editing !== null}
        onClose={close}
        title={
          editing
            ? t('categoryBudgets.titleFor', { category: categoryLabel(editing, categories) })
            : undefined
        }
      >
        <View style={{ paddingHorizontal: S.card }}>
          <Field
            pal={C}
            label={t('categoryBudgets.monthlyLimit')}
            value={amount}
            onChangeText={setAmount}
            placeholder={t('fields.enterAmount')}
            keyboardType="decimal-pad"
            autoFocus
            icon={
              <Type role="cardTitle" color={C.inkDim}>
                {settings?.currencySymbol || '$'}
              </Type>
            }
          />

          <PrimaryButton
            pal={C}
            label={
              saveMutation.isPending
                ? t('categoryBudgets.saving')
                : t('categoryBudgets.setBudget')
            }
            onPress={save}
            disabled={saveMutation.isPending || parseBudgetLimit(amount) === null}
            style={{ marginTop: 24 }}
          />

          {editingBudget ? (
            <PressableScale
              onPress={() => deleteMutation.mutate(editingBudget.category)}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel={t('categoryBudgets.removeLimit')}
              style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}
            >
              <Type role="cardTitle" color={C.negative}>
                {t('categoryBudgets.removeLimit')}
              </Type>
            </PressableScale>
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}
