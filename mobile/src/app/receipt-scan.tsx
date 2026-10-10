import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { R, S, useC } from '@/lib/design';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, RefreshCw, Sparkles, Zap } from '@/components/icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { addTransaction, getSettings } from '@/lib/db';
import { api } from '@/lib/api/api';
import { t } from '@/lib/i18n/core';
import { categoryLabel } from '@/lib/category-meta';
import { txTypeLabel } from '@/lib/tx-display';
import { PressableScale } from '@/components/motion';
import {
  Card,
  CircleAction,
  Empty,
  Field,
  FilterChip,
  IconTile,
  PrimaryButton,
  Screen,
  Segmented,
  SubHeader,
  SwitchRow,
  Type,
} from '@/components/kit';

type Category = 'Food' | 'Transport' | 'Shopping' | 'Gym' | 'Subscriptions' | 'Other';
type TransactionType = 'Expense' | 'Income';
type Step = 'pick' | 'analyzing' | 'review' | 'success';

interface ExtractedData {
  amount: number;
  category: Category;
  note: string;
}

const CATEGORIES: Category[] = ['Food', 'Transport', 'Shopping', 'Gym', 'Subscriptions', 'Other'];

// Routes receipt OCR through the backend AI proxy (POST /api/ai/analyze-receipt)
// so the OpenAI Vision key stays server-side. The endpoint returns the same
// ExtractedData shape the review form expects.
async function analyzeReceiptWithAI(base64Image: string): Promise<ExtractedData> {
  return api.post<ExtractedData>('/api/ai/analyze-receipt', { image: base64Image });
}

export default function ReceiptScanScreen() {
  const C = useC();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings });
  const currencySymbol = settings?.currencySymbol || '$';
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('pick');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form fields
  const [amount, setAmount] = useState<string>('');
  const [category, setCategory] = useState<Category>('Other');
  const [note, setNote] = useState<string>('');
  const [type, setType] = useState<TransactionType>('Expense');
  const [dateISO, setDateISO] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isImpulse, setIsImpulse] = useState<boolean>(false);

  /**
   * A receipt sent in from another app via the share sheet.
   *
   * share-drain.ts has already copied it out of the App Group and into the
   * app's own storage, so this only has to read it. Guarded by a ref rather
   * than the param alone: expo-router re-renders with the same params, and
   * re-analysing would bill a second vision call and overwrite the user's edits.
   */
  const { sharedUri } = useLocalSearchParams<{ sharedUri?: string }>();
  const analysedShare = useRef<string | null>(null);

  useEffect(() => {
    if (!sharedUri || analysedShare.current === sharedUri) return;
    analysedShare.current = sharedUri;

    (async () => {
      try {
        const base64 = await FileSystem.readAsStringAsync(sharedUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await analyze(sharedUri, base64);
      } catch {
        setErrorMsg(t('errors.aiFailed'));
        setStep('pick');
      }
    })();
  }, [sharedUri]);

  async function pickImage(source: 'camera' | 'library') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setErrorMsg(null);

    let result: ImagePicker.ImagePickerResult;

    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Camera permission is required to take photos.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
        allowsEditing: true,
        aspect: [3, 4],
      });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Photo library permission is required to choose photos.');
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
        allowsEditing: true,
        aspect: [3, 4],
      });
    }

    if (result.canceled || !result.assets || result.assets.length === 0) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      setErrorMsg('Could not read image data. Please try again.');
      return;
    }

    await analyze(asset.uri, asset.base64);
  }

  /**
   * Read one image and fill in the review.
   *
   * Shared by the picker and by receipts arriving from the share sheet, so a
   * receipt sent from Photos lands in exactly the same review as one taken
   * with the camera.
   */
  async function analyze(uri: string, base64: string) {
    setImageUri(uri);
    setStep('analyzing');

    try {
      const extracted = await analyzeReceiptWithAI(base64);
      setAmount(extracted.amount.toFixed(2));
      setCategory(extracted.category);
      setNote(extracted.note);
      setStep('review');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('errors.aiFailed');
      setErrorMsg(msg);
      setStep('pick');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  function resetScan() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setImageUri(null);
    setAmount('');
    setCategory('Other');
    setNote('');
    setType('Expense');
    setDateISO(new Date().toISOString().split('T')[0]);
    setIsImpulse(false);
    setErrorMsg(null);
    setStep('pick');
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = parseFloat(amount);
      if (isNaN(parsed) || parsed <= 0) throw new Error('Enter a valid amount greater than 0.');
      await addTransaction({
        amount: parsed,
        category,
        type,
        isImpulse,
        note: note.trim() || undefined,
        dateISO,
      });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setStep('success');
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorMsg(err.message);
    },
  });

  return (
    <Screen pal={C}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: step === 'review' ? 130 : 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <SubHeader
          pal={C}
          title={t('receiptScan.title')}
          onBack={() => router.back()}
          action={
            step === 'review' || step === 'analyzing' ? (
              <CircleAction pal={C} label={t('receiptScan.scanAnother')} onPress={resetScan}>
                <RefreshCw size={18} color={C.ink} strokeWidth={S.stroke} />
              </CircleAction>
            ) : undefined
          }
        />

        <Type role="meta" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
          {step === 'pick'
            ? t('receiptScan.stepPick')
            : step === 'analyzing'
              ? t('receiptScan.stepAnalyzing')
              : step === 'review'
                ? t('receiptScan.stepReview')
                : t('receiptScan.stepSuccess')}
        </Type>

        {errorMsg ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <AlertCircle size={17} color={C.negative} strokeWidth={S.stroke} />
              <Type role="body" color={C.negative} style={{ flex: 1 }}>
                {errorMsg}
              </Type>
              <PressableScale
                onPress={() => setErrorMsg(null)}
                accessibilityRole="button"
                accessibilityLabel={t('receiptScan.dismiss')}
                hitSlop={10}
              >
                <Type role="meta" color={C.inkDim}>{t('receiptScan.dismiss')}</Type>
              </PressableScale>
            </View>
          </View>
        ) : null}

        {/* ── Pick ───────────────────────────────────────────────────────── */}
        {step === 'pick' ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
            <IconTile pal={C} size={64} style={{ borderRadius: 20 }}>
              <Sparkles size={28} color={C.accent} strokeWidth={S.stroke} />
            </IconTile>
            <Type role="headline" color={C.ink} style={{ marginTop: 16 }}>
              {t('receiptScan.heroTitle')}
            </Type>
            <Type role="body" color={C.inkDim} style={{ marginTop: 12 }}>
              {t('receiptScan.heroBody')}
            </Type>

            <PrimaryButton
              pal={C}
              label={t('receiptScan.takePhoto')}
              onPress={() => pickImage('camera')}
              style={{ marginTop: S.section }}
            />
            <PrimaryButton
              pal={C}
              label={t('receiptScan.choosePhoto')}
              onPress={() => pickImage('library')}
              variant="secondary"
              style={{ marginTop: 12 }}
            />

            <View style={{ marginTop: S.section }}>
              <Type role="cardTitle" color={C.ink} style={{ marginBottom: 12 }}>
                {t('receiptScan.tipsTitle')}
              </Type>
              <Card pal={C}>
                <View style={{ gap: 12 }}>
                  {[t('receiptScan.tip1'), t('receiptScan.tip2'), t('receiptScan.tip3')].map(
                    (tip, i) => (
                      <View key={tip} style={{ flexDirection: 'row', gap: 12 }}>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: C.groundSunk,
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: 1,
                          }}
                        >
                          <Type role="meta" color={C.inkDim}>{i + 1}</Type>
                        </View>
                        <Type role="body" color={C.ink} style={{ flex: 1 }}>{tip}</Type>
                      </View>
                    )
                  )}
                </View>
              </Card>
            </View>
          </View>
        ) : null}

        {/* ── Analysing ──────────────────────────────────────────────────── */}
        {step === 'analyzing' ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
            {imageUri ? (
              <Image
                source={{ uri: imageUri }}
                style={{ width: '100%', height: 220, borderRadius: R.md }}
                contentFit="cover"
              />
            ) : null}

            <View style={{ alignItems: 'center', marginTop: 24 }}>
              <ActivityIndicator size="large" color={C.accent} />
              <Type role="section" color={C.ink} style={{ marginTop: 16, textAlign: 'center' }}>
                {t('receiptScan.analyzingTitle')}
              </Type>
              <Type role="body" color={C.inkDim} style={{ marginTop: 8, textAlign: 'center' }}>
                {t('receiptScan.analyzingBody')}
              </Type>
            </View>

            {/* Three lines of English used to sit here — "Detecting merchant
                name...", and two more — in an app that ships four languages. */}
            <View style={{ gap: 8, marginTop: 24 }}>
              {[
                t('receiptScan.analysing1'),
                t('receiptScan.analysing2'),
                t('receiptScan.analysing3'),
              ].map((line) => (
                <Type key={line} role="body" color={C.inkDim}>
                  {line}
                </Type>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Review ─────────────────────────────────────────────────────── */}
        {step === 'review' ? (
          <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
            {imageUri ? (
              <>
                <Image
                  source={{ uri: imageUri }}
                  style={{ width: '100%', height: 150, borderRadius: R.md }}
                  contentFit="cover"
                />
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 }}
                >
                  <Sparkles size={14} color={C.accent} strokeWidth={S.stroke} />
                  <Type role="meta" color={C.inkDim}>{t('receiptScan.aiExtracted')}</Type>
                </View>
              </>
            ) : null}

            <Field
              pal={C}
              label={t('receiptScan.amountLabel')}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              icon={
                <Type role="cardTitle" color={C.inkDim}>
                  {currencySymbol}
                </Type>
              }
              style={{ marginTop: 24 }}
            />

            <Type role="meta" color={C.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
              {t('receiptScan.categoryLabel')}
            </Type>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ gap: 8 }}
            >
              {CATEGORIES.map((cat) => (
                <FilterChip
                  key={cat}
                  pal={C}
                  // The stored value is canonical English and is not meant to
                  // be read; it used to be printed raw.
                  label={categoryLabel(cat)}
                  active={category === cat}
                  onPress={() => setCategory(cat)}
                />
              ))}
            </ScrollView>

            <Field
              pal={C}
              label={t('receiptScan.noteMerchant')}
              value={note}
              onChangeText={(v) => setNote(v.slice(0, 50))}
              placeholder={t('fields.merchantOrDesc')}
              returnKeyType="done"
              style={{ marginTop: 16 }}
            />

            <Type role="meta" color={C.inkDim} style={{ marginTop: 16, marginBottom: 8 }}>
              {t('receiptScan.typeLabel')}
            </Type>
            <Segmented
              pal={C}
              options={[
                { key: 'Expense' as const, label: txTypeLabel('Expense') },
                { key: 'Income' as const, label: txTypeLabel('Income') },
              ]}
              value={type}
              onChange={setType}
            />

            <Field
              pal={C}
              label={t('receiptScan.dateLabel')}
              value={dateISO}
              onChangeText={setDateISO}
              placeholder="YYYY-MM-DD"
              returnKeyType="done"
              style={{ marginTop: 16 }}
            />

            <Card pal={C} style={{ marginTop: 16 }}>
              <SwitchRow
                pal={C}
                icon={
                  <IconTile pal={C}>
                    <Zap size={19} color={C.accent} strokeWidth={S.stroke} />
                  </IconTile>
                }
                title={t('receiptScan.impulseBuy')}
                body={t('receiptScan.impulseHint')}
                value={isImpulse}
                onValueChange={setIsImpulse}
              />
            </Card>
          </View>
        ) : null}

        {/* ── Saved ──────────────────────────────────────────────────────── */}
        {step === 'success' ? (
          <>
            <Empty
              pal={C}
              icon={<Check size={26} color={C.accent} strokeWidth={2.4} />}
              title={t('receiptScan.savedTitle')}
              body={t('receiptScan.savedBody')}
              actionLabel={t('receiptScan.goToDashboard')}
              onAction={() => router.replace('/(tabs)')}
              style={{ marginTop: S.section }}
            />
            <View style={{ paddingHorizontal: S.screen, marginTop: 12 }}>
              <PrimaryButton
                pal={C}
                label={t('receiptScan.scanAnother')}
                onPress={resetScan}
                variant="secondary"
              />
            </View>
          </>
        ) : null}
      </ScrollView>

      {step === 'review' ? (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingHorizontal: S.screen,
            paddingTop: 14,
            paddingBottom: Math.max(insets.bottom, 16),
            backgroundColor: C.ground,
            borderTopWidth: 1,
            borderTopColor: C.hairline,
          }}
        >
          <PrimaryButton
            pal={C}
            label={
              saveMutation.isPending
                ? t('receiptScan.saving')
                : t('receiptScan.saveTransaction')
            }
            onPress={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          />
        </View>
      ) : null}
    </Screen>
  );
}
