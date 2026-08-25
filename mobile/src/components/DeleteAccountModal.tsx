import { View, Modal, Pressable, TextInput, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, X, ExternalLink } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Txt, GlassCard } from '@/components/ui';
import { t } from '@/lib/i18n/core';
import { useC } from '@/lib/design';
import {
  fetchDeletionPreview,
  deleteAccount,
  type DeletionPreview,
  type UnrevokedGrant,
} from '@/lib/accountApi';

/**
 * Account deletion, with the consequences shown before the user commits.
 *
 * A modal rather than Alert.alert because deletion is irreversible and takes a
 * typed confirmation — Alert.prompt is iOS-only, and a single destructive
 * button is too easy to hit by accident for something with no undo.
 */
export function DeleteAccountModal({
  visible,
  onClose,
  onDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  onDeleted: (unrevoked: UnrevokedGrant[]) => void;
}) {
  const C = useC();
  const insets = useSafeAreaInsets();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setPreview(await fetchDeletionPreview());
    } catch (e) {
      console.error('[delete-account] preview failed:', e);
      setLoadError(t('deleteAccount.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setTyped('');
    setDeleteError(null);
    load();
  }, [visible, load]);

  const confirmed =
    !!preview && typed.trim().toLowerCase() === preview.email.trim().toLowerCase();

  const handleDelete = async () => {
    if (!confirmed || deleting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteAccount(typed.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDeleted(result.unrevoked);
    } catch (e) {
      console.error('[delete-account] failed:', e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setDeleteError(t('deleteAccount.deleteFailed'));
      setDeleting(false);
    }
  };

  const line = (label: string, value: number) =>
    value > 0 ? (
      <View className="flex-row justify-between" style={{ marginTop: 4 }}>
        <Txt size={13} color="rgba(255,255,255,0.55)">{label}</Txt>
        <Txt size={13} weight="semibold" color="#fff">{value}</Txt>
      </View>
    ) : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: '#0b0b0f',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingBottom: insets.bottom + 16,
            maxHeight: '92%',
          }}
        >
          <View className="flex-row items-center justify-between" style={{ padding: 20, paddingBottom: 8 }}>
            <View className="flex-row items-center" style={{ gap: 10 }}>
              <AlertTriangle size={22} color="#ef4444" />
              <Txt weight="bold" size={19} color="#fff">{t('deleteAccount.title')}</Txt>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('common.close')}>
              <X size={22} color="rgba(255,255,255,0.5)" />
            </Pressable>
          </View>

          <ScrollView style={{ paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled">
            {loading ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator color="#ef4444" />
              </View>
            ) : loadError ? (
              <View style={{ paddingVertical: 24 }}>
                <Txt size={14} color="#f87171">{loadError}</Txt>
                <Pressable onPress={load} style={{ marginTop: 14 }}>
                  <GlassCard padding={12}>
                    <Txt weight="semibold" size={14} color="#fff" style={{ textAlign: 'center' }}>
{t('common.retry')}
                    </Txt>
                  </GlassCard>
                </Pressable>
              </View>
            ) : preview ? (
              <>
                <Txt size={14} color="rgba(255,255,255,0.7)" style={{ lineHeight: 20 }}>
{t('deleteAccount.intro')}
                </Txt>

                <View style={{ marginTop: 16 }}>
                  <GlassCard padding={14}>
                    <Txt size={11} weight="semibold" color="rgba(255,255,255,0.45)">
{t('deleteAccount.whatGetsDeleted')}
                    </Txt>
                    {line(t('deleteAccount.transactions'), preview.transactions)}
                    {line(t('deleteAccount.accounts'), preview.accounts)}
                    {line(t('deleteAccount.linkedBanks'), preview.linkedBanks)}
                    {line(t('deleteAccount.connectedInboxes'), preview.connectedInboxes)}
                    <Txt size={12} color="rgba(255,255,255,0.4)" style={{ marginTop: 8, lineHeight: 17 }}>
{t('deleteAccount.plusRest')}
                    </Txt>
                  </GlassCard>
                </View>

                {/* An owner deleting their account takes the whole business with
                    them. Nobody should discover that afterwards. */}
                {preview.ownedBusiness && (
                  <View style={{ marginTop: 12 }}>
                    <GlassCard padding={14} tint="rgba(239,68,68,0.1)" border="rgba(239,68,68,0.28)">
                      <Txt weight="semibold" size={14} color="#f87171">
{t('deleteAccount.businessWarningTitle', { name: preview.ownedBusiness.name })}
                      </Txt>
                      <Txt size={13} color="rgba(255,255,255,0.7)" style={{ marginTop: 6, lineHeight: 19 }}>
                        You own this business, so deleting your account removes it entirely —
                        including {preview.ownedBusiness.expenses} expense
                        {preview.ownedBusiness.expenses === 1 ? '' : 's'} and access for{' '}
                        {preview.ownedBusiness.teamMembers} other team member
                        {preview.ownedBusiness.teamMembers === 1 ? '' : 's'}. Their records go too.
                      </Txt>
                    </GlassCard>
                  </View>
                )}

                {(preview.linkedBanks > 0 || preview.connectedInboxes > 0) && (
                  <Txt size={12} color="rgba(255,255,255,0.45)" style={{ marginTop: 12, lineHeight: 18 }}>
{t('deleteAccount.revokeNote')}
                  </Txt>
                )}

                <Txt size={13} color="rgba(255,255,255,0.7)" style={{ marginTop: 20 }}>
                  Type <Txt weight="bold" size={13} color="#fff">{preview.email}</Txt> to confirm.
                </Txt>
                <TextInput
                  value={typed}
                  onChangeText={setTyped}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder={t('deleteAccount.confirmPlaceholder')}
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  accessibilityLabel={t('deleteAccount.confirmPrompt', { email: preview.email })}
                  style={{
                    marginTop: 8,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    color: '#fff',
                    fontSize: 15,
                    backgroundColor: C.glass,
                    borderWidth: 1,
                    borderColor: confirmed ? '#ef4444' : 'rgba(255,255,255,0.1)',
                  }}
                />

                {deleteError && (
                  <Txt size={13} color="#f87171" style={{ marginTop: 10 }}>{deleteError}</Txt>
                )}

                <Pressable
                  onPress={handleDelete}
                  disabled={!confirmed || deleting}
                  accessibilityRole="button"
                  style={{
                    marginTop: 16,
                    borderRadius: 14,
                    paddingVertical: 15,
                    alignItems: 'center',
                    backgroundColor: confirmed && !deleting ? '#ef4444' : 'rgba(255,255,255,0.07)',
                  }}
                >
                  {deleting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Txt
                      weight="bold"
                      size={15}
                      color={confirmed ? '#fff' : 'rgba(255,255,255,0.35)'}
                    >
{t('deleteAccount.confirmButton')}
                    </Txt>
                  )}
                </Pressable>

                <Pressable onPress={onClose} disabled={deleting} style={{ paddingVertical: 14, alignItems: 'center' }}>
                  <Txt size={14} color="rgba(255,255,255,0.55)">{t('deleteAccount.keepAccount')}</Txt>
                </Pressable>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Shown after deletion when a third-party grant could not be revoked. The
 * account is gone either way; these need revoking by hand.
 */
export function UnrevokedGrantsNotice({
  grants,
  onDismiss,
}: {
  grants: UnrevokedGrant[];
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (grants.length === 0) return null;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onDismiss}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#0b0b0f', borderRadius: 20, padding: 20, paddingBottom: insets.bottom + 20 }}>
          <Txt weight="bold" size={18} color="#fff">{t('deleteAccount.deletedTitle')}</Txt>
          <Txt size={14} color="rgba(255,255,255,0.7)" style={{ marginTop: 10, lineHeight: 20 }}>
            Your account and data are gone. We couldn&apos;t automatically revoke everything
            though — please disconnect these yourself:
          </Txt>

          {grants.map((g, i) => (
            <Pressable
              key={`${g.kind}-${i}`}
              onPress={() => Linking.openURL(g.manualRevokeUrl).catch(() => {})}
              style={{ marginTop: 12 }}
            >
              <GlassCard padding={12}>
                <View className="flex-row items-center justify-between">
                  <View style={{ flex: 1 }}>
                    <Txt weight="semibold" size={14} color="#fff">{g.label}</Txt>
                    <Txt size={12} color="rgba(255,255,255,0.45)" style={{ marginTop: 2 }}>
                      {g.kind === 'bank' ? t('deleteAccount.bankConnection') : t('deleteAccount.inboxConnection')}
                    </Txt>
                  </View>
                  <ExternalLink size={18} color="rgba(255,255,255,0.5)" />
                </View>
              </GlassCard>
            </Pressable>
          ))}

          <Pressable onPress={onDismiss} style={{ marginTop: 18, paddingVertical: 12, alignItems: 'center' }}>
            <Txt weight="semibold" size={15} color="#fff">{t('common.done')}</Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
