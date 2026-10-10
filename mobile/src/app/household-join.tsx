import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck, X } from '@/components/icons';
import { joinHousehold, previewInvite, type JoinPreview } from '@/lib/householdApi';
import { S, useC, type Palette } from '@/lib/design';
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
 * Joining a household, in two deliberate steps.
 *
 * Step one looks the code up and shows what joining costs. Step two accepts.
 * They are separate screens' worth of state on purpose: a single "enter code
 * and join" button would make consent a side effect of typing.
 *
 * The shared/not-shared lists are rendered from the SERVER's response, not
 * from a local copy of them. If the server's idea of what joining reveals ever
 * changes, this screen changes with it — a hardcoded list would keep promising
 * the old terms.
 *
 * It is the same trust pattern as the bank consent sheet (§6.10): a headline,
 * icon rows saying exactly what is and is not granted, one ink pill, legal
 * text beneath.
 */

/** Module scope, so it is not a fresh component type on every render. */
function Line({ pal, ok, label }: { pal: Palette; ok: boolean; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
      {ok ? (
        <Check size={16} color={pal.positive} strokeWidth={2.2} />
      ) : (
        <X size={16} color={pal.inkFaint} strokeWidth={2.2} />
      )}
      <Type role="body" color={ok ? pal.ink : pal.inkDim} style={{ flex: 1 }}>
        {label}
      </Type>
    </View>
  );
}

export default function HouseholdJoinScreen() {
  const C = useC();
  const router = useRouter();
  const qc = useQueryClient();

  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [error, setError] = useState('');

  const lookup = useMutation({
    mutationFn: () => previewInvite(code.trim().toUpperCase()),
    onSuccess: (p) => {
      setPreview(p);
      setError('');
    },
    onError: (e: Error) => {
      setPreview(null);
      setError(e.message);
    },
  });

  const join = useMutation({
    mutationFn: () =>
      joinHousehold(code.trim().toUpperCase(), preview!.joiningMeans.defaultShareLevel),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['household'] });
      router.replace('/household');
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Screen pal={C}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SubHeader pal={C} title={t('household.joinTitle')} onBack={() => router.back()} />

        <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
          <Card pal={C}>
            <Type role="body" color={C.inkDim}>
              {t('household.joinBlurb')}
            </Type>
            <Field
              pal={C}
              value={code}
              onChangeText={(v) => {
                setCode(v);
                setPreview(null);
                setError('');
              }}
              placeholder={t('household.codePlaceholder')}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              style={{ marginTop: 16 }}
            />
            {!preview ? (
              <PrimaryButton
                pal={C}
                label={t('household.lookUp')}
                onPress={() => lookup.mutate()}
                disabled={code.trim().length < 4 || lookup.isPending}
                style={{ marginTop: 16 }}
              />
            ) : null}
          </Card>

          {lookup.isPending ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 16 }} />
          ) : null}

          <FormError pal={C} message={error} />
        </View>

        {/* ── The consent screen proper ──────────────────────────────────── */}
        {preview ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
            <Card pal={C}>
              <Type role="section" color={C.ink}>
                {preview.name}
              </Type>
              <Type role="meta" color={C.inkDim} style={{ marginTop: 4 }}>
                {t('household.memberCount', { count: preview.memberCount })}
              </Type>
              {preview.memberNames.length > 0 ? (
                <Type role="meta" color={C.inkDim} style={{ marginTop: 2 }}>
                  {preview.memberNames.join(', ')}
                </Type>
              ) : null}
            </Card>

            <Card pal={C} style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconTile pal={C}>
                  <ShieldCheck size={19} color={C.accent} strokeWidth={S.stroke} />
                </IconTile>
                <Type role="cardTitle" color={C.ink} style={{ flex: 1 }}>
                  {t('household.whatTheySee')}
                </Type>
              </View>

              <Type role="meta" color={C.inkDim} style={{ marginTop: 16 }}>
                {t('household.willBeShared')}
              </Type>
              {preview.joiningMeans.sharedOnJoin.map((key) => (
                <Line key={key} pal={C} ok label={t(`household.field_${key}`)} />
              ))}

              <Type role="meta" color={C.inkDim} style={{ marginTop: 16 }}>
                {t('household.willNotBeShared')}
              </Type>
              {preview.joiningMeans.notSharedOnJoin.map((key) => (
                <Line key={key} pal={C} ok={false} label={t(`household.field_${key}`)} />
              ))}

              <View
                style={{
                  marginTop: 16,
                  paddingTop: 16,
                  borderTopWidth: 1,
                  borderTopColor: C.hairline,
                }}
              >
                <Type role="meta" color={C.inkDim}>
                  {t('household.consentFooter')}
                </Type>
              </View>
            </Card>

            <PrimaryButton
              pal={C}
              label={t('household.joinCta', { name: preview.name })}
              onPress={() => join.mutate()}
              disabled={join.isPending}
              style={{ marginTop: 16 }}
            />
            <PressableScale
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}
            >
              <Type role="cardTitle" color={C.inkDim}>
                {t('common.cancel')}
              </Type>
            </PressableScale>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
