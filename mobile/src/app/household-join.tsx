import { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X, ShieldCheck } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { previewInvite, joinHousehold, type JoinPreview } from '@/lib/householdApi';
import { R, useC } from '@/lib/design';
import { Txt, GlassCard, BubbleButton, ScreenBackground } from '@/components/ui';
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
 */
export default function HouseholdJoinScreen() {
  const C = useC();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();

  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<JoinPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: () => previewInvite(code.trim().toUpperCase()),
    onSuccess: (p) => { setPreview(p); setError(null); },
    onError: (e: Error) => { setPreview(null); setError(e.message); },
  });

  const join = useMutation({
    mutationFn: () => joinHousehold(code.trim().toUpperCase(), preview!.joiningMeans.defaultShareLevel),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['household'] });
      router.replace('/household');
    },
    onError: (e: Error) => setError(e.message),
  });

  const Line = ({ ok, label }: { ok: boolean; label: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7 }}>
      {ok ? <Check size={15} color={C.green} /> : <X size={15} color={C.textFaint} />}
      <Txt size={13} color={ok ? C.text : C.textDim} style={{ marginStart: 9, flex: 1 }}>
        {label}
      </Txt>
    </View>
  );

  return (
    <ScreenBackground>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color={C.text} />
          </Pressable>
          <Txt weight="bold" size={22} style={{ marginStart: 12 }}>
            {t('household.joinTitle')}
          </Txt>
        </View>

        <GlassCard padding={16} radius={R.md}>
          <Txt size={13} color={C.textDim} style={{ lineHeight: 19 }}>
            {t('household.joinBlurb')}
          </Txt>
          <TextInput
            value={code}
            onChangeText={(v) => { setCode(v); setPreview(null); setError(null); }}
            placeholder={t('household.codePlaceholder')}
            placeholderTextColor={C.textDim}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            style={{
              marginTop: 12, borderRadius: R.sm, paddingHorizontal: 14, paddingVertical: 12,
              backgroundColor: C.glass, color: C.text, fontSize: 18, letterSpacing: 3,
            }}
          />
          {!preview && (
            <BubbleButton
              label={t('household.lookUp')}
              onPress={() => { Haptics.selectionAsync(); lookup.mutate(); }}
              disabled={code.trim().length < 4 || lookup.isPending}
              style={{ marginTop: 12 }}
            />
          )}
        </GlassCard>

        {lookup.isPending && (
          <ActivityIndicator color={C.p400} style={{ marginTop: 20 }} />
        )}

        {error && (
          <GlassCard padding={14} radius={R.sm} style={{ marginTop: 14 }} border="rgba(239,68,68,0.28)">
            <Txt size={13} color="#f87171">{error}</Txt>
          </GlassCard>
        )}

        {/* ── The consent screen proper ──────────────────────────────────── */}
        {preview && (
          <>
            <GlassCard padding={18} radius={R.md} style={{ marginTop: 18 }}>
              <Txt weight="bold" size={18}>{preview.name}</Txt>
              <Txt size={13} color={C.textDim} style={{ marginTop: 4 }}>
                {t('household.memberCount', { count: preview.memberCount })}
              </Txt>
              {preview.memberNames.length > 0 && (
                <Txt size={13} color={C.textDim} style={{ marginTop: 2 }}>
                  {preview.memberNames.join(', ')}
                </Txt>
              )}
            </GlassCard>

            <GlassCard padding={18} radius={R.md} style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ShieldCheck size={17} color={C.green} />
                <Txt weight="semibold" size={15} style={{ marginStart: 8 }}>
                  {t('household.whatTheySee')}
                </Txt>
              </View>

              <Txt size={12} color={C.textDim} style={{ marginTop: 10 }}>
                {t('household.willBeShared')}
              </Txt>
              {preview.joiningMeans.sharedOnJoin.map((key) => (
                <Line key={key} ok label={t(`household.field_${key}`)} />
              ))}

              <Txt size={12} color={C.textDim} style={{ marginTop: 14 }}>
                {t('household.willNotBeShared')}
              </Txt>
              {preview.joiningMeans.notSharedOnJoin.map((key) => (
                <Line key={key} ok={false} label={t(`household.field_${key}`)} />
              ))}

              <View style={{ marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.glassBorder }}>
                <Txt size={12} color={C.textDim} style={{ lineHeight: 18 }}>
                  {t('household.consentFooter')}
                </Txt>
              </View>
            </GlassCard>

            <BubbleButton
              label={t('household.joinCta', { name: preview.name })}
              onPress={() => { Haptics.selectionAsync(); join.mutate(); }}
              disabled={join.isPending}
              style={{ marginTop: 18 }}
            />
            <Pressable onPress={() => router.back()} style={{ marginTop: 14, alignItems: 'center' }}>
              <Txt size={14} color={C.textDim}>{t('common.cancel')}</Txt>
            </Pressable>
          </>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}
