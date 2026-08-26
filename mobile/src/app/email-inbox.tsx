import { View, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ArrowLeft, Copy, Check, Mail, Inbox, KeyRound, ShieldCheck } from 'lucide-react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { format, parseISO } from 'date-fns';

import {
  getEmailStatus, getInboxAddress, getInbox, importInboxSubscriptions,
  type EmailStatus, type InboxItem,
} from '@/lib/emailSubscriptionApi';
import { R, useC } from '@/lib/design';
import { Txt, GlassCard, IconBubble, Pill, BubbleButton, ScreenBackground } from '@/components/ui';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

const STEPS = [
  'Copy your private Budget address above.',
  'In Gmail (web): Settings → "See all settings" → Forwarding and POP/IMAP → "Add a forwarding address" → paste it → Next.',
  'Gmail sends a confirmation — the code appears on this screen. Type that code back into Gmail to confirm.',
  'Create a filter: in Gmail search, open filter options, set "Has the words" to receipt OR invoice OR subscription OR renewal, then "Forward it to" your Budget address.',
];

export default function EmailInboxScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data: status } = useQuery<EmailStatus>({ queryKey: ['email-status'], queryFn: getEmailStatus, retry: false });
  const configured = !!status?.inboxConfigured;

  const { data: addr } = useQuery({ queryKey: ['inbox-address'], queryFn: getInboxAddress, enabled: configured, retry: false });
  const { data: inbox = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['email-inbox'], queryFn: getInbox, enabled: configured, retry: false,
  });

  const confirmation = inbox.find((i) => i.status === 'confirmation' && i.merchant);
  const invoices = inbox.filter((i) => i.isSubscription && i.status === 'parsed');

  const importMut = useMutation({
    mutationFn: () => importInboxSubscriptions(invoices),
    onSuccess: async (saved) => {
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ScreenBackground>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.p400} />}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 20 }}>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14, alignSelf: 'flex-start' })}>
            <ArrowLeft size={18} color={C.p400} />
            <Txt weight="semibold" size={14} color={C.p400}>{t('common.back')}</Txt>
          </Pressable>
          <Txt weight="bold" size={28} color={C.text}>{t('emailInbox.title')}</Txt>
          <Txt weight="medium" size={13} color={C.textDim} style={{ marginTop: 2 }}>
            {t('emailInbox.forwardIntro')}
          </Txt>
        </View>

        {!configured ? (
          <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
            <GlassCard tint={`${C.amber}14`} border={`${C.amber}33`}>
              <View className="flex-row items-start" style={{ gap: 12 }}>
                <IconBubble color={C.amber}><Mail size={20} color={C.amber} /></IconBubble>
                <View className="flex-1">
                  <Txt weight="bold" size={15} color={C.text}>{t('emailInbox.notOn')}</Txt>
                  <Txt size={13} color={C.textDim} style={{ marginTop: 3, lineHeight: 19 }}>
                    {t('emailInbox.notEnabled')}
                  </Txt>
                </View>
              </View>
            </GlassCard>
          </View>
        ) : (
          <>
            {/* Address card */}
            <Animated.View entering={FadeInUp.delay(40).springify().damping(16)} style={{ paddingHorizontal: 20, marginTop: 18 }}>
              <GlassCard tint={`${C.p500}14`} border={`${C.p500}2e`}>
                <View className="flex-row items-center justify-between mb-3">
                  <Txt weight="semibold" size={12} color={C.p300}>{t('emailInbox.yourAddress')}</Txt>
                  {addr?.verified
                    ? <View className="flex-row items-center" style={{ gap: 4 }}><ShieldCheck size={13} color={C.green} /><Txt weight="bold" size={11} color={C.green}>{t('emailInbox.active')}</Txt></View>
                    : <Pill label={t('misc2.awaitingEmail')} color={C.amber} />}
                </View>
                <View className="flex-row items-center" style={{ gap: 10 }}>
                  <View style={{ flex: 1, backgroundColor: C.glass, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: C.glassBorder }}>
                    <Txt weight="semibold" size={14} color={C.text} numberOfLines={1}>{addr?.address ?? '…'}</Txt>
                  </View>
                  <Pressable onPress={copyAddress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, width: 48, height: 48, borderRadius: R.md, backgroundColor: copied ? `${C.green}26` : `${C.p500}26`, borderWidth: 1, borderColor: copied ? `${C.green}55` : `${C.p500}55`, alignItems: 'center', justifyContent: 'center' })}>
                    {copied ? <Check size={18} color={C.green} /> : <Copy size={18} color={C.p400} />}
                  </Pressable>
                </View>
              </GlassCard>
            </Animated.View>

            {/* Gmail confirmation code */}
            {confirmation && (
              <Animated.View entering={FadeInUp.delay(60).springify().damping(16)} style={{ paddingHorizontal: 20, marginTop: 14 }}>
                <GlassCard tint={`${C.amber}16`} border={`${C.amber}3a`}>
                  <View className="flex-row items-center" style={{ gap: 12 }}>
                    <IconBubble color={C.amber}><KeyRound size={20} color={C.amber} /></IconBubble>
                    <View className="flex-1">
                      <Txt weight="bold" size={14} color={C.text}>{t('emailInbox.confirmGmail')}</Txt>
                      <Txt size={12} color={C.textDim} style={{ marginTop: 2 }}>{t('emailInbox.enterCode')}</Txt>
                      <Txt weight="bold" size={22} color={C.amber} style={{ marginTop: 4, letterSpacing: 2 }}>{confirmation.merchant}</Txt>
                    </View>
                  </View>
                </GlassCard>
              </Animated.View>
            )}

            {/* Detected invoices */}
            <View style={{ paddingHorizontal: 20, marginTop: 18 }}>
              <View className="flex-row items-center justify-between mb-3">
                <Txt weight="bold" size={12} color={C.textFaint} style={{ letterSpacing: 1 }}>{t('emailInbox.detected')}</Txt>
                {invoices.length > 0 && <Pill label={`${invoices.length} new`} color={C.p400} />}
              </View>

              {isLoading ? (
                <ActivityIndicator color={C.p400} style={{ paddingVertical: 30 }} />
              ) : invoices.length === 0 ? (
                <GlassCard style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <Inbox size={30} color={C.textFaint} />
                  <Txt weight="semibold" size={14} color={C.textDim} style={{ marginTop: 10 }}>{t('emailInbox.none')}</Txt>
                  <Txt size={12} color={C.textFaint} style={{ textAlign: 'center', marginTop: 3 }}>
                    {t('emailInbox.forwardHint')}
                  </Txt>
                </GlassCard>
              ) : (
                <View style={{ gap: 10 }}>
                  {invoices.map((item: InboxItem) => (
                    <GlassCard key={item.id} padding={14}>
                      <View className="flex-row items-center">
                        <IconBubble color={C.p500} size={42}><Mail size={19} color={C.p400} /></IconBubble>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Txt weight="bold" size={15} color={C.text} numberOfLines={1}>
                            {item.merchant || item.label || item.senderDomain || 'Unrecognised email'}
                          </Txt>
                          <Txt size={12} color={C.textFaint} numberOfLines={1} style={{ marginTop: 1 }}>
                            {item.cadence !== 'unknown' ? `${item.cadence} · ` : ''}{item.chargedISO ? format(parseISO(item.chargedISO), 'MMM d', { locale: getDateFnsLocale() }) : 'recent'}
                          </Txt>
                        </View>
                        {item.amount ? <Txt weight="bold" size={16} color={C.text}>${item.amount.toFixed(2)}</Txt> : null}
                      </View>
                    </GlassCard>
                  ))}
                </View>
              )}

              {invoices.length > 0 && (
                <View style={{ marginTop: 14 }}>
                  <BubbleButton
                    label={importMut.isPending ? t('emailInbox.adding') : t('emailInbox.addCount', { count: invoices.length })}
                    onPress={() => importMut.mutate()}
                    disabled={importMut.isPending}
                  />
                </View>
              )}
            </View>

            {/* Setup steps */}
            <View style={{ paddingHorizontal: 20, marginTop: 22 }}>
              <Txt weight="bold" size={12} color={C.textFaint} style={{ letterSpacing: 1, marginBottom: 12 }}>{t('emailInbox.setup')}</Txt>
              <GlassCard>
                {STEPS.map((step, i) => (
                  <View key={i} className="flex-row" style={{ gap: 12, marginBottom: i < STEPS.length - 1 ? 16 : 0 }}>
                    <View style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: `${C.p500}26`, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt weight="bold" size={12} color={C.p400}>{i + 1}</Txt>
                    </View>
                    <Txt size={13} color={C.textDim} style={{ flex: 1, lineHeight: 19 }}>{step}</Txt>
                  </View>
                ))}
              </GlassCard>
              <Txt size={11} color={C.textFaint} style={{ marginTop: 10, lineHeight: 16 }}>
                {t('emailInbox.otherApps')}
              </Txt>
            </View>
          </>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}
