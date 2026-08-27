import { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Trash2, ImageIcon, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  createBusiness, deleteBusiness, getBusiness, updateBusiness, uploadLogo, removeLogo,
} from '@/lib/businessApi';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Image } from 'expo-image';
import { receiptSource } from '@/lib/receipt-image';
import { useSession } from '@/lib/auth/use-session';
import { R, useB } from '@/lib/design';
import { Txt, GlassCard, BubbleButton, BizBackground, IconBubble } from '@/components/ui';
import { t } from '@/lib/i18n/core';

/**
 * The company's name and address.
 *
 * Owner-only, and the backend enforces that independently — the read-only mode
 * here is so a manager is told why rather than shown a form that 403s on save.
 *
 * No logo, despite what this row used to promise. Adding one the way expense
 * receipts work would store a device-local file:// path, which nobody else on
 * the team could load; a real logo needs file hosting the app does not have.
 */
export default function BusinessProfileScreen() {
  const B = useB();
  const insets = useSafeAreaInsets();
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

  const mutation = useMutation({
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

  return (
    <BizBackground style={{ paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
            hitSlop={12}
            style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: B.glass, alignItems: 'center', justifyContent: 'center' }}
          >
            <ArrowLeft size={20} color={B.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Txt weight="bold" size={12} color={B.accent} style={{ letterSpacing: 1.6 }}>{t('business.label')}</Txt>
            <Txt weight="bold" size={22} color={B.text}>{t('bizSettings.companyLabel')}</Txt>
          </View>
        </View>

        {isLoading ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}><ActivityIndicator color={B.accent} /></View>
        ) : !business ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <IconBubble color={B.accent} size={64} radius={22}><Building2 size={28} color={B.accent} /></IconBubble>
            </View>
            <Txt weight="bold" size={18} color={B.text} style={{ textAlign: 'center', marginBottom: 8 }}>
              {t('bizSettings.createTitle')}
            </Txt>
            <Txt size={13} color={B.textFaint} style={{ textAlign: 'center', lineHeight: 19, marginBottom: 22 }}>
              {t('bizSettings.createBody')}
            </Txt>
            {err ? (
              <GlassCard padding={12} radius={R.md} tint={`${B.red}12`} border={`${B.red}2a`} style={{ marginBottom: 14 }}>
                <Txt size={13} color={B.red}>{err}</Txt>
              </GlassCard>
            ) : null}
            <BubbleButton
              label={create.isPending ? t('bizSettings.creating') : t('bizSettings.createButton')}
              onPress={() => create.mutate()}
              disabled={create.isPending}
              radius={R.md}
              colors={[B.accentDeep, B.accent]}
              glowColor={B.accent}
            />
          </View>
        ) : (
          <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
              {business.logoUrl ? (
                <Image
                  source={receiptSource(business.logoUrl)!}
                  style={{ width: 84, height: 84, borderRadius: 24, borderWidth: 1, borderColor: B.glassBorder }}
                  contentFit="cover"
                  // The path never changes when the logo does, so a cached
                  // copy would survive a replacement. The updatedAt stamp is
                  // what makes the new one load.
                  cachePolicy="none"
                />
              ) : (
                <IconBubble color={B.accent} size={84} radius={24}><Building2 size={34} color={B.accent} /></IconBubble>
              )}
            </View>

            {isOwner && (
              <View style={{ alignItems: 'center', marginBottom: 22 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); logo.mutate(); }}
                    disabled={logo.isPending}
                    style={({ pressed }) => ({ opacity: pressed || logo.isPending ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${B.accent}12`, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: `${B.accent}2a` })}
                  >
                    <ImageIcon size={13} color={B.accent} />
                    <Txt weight="semibold" size={12} color={B.accent}>
                      {business.logoUrl ? t('bizSettings.replaceLogo') : t('bizSettings.addLogo')}
                    </Txt>
                  </Pressable>
                  {business.logoUrl && (
                    <Pressable
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); clearLogo.mutate(); }}
                      disabled={clearLogo.isPending}
                      style={({ pressed }) => ({ opacity: pressed || clearLogo.isPending ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${B.red}12`, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: `${B.red}2a` })}
                    >
                      <X size={13} color={B.red} />
                      <Txt weight="semibold" size={12} color={B.red}>{t('bizSettings.removeLogo')}</Txt>
                    </Pressable>
                  )}
                </View>
                <Txt size={11} color={B.textFaint} style={{ marginTop: 8 }}>{t('bizSettings.logoHint')}</Txt>
              </View>
            )}

            <Txt weight="semibold" size={11} color={B.textFaint} style={{ letterSpacing: 1.2, marginBottom: 8 }}>
              {t('bizSettings.companyNameLabel')}
            </Txt>
            <TextInput
              value={nameValue}
              onChangeText={(v) => { setName(v); setErr(''); }}
              editable={isOwner}
              placeholder={t('bizSettings.companyNamePlaceholder')}
              placeholderTextColor={B.textFaint}
              selectionColor={B.accent}
              style={{ color: isOwner ? B.text : B.textDim, fontSize: 16, fontFamily: 'PlusJakartaSans_600SemiBold', backgroundColor: B.glass, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: B.glassBorder, marginBottom: 18 }}
            />

            <Txt weight="semibold" size={11} color={B.textFaint} style={{ letterSpacing: 1.2, marginBottom: 8 }}>
              {t('bizSettings.addressLabel')}
            </Txt>
            <TextInput
              value={addressValue}
              onChangeText={(v) => { setAddress(v); setErr(''); }}
              editable={isOwner}
              multiline
              placeholder={t('bizSettings.addressPlaceholder')}
              placeholderTextColor={B.textFaint}
              selectionColor={B.accent}
              style={{ color: isOwner ? B.text : B.textDim, fontSize: 15, fontFamily: 'PlusJakartaSans_500Medium', backgroundColor: B.glass, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: B.glassBorder, textAlignVertical: 'top', minHeight: 88, marginBottom: 8 }}
            />
            <Txt size={11} color={B.textFaint} style={{ marginBottom: 20 }}>{t('bizSettings.addressHint')}</Txt>

            {err ? (
              <GlassCard padding={12} radius={R.md} tint={`${B.red}12`} border={`${B.red}2a`} style={{ marginBottom: 14 }}>
                <Txt size={13} color={B.red}>{err}</Txt>
              </GlassCard>
            ) : null}

            {isOwner ? (
              <BubbleButton
                label={mutation.isPending ? t('common.saving') : t('common.save')}
                onPress={() => { if (nameValue.trim()) mutation.mutate(); }}
                disabled={mutation.isPending || !nameValue.trim()}
                radius={R.md}
                colors={[B.accentDeep, B.accent]}
                glowColor={B.accent}
              />
            ) : (
              <GlassCard padding={14} radius={R.md}>
                <Txt size={13} color={B.textDim}>{t('bizSettings.ownerOnly')}</Txt>
              </GlassCard>
            )}

            {/* Danger zone — owner only, and folded away until asked for, so
                the destructive action is never one mis-tap from the save
                button it sits under. */}
            {isOwner && (
              <View style={{ marginTop: 40 }}>
                <Txt weight="bold" size={11} color={B.red} style={{ letterSpacing: 1.4, marginBottom: 10 }}>
                  {t('bizSettings.dangerZone')}
                </Txt>

                {!dangerOpen ? (
                  <Pressable
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setDangerOpen(true); }}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    <GlassCard padding={14} radius={R.md} tint={`${B.red}0e`} border={`${B.red}2a`}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Trash2 size={16} color={B.red} />
                        <Txt weight="semibold" size={14} color={B.red}>{t('bizSettings.deleteBusiness')}</Txt>
                      </View>
                    </GlassCard>
                  </Pressable>
                ) : (
                  <GlassCard padding={16} radius={R.md} tint={`${B.red}0e`} border={`${B.red}2a`}>
                    <Txt size={13} color={B.textDim} style={{ lineHeight: 19, marginBottom: 14 }}>
                      {t('bizSettings.deleteWarning')}
                    </Txt>
                    <Txt size={12} color={B.textFaint} style={{ marginBottom: 8 }}>
                      {t('bizSettings.typeNameToConfirm', { name: business.name })}
                    </Txt>
                    <TextInput
                      value={confirmName}
                      onChangeText={(v) => { setConfirmName(v); setErr(''); }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder={business.name}
                      placeholderTextColor={B.textFaint}
                      selectionColor={B.red}
                      style={{ color: B.text, fontSize: 15, fontFamily: 'PlusJakartaSans_600SemiBold', backgroundColor: B.glass, borderRadius: R.md, padding: 13, borderWidth: 1, borderColor: `${B.red}44`, marginBottom: 14 }}
                    />
                    <BubbleButton
                      label={remove.isPending ? t('bizSettings.deleting') : t('bizSettings.deleteConfirm')}
                      onPress={() => remove.mutate()}
                      // The server checks the name too; this only stops the
                      // request being sent while it obviously cannot succeed.
                      disabled={remove.isPending || confirmName.trim() !== business.name.trim()}
                      radius={R.md}
                      colors={[B.red, B.red]}
                      glowColor={B.red}
                    />
                  </GlassCard>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </BizBackground>
  );
}
