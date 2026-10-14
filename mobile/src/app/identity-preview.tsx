/**
 * Phase 2a sample: the personal Home, in the new identity.
 *
 * A review artifact, not a screen users reach. Development builds only; a
 * release build redirects to "/". It renders the real Home's content in the
 * real Home's order (greeting and advisor, balance and the month's budget,
 * quick actions, one insight, recent activity) against SYNTHETIC data from
 * lib/identity/demo.ts, so it can be judged signed out on a fresh simulator.
 * Nothing here reads the database.
 *
 * Open it with: latchet://identity-preview
 * Tap the balance to replay the entrance, the count-ups and the check.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, Stack, useRouter } from 'expo-router';
import { format, subDays } from 'date-fns';
import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScheme } from '@/lib/design';
import { formatCurrency } from '@/lib/calculations';
import { categoryLabel } from '@/lib/category-meta';
import { getDateFnsLocale, t } from '@/lib/i18n/core';
import {
  BAR_BLUR,
  BAR_TINT_ALPHA,
  ELEVATION,
  GLYPH,
  MIN_TARGET,
  PALETTES,
  RADIUS,
  SPACE,
  type IdentityPalette,
} from '@/lib/identity/tokens';
import { choreographyEnd, settleDelay } from '@/lib/identity/motion';
import type { GlyphName } from '@/lib/identity/glyph-paths';
import { DEMO, type DemoTransaction } from '@/lib/identity/demo';
import {
  CountUp,
  DrawCheck,
  Glyph,
  Press,
  ProgressLine,
  Settle,
  Surface,
  Type,
  lift,
  shadow,
} from '@/components/identity/primitives';

/**
 * Two shortcuts, neither of which the tab bar already offers: Add, Insights
 * and Budgets each had a tab or a one-tap path, so the old four-tile row
 * mostly duplicated the bar. Functions, not constants: t() has to run after
 * the locale is chosen.
 */
const quickActions = (): { key: string; label: string; glyph: GlyphName }[] => [
  { key: 'scan', label: t('receiptScan.title'), glyph: 'scan' },
  { key: 'subscriptions', label: t('subscriptionsScreen.title'), glyph: 'repeat' },
];

const tabs = (): { key: string; label: string; glyph: GlyphName }[] => [
  { key: 'home', label: t('tabs.home'), glyph: 'home' },
  { key: 'activity', label: t('tabs.activity'), glyph: 'activity' },
  { key: 'add', label: t('tabs.add'), glyph: 'add' },
  { key: 'insights', label: t('tabs.insights'), glyph: 'insights' },
  { key: 'settings', label: t('tabs.settings'), glyph: 'settings' },
];

const BAR_HEIGHT = 64;

/** The Home's own greeting rule, so the sample says what Home would. */
function greetingWord(): string {
  const hour = new Date().getHours();
  if (hour < 12) return t('greeting.morning');
  if (hour < 17) return t('greeting.afternoon');
  if (hour < 21) return t('greeting.evening');
  return t('greeting.night');
}

export default function IdentityPreview() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Sample />;
}

function Sample() {
  const P = PALETTES[useScheme()];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [replay, setReplay] = useState(0);
  const [tab, setTab] = useState('home');

  const left = DEMO.budget - DEMO.spent;
  const greeting = t('home.greetingName', { greeting: greetingWord(), name: DEMO.name });
  // The check lands as its card finishes settling, not on top of it.
  const checkDelay = choreographyEnd(4);

  const advisor = lift(P, ELEVATION.rest, P.surface, RADIUS.control);
  // The anchor's edge is silver too, at a strength that reads on espresso.
  const anchor = lift(P, ELEVATION.anchor, P.espresso, RADIUS.anchor, hexAlpha(P.silver, 0.5));

  return (
    <View
      style={{ flex: 1, backgroundColor: P.ground }}
      // Opened by deep link and drawn as a Home, so there is no back button:
      // edge-swipe goes back, and VoiceOver's escape gesture does the same.
      onAccessibilityEscape={() => {
        if (router.canGoBack()) router.back();
      }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style={P.scheme === 'dark' ? 'light' : 'dark'} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + SPACE.sm,
          paddingBottom: insets.bottom + BAR_HEIGHT + SPACE.section,
        }}
      >
        {/* Greeting and the advisor */}
        <Settle index={0} replay={replay} style={styles.header}>
          <View style={{ flex: 1 }}>
            <Type role="footnote" color={P.inkDim}>
              {format(new Date(), 'EEEE, d MMMM', { locale: getDateFnsLocale() })}
            </Type>
            <Type role="title" color={P.ink} style={{ marginTop: SPACE.xs }}>
              {greeting}
            </Type>
          </View>
          <Press accessibilityLabel={t('home.ask')} style={advisor.outer}>
            <View style={[advisor.inner, styles.circleAction]}>
              <Glyph name="advisor" size={GLYPH.sizes.action} color={P.ink} />
            </View>
          </Press>
        </Settle>

        {/* The anchor: the balance, and this month's budget inside it */}
        <Settle index={1} replay={replay} style={{ marginTop: SPACE.xxl, paddingHorizontal: SPACE.gutter }}>
          <View>
            <Press
              haptic={false}
              onPress={() => setReplay((n) => n + 1)}
              accessibilityLabel={`${t('home.balanceLabel')} ${formatCurrency(DEMO.balance)}`}
              style={anchor.outer}
            >
              <View style={[anchor.inner, styles.anchorInner]}>
                <Type role="callout" color={P.onEspressoDim}>
                  {t('home.balanceLabel')}
                </Type>
                <CountUp
                  value={DEMO.balance}
                  format={formatCurrency}
                  color={P.onEspresso}
                  replay={replay}
                  delay={settleDelay(1)}
                  fit={12}
                  style={{ marginTop: SPACE.sm }}
                />
                <Type role="footnote" color={P.onEspressoDim} style={{ marginTop: SPACE.xs }}>
                  {t('home.balanceCaption', { count: DEMO.accounts })}
                </Type>

                <ProgressLine
                  value={DEMO.spent / DEMO.budget}
                  track={hexAlpha(P.silver, 0.22)}
                  fill={P.silver}
                  sheen={P.silverHi}
                  height={8}
                  replay={replay}
                  delay={settleDelay(1)}
                  style={{ marginTop: SPACE.xxl }}
                />
                <View style={styles.budgetRow}>
                  <View>
                    <Type role="footnote" color={P.onEspressoDim}>
                      {t('bizStats.remaining')}
                    </Type>
                    <CountUp
                      value={left}
                      format={formatCurrency}
                      role="title"
                      color={P.silver}
                      replay={replay}
                      delay={settleDelay(1)}
                      style={{ marginTop: 2 }}
                    />
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Type role="footnote" color={P.onEspressoDim}>
                      {t('tabs.budget')}
                    </Type>
                    {/* Labels share a line; the 2 + (28 − 20) puts this figure's
                        foot on the silver figure's foot across the card. */}
                    <Type role="callout" color={P.onEspressoDim} style={{ marginTop: 10, fontVariant: ['tabular-nums'] }}>
                      {formatCurrency(DEMO.budget)}
                    </Type>
                  </View>
                </View>
              </View>
            </Press>
          </View>
        </Settle>

        {/* Two shortcuts the tab bar does not already give */}
        <Settle index={2} replay={replay} style={styles.quickRow}>
          {quickActions().map((q) => {
            const card = lift(P, ELEVATION.rest, P.surface, RADIUS.control);
            return (
              <Press key={q.key} accessibilityLabel={q.label} style={[card.outer, { flex: 1 }]}>
                {/* Glyph above label: a beside-it layout broke "Subscriptions"
                    mid-word at half the screen's width, and French and Arabic
                    labels run longer still. */}
                <View style={[card.inner, styles.quickInner]}>
                  <View style={[styles.quickGlyph, { backgroundColor: P.silverSoft }]}>
                    <Glyph name={q.glyph} size={GLYPH.sizes.row} color={P.ink} />
                  </View>
                  <Type role="callout" color={P.ink} numberOfLines={2} style={{ marginTop: SPACE.md }}>
                    {q.label}
                  </Type>
                </View>
              </Press>
            );
          })}
        </Settle>

        {/* One insight, with the check that draws itself */}
        <Settle index={3} replay={replay} style={{ marginTop: SPACE.section, paddingHorizontal: SPACE.gutter }}>
          <Surface P={P} contentStyle={{ padding: SPACE.xl }}>
            <View style={{ flexDirection: 'row', gap: SPACE.md }}>
              <View style={{ paddingTop: 1 }}>
                <DrawCheck P={P} size={GLYPH.sizes.row} replay={replay} delay={checkDelay} />
              </View>
              <Type role="body" color={P.ink} style={{ flex: 1 }}>
                {t('home.insight.saving', { amount: formatCurrency(DEMO.saving) })}
              </Type>
            </View>
            <View style={{ flexDirection: 'row', marginTop: SPACE.lg, marginStart: GLYPH.sizes.row + SPACE.md }}>
              <Press
                style={[styles.chip, { backgroundColor: P.tintSoft }]}
                // 36 tall to sit quietly in the card; the slop makes the target 44.
                hitSlop={{ top: (MIN_TARGET - 36) / 2, bottom: (MIN_TARGET - 36) / 2 }}
                accessibilityLabel={t('home.action.seeSpending')}
              >
                <Type role="callout" color={P.tint}>
                  {t('home.action.seeSpending')}
                </Type>
              </Press>
            </View>
          </Surface>
        </Settle>

        {/* Recent activity */}
        <Settle index={4} replay={replay} style={{ marginTop: SPACE.section, paddingHorizontal: SPACE.gutter }}>
          <View style={styles.sectionHeader}>
            <Type role="headline" color={P.ink}>
              {t('home.recent')}
            </Type>
            <Press haptic={false} style={styles.seeAll} accessibilityLabel={t('home.seeAll')}>
              <Type role="callout" color={P.tint}>
                {t('home.seeAll')}
              </Type>
              <Glyph name="chevronRight" size={GLYPH.sizes.inline} color={P.tint} />
            </Press>
          </View>
          <Surface P={P} style={{ marginTop: SPACE.md }} contentStyle={{ paddingVertical: SPACE.xs }}>
            {DEMO.recent.map((tx, i) => (
              <Row key={tx.id} P={P} tx={tx} first={i === 0} />
            ))}
          </Surface>
        </Settle>
      </ScrollView>

      {/* The status bar's backdrop. Invisible at rest (it is the ground); once
          content scrolls under the clock, the material keeps the time legible. */}
      <View pointerEvents="none" style={[styles.statusScrim, { height: insets.top }]}>
        <BlurView intensity={40} tint={BAR_BLUR[P.scheme]} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: hexAlpha(P.ground, 0.86) }]} />
      </View>

      <TabBar P={P} active={tab} onSelect={setTab} bottom={insets.bottom} />
    </View>
  );
}

function Row({
  P,
  tx,
  first,
}: {
  P: IdentityPalette;
  tx: DemoTransaction;
  first: boolean;
}) {
  const income = tx.amount > 0;
  const money = formatCurrency(Math.abs(tx.amount));
  const when = format(subDays(new Date(), tx.daysAgo), 'd MMM', { locale: getDateFnsLocale() });
  return (
    <Press haptic={false} style={styles.row} accessibilityLabel={`${tx.note}, ${income ? '+' : '−'}${money}`}>
      <View style={[styles.rowTile, { backgroundColor: P.sunk }]}>
        <Glyph name={tx.glyph} size={GLYPH.sizes.row} color={P.inkSoft} />
      </View>
      <View
        style={[
          styles.rowBody,
          first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.hairline },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Type role="body" color={P.ink} numberOfLines={1}>
            {tx.note}
          </Type>
          <Type role="footnote" color={P.inkDim} numberOfLines={1}>
            {`${categoryLabel(tx.category)} · ${when}`}
          </Type>
        </View>
        {/* Green in, red out: the convention kept on purpose. The sign carries
            it too, so colour is never the only signal. */}
        <Type
          role="body"
          color={income ? P.positive : P.negative}
          style={{ fontWeight: '500', fontVariant: ['tabular-nums'] }}
        >
          {`${income ? '+' : '−'}${money}`}
        </Type>
      </View>
    </Press>
  );
}

/**
 * A static stand-in for the tab bar in the new identity, so the sample is seen
 * whole. The real bar (LiquidTabBar.tsx) is converted in 2b. Glyphs only, as
 * the bar is today; the active section wears the tint on a soft wash.
 */
function TabBar({
  P,
  active,
  onSelect,
  bottom,
}: {
  P: IdentityPalette;
  active: string;
  onSelect: (key: string) => void;
  bottom: number;
}) {
  return (
    // Glass has no fill to cast from, so each shadow layer is its own rounded
    // frame around the clip: ambient on the bar, contact on the frame inside.
    <View
      style={[styles.bar, { bottom: Math.max(bottom - SPACE.sm, SPACE.sm) }, shadow(P, ELEVATION.raised[1])]}
      accessibilityRole="tablist"
    >
      <View style={[StyleSheet.absoluteFill, styles.barFrame, shadow(P, ELEVATION.raised[0])]}>
        <View style={[StyleSheet.absoluteFill, styles.barClip, { borderColor: P.silverEdge }]}>
          <BlurView intensity={60} tint={BAR_BLUR[P.scheme]} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: hexAlpha(P.barTint, BAR_TINT_ALPHA[P.scheme]) }]} />
        </View>
      </View>
      {tabs().map((tab) => {
        const on = tab.key === active;
        return (
          <Press
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: on }}
            style={[styles.barItem, on ? { backgroundColor: P.tintSoft } : null]}
          >
            <Glyph name={tab.glyph} size={GLYPH.sizes.nav} color={on ? P.tint : P.inkDim} />
          </Press>
        );
      })}
    </View>
  );
}

/** 6-digit hex plus an alpha byte, the form the tokens promise to stay compatible with. */
function hexAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.lg,
    paddingHorizontal: SPACE.gutter,
  },
  circleAction: {
    width: MIN_TARGET + 4,
    height: MIN_TARGET + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchorInner: {
    padding: SPACE.xxl,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: SPACE.lg,
  },
  quickRow: {
    flexDirection: 'row',
    gap: SPACE.md,
    marginTop: SPACE.xl,
    paddingHorizontal: SPACE.gutter,
  },
  quickInner: {
    padding: SPACE.lg,
  },
  quickGlyph: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.tile,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.pill,
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: MIN_TARGET,
    paddingStart: SPACE.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingStart: SPACE.lg,
  },
  rowTile: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.tile,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    marginStart: SPACE.md,
    paddingEnd: SPACE.lg,
    paddingVertical: SPACE.md + 2,
  },
  statusScrim: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
  },
  bar: {
    position: 'absolute',
    start: SPACE.gutter,
    end: SPACE.gutter,
    height: BAR_HEIGHT,
    borderRadius: RADIUS.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.sm,
  },
  barFrame: {
    borderRadius: RADIUS.pill,
  },
  barClip: {
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    borderWidth: 1,
  },
  barItem: {
    width: 56,
    height: 48,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
