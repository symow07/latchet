import { useState } from 'react';
import { View, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Search, Globe } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { getSettings, updateSettings } from '@/lib/db';
import { CURRENCIES, type Currency } from '@/lib/currencies';
import { setActiveCurrency } from '@/lib/calculations';
import { R, useB } from '@/lib/design';
import { Txt, GlassCard, BizBackground, IconBubble, EmptyState } from '@/components/ui';
import { t } from '@/lib/i18n/core';

/**
 * Picking the currency amounts are shown in.
 *
 * Stored on the user's settings, not the business: someone in one company and
 * one household has one set of eyes, and the app formats every amount the same
 * way. Changing it does not convert anything — it changes the symbol and the
 * decimal places, which is why the note at the top says so plainly.
 *
 * Searchable because there are 168 of them and scrolling to TND is not a
 * design.
 */
export default function CurrencyScreen() {
  const B = useB();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');

  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const active = settings?.currency ?? 'USD';

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? CURRENCIES.filter(
        (c) => c.code.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle),
      )
    : CURRENCIES;

  const choose = async (currency: Currency) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Applied before the write so every amount on screen updates immediately;
    // the write is what makes it survive a restart.
    setActiveCurrency(currency.code, currency.symbol);
    await updateSettings({ currency: currency.code, currencySymbol: currency.symbol }).catch(() => {});
    await qc.invalidateQueries();
    router.back();
  };

  return (
    <BizBackground style={{ paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          hitSlop={12}
          style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: B.glass, alignItems: 'center', justifyContent: 'center' }}
        >
          <ArrowLeft size={20} color={B.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={22} color={B.text}>{t('bizSettings.regionLabel')}</Txt>
        </View>
        <IconBubble color={B.amber} size={38} radius={12}><Globe size={17} color={B.amber} /></IconBubble>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: B.glass, borderRadius: R.md, paddingHorizontal: 14, borderWidth: 1, borderColor: B.glassBorder }}>
          <Search size={16} color={B.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('bizSettings.currencySearch')}
            placeholderTextColor={B.textFaint}
            autoCorrect={false}
            // Not "characters": the field matches codes and names alike, and
            // forcing caps mid-word rendered "dirham" as "DIrhAM".
            autoCapitalize="none"
            selectionColor={B.accent}
            style={{ flex: 1, color: B.text, fontSize: 15, fontFamily: 'PlusJakartaSans_500Medium', paddingVertical: 13 }}
          />
        </View>
        <Txt size={11} color={B.textFaint} style={{ marginTop: 8, marginLeft: 4 }}>
          {t('bizSettings.currencyNote')}
        </Txt>
      </View>

      {isLoading ? (
        <View style={{ paddingTop: 60, alignItems: 'center' }}><ActivityIndicator color={B.accent} /></View>
      ) : matches.length === 0 ? (
        <EmptyState compact icon={<Search size={24} color={B.textFaint} />} title={t('bizSettings.noCurrencyMatch')} />
      ) : (
        <ScrollView
          style={{ marginTop: 14 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          <GlassCard padding={6} radius={R.md}>
            {matches.map((c, i) => {
              const selected = c.code === active;
              return (
                <Pressable
                  key={c.code}
                  onPress={() => void choose(c)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 10,
                    borderBottomWidth: i < matches.length - 1 ? 1 : 0,
                    borderBottomColor: B.glassBorder,
                  }}
                >
                  {/* Fixed width so the codes line up; some symbols are three
                      characters wide and would otherwise ragged the column. */}
                  <Txt size={15} color={selected ? B.text : B.textDim} style={{ width: 44 }} numberOfLines={1}>
                    {c.symbol}
                  </Txt>
                  <Txt weight="semibold" size={14} color={selected ? B.text : B.textDim} style={{ width: 48 }}>
                    {c.code}
                  </Txt>
                  <Txt size={13} color={B.textFaint} style={{ flex: 1 }} numberOfLines={1}>{c.name}</Txt>
                  {selected && <Check size={18} color={B.teal} />}
                </Pressable>
              );
            })}
          </GlassCard>
        </ScrollView>
      )}
    </BizBackground>
  );
}
