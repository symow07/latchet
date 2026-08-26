import { useState } from 'react';
import { View, Modal, Pressable, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { Check, X, Mic, ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Txt, GlassCard, BubbleButton, EmptyState } from '@/components/ui';
import { useC, R } from '@/lib/design';
import { t } from '@/lib/i18n/core';
import { categoryLabel } from '@/lib/category-meta';
import { formatCurrency } from '@/lib/calculations';
import {
  toReviewRows,
  toTransactionInputs,
  reviewTotals,
  type ReviewRow,
  type VoiceResult,
} from '@/lib/voice-capture';

/**
 * What was heard, before any of it is saved.
 *
 * The whole point of the sheet: speech is the least reliable input the app
 * has, so nothing reaches the database until the user has seen it. Amounts are
 * editable in place because a misheard "fifteen" for "fifty" is the most
 * likely error and forcing a re-record to fix one digit would waste the time
 * the feature exists to save.
 *
 * The transcript is shown above the rows so a wrong figure is explicable — the
 * user can see whether the model misheard them or they misspoke.
 */
export function VoiceReviewSheet({
  result,
  visible,
  saving,
  onCancel,
  onConfirm,
}: {
  result: VoiceResult | null;
  visible: boolean;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (rows: ReviewRow[]) => void;
}) {
  const C = useC();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [seeded, setSeeded] = useState<VoiceResult | null>(null);

  // Seed from the result the first time it arrives, then leave the user's
  // edits alone — re-seeding on every render would undo them as they type.
  if (result && result !== seeded) {
    setSeeded(result);
    setRows(toReviewRows(result.rows));
  }

  const totals = reviewTotals(rows);

  const update = (key: string, patch: Partial<ReviewRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: C.bgRaise,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingTop: 18,
            paddingBottom: 34,
            maxHeight: '88%',
            borderWidth: 1,
            borderColor: C.glassBorder,
          }}
        >
          <View className="flex-row items-center justify-between" style={{ paddingHorizontal: 20, marginBottom: 14 }}>
            <Txt weight="bold" size={19} color={C.text}>{t('voice.reviewTitle')}</Txt>
            <Pressable onPress={onCancel} hitSlop={12}>
              <X size={22} color={C.textFaint} />
            </Pressable>
          </View>

          {result?.transcript ? (
            <View style={{ paddingHorizontal: 20, marginBottom: 14 }}>
              <GlassCard padding={13} radius={R.md}>
                <Txt size={12} color={C.textFaint} style={{ marginBottom: 4 }}>{t('voice.heard')}</Txt>
                <Txt size={13} color={C.textDim} style={{ lineHeight: 19 }}>{result.transcript}</Txt>
              </GlassCard>
            </View>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              compact
              icon={<Mic size={24} color={C.textFaint} />}
              title={t('voice.nothingHeard')}
              body={t('voice.nothingHeardBody')}
            />
          ) : (
            <ScrollView style={{ paddingHorizontal: 20 }} showsVerticalScrollIndicator>
              {rows.map((row) => {
                const income = row.type === 'Income';
                const accent = income ? C.green : C.rose;
                return (
                  <Pressable
                    key={row.key}
                    onPress={() => {
                      Haptics.selectionAsync();
                      update(row.key, { include: !row.include });
                    }}
                    style={{ marginBottom: 10, opacity: row.include ? 1 : 0.45 }}
                  >
                    <GlassCard padding={14} radius={R.md}>
                      <View className="flex-row items-center" style={{ gap: 12 }}>
                        <View
                          style={{
                            width: 34, height: 34, borderRadius: 12,
                            alignItems: 'center', justifyContent: 'center',
                            backgroundColor: `${accent}1f`,
                          }}
                        >
                          {income
                            ? <ArrowDownLeft size={17} color={accent} />
                            : <ArrowUpRight size={17} color={accent} />}
                        </View>

                        <View className="flex-1">
                          <Txt weight="semibold" size={14} color={C.text} numberOfLines={1}>
                            {row.note || categoryLabel(row.category)}
                          </Txt>
                          <Txt size={11} color={C.textFaint} style={{ marginTop: 2 }}>
                            {categoryLabel(row.category)} · {row.dateISO}
                          </Txt>
                        </View>

                        {/* Editable in place: a misheard digit is the likely
                            error, and re-recording to fix one is absurd. */}
                        <TextInput
                          value={row.amount ? String(row.amount) : ''}
                          onChangeText={(v) => {
                            const n = Number(v.replace(',', '.'));
                            update(row.key, { amount: isFinite(n) && n > 0 ? n : 0 });
                          }}
                          keyboardType="decimal-pad"
                          selectionColor={C.p500}
                          style={{
                            color: accent,
                            fontSize: 16,
                            fontFamily: 'PlusJakartaSans_700Bold',
                            minWidth: 68,
                            textAlign: 'right',
                            paddingVertical: 4,
                          }}
                        />

                        <View
                          style={{
                            width: 22, height: 22, borderRadius: 11,
                            alignItems: 'center', justifyContent: 'center',
                            backgroundColor: row.include ? C.p500 : 'transparent',
                            borderWidth: row.include ? 0 : 1.5,
                            borderColor: C.glassBorder,
                          }}
                        >
                          {row.include ? <Check size={13} color="#fff" strokeWidth={3} /> : null}
                        </View>
                      </View>
                    </GlassCard>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {rows.length > 0 ? (
            <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
              <View className="flex-row items-center justify-between" style={{ marginBottom: 12 }}>
                <Txt size={12} color={C.textFaint}>
                  {t('voice.selectedCount', { count: totals.count })}
                </Txt>
                <Txt weight="bold" size={14} color={C.text}>
                  {totals.income > 0 ? `+${formatCurrency(totals.income)}  ` : ''}
                  {totals.expense > 0 ? `−${formatCurrency(totals.expense)}` : ''}
                </Txt>
              </View>
              {saving ? (
                <View style={{ height: 54, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color={C.p400} />
                </View>
              ) : (
                <BubbleButton
                  label={t('voice.saveCount', { count: totals.count })}
                  onPress={() => onConfirm(rows)}
                  disabled={totals.count === 0}
                />
              )}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export { toTransactionInputs };
