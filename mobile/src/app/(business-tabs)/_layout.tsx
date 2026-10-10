import React from 'react';
import { Tabs } from 'expo-router';
import { useLocaleStore } from '@/lib/i18n/locale-store';
import { t } from '@/lib/i18n/core';
import { TabIcons } from '@/components/icons';
import { LiquidTabBar, type LiquidTab } from '@/components/LiquidTabBar';
import { useB } from '@/lib/design';

/**
 * The liquid bar, business side.
 *
 * Identical to the personal one except the palette it is handed, which is the
 * point: one layout system, one component set, differing only in accent. The
 * mechanics are documented there and in lib/tab-bar.ts.
 */

export default function BusinessTabLayout() {
  // React Navigation caches a screen's `options`, so the remount the locale
  // change triggers higher up does not reach these titles — the tab bar kept
  // the language the app started in. Keying the navigator forces it.
  const localeVersion = useLocaleStore((s) => s.version);
  const B = useB();

  // Built here rather than at module scope — see the personal layout for why.
  const tabs: Record<string, LiquidTab> = React.useMemo(
    () => ({
      index: { label: t('tabs.home'), Fill: TabIcons.home.fill, Line: TabIcons.home.line },
      expenses: {
        label: t('tabs.expenses'),
        Fill: TabIcons.records.fill,
        Line: TabIcons.records.line,
      },
      advisor: {
        label: t('tabs.advisor'),
        Fill: TabIcons.advisor.fill,
        Line: TabIcons.advisor.line,
      },
      money: { label: t('tabs.money'), Fill: TabIcons.money.fill, Line: TabIcons.money.line },
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
      tabBar={(props) => <LiquidTabBar {...props} pal={B} tabs={tabs} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="expenses" />
      <Tabs.Screen name="advisor" />
      <Tabs.Screen name="money" />
      <Tabs.Screen name="settings" />

      {/* Still routes, deliberately off the bar. Payroll and Budget are hosted
          by the Money tab, which renders them with `embedded`; keeping them
          registered means a deep link or a stale navigation state still
          resolves instead of 404ing. */}
      <Tabs.Screen name="subscriptions" options={{ href: null }} />
      <Tabs.Screen name="insights" options={{ href: null }} />
    </Tabs>
  );
}
