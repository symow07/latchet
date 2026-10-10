import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Check, Copy, Inbox, KeyRound, Mail } from '@/components/icons';
import { format, parseISO } from 'date-fns';

import {
  getEmailStatus,
  getInbox,
  getInboxAddress,
  importInboxSubscriptions,
  type EmailStatus,
  type InboxItem,
} from '@/lib/emailSubscriptionApi';
import { formatCurrency } from '@/lib/calculations';
import { R, S, useC } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  Card,
  Empty,
  IconTile,
  InfoRow,
  PrimaryButton,
  Screen,
  SectionHeader,
  SubHeader,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

/** The four setup instructions. They used to be a `const STEPS` array of
 *  English sentences — the longest untranslated strings in the app, on a
 *  screen whose whole job is walking someone through a setup. */
const STEP_KEYS = [
  'emailInbox.step1',
  'emailInbox.step2',
  'emailInbox.step3',
  'emailInbox.step4',
] as const;

/**
 * Email forwarding — DESIGN-PROMPT.md board §31.
 *
 * Three tinted-glass card styles became white cards on bone: the address is a
 * sunk well with one copy button beside it, the Gmail confirmation code is a
 * feature row, and the detected invoices are ordinary rows with amounts set
 * by the shared formatter — they were `$${n.toFixed(2)}`, so a euro receipt
 * was labelled in dollars.
 */
export default function EmailInboxScreen() {
  const C = useC();
  const router = useRouter();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: status } = useQuery<EmailStatus>({
    queryKey: ['email-status'],
    queryFn: getEmailStatus,
    retry: false,
  });
  const configured = !!status?.inboxConfigured;

  const { data: addr } = useQuery({
    queryKey: ['inbox-address'],
    queryFn: getInboxAddress,
    enabled: configured,
    retry: false,
  });
  const { data: inbox = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['email-inbox'],
    queryFn: getInbox,
    enabled: configured,
    retry: false,
  });

  const confirmation = inbox.find((i) => i.status === 'confirmation' && i.merchant);
  const invoices = inbox.filter((i) => i.isSubscription && i.status === 'parsed');

  const importMut = useMutation({
    mutationFn: () => importInboxSubscriptions(invoices),
    onSuccess: async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await qc.invalidateQueries({ queryKey: ['subscriptions'] });
      await qc.invalidateQueries({ queryKey: ['email-status'] });
      await qc.invalidateQueries({ queryKey: ['email-inbox'] });
      await qc.invalidateQueries({ queryKey: ['email-detected-biz'] });
    },
  });

  async function copyAddress() {
    if (!addr?.address) return;
    await Clipboard.setStringAsync(addr.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const invoiceMeta = (item: InboxItem) =>
    [
      item.cadence !== 'unknown' ? t(`frequency.${item.cadence}`) : null,
      item.chargedISO
        ? format(parseISO(item.chargedISO), 'd MMM', { locale: getDateFnsLocale() })
        : t('emailInbox.recent'),
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.accent} />
        }
      >
        <SubHeader pal={C} title={t('emailInbox.title')} onBack={() => router.back()} />

        <Type role="body" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
          {t('emailInbox.forwardIntro')}
        </Type>

        {!configured ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
            <Card pal={C}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <IconTile pal={C}>
                  <Mail size={19} color={C.accent} strokeWidth={S.stroke} />
                </IconTile>
                <View style={{ flex: 1 }}>
                  <Type role="cardTitle" color={C.ink}>
                    {t('emailInbox.notOn')}
                  </Type>
                  <Type role="body" color={C.inkDim} style={{ marginTop: 4 }}>
                    {t('emailInbox.notEnabled')}
                  </Type>
                </View>
              </View>
            </Card>
          </View>
        ) : (
          <>
            {/* The address, and the one thing you do with it. */}
            <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
              <Card pal={C}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                  }}
                >
                  <Type role="meta" color={C.inkDim}>
                    {t('emailInbox.yourAddress')}
                  </Type>
                  <Type role="meta" color={addr?.verified ? C.positive : C.inkDim}>
                    {addr?.verified ? t('emailInbox.active') : t('misc2.awaitingEmail')}
                  </Type>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      flex: 1,
                      minHeight: 52,
                      justifyContent: 'center',
                      paddingHorizontal: 14,
                      borderRadius: R.sm,
                      backgroundColor: C.groundSunk,
                    }}
                  >
                    <Type role="cardTitle" color={C.ink} numberOfLines={1}>
                      {addr?.address ?? '…'}
                    </Type>
                  </View>
                  <PressableScale
                    onPress={copyAddress}
                    haptic="light"
                    accessibilityRole="button"
                    accessibilityLabel={t('emailInbox.yourAddress')}
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: R.sm,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: copied ? C.accentSoft : C.groundSunk,
                    }}
                  >
                    {copied ? (
                      <Check size={19} color={C.accent} strokeWidth={2.4} />
                    ) : (
                      <Copy size={19} color={C.inkDim} strokeWidth={S.stroke} />
                    )}
                  </PressableScale>
                </View>
              </Card>
            </View>

            {confirmation ? (
              <View style={{ paddingHorizontal: S.screen, marginTop: 12 }}>
                <Card pal={C}>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <IconTile pal={C}>
                      <KeyRound size={19} color={C.accent} strokeWidth={S.stroke} />
                    </IconTile>
                    <View style={{ flex: 1 }}>
                      <Type role="cardTitle" color={C.ink}>
                        {t('emailInbox.confirmGmail')}
                      </Type>
                      <Type role="meta" color={C.inkDim} style={{ marginTop: 2 }}>
                        {t('emailInbox.enterCode')}
                      </Type>
                      <Type
                        role="section"
                        color={C.ink}
                        style={{ marginTop: 8, letterSpacing: 3, fontVariant: ['tabular-nums'] }}
                      >
                        {confirmation.merchant}
                      </Type>
                    </View>
                  </View>
                </Card>
              </View>
            ) : null}

            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('emailInbox.detected')} />
              {invoices.length > 0 ? (
                <Type
                  role="meta"
                  color={C.inkDim}
                  style={{ paddingHorizontal: S.screen, marginTop: -6, marginBottom: 12 }}
                >
                  {t('emailInbox.newCount', { count: invoices.length })}
                </Type>
              ) : null}

              {isLoading ? (
                <ActivityIndicator color={C.accent} style={{ paddingVertical: 30 }} />
              ) : invoices.length === 0 ? (
                <Empty
                  pal={C}
                  icon={<Inbox size={26} color={C.accent} strokeWidth={S.stroke} />}
                  title={t('emailInbox.none')}
                  body={t('emailInbox.forwardHint')}
                  style={{ marginTop: 12 }}
                />
              ) : (
                <View style={{ paddingHorizontal: S.screen }}>
                  <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                    {invoices.map((item: InboxItem, i) => (
                      <View
                        key={item.id}
                        style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                      >
                        <InfoRow
                          pal={C}
                          title={
                            item.merchant ||
                            item.label ||
                            item.senderDomain ||
                            t('emailInbox.unrecognised')
                          }
                          meta={invoiceMeta(item)}
                          amount={item.amount ?? undefined}
                          format={formatCurrency}
                          lead={
                            <IconTile pal={C} size={40}>
                              <Mail size={18} color={C.accent} strokeWidth={S.stroke} />
                            </IconTile>
                          }
                        />
                      </View>
                    ))}
                  </Card>

                  <PrimaryButton
                    pal={C}
                    label={
                      importMut.isPending
                        ? t('emailInbox.adding')
                        : t('emailInbox.addCount', { count: invoices.length })
                    }
                    onPress={() => importMut.mutate()}
                    disabled={importMut.isPending}
                    style={{ marginTop: 16 }}
                  />
                </View>
              )}
            </View>

            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('emailInbox.setup')} />
              <View style={{ paddingHorizontal: S.screen }}>
                <Card pal={C}>
                  <View style={{ gap: 16 }}>
                    {STEP_KEYS.map((key, i) => (
                      <View key={key} style={{ flexDirection: 'row', gap: 12 }}>
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            backgroundColor: C.groundSunk,
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: 1,
                          }}
                        >
                          <Type role="meta" color={C.inkDim}>
                            {i + 1}
                          </Type>
                        </View>
                        <Type role="body" color={C.ink} style={{ flex: 1 }}>
                          {t(key)}
                        </Type>
                      </View>
                    ))}
                  </View>
                </Card>
                <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
                  {t('emailInbox.otherApps')}
                </Type>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
