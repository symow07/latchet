import { View, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useState, useCallback } from 'react';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { SlidersHorizontal, TrendingUp } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBudget, setBudget, type BudgetCategory, type BudgetData } from '@/lib/budgetApi';
import { getBusiness } from '@/lib/businessApi';
import { roleOf } from '@/lib/group-members';
import { useSession } from '@/lib/auth/use-session';
import { useFocusEffect } from 'expo-router';
import { formatCurrency } from '@/lib/calculations';
import { BAR, S, useC, type Palette } from '@/lib/design';
import { EASE, MOTION } from '@/lib/identity/motion';
import { DARK as ON_ESPRESSO } from '@/lib/identity/tokens';
import {
  Amount, BalanceCard, Card, CircleAction, Empty, Field, Header, PrimaryButton, Screen,
  SectionHeader, Sheet, Stat, Type,
} from '@/components/kit';
import { t } from '@/lib/i18n/core';
import { expenseCategoryLabel } from '@/lib/expense-meta';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ALL_CATEGORIES: BudgetCategory[] = ['Travel', 'Software', 'Meals', 'Transport', 'Office', 'Other'];

function ratio(spent: number, budget: number) {
  if (budget <= 0) return 0;
  return Math.min(spent / budget, 1);
}

/**
 * Three states, and the sentence beside the bar always says which one.
 *
 * The colours used to be three hex literals (a red, an amber and a teal) that
 * appear nowhere in the palette. They are now the semantic tokens, which are
 * the ones verified against both grounds.
 */
function trackTone(pal: Palette, spent: number, budget: number): string {
  if (budget <= 0) return pal.groundSunk;
  const r = spent / budget;
  return r >= 1 ? pal.negative : r >= 0.8 ? pal.warning : pal.accentMark;
}

/**
 * The total's bar fills once when the screen comes into focus.
 *
 * Only this one. The previous version animated every category row too, on a
 * staggered delay — and when eight bars all arrive the same way, none of them
 * arrives. The screen has one number worth watching land; the rows beneath it
 * are a list you read.
 *
 * The fill is the identity's progress line: 280 ms on the ease-in-out curve.
 * It used to take 700 ms, which is a wait rather than a response.
 *
 * `onAnchor` draws it on the espresso anchor: a translucent silver track
 * under a silver fill, never white.
 */
function Meter({
  pal, value, tone, animate = false, onAnchor = false,
}: {
  pal: Palette;
  value: number;
  tone: string;
  animate?: boolean;
  onAnchor?: boolean;
}) {
  const reduced = useReducedMotion();
  const width = useSharedValue(animate && !reduced ? 0 : value);

  useFocusEffect(
    useCallback(() => {
      if (!animate || reduced) {
        width.set(value);
        return;
      }
      width.set(0);
      const [x1, y1, x2, y2] = EASE[MOTION.progress.ease];
      width.set(
        withTiming(value, {
          duration: MOTION.progress.duration,
          easing: Easing.bezier(x1, y1, x2, y2),
        }),
      );
    }, [value, animate, reduced, width])
  );

  const fill = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={{
        height: 6,
        borderRadius: 3,
        backgroundColor: onAnchor ? pal.glassStrong : pal.groundSunk,
        overflow: 'hidden',
        // Fills from the reading direction, so it mirrors in Arabic rather
        // than draining backwards (§7).
        flexDirection: 'row',
      }}
    >
      <Animated.View style={[{ borderRadius: 3, backgroundColor: tone }, fill]} />
    </View>
  );
}

// ── Editing ──────────────────────────────────────────────────────────────────

function EditBudgetSheet({
  visible, onClose, currentData,
}: {
  visible: boolean;
  onClose: () => void;
  currentData: BudgetData | null | undefined;
}) {
  const B = useC();
  const qc = useQueryClient();
  const [total, setTotal] = useState('');
  const [byCategory, setByCategory] = useState<Partial<Record<BudgetCategory, string>>>({});
  const [primed, setPrimed] = useState(false);

  // Prime from the server's values the first time the sheet opens, and again
  // whenever it reopens, so an abandoned edit is not still sitting there.
  if (visible && !primed) {
    setPrimed(true);
    setTotal(currentData?.budget.totalMonthly ? String(currentData.budget.totalMonthly) : '');
    const initial: Partial<Record<BudgetCategory, string>> = {};
    for (const key of ALL_CATEGORIES) {
      const v = currentData?.budget.categories[key];
      initial[key] = v ? String(v) : '';
    }
    setByCategory(initial);
  }
  if (!visible && primed) setPrimed(false);

  const save = useMutation({
    mutationFn: () => {
      const totalValue = parseFloat(total);
      if (isNaN(totalValue) || totalValue < 0) throw new Error(t('businessInsights.totalBudget'));
      const categories: Partial<Record<BudgetCategory, number>> = {};
      for (const key of ALL_CATEGORIES) {
        const v = parseFloat(byCategory[key] ?? '');
        if (!isNaN(v) && v > 0) categories[key] = v;
      }
      return setBudget({ totalMonthly: totalValue, categories });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['biz-budget'] });
      onClose();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('common.error'), e.message);
    },
  });

  return (
    <Sheet pal={B} visible={visible} onClose={onClose} title={t('businessInsights.setBudget')}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: S.card, paddingBottom: 8 }}
      >
        <Field
          pal={B}
          label={t('businessInsights.totalBudget')}
          value={total}
          onChangeText={setTotal}
          placeholder="0"
          keyboardType="decimal-pad"
        />

        <Type role="meta" color={B.inkDim} style={{ marginTop: 16, marginBottom: 4 }}>
          {t('businessInsights.categoryBudgets')}
        </Type>
        {ALL_CATEGORIES.map((key) => (
          <Field
            key={key}
            pal={B}
            label={expenseCategoryLabel(key)}
            value={byCategory[key] ?? ''}
            onChangeText={(v) => setByCategory((prev) => ({ ...prev, [key]: v }))}
            placeholder="—"
            keyboardType="decimal-pad"
            style={{ marginTop: 12 }}
          />
        ))}

        <PrimaryButton
          pal={B}
          label={save.isPending
            ? t('businessInsights.savingBudget')
            : t('businessInsights.saveBudgetButton')}
          onPress={() => save.mutate()}
          disabled={save.isPending}
          style={{ marginTop: 24 }}
        />
      </ScrollView>
    </Sheet>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

/**
 * Budget — DESIGN-PROMPT.md §36.
 *
 * The hero card used to change colour wholesale when you went over: a
 * near-black red gradient on a light-mode screen, plus a tinted warning strip,
 * plus a percentage in a fourth colour, plus a row of three differently
 * coloured figures underneath. Five signals for one fact.
 *
 * §6.2 says it in one sentence and one track, with the state named in words so
 * it never rests on telling two tints apart. The hero is the screen's one
 * espresso anchor: off-white figures, a silver track, and the silver
 * Remaining figure, as on home.
 */
export default function BudgetScreen({ embedded }: { embedded?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const B = useC();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [showEdit, setShowEdit] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['biz-budget'], queryFn: getBudget });
  const { data: business } = useQuery({ queryKey: ['my-business'], queryFn: getBusiness });

  useFocusEffect(useCallback(() => { qc.invalidateQueries({ queryKey: ['biz-budget'] }); }, [qc]));

  const myRole = roleOf(business, session?.user?.id);
  const canEdit = myRole === 'owner' || myRole === 'manager';

  const totalBudget = data?.budget.totalMonthly ?? 0;
  const totalSpent = data?.spending.total ?? 0;
  const totalRatio = ratio(totalSpent, totalBudget);
  const overBudget = totalBudget > 0 && totalSpent > totalBudget;
  const remaining = Math.max(totalBudget - totalSpent, 0);

  const rows = ALL_CATEGORIES
    .map((key) => ({
      key,
      spent: data?.spending.byCategory[key]?.spent ?? 0,
      budget: data?.budget.categories[key] ?? 0,
    }))
    .filter((r) => r.spent > 0 || r.budget > 0);

  const editAction = canEdit ? (
    <CircleAction pal={B} label={t('businessInsights.edit')} onPress={() => setShowEdit(true)}>
      <SlidersHorizontal size={18} color={B.ink} strokeWidth={S.stroke} />
    </CircleAction>
  ) : null;

  const body = (
    <>
      <EditBudgetSheet visible={showEdit} onClose={() => setShowEdit(false)} currentData={data} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: BAR.clearance(insets.bottom) }}>
        {embedded ? (
          canEdit ? (
            <View style={{ alignItems: 'flex-end', paddingHorizontal: S.screen, marginTop: 16 }}>
              {editAction}
            </View>
          ) : null
        ) : (
          <Header pal={B} title={t('businessInsights.budget')} actions={editAction} style={{ marginTop: 8 }} />
        )}

        {isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 80 }}>
            <ActivityIndicator color={B.accent} />
          </View>
        ) : (
          <>
            <View style={{ paddingHorizontal: S.screen, marginTop: embedded ? 12 : 24 }}>
              <BalanceCard
                pal={B}
                label={data?.month.label ?? t('businessInsights.monthlySpend')}
                amount={totalSpent}
                format={formatCurrency}
                // One sentence, in plain English, that already contains the
                // state — no badge, no percentage in a fourth hue.
                caption={
                  totalBudget > 0
                    ? overBudget
                      ? t('businessInsights.overBudgetBy', {
                          amount: formatCurrency(totalSpent - totalBudget),
                        })
                      : t('businessInsights.pctUsed', { pct: Math.round(totalRatio * 100) })
                    : undefined
                }
              >
                {totalBudget > 0 ? (
                  <>
                    <View style={{ marginTop: 16 }}>
                      {/* Over budget the fill turns red: the dark scheme's red,
                          the one that reads on espresso. The sentence above
                          says "over" in words. */}
                      <Meter
                        pal={B}
                        value={totalRatio}
                        tone={overBudget ? ON_ESPRESSO.negative : B.silver}
                        animate
                        onAnchor
                      />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
                      <Stat
                        pal={B}
                        label={t('businessInsights.budgetLabel')}
                        value={totalBudget}
                        format={formatCurrency}
                        size={17}
                        tone={B.onEspresso}
                        labelTone={B.onEspressoDim}
                      />
                      <Stat
                        pal={B}
                        label={t('bizStats.remaining')}
                        value={remaining}
                        format={formatCurrency}
                        size={17}
                        tone={B.silver}
                        labelTone={B.onEspressoDim}
                        align="flex-end"
                      />
                    </View>
                  </>
                ) : null}
              </BalanceCard>

              {/* The secondary button, not espresso: the anchor above is
                  already the screen's one espresso surface. */}
              {totalBudget === 0 && canEdit ? (
                <PrimaryButton
                  pal={B}
                  label={t('businessInsights.setBudgetShort')}
                  onPress={() => setShowEdit(true)}
                  variant="secondary"
                  style={{ marginTop: 16 }}
                />
              ) : null}
            </View>

            {rows.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={B} title={t('businessInsights.byCategory')} />
                <View style={{ paddingHorizontal: S.screen }}>
                  <Card pal={B} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                    {rows.map((row, i) => (
                      <View
                        key={row.key}
                        style={[
                          { paddingVertical: 16 },
                          i > 0 ? { borderTopWidth: 1, borderTopColor: B.hairline } : null,
                        ]}
                      >
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'baseline',
                            justifyContent: 'space-between',
                            marginBottom: 8,
                          }}
                        >
                          <Type role="cardTitle" color={B.ink}>
                            {expenseCategoryLabel(row.key)}
                          </Type>
                          <Amount
                            value={row.spent}
                            format={formatCurrency}
                            size={17}
                            weight="semibold"
                            color={row.budget > 0 && row.spent > row.budget ? B.negative : B.ink}
                          />
                        </View>
                        <Type role="meta" color={B.inkDim} style={{ marginBottom: 12 }}>
                          {row.budget > 0
                            ? t('businessInsights.pctUsed', {
                                pct: Math.round((row.spent / row.budget) * 100),
                              })
                            : t('businessInsights.spentNoLimit', {
                                amount: formatCurrency(row.spent),
                              })}
                        </Type>
                        {row.budget > 0 ? (
                          <Meter
                            pal={B}
                            value={ratio(row.spent, row.budget)}
                            tone={trackTone(B, row.spent, row.budget)}
                          />
                        ) : null}
                      </View>
                    ))}
                  </Card>
                </View>
              </View>
            ) : (
              <Empty
                pal={B}
                icon={<TrendingUp size={26} color={B.accent} strokeWidth={S.stroke} />}
                title={t('businessInsights.noSpending')}
                body={t('businessInsights.noSpendingHint')}
                style={{ marginTop: 64 }}
              />
            )}
          </>
        )}
      </ScrollView>
    </>
  );

  if (embedded) return <View style={{ flex: 1 }}>{body}</View>;
  return <Screen pal={B}>{body}</Screen>;
}
