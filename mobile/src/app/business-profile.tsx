import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ImageIcon, X } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Image } from 'expo-image';
import {
  createBusiness,
  deleteBusiness,
  getBusiness,
  removeLogo,
  updateBusiness,
  uploadLogo,
} from '@/lib/businessApi';
import { receiptSource } from '@/lib/receipt-image';
import { useSession } from '@/lib/auth/use-session';
import { S, useB } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  Card,
  Field,
  FormError,
  IconTile,
  PrimaryButton,
  Screen,
  SubHeader,
  Type,
} from '@/components/kit';
import { t } from '@/lib/i18n/core';

/**
 * The company's name and address.
 *
 * Owner-only, and the backend enforces that independently — the read-only mode
 * here is so a manager is told why rather than shown a form that 403s on save.
 *
 * The two field labels were 11px semibold tracked out to 1.2pt, which §3 has
 * no style for; the danger zone was a red-tinted card inside a red-tinted card
 * with a red-bordered input and a solid red button, which is four separate
 * things all saying "careful" and none of them saying what will happen. The
 * warning sentence says it once now, and the confirm is a plain destructive
 * label under a typed name — the same pattern the household and account
 * deletions use.
 */
export default function BusinessProfileScreen() {
  const B = useB();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const { data: business, isLoading } = useQuery({
    queryKey: ['business'],
    queryFn: getBusiness,
  });

  const isOwner = !!business && business.ownerId === session?.user?.id;

  const [name, setName] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [dangerOpen, setDangerOpen] = useState(false);

  // Seeded from the server the first time it arrives, then left alone so a
  // background refetch cannot overwrite what the user is typing.
  const nameValue = name ?? business?.name ?? '';
  const addressValue = address ?? business?.address ?? '';

  /**
   * Recovery for an account that never got a business row.
   *
   * createBusiness runs once, when the account type is chosen, and a failure
   * there is only logged — which leaves a Business account with no business
   * and, until now, no way anywhere in the app to make one. Every business
   * screen just shows an empty state forever.
   */
  const create = useMutation({
    mutationFn: () => createBusiness(session?.user?.name ?? undefined),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['business'] });
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message);
    },
  });

  const logo = useMutation({
    mutationFn: async () => {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        // Square: it renders in a square well here and wherever the company is
        // shown, and cropping at pick time beats cropping at every render.
        aspect: [1, 1],
        quality: 0.8,
      });
      if (picked.canceled || !picked.assets?.[0]?.uri) return null;
      const base64 = await FileSystem.readAsStringAsync(picked.assets[0].uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return uploadLogo(base64);
    },
    onSuccess: (result) => {
      if (!result) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['business'] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const clearLogo = useMutation({
    mutationFn: removeLogo,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ['business'] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteBusiness(confirmName),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries();
      router.back();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message);
    },
  });

  const save = useMutation({
    mutationFn: () => updateBusiness({ name: nameValue.trim(), address: addressValue }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['business'] });
      router.back();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message);
    },
  });

  const canDelete = !!business && confirmName.trim() === business.name.trim();

  return (
    <Screen pal={B}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <SubHeader pal={B} title={t('bizSettings.companyLabel')} onBack={() => router.back()} />

        {isLoading ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <ActivityIndicator color={B.accent} />
          </View>
        ) : !business ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section, alignItems: 'center' }}>
            <IconTile pal={B} size={64} style={{ borderRadius: 20 }}>
              <Building2 size={28} color={B.accent} strokeWidth={S.stroke} />
            </IconTile>
            <Type role="section" color={B.ink} style={{ textAlign: 'center', marginTop: 16 }}>
              {t('bizSettings.createTitle')}
            </Type>
            <Type role="body" color={B.inkDim} style={{ textAlign: 'center', marginTop: 6 }}>
              {t('bizSettings.createBody')}
            </Type>
            <View style={{ alignSelf: 'stretch' }}>
              <FormError pal={B} message={err} />
              <PrimaryButton
                pal={B}
                label={create.isPending ? t('bizSettings.creating') : t('bizSettings.createButton')}
                onPress={() => create.mutate()}
                disabled={create.isPending}
                style={{ marginTop: 16 }}
              />
            </View>
          </View>
        ) : (
          <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
            <View style={{ alignItems: 'center' }}>
              {business.logoUrl ? (
                <Image
                  source={receiptSource(business.logoUrl)!}
                  style={{ width: 84, height: 84, borderRadius: 24 }}
                  contentFit="cover"
                  // The path never changes when the logo does, so a cached
                  // copy would survive a replacement. The updatedAt stamp is
                  // what makes the new one load.
                  cachePolicy="none"
                />
              ) : (
                <IconTile pal={B} size={84} style={{ borderRadius: 24 }}>
                  <Building2 size={34} color={B.accent} strokeWidth={S.stroke} />
                </IconTile>
              )}

              {isOwner ? (
                <>
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                    <PressableScale
                      onPress={logo.isPending ? undefined : () => logo.mutate()}
                      haptic="light"
                      accessibilityRole="button"
                      accessibilityLabel={
                        business.logoUrl ? t('bizSettings.replaceLogo') : t('bizSettings.addLogo')
                      }
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 7,
                        minHeight: 40,
                        paddingHorizontal: 16,
                        borderRadius: 999,
                        backgroundColor: B.groundSunk,
                        opacity: logo.isPending ? 0.6 : 1,
                      }}
                    >
                      <ImageIcon size={15} color={B.inkDim} strokeWidth={S.stroke} />
                      <Type role="meta" color={B.ink}>
                        {business.logoUrl ? t('bizSettings.replaceLogo') : t('bizSettings.addLogo')}
                      </Type>
                    </PressableScale>

                    {business.logoUrl ? (
                      <PressableScale
                        onPress={clearLogo.isPending ? undefined : () => clearLogo.mutate()}
                        haptic="light"
                        accessibilityRole="button"
                        accessibilityLabel={t('bizSettings.removeLogo')}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 7,
                          minHeight: 40,
                          paddingHorizontal: 16,
                          borderRadius: 999,
                          backgroundColor: B.groundSunk,
                          opacity: clearLogo.isPending ? 0.6 : 1,
                        }}
                      >
                        <X size={15} color={B.negative} strokeWidth={S.stroke} />
                        <Type role="meta" color={B.negative}>
                          {t('bizSettings.removeLogo')}
                        </Type>
                      </PressableScale>
                    ) : null}
                  </View>
                  <Type role="meta" color={B.inkDim} style={{ marginTop: 12 }}>
                    {t('bizSettings.logoHint')}
                  </Type>
                </>
              ) : null}
            </View>

            <Field
              pal={B}
              label={t('bizSettings.companyNameLabel')}
              value={nameValue}
              onChangeText={(v) => {
                setName(v);
                setErr('');
              }}
              editable={isOwner}
              placeholder={t('bizSettings.companyNamePlaceholder')}
              style={{ marginTop: S.section }}
            />

            <Field
              pal={B}
              label={t('bizSettings.addressLabel')}
              value={addressValue}
              onChangeText={(v) => {
                setAddress(v);
                setErr('');
              }}
              editable={isOwner}
              multiline
              placeholder={t('bizSettings.addressPlaceholder')}
              style={{ marginTop: 16 }}
            />
            <Type role="meta" color={B.inkDim} style={{ marginTop: 8 }}>
              {t('bizSettings.addressHint')}
            </Type>

            <FormError pal={B} message={err} />

            {isOwner ? (
              <PrimaryButton
                pal={B}
                label={save.isPending ? t('common.saving') : t('common.save')}
                onPress={() => {
                  if (nameValue.trim()) save.mutate();
                }}
                disabled={save.isPending || !nameValue.trim()}
                style={{ marginTop: 24 }}
              />
            ) : (
              <Card pal={B} style={{ marginTop: 24 }}>
                <Type role="body" color={B.inkDim}>
                  {t('bizSettings.ownerOnly')}
                </Type>
              </Card>
            )}

            {/* Danger zone — owner only, and folded away until asked for, so
                the destructive action is never one mis-tap from the save
                button it sits under. */}
            {isOwner ? (
              <View style={{ marginTop: 44 }}>
                <Type role="cardTitle" color={B.ink} style={{ marginBottom: 12 }}>
                  {t('bizSettings.dangerZone')}
                </Type>

                {!dangerOpen ? (
                  <PressableScale
                    onPress={() => setDangerOpen(true)}
                    haptic="light"
                    accessibilityRole="button"
                    accessibilityLabel={t('bizSettings.deleteBusiness')}
                    style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Type role="cardTitle" color={B.negative}>
                      {t('bizSettings.deleteBusiness')}
                    </Type>
                  </PressableScale>
                ) : (
                  <Card pal={B}>
                    <Type role="body" color={B.inkDim}>
                      {t('bizSettings.deleteWarning')}
                    </Type>
                    <Field
                      pal={B}
                      label={t('bizSettings.typeNameToConfirm', { name: business.name })}
                      value={confirmName}
                      onChangeText={(v) => {
                        setConfirmName(v);
                        setErr('');
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder={business.name}
                      style={{ marginTop: 16 }}
                    />
                    <PressableScale
                      // The server checks the name too; this only stops the
                      // request being sent while it obviously cannot succeed.
                      onPress={
                        canDelete && !remove.isPending ? () => remove.mutate() : undefined
                      }
                      haptic="light"
                      accessibilityRole="button"
                      accessibilityLabel={t('bizSettings.deleteConfirm')}
                      accessibilityState={{ disabled: !canDelete }}
                      style={{
                        minHeight: 48,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 12,
                        opacity: canDelete ? 1 : 0.4,
                      }}
                    >
                      <Type role="cardTitle" color={B.negative}>
                        {remove.isPending
                          ? t('bizSettings.deleting')
                          : t('bizSettings.deleteConfirm')}
                      </Type>
                    </PressableScale>
                  </Card>
                )}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
