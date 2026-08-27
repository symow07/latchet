import { useEffect, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, ActivityIndicator, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, HeartPulse, Lock, Trash2, ShieldCheck } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  getHealthProfile, saveHealthProfile, deleteHealthProfile, revokeSensitiveConsent,
  type HealthProfile,
} from '@/lib/health-profile';
import { R, useC } from '@/lib/design';
import { Txt, GlassCard, BubbleButton, ScreenBackground } from '@/components/ui';
import { t } from '@/lib/i18n/core';

/**
 * What the advisor knows about you.
 *
 * Two tiers on one screen, but the sensitive one is behind its own switch with
 * its own explanation and its own consent timestamp. GDPR Article 9 and PIPL
 * both require consent to health data to be separate from everything else, and
 * separate has to mean the user did a distinct thing — not that they scrolled
 * past a paragraph inside a form they were already filling in.
 *
 * The standard tier is presented first and described as sufficient, because it
 * is. Nobody should feel they have to disclose a medical condition to get a
 * decent budgeting experience.
 */
export default function AdvisorProfileScreen() {
  const C = useC();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [profile, setProfile] = useState<HealthProfile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getHealthProfile().then(setProfile); }, []);

  const patch = (p: Partial<HealthProfile>) =>
    setProfile((prev) => (prev ? { ...prev, ...p } : prev));

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    // Recording standard consent on first save: filling the form IS the
    // standard-tier consent, and it is not sensitive data.
    await saveHealthProfile({
      ...profile,
      standardConsentAt: profile.standardConsentAt ?? new Date().toISOString(),
    });
    setProfile(await getHealthProfile());
    setSaving(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const toggleSensitive = async (on: boolean) => {
    Haptics.selectionAsync();
    if (on) {
      patch({ sensitiveConsentAt: new Date().toISOString() });
    } else {
      // Withdrawing wipes the values, not just the flag. A flag alone would
      // leave the data sitting there for the next thing that reads it.
      await revokeSensitiveConsent();
      setProfile(await getHealthProfile());
    }
  };

  const wipe = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await deleteHealthProfile();
    setProfile(await getHealthProfile());
  };

  const Field = ({ label, value, onChange, placeholder, multiline }: {
    label: string; value: string | null;
    onChange: (v: string) => void; placeholder: string; multiline?: boolean;
  }) => (
    <View style={{ marginTop: 14 }}>
      <Txt size={13} color={C.textDim}>{label}</Txt>
      <TextInput
        value={value ?? ''}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.textFaint}
        multiline={multiline}
        style={{
          marginTop: 6, borderRadius: R.sm, paddingHorizontal: 14, paddingVertical: 11,
          backgroundColor: C.glass, color: C.text, fontSize: 15,
          minHeight: multiline ? 72 : undefined, textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );

  if (!profile) {
    return (
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.p400} />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color={C.text} />
          </Pressable>
          <Txt weight="bold" size={22} style={{ marginStart: 12 }}>
            {t('advisorProfile.title')}
          </Txt>
        </View>

        {/* ── Where this is stored, stated up front ─────────────────────── */}
        <GlassCard padding={16} radius={R.md}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Lock size={16} color={C.green} />
            <Txt weight="semibold" size={14} style={{ marginStart: 8 }}>
              {t('advisorProfile.storageTitle')}
            </Txt>
          </View>
          <Txt size={13} color={C.textDim} style={{ marginTop: 8, lineHeight: 19 }}>
            {t('advisorProfile.storageBody')}
          </Txt>
        </GlassCard>

        {/* ── Standard tier ────────────────────────────────────────────── */}
        <View style={{ marginTop: 20 }}>
          <Txt weight="semibold" size={16}>{t('advisorProfile.standardTitle')}</Txt>
          <Txt size={13} color={C.textDim} style={{ marginTop: 4, lineHeight: 19 }}>
            {t('advisorProfile.standardBody')}
          </Txt>

          <Field
            label={t('advisorProfile.householdSize')}
            value={profile.householdSize == null ? null : String(profile.householdSize)}
            onChange={(v) => patch({ householdSize: v.trim() === '' ? null : Number(v.replace(/\D/g, '')) || null })}
            placeholder="2"
          />
          <Field label={t('advisorProfile.city')} value={profile.city}
                 onChange={(v) => patch({ city: v })} placeholder={t('advisorProfile.cityPlaceholder')} />
          <Field label={t('advisorProfile.cooking')} value={profile.cookingHabits}
                 onChange={(v) => patch({ cookingHabits: v })} placeholder={t('advisorProfile.cookingPlaceholder')} />
          <Field label={t('advisorProfile.goals')} value={profile.goals}
                 onChange={(v) => patch({ goals: v })} placeholder={t('advisorProfile.goalsPlaceholder')} multiline />
          <Field label={t('advisorProfile.interests')} value={profile.activityInterests}
                 onChange={(v) => patch({ activityInterests: v })} placeholder={t('advisorProfile.interestsPlaceholder')} />
          <Field label={t('advisorProfile.dietary')} value={profile.dietaryPreferences}
                 onChange={(v) => patch({ dietaryPreferences: v })} placeholder={t('advisorProfile.dietaryPlaceholder')} />
        </View>

        {/* ── Sensitive tier, behind its own consent ───────────────────── */}
        <View style={{ marginTop: 26 }}>
          <GlassCard padding={16} radius={R.md} border={profile.sensitiveConsentAt ? C.amber : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <HeartPulse size={17} color={C.amber} />
              <Txt weight="semibold" size={15} style={{ marginStart: 8, flex: 1 }}>
                {t('advisorProfile.sensitiveTitle')}
              </Txt>
              <Switch
                value={!!profile.sensitiveConsentAt}
                onValueChange={toggleSensitive}
                trackColor={{ true: C.p600, false: C.glassBorder }}
              />
            </View>
            <Txt size={13} color={C.textDim} style={{ marginTop: 10, lineHeight: 19 }}>
              {t('advisorProfile.sensitiveBody')}
            </Txt>
            <Txt size={12} color={C.textDim} style={{ marginTop: 10, lineHeight: 18 }}>
              {t('advisorProfile.sensitiveOptional')}
            </Txt>

            {profile.sensitiveConsentAt && (
              <>
                <Field label={t('advisorProfile.allergies')} value={profile.allergies}
                       onChange={(v) => patch({ allergies: v })}
                       placeholder={t('advisorProfile.allergiesPlaceholder')} />
                <Field label={t('advisorProfile.conditions')} value={profile.healthConsiderations}
                       onChange={(v) => patch({ healthConsiderations: v })}
                       placeholder={t('advisorProfile.conditionsPlaceholder')} multiline />
                <View style={{ flexDirection: 'row', marginTop: 14, alignItems: 'flex-start' }}>
                  <ShieldCheck size={15} color={C.green} style={{ marginTop: 2 }} />
                  <Txt size={12} color={C.textDim} style={{ marginStart: 8, flex: 1, lineHeight: 18 }}>
                    {t('advisorProfile.neverAdvises')}
                  </Txt>
                </View>
              </>
            )}
          </GlassCard>
        </View>

        <BubbleButton
          label={saving ? t('common.saving') : t('common.save')}
          onPress={save}
          disabled={saving}
          style={{ marginTop: 22 }}
        />

        <Pressable
          onPress={wipe}
          style={{ marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
        >
          <Trash2 size={15} color="#f87171" />
          <Txt size={14} color="#f87171" weight="semibold" style={{ marginStart: 8 }}>
            {t('advisorProfile.deleteAll')}
          </Txt>
        </Pressable>
        <Txt size={11} color={C.textDim} style={{ marginTop: 8, textAlign: 'center', lineHeight: 16 }}>
          {t('advisorProfile.deleteNote')}
        </Txt>
      </ScrollView>
    </ScreenBackground>
  );
}
