import { useState } from 'react';
import { View } from 'react-native';
import { Header, Screen, Segmented } from '@/components/kit';
import { S, useB } from '@/lib/design';
import { t } from '@/lib/i18n/core';
import PayrollScreen from './subscriptions';
import BudgetScreen from './insights';

/**
 * Payroll and Budget under one tab.
 *
 * Six tabs was too many to read at a glance, and these two are the pair that
 * belong together: both are money going out on a schedule, both are reviewed
 * monthly rather than daily, and neither is a place you land — you go there
 * deliberately. Merging them costs one tap on the second of the two and buys
 * back a tab.
 *
 * The two screens render themselves; this supplies the ground, the heading and
 * the switch, and passes `embedded` so they do not draw their own.
 */
export default function MoneyTab() {
  const B = useB();
  const [tab, setTab] = useState<'payroll' | 'budget'>('payroll');

  return (
    <Screen pal={B}>
      <Header pal={B} title={t('tabs.money')} style={{ paddingTop: 8 }} />

      {/* §6.5 — the active segment is a solid ink pill that slides between
          positions. It used to be a pale mint fill inside a 1.5px mint border,
          which is the pattern §1.5 rules out and which made the switch compete
          with the numbers underneath it. */}
      <View style={{ paddingHorizontal: S.screen, marginTop: 16, marginBottom: 4 }}>
        <Segmented
          pal={B}
          value={tab}
          onChange={setTab}
          options={[
            { key: 'payroll' as const, label: t('businessPayroll.title') },
            { key: 'budget' as const, label: t('businessInsights.budget') },
          ]}
        />
      </View>

      {/* Both are mounted-on-demand rather than kept alive: each runs its own
          queries, and holding the hidden one resident meant two sets of
          refetches for a view nobody was looking at. */}
      {tab === 'payroll' ? <PayrollScreen embedded /> : <BudgetScreen embedded />}
    </Screen>
  );
}
