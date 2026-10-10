import { useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from '@/components/icons';
import { getSettings, updateSettings } from '@/lib/db';
import { CURRENCIES, type Currency } from '@/lib/currencies';
import { setActiveCurrency } from '@/lib/calculations';
import { S, useB } from '@/lib/design';
import { ChoiceRow, Empty, Field, Screen, SubHeader, Type } from '@/components/kit';
import { t } from '@/lib/i18n/core';

/**
 * Picking the currency amounts are shown in.
 *
 * Stored on the user's settings, not the business: someone in one company and
 * one household has one set of eyes, and the app formats every amount the same
 * way. Changing it does not convert anything — it changes the symbol and the
 * decimal places, which is why the note under the search field says so.
 *
 * Searchable because there are 168 of them and scrolling to TND is not a
 * design. The list is a FlatList rather than 168 rows inside a ScrollView:
 * the old version mounted every currency in the app before the screen could
 * paint, which is the kind of latency §1 is about.
 *
 * Rows are the same `ChoiceRow` onboarding picks a currency with, down to the
 * `CODE · symbol` title — the same choice made in two places should not look
 * like two different controls.
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
    // Applied before the write so every amount on screen updates immediately;
    // the write is what makes it survive a restart.
    setActiveCurrency(currency.code, currency.symbol);
    await updateSettings({ currency: currency.code, currencySymbol: currency.symbol }).catch(() => {});
    await qc.invalidateQueries();
    router.back();
  };

  return (
    <Screen pal={B}>
      <SubHeader
        pal={B}
        title={t('bizSettings.regionLabel')}
        onBack={() => router.back()}
        style={{ marginTop: 8 }}
      />

      <View style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
        <Field
          pal={B}
          value={query}
          onChangeText={setQuery}
          placeholder={t('bizSettings.currencySearch')}
          autoCorrect={false}
          // Not "characters": the field matches codes and names alike, and
          // forcing caps mid-word rendered "dirham" as "DIrhAM".
          autoCapitalize="none"
          icon={<Search size={17} color={B.inkDim} strokeWidth={S.stroke} />}
        />
        <Type role="meta" color={B.inkDim} style={{ marginTop: 12 }}>
          {t('bizSettings.currencyNote')}
        </Type>
      </View>

      {isLoading ? (
        <View style={{ paddingTop: 60, alignItems: 'center' }}>
          <ActivityIndicator color={B.accent} />
        </View>
      ) : matches.length === 0 ? (
        <Empty
          pal={B}
          icon={<Search size={26} color={B.accent} strokeWidth={S.stroke} />}
          title={t('bizSettings.noCurrencyMatch')}
          style={{ marginTop: 64 }}
        />
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(c) => c.code}
          style={{ marginTop: 16 }}
          contentContainerStyle={{
            paddingHorizontal: S.screen,
            paddingBottom: insets.bottom + 24,
            gap: 8,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ChoiceRow
              pal={B}
              title={`${item.code} · ${item.symbol}`}
              body={item.name}
              selected={item.code === active}
              onPress={() => void choose(item)}
            />
          )}
        />
      )}
    </Screen>
  );
}
