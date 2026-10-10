import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Svg, { Circle, G } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Sparkles } from '@/components/icons';

import { getSettings, getTransactions } from '@/lib/db';
import { calculateHealthScore, type HealthScoreResult } from '@/lib/health-score';
import { S, useC } from '@/lib/design';
import { CountUp } from '@/components/motion';
import {
  Card,
  IconTile,
  LinkRow,
  Screen,
  SectionHeader,
  SubHeader,
  Type,
} from '@/components/kit';
import { t } from '@/lib/i18n/core';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Module scope so it keeps one identity: `CountUp` memoises its number
 *  formatting against this function, and an inline arrow would rebuild that
 *  on every render. */
const scoreFormat = (n: number) => String(Math.round(n));

const RING = 200;
/** §6.13 — a thin donut, not a gauge. */
const STROKE = 12;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Health score — DESIGN-PROMPT.md §19 and §6.15: one arc, one big number, one
 * plain-English verdict.
 *
 * The old screen wrapped the ring in a gradient header whose colour came from
 * `gradeColor` — so the entire top of the app changed hue depending on how the
 * user was doing, in colours belonging to no palette. Below it, five breakdown
 * rows carried five *different* hardcoded accents and five progress bars to
 * match, then amber-tinted advice cards and a violet gradient CTA. Seven hues,
 * one screen.
 *
 * All of it says the same thing the shape already says. The ring is now the
 * only large object, the five bars are all `accentMark` because they are five
 * measures of one quantity, and the advice is prose on a white card — §1.3,
 * prose over data.
 *
 * The count is the screen's one authored moment, and it now runs on the UI
 * thread. It used to be a `setInterval` firing `setState` 60 times, which
 * re-rendered the whole screen — five cards, a chart and an SVG — once per
 * frame to move one label.
 */
export default function HealthScoreScreen() {
  const C = useC();
  const router = useRouter();
  const reduced = useReducedMotion();
  const [health, setHealth] = useState<HealthScoreResult | null>(null);

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions'],
    queryFn: getTransactions,
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  useEffect(() => {
    // Compute as soon as settings load — a brand-new user with zero
    // transactions should still get a (low) score, not an endless "Loading…".
    if (!settings) return;
    try {
      setHealth(calculateHealthScore(transactions, settings));
    } catch {
      // Leave the previous score up rather than blanking the screen.
    }
  }, [transactions, settings]);

  const target = health?.totalScore ?? 0;
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (!health) return;
    if (reduced) {
      sweep.value = target / 100;
      return;
    }
    // No `sweep.value = 0` reset and no cancel-on-cleanup: writing a plain
    // value and an animation to the same shared value inside one synchronous
    // block makes the second write lose, and the cleanup fires on every
    // dependency change — between them the arc never left zero.
    sweep.value = withTiming(target / 100, {
      duration: 900,
      easing: Easing.out(Easing.exp),
    });
  }, [health, target, reduced, sweep]);

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - sweep.value),
  }));

  const trendLine =
    health?.trend === 'up'
      ? t('healthScore.trendUp', { value: health.trendValue })
      : health?.trend === 'down'
        ? t('healthScore.trendDown', { value: health.trendValue })
        : t('healthScore.stableThisWeek');

  const breakdownItems = health
    ? [
        { label: t('healthBreakdown.savingsRate'), ...health.breakdown.savingsRate },
        { label: t('healthBreakdown.discipline'), ...health.breakdown.budgetDiscipline },
        { label: t('healthBreakdown.consistency'), ...health.breakdown.spendingConsistency },
        { label: t('healthBreakdown.goalProgress'), ...health.breakdown.goalProgress },
        { label: t('healthBreakdown.impulse'), ...health.breakdown.impulseControl },
      ]
    : [];

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 80 }}
      >
        <SubHeader pal={C} title={t('healthScore.title')} onBack={() => router.back()} />

        <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
          <Card pal={C} contentStyle={{ padding: 24, alignItems: 'center' }}>
            <View style={{ width: RING, height: RING }}>
              <Svg width={RING} height={RING}>
                {/* -90° so the arc starts at twelve o'clock rather than at
                    three, which is where a reader expects a dial to begin. */}
                <G rotation="-90" origin={`${RING / 2}, ${RING / 2}`}>
                  <Circle
                    cx={RING / 2}
                    cy={RING / 2}
                    r={RADIUS}
                    stroke={C.groundSunk}
                    strokeWidth={STROKE}
                    fill="none"
                  />
                  <AnimatedCircle
                    cx={RING / 2}
                    cy={RING / 2}
                    r={RADIUS}
                    stroke={C.accentMark}
                    strokeWidth={STROKE}
                    fill="none"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeLinecap="round"
                    animatedProps={arcProps}
                  />
                </G>
              </Svg>

              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CountUp
                  value={target}
                  format={scoreFormat}
                  size={44}
                  color={C.ink}
                />
                {health ? (
                  <Type role="meta" color={C.inkDim} style={{ marginTop: 2 }}>
                    {t('healthScore.gradeLabel', { grade: health.grade })}
                  </Type>
                ) : null}
              </View>
            </View>

            {/* The verdict. §6.15 asks for one line of plain English, and this
                is the line — the number above it is only a number. */}
            {health ? (
              <View style={{ marginTop: 16, alignItems: 'center' }}>
                <Type role="section" color={C.ink} style={{ textAlign: 'center' }}>
                  {t(`personality.${health.personalityType}.title`)}
                </Type>
                <Type
                  role="body"
                  color={C.inkDim}
                  style={{ textAlign: 'center', marginTop: 6 }}
                >
                  {t(`personality.${health.personalityType}.body`)}
                </Type>
                <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
                  {trendLine}
                </Type>
              </View>
            ) : null}
          </Card>

          {/* The caveat sits under the number it qualifies, not in a tinted
              box of its own — proximity is what ties it to the score. */}
          {transactions.length < 5 ? (
            <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
              {t('healthScore.estimateNote', { count: transactions.length })}
            </Type>
          ) : null}
        </View>

        {health ? (
          <>
            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('healthScore.breakdown')} />
              <View style={{ paddingHorizontal: S.screen }}>
                <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                  {breakdownItems.map((item, i) => (
                    <View
                      key={item.label}
                      style={{
                        paddingVertical: 16,
                        ...(i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : null),
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          marginBottom: 12,
                          gap: 12,
                        }}
                      >
                        <Type role="cardTitle" color={C.ink} numberOfLines={1} style={{ flex: 1 }}>
                          {item.label}
                        </Type>
                        <Type role="meta" color={C.inkDim}>
                          {`${item.score}/${item.maxPoints}`}
                        </Type>
                      </View>
                      <View
                        accessibilityRole="progressbar"
                        accessibilityLabel={item.label}
                        accessibilityValue={{ min: 0, max: item.maxPoints, now: item.score }}
                        style={{
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: C.groundSunk,
                          overflow: 'hidden',
                          flexDirection: 'row',
                        }}
                      >
                        <View
                          style={{
                            width: `${Math.min(100, (item.score / item.maxPoints) * 100)}%`,
                            backgroundColor: C.accentMark,
                            borderRadius: 3,
                          }}
                        />
                      </View>
                    </View>
                  ))}
                </Card>
              </View>
            </View>

            {health.suggestions.length > 0 ? (
              <View style={{ marginTop: S.section }}>
                <SectionHeader pal={C} title={t('healthScore.howToImprove')} />
                <View style={{ paddingHorizontal: S.screen }}>
                  <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                    {health.suggestions.map((suggestion, i) => (
                      <View
                        key={suggestion}
                        style={{
                          paddingVertical: 16,
                          ...(i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : null),
                        }}
                      >
                        <Type role="body" color={C.ink}>
                          {suggestion}
                        </Type>
                      </View>
                    ))}
                  </Card>
                </View>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
          <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
            <LinkRow
              pal={C}
              icon={
                <IconTile pal={C}>
                  <Sparkles size={20} color={C.accent} strokeWidth={S.stroke} />
                </IconTile>
              }
              title={t('healthScore.getAdvice')}
              body={t('healthScore.chatWithAi')}
              onPress={() => router.push('/(tabs)/advisor')}
              style={{ paddingVertical: 14 }}
            />
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
