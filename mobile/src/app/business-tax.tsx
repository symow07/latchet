import { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { getBusiness, updateBusiness } from '@/lib/businessApi';
import { useSession } from '@/lib/auth/use-session';
import { R, useB } from '@/lib/design';
import { Txt, GlassCard, BubbleButton, BizBackground, IconBubble } from '@/components/ui';
import { t } from '@/lib/i18n/core';
import { monthNames, normaliseFiscalMonth } from '@/lib/fiscal-year';

/**
 * VAT number, tax id, and when the fiscal year starts.
 *
 * Nothing here is validated beyond a length cap. VAT and tax identifiers have
 * a different shape in every country the app ships to, and a format check that
 * is wrong for the user's country is worse than none: it blocks a number that
 * is correct. The backend caps length and stores what it is given.
 */
export default function BusinessTaxScreen() {
  const B = useB();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const { data: business, isLoading } = useQuery({ queryKey: ['business'], queryFn: getBusiness });
  const isOwner = !!business && business.ownerId === session?.user?.id;

  const [vat, setVat] = useState<string | null>(null);
  const [taxId, setTaxId] = useState<string | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [err, setErr] = useState('');

  const vatValue = vat ?? business?.vatNumber ?? '';
  const taxIdValue = taxId ?? business?.taxId ?? '';
  const monthValue = month ?? business?.fiscalYearStartMonth ?? null;

  const mutation = useMutation({
    mutationFn: () =>
      updateBusiness({
        vatNumber: vatValue,
        taxId: taxIdValue,
        // The picker uses 0 for "cleared"; the backend accepts 1-12 or null,
        // and would reject 0 outright.
        fiscalYearStartMonth: normaliseFiscalMonth(monthValue),
      }),
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

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder: string) => (
    <>
      <Txt weight="semibold" size={11} color={B.textFaint} style={{ letterSpacing: 1.2, marginBottom: 8 }}>{label}</Txt>
      <TextInput
        value={value}
        onChangeText={(v) => { onChange(v); setErr(''); }}
        editable={isOwner}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor={B.textFaint}
        selectionColor={B.accent}
        style={{ color: isOwner ? B.text : B.textDim, fontSize: 16, fontFamily: 'PlusJakartaSans_600SemiBold', backgroundColor: B.glass, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: B.glassBorder, marginBottom: 18 }}
      />
    </>
  );

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
            <Txt weight="bold" size={22} color={B.text}>{t('bizSettings.taxLabel')}</Txt>
          </View>
        </View>

        {isLoading ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}><ActivityIndicator color={B.accent} /></View>
        ) : !business ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
            <GlassCard padding={18} radius={R.md}><Txt size={14} color={B.textDim}>{t('bizSettings.noBusiness')}</Txt></GlassCard>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
            <View style={{ alignItems: 'center', marginBottom: 22 }}>
              <IconBubble color={B.teal} size={64} radius={22}><FileText size={28} color={B.teal} /></IconBubble>
            </View>

            {field(t('bizSettings.vatLabel'), vatValue, (v) => setVat(v), t('bizSettings.vatPlaceholder'))}
            {field(t('bizSettings.taxIdLabel'), taxIdValue, (v) => setTaxId(v), t('bizSettings.taxIdPlaceholder'))}

            <Txt weight="semibold" size={11} color={B.textFaint} style={{ letterSpacing: 1.2, marginBottom: 8 }}>
              {t('bizSettings.fiscalYearLabel')}
            </Txt>
            <GlassCard padding={6} radius={R.md} style={{ marginBottom: 8 }}>
              {monthNames().map((label, index) => {
                const value = index + 1;
                const active = monthValue === value;
                return (
                  <Pressable
                    key={label}
                    onPress={() => {
                      if (!isOwner) return;
                      Haptics.selectionAsync();
                      // Tapping the selected month clears it: "not set" is a
                      // real answer, and there is nowhere else to express it.
                      setMonth(active ? 0 : value);
                      setErr('');
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 11,
                      paddingHorizontal: 10,
                      borderBottomWidth: index < 11 ? 1 : 0,
                      borderBottomColor: B.glassBorder,
                    }}
                  >
                    <Txt size={15} color={active ? B.text : B.textFaint}>{label}</Txt>
                    {active && <Check size={18} color={B.teal} />}
                  </Pressable>
                );
              })}
            </GlassCard>
            <Txt size={11} color={B.textFaint} style={{ marginBottom: 20 }}>{t('bizSettings.fiscalYearHint')}</Txt>

            {err ? (
              <GlassCard padding={12} radius={R.md} tint={`${B.red}12`} border={`${B.red}2a`} style={{ marginBottom: 14 }}>
                <Txt size={13} color={B.red}>{err}</Txt>
              </GlassCard>
            ) : null}

            {isOwner ? (
              <BubbleButton
                label={mutation.isPending ? t('common.saving') : t('common.save')}
                onPress={() => mutation.mutate()}
                disabled={mutation.isPending}
                radius={R.md}
                colors={[B.accentDeep, B.accent]}
                glowColor={B.accent}
              />
            ) : (
              <GlassCard padding={14} radius={R.md}><Txt size={13} color={B.textDim}>{t('bizSettings.ownerOnly')}</Txt></GlassCard>
            )}
          </View>
        )}
      </ScrollView>
    </BizBackground>
  );
}
