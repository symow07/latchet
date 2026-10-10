import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Briefcase, Check, User } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { useSession } from '@/lib/auth/use-session';
import { useAccountTypeStore, type AccountType } from '@/lib/account-type-store';
import { createBusiness } from '@/lib/businessApi';
import { S, useB, useC } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import { Card, PrimaryButton, Screen, Type } from '@/components/kit';
import { t } from '@/lib/i18n/core';

/**
 * The profile picker — DESIGN-PROMPT.md §6.22 and board §7.
 *
 * This is the one screen in the app where both accents appear together, and
 * the brief is specific about how: two large white cards, violet for Personal
 * and mint for Business, the current one checked.
 *
 * It was two gradient slabs instead — `#1a0840 → #2d1260` and `#031526 →
 * #05283f` in dark, two pale washes in light — with a violet icon well on one
 * and a **blue** one on the other. Blue is not a colour in this system; the
 * business profile is mint (§2.3), and the whole point of the profile switcher
 * is that it teaches the two hues before the user meets them. Teaching the
 * wrong one is worse than teaching none.
 *
 * The one dark object is the CTA at the bottom, which is what the Evoo consent
 * reference does: a screen of white on bone, with a single black button.
 */
export default function AccountTypeScreen() {
  const C = useC();
  const B = useB();
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
      accent: C.accent,
      accentSoft: C.accentSoft,
    },
    {
      id: 'business' as const,
      label: t('accountKind.businessLabel'),
      subtitle: t('accountKind.businessSub'),
      description: t('accountKind.businessDesc'),
      Icon: Briefcase,
      accent: B.accent,
      accentSoft: B.accentSoft,
    },
  ];

  async function handleContinue() {
    if (!selected || !session?.user?.id) return;
    setIsSaving(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    await save(session.user.id, selected);

    if (selected === 'personal') {
      router.replace('/onboarding');
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
                  radius={24}
                  contentStyle={{
                    padding: 24,
                    // Selection is a wash in that profile's own accent, so the
                    // card shows you the hue you are choosing.
                    backgroundColor: isSelected ? option.accentSoft : C.groundAlt,
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
                    <View
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 18,
                        backgroundColor: isSelected ? C.groundAlt : option.accentSoft,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <option.Icon size={25} color={option.accent} strokeWidth={S.stroke} />
                    </View>

                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: isSelected ? option.accent : 'transparent',
                        borderWidth: isSelected ? 0 : 1.5,
                        borderColor: C.hairline,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isSelected ? (
                        <Check size={15} color={C.groundAlt} strokeWidth={2.8} />
                      ) : null}
                    </View>
                  </View>

                  <Type role="section" color={C.ink}>
                    {option.label}
                  </Type>
                  <Type role="meta" color={option.accent} style={{ marginTop: 3 }}>
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
