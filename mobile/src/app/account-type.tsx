import { ScreenBackground } from '@/components/ui';
import { C } from '@/lib/design';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { User, Briefcase, ArrowRight, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSession } from '@/lib/auth/use-session';
import { useAccountTypeStore, type AccountType } from '@/lib/account-type-store';
import { createBusiness } from '@/lib/businessApi';

const ACCOUNT_TYPES: {
  id: AccountType;
  label: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  colors: [string, string];
  accent: string;
}[] = [
  {
    id: 'personal',
    label: 'Personal',
    subtitle: 'For individuals',
    description: 'Track daily spending, budgets, savings goals, and build healthy money habits.',
    icon: User,
    colors: ['#1a0840', '#2d1260'],
    accent: C.p500,
  },
  {
    id: 'business',
    label: 'Business',
    subtitle: 'For companies',
    description: 'Manage business expenses, revenue, and financial reporting.',
    icon: Briefcase,
    colors: ['#031526', '#05283f'],
    accent: '#3b82f6',
  },
];

export default function AccountTypeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: session } = useSession();
  const save = useAccountTypeStore(s => s.save);
  const [selected, setSelected] = useState<AccountType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const personalScale = useSharedValue(1);
  const businessScale = useSharedValue(1);

  const personalStyle = useAnimatedStyle(() => ({ transform: [{ scale: personalScale.value }] }));
  const businessStyle = useAnimatedStyle(() => ({ transform: [{ scale: businessScale.value }] }));

  function handleSelect(type: AccountType) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (type === 'personal') {
      personalScale.value = withSpring(0.97, {}, () => { personalScale.value = withSpring(1); });
    } else {
      businessScale.value = withSpring(0.97, {}, () => { businessScale.value = withSpring(1); });
    }
    setSelected(type);
  }

  async function handleContinue() {
    if (!selected || !session?.user?.id) return;
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

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
    <ScreenBackground style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {/* Header */}
      <View className="px-6 pt-8 pb-6">
        <Text style={{ color: C.p500, fontSize: 13, fontWeight: '700', letterSpacing: 2, marginBottom: 10 }}>
          STEP 1 OF 2
        </Text>
        <Text className="text-white font-bold" style={{ fontSize: 32, lineHeight: 40, marginBottom: 8 }}>
          How will you{'\n'}use Budget?
        </Text>
        <Text className="text-gray-400 text-base leading-6">
          Choose the account type that fits your needs. You can't change this later.
        </Text>
      </View>

      {/* Cards */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, gap: 16, paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {ACCOUNT_TYPES.map((type) => {
          const isSelected = selected === type.id;
          const animStyle = type.id === 'personal' ? personalStyle : businessStyle;
          const Icon = type.icon;

          return (
            <Animated.View key={type.id} style={animStyle}>
              <Pressable
                onPress={() => handleSelect(type.id)}
                style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
              >
                <LinearGradient
                  colors={type.colors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    borderRadius: 24,
                    padding: 24,
                    borderWidth: isSelected ? 2 : 1.5,
                    borderColor: isSelected ? type.accent : 'rgba(255,255,255,0.08)',
                  }}
                >
                  <View className="flex-row items-start justify-between mb-4">
                    <View
                      style={{
                        width: 56, height: 56, borderRadius: 18,
                        backgroundColor: `${type.accent}22`,
                        borderWidth: 1.5, borderColor: `${type.accent}40`,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Icon size={26} color={type.accent} />
                    </View>

                    {/* Selection indicator */}
                    <View
                      style={{
                        width: 28, height: 28, borderRadius: 14,
                        backgroundColor: isSelected ? type.accent : 'rgba(255,255,255,0.08)',
                        borderWidth: isSelected ? 0 : 1.5,
                        borderColor: 'rgba(255,255,255,0.15)',
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {isSelected && <Check size={15} color="white" strokeWidth={3} />}
                    </View>
                  </View>

                  <Text className="text-white font-bold mb-1" style={{ fontSize: 22 }}>
                    {type.label}
                  </Text>
                  <Text style={{ color: type.accent, fontWeight: '600', fontSize: 13, marginBottom: 10 }}>
                    {type.subtitle}
                  </Text>
                  <Text className="text-gray-400 text-sm leading-5">
                    {type.description}
                  </Text>
                </LinearGradient>
              </Pressable>
            </Animated.View>
          );
        })}
      </ScrollView>

      {/* Continue Button */}
      <View className="px-6 pt-4 pb-2">
        <Pressable
          onPress={handleContinue}
          disabled={!selected || isSaving}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <LinearGradient
            colors={
              !selected
                ? ['#1a1130', '#1a1130']
                : selected === 'personal'
                  ? [C.p600, C.p500]
                  : ['#1d4ed8', '#3b82f6']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{
              borderRadius: 20,
              paddingVertical: 18,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isSaving ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <>
                <Text
                  style={{
                    color: selected ? 'white' : '#4b5563',
                    fontWeight: '700',
                    fontSize: 17,
                    marginRight: 8,
                  }}
                >
                  {selected ? 'Continue' : 'Select an account type'}
                </Text>
                {selected && <ArrowRight size={20} color="white" />}
              </>
            )}
          </LinearGradient>
        </Pressable>
      </View>
    </ScreenBackground>
  );
}
