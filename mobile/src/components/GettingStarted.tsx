import { useCallback } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Building2, Check, ChevronRight, Mail, Target, Upload } from '@/components/icons';
import { Card, IconTile, Touchable, Type, mirror } from '@/components/kit';
import { S, useC } from '@/lib/design';
import { getSettings } from '@/lib/db';
import { t } from '@/lib/i18n/core';
import { EMAIL_CONNECTIONS_QUERY_KEY, getEmailConnections } from '@/lib/email-connections';
import { bankLinkAvailability, deviceRegion, getBankLinkConfig, getLinkedBanks } from '@/lib/bank-linking';
import { dismissGettingStarted, getOnboardingData, hasImportedStatement } from '@/lib/onboarding-storage';
import {
  BANK_AVAILABILITY_QUERY_KEY,
  LINKED_BANKS_QUERY_KEY,
  ONBOARDING_QUERY_KEY,
  STATEMENT_IMPORTED_QUERY_KEY,
  gettingStartedModel,
  type ChecklistItemId,
} from '@/lib/getting-started';

const ICONS: Record<ChecklistItemId, typeof Mail> = {
  email: Mail,
  statement: Upload,
  bank: Building2,
  goal: Target,
};

function titleOf(id: ChecklistItemId): string {
  switch (id) {
    case 'email':
      return t('onboardingFlow.checklist.email');
    case 'statement':
      return t('onboardingFlow.checklist.statement');
    case 'bank':
      return t('onboardingFlow.checklist.bank');
    case 'goal':
      return t('onboardingFlow.checklist.goal');
  }
}

function bodyOf(id: ChecklistItemId): string {
  switch (id) {
    case 'email':
      return t('onboardingFlow.checklist.emailBody');
    case 'statement':
      return t('onboardingFlow.checklist.statementBody');
    case 'bank':
      return t('onboardingFlow.checklist.bankBody');
    case 'goal':
      return t('onboardingFlow.checklist.goalBody');
  }
}

/**
 * Home's getting-started checklist (lib/getting-started.ts): what onboarding's
 * Connect your data left undone, and a savings goal. Each row opens the place
 * that does it and ticks itself off — the tick and the word, never colour
 * alone. "Hide" puts it away for good; once every row is done it goes by
 * itself. Nothing at all is drawn for an account the list is not for.
 *
 * A lifted card on the page, under the quick actions: the balance above it
 * stays the screen's one espresso block.
 */
export function GettingStarted({ style }: { style?: StyleProp<ViewStyle> }) {
  const C = useC();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: record } = useQuery({ queryKey: ONBOARDING_QUERY_KEY, queryFn: getOnboardingData });
  const skipped = record?.completed && !record.checklistDismissed ? (record.skippedSources ?? null) : null;
  const wants = (id: 'email' | 'statement' | 'bank') => !!skipped?.includes(id);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings, enabled: skipped !== null });
  const { data: email } = useQuery({
    queryKey: EMAIL_CONNECTIONS_QUERY_KEY,
    queryFn: getEmailConnections,
    enabled: wants('email'),
    retry: 1,
  });
  const { data: statementImported = false } = useQuery({
    queryKey: STATEMENT_IMPORTED_QUERY_KEY,
    queryFn: hasImportedStatement,
    enabled: wants('statement'),
  });
  const { data: banks = [] } = useQuery({
    queryKey: LINKED_BANKS_QUERY_KEY,
    queryFn: getLinkedBanks,
    enabled: wants('bank'),
  });
  const { data: availability } = useQuery({
    queryKey: BANK_AVAILABILITY_QUERY_KEY,
    queryFn: async () => bankLinkAvailability(await deviceRegion(), await getBankLinkConfig()),
    enabled: wants('bank'),
    staleTime: 10 * 60_000,
  });

  // Back from a row's screen: what it did should tick at once.
  useFocusEffect(
    useCallback(() => {
      for (const key of [ONBOARDING_QUERY_KEY, STATEMENT_IMPORTED_QUERY_KEY, LINKED_BANKS_QUERY_KEY, EMAIL_CONNECTIONS_QUERY_KEY]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    }, [qc]),
  );

  const model = gettingStartedModel({
    onboarding: record
      ? { completed: record.completed, skipped: record.skippedSources, dismissed: !!record.checklistDismissed }
      : null,
    done: {
      email: (email?.connections.length ?? 0) > 0,
      statement: statementImported,
      bank: banks.length > 0,
      goal: (settings?.savingsGoal ?? 0) > 0,
    },
    // Unknown (offline) keeps the row it was offered with; only a region the
    // server says it does not serve, or no bank provider at all, drops it.
    bankAvailable: availability?.state !== 'outside' && availability?.state !== 'not_configured',
  });

  if (!model.visible) return null;

  const hide = () => {
    // Away at once; the write follows.
    qc.setQueryData(ONBOARDING_QUERY_KEY, record ? { ...record, checklistDismissed: true } : record);
    dismissGettingStarted()
      .catch((e) => console.warn('[getting-started] hide not saved', e))
      .finally(() => void qc.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY }));
  };

  return (
    <View style={[{ paddingHorizontal: S.screen }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Type role="cardTitle" color={C.ink}>
            {t('onboardingFlow.checklist.title')}
          </Type>
          <Type role="meta" color={C.inkDim}>
            {t('onboardingFlow.checklist.progress', { done: model.doneCount, total: model.total })}
          </Type>
        </View>
        <Pressable
          onPress={hide}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('onboardingFlow.checklist.hide')}
          style={{ minHeight: 44, justifyContent: 'center', paddingStart: 12 }}
        >
          <Type role="meta" color={C.accent}>
            {t('onboardingFlow.checklist.hide')}
          </Type>
        </Pressable>
      </View>
      <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
        {model.items.map((item, i) => {
          const Icon = ICONS[item.id];
          const title = titleOf(item.id);
          return (
            <View key={item.id} style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}>
              <Touchable
                pal={C}
                onPress={item.done ? undefined : () => router.push(item.route as never)}
                accessibilityLabel={item.done ? `${title}, ${t('onboardingFlow.checklist.done')}` : title}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 10 }}
              >
                <IconTile pal={C}>
                  <Icon size={20} color={item.done ? C.inkFaint : C.accent} strokeWidth={S.stroke} />
                </IconTile>
                <View style={{ flex: 1 }}>
                  <Type role="body" color={item.done ? C.inkDim : C.ink}>
                    {title}
                  </Type>
                  <Type role="meta" color={C.inkDim}>
                    {bodyOf(item.id)}
                  </Type>
                </View>
                {item.done ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Check size={18} color={C.positive} />
                    <Type role="meta" color={C.positive}>
                      {t('onboardingFlow.checklist.done')}
                    </Type>
                  </View>
                ) : (
                  <ChevronRight size={18} color={C.inkFaint} strokeWidth={S.stroke} style={mirror} />
                )}
              </Touchable>
            </View>
          );
        })}
      </Card>
    </View>
  );
}
