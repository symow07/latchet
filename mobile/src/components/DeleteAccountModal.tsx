import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, ExternalLink } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { t } from '@/lib/i18n/core';
import { S, useC, type Palette } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  Card,
  Field,
  FormError,
  IconTile,
  InfoRow,
  PrimaryButton,
  Screen,
  Sheet,
  SubHeader,
  Type,
} from '@/components/kit';
import {
  deleteAccount,
  fetchDeletionPreview,
  type DeletionPreview,
  type UnrevokedGrant,
} from '@/lib/accountApi';
import { signOutAndClear } from '@/lib/user-session';
import { useSignOutDeps } from '@/lib/use-sign-out';
import { flushBeforeSignOut } from '@/lib/cloud-sync';

/**
 * Account deletion, with the consequences shown before the user commits.
 *
 * A full-screen sheet rather than `Alert.alert` because deletion is
 * irreversible and takes a typed confirmation — `Alert.prompt` is iOS-only,
 * and a single destructive button is too easy to hit by accident for
 * something with no undo.
 *
 * Every string in here was once hard-coded white, painted on `C.bgRaise`.
 * That token came to resolve to the light card surface, so the entire dialog
 * — the warning, the counts, the confirmation prompt, the button label — was
 * white text on a white sheet. On the one screen in the app where the user
 * has to read carefully before agreeing.
 *
 * It stays a native page sheet rather than the kit's `Sheet`: it is a whole
 * scrolling flow with a typed confirmation, not a short panel. The deletion
 * itself is the one destructive control, so it is set in `negative` and says
 * what it does in words — never an espresso primary button, which would make
 * the irreversible choice the screen's anchor.
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
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const signOutDeps = useSignOutDeps();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
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
    setDeleteError('');
    load();
  }, [visible, load]);

  const confirmed =
    !!preview && typed.trim().toLowerCase() === preview.email.trim().toLowerCase();

  const handleDelete = async () => {
    if (!confirmed || deleting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setDeleting(true);
    setDeleteError('');
    try {
      const result = await deleteAccount(typed.trim());

      // The advisor profile is device-only, so the server's cascade cannot
      // reach it — deleting the account server-side would otherwise leave a
      // health profile sitting in local SQLite belonging to an account that no
      // longer exists. Best-effort: the account IS gone either way, and
      // failing the whole flow over local cleanup would be worse.
      try {
        const { deleteHealthProfile } = await import('@/lib/health-profile');
        await deleteHealthProfile();
      } catch (e) {
        console.warn('[delete-account] local advisor profile not cleared:', e);
      }

      // Then everything else of this user's on the phone: their database file,
      // their per-user keys, the cached queries, and the session. Nothing is
      // sent and nothing needs confirming — the account the changes would go
      // to no longer exists — so the flush only stops sync, so that no cycle
      // runs against the deleted account or races the database's deletion.
      // The server sign-out may well be refused for the same reason, which
      // signOutAndClear tolerates.
      if (signOutDeps) {
        await signOutAndClear({
          ...signOutDeps,
          drainPending: undefined,
          flush: () => flushBeforeSignOut({ send: false }),
          confirmDiscard: async () => true,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDeleted(result.unrevoked);
    } catch (e) {
      console.error('[delete-account] failed:', e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setDeleteError(t('deleteAccount.deleteFailed'));
      setDeleting(false);
    }
  };

  const countLine = (label: string, value: number) =>
    value > 0 ? <InfoRow key={label} pal={C} title={label} amount={value} format={String} /> : null;

  const counts = preview
    ? [
        countLine(t('deleteAccount.transactions'), preview.transactions),
        countLine(t('deleteAccount.accounts'), preview.accounts),
        countLine(t('deleteAccount.linkedBanks'), preview.linkedBanks),
        countLine(t('deleteAccount.connectedInboxes'), preview.connectedInboxes),
      ].filter(Boolean)
    : [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <Screen pal={C}>
        <SubHeader
          pal={C}
          title={t('deleteAccount.title')}
          onBack={onClose}
          style={{ marginTop: 14 }}
        />

        <ScrollView
          contentContainerStyle={{ paddingTop: 24, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : loadError ? (
            <View style={{ paddingHorizontal: S.screen }}>
              <Type role="body" color={C.negative}>
                {loadError}
              </Type>
              <PrimaryButton
                pal={C}
                label={t('common.retry')}
                onPress={load}
                variant="secondary"
                style={{ marginTop: 18 }}
              />
            </View>
          ) : preview ? (
            <View style={{ paddingHorizontal: S.screen }}>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <IconTile pal={C}>
                  <AlertTriangle size={19} color={C.negative} strokeWidth={S.stroke} />
                </IconTile>
                <Type role="body" color={C.ink} style={{ flex: 1 }}>
                  {t('deleteAccount.intro')}
                </Type>
              </View>

              <Type role="cardTitle" color={C.ink} style={{ marginTop: 26, marginBottom: 12 }}>
                {t('deleteAccount.whatGetsDeleted')}
              </Type>
              {counts.length > 0 ? (
                <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                  {counts.map((child, i) => (
                    <View
                      key={i}
                      style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
                    >
                      {child}
                    </View>
                  ))}
                </Card>
              ) : null}
              <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
                {t('deleteAccount.plusRest')}
              </Type>

              {/* An owner deleting their account takes the whole group with
                  them. Nobody should discover that afterwards — and someone
                  who owns both a company and a household gets told about
                  both, which is why this maps rather than testing one field. */}
              {preview.ownedGroups.map((group) => (
                <Card key={group.id} pal={C} style={{ marginTop: 16 }}>
                  <Type role="cardTitle" color={C.negative}>
                    {t('deleteAccount.groupWarningTitle', { name: group.name })}
                  </Type>
                  <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
                    {group.type === 'household'
                      ? t('deleteAccount.ownedHouseholdBody', { members: group.members })
                      : t('deleteAccount.ownedBusinessBody', {
                          expenses: group.expenses,
                          members: group.members,
                        })}
                  </Type>
                </Card>
              ))}

              {preview.linkedBanks > 0 ? (
                <Type role="meta" color={C.inkDim} style={{ marginTop: 16 }}>
                  {t('deleteAccount.revokeNote')}
                </Type>
              ) : null}

              <Field
                pal={C}
                label={t('deleteAccount.typeToConfirm', { email: preview.email })}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder={t('deleteAccount.confirmPlaceholder')}
                accessibilityLabel={t('deleteAccount.confirmPrompt', { email: preview.email })}
                style={{ marginTop: 28 }}
              />

              <FormError pal={C} message={deleteError} />

              {/* The one destructive control: a red label on a lifted,
                  card-coloured button once the typed email matches; the kit's
                  sunk "off" pair until then. */}
              <PrimaryButton
                pal={C}
                variant="destructive"
                label={t('deleteAccount.confirmButton')}
                onPress={handleDelete}
                disabled={!confirmed || deleting}
                style={{ marginTop: 20 }}
              />
              {deleting ? <ActivityIndicator color={C.accent} style={{ marginTop: 14 }} /> : null}

              <PressableScale
                onPress={deleting ? undefined : onClose}
                accessibilityRole="button"
                accessibilityLabel={t('deleteAccount.keepAccount')}
                style={{
                  minHeight: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 6,
                }}
              >
                <Type role="cardTitle" color={C.inkDim}>
                  {t('deleteAccount.keepAccount')}
                </Type>
              </PressableScale>
            </View>
          ) : null}
        </ScrollView>
      </Screen>
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
  const C: Palette = useC();
  const insets = useSafeAreaInsets();
  if (grants.length === 0) return null;

  return (
    <Sheet pal={C} visible onClose={onDismiss} title={t('deleteAccount.deletedTitle')}>
      <View style={{ paddingHorizontal: S.card, paddingBottom: insets.bottom > 0 ? 0 : 8 }}>
        <Type role="body" color={C.inkDim}>
          {t('deleteAccount.manualRevoke')}
        </Type>

        <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }} style={{ marginTop: 18 }}>
          {grants.map((g, i) => (
            <View
              key={`${g.kind}-${i}`}
              style={i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : undefined}
            >
              <InfoRow
                pal={C}
                title={g.label}
                meta={t(g.kind === 'email' ? 'deleteAccount.inboxConnection' : 'deleteAccount.bankConnection')}
                onPress={() => Linking.openURL(g.manualRevokeUrl).catch(() => {})}
                trailing={<ExternalLink size={17} color={C.inkFaint} strokeWidth={S.stroke} />}
              />
            </View>
          ))}
        </Card>

        <PrimaryButton
          pal={C}
          label={t('common.done')}
          onPress={onDismiss}
          style={{ marginTop: 22 }}
        />
      </View>
    </Sheet>
  );
}
