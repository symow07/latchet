import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useC } from '@/lib/design';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Building2,
  Link2,
  Unlink,
  Shield,
  RefreshCw,
  ChevronRight,
  Check,
  AlertTriangle,
  Clock,
  Eye,
  EyeOff,
  Info,
  Lock,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp, FadeInDown } from 'react-native-reanimated';

import {
  getLinkedBanks,
  getLinkedAccounts,
  createLinkToken,
  disconnectBank,
  toggleAccountSync,
  syncAllTransactions,
  getConsentInfo,
  checkConnectionHealth,
  type LinkedBank,
  type LinkedAccount,
} from '@/lib/bank-linking';
import { useEntitlement } from '@/lib/useEntitlement';
import { isUpgradeRequired } from '@/lib/entitlementApi';
import { t } from '@/lib/i18n/core';

type ViewMode = 'main' | 'add-bank' | 'bank-detail' | 'consent';

export default function LinkBankScreen() {
  const C = useC();
  const { handleUpgradeRequired } = useEntitlement();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [viewMode, setViewMode] = useState<ViewMode>('main');
  const [linkedBanks, setLinkedBanks] = useState<LinkedBank[]>([]);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [selectedBank, setSelectedBank] = useState<LinkedBank | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [connectionHealth, setConnectionHealth] = useState<{
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
      const banks = await getLinkedBanks();
      const accounts = await getLinkedAccounts();
      const health = await checkConnectionHealth();
      setLinkedBanks(banks);
      setLinkedAccounts(accounts);
      setConnectionHealth(health);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddBank = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowConsentModal(true);
  };

  const confirmBankConnection = async () => {
    setShowConsentModal(false);
    setIsLoading(true);

    try {
      // Real Plaid flow: get a Hosted Link URL from the backend and open the
      // bank's secure login in a browser. On success Plaid notifies the backend
      // (SESSION_FINISHED webhook), which exchanges the token and persists the
      // accounts — so we just refresh from the backend afterwards.
      const { hostedLinkUrl } = await createLinkToken();
      if (!hostedLinkUrl) {
        Alert.alert(
          t('bank.unavailableTitle'),
          t('bank.unavailableBody')
        );
        return;
      }

      await WebBrowser.openAuthSessionAsync(hostedLinkUrl, 'realbudget://callback');

      // The webhook may take a moment to land; refresh now and the user can also
      // pull-to-refresh / tap Sync if their bank appears a few seconds later.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
        Alert.alert(
          t('subscription.bankProTitle'),
          t('subscription.bankProBody')
        );
        return;
      }
      Alert.alert(t('bank.connectionFailed'), e instanceof Error ? e.message : t('common.retry'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnectBank = async (bankId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsLoading(true);

    try {
      await disconnectBank(bankId);
      await loadData();
      setSelectedBank(null);
      setViewMode('main');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleAccount = async (accountId: string, enabled: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await toggleAccountSync(accountId, enabled);
    await loadData();
  };

  const handleSync = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSyncing(true);

    try {
      await syncAllTransactions();
      await loadData();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setIsSyncing(false);
    }
  };

  const renderSecurityBanner = () => (
    <Animated.View entering={FadeInDown.duration(400)} className="mx-4 mb-4">
      <View
        className="rounded-2xl p-4"
        style={{
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          borderWidth: 1,
          borderColor: 'rgba(34, 197, 94, 0.2)',
        }}
      >
        <View className="flex-row items-center mb-2">
          <Shield size={18} color="#22c55e" />
          <Text className="text-green-400 font-semibold ml-2">{t('bankExtra.security')}</Text>
        </View>
        <Text style={{ color: C.textDim }} className="text-sm leading-5">
          We use OAuth authentication and never store your banking credentials.
          Your data is encrypted and you can disconnect anytime.
        </Text>
      </View>
    </Animated.View>
  );

  const renderMainView = () => (
    <>
      {renderSecurityBanner()}

      {/* Linked Banks */}
      {linkedBanks.length > 0 && (
        <View className="px-4 mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <Text style={{ color: C.textDim }} className="text-xs font-semibold">{t('bankExtra.linkedAccounts')}</Text>
            <Pressable
              onPress={handleSync}
              disabled={isSyncing}
              className="flex-row items-center"
            >
              <RefreshCw
                size={14}
                color={isSyncing ? '#6b7280' : '#3b82f6'}
                style={isSyncing ? { transform: [{ rotate: '45deg' }] } : undefined}
              />
              <Text style={{ color: C.textFaint }} className={`text-xs ml-1 ${isSyncing ? '' : 'text-blue-400'}`}>
                {isSyncing ? 'Syncing...' : 'Sync All'}
              </Text>
            </Pressable>
          </View>

          {linkedBanks.map((bank, idx) => {
            const bankAccounts = linkedAccounts.filter(a => a.bankId === bank.id);
            const isExpired = bank.connectionStatus === 'expired';
            const isExpiring = connectionHealth.expiringSoon.some(b => b.id === bank.id);

            return (
              <Animated.View
                key={bank.id}
                entering={FadeInUp.delay(100 * idx).duration(300)}
              >
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedBank(bank);
                    setViewMode('bank-detail');
                  }}
                >
                  <View
                    className="rounded-xl p-4 mb-3"
                    style={{
                      backgroundColor: isExpired
                        ? 'rgba(239, 68, 68, 0.1)'
                        : 'rgba(255,255,255,0.05)',
                      borderWidth: isExpired || isExpiring ? 1 : 0,
                      borderColor: isExpired
                        ? 'rgba(239, 68, 68, 0.3)'
                        : 'rgba(245, 158, 11, 0.3)',
                    }}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center flex-1">
                        <View
                          className="w-12 h-12 rounded-xl items-center justify-center mr-3"
                          style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)' }}
                        >
                          <Text className="text-2xl">{bank.institutionLogo}</Text>
                        </View>
                        <View className="flex-1">
                          <Text style={{ color: C.text }} className="font-semibold">{bank.institutionName}</Text>
                          <Text style={{ color: C.textDim }} className="text-xs mt-0.5">
                            {bankAccounts.length} account{bankAccounts.length !== 1 ? 's' : ''} •
                            Last synced {new Date(bank.lastSynced).toLocaleDateString()}
                          </Text>
                        </View>
                      </View>

                      <View className="flex-row items-center">
                        {isExpired && (
                          <View className="bg-red-500/20 rounded-full px-2 py-1 mr-2">
                            <Text className="text-red-400 text-xs">{t('bankExtra.expired')}</Text>
                          </View>
                        )}
                        {isExpiring && !isExpired && (
                          <View className="bg-amber-500/20 rounded-full px-2 py-1 mr-2">
                            <Text className="text-amber-400 text-xs">{t('bankExtra.expiring')}</Text>
                          </View>
                        )}
                        <ChevronRight size={20} color="#6b7280" />
                      </View>
                    </View>

                    {/* Account balances preview */}
                    <View className="flex-row mt-3 gap-2">
                      {bankAccounts.slice(0, 2).map(acc => (
                        <View
                          key={acc.id}
                          className="flex-1 bg-black/30 rounded-lg p-2"
                        >
                          <Text style={{ color: C.textFaint }} className="text-xs" numberOfLines={1}>
                            {acc.name}
                          </Text>
                          <Text style={{ color: C.text }} className="font-semibold">
                            ${acc.balance.toLocaleString()}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      )}

      {/* Add Bank Button */}
      <View className="px-4">
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setViewMode('add-bank');
          }}
        >
          <View
            className="rounded-xl p-4 flex-row items-center justify-center"
            style={{
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              borderWidth: 1,
              borderColor: 'rgba(59, 130, 246, 0.3)',
              borderStyle: 'dashed',
            }}
          >
            <Link2 size={20} color="#3b82f6" />
            <Text className="text-blue-400 font-semibold ml-2">
              {linkedBanks.length > 0 ? 'Link Another Bank' : 'Link Your First Bank'}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* Manual Entry Option */}
      <View className="px-4 mt-4">
        <View
          className="rounded-xl p-4"
          style={{ backgroundColor: C.glass }}
        >
          <View className="flex-row items-center mb-2">
            <Info size={16} color="#6b7280" />
            <Text style={{ color: C.textFaint }} className="text-sm ml-2">{t('bankExtra.preferManual')}</Text>
          </View>
          <Text style={{ color: C.textFaint }} className="text-xs">
            You can continue adding transactions manually in the Dashboard.
            Bank linking is optional and can be set up later.
          </Text>
        </View>
      </View>
    </>
  );

  const renderAddBankView = () => (
    <>
      <View className="px-4 mb-4">
        <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-3">{t('bank.connectSection')}</Text>

        {/* One entry point, not a bank list. Choosing the institution happens in
            the provider's own secure flow, against the real, country-appropriate
            list — a local list could only ever be a shorter, staler copy. */}
        <Animated.View entering={FadeInUp.duration(300)}>
          <Pressable onPress={handleAddBank} disabled={isLoading}>
            <View
              className="rounded-xl p-4 flex-row items-center justify-between"
              style={{ backgroundColor: C.glass }}
            >
              <View className="flex-row items-center flex-1">
                <View
                  className="w-12 h-12 rounded-xl items-center justify-center mr-3"
                  style={{ backgroundColor: 'rgba(168,85,247,0.15)' }}
                >
                  <Building2 size={22} color={C.p500} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text }} className="font-medium">{t('bank.findYourBank')}</Text>
                  <Text style={{ color: C.textFaint }} className="text-xs mt-0.5">
{t('bank.findYourBankHint')}
                  </Text>
                </View>
              </View>
              {isLoading ? (
                <ActivityIndicator color={C.p500} />
              ) : (
                <ChevronRight size={20} color="#6b7280" />
              )}
            </View>
          </Pressable>
        </Animated.View>

        {linkedBanks.length > 0 && (
          <Text style={{ color: C.textFaint }} className="text-xs mt-3">
            {linkedBanks.length} bank{linkedBanks.length === 1 ? '' : 's'} already connected.
          </Text>
        )}
      </View>

      {/* Security Info */}
      <View className="px-4">
        <View
          className="rounded-xl p-4"
          style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)' }}
        >
          <View className="flex-row items-center mb-2">
            <Lock size={16} color={C.p500} />
            <Text className="text-purple-400 font-semibold ml-2">{t('bankExtra.howItWorks')}</Text>
          </View>
          <View className="gap-2">
            <View className="flex-row items-start">
              <Text style={{ color: C.textDim }} className="text-xs mr-2">1.</Text>
              <Text style={{ color: C.textDim }} className="text-xs flex-1">
                You'll be redirected to your bank's secure login page
              </Text>
            </View>
            <View className="flex-row items-start">
              <Text style={{ color: C.textDim }} className="text-xs mr-2">2.</Text>
              <Text style={{ color: C.textDim }} className="text-xs flex-1">
                Authorize read-only access to your transactions
              </Text>
            </View>
            <View className="flex-row items-start">
              <Text style={{ color: C.textDim }} className="text-xs mr-2">3.</Text>
              <Text style={{ color: C.textDim }} className="text-xs flex-1">
                We sync your transactions automatically
              </Text>
            </View>
          </View>
        </View>
      </View>
    </>
  );

  const renderBankDetailView = () => {
    if (!selectedBank) return null;

    const bankAccounts = linkedAccounts.filter(a => a.bankId === selectedBank.id);
    const consent = getConsentInfo(selectedBank);

    return (
      <>
        {/* Bank Header */}
        <View className="px-4 mb-4">
          <View
            className="rounded-xl p-4"
            style={{ backgroundColor: C.glass }}
          >
            <View className="flex-row items-center mb-4">
              <View
                className="w-14 h-14 rounded-xl items-center justify-center mr-4"
                style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)' }}
              >
                <Text className="text-3xl">{selectedBank.institutionLogo}</Text>
              </View>
              <View className="flex-1">
                <Text style={{ color: C.text }} className="text-lg font-bold">{selectedBank.institutionName}</Text>
                <Text style={{ color: C.textDim }} className="text-sm">
                  Connected since {new Date(selectedBank.lastSynced).toLocaleDateString()}
                </Text>
              </View>
            </View>

            <View className="flex-row gap-2">
              <Pressable
                onPress={handleSync}
                disabled={isSyncing}
                className="flex-1"
              >
                <View className="bg-blue-600 rounded-lg py-3 flex-row items-center justify-center">
                  <RefreshCw size={16} color="white" />
                  <Text style={{ color: C.text }} className="font-semibold ml-2">
                    {isSyncing ? 'Syncing...' : 'Sync Now'}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => handleDisconnectBank(selectedBank.id)}
                className="flex-1"
              >
                <View
                  className="rounded-lg py-3 flex-row items-center justify-center"
                  style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)' }}
                >
                  <Unlink size={16} color="#ef4444" />
                  <Text className="text-red-400 font-semibold ml-2">{t('bankExtra.disconnect')}</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Accounts */}
        <View className="px-4 mb-4">
          <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-3">{t('bankExtra.linkedAccounts')}</Text>

          {bankAccounts.map((account, idx) => (
            <Animated.View
              key={account.id}
              entering={FadeInUp.delay(100 * idx).duration(300)}
            >
              <View
                className="rounded-xl p-4 mb-2"
                style={{ backgroundColor: C.glass }}
              >
                <View className="flex-row items-center justify-between mb-2">
                  <View>
                    <Text style={{ color: C.text }} className="font-medium">{account.name}</Text>
                    <Text style={{ color: C.textFaint }} className="text-xs">{account.maskedNumber}</Text>
                  </View>
                  <Pressable
                    onPress={() => handleToggleAccount(account.id, !account.isEnabled)}
                  >
                    <View
                      className={`w-10 h-10 rounded-full items-center justify-center ${
                        account.isEnabled ? 'bg-green-500/20' : 'bg-gray-700'
                      }`}
                    >
                      {account.isEnabled ? (
                        <Eye size={18} color="#22c55e" />
                      ) : (
                        <EyeOff size={18} color="#6b7280" />
                      )}
                    </View>
                  </Pressable>
                </View>

                <View className="flex-row justify-between items-center">
                  <Text style={{ color: C.textDim }} className="text-xs">
                    {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
                  </Text>
                  <Text style={{ color: C.text }} className="text-lg font-bold">
                    ${account.balance.toLocaleString()}
                  </Text>
                </View>
              </View>
            </Animated.View>
          ))}
        </View>

        {/* Consent Info */}
        <View className="px-4">
          <Text style={{ color: C.textDim }} className="text-xs font-semibold mb-3">{t('bankExtra.dataAccess')}</Text>

          <View
            className="rounded-xl p-4"
            style={{ backgroundColor: C.glass }}
          >
            <View className="mb-3">
              <Text style={{ color: C.textDim }} className="text-sm font-medium mb-2">{t('misc.weAccess')}</Text>
              {consent.dataAccessed.map((item, idx) => (
                <View key={idx} className="flex-row items-center mb-1">
                  <Check size={14} color="#22c55e" />
                  <Text style={{ color: C.textDim }} className="text-sm ml-2">{item}</Text>
                </View>
              ))}
            </View>

            <View className="border-t border-gray-800 pt-3">
              <View className="flex-row items-center">
                <Clock size={14} color="#f59e0b" />
                <Text className="text-amber-400 text-xs ml-2">
                  Consent expires: {new Date(consent.expiresAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </>
    );
  };

  // Consent Modal — shown before handing off to the provider's secure flow,
  // where the user picks their actual institution.
  const renderConsentModal = () => {
    return (
      <Modal
        visible={showConsentModal}
        transparent
        animationType="slide"
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="rounded-t-3xl p-6" style={{ backgroundColor: C.bgRaise, paddingBottom: insets.bottom + 20 }}>
            <View className="items-center mb-6">
              <View
                className="w-16 h-16 rounded-2xl items-center justify-center mb-4"
                style={{ backgroundColor: 'rgba(168,85,247,0.15)' }}
              >
                <Building2 size={30} color={C.p500} />
              </View>
              <Text style={{ color: C.text }} className="text-xl font-bold">{t('bank.consentTitle')}</Text>
              <Text style={{ color: C.textDim }} className="text-sm mt-1 text-center">
{t('bank.consentSubtitle')}
              </Text>
            </View>

            <View className="mb-6">
              <Text style={{ color: C.textDim }} className="text-sm text-center mb-4">
                By connecting, you authorize Budget to:
              </Text>

              <View className="gap-3">
                <View className="flex-row items-center">
                  <View className="w-8 h-8 rounded-full bg-green-500/20 items-center justify-center mr-3">
                    <Check size={16} color="#22c55e" />
                  </View>
                  <Text style={{ color: C.textDim }} className="flex-1">{t('bankExtra.viewBalances')}</Text>
                </View>

                <View className="flex-row items-center">
                  <View className="w-8 h-8 rounded-full bg-green-500/20 items-center justify-center mr-3">
                    <Check size={16} color="#22c55e" />
                  </View>
                  <Text style={{ color: C.textDim }} className="flex-1">{t('bankExtra.readHistory')}</Text>
                </View>

                <View className="flex-row items-center">
                  <View className="w-8 h-8 rounded-full bg-red-500/20 items-center justify-center mr-3">
                    <AlertTriangle size={16} color="#ef4444" />
                  </View>
                  <Text style={{ color: C.textFaint }} className="flex-1">{t('bankExtra.noPayments')}</Text>
                </View>
              </View>
            </View>

            <View
              className="rounded-xl p-3 mb-6"
              style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)' }}
            >
              <View className="flex-row items-center">
                <Lock size={16} color="#22c55e" />
                <Text className="text-green-400 text-sm ml-2 flex-1">
                  We never store your banking credentials
                </Text>
              </View>
            </View>

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setShowConsentModal(false)}
                className="flex-1"
              >
                <View className="bg-gray-800 rounded-xl py-4 items-center">
                  <Text style={{ color: C.textDim }} className="font-semibold">{t('common.cancel')}</Text>
                </View>
              </Pressable>

              <Pressable
                onPress={confirmBankConnection}
                className="flex-1"
              >
                <LinearGradient
                  colors={['#3b82f6', '#2563eb']}
                  style={{ borderRadius: 12, paddingVertical: 16, alignItems: 'center' }}
                >
                  <Text className="text-white font-semibold">{t('bankExtra.connectBank')}</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <View className="flex-1" style={{ backgroundColor: C.bg }}>
      {/* Header */}
      <LinearGradient
        colors={['#3b82f6', '#2563eb', '#1d4ed8']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 20,
          paddingHorizontal: 16,
        }}
      >
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (viewMode === 'main') {
                router.back();
              } else {
                setViewMode('main');
                setSelectedBank(null);
              }
            }}
            className="w-10 h-10 rounded-full bg-white/20 items-center justify-center"
          >
            <ArrowLeft size={20} color="white" />
          </Pressable>

          <View className="flex-1 items-center">
            <Text className="text-white text-lg font-bold">
              {viewMode === 'main' && 'Bank Linking'}
              {viewMode === 'add-bank' && 'Add Bank'}
              {viewMode === 'bank-detail' && selectedBank?.institutionName}
            </Text>
            <Text className="text-white/70 text-xs mt-1">
              {viewMode === 'main' && 'Securely connect your accounts'}
              {viewMode === 'add-bank' && 'Choose your bank'}
              {viewMode === 'bank-detail' && 'Manage connection'}
            </Text>
          </View>

          <View className="w-10 h-10 items-center justify-center">
            <Building2 size={20} color="white" />
          </View>
        </View>
      </LinearGradient>

      {isLoading && (
        <View className="absolute inset-0 bg-black/50 items-center justify-center z-50">
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      )}

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}
      >
        {viewMode === 'main' && renderMainView()}
        {viewMode === 'add-bank' && renderAddBankView()}
        {viewMode === 'bank-detail' && renderBankDetailView()}
      </ScrollView>

      {renderConsentModal()}
    </View>
  );
}
