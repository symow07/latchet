import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import {
  AlertTriangle,
  Building2,
  Check,
  Eye,
  EyeOff,
  Lock,
} from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { format, parseISO } from 'date-fns';

import {
  checkConnectionHealth,
  createLinkToken,
  disconnectBank,
  getConsentInfo,
  getLinkedAccounts,
  getLinkedBanks,
  syncAllTransactions,
  toggleAccountSync,
  type LinkedAccount,
  type LinkedBank,
} from '@/lib/bank-linking';
import { requestPull } from '@/lib/cloud-sync';
import { formatCurrencyAmount } from '@/lib/currencies';
import { accountTypeLabel } from '@/lib/tx-display';
import { useEntitlement } from '@/lib/useEntitlement';
import { isUpgradeRequired } from '@/lib/entitlementApi';
import { R, S, useC, type Palette } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  Card,
  IconTile,
  InfoRow,
  PrimaryButton,
  Screen,
  SectionHeader,
  Sheet,
  SubHeader,
  Type,
} from '@/components/kit';
import { t, getDateFnsLocale } from '@/lib/i18n/core';

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

  const [viewMode, setViewMode] = useState<ViewMode>('main');
  const [linkedBanks, setLinkedBanks] = useState<LinkedBank[]>([]);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [selectedBank, setSelectedBank] = useState<LinkedBank | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [health, setHealth] = useState<{
    healthy: LinkedBank[];
    expiringSoon: LinkedBank[];
    expired: LinkedBank[];
  }>({ healthy: [], expiringSoon: [], expired: [] });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      setLinkedBanks(await getLinkedBanks());
      setLinkedAccounts(await getLinkedAccounts());
      setHealth(await checkConnectionHealth());
    } finally {
      setIsLoading(false);
    }
  };

  const confirmBankConnection = async () => {
    setShowConsent(false);
    setIsLoading(true);

    try {
      // Real Plaid flow: get a Hosted Link URL from the backend and open the
      // bank's secure login in a browser. On success Plaid notifies the backend
      // (SESSION_FINISHED webhook), which exchanges the token and persists the
      // accounts — so we just refresh from the backend afterwards.
      const { hostedLinkUrl } = await createLinkToken();
      if (!hostedLinkUrl) {
        Alert.alert(t('bank.unavailableTitle'), t('bank.unavailableBody'));
        return;
      }

      await WebBrowser.openAuthSessionAsync(hostedLinkUrl, 'realbudget://callback');

      // The webhook may take a moment to land; refresh now and the user can
      // also pull-to-refresh / tap Sync if their bank appears a few seconds
      // later. The initial sync's transactions reach the ledger by a pull:
      // one now, and the 60 s sync picks up whatever lands after it.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      requestPull();
      await loadData();
      setViewMode('main');
    } catch (e) {
      // Bank sync is Pro. Offer the upgrade at the moment it is wanted rather
      // than reporting a failed connection.
      if (await handleUpgradeRequired(e)) {
        setIsLoading(false);
        return;
      }
      if (isUpgradeRequired(e)) {
        Alert.alert(t('subscription.bankProTitle'), t('subscription.bankProBody'));
        return;
      }
      Alert.alert(t('bank.connectionFailed'), e instanceof Error ? e.message : t('common.retry'));
    } finally {
      setIsLoading(false);
    }
  };

  // Disconnecting drops the connection and its history; there is no undo, so
  // it asks first. It used to fire on a single tap.
  const confirmDisconnect = (bank: LinkedBank) => {
    Alert.alert(bank.institutionName, t('dialogs.areYouSure'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('bankExtra.disconnect'),
        style: 'destructive',
        onPress: async () => {
          setIsLoading(true);
          try {
            await disconnectBank(bank.id);
            await loadData();
            setSelectedBank(null);
            setViewMode('main');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await syncAllTransactions();
      await loadData();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setIsSyncing(false);
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
    if (viewMode === 'main') router.back();
    else {
      setViewMode('main');
      setSelectedBank(null);
    }
  };

  const renderMain = () => (
    <>
      <Type role="body" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
        {t('bank.oauthNote')}
      </Type>

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
        <PrimaryButton
          pal={C}
          label={linkedBanks.length > 0 ? t('bank.linkAnother') : t('bank.linkFirst')}
          onPress={() => setViewMode('add-bank')}
        />
        <Type role="cardTitle" color={C.ink} style={{ marginTop: 24 }}>
          {t('bankExtra.preferManual')}
        </Type>
        <Type role="body" color={C.inkDim} style={{ marginTop: 4 }}>
          {t('bank.optionalNote')}
        </Type>
      </View>
    </>
  );

  const renderAddBank = () => (
    <>
      <View style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
        {/* One entry point, not a bank list. Choosing the institution happens
            in the provider's own secure flow, against the real,
            country-appropriate list — a local list could only ever be a
            shorter, staler copy. */}
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
              onPress={() => confirmDisconnect(selectedBank)}
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
                    amount={account.balance}
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
    </Screen>
  );
}
