import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  Check,
  Eye,
  EyeOff,
  FileText,
  Lock,
  Mail,
} from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { format, parseISO } from 'date-fns';

import {
  bankLinkAvailability,
  bankLinkErrorMessage,
  checkConnectionHealth,
  deviceRegion,
  disconnectBank,
  exitReasonMessage,
  getBankLinkConfig,
  getConsentInfo,
  getLinkedAccounts,
  getLinkedBanks,
  linkBank,
  syncAllTransactions,
  toggleAccountSync,
  type DisconnectMode,
  type LinkStage,
  type LinkedAccount,
  type LinkedBank,
} from '@/lib/bank-linking';
import { formatCurrencyAmount } from '@/lib/currencies';
import { accountTypeLabel, signedAccountBalance } from '@/lib/tx-display';
import { useEntitlement } from '@/lib/useEntitlement';
import { isUpgradeRequired } from '@/lib/entitlementApi';
import { R, S, useC, type Palette } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  Card,
  IconTile,
  InfoRow,
  LinkRow,
  Meter,
  PrimaryButton,
  Screen,
  SectionHeader,
  Sheet,
  SubHeader,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

/** Shared with anything else that asks whether bank linking is offered here. */
export const BANK_LINK_AVAILABILITY_QUERY_KEY = ['bank-link-availability'] as const;

type ViewMode = 'main' | 'add-bank' | 'bank-detail';

/** A row of the consent sheet: a squircle, a line, and nothing else (§6.9). */
function ConsentRow({
  pal,
  icon,
  label,
}: {
  pal: Palette;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <IconTile pal={pal}>{icon}</IconTile>
      <Type role="body" color={pal.ink} style={{ flex: 1 }}>
        {label}
      </Type>
    </View>
  );
}

/**
 * Connect a bank — DESIGN-PROMPT.md board §30, the trust screen.
 *
 * This screen was the only place in the app painted **blue**. The header was a
 * three-stop blue gradient, the add-bank affordance was a dashed blue box,
 * "Sync now" was a solid `bg-blue-600`, and the consent modal's confirm button
 * was another blue gradient — a third brand colour on the one screen where the
 * user is being asked to trust the app with their bank.
 *
 * §6.10 is specific about how this moment should look: icon rows, one headline
 * naming both parties, one full-width espresso button, legal text beneath. The
 * consent sheet is now that, and the rest of the screen is cards lifted off the
 * page, each feature row fronted by a platinum tile with an ink glyph.
 *
 * Two of the blue buttons also had `style={{ color: C.text }}` labels, which
 * after the retheme is near-black ink on a saturated blue fill.
 */
export default function LinkBankScreen() {
  const C = useC();
  const { handleUpgradeRequired } = useEntitlement();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<ViewMode>('main');
  const [linkedBanks, setLinkedBanks] = useState<LinkedBank[]>([]);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [selectedBank, setSelectedBank] = useState<LinkedBank | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  /** Where a link in progress is, and how far through its wait. */
  const [linkStage, setLinkStage] = useState<LinkStage | null>(null);
  const [waitProgress, setWaitProgress] = useState<{ attempt: number; maxAttempts: number } | null>(null);
  /** The bank whose disconnect is being asked about. */
  const [disconnecting, setDisconnecting] = useState<LinkedBank | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  /** Someone outside the served countries who wants to try anyway. */
  const [tryAnyway, setTryAnyway] = useState(false);
  const [health, setHealth] = useState<{
    healthy: LinkedBank[];
    expiringSoon: LinkedBank[];
    expired: LinkedBank[];
  }>({ healthy: [], expiringSoon: [], expired: [] });

  // Whether this server links banks where this phone is. Free users see it
  // too: the pointer to statements and email is for everyone.
  const { data: availability } = useQuery({
    queryKey: BANK_LINK_AVAILABILITY_QUERY_KEY,
    queryFn: async () => bankLinkAvailability(await deviceRegion(), await getBankLinkConfig()),
    staleTime: 10 * 60_000,
  });
  const offerLinking =
    !availability ||
    availability.state === 'available' ||
    availability.state === 'unknown' ||
    (availability.state === 'outside' && tryAnyway);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      setLinkedBanks(await getLinkedBanks());
      setLinkedAccounts(await getLinkedAccounts());
      setHealth(await checkConnectionHealth());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const confirmBankConnection = async () => {
    setShowConsent(false);
    setLinkStage('opening');
    setWaitProgress(null);
    // Hosted Link in the system browser session; the server finishes the
    // link whichever way the user comes back, and this waits (bounded) for
    // the new bank to appear, then pulls its transactions.
    const outcome = await linkBank((stage, progress) => {
      setLinkStage(stage);
      if (progress) setWaitProgress(progress);
    });
    setLinkStage(null);
    setWaitProgress(null);

    switch (outcome.kind) {
      case 'linked':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await loadData();
        setViewMode('main');
        Alert.alert(
          t('bankLink.result.linkedTitle'),
          t('bankLink.result.linkedBody', { count: outcome.newTransactions })
        );
        return;
      case 'pending':
        await loadData();
        Alert.alert(t('bankLink.result.pendingTitle'), t('bankLink.result.pendingBody'));
        return;
      case 'cancelled':
        return;
      case 'exited': {
        // A plain "I changed my mind" needs no dialog; a bank that failed does.
        const why = exitReasonMessage(outcome.code);
        if (why) Alert.alert(t('bankLink.result.exitedTitle'), why);
        return;
      }
      case 'failed':
        // Bank sync is Pro. Offer the upgrade at the moment it is wanted
        // rather than reporting a failed connection; someone who upgrades
        // goes straight back to connecting.
        if (await handleUpgradeRequired(outcome.error)) {
          setShowConsent(true);
          return;
        }
        if (isUpgradeRequired(outcome.error)) {
          Alert.alert(t('subscription.bankProTitle'), t('subscription.bankProBody'));
          return;
        }
        Alert.alert(t('bankLink.errors.title'), bankLinkErrorMessage(outcome.error));
        return;
    }
  };

  /**
   * Disconnecting asks what to do with the bank's data — kept as ordinary
   * accounts, or deleted everywhere. The bank's access is revoked either way;
   * if that fails nothing changes and the reason is shown.
   */
  const disconnect = async (bank: LinkedBank, mode: DisconnectMode) => {
    setIsDisconnecting(true);
    try {
      await disconnectBank(bank.id, mode);
      setDisconnecting(null);
      setSelectedBank(null);
      setViewMode('main');
      await loadData();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('bankLink.disconnect.failedTitle'), bankLinkErrorMessage(e));
    } finally {
      setIsDisconnecting(false);
    }
  };

  /** Ask the server to read every bank now, then re-read what it booked. */
  const syncBanks = async () => {
    // What the server booked reaches the ledger by the pull this asks for;
    // the ledger's screens refresh when it lands.
    const result = await syncAllTransactions();
    await loadData();
    if (result.failedBanks.length > 0) {
      Alert.alert(
        t('bankLink.errors.syncTitle'),
        t('bankLink.errors.syncPartial', { banks: result.failedBanks.join(', ') })
      );
    } else if (result.error && linkedBanks.length > 0 && !isUpgradeRequired(result.error)) {
      // Nobody with no bank linked is told a bank sync failed.
      Alert.alert(t('bankLink.errors.syncTitle'), bankLinkErrorMessage(result.error));
    } else if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await syncBanks();
    } finally {
      setIsSyncing(false);
    }
  };

  // Pull to refresh runs a bank sync, as Sync does.
  const onRefresh = async () => {
    setIsRefreshing(true);
    try {
      await syncBanks();
      await queryClient.invalidateQueries({ queryKey: BANK_LINK_AVAILABILITY_QUERY_KEY });
    } finally {
      setIsRefreshing(false);
    }
  };

  const shortDate = (iso: string) =>
    format(parseISO(iso), 'd MMM yyyy', { locale: getDateFnsLocale() });

  const title =
    viewMode === 'main'
      ? t('bank.headerMain')
      : viewMode === 'add-bank'
        ? t('bank.headerAdd')
        : (selectedBank?.institutionName ?? t('bank.headerMain'));

  const goBack = () => {
    // A link in progress finishes on its own; leaving mid-way would hide it.
    if (linkStage) return;
    if (viewMode === 'main') router.back();
    else {
      setViewMode('main');
      setSelectedBank(null);
    }
  };

  /**
   * Where bank linking is not offered — no provider on this server, or a
   * country it does not serve — the two other ways in, side by side.
   */
  const renderElsewhere = (state: 'outside' | 'not_configured') => (
    <View style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
      <Card pal={C}>
        <Type role="cardTitle" color={C.ink}>
          {state === 'outside'
            ? t('bankLink.availability.outsideTitle')
            : t('bankLink.availability.notConfiguredTitle')}
        </Type>
        <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
          {state === 'outside'
            ? t('bankLink.availability.outsideBody')
            : t('bankLink.availability.notConfiguredBody')}
        </Type>
        <View style={{ marginTop: 12 }}>
          <LinkRow
            pal={C}
            icon={
              <IconTile pal={C}>
                <FileText size={20} color={C.ink} strokeWidth={S.stroke} />
              </IconTile>
            }
            title={t('bankLink.availability.importStatement')}
            body={t('bankLink.availability.importStatementHint')}
            onPress={() => router.push('/import')}
          />
          <LinkRow
            pal={C}
            icon={
              <IconTile pal={C}>
                <Mail size={20} color={C.ink} strokeWidth={S.stroke} />
              </IconTile>
            }
            title={t('bankLink.availability.connectEmail')}
            body={t('bankLink.availability.connectEmailHint')}
            onPress={() => router.push('/email-inbox')}
          />
        </View>
      </Card>
      {state === 'outside' ? (
        <PressableScale
          onPress={() => setTryAnyway(true)}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel={t('bankLink.availability.tryAnyway')}
          style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}
        >
          <Type role="body" color={C.inkDim}>
            {t('bankLink.availability.tryAnyway')}
          </Type>
        </PressableScale>
      ) : null}
    </View>
  );

  const renderMain = () => (
    <>
      <Type role="body" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
        {t('bank.oauthNote')}
      </Type>

      {availability?.state === 'not_configured'
        ? renderElsewhere('not_configured')
        : availability?.state === 'outside' && !tryAnyway
          ? renderElsewhere('outside')
          : null}

      {linkedBanks.length > 0 ? (
        <View style={{ marginTop: S.section }}>
          <SectionHeader
            pal={C}
            title={t('bankExtra.linkedAccounts')}
            actionLabel={isSyncing ? t('bank.syncing') : t('bank.syncAll')}
            onAction={isSyncing ? undefined : handleSync}
          />
          <View style={{ paddingHorizontal: S.screen }}>
            <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
              {linkedBanks.map((bank, i) => {
                const count = linkedAccounts.filter((a) => a.bankId === bank.id).length;
                const expired = bank.connectionStatus === 'expired';
                const expiring = health.expiringSoon.some((b) => b.id === bank.id);
                const meta = [
                  t('bank.accountCount', { count }),
                  t('bank.lastSynced', { date: shortDate(bank.lastSynced) }),
                  expired
                    ? t('bankExtra.expired')
                    : expiring
                      ? t('bankExtra.expiring')
                      : null,
                ]
                  .filter(Boolean)
                  .join(' · ');

                return (
                  <View
                    key={bank.id}
                    style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                  >
                    <InfoRow
                      pal={C}
                      title={bank.institutionName}
                      meta={meta}
                      onPress={() => {
                        setSelectedBank(bank);
                        setViewMode('bank-detail');
                      }}
                      lead={
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: R.pill,
                            borderCurve: 'continuous',
                            // Said in words too, in the meta line above.
                            backgroundColor: expired
                              ? C.negative
                              : expiring
                                ? C.warning
                                : C.accentMark,
                          }}
                        />
                      }
                    />
                  </View>
                );
              })}
            </Card>
          </View>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
        {offerLinking ? (
          <PrimaryButton
            pal={C}
            label={linkedBanks.length > 0 ? t('bank.linkAnother') : t('bank.linkFirst')}
            onPress={() => setViewMode('add-bank')}
          />
        ) : null}
        <Type role="cardTitle" color={C.ink} style={{ marginTop: offerLinking ? 24 : 0 }}>
          {t('bankExtra.preferManual')}
        </Type>
        <Type role="body" color={C.inkDim} style={{ marginTop: 4 }}>
          {t('bank.optionalNote')}
        </Type>
      </View>
    </>
  );

  /** A link in progress: what it is doing, and how long the wait has run. */
  const renderLinking = () => {
    if (!linkStage) return null;
    const label =
      linkStage === 'opening'
        ? t('bankLink.stage.opening')
        : linkStage === 'browser'
          ? t('bankLink.stage.browser')
          : linkStage === 'finishing'
            ? t('bankLink.stage.finishing')
            : linkStage === 'waiting'
              ? t('bankLink.stage.waiting')
              : t('bankLink.stage.syncing');
    return (
      <Card pal={C}>
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
        >
          <ActivityIndicator color={C.accent} />
          <Type role="body" color={C.ink} style={{ flex: 1 }}>
            {label}
          </Type>
        </View>
        {linkStage === 'waiting' && waitProgress ? (
          <Meter
            pal={C}
            ratio={waitProgress.attempt / Math.max(1, waitProgress.maxAttempts)}
            label={label}
            style={{ marginTop: 12 }}
          />
        ) : null}
      </Card>
    );
  };

  const renderAddBank = () => (
    <>
      <View style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
        {/* One entry point, not a bank list. Choosing the institution happens
            in the provider's own secure flow, against the real,
            country-appropriate list — a local list could only ever be a
            shorter, staler copy. */}
        {linkStage ? (
          renderLinking()
        ) : (
          <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
            <InfoRow
              pal={C}
              title={t('bank.findYourBank')}
              meta={t('bank.findYourBankHint')}
              onPress={isLoading ? undefined : () => setShowConsent(true)}
              lead={
                <IconTile pal={C}>
                  <Building2 size={20} color={C.ink} strokeWidth={S.stroke} />
                </IconTile>
              }
              trailing={isLoading ? <ActivityIndicator color={C.accent} /> : undefined}
            />
          </Card>
        )}

        {linkedBanks.length > 0 ? (
          <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
            {t('bank.alreadyConnected', { count: linkedBanks.length })}
          </Type>
        ) : null}
      </View>

      <View style={{ marginTop: S.section }}>
        <SectionHeader pal={C} title={t('bankExtra.howItWorks')} />
        <View style={{ paddingHorizontal: S.screen }}>
          <Card pal={C}>
            <View style={{ gap: 16 }}>
              {['bank.step1', 'bank.step2', 'bank.step3'].map((key, i) => (
                <View key={key} style={{ flexDirection: 'row', gap: 12 }}>
                  <View
                    style={{
                      width: 26,
                      height: 26,
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
                    {t(key)}
                  </Type>
                </View>
              ))}
            </View>
          </Card>
        </View>
      </View>
    </>
  );

  const renderBankDetail = () => {
    if (!selectedBank) return null;
    const bankAccounts = linkedAccounts.filter((a) => a.bankId === selectedBank.id);
    const consent = getConsentInfo(selectedBank);

    return (
      <>
        <View style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
          <Card pal={C}>
            <Type role="cardTitle" color={C.ink}>
              {selectedBank.institutionName}
            </Type>
            <Type role="meta" color={C.inkDim} style={{ marginTop: 2 }}>
              {t('bank.connectedSince', { date: shortDate(selectedBank.lastSynced) })}
            </Type>
            <PrimaryButton
              pal={C}
              label={isSyncing ? t('bank.syncing') : t('bank.syncNow')}
              onPress={handleSync}
              disabled={isSyncing}
              variant="secondary"
              style={{ marginTop: 16 }}
            />
            <PressableScale
              onPress={() => setDisconnecting(selectedBank)}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel={t('bankExtra.disconnect')}
              style={{
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 6,
              }}
            >
              <Type role="cardTitle" color={C.negative}>
                {t('bankExtra.disconnect')}
              </Type>
            </PressableScale>
          </Card>
        </View>

        <View style={{ marginTop: S.section }}>
          <SectionHeader pal={C} title={t('bankExtra.linkedAccounts')} />
          <View style={{ paddingHorizontal: S.screen }}>
            <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
              {bankAccounts.map((account, i) => (
                <View
                  key={account.id}
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                >
                  <InfoRow
                    pal={C}
                    title={account.name}
                    meta={`${accountTypeLabel(account.type)} · ${account.maskedNumber}`}
                    // The account's own currency, not the app's: a linked USD
                    // account does not become euros because the app is set to
                    // euros. It used to print a literal `$`.
                    // What a card or loan owes reads as owed, as everywhere else.
                    amount={signedAccountBalance(account)}
                    format={(n) => formatCurrencyAmount(n, account.currency)}
                    trailing={
                      <PressableScale
                        onPress={async () => {
                          await toggleAccountSync(account.id, !account.isEnabled);
                          await loadData();
                        }}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: account.isEnabled }}
                        accessibilityLabel={account.name}
                        hitSlop={8}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: R.pill,
                          borderCurve: 'continuous',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: account.isEnabled ? C.accentSoft : C.groundSunk,
                          marginStart: 10,
                        }}
                      >
                        {account.isEnabled ? (
                          <Eye size={17} color={C.accent} strokeWidth={S.stroke} />
                        ) : (
                          <EyeOff size={17} color={C.inkDim} strokeWidth={S.stroke} />
                        )}
                      </PressableScale>
                    }
                  />
                </View>
              ))}
            </Card>
          </View>
        </View>

        <View style={{ marginTop: S.section }}>
          <SectionHeader pal={C} title={t('bankExtra.dataAccess')} />
          <View style={{ paddingHorizontal: S.screen }}>
            <Card pal={C}>
              <Type role="cardTitle" color={C.ink}>
                {t('misc.weAccess')}
              </Type>
              <View style={{ gap: 8, marginTop: 12 }}>
                {consent.dataAccessed.map((item) => (
                  <View key={item} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Check size={15} color={C.accent} strokeWidth={S.stroke} />
                    <Type role="body" color={C.inkDim} style={{ flex: 1 }}>
                      {item}
                    </Type>
                  </View>
                ))}
              </View>
              <Type role="meta" color={C.inkDim} style={{ marginTop: 16 }}>
                {t('bank.consentExpires', { date: shortDate(consent.expiresAt) })}
              </Type>
            </Card>
          </View>
        </View>
      </>
    );
  };

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={C.accent} />
        }
      >
        <SubHeader pal={C} title={title} onBack={goBack} />

        {viewMode === 'main' ? renderMain() : null}
        {viewMode === 'add-bank' ? renderAddBank() : null}
        {viewMode === 'bank-detail' ? renderBankDetail() : null}
      </ScrollView>

      {/* The trust moment — §6.10. One headline naming both parties, three
          icon rows saying exactly what is and is not granted, one espresso
          button, and the legal line beneath it. */}
      <Sheet pal={C} visible={showConsent} onClose={() => setShowConsent(false)}>
        <View style={{ paddingHorizontal: S.card, paddingTop: 6 }}>
          <IconTile pal={C} size={56} style={{ alignSelf: 'center' }}>
            <Building2 size={26} color={C.ink} strokeWidth={S.stroke} />
          </IconTile>

          <Type role="section" color={C.ink} style={{ textAlign: 'center', marginTop: 16 }}>
            {t('bank.consentTitle')}
          </Type>
          <Type role="body" color={C.inkDim} style={{ textAlign: 'center', marginTop: 6 }}>
            {t('bank.consentSubtitle')}
          </Type>
          <Type role="body" color={C.inkDim} style={{ textAlign: 'center', marginTop: 12 }}>
            {t('bank.authorizeIntro')}
          </Type>

          <View style={{ marginTop: 16 }}>
            <ConsentRow
              pal={C}
              icon={<Check size={19} color={C.ink} strokeWidth={S.stroke} />}
              label={t('bankExtra.viewBalances')}
            />
            <ConsentRow
              pal={C}
              icon={<Check size={19} color={C.ink} strokeWidth={S.stroke} />}
              label={t('bankExtra.readHistory')}
            />
            <ConsentRow
              pal={C}
              icon={<AlertTriangle size={19} color={C.ink} strokeWidth={S.stroke} />}
              label={t('bankExtra.noPayments')}
            />
          </View>

          <PrimaryButton
            pal={C}
            label={t('bankExtra.connectBank')}
            onPress={confirmBankConnection}
            disabled={!!linkStage}
            style={{ marginTop: 16 }}
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginTop: 16,
              paddingHorizontal: 4,
            }}
          >
            <Lock size={14} color={C.inkDim} strokeWidth={S.stroke} />
            <Type role="meta" color={C.inkDim} style={{ flex: 1 }}>
              {t('bank.neverStore')}
            </Type>
          </View>
        </View>
      </Sheet>

      {/* Disconnect: keep the bank's data as ordinary accounts, or delete it.
          A choice with weight on both sides, so a sheet rather than an alert. */}
      <Sheet
        pal={C}
        visible={!!disconnecting}
        onClose={() => (isDisconnecting ? undefined : setDisconnecting(null))}
        title={t('bankLink.disconnect.title', { bank: disconnecting?.institutionName ?? '' })}
      >
        <View style={{ paddingHorizontal: S.card }}>
          <Type role="body" color={C.inkDim}>
            {t('bankLink.disconnect.body')}
          </Type>

          <PrimaryButton
            pal={C}
            variant="secondary"
            label={t('bankLink.disconnect.keep')}
            onPress={() => disconnecting && disconnect(disconnecting, 'keep')}
            disabled={isDisconnecting}
            style={{ marginTop: 16 }}
          />
          <Type role="meta" color={C.inkDim} style={{ marginTop: 6, paddingHorizontal: 4 }}>
            {t('bankLink.disconnect.keepHint')}
          </Type>

          <PrimaryButton
            pal={C}
            variant="destructive"
            label={t('bankLink.disconnect.delete')}
            onPress={() => disconnecting && disconnect(disconnecting, 'delete')}
            disabled={isDisconnecting}
            style={{ marginTop: 16 }}
          />
          <Type role="meta" color={C.inkDim} style={{ marginTop: 6, paddingHorizontal: 4 }}>
            {t('bankLink.disconnect.deleteHint')}
          </Type>

          {isDisconnecting ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 16 }} />
          ) : (
            <PressableScale
              onPress={() => setDisconnecting(null)}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}
            >
              <Type role="cardTitle" color={C.ink}>
                {t('common.cancel')}
              </Type>
            </PressableScale>
          )}
        </View>
      </Sheet>
    </Screen>
  );
}
