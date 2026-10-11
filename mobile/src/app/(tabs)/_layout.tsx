import React from 'react';
import { useLocaleStore } from '@/lib/i18n/locale-store';
import { t } from '@/lib/i18n/core';
import { Tabs } from 'expo-router';
import { useClientOnlyValue } from '@/lib/useClientOnlyValue';
import { TabIcons } from '@/components/icons';
import { LiquidTabBar, type LiquidTab } from '@/components/LiquidTabBar';
import { useC } from '@/lib/design';

/**
 * The tab bar.
 *
 * Drawn by LiquidTabBar rather than by React Navigation — see that file for the
 * mechanics and lib/tab-bar.ts for the geometry.
 *
 * This supersedes four earlier bars, and the reasons each was replaced were
 * different every time:
 *
 *   flat full-width   §1.11's original — a strip of the page, not an object
 *   ink pill          right geometry, neutral fill, thin glyphs, floating high
 *   gradient pill     right colour and weight, but the state change was inert
 *   liquid meniscus   alive, and a great deal of machinery for a bead that
 *                     protruded further than anyone wanted
 *
 * The current bar is clear glass with a capsule sliding behind the selected
 * tab, in the identity's palette. Glyphs are outlines, never filled: each
 * tab's `Fill` and `Line` are the same outline now, and the capsule (not a
 * filled glyph) marks the selection. The two slots stay so LiquidTab's shape
 * does not change.
 *
 * `Add` keeps its route and sits on the bar as a plain destination.
 */

export default function TabLayout() {
  // React Navigation caches a screen's `options`, so the remount the locale
  // change triggers higher up does not reach these titles — the tab bar kept
  // the language the app started in. Keying the navigator forces it.
  const localeVersion = useLocaleStore((s) => s.version);
  const C = useC();

  // Built here, not at module scope. `t()` resolves against whatever locale is
  // loaded when it runs, so a table built at import time freezes the labels in
  // the language the app launched in — which is the whole reason the navigator
  // is keyed on `localeVersion` below.
  const tabs: Record<string, LiquidTab> = React.useMemo(
    () => ({
      index: { label: t('tabs.home'), Fill: TabIcons.home.fill, Line: TabIcons.home.line },
      transactions: {
        label: t('tabs.activity'),
        Fill: TabIcons.records.fill,
        Line: TabIcons.records.line,
      },
      add: { label: t('tabs.add'), Fill: TabIcons.add.fill, Line: TabIcons.add.line },
      insights: {
        label: t('tabs.insights'),
        Fill: TabIcons.insights.fill,
        Line: TabIcons.insights.line,
      },
      settings: {
        label: t('tabs.settings'),
        Fill: TabIcons.settings.fill,
        Line: TabIcons.settings.line,
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localeVersion]
  );

  return (
    <Tabs
      key={localeVersion}
      tabBar={(props) => <LiquidTabBar {...props} pal={C} tabs={tabs} />}
      screenOptions={{ headerShown: useClientOnlyValue(false, true) }}>
      <Tabs.Screen name="index" options={{ headerShown: false }} />
      <Tabs.Screen name="transactions" options={{ headerShown: false }} />
      <Tabs.Screen name="add" options={{ headerShown: false }} />
      <Tabs.Screen name="insights" options={{ headerShown: false }} />
      <Tabs.Screen name="settings" options={{ headerShown: false }} />

      {/* Ask keeps its route — §8 still lists it as a core screen (#16) — but
          it stays off the bar. Home reaches it from the insight card, which is
          where a question about your money actually occurs to you. */}
      <Tabs.Screen name="advisor" options={{ href: null }} />
    </Tabs>
  );
}
