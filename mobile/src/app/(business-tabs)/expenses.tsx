import {
  View, Text, ScrollView, Pressable, TextInput,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator,
  RefreshControl, Alert, Image,
} from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Receipt, Plus, X, Check, XCircle,
  Plane, Laptop, Coffee, Car, Building, Tag,
  ChevronDown, Clock, Camera, ImageIcon,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getExpenses, submitExpense, approveExpense, rejectExpense,
  type Expense, type ExpenseStatus, type ExpenseCategory,
} from '@/lib/expenseApi';
import { getBusiness } from '@/lib/businessApi';
import { useSession } from '@/lib/auth/use-session';

// ─── Constants ────────────────────────────────────────────────────────────────

type CatMeta = {
  label: ExpenseCategory;
  icon: React.ComponentType<{ size: number; color: string }>;
  color: string;
};

const CATEGORIES: CatMeta[] = [
  { label: 'Travel',    icon: Plane,    color: '#818cf8' },
  { label: 'Software',  icon: Laptop,   color: '#34d399' },
  { label: 'Meals',     icon: Coffee,   color: '#fbbf24' },
  { label: 'Transport', icon: Car,      color: '#60a5fa' },
  { label: 'Office',    icon: Building, color: '#f472b6' },
  { label: 'Other',     icon: Tag,      color: '#a78bfa' },
];

const STATUS_FILTERS: { label: string; value: ExpenseStatus | 'all' }[] = [
  { label: 'All',      value: 'all'      },
  { label: 'Pending',  value: 'pending'  },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

const STATUS_STYLE: Record<ExpenseStatus, { bg: string; text: string; border: string }> = {
  pending:  { bg: 'rgba(251,191,36,0.12)',  text: '#fbbf24', border: 'rgba(251,191,36,0.3)'  },
  approved: { bg: 'rgba(34,197,94,0.12)',   text: '#22c55e', border: 'rgba(34,197,94,0.3)'   },
  rejected: { bg: 'rgba(239,68,68,0.12)',   text: '#ef4444', border: 'rgba(239,68,68,0.3)'   },
};

function catMeta(cat: string): CatMeta {
  return CATEGORIES.find(c => c.label === cat) ?? CATEGORIES[5];
}

// ─── Submit Modal ─────────────────────────────────────────────────────────────

function SubmitModal({
  visible,
  onClose,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount,     setAmount]     = useState('');
  const [desc,       setDesc]       = useState('');
  const [cat,        setCat]        = useState<ExpenseCategory>('Other');
  const [catOpen,    setCatOpen]    = useState(false);
  const [imageUri,   setImageUri]   = useState<string | null>(null);
  const [err,        setErr]        = useState('');

  async function pickImage() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
      base64: false,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  async function takePhoto() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.7,
      base64: false,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  const mutation = useMutation({
    mutationFn: () => {
      const num = parseFloat(amount);
      if (isNaN(num) || num <= 0) throw new Error('Enter a valid amount');
      if (!desc.trim()) throw new Error('Description is required');
      return submitExpense({ amount: num, category: cat, description: desc.trim(), imageUrl: imageUri });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAmount(''); setDesc(''); setCat('Other'); setImageUri(null); setErr('');
      onDone();
      onClose();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message);
    },
  });

  const selCat = CATEGORIES.find(c => c.label === cat)!;
  const CatIcon = selCat.icon;

  function handleClose() {
    setAmount(''); setDesc(''); setCat('Other'); setImageUri(null); setErr('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Pressable style={{ flex: 1 }} onPress={handleClose} />

        <View style={{
          backgroundColor: '#0d1828',
          borderTopLeftRadius: 32, borderTopRightRadius: 32,
          borderWidth: 1, borderColor: 'rgba(96,165,250,0.15)',
          padding: 24, paddingBottom: 48,
          maxHeight: '92%',
        }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Handle */}
            <View style={{ width: 40, height: 4, backgroundColor: '#1e3a5f', borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />

            {/* Title */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>New Expense</Text>
              <Pressable onPress={handleClose} hitSlop={10}><X size={22} color="#4b5563" /></Pressable>
            </View>

            {!!err && (
              <View style={{ backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' }}>
                <Text style={{ color: '#f87171', fontSize: 13, textAlign: 'center' }}>{err}</Text>
              </View>
            )}

            {/* Amount */}
            <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 }}>AMOUNT</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 14 }}>
              <Text style={{ color: '#60a5fa', fontSize: 20, fontWeight: '700', marginRight: 8 }}>$</Text>
              <TextInput
                value={amount}
                onChangeText={t => { setAmount(t); setErr(''); }}
                placeholder="0.00"
                placeholderTextColor="#1f3a5f"
                keyboardType="decimal-pad"
                style={{ flex: 1, color: '#fff', fontSize: 24, fontWeight: '700' }}
                selectionColor="#60a5fa"
              />
            </View>

            {/* Category */}
            <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 }}>CATEGORY</Text>
            <Pressable
              onPress={() => setCatOpen(v => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, borderWidth: 1, borderColor: catOpen ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.08)', marginBottom: catOpen ? 0 : 14 }}
            >
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: `${selCat.color}18`, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <CatIcon size={16} color={selCat.color} />
              </View>
              <Text style={{ flex: 1, color: '#d1d5db', fontSize: 15, fontWeight: '500' }}>{cat}</Text>
              <ChevronDown size={16} color="#4b5563" />
            </Pressable>
            {catOpen && (
              <View style={{ backgroundColor: '#0a1422', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 14 }}>
                {CATEGORIES.map(c => {
                  const Icon = c.icon;
                  const active = cat === c.label;
                  return (
                    <Pressable
                      key={c.label}
                      onPress={() => { setCat(c.label); setCatOpen(false); }}
                      style={({ pressed }) => ({
                        opacity: pressed ? 0.7 : 1,
                        flexDirection: 'row', alignItems: 'center',
                        paddingHorizontal: 16, paddingVertical: 11,
                        borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
                        backgroundColor: active ? 'rgba(96,165,250,0.08)' : 'transparent',
                      })}
                    >
                      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${c.color}18`, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                        <Icon size={14} color={c.color} />
                      </View>
                      <Text style={{ flex: 1, color: active ? '#60a5fa' : '#9ca3af', fontSize: 14, fontWeight: '500' }}>{c.label}</Text>
                      {active && <Check size={14} color="#60a5fa" />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Description */}
            <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 }}>DESCRIPTION</Text>
            <TextInput
              value={desc}
              onChangeText={t => { setDesc(t); setErr(''); }}
              placeholder="What was this for?"
              placeholderTextColor="#1f3a5f"
              multiline
              numberOfLines={3}
              style={{ color: '#fff', fontSize: 15, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', textAlignVertical: 'top', minHeight: 80, marginBottom: 14 }}
              selectionColor="#60a5fa"
            />

            {/* Receipt / Image */}
            <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 }}>RECEIPT (OPTIONAL)</Text>
            {imageUri ? (
              <View style={{ marginBottom: 14 }}>
                <View style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 8 }}>
                  <Image source={{ uri: imageUri }} style={{ width: '100%', height: 140, borderRadius: 16 }} resizeMode="cover" />
                </View>
                <Pressable
                  onPress={() => setImageUri(null)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)' }}
                >
                  <X size={14} color="#ef4444" />
                  <Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '600' }}>Remove Image</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <Pressable
                  onPress={takePhoto}
                  style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: 14, paddingVertical: 13, borderWidth: 1, borderColor: 'rgba(96,165,250,0.18)' })}
                >
                  <Camera size={16} color="#60a5fa" />
                  <Text style={{ color: '#60a5fa', fontWeight: '600', fontSize: 13 }}>Camera</Text>
                </Pressable>
                <Pressable
                  onPress={pickImage}
                  style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: 14, paddingVertical: 13, borderWidth: 1, borderColor: 'rgba(96,165,250,0.18)' })}
                >
                  <ImageIcon size={16} color="#60a5fa" />
                  <Text style={{ color: '#60a5fa', fontWeight: '600', fontSize: 13 }}>Gallery</Text>
                </Pressable>
              </View>
            )}

            {/* Submit */}
            <Pressable onPress={() => mutation.mutate()} disabled={mutation.isPending} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginTop: 4 })}>
              <LinearGradient
                colors={mutation.isPending ? ['#1e3a5f', '#1e3a5f'] : ['#1d4ed8', '#3b82f6']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ borderRadius: 18, paddingVertical: 18, alignItems: 'center' }}
              >
                {mutation.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Submit Expense</Text>
                }
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Expense Card ─────────────────────────────────────────────────────────────

function ExpenseCard({
  expense, canReview, onApprove, onReject,
}: {
  expense: Expense;
  canReview: boolean;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
}) {
  const [showImage, setShowImage] = useState(false);
  const meta    = catMeta(expense.category);
  const CatIcon = meta.icon;
  const ss      = STATUS_STYLE[expense.status];
  const date    = new Date(expense.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 10 }}>
      {/* Top row */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: `${meta.color}18`, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <CatIcon size={20} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: '600', marginBottom: 2 }} numberOfLines={2}>
            {expense.description}
          </Text>
          <Text style={{ color: '#4b5563', fontSize: 12 }}>
            {expense.submitter.name} · {date}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>${expense.amount.toFixed(2)}</Text>
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: ss.bg, borderWidth: 1, borderColor: ss.border }}>
            <Text style={{ color: ss.text, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {expense.status}
            </Text>
          </View>
        </View>
      </View>

      {/* Receipt image thumbnail */}
      {expense.imageUrl && (
        <Pressable
          onPress={() => setShowImage(v => !v)}
          style={{ marginBottom: 8 }}
        >
          {showImage ? (
            <View style={{ borderRadius: 12, overflow: 'hidden' }}>
              <Image source={{ uri: expense.imageUrl }} style={{ width: '100%', height: 160, borderRadius: 12 }} resizeMode="cover" />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(96,165,250,0.15)' }}>
              <ImageIcon size={12} color="#60a5fa" />
              <Text style={{ color: '#60a5fa', fontSize: 11, fontWeight: '600' }}>View Receipt</Text>
            </View>
          )}
        </Pressable>
      )}

      {/* Reviewer note */}
      {expense.reviewer && (
        <Text style={{ color: '#374151', fontSize: 12, marginBottom: 6 }}>
          {expense.status === 'approved' ? '✓ Approved' : '✗ Rejected'} by {expense.reviewer.name}
        </Text>
      )}

      {/* Actions for pending expenses */}
      {canReview && expense.status === 'pending' && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <Pressable
            onPress={() => onApprove(expense.id)}
            style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 12, paddingVertical: 10, gap: 5, borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)' })}
          >
            <Check size={14} color="#22c55e" strokeWidth={3} />
            <Text style={{ color: '#22c55e', fontWeight: '700', fontSize: 13 }}>Approve</Text>
          </Pressable>
          <Pressable
            onPress={() => onReject(expense.id)}
            style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 12, paddingVertical: 10, gap: 5, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' })}
          >
            <XCircle size={14} color="#ef4444" />
            <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 13 }}>Reject</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const [filter,     setFilter]     = useState<ExpenseStatus | 'all'>('all');
  const [showSubmit, setShowSubmit] = useState(false);

  const { data: expenses = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['biz-expenses', filter],
    queryFn: () => getExpenses(filter === 'all' ? undefined : filter),
  });

  const { data: business } = useQuery({
    queryKey: ['my-business'],
    queryFn: getBusiness,
  });

  const myRole   = business?.teamMembers.find(m => m.userId === session?.user?.id)?.role;
  const canReview = myRole === 'owner' || myRole === 'manager';

  const invalidate = () => qc.invalidateQueries({ queryKey: ['biz-expenses'] });

  const approveMut = useMutation({
    mutationFn: approveExpense,
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); invalidate(); },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });
  const rejectMut = useMutation({
    mutationFn: rejectExpense,
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); invalidate(); },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const totalAll      = expenses.reduce((s, e) => s + e.amount, 0);
  const totalApproved = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0);
  const pendingCount  = expenses.filter(e => e.status === 'pending').length;

  return (
    <View style={{ flex: 1, backgroundColor: '#060d18', paddingTop: insets.top }}>
      <SubmitModal
        visible={showSubmit}
        onClose={() => setShowSubmit(false)}
        onDone={invalidate}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#60a5fa" />}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 }}>
          <View>
            <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }}>BUSINESS</Text>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 2 }}>Expenses</Text>
          </View>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowSubmit(true); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 13, backgroundColor: 'rgba(96,165,250,0.15)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.3)' })}
          >
            <Plus size={16} color="#60a5fa" />
            <Text style={{ color: '#60a5fa', fontWeight: '700', fontSize: 13 }}>Add</Text>
          </Pressable>
        </View>

        {/* Summary cards */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 18 }}>
          <LinearGradient
            colors={['#180a0a', '#2d1010']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ flex: 1, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(248,113,113,0.18)' }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600', marginBottom: 4 }}>TOTAL</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>${totalAll.toFixed(2)}</Text>
            <Text style={{ color: '#4b5563', fontSize: 11, marginTop: 2 }}>{expenses.length} expense{expenses.length !== 1 ? 's' : ''}</Text>
          </LinearGradient>
          <LinearGradient
            colors={['#071a0e', '#0a2e17']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ flex: 1, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(34,197,94,0.18)' }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600', marginBottom: 4 }}>APPROVED</Text>
            <Text style={{ color: '#22c55e', fontSize: 22, fontWeight: '800' }}>${totalApproved.toFixed(2)}</Text>
            <Text style={{ color: '#4b5563', fontSize: 11, marginTop: 2 }}>
              {pendingCount > 0 ? `${pendingCount} pending review` : 'none pending'}
            </Text>
          </LinearGradient>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8, marginBottom: 18 }}
        >
          {STATUS_FILTERS.map(f => {
            const active = filter === f.value;
            return (
              <Pressable
                key={f.value}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFilter(f.value as ExpenseStatus | 'all'); }}
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: active ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: active ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.07)' })}
              >
                <Text style={{ color: active ? '#60a5fa' : '#4b5563', fontSize: 13, fontWeight: '700' }}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Expense list */}
        <View style={{ paddingHorizontal: 20 }}>
          {isLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 56 }}>
              <ActivityIndicator color="#60a5fa" size="large" />
            </View>
          ) : expenses.length === 0 ? (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, padding: 40, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
              {filter === 'pending'
                ? <><Clock size={32} color="#1f3a5f" /><Text style={{ color: '#374151', fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 4 }}>No pending expenses</Text><Text style={{ color: '#1f2937', fontSize: 12 }}>All caught up!</Text></>
                : <><Receipt size={32} color="#1f3a5f" /><Text style={{ color: '#374151', fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 4 }}>No expenses yet</Text><Text style={{ color: '#1f2937', fontSize: 12 }}>Tap Add to submit your first expense</Text></>
              }
            </View>
          ) : (
            expenses.map(expense => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                canReview={canReview}
                onApprove={id => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); approveMut.mutate(id); }}
                onReject={id => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); rejectMut.mutate(id); }}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
