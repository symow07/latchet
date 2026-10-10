import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { getBusiness, updateBusiness } from '@/lib/businessApi';
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

  const save = useMutation({
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

  return (
    <Screen pal={B}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <SubHeader pal={B} title={t('bizSettings.taxLabel')} onBack={() => router.back()} />

        {isLoading ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <ActivityIndicator color={B.accent} />
          </View>
        ) : !business ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
            <Card pal={B}>
              <Type role="body" color={B.inkDim}>
                {t('bizSettings.noBusiness')}
              </Type>
            </Card>
          </View>
        ) : (
          <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
            <View style={{ alignItems: 'center' }}>
              <IconTile pal={B} size={64} style={{ borderRadius: 20 }}>
                <FileText size={28} color={B.accent} strokeWidth={S.stroke} />
              </IconTile>
            </View>

            <Field
              pal={B}
              label={t('bizSettings.vatLabel')}
              value={vatValue}
              onChangeText={(v) => {
                setVat(v);
                setErr('');
              }}
              editable={isOwner}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={t('bizSettings.vatPlaceholder')}
              style={{ marginTop: S.section }}
            />

            <Field
              pal={B}
              label={t('bizSettings.taxIdLabel')}
              value={taxIdValue}
              onChangeText={(v) => {
                setTaxId(v);
                setErr('');
              }}
              editable={isOwner}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={t('bizSettings.taxIdPlaceholder')}
              style={{ marginTop: 16 }}
            />

            <Type role="meta" color={B.inkDim} style={{ marginTop: 24, marginBottom: 8 }}>
              {t('bizSettings.fiscalYearLabel')}
            </Type>
            <Card pal={B} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
              {monthNames().map((label, index) => {
                const value = index + 1;
                const active = monthValue === value;
                return (
                  <PressableScale
                    key={label}
                    onPress={
                      isOwner
                        ? () => {
                            // Tapping the selected month clears it: "not set"
                            // is a real answer, and there is nowhere else to
                            // express it.
                            setMonth(active ? 0 : value);
                            setErr('');
                          }
                        : undefined
                    }
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={label}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      minHeight: 52,
                      ...(index > 0 ? { borderTopWidth: 1, borderTopColor: B.hairline } : null),
                    }}
                  >
                    <Type role="body" color={active ? B.ink : B.inkDim}>
                      {label}
                    </Type>
                    {active ? (
                      <Check size={18} color={B.accent} strokeWidth={2.2} />
                    ) : null}
                  </PressableScale>
                );
              })}
            </Card>
            <Type role="meta" color={B.inkDim} style={{ marginTop: 12 }}>
              {t('bizSettings.fiscalYearHint')}
            </Type>

            <FormError pal={B} message={err} />

            {isOwner ? (
              <PrimaryButton
                pal={B}
                label={save.isPending ? t('common.saving') : t('common.save')}
                onPress={() => save.mutate()}
                disabled={save.isPending}
                style={{ marginTop: 24 }}
              />
            ) : (
              <Card pal={B} style={{ marginTop: 24 }}>
                <Type role="body" color={B.inkDim}>
                  {t('bizSettings.ownerOnly')}
                </Type>
              </Card>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
