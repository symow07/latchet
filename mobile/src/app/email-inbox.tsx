import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Check, Copy, Eye, KeyRound, Lock, Mail, RefreshCw, ShieldCheck } from '@/components/icons';

import { getEmailFindings, getSettings, type LocalEmailFinding } from '@/lib/db';
import {
  EMAIL_CONNECTIONS_QUERY_KEY,
  connectEmailProvider,
  disconnectEmailConnection,
  getEmailConnections,
  getForwardingAddress,
  syncEmailNow,
  type ConnectableProvider,
  type EmailConnectionDTO,
} from '@/lib/email-connections';
import {
  FORWARDING_PROVIDERS,
  accountOwnerName,
  connectOutcome,
  connectionViews,
  disconnectCopy,
  findingRows,
  forwardingProviderName,
  forwardingSteps,
  forwardingView,
  pollInterval,
  progressText,
  providerOptions,
  type ForwardingProvider,
  type Notice,
  type ProviderOption,
} from '@/lib/email-screen';
import { SUBSCRIPTIONS_QUERY_KEY } from '@/lib/subscription-detection';
import { moneyFormatter } from '@/lib/subscription-view';
import { R, S, useC, type Palette } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  Card,
  CircleAction,
  FilterChip,
  IconTile,
  InfoRow,
  PrimaryButton,
  Screen,
  SectionHeader,
  Sheet,
  SubHeader,
  Touchable,
  Type,
} from '@/components/kit';
import { t } from '@/lib/i18n/core';

/**
 * Email receipts: where Budget reads billing email from.
 *
 * Connecting Gmail or Outlook is the main path — a button each, one honest
 * line each on what Budget reads and keeps — and every connection says where
 * it stands: reading its first year (with how many emails it has checked),
 * up to date, needing to be reconnected, or failing; each can be
 * disconnected, behind a confirmation. While Google has not verified Budget,
 * connecting Gmail first explains the warning Google will show; when Gmail's
 * cap is reached the screen says so and points to forwarding. A provider the
 * server cannot connect is not offered.
 *
 * Forwarding is the backup for every other provider (iCloud, Yahoo, GMX…):
 * the private address and a copy button, whether mail has arrived, Gmail's
 * confirmation code when one has come, and short steps per provider.
 * Underneath, what was found lately. The decisions are in lib/email-screen.
 */
const QUERY_FORWARDING = ['email-forwarding'] as const;
const QUERY_FINDINGS = ['email-findings'] as const;

function noticeColor(pal: Palette, n: Notice): string {
  return n.tone === 'error' ? pal.negative : n.tone === 'warning' ? pal.warning : pal.ink;
}

function ReadsLine({ pal, icon, text }: { pal: Palette; icon: React.ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <View style={{ marginTop: 2 }}>{icon}</View>
      <Type role="meta" color={pal.inkDim} style={{ flex: 1 }}>
        {text}
      </Type>
    </View>
  );
}

export default function EmailInboxScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [notice, setNotice] = useState<Notice | null>(null);
  const [connecting, setConnecting] = useState<{ provider: ConnectableProvider; text: string } | null>(null);
  const [explainGmail, setExplainGmail] = useState(false);
  const [confirming, setConfirming] = useState<EmailConnectionDTO | null>(null);
  const [manual, setManual] = useState<{ provider: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [forwardFor, setForwardFor] = useState<ForwardingProvider>('icloud');
  const [refreshing, setRefreshing] = useState(false);

  // A connect outlives nothing: leaving the screen stops waiting for the backfill.
  const signal = useRef<{ aborted: boolean }>({ aborted: false });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      signal.current.aborted = true;
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const connections = useQuery({
    queryKey: EMAIL_CONNECTIONS_QUERY_KEY,
    queryFn: getEmailConnections,
    retry: false,
    refetchInterval: (query) => pollInterval(query.state.data),
  });
  const dto = connections.data;
  const forwardingOn = !!dto?.providers.forwarding.configured;
  const forwarding = useQuery({
    queryKey: QUERY_FORWARDING,
    queryFn: getForwardingAddress,
    enabled: forwardingOn,
    retry: false,
  });
  const { data: findings = [] } = useQuery<LocalEmailFinding[]>({ queryKey: QUERY_FINDINGS, queryFn: getEmailFindings });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const userCurrency = (settings?.currency || 'USD').toUpperCase();

  const now = Date.now();
  const options = providerOptions(dto).filter((o) => o.availability !== 'unavailable');
  const inboxes = connectionViews(dto, now);
  const fwd = forwardingView(dto, forwarding.data);
  const rows = findingRows(findings, userCurrency);
  const hasAnything = (dto?.connections ?? []).length > 0;
  // The one espresso button: the first way in, while nothing is connected.
  const primaryProvider = inboxes.length === 0 ? options.find((o) => o.availability === 'available')?.provider : undefined;

  async function refreshAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: EMAIL_CONNECTIONS_QUERY_KEY }),
      qc.invalidateQueries({ queryKey: QUERY_FINDINGS }),
      qc.invalidateQueries({ queryKey: QUERY_FORWARDING }),
      qc.invalidateQueries({ queryKey: SUBSCRIPTIONS_QUERY_KEY }),
      qc.invalidateQueries({ queryKey: ['email-detected-biz'] }),
    ]);
  }

  async function startConnect(provider: ConnectableProvider) {
    if (connecting) return;
    setNotice(null);
    setExplainGmail(false);
    signal.current = { aborted: false };
    setConnecting({ provider, text: progressText(provider, { phase: 'authorizing', connection: null }) });
    try {
      const result = await connectEmailProvider(provider, {
        signal: signal.current,
        onProgress: (p) => {
          if (mounted.current) setConnecting({ provider, text: progressText(provider, p) });
        },
      });
      if (!mounted.current) return;
      const outcome = connectOutcome(provider, result);
      setNotice(outcome);
      if (result.result === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      if (mounted.current) setConnecting(null);
      await refreshAll();
    }
  }

  function onConnect(option: ProviderOption) {
    if (option.explainFirst) setExplainGmail(true);
    else void startConnect(option.provider);
  }

  const disconnect = useMutation({
    mutationFn: (c: EmailConnectionDTO) => disconnectEmailConnection(c.id).then((r) => ({ r, c })),
    onMutate: () => setNotice(null),
    onSuccess: async ({ r, c }) => {
      setConfirming(null);
      if (!r.revoked && r.manualRevokeUrl) setManual({ provider: accountOwnerName(c.provider), url: r.manualRevokeUrl });
      else setNotice({ tone: 'ok', text: t('emailConnect.disconnect.revoked') });
      await refreshAll();
    },
    onError: () => {
      setConfirming(null);
      setNotice({ tone: 'error', text: t('emailConnect.disconnect.failed') });
    },
  });

  async function syncNow() {
    if (refreshing) return;
    setRefreshing(true);
    setNotice(null);
    try {
      if (hasAnything) {
        const { newFindings } = await syncEmailNow({ watched: true });
        if (mounted.current) setNotice({ tone: 'ok', text: t('emailConnect.sync.result', { count: newFindings }) });
      }
    } catch {
      if (mounted.current) setNotice({ tone: 'warning', text: t('emailConnect.sync.failed') });
    } finally {
      await refreshAll();
      if (mounted.current) setRefreshing(false);
    }
  }

  async function copyAddress() {
    if (!fwd.address) return;
    await Clipboard.setStringAsync(fwd.address);
    setCopied(true);
  }

  async function openUrl(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      setNotice({ tone: 'error', text: t('subsUi.guide.openFailed') });
    }
  }

  const gmailFull = providerOptions(dto).find((o) => o.provider === 'gmail')?.availability === 'cap_reached';
  const confirmCopy = confirming ? disconnectCopy(confirming) : null;

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + S.section }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={syncNow} tintColor={C.accent} />}
      >
        <SubHeader
          pal={C}
          title={t('emailConnect.title')}
          onBack={() => router.back()}
          action={
            hasAnything ? (
              <CircleAction pal={C} label={t('emailConnect.sync.now')} onPress={refreshing ? undefined : syncNow}>
                {refreshing ? (
                  <ActivityIndicator size="small" color={C.ink} />
                ) : (
                  <RefreshCw size={18} color={C.ink} strokeWidth={S.stroke} />
                )}
              </CircleAction>
            ) : undefined
          }
        />

        <Type role="body" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: S.group }}>
          {t('emailConnect.intro')}
        </Type>

        {notice ? (
          <Type role="meta" color={noticeColor(C, notice)} style={{ paddingHorizontal: S.screen, marginTop: S.tight + 4 }}>
            {notice.text}
          </Type>
        ) : null}
        {connections.isError ? (
          <Type role="meta" color={C.warning} style={{ paddingHorizontal: S.screen, marginTop: S.tight + 4 }}>
            {t('emailConnect.loadFailed')}
          </Type>
        ) : null}

        {/* Gmail and Outlook: the main path. */}
        <View style={{ paddingHorizontal: S.screen, marginTop: S.wide, gap: 12 }}>
          {connections.isLoading ? <ActivityIndicator color={C.accent} style={{ paddingVertical: 16 }} /> : null}

          {connecting ? (
            <Card pal={C} contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <ActivityIndicator color={C.accent} />
              <Type role="body" color={C.ink} style={{ flex: 1 }}>
                {connecting.text}
              </Type>
            </Card>
          ) : null}

          {options.map((o) =>
            o.availability === 'cap_reached' ? null : (
              <PrimaryButton
                key={o.provider}
                pal={C}
                label={o.label}
                onPress={() => onConnect(o)}
                variant={o.provider === primaryProvider ? 'ink' : 'secondary'}
                disabled={!!connecting}
              />
            ),
          )}

          {gmailFull ? (
            <Card pal={C}>
              <Type role="cardTitle" color={C.ink}>
                {t('emailConnect.cap.title')}
              </Type>
              <Type role="meta" color={C.inkDim} style={{ marginTop: 4 }}>
                {t('emailConnect.cap.body')}
              </Type>
            </Card>
          ) : null}

          {dto && options.length === 0 ? (
            <Type role="body" color={C.inkDim}>
              {t('emailConnect.noProviders')}
            </Type>
          ) : null}

          {options.length > 0 ? (
            <Card pal={C}>
              <Type role="cardTitle" color={C.ink} style={{ marginBottom: 12 }}>
                {t('emailConnect.reads.title')}
              </Type>
              <View style={{ gap: 10 }}>
                <ReadsLine pal={C} icon={<Eye size={18} color={C.inkDim} strokeWidth={S.stroke} />} text={t('emailConnect.reads.reads')} />
                <ReadsLine pal={C} icon={<Lock size={18} color={C.inkDim} strokeWidth={S.stroke} />} text={t('emailConnect.reads.keeps')} />
                <ReadsLine
                  pal={C}
                  icon={<ShieldCheck size={18} color={C.inkDim} strokeWidth={S.stroke} />}
                  text={t('emailConnect.reads.readOnly')}
                />
              </View>
            </Card>
          ) : null}
        </View>

        {/* Each connected inbox, and where it stands. */}
        {inboxes.length > 0 ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section, gap: 12 }}>
            {inboxes.map((v) => {
              const dtoRow = dto?.connections.find((c) => c.id === v.id);
              return (
                <Card key={v.id} pal={C}>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <IconTile pal={C} size={40}>
                      <Mail size={18} color={C.ink} strokeWidth={S.stroke} />
                    </IconTile>
                    <View style={{ flex: 1 }}>
                      <Type role="cardTitle" color={C.ink} numberOfLines={1}>
                        {v.address || v.providerName}
                      </Type>
                      <Type role="meta" color={C.inkDim}>
                        {v.providerName}
                      </Type>
                    </View>
                    {v.busy ? <ActivityIndicator size="small" color={C.accent} /> : null}
                  </View>
                  <Type role="body" color={v.attention ? C.warning : C.ink} style={{ marginTop: 12 }}>
                    {v.stateText}
                  </Type>
                  {v.detail ? (
                    <Type role="meta" color={C.inkDim} style={{ marginTop: 2 }}>
                      {v.detail}
                    </Type>
                  ) : null}
                  {v.canReconnect ? (
                    <PrimaryButton
                      pal={C}
                      label={t('emailConnect.reconnect')}
                      onPress={() =>
                        v.provider === 'gmail' && dto?.providers.gmail.verified === false ? setExplainGmail(true) : void startConnect(v.provider)
                      }
                      variant="secondary"
                      disabled={!!connecting}
                      style={{ marginTop: S.group }}
                    />
                  ) : null}
                  <Touchable
                    pal={C}
                    bleed={8}
                    onPress={dtoRow ? () => setConfirming(dtoRow) : undefined}
                    accessibilityLabel={t('emailConnect.disconnect.action')}
                    style={{ marginTop: 12, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
                  >
                    <Type role="meta" color={C.negative} style={{ fontSize: 15, lineHeight: 20 }}>
                      {t('emailConnect.disconnect.action')}
                    </Type>
                  </Touchable>
                </Card>
              );
            })}
          </View>
        ) : null}

        {/* Forwarding: the backup for every other provider. Shown once the server has said what it offers. */}
        {dto ? (
          <View style={{ marginTop: S.section }}>
            <SectionHeader pal={C} title={t('emailConnect.forwarding.title')} />
            <Type role="body" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: -4 }}>
              {t('emailConnect.forwarding.body')}
            </Type>

            {!fwd.available ? (
              <Type role="meta" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: S.group }}>
                {t('emailConnect.forwarding.unavailable')}
              </Type>
            ) : (
              <View style={{ paddingHorizontal: S.screen, marginTop: S.group, gap: 12 }}>
                <Card pal={C}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                    <Type role="meta" color={C.inkDim}>
                      {t('emailConnect.forwarding.address')}
                    </Type>
                    <Type role="meta" color={fwd.verified ? C.positive : C.inkDim}>
                      {fwd.stateText}
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
                        borderCurve: 'continuous',
                        backgroundColor: C.groundSunk,
                      }}
                    >
                      {forwarding.isLoading ? (
                        <ActivityIndicator color={C.accent} />
                      ) : (
                        <Type role="body" color={C.ink} numberOfLines={1}>
                          {fwd.address ?? t('emailConnect.forwarding.loadFailed')}
                        </Type>
                      )}
                    </View>
                    <PressableScale
                      onPress={copyAddress}
                      disabled={!fwd.address}
                      haptic="light"
                      accessibilityRole="button"
                      accessibilityLabel={copied ? t('emailConnect.forwarding.copied') : t('emailConnect.forwarding.copy')}
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: R.sm,
                        borderCurve: 'continuous',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: copied ? C.accentSoft : C.groundSunk,
                      }}
                    >
                      {copied ? (
                        <Check size={19} color={C.accent} strokeWidth={S.stroke} />
                      ) : (
                        <Copy size={19} color={C.inkDim} strokeWidth={S.stroke} />
                      )}
                    </PressableScale>
                  </View>
                </Card>

                {fwd.code ? (
                  <Card pal={C}>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <IconTile pal={C}>
                        <KeyRound size={19} color={C.ink} strokeWidth={S.stroke} />
                      </IconTile>
                      <View style={{ flex: 1 }}>
                        <Type role="cardTitle" color={C.ink}>
                          {t('emailConnect.forwarding.code')}
                        </Type>
                        <Type role="meta" color={C.inkDim} style={{ marginTop: 2 }}>
                          {t('emailConnect.forwarding.codeBody')}
                        </Type>
                        <Type role="section" color={C.ink} style={{ marginTop: 8, letterSpacing: 3, fontVariant: ['tabular-nums'] }}>
                          {fwd.code}
                        </Type>
                      </View>
                    </View>
                  </Card>
                ) : null}

                <Type role="meta" color={C.inkDim} style={{ marginTop: 4 }}>
                  {t('emailConnect.forwarding.which')}
                </Type>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
                  {FORWARDING_PROVIDERS.map((p) => (
                    <FilterChip key={p} pal={C} label={forwardingProviderName(p)} active={forwardFor === p} onPress={() => setForwardFor(p)} />
                  ))}
                </ScrollView>
                <Card pal={C}>
                  <View style={{ gap: 12 }}>
                    {forwardingSteps(forwardFor).map((step, i) => (
                      <View key={`${forwardFor}:${i}`} style={{ flexDirection: 'row', gap: 12 }}>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: R.pill,
                            borderCurve: 'continuous',
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
                          {step}
                        </Type>
                      </View>
                    ))}
                  </View>
                </Card>
              </View>
            )}
          </View>
        ) : null}

        {/* What was found lately. */}
        <View style={{ marginTop: S.section }}>
          <SectionHeader pal={C} title={t('emailConnect.findings.title')} />
          {rows.length === 0 ? (
            <Type role="body" color={C.inkDim} style={{ paddingHorizontal: S.screen }}>
              {t('emailConnect.findings.empty')}
            </Type>
          ) : (
            <View style={{ paddingHorizontal: S.screen }}>
              <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                {rows.map((row, i) => (
                  <View key={row.id} style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}>
                    <InfoRow
                      pal={C}
                      title={row.title}
                      meta={row.meta}
                      amount={row.amount ?? undefined}
                      format={moneyFormatter(row.currency)}
                      lead={
                        <IconTile pal={C} size={40}>
                          <Mail size={18} color={C.ink} strokeWidth={S.stroke} />
                        </IconTile>
                      }
                    />
                  </View>
                ))}
              </Card>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Before Google's page, while Google has not verified Budget. */}
      <Sheet pal={C} visible={explainGmail} onClose={() => setExplainGmail(false)} title={t('emailConnect.unverified.title')}>
        <View style={{ paddingHorizontal: S.card, paddingBottom: 8 }}>
          <Type role="body" color={C.inkDim}>
            {t('emailConnect.unverified.body')}
          </Type>
          <View style={{ gap: 10, marginTop: S.group }}>
            {['emailConnect.unverified.step1', 'emailConnect.unverified.step2', 'emailConnect.unverified.step3'].map((key, i) => (
              <View key={key} style={{ flexDirection: 'row', gap: 12 }}>
                <Type role="body" color={C.inkDim}>
                  {`${i + 1}.`}
                </Type>
                <Type role="body" color={C.ink} style={{ flex: 1 }}>
                  {t(key)}
                </Type>
              </View>
            ))}
          </View>
          <PrimaryButton
            pal={C}
            label={t('emailConnect.unverified.continue')}
            onPress={() => void startConnect('gmail')}
            style={{ marginTop: S.wide }}
          />
          <PrimaryButton
            pal={C}
            label={t('emailConnect.unverified.notNow')}
            onPress={() => setExplainGmail(false)}
            variant="secondary"
            style={{ marginTop: 12 }}
          />
        </View>
      </Sheet>

      {/* Disconnecting deletes what was found there: asked first, in a sheet. */}
      <Sheet pal={C} visible={!!confirming} onClose={() => setConfirming(null)} title={confirmCopy?.title}>
        <View style={{ paddingHorizontal: S.card, paddingBottom: 8 }}>
          <Type role="body" color={C.inkDim}>
            {confirmCopy?.body}
          </Type>
          {confirmCopy?.manual ? (
            <Type role="meta" color={C.inkDim} style={{ marginTop: S.group }}>
              {confirmCopy.manual}
            </Type>
          ) : null}
          <PrimaryButton
            pal={C}
            label={t('emailConnect.disconnect.confirm')}
            onPress={() => confirming && disconnect.mutate(confirming)}
            variant="destructive"
            disabled={disconnect.isPending}
            style={{ marginTop: S.wide }}
          />
          <PrimaryButton
            pal={C}
            label={t('emailConnect.disconnect.keep')}
            onPress={() => setConfirming(null)}
            variant="secondary"
            style={{ marginTop: 12 }}
          />
        </View>
      </Sheet>

      {/* The grant the server could not revoke (Outlook's personal accounts): the page to remove it. */}
      <Sheet pal={C} visible={!!manual} onClose={() => setManual(null)} title={t('emailConnect.disconnect.manualTitle')}>
        <View style={{ paddingHorizontal: S.card, paddingBottom: 8 }}>
          <Type role="body" color={C.inkDim}>
            {t('emailConnect.disconnect.manualBody', { provider: manual?.provider ?? '' })}
          </Type>
          <PrimaryButton
            pal={C}
            label={t('emailConnect.disconnect.openManual', { provider: manual?.provider ?? '' })}
            onPress={() => manual && void openUrl(manual.url)}
            style={{ marginTop: S.wide }}
          />
          <PrimaryButton
            pal={C}
            label={t('emailConnect.disconnect.done')}
            onPress={() => setManual(null)}
            variant="secondary"
            style={{ marginTop: 12 }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
