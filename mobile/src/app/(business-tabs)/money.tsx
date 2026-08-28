import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Txt, BizBackground } from '@/components/ui';
import { useB } from '@/lib/design';
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
 * The two screens render themselves; this supplies the background, the
 * heading and the switch, and passes `embedded` so they do not draw their own.
 */
/** Module scope — a component declared in a render body remounts every time. */
function Segment({ active, label, onPress }: {
  active: boolean; label: string; onPress: () => void;
}) {
  const B = useB();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 9,
        borderRadius: 11,
        alignItems: 'center',
        backgroundColor: active ? `${B.accent}22` : 'transparent',
        borderWidth: 1.5,
        borderColor: active ? `${B.accent}44` : 'transparent',
      }}
    >
      <Txt weight="bold" size={13} color={active ? B.accent : B.textFaint}>{label}</Txt>
    </Pressable>
  );
}

export default function MoneyTab() {
  const B = useB();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'payroll' | 'budget'>('payroll');

  return (
    <BizBackground style={{ paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 }}>
        <Txt weight="bold" size={25} color={B.text} style={{ marginTop: 2, marginBottom: 14 }}>
          {t('tabs.money')}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Segment
            active={tab === 'payroll'}
            label={t('businessPayroll.title')}
            onPress={() => { Haptics.selectionAsync(); setTab('payroll'); }}
          />
          <Segment
            active={tab === 'budget'}
            label={t('businessInsights.budget')}
            onPress={() => { Haptics.selectionAsync(); setTab('budget'); }}
          />
        </View>
      </View>

      {/* Both are mounted-on-demand rather than kept alive: each runs its own
          queries, and holding the hidden one resident meant two sets of
          refetches for a view nobody was looking at. */}
      {tab === 'payroll' ? <PayrollScreen embedded /> : <BudgetScreen embedded />}
    </BizBackground>
  );
}
