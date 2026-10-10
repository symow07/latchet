import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { HeartPulse, Lock, ShieldCheck } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import {
  deleteHealthProfile,
  getHealthProfile,
  revokeSensitiveConsent,
  saveHealthProfile,
  type HealthProfile,
} from '@/lib/health-profile';
import { S, useC } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  Card,
  Field,
  IconTile,
  PrimaryButton,
  Screen,
  SectionHeader,
  SubHeader,
  SwitchRow,
  Type,
} from '@/components/kit';
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
 *
 * The fields come from the kit now, which matters for a reason beyond looks:
 * a component declared inside another component's body is a new function
 * identity on every render, so React unmounts and remounts it rather than
 * updating it — and a remounted TextInput loses focus after one keystroke.
 * The kit's `Field` is module scope, which is the property that fixes it.
 */
export default function AdvisorProfileScreen() {
  const C = useC();
  const router = useRouter();

  const [profile, setProfile] = useState<HealthProfile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getHealthProfile().then(setProfile);
  }, []);

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
    if (on) {
      patch({ sensitiveConsentAt: new Date().toISOString() });
    } else {
      // Withdrawing wipes the values, not just the flag. A flag alone would
      // leave the data sitting there for the next thing that reads it.
      await revokeSensitiveConsent();
      setProfile(await getHealthProfile());
    }
  };

  // Erasing the profile cannot be undone, which is the one case §16.2 keeps a
  // dialog for. It used to happen on a single tap.
  const confirmWipe = () => {
    Alert.alert(t('advisorProfile.deleteAll'), t('advisorProfile.deleteNote'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('dialogs.delete'),
        style: 'destructive',
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await deleteHealthProfile();
          setProfile(await getHealthProfile());
        },
      },
    ]);
  };

  if (!profile) {
    return (
      <Screen pal={C}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.accent} />
        </View>
      </Screen>
    );
  }

  const sensitiveOn = !!profile.sensitiveConsentAt;

  return (
    <Screen pal={C}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SubHeader pal={C} title={t('advisorProfile.title')} onBack={() => router.back()} />

        {/* Where this is stored, stated before anything is asked for. */}
        <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
          <Card pal={C}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <IconTile pal={C}>
                <Lock size={19} color={C.accent} strokeWidth={S.stroke} />
              </IconTile>
              <View style={{ flex: 1 }}>
                <Type role="cardTitle" color={C.ink}>
                  {t('advisorProfile.storageTitle')}
                </Type>
                <Type role="body" color={C.inkDim} style={{ marginTop: 4 }}>
                  {t('advisorProfile.storageBody')}
                </Type>
              </View>
            </View>
          </Card>
        </View>

        {/* ── Standard tier ────────────────────────────────────────────── */}
        <View style={{ marginTop: S.section }}>
          <SectionHeader pal={C} title={t('advisorProfile.standardTitle')} />
          <View style={{ paddingHorizontal: S.screen }}>
            <Type role="body" color={C.inkDim}>
              {t('advisorProfile.standardBody')}
            </Type>

            <Field
              pal={C}
              label={t('advisorProfile.householdSize')}
              value={profile.householdSize == null ? '' : String(profile.householdSize)}
              onChangeText={(v) =>
                patch({
                  householdSize: v.trim() === '' ? null : Number(v.replace(/\D/g, '')) || null,
                })
              }
              placeholder="2"
              keyboardType="number-pad"
              style={{ marginTop: 16 }}
            />
            <Field
              pal={C}
              label={t('advisorProfile.city')}
              value={profile.city ?? ''}
              onChangeText={(v) => patch({ city: v })}
              placeholder={t('advisorProfile.cityPlaceholder')}
              style={{ marginTop: 16 }}
            />
            <Field
              pal={C}
              label={t('advisorProfile.cooking')}
              value={profile.cookingHabits ?? ''}
              onChangeText={(v) => patch({ cookingHabits: v })}
              placeholder={t('advisorProfile.cookingPlaceholder')}
              style={{ marginTop: 16 }}
            />
            <Field
              pal={C}
              label={t('advisorProfile.goals')}
              value={profile.goals ?? ''}
              onChangeText={(v) => patch({ goals: v })}
              placeholder={t('advisorProfile.goalsPlaceholder')}
              multiline
              style={{ marginTop: 16 }}
            />
            <Field
              pal={C}
              label={t('advisorProfile.interests')}
              value={profile.activityInterests ?? ''}
              onChangeText={(v) => patch({ activityInterests: v })}
              placeholder={t('advisorProfile.interestsPlaceholder')}
              style={{ marginTop: 16 }}
            />
            <Field
              pal={C}
              label={t('advisorProfile.dietary')}
              value={profile.dietaryPreferences ?? ''}
              onChangeText={(v) => patch({ dietaryPreferences: v })}
              placeholder={t('advisorProfile.dietaryPlaceholder')}
              style={{ marginTop: 16 }}
            />
          </View>
        </View>

        {/* ── Sensitive tier, behind its own consent ───────────────────── */}
        <View style={{ marginTop: S.section, paddingHorizontal: S.screen }}>
          <Card pal={C}>
            <SwitchRow
              pal={C}
              icon={
                <IconTile pal={C}>
                  <HeartPulse size={19} color={C.accent} strokeWidth={S.stroke} />
                </IconTile>
              }
              title={t('advisorProfile.sensitiveTitle')}
              value={sensitiveOn}
              onValueChange={toggleSensitive}
            />
            <Type role="body" color={C.inkDim} style={{ marginTop: 12 }}>
              {t('advisorProfile.sensitiveBody')}
            </Type>
            <Type role="meta" color={C.inkDim} style={{ marginTop: 12 }}>
              {t('advisorProfile.sensitiveOptional')}
            </Type>

            {sensitiveOn ? (
              <>
                <Field
                  pal={C}
                  label={t('advisorProfile.allergies')}
                  value={profile.allergies ?? ''}
                  onChangeText={(v) => patch({ allergies: v })}
                  placeholder={t('advisorProfile.allergiesPlaceholder')}
                  style={{ marginTop: 16 }}
                />
                <Field
                  pal={C}
                  label={t('advisorProfile.conditions')}
                  value={profile.healthConsiderations ?? ''}
                  onChangeText={(v) => patch({ healthConsiderations: v })}
                  placeholder={t('advisorProfile.conditionsPlaceholder')}
                  multiline
                  style={{ marginTop: 16 }}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                  <ShieldCheck
                    size={16}
                    color={C.positive}
                    strokeWidth={S.stroke}
                    style={{ marginTop: 1 }}
                  />
                  <Type role="meta" color={C.inkDim} style={{ flex: 1 }}>
                    {t('advisorProfile.neverAdvises')}
                  </Type>
                </View>
              </>
            ) : null}
          </Card>
        </View>

        <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
          <PrimaryButton
            pal={C}
            label={saving ? t('common.saving') : t('common.save')}
            onPress={save}
            disabled={saving}
          />

          <PressableScale
            onPress={confirmWipe}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={t('advisorProfile.deleteAll')}
            style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}
          >
            <Type role="cardTitle" color={C.negative}>
              {t('advisorProfile.deleteAll')}
            </Type>
          </PressableScale>

          <Type role="meta" color={C.inkDim} style={{ marginTop: 6, textAlign: 'center' }}>
            {t('advisorProfile.deleteNote')}
          </Type>
        </View>
      </ScrollView>
    </Screen>
  );
}
