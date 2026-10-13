import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLocales } from 'expo-localization';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { ChevronDown, Search, Wallet } from '@/components/icons';
import { Card, ChoiceRow, Field, FormError, IconTile, PrimaryButton, Screen, StepProgress, Type } from '@/components/kit';
import { ConnectSources } from '@/components/ConnectSources';
import { S, useC, type Palette } from '@/lib/design';
import { setPersonalCurrency, updateSettings } from '@/lib/db';
import { syncNow } from '@/lib/cloud-sync';
import { CURRENCIES, getCurrencyByCode, getPopularCurrencies, type Currency } from '@/lib/currencies';
import { getIntlTag, t } from '@/lib/i18n/core';
import { useEntitlement } from '@/lib/useEntitlement';
import {
  BACKFILL_WAIT_MS,
  EMAIL_CONNECTIONS_QUERY_KEY,
  connectEmailProvider,
  getEmailConnections,
  pullEmailFindings,
  type EmailConnectionDTO,
} from '@/lib/email-connections';
import { bankLinkAvailability, deviceRegion, getBankLinkConfig, getLinkedBanks } from '@/lib/bank-linking';
import { onDetectionChange, replanReminders, runDetection, type DetectionSummary } from '@/lib/subscription-detection';
import { askForNotifications } from '@/lib/notifications';
import {
  completeOnboarding,
  getOnboardingData,
  hasImportedStatement,
  saveOnboardingProgress,
} from '@/lib/onboarding-storage';
import {
  BANK_AVAILABILITY_QUERY_KEY,
  LINKED_BANKS_QUERY_KEY,
  ONBOARDING_QUERY_KEY,
  STATEMENT_IMPORTED_QUERY_KEY,
} from '@/lib/getting-started';
import {
  BUDGET_SHARE,
  BUDGET_STYLES,
  connectFailure,
  connectModel,
  formatMoney,
  inboxReading,
  parseAmountInput,
  payoffModel,
  progressPosition,
  reduceOnboarding,
  regionCurrency,
  settingsFromAnswers,
  startProgress,
  suggestedBudget,
  type BudgetStyle,
  type ConnectOptionId,
  type Msg,
  type NotificationPermission,
  type OnboardingAction,
  type OnboardingProgress,
} from '@/lib/onboarding-flow';

/** A sentence from the model, in the reader's language. */
const say = (m: Msg | null): string => (m ? t(m.key, m.params) : '');

function styleLabel(style: BudgetStyle): string {
  if (style === 'frugal') return t('spendingStyle.frugalLabel');
  if (style === 'generous') return t('spendingStyle.generousLabel');
  return t('spendingStyle.moderateLabel');
}

function providerName(id: 'gmail' | 'outlook'): string {
  return id === 'gmail' ? t('onboardingFlow.connect.gmail') : t('onboardingFlow.connect.outlook');
}

/** Where notification permission stands, read without asking. */
async function notificationPermission(): Promise<NotificationPermission | null> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted || p.status === 'granted') return 'granted';
    if (p.status === 'undetermined' && p.canAskAgain !== false) return 'undetermined';
    return 'denied';
  } catch {
    return null;
  }
}

/** The phone's suggestion: its region's currency, else its locale's (onboarding-flow.ts). */
function deviceCurrency(): string {
  try {
    return regionCurrency(getLocales()[0] ?? null);
  } catch {
    return regionCurrency(null);
  }
}

/** Sleep, but wake early once `stop` is set. */
async function nap(ms: number, stop: { aborted: boolean }): Promise<void> {
  for (let waited = 0; waited < ms && !stop.aborted; waited += 250) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
}

interface PayoffFacts {
  summary: DetectionSummary;
  emailConnected: boolean;
  stillReading: boolean;
  anySource: boolean;
  permission: NotificationPermission | null;
}

/**
 * Onboarding — the model is lib/onboarding-flow.ts; this screen draws it.
 *
 * currency → income (optional) → Connect your data → the first search → the
 * payoff. Every answer is saved as it is given (onboarding-storage.ts), so a
 * closed app reopens on the same step (the root layout sends it back here).
 * The currency is written the moment it is confirmed, to the settings and the
 * default Cash account together; the income and the budget it picked are
 * written when the payoff is left. Nothing here ever writes the starting
 * balance.
 *
 * One question per step, on the plain page, and the espresso button at the
 * bottom is the screen's one anchor.
 */
export default function OnboardingScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { isPro } = useEntitlement();

  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const progressRef = useRef<OnboardingProgress | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const suggested = useMemo(deviceCurrency, []);
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null);
  const [incomeText, setIncomeText] = useState('');
  const [budgetChoice, setBudgetChoice] = useState<BudgetStyle | 'none'>('moderate');
  const [incomeError, setIncomeError] = useState('');

  /** One answer: the model moves, the screen follows, the record is saved. */
  const apply = useCallback((action: OnboardingAction) => {
    const current = progressRef.current;
    if (!current) return;
    const next = reduceOnboarding(current, action);
    progressRef.current = next;
    setProgress(next);
    saveOnboardingProgress(next).catch((e) => console.warn('[onboarding] progress not saved', e));
  }, []);

  // Where this user left off — or, if they finished, not here at all (a deep
  // link, a stale route): onboarding never runs twice over an account.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getOnboardingData().catch(() => null);
      if (cancelled) return;
      if (stored?.completed) {
        router.replace('/(tabs)');
        return;
      }
      const start = stored?.progress ?? startProgress();
      progressRef.current = start;
      setProgress(start);
      const a = start.answers;
      if (a.monthlyIncome !== null) {
        setIncomeText(String(a.monthlyIncome));
        setBudgetChoice(a.budgetStyle ?? 'none');
      }
      // Recorded from the first screen, so even a close here resumes here.
      if (!stored?.progress) saveOnboardingProgress(start).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const step = progress?.step ?? 'currency';
  const currencyCode = pickedCurrency ?? progress?.answers.currency ?? suggested;
  const currency: Currency = getCurrencyByCode(currencyCode) ?? getCurrencyByCode('USD')!;

  // ── Currency ──
  const currencyMutation = useMutation({
    mutationFn: async (c: Currency) => setPersonalCurrency(c.code, c.symbol),
    onSuccess: (_void, c) => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      apply({ type: 'confirmCurrency', code: c.code });
    },
    onError: (e) => {
      console.warn('[onboarding] currency not saved', e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  // ── Income ──
  const income = parseAmountInput(incomeText);
  const continueIncome = () => {
    if (!incomeText.trim()) {
      apply({ type: 'skipIncome' });
      return;
    }
    if (income === null || income <= 0) {
      setIncomeError(t('onboardingFlow.income.invalid'));
      return;
    }
    setIncomeError('');
    apply({ type: 'setIncome', monthlyIncome: income, budgetStyle: budgetChoice === 'none' ? null : budgetChoice });
  };

  // ── Connect your data ──
  const atConnect = step === 'connect' || step === 'detect';
  const emailQuery = useQuery({
    queryKey: EMAIL_CONNECTIONS_QUERY_KEY,
    queryFn: getEmailConnections,
    enabled: atConnect,
    retry: 1,
  });
  const availabilityQuery = useQuery({
    queryKey: BANK_AVAILABILITY_QUERY_KEY,
    queryFn: async () => bankLinkAvailability(await deviceRegion(), await getBankLinkConfig()),
    enabled: atConnect,
    staleTime: 10 * 60_000,
  });
  const banksQuery = useQuery({ queryKey: LINKED_BANKS_QUERY_KEY, queryFn: getLinkedBanks, enabled: atConnect });
  const statementQuery = useQuery({
    queryKey: STATEMENT_IMPORTED_QUERY_KEY,
    queryFn: hasImportedStatement,
    enabled: atConnect,
  });

  // Back from the import or the bank link: what they did shows at once.
  useFocusEffect(
    useCallback(() => {
      for (const key of [STATEMENT_IMPORTED_QUERY_KEY, LINKED_BANKS_QUERY_KEY, EMAIL_CONNECTIONS_QUERY_KEY]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    }, [qc]),
  );

  // The import screen records its batch in the background as it closes, so
  // the check on focus can run before the record exists. Detection runs right
  // after the record is written; when it finishes, look again.
  useEffect(
    () =>
      onDetectionChange(() => {
        void qc.invalidateQueries({ queryKey: STATEMENT_IMPORTED_QUERY_KEY });
        void qc.invalidateQueries({ queryKey: LINKED_BANKS_QUERY_KEY });
      }),
    [qc],
  );

  const model = connectModel({
    providers: emailQuery.data?.providers ?? null,
    emailConnections: emailQuery.data?.connections ?? [],
    statementImported: statementQuery.data ?? false,
    bankState: availabilityQuery.data?.state ?? 'unknown',
    banksLinked: banksQuery.data?.length ?? 0,
    isPro,
  });

  // Whatever is connected, however it got connected, is recorded.
  const recorded = progress?.answers.connected;
  useEffect(() => {
    if (!recorded) return;
    for (const source of model.connected) if (!recorded.includes(source)) apply({ type: 'connected', source });
  }, [model.connected, recorded, apply]);

  const [connecting, setConnecting] = useState<ConnectOptionId | null>(null);
  const [reading, setReading] = useState<'gmail' | 'outlook' | null>(null);
  const [connectError, setConnectError] = useState<Msg | null>(null);
  const [scanned, setScanned] = useState<number | null>(null);
  /** Inbox connections still filling their first year; the search waits on them. */
  const pendingInboxes = useRef<Promise<unknown>[]>([]);
  /** One per connection, and one for the search: "show what's found" sets them all. */
  const stopSignals = useRef<{ aborted: boolean }[]>([]);

  const connectInbox = async (provider: 'gmail' | 'outlook') => {
    setConnectError(null);
    setConnecting(provider);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (alive.current) setConnecting(null);
    };
    const signal = { aborted: false };
    stopSignals.current.push(signal);
    const run = connectEmailProvider(provider, {
      signal,
      // The payoff is where onboarding asks for notification permission, and
      // only when there is something to remind about — not mid-connect.
      interactive: false,
      onProgress: (p) => {
        if (p.phase === 'authorizing') return;
        // Back from the browser, connected: the rest (the first year's read)
        // carries on while the user goes on.
        if (!released) {
          release();
          apply({ type: 'connected', source: 'email' });
          if (alive.current) setReading(provider);
          void qc.invalidateQueries({ queryKey: EMAIL_CONNECTIONS_QUERY_KEY });
        }
        if (p.connection && alive.current) setScanned(p.connection.messagesScanned);
      },
    });
    pendingInboxes.current.push(run);
    const result = await run;
    release();
    if (!alive.current) return;
    setConnectError(connectFailure(result));
    void qc.invalidateQueries({ queryKey: EMAIL_CONNECTIONS_QUERY_KEY });
  };

  const onConnect = (id: ConnectOptionId) => {
    setConnectError(null);
    if (id === 'gmail' || id === 'outlook') void connectInbox(id);
    else if (id === 'statement') router.push('/import');
    else router.push('/link-bank');
  };

  const finishConnect = () =>
    apply({ type: 'finishConnect', offered: model.offered, connected: model.connected });

  // ── The first search ──
  const [searchStage, setSearchStage] = useState<'reading' | 'checking'>('checking');
  const [payoff, setPayoff] = useState<PayoffFacts | null>(null);
  const searching = useRef(false);

  const search = useCallback(async () => {
    const stop = { aborted: false };
    stopSignals.current.push(stop);
    let connections: EmailConnectionDTO[] = [];
    let stillReading = false;
    try {
      // An inbox connected a moment ago: wait for its first read, with its count on screen.
      if (pendingInboxes.current.length > 0) {
        setSearchStage('reading');
        await Promise.allSettled(pendingInboxes.current);
        pendingInboxes.current = [];
      }
      // One connected before the app was closed, still reading on the server.
      let list = await getEmailConnections().catch(() => null);
      const deadline = Date.now() + BACKFILL_WAIT_MS;
      while (list && alive.current && !stop.aborted && Date.now() < deadline) {
        const state = inboxReading(list.connections);
        if (!state.reading) break;
        setSearchStage('reading');
        setScanned(state.scanned);
        await nap(3000, stop);
        list = (await getEmailConnections().catch(() => null)) ?? list;
      }
      connections = list?.connections ?? [];
      stillReading = inboxReading(connections).reading;
      if (connections.length > 0) await pullEmailFindings().catch(() => undefined);
    } catch (e) {
      console.warn('[onboarding] inbox wait failed', e);
    }
    if (!alive.current) return;
    setSearchStage('checking');
    // The user is looking at the result: no "found" notification, and no
    // permission prompt from the run itself — the payoff asks, if it is worth it.
    const summary = await runDetection('onboarding', { interactive: false, announce: false });
    const permission = await notificationPermission();
    if (!alive.current) return;
    const answers = progressRef.current?.answers;
    setPayoff({
      summary,
      emailConnected: connections.length > 0,
      stillReading,
      anySource:
        connections.length > 0 ||
        !!answers?.connected.length ||
        !!qc.getQueryData<boolean>(STATEMENT_IMPORTED_QUERY_KEY) ||
        (qc.getQueryData<unknown[]>(LINKED_BANKS_QUERY_KEY)?.length ?? 0) > 0,
      permission,
    });
    apply({ type: 'detected' });
  }, [apply, qc]);

  useEffect(() => {
    if (step !== 'detect' || searching.current) return;
    searching.current = true;
    void search().finally(() => {
      searching.current = false;
    });
  }, [step, search]);

  const showNow = () => {
    for (const s of stopSignals.current) s.aborted = true;
  };

  // A payoff with nothing behind it (the screen was rebuilt): search again.
  useEffect(() => {
    if (step === 'payoff' && !payoff && progressRef.current) {
      const back = { ...progressRef.current, step: 'detect' as const };
      progressRef.current = back;
      setProgress(back);
    }
  }, [step, payoff]);

  // ── The payoff, and leaving ──
  const finish = useMutation({
    mutationFn: async (remind: boolean) => {
      if (remind && (await askForNotifications())) await replanReminders();
      const answers = progressRef.current?.answers;
      if (!answers) return;
      const write = settingsFromAnswers(answers);
      if (Object.keys(write).length > 0) await updateSettings(write);
      await completeOnboarding(answers);
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The account's first real settings go now rather than after the
      // local-write debounce.
      void syncNow();
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
      if (router.canDismiss()) router.dismissAll();
      router.replace('/(tabs)');
    },
    onError: (e) => {
      console.warn('[onboarding] finish not saved', e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  if (!progress) {
    return (
      <Screen pal={C}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.accent} />
        </View>
      </Screen>
    );
  }

  const position = progressPosition(step);
  const asking = step === 'currency' || step === 'income' || step === 'connect';
  const report =
    payoff &&
    payoffModel({
      summary: payoff.summary,
      currency: currency.code,
      intlTag: getIntlTag(),
      emailConnected: payoff.emailConnected,
      inboxStillReading: payoff.stillReading,
      anySource: payoff.anySource,
      permission: payoff.permission,
    });

  const footer = () => {
    switch (step) {
      case 'currency':
        return (
          <>
            {currencyMutation.isError ? <FormError pal={C} message={t('onboardingFlow.currency.failed')} /> : null}
            <PrimaryButton
              pal={C}
              label={t('common.continue')}
              onPress={() => currencyMutation.mutate(currency)}
              disabled={currencyMutation.isPending}
              style={{ marginTop: 12 }}
            />
          </>
        );
      case 'income':
        return (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <PrimaryButton pal={C} variant="secondary" label={t('common.back')} onPress={() => apply({ type: 'back' })} style={{ flex: 1 }} />
            <PrimaryButton
              pal={C}
              label={incomeText.trim() ? t('common.continue') : t('onboardingFlow.income.skip')}
              onPress={continueIncome}
              style={{ flex: 1.4 }}
            />
          </View>
        );
      case 'connect':
        return (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <PrimaryButton
              pal={C}
              variant="secondary"
              label={t('common.back')}
              onPress={() => apply({ type: 'back' })}
              disabled={connecting !== null}
              style={{ flex: 1 }}
            />
            <PrimaryButton
              pal={C}
              label={model.connected.length > 0 ? t('common.continue') : t('onboardingFlow.connect.skip')}
              onPress={finishConnect}
              disabled={connecting !== null}
              style={{ flex: 1.4 }}
            />
          </View>
        );
      case 'detect':
        return null;
      case 'payoff':
        return (
          <>
            {finish.isError ? <FormError pal={C} message={t('onboardingFlow.payoff.failed')} /> : null}
            {report?.reminders === 'ask' ? (
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                <PrimaryButton
                  pal={C}
                  variant="secondary"
                  label={t('onboardingFlow.payoff.notNow')}
                  onPress={() => finish.mutate(false)}
                  disabled={finish.isPending}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  pal={C}
                  label={t('onboardingFlow.payoff.remindButton')}
                  onPress={() => finish.mutate(true)}
                  disabled={finish.isPending}
                  style={{ flex: 1.4 }}
                />
              </View>
            ) : (
              <PrimaryButton
                pal={C}
                label={t('onboardingFlow.payoff.done')}
                onPress={() => finish.mutate(false)}
                disabled={finish.isPending || !report}
                style={{ marginTop: 12 }}
              />
            )}
          </>
        );
    }
  };

  const body = () => {
    switch (step) {
      case 'currency':
        return (
          <CurrencyStep
            pal={C}
            selected={currency}
            suggested={suggested}
            onPick={(code) => {
              setPickedCurrency(code);
              currencyMutation.reset();
            }}
          />
        );
      case 'income':
        return (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={stepPadding}>
            <Type role="section" color={C.ink}>{t('onboardingFlow.income.title')}</Type>
            <Type role="body" color={C.inkDim} style={{ marginTop: S.tight, marginBottom: S.wide }}>
              {t('onboardingFlow.income.hint')}
            </Type>
            <Field
              pal={C}
              label={t('onboardingFlow.income.label')}
              icon={<Type role="cardTitle" color={C.inkDim}>{currency.symbol}</Type>}
              value={incomeText}
              onChangeText={(v) => {
                setIncomeText(v);
                setIncomeError('');
              }}
              placeholder="2500"
              keyboardType="decimal-pad"
              returnKeyType="done"
            />
            <FormError pal={C} message={incomeError} />
            {income !== null && income > 0 ? (
              <View style={{ marginTop: S.wide }}>
                <Type role="cardTitle" color={C.ink}>{t('onboardingFlow.income.budgetTitle')}</Type>
                <Type role="meta" color={C.inkDim} style={{ marginTop: 4, marginBottom: S.tight }}>
                  {t('onboardingFlow.income.budgetHint')}
                </Type>
                {BUDGET_STYLES.map((style) => (
                  <ChoiceRow
                    key={style}
                    pal={C}
                    title={styleLabel(style)}
                    body={t('onboardingFlow.income.share', {
                      amount: formatMoney(suggestedBudget(income, style), currency.code, getIntlTag(), true),
                      percent: Math.round(BUDGET_SHARE[style] * 100),
                    })}
                    selected={budgetChoice === style}
                    onPress={() => setBudgetChoice(style)}
                  />
                ))}
                <ChoiceRow
                  pal={C}
                  title={t('onboardingFlow.income.noBudget')}
                  body={t('onboardingFlow.income.noBudgetBody')}
                  selected={budgetChoice === 'none'}
                  onPress={() => setBudgetChoice('none')}
                />
              </View>
            ) : null}
          </ScrollView>
        );
      case 'connect':
        return (
          <ScrollView contentContainerStyle={stepPadding}>
            <Type role="section" color={C.ink}>{t('onboardingFlow.connect.title')}</Type>
            <Type role="body" color={C.inkDim} style={{ marginTop: S.tight, marginBottom: S.wide }}>
              {t('onboardingFlow.connect.hint')}
            </Type>
            {emailQuery.isLoading ? (
              <ActivityIndicator color={C.inkDim} style={{ marginBottom: S.group }} />
            ) : null}
            <ConnectSources pal={C} model={model} busy={connecting} onConnect={onConnect} />
            {connecting === 'gmail' || connecting === 'outlook' ? (
              <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
                {t('onboardingFlow.connect.waiting', { provider: providerName(connecting) })}
              </Type>
            ) : reading ? (
              <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
                {t('onboardingFlow.connect.reading', { provider: providerName(reading) })}
              </Type>
            ) : null}
            {connectError ? <FormError pal={C} message={say(connectError)} /> : null}
            {model.emailUnreachable && emailQuery.isError ? (
              <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
                {t('onboardingFlow.connect.emailUnreachable')}
              </Type>
            ) : null}
            <Type role="meta" color={C.inkDim} style={{ marginTop: S.group }}>
              {t('onboardingFlow.connect.later')}
            </Type>
          </ScrollView>
        );
      case 'detect':
        return (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.screen }}>
            <ActivityIndicator size="large" color={C.accent} />
            <Type role="section" color={C.ink} style={{ marginTop: S.wide, textAlign: 'center' }}>
              {t('onboardingFlow.detect.title')}
            </Type>
            <Type role="body" color={C.inkDim} style={{ marginTop: S.tight, textAlign: 'center' }}>
              {searchStage === 'reading'
                ? scanned && scanned > 0
                  ? t('onboardingFlow.detect.reading', { count: scanned })
                  : t('onboardingFlow.detect.readingStart')
                : t('onboardingFlow.detect.checking')}
            </Type>
            {searchStage === 'reading' ? (
              <>
                <Type role="meta" color={C.inkDim} style={{ marginTop: S.group, textAlign: 'center' }}>
                  {t('onboardingFlow.detect.hint')}
                </Type>
                <Pressable
                  onPress={showNow}
                  hitSlop={10}
                  accessibilityRole="button"
                  style={{ marginTop: S.group, minHeight: 44, justifyContent: 'center' }}
                >
                  <Type role="meta" color={C.accent}>{t('onboardingFlow.detect.showNow')}</Type>
                </Pressable>
              </>
            ) : null}
          </View>
        );
      case 'payoff':
        if (!report) return null;
        return (
          <ScrollView contentContainerStyle={stepPadding}>
            <Type role="headline" color={C.ink}>{say(report.headline)}</Type>
            {report.note ? (
              <Type role="meta" color={C.inkDim} style={{ marginTop: S.tight }}>{say(report.note)}</Type>
            ) : null}
            {report.body ? (
              <Type role="body" color={C.inkDim} style={{ marginTop: S.group }}>{say(report.body)}</Type>
            ) : null}
            {report.items.length > 0 ? (
              <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }} style={{ marginTop: S.wide }}>
                {report.items.map((item, i) => (
                  <View
                    key={item.id}
                    style={[
                      { minHeight: 56, paddingVertical: 10, justifyContent: 'center' },
                      i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : null,
                    ]}
                  >
                    <Type role="body" color={C.ink} numberOfLines={1}>{item.name}</Type>
                    <Type role="meta" color={C.inkDim}>{say(item.line)}</Type>
                  </View>
                ))}
              </Card>
            ) : null}
            {report.more > 0 ? (
              <Type role="meta" color={C.inkDim} style={{ marginTop: S.tight }}>
                {t('onboardingFlow.payoff.more', { count: report.more })}
              </Type>
            ) : null}
            {report.remindersLine ? (
              <Type role="body" color={C.inkDim} style={{ marginTop: S.wide }}>{say(report.remindersLine)}</Type>
            ) : null}
          </ScrollView>
        );
    }
  };

  return (
    <Screen pal={C}>
      <View style={{ paddingHorizontal: S.screen, paddingTop: S.group }}>
        {asking ? (
          <Type role="meta" color={C.inkDim} style={{ marginBottom: 12 }}>
            {t('onboardingFlow.stepCounter', { step: position.index + 1, total: position.total })}
          </Type>
        ) : null}
        <StepProgress pal={C} total={position.total} current={position.index} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>{body()}</View>
        <View style={{ paddingHorizontal: S.screen, paddingTop: 12, paddingBottom: insets.bottom + S.group }}>
          {footer()}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const stepPadding = { paddingHorizontal: S.screen, paddingTop: S.section, paddingBottom: S.wide };

type CurrencyListRow = { key: string; label: string } | { key: string; currency: Currency };

/**
 * The currency step: the suggestion (the phone's region's currency) shown as
 * chosen, and behind "Change" the popular ones and a search over every one.
 * A FlatList, not 168 rows in a ScrollView: the list is mounted only as far
 * as it is seen.
 */
function CurrencyStep({
  pal,
  selected,
  suggested,
  onPick,
}: {
  pal: Palette;
  selected: Currency;
  suggested: string;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const rows = useMemo<CurrencyListRow[]>(() => {
    if (!open) return [];
    const needle = query.trim().toLowerCase();
    if (needle) {
      const matches = CURRENCIES.filter(
        (c) => c.code.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle),
      );
      return matches.length > 0
        ? matches.map((c) => ({ key: c.code, currency: c }))
        : [{ key: 'none', label: t('onboardingFlow.currency.noMatch') }];
    }
    const popular = getPopularCurrencies();
    const region = getCurrencyByCode(suggested);
    const top = region && !popular.some((p) => p.code === region.code) ? [region, ...popular] : popular;
    const topCodes = new Set(top.map((c) => c.code));
    return [
      { key: 'popular', label: t('onboardingFlow.currency.popular') },
      ...top.map((c) => ({ key: c.code, currency: c })),
      { key: 'all', label: t('onboardingFlow.currency.all') },
      ...CURRENCIES.filter((c) => !topCodes.has(c.code)).map((c) => ({ key: c.code, currency: c })),
    ];
  }, [open, query, suggested]);

  const header = (
    <View>
      <Type role="section" color={pal.ink}>{t('onboardingFlow.currency.title')}</Type>
      <Type role="body" color={pal.inkDim} style={{ marginTop: S.tight, marginBottom: S.wide }}>
        {t('onboardingFlow.currency.hint')}
      </Type>
      <ChoiceRow
        pal={pal}
        selected
        title={`${selected.code} · ${selected.symbol}`}
        body={selected.code === suggested ? `${selected.name} · ${t('onboardingFlow.currency.suggested')}` : selected.name}
        onPress={() => setOpen((v) => !v)}
        icon={
          <IconTile pal={pal}>
            <Wallet size={20} color={pal.ink} strokeWidth={S.stroke} />
          </IconTile>
        }
      />
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, minHeight: 44 }}
      >
        <Type role="meta" color={pal.accent}>{t('onboardingFlow.currency.change')}</Type>
        <ChevronDown size={15} color={pal.accent} strokeWidth={S.stroke} />
      </Pressable>
      {open ? (
        <Field
          pal={pal}
          value={query}
          onChangeText={setQuery}
          placeholder={t('onboardingFlow.currency.search')}
          autoCorrect={false}
          autoCapitalize="none"
          icon={<Search size={17} color={pal.inkDim} strokeWidth={S.stroke} />}
          style={{ marginTop: S.tight, marginBottom: S.tight }}
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.key}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={open}
      contentContainerStyle={stepPadding}
      ListHeaderComponent={header}
      renderItem={({ item }) =>
        'currency' in item ? (
          <ChoiceRow
            pal={pal}
            title={`${item.currency.code} · ${item.currency.symbol}`}
            body={item.currency.name}
            selected={item.currency.code === selected.code}
            onPress={() => {
              onPick(item.currency.code);
              setOpen(false);
              setQuery('');
            }}
          />
        ) : (
          <Type role="meta" color={pal.inkDim} style={{ marginTop: S.group, marginBottom: 4 }}>
            {item.label}
          </Type>
        )
      }
    />
  );
}
