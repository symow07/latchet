import { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { getBusiness, updateBusiness } from '@/lib/businessApi';
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

  // Seeded from the server the first time it arrives, then left alone so a
  // background refetch cannot overwrite what the user is typing.
  const nameValue = name ?? business?.name ?? '';
  const addressValue = address ?? business?.address ?? '';

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
            <GlassCard padding={18} radius={R.md}>
              <Txt size={14} color={B.textDim}>{t('bizSettings.noBusiness')}</Txt>
            </GlassCard>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
            <View style={{ alignItems: 'center', marginBottom: 22 }}>
              <IconBubble color={B.accent} size={64} radius={22}><Building2 size={28} color={B.accent} /></IconBubble>
            </View>

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
          </View>
        )}
      </ScrollView>
    </BizBackground>
  );
}
