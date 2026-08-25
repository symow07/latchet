import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
  Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { useC } from '@/lib/design';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Camera,
  ImageIcon,
  Sparkles,
  Check,
  AlertCircle,
  DollarSign,
  Tag,
  FileText,
  Calendar,
  Zap,
  RefreshCw,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { addTransaction } from '@/lib/db';
import { api } from '@/lib/api/api';
import { t } from '@/lib/i18n/core';

type Category = 'Food' | 'Transport' | 'Shopping' | 'Gym' | 'Subscriptions' | 'Other';
type TransactionType = 'Expense' | 'Income';
type Step = 'pick' | 'analyzing' | 'review' | 'success';

interface ExtractedData {
  amount: number;
  category: Category;
  note: string;
}

const CATEGORIES: Category[] = ['Food', 'Transport', 'Shopping', 'Gym', 'Subscriptions', 'Other'];

const CATEGORY_COLORS: Record<Category, { color: string; bg: string }> = {
  Food: { color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  Transport: { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  Shopping: { color: '#ec4899', bg: 'rgba(236,72,153,0.15)' },
  Gym: { color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  Subscriptions: { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  Other: { color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
};

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

    setImageUri(asset.uri);
    setStep('analyzing');

    try {
      const extracted = await analyzeReceiptWithAI(asset.base64);
      setAmount(extracted.amount.toFixed(2));
      setCategory(extracted.category);
      setNote(extracted.note);
      setStep('review');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI analysis failed. Please try again.';
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
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <LinearGradient
        colors={[C.p700, C.p600, C.p500]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 20,
          paddingHorizontal: 16,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft size={20} color="white" />
          </Pressable>

          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>{t('receiptScan.title')}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 }}>
              {step === 'pick' && 'Take or choose a photo'}
              {step === 'analyzing' && 'AI is reading your receipt...'}
              {step === 'review' && 'Review & save'}
              {step === 'success' && 'Transaction saved!'}
            </Text>
          </View>

          {(step === 'review' || step === 'analyzing') ? (
            <Pressable
              onPress={resetScan}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(255,255,255,0.2)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RefreshCw size={18} color="white" />
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Error Banner */}
        {errorMsg && (
          <Animated.View entering={FadeInDown.duration(300)} style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            <View
              style={{
                borderRadius: 16,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: 'rgba(239,68,68,0.1)',
                borderWidth: 1,
                borderColor: 'rgba(239,68,68,0.25)',
              }}
            >
              <AlertCircle size={18} color="#ef4444" />
              <Text style={{ color: '#f87171', marginLeft: 10, flex: 1, fontSize: 13 }}>{errorMsg}</Text>
              <Pressable onPress={() => setErrorMsg(null)}>
                <Text style={{ color: '#f87171', fontWeight: '600', fontSize: 13 }}>{t('receiptScan.dismiss')}</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}

        {/* STEP: PICK */}
        {step === 'pick' && (
          <Animated.View entering={FadeInUp.duration(400)} style={{ paddingHorizontal: 16, paddingTop: 28 }}>
            {/* Hero prompt */}
            <View style={{ alignItems: 'center', marginBottom: 32 }}>
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 24,
                  backgroundColor: 'rgba(168,85,247,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                  borderWidth: 1,
                  borderColor: 'rgba(168,85,247,0.3)',
                }}
              >
                <Sparkles size={36} color={C.p500} />
              </View>
              <Text style={{ color: 'white', fontSize: 22, fontWeight: 'bold', marginBottom: 8 }}>
                Scan a Receipt
              </Text>
              <Text style={{ color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
                Point your camera at any receipt. AI will automatically extract the amount, category, and merchant.
              </Text>
            </View>

            {/* Camera Button */}
            <Pressable
              onPress={() => pickImage('camera')}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: 14 })}
            >
              <LinearGradient
                colors={[C.p600, C.p500]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  borderRadius: 20,
                  padding: 20,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 16,
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 16,
                  }}
                >
                  <Camera size={26} color="white" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 17, marginBottom: 2 }}>
                    Take Photo
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                    Use your camera to capture a receipt
                  </Text>
                </View>
              </LinearGradient>
            </Pressable>

            {/* Gallery Button */}
            <Pressable
              onPress={() => pickImage('library')}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <View
                style={{
                  borderRadius: 20,
                  padding: 20,
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: C.glass,
                  borderWidth: 1,
                  borderColor: C.glassBorder,
                }}
              >
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 16,
                    backgroundColor: 'rgba(168,85,247,0.15)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 16,
                  }}
                >
                  <ImageIcon size={26} color={C.p500} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 17, marginBottom: 2 }}>
                    Choose Photo
                  </Text>
                  <Text style={{ color: C.textDim, fontSize: 13 }}>
                    Pick an existing receipt from your library
                  </Text>
                </View>
              </View>
            </Pressable>

            {/* Tips */}
            <View style={{ marginTop: 32 }}>
              <Text style={{ color: C.textFaint, fontSize: 11, fontWeight: '600', marginBottom: 12, marginLeft: 4 }}>
                TIPS FOR BEST RESULTS
              </Text>
              {[
                'Lay the receipt flat on a surface',
                'Make sure all text is clearly visible',
                'Use good lighting to reduce shadows',
              ].map((tip, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: C.glass,
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: 'rgba(168,85,247,0.15)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ color: C.p500, fontSize: 11, fontWeight: 'bold' }}>{i + 1}</Text>
                  </View>
                  <Text style={{ color: C.textDim, fontSize: 13, flex: 1 }}>{tip}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
        )}

        {/* STEP: ANALYZING */}
        {step === 'analyzing' && (
          <Animated.View
            entering={FadeInUp.duration(400)}
            style={{ paddingHorizontal: 16, paddingTop: 28, alignItems: 'center' }}
          >
            {/* Image preview */}
            {imageUri && (
              <View
                style={{
                  width: '100%',
                  borderRadius: 20,
                  overflow: 'hidden',
                  marginBottom: 28,
                  borderWidth: 1,
                  borderColor: 'rgba(168,85,247,0.3)',
                }}
              >
                <Image
                  source={{ uri: imageUri }}
                  style={{ width: '100%', height: 240 }}
                  contentFit="cover"
                />
                <LinearGradient
                  colors={['transparent', 'rgba(13,13,15,0.9)']}
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 80,
                  }}
                />
              </View>
            )}

            {/* Spinner + text */}
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 24,
                backgroundColor: 'rgba(168,85,247,0.12)',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 20,
                borderWidth: 1,
                borderColor: 'rgba(168,85,247,0.25)',
              }}
            >
              <ActivityIndicator size="large" color={C.p500} />
            </View>
            <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 8 }}>
              Analyzing Receipt...
            </Text>
            <Text style={{ color: C.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
              AI is reading the receipt and extracting transaction details for you.
            </Text>

            <View
              style={{
                marginTop: 28,
                backgroundColor: 'rgba(168,85,247,0.08)',
                borderRadius: 16,
                padding: 16,
                width: '100%',
                borderWidth: 1,
                borderColor: 'rgba(168,85,247,0.15)',
              }}
            >
              {['Detecting merchant name...', 'Reading total amount...', 'Categorizing purchase...'].map(
                (line, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      marginBottom: i < 2 ? 10 : 0,
                    }}
                  >
                    <ActivityIndicator size="small" color={C.p500} style={{ marginRight: 10 }} />
                    <Text style={{ color: C.p400, fontSize: 13 }}>{line}</Text>
                  </View>
                )
              )}
            </View>
          </Animated.View>
        )}

        {/* STEP: REVIEW */}
        {step === 'review' && (
          <Animated.View entering={FadeInUp.duration(400)} style={{ paddingHorizontal: 16, paddingTop: 20 }}>
            {/* Image thumbnail */}
            {imageUri && (
              <View
                style={{
                  borderRadius: 20,
                  overflow: 'hidden',
                  marginBottom: 20,
                  borderWidth: 1,
                  borderColor: 'rgba(168,85,247,0.25)',
                }}
              >
                <Image
                  source={{ uri: imageUri }}
                  style={{ width: '100%', height: 160 }}
                  contentFit="cover"
                />
                <LinearGradient
                  colors={['transparent', 'rgba(13,13,15,0.85)']}
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 60,
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    bottom: 10,
                    left: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                  }}
                >
                  <Sparkles size={14} color={C.p500} />
                  <Text style={{ color: C.p400, fontSize: 12, marginLeft: 5, fontWeight: '600' }}>
                    AI extracted — review before saving
                  </Text>
                </View>
              </View>
            )}

            {/* Amount */}
            <View style={{ marginBottom: 14 }}>
              <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '600', marginBottom: 8, marginLeft: 4 }}>
                AMOUNT
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: C.glass,
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderWidth: 1,
                  borderColor: 'rgba(168,85,247,0.2)',
                }}
              >
                <DollarSign size={20} color={C.p500} style={{ marginRight: 10 }} />
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#555"
                  selectionColor={C.p500}
                  style={{ flex: 1, color: 'white', fontSize: 22, fontWeight: 'bold' }}
                />
              </View>
            </View>

            {/* Category */}
            <View style={{ marginBottom: 14 }}>
              <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '600', marginBottom: 8, marginLeft: 4 }}>
                CATEGORY
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0 }}
                contentContainerStyle={{ paddingHorizontal: 0, gap: 8 }}
              >
                {CATEGORIES.map((cat) => {
                  const active = category === cat;
                  const colors = CATEGORY_COLORS[cat];
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => {
                        setCategory(cat);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                    >
                      <View
                        style={{
                          borderRadius: 12,
                          paddingHorizontal: 14,
                          paddingVertical: 9,
                          backgroundColor: active ? colors.bg : 'rgba(255,255,255,0.05)',
                          borderWidth: 1,
                          borderColor: active ? colors.color + '55' : 'rgba(255,255,255,0.06)',
                          flexDirection: 'row',
                          alignItems: 'center',
                        }}
                      >
                        <Tag size={13} color={active ? colors.color : '#6b7280'} style={{ marginRight: 5 }} />
                        <Text
                          style={{
                            color: active ? colors.color : '#9ca3af',
                            fontWeight: active ? '700' : '500',
                            fontSize: 13,
                          }}
                        >
                          {cat}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Note */}
            <View style={{ marginBottom: 14 }}>
              <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '600', marginBottom: 8, marginLeft: 4 }}>
                NOTE / MERCHANT
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: C.glass,
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderWidth: 1,
                  borderColor: C.glassBorder,
                }}
              >
                <FileText size={18} color="#6b7280" style={{ marginRight: 10 }} />
                <TextInput
                  value={note}
                  onChangeText={(t) => setNote(t.slice(0, 50))}
                  placeholder="Merchant or description"
                  placeholderTextColor="#555"
                  selectionColor={C.p500}
                  style={{ flex: 1, color: 'white', fontSize: 15 }}
                  returnKeyType="done"
                />
              </View>
            </View>

            {/* Type toggle */}
            <View style={{ marginBottom: 14 }}>
              <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '600', marginBottom: 8, marginLeft: 4 }}>
                TYPE
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {(['Expense', 'Income'] as TransactionType[]).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => {
                      setType(t);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={{ flex: 1 }}
                  >
                    <View
                      style={{
                        borderRadius: 14,
                        paddingVertical: 13,
                        alignItems: 'center',
                        backgroundColor:
                          type === t
                            ? t === 'Expense'
                              ? 'rgba(239,68,68,0.18)'
                              : 'rgba(34,197,94,0.18)'
                            : 'rgba(255,255,255,0.05)',
                        borderWidth: 1,
                        borderColor:
                          type === t
                            ? t === 'Expense'
                              ? 'rgba(239,68,68,0.4)'
                              : 'rgba(34,197,94,0.4)'
                            : 'rgba(255,255,255,0.07)',
                      }}
                    >
                      <Text
                        style={{
                          fontWeight: '700',
                          fontSize: 14,
                          color:
                            type === t ? (t === 'Expense' ? '#f87171' : '#4ade80') : '#6b7280',
                        }}
                      >
                        {t}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Date */}
            <View style={{ marginBottom: 14 }}>
              <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '600', marginBottom: 8, marginLeft: 4 }}>
                DATE
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: C.glass,
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderWidth: 1,
                  borderColor: C.glassBorder,
                }}
              >
                <Calendar size={18} color="#6b7280" style={{ marginRight: 10 }} />
                <TextInput
                  value={dateISO}
                  onChangeText={setDateISO}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#555"
                  selectionColor={C.p500}
                  style={{ flex: 1, color: 'white', fontSize: 15 }}
                  returnKeyType="done"
                />
              </View>
            </View>

            {/* Impulse toggle */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: isImpulse ? 'rgba(236,72,153,0.1)' : 'rgba(255,255,255,0.05)',
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: isImpulse ? 'rgba(236,72,153,0.3)' : 'rgba(255,255,255,0.07)',
                marginBottom: 28,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    backgroundColor: isImpulse ? 'rgba(236,72,153,0.2)' : 'rgba(255,255,255,0.06)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 12,
                  }}
                >
                  <Zap size={18} color={isImpulse ? '#ec4899' : '#6b7280'} />
                </View>
                <View>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 15 }}>{t('receiptScan.impulseBuy')}</Text>
                  <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 1 }}>
                    Mark as an unplanned purchase
                  </Text>
                </View>
              </View>
              <Switch
                value={isImpulse}
                onValueChange={(v) => {
                  setIsImpulse(v);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                trackColor={{ false: '#374151', true: '#ec4899' }}
                thumbColor={isImpulse ? '#fff' : '#9ca3af'}
              />
            </View>
          </Animated.View>
        )}

        {/* STEP: SUCCESS */}
        {step === 'success' && (
          <Animated.View
            entering={ZoomIn.duration(400)}
            style={{ paddingHorizontal: 16, paddingTop: 48, alignItems: 'center' }}
          >
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: 'rgba(34,197,94,0.15)',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 24,
                borderWidth: 2,
                borderColor: 'rgba(34,197,94,0.35)',
              }}
            >
              <Check size={48} color="#22c55e" />
            </View>
            <Text style={{ color: 'white', fontSize: 26, fontWeight: 'bold', marginBottom: 10 }}>
              Transaction Saved!
            </Text>
            <Text style={{ color: C.textDim, fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 36 }}>
              Your receipt has been scanned and saved to your transaction history.
            </Text>

            <View style={{ width: '100%', gap: 12 }}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.replace('/(tabs)');
                }}
                style={{ width: '100%' }}
              >
                <LinearGradient
                  colors={['#22c55e', '#16a34a']}
                  style={{ borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
                >
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 17 }}>{t('receiptScan.goToDashboard')}</Text>
                </LinearGradient>
              </Pressable>

              <Pressable
                onPress={resetScan}
                style={{ width: '100%' }}
              >
                <View
                  style={{
                    borderRadius: 16,
                    paddingVertical: 16,
                    alignItems: 'center',
                    backgroundColor: 'rgba(168,85,247,0.12)',
                    borderWidth: 1,
                    borderColor: 'rgba(168,85,247,0.3)',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <Camera size={18} color={C.p500} />
                  <Text style={{ color: C.p500, fontWeight: '700', fontSize: 16 }}>
                    Scan Another Receipt
                  </Text>
                </View>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </ScrollView>

      {/* Save button — fixed at bottom during review */}
      {step === 'review' && (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: Math.max(insets.bottom, 18),
            backgroundColor: C.bg,
            borderTopWidth: 1,
            borderTopColor: C.glassBorder,
          }}
        >
          <Pressable
            onPress={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}
          >
            <LinearGradient
              colors={saveMutation.isPending ? ['#374151', '#374151'] : [C.p600, C.p500]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 18,
                paddingVertical: 17,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
              }}
            >
              {saveMutation.isPending ? (
                <>
                  <ActivityIndicator size="small" color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 17, marginLeft: 10 }}>
                    Saving...
                  </Text>
                </>
              ) : (
                <>
                  <Check size={20} color="white" />
                  <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 17, marginLeft: 8 }}>
                    Save Transaction
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      )}
    </View>
  );
}
