import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Briefcase, User } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { useSession } from '@/lib/auth/use-session';
import { useAccountTypeStore, type AccountType } from '@/lib/account-type-store';
import { createBusiness } from '@/lib/businessApi';
import { needsFirstPull, syncNow } from '@/lib/cloud-sync';
import { isOnboardingComplete } from '@/lib/onboarding-storage';
import { restoreReturningAccount } from '@/lib/returning-account';
import { R, S, useC } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import { Card, IconTile, PrimaryButton, Screen, Type } from '@/components/kit';
import { DrawCheck } from '@/components/identity/primitives';
import { GLYPH } from '@/lib/identity/tokens';
import { t } from '@/lib/i18n/core';

/**
 * The selection mark: DrawCheck at this size, and an unchosen ring matched to
 * it. DrawCheck draws its ring at radius 8.75 on the 24 grid, at the glyph
 * stroke for its size, so the empty ring takes the same outer diameter and
 * weight and choosing an option does not shift anything.
 */
const MARK = 36;
const MARK_STROKE = Math.max(GLYPH.minStrokePt, (GLYPH.stroke * MARK) / GLYPH.grid);
const MARK_RING = (2 * 8.75 * MARK) / GLYPH.grid + MARK_STROKE;

const FIRST_PULL_RETRY_MS = 10_000;

/**
 * Whether a personal account still needs onboarding. Not for an account that
 * has been here before: onboarding writes settings, and they would replace
 * the ones it has. Normally the root layout settled that after the first
 * pull; if that pull had not finished by the time the picker showed, it gets
 * one more chance here, before onboarding can write anything.
 */
async function personalOnboardingNeeded(userId: string): Promise<boolean> {
  try {
    if (await needsFirstPull()) {
      // Bounded: a server that does not answer must not trap the user here.
      const report = await Promise.race([
        syncNow(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FIRST_PULL_RETRY_MS)),
      ]);
      await restoreReturningAccount(userId, !!report?.pulled.complete);
    }
    return !(await isOnboardingComplete());
  } catch (e) {
    console.warn('[account-type] onboarding check failed', e);
    return true;
  }
}

/**
 * The profile picker — DESIGN-PROMPT.md §6.22 and board §7.
 *
 * Both profiles wear the one identity (DESIGN-IDENTITY.md), so the two options
 * look the same: the choice is content, not colour. Each is a lifted card
 * with its own glyph on a platinum tile; the selected one takes the tint's
 * soft wash, a tint subtitle and the tint check, which is how every selection
 * in the app is drawn.
 *
 * It used to teach two hues here, one per profile, through gradient slabs and
 * tinted icon wells. There is nothing left to teach: the profile no longer
 * changes the colours.
 *
 * The one espresso surface is the CTA at the bottom: a screen of lifted cards
 * on the off-white page, with a single espresso button.
 */
export default function AccountTypeScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: session } = useSession();
  const save = useAccountTypeStore((s) => s.save);
  const [selected, setSelected] = useState<AccountType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const options = [
    {
      id: 'personal' as const,
      label: t('accountKind.personalLabel'),
      subtitle: t('accountKind.personalSub'),
      description: t('misc2.accountKindPersonalDesc'),
      Icon: User,
    },
    {
      id: 'business' as const,
      label: t('accountKind.businessLabel'),
      subtitle: t('accountKind.businessSub'),
      description: t('accountKind.businessDesc'),
      Icon: Briefcase,
    },
  ];

  async function handleContinue() {
    if (!selected || !session?.user?.id) return;
    setIsSaving(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const userId = session.user.id;
    await save(userId, selected);

    if (selected === 'personal') {
      router.replace((await personalOnboardingNeeded(userId)) ? '/onboarding' : '/(tabs)');
    } else {
      // Provision business record + owner team membership
      try {
        await createBusiness(session.user.name ?? undefined);
      } catch (e) {
        console.warn('[Business] createBusiness failed:', e);
      }
      router.replace('/(business-tabs)');
    }
  }

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 }}
      >
        <View style={{ paddingHorizontal: S.screen }}>
          <Type role="meta" color={C.inkDim}>
            {t('onboarding.stepOf')}
          </Type>
          {/* Sentence case, sitting directly on the ground with no card
              around it — §1.2. It used to sit under a 13px uppercase label
              tracked out to 2pt, which is the one type style §3 leaves out
              on purpose. */}
          <Type role="title" color={C.ink} style={{ marginTop: 12 }}>
            {t('accountKind.question')}
          </Type>
          <Type role="body" color={C.inkDim} style={{ marginTop: 12 }}>
            {t('accountKind.questionSub')}
          </Type>
        </View>

        <View style={{ paddingHorizontal: S.screen, gap: 12, marginTop: S.section }}>
          {options.map((option) => {
            const isSelected = selected === option.id;
            return (
              <PressableScale
                key={option.id}
                onPress={() => setSelected(option.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={option.label}
              >
                <Card
                  pal={C}
                  radius={R.md}
                  contentStyle={{
                    padding: 24,
                    // Selection is the tint's soft wash, the same for both
                    // options: the card says which one you chose, not a hue.
                    backgroundColor: isSelected ? C.accentSoft : C.groundAlt,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      marginBottom: 16,
                    }}
                  >
                    <IconTile pal={C} size={56} style={{ borderRadius: R.control }}>
                      <option.Icon size={26} color={isSelected ? C.accent : C.ink} strokeWidth={S.stroke} />
                    </IconTile>

                    {/* The identity's check, drawn once when chosen: the
                        ring warms from silver to the tint, then the tick
                        traces itself. Unchosen, the same ring at the same
                        size and weight in silverInk, the silver that carries
                        a graphic on the page. It used to be a ring around
                        the circled-check glyph: two circles. */}
                    <View style={{ width: MARK, height: MARK, alignItems: 'center', justifyContent: 'center' }}>
                      {isSelected ? (
                        <DrawCheck P={C} size={MARK} haptic={false} />
                      ) : (
                        <View
                          style={{
                            width: MARK_RING,
                            height: MARK_RING,
                            borderRadius: R.pill,
                            borderWidth: MARK_STROKE,
                            borderColor: C.silverInk,
                          }}
                        />
                      )}
                    </View>
                  </View>

                  <Type role="section" color={C.ink}>
                    {option.label}
                  </Type>
                  <Type role="meta" color={isSelected ? C.accent : C.inkDim} style={{ marginTop: 3 }}>
                    {option.subtitle}
                  </Type>
                  <Type role="body" color={C.inkDim} style={{ marginTop: 12 }}>
                    {option.description}
                  </Type>
                </Card>
              </PressableScale>
            );
          })}
        </View>
      </ScrollView>

      <View
        style={{
          paddingHorizontal: S.screen,
          paddingTop: 8,
          paddingBottom: insets.bottom + 12,
        }}
      >
        <PrimaryButton
          pal={C}
          label={selected ? t('common.continue') : t('accountKind.selectPrompt')}
          onPress={handleContinue}
          disabled={!selected || isSaving}
        />
      </View>
    </Screen>
  );
}
