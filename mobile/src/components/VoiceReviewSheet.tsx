import { useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { ArrowDownLeft, ArrowUpRight, Check, Mic } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { F, S, useC } from '@/lib/design';
import { Card, Empty, PrimaryButton, Sheet, Touchable, Type } from '@/components/kit';
import { t } from '@/lib/i18n/core';
import { categoryLabel } from '@/lib/category-meta';
import { formatCurrency } from '@/lib/calculations';
import {
  reviewTotals,
  toReviewRows,
  toTransactionInputs,
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
 *
 * It now uses the kit's `Sheet`, which means it can be dragged away and
 * flicked shut like every other sheet in the app, instead of only closing
 * through its own × button.
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
    <Sheet pal={C} visible={visible} onClose={onCancel} title={t('voice.reviewTitle')}>
      <View style={{ paddingHorizontal: S.card }}>
        {result?.transcript ? (
          <Card pal={C} contentStyle={{ padding: 16, backgroundColor: C.groundSunk }}>
            <Type role="meta" color={C.inkDim}>
              {t('voice.heard')}
            </Type>
            <Type role="body" color={C.ink} style={{ marginTop: 4 }}>
              {result.transcript}
            </Type>
          </Card>
        ) : null}

        {rows.length === 0 ? (
          <Empty
            pal={C}
            icon={<Mic size={26} color={C.accent} strokeWidth={S.stroke} />}
            title={t('voice.nothingHeard')}
            body={t('voice.nothingHeardBody')}
            style={{ marginVertical: 32 }}
          />
        ) : (
          <>
            <ScrollView
              style={{ maxHeight: 320, marginTop: result?.transcript ? 16 : 0 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                {rows.map((row, i) => {
                  const income = row.type === 'Income';
                  const tone = income ? C.positive : C.negative;
                  return (
                    <Touchable
                      key={row.key}
                      pal={C}
                      // The whole row toggles inclusion; the amount field
                      // captures its own touches, so tapping a figure edits it
                      // rather than deselecting the row.
                      onPress={() => {
                        Haptics.selectionAsync();
                        update(row.key, { include: !row.include });
                      }}
                      accessibilityLabel={row.note || categoryLabel(row.category)}
                      style={[
                        {
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          minHeight: 64,
                          opacity: row.include ? 1 : 0.45,
                        },
                        i > 0 ? { borderTopWidth: 1, borderTopColor: C.hairline } : null,
                      ]}
                    >
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: C.groundSunk,
                        }}
                      >
                        {income ? (
                          <ArrowDownLeft size={17} color={tone} strokeWidth={S.stroke} />
                        ) : (
                          <ArrowUpRight size={17} color={tone} strokeWidth={S.stroke} />
                        )}
                      </View>

                      <View style={{ flex: 1 }}>
                        <Type role="cardTitle" color={C.ink} numberOfLines={1}>
                          {row.note || categoryLabel(row.category)}
                        </Type>
                        <Type role="meta" color={C.inkDim} numberOfLines={1}>
                          {`${categoryLabel(row.category)} · ${row.dateISO}`}
                        </Type>
                      </View>

                      {/* Editable in place: a misheard digit is the likely
                          error, and re-recording to fix one is absurd. */}
                      <TextInput
                        value={row.amount ? String(row.amount) : ''}
                        onChangeText={(v) => {
                          const n = Number(v.replace(',', '.'));
                          update(row.key, { amount: Number.isFinite(n) && n > 0 ? n : 0 });
                        }}
                        keyboardType="decimal-pad"
                        selectionColor={C.accent}
                        accessibilityLabel={row.note || categoryLabel(row.category)}
                        style={{
                          color: tone,
                          fontSize: 17,
                          ...F.semibold,
                          minWidth: 68,
                          textAlign: 'right',
                          paddingVertical: 4,
                          fontVariant: ['tabular-nums'],
                        }}
                      />

                      <View
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: row.include }}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: row.include ? C.ink : 'transparent',
                          borderWidth: row.include ? 0 : 1.5,
                          borderColor: C.inkFaint,
                        }}
                      >
                        {row.include ? (
                          <Check size={14} color={C.onInk} strokeWidth={2.6} />
                        ) : null}
                      </View>
                    </Touchable>
                  );
                })}
              </Card>
            </ScrollView>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 18,
                gap: 12,
              }}
            >
              <Type role="meta" color={C.inkDim}>
                {t('voice.selectedCount', { count: totals.count })}
              </Type>
              <Type role="cardTitle" color={C.ink}>
                {[
                  totals.income > 0 ? `+${formatCurrency(totals.income)}` : null,
                  totals.expense > 0 ? `−${formatCurrency(totals.expense)}` : null,
                ]
                  .filter(Boolean)
                  .join('  ')}
              </Type>
            </View>

            {saving ? (
              <View style={{ height: 56, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={C.accent} />
              </View>
            ) : (
              <PrimaryButton
                pal={C}
                label={t('voice.saveCount', { count: totals.count })}
                onPress={() => onConfirm(rows)}
                disabled={totals.count === 0}
                style={{ marginTop: 14 }}
              />
            )}
          </>
        )}
      </View>
    </Sheet>
  );
}

export { toTransactionInputs };
