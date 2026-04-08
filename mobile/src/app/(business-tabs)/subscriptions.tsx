import {
  View, Text, ScrollView, Pressable, Modal, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  RefreshControl,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring,
} from 'react-native-reanimated';
import {
  DollarSign, Plus, X, Check, ChevronLeft, ChevronRight,
  Briefcase, UserCheck, Clock, Trash2, ChevronDown,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useSession } from '@/lib/auth/use-session';
import {
  getPayroll, setSalary, deleteSalary, markPaid, markUnpaid,
  type SalaryRecord,
} from '@/lib/salaryApi';
import { type TeamMember } from '@/lib/businessApi';

// ─── Month helpers ─────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Add Salary Modal ──────────────────────────────────────────────────────────

function AddSalaryModal({
  visible,
  onClose,
  members,
  existingUserIds,
}: {
  visible: boolean;
  onClose: () => void;
  members: TeamMember[];
  existingUserIds: Set<string>;
}) {
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [amount, setAmount]   = useState('');
  const [title, setTitle]     = useState('');
  const [dropOpen, setDropOpen] = useState(false);
  const [err, setErr]         = useState('');

  const eligible = members.filter(m => m.role !== 'owner' && !existingUserIds.has(m.userId));
  const selected = members.find(m => m.userId === selectedUserId);

  const saveMut = useMutation({
    mutationFn: () => {
      if (!selectedUserId) throw new Error('Select a team member');
      const num = parseFloat(amount);
      if (isNaN(num) || num <= 0) throw new Error('Enter a valid monthly salary');
      return setSalary({ userId: selectedUserId, amount: num, title: title.trim() || null });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['payroll'] });
      setSelectedUserId(''); setAmount(''); setTitle(''); setErr('');
      onClose();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message);
    },
  });

  function handleClose() {
    setSelectedUserId(''); setAmount(''); setTitle(''); setErr(''); setDropOpen(false);
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
          paddingBottom: 48, maxHeight: '88%',
        }}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 24 }}
          >
            <View style={{ width: 40, height: 4, backgroundColor: '#1e3a5f', borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>Add Employee Salary</Text>
              <Pressable onPress={handleClose} hitSlop={10}><X size={22} color="#4b5563" /></Pressable>
            </View>

            {!!err && (
              <View style={{ backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' }}>
                <Text style={{ color: '#f87171', fontSize: 13, textAlign: 'center' }}>{err}</Text>
              </View>
            )}

            {/* Employee selector */}
            <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 }}>EMPLOYEE</Text>
            {eligible.length === 0 ? (
              <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                <Text style={{ color: '#4b5563', fontSize: 13, textAlign: 'center' }}>All team members already have salaries set</Text>
              </View>
            ) : (
              <>
                <Pressable
                  onPress={() => setDropOpen(v => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, borderWidth: 1, borderColor: dropOpen ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.08)', marginBottom: dropOpen ? 0 : 14 }}
                >
                  <View style={{ flex: 1 }}>
                    {selected ? (
                      <>
                        <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: '600' }}>{selected.user?.name}</Text>
                        <Text style={{ color: '#4b5563', fontSize: 11, marginTop: 2 }}>{selected.user?.email}</Text>
                      </>
                    ) : (
                      <Text style={{ color: '#1f3a5f', fontSize: 15 }}>Select a team member…</Text>
                    )}
                  </View>
                  <ChevronDown size={16} color="#4b5563" />
                </Pressable>
                {dropOpen && (
                  <View style={{ backgroundColor: '#0a1422', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 14 }}>
                    {eligible.map(m => {
                      const initials = (m.user?.name ?? '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                      return (
                        <Pressable
                          key={m.userId}
                          onPress={() => { setSelectedUserId(m.userId); setDropOpen(false); setErr(''); }}
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.7 : 1,
                            flexDirection: 'row', alignItems: 'center',
                            paddingHorizontal: 16, paddingVertical: 11,
                            borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
                            backgroundColor: selectedUserId === m.userId ? 'rgba(96,165,250,0.08)' : 'transparent',
                          })}
                        >
                          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(96,165,250,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                            <Text style={{ color: '#60a5fa', fontWeight: '700', fontSize: 13 }}>{initials}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: '#e5e7eb', fontSize: 14, fontWeight: '600' }}>{m.user?.name}</Text>
                            <Text style={{ color: '#4b5563', fontSize: 11 }}>{m.role} · {m.user?.email}</Text>
                          </View>
                          {selectedUserId === m.userId && <Check size={14} color="#60a5fa" />}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            {/* Job title */}
            <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 }}>JOB TITLE (OPTIONAL)</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Software Engineer"
              placeholderTextColor="#1f3a5f"
              style={{ color: '#fff', fontSize: 15, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 14 }}
              selectionColor="#60a5fa"
            />

            {/* Monthly salary */}
            <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 }}>MONTHLY SALARY</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)', marginBottom: 22 }}>
              <Text style={{ color: '#60a5fa', fontSize: 20, fontWeight: '700', marginRight: 8 }}>$</Text>
              <TextInput
                value={amount}
                onChangeText={v => { setAmount(v); setErr(''); }}
                placeholder="0.00"
                placeholderTextColor="#1f3a5f"
                keyboardType="decimal-pad"
                style={{ flex: 1, color: '#fff', fontSize: 24, fontWeight: '700' }}
                selectionColor="#60a5fa"
              />
            </View>

            <Pressable
              onPress={() => { if (eligible.length > 0) saveMut.mutate(); }}
              disabled={saveMut.isPending || eligible.length === 0}
              style={({ pressed }) => ({ opacity: (pressed || eligible.length === 0) ? 0.7 : 1 })}
            >
              <LinearGradient
                colors={saveMut.isPending ? ['#1e3a5f', '#1e3a5f'] : ['#1d4ed8', '#3b82f6']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ borderRadius: 18, paddingVertical: 18, alignItems: 'center' }}
              >
                {saveMut.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Add to Payroll</Text>
                }
              </LinearGradient>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Animated Pay Toggle ───────────────────────────────────────────────────────

function PayToggle({ paid, onToggle, disabled }: { paid: boolean; onToggle: () => void; disabled: boolean }) {
  const tx = useSharedValue(paid ? 22 : 2);

  const handleToggle = () => {
    if (disabled) return;
    const next = !paid;
    tx.value = withSpring(next ? 22 : 2, { damping: 18, stiffness: 200 });
    onToggle();
  };

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  return (
    <Pressable
      onPress={handleToggle}
      disabled={disabled}
      style={{
        width: 50, height: 28, borderRadius: 14,
        backgroundColor: paid ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)',
        borderWidth: 1.5,
        borderColor: paid ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.12)',
        justifyContent: 'center',
      }}
    >
      <Animated.View style={[{
        width: 22, height: 22, borderRadius: 11,
        backgroundColor: paid ? '#22c55e' : '#374151',
        shadowColor: paid ? '#22c55e' : '#000',
        shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
      }, thumbStyle]} />
    </Pressable>
  );
}

// ─── Employee Row ──────────────────────────────────────────────────────────────

function EmployeeRow({
  record, month, year, canEdit, onToggle, onDelete,
}: {
  record: SalaryRecord;
  month: number;
  year: number;
  canEdit: boolean;
  onToggle: (id: string, paid: boolean) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const paid     = record.payment.status === 'paid';
  const initials = (record.user.name ?? '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <View style={{
      backgroundColor: paid ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.04)',
      borderRadius: 20, padding: 16, marginBottom: 10,
      borderWidth: 1,
      borderColor: paid ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* Avatar */}
        <View style={{
          width: 46, height: 46, borderRadius: 15,
          backgroundColor: paid ? 'rgba(34,197,94,0.18)' : 'rgba(96,165,250,0.15)',
          borderWidth: 1.5,
          borderColor: paid ? 'rgba(34,197,94,0.3)' : 'rgba(96,165,250,0.2)',
          alignItems: 'center', justifyContent: 'center', marginRight: 12,
        }}>
          <Text style={{ color: paid ? '#22c55e' : '#60a5fa', fontWeight: '800', fontSize: 15 }}>{initials}</Text>
        </View>

        {/* Info */}
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: '700' }}>{record.user.name}</Text>
          {record.title ? (
            <Text style={{ color: '#4b5563', fontSize: 12, marginTop: 2 }}>{record.title}</Text>
          ) : (
            <Text style={{ color: '#1f3a5f', fontSize: 12, marginTop: 2 }}>{record.user.email}</Text>
          )}
        </View>

        {/* Amount + toggle */}
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
            ${record.amount.toLocaleString()}
          </Text>
          {canEdit ? (
            <PayToggle
              paid={paid}
              onToggle={() => onToggle(record.id, paid)}
              disabled={false}
            />
          ) : (
            <View style={{
              paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
              backgroundColor: paid ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.12)',
              borderWidth: 1,
              borderColor: paid ? 'rgba(34,197,94,0.3)' : 'rgba(251,191,36,0.3)',
            }}>
              <Text style={{ color: paid ? '#22c55e' : '#fbbf24', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {paid ? 'Paid' : 'Due'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Paid-at timestamp + delete */}
      {(paid || canEdit) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' }}>
          <View style={{ flex: 1 }}>
            {paid && record.payment.paidAt && (
              <Text style={{ color: '#374151', fontSize: 11 }}>
                Paid {new Date(record.payment.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </Text>
            )}
            {!paid && (
              <Text style={{ color: '#374151', fontSize: 11 }}>Pending payment for {MONTH_NAMES[month - 1]}</Text>
            )}
          </View>
          {canEdit && (
            <Pressable
              onPress={() => onDelete(record.id, record.user.name)}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Trash2 size={14} color="#374151" />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function PayrollScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['payroll', month, year],
    queryFn: () => getPayroll(month, year),
  });

  const { data: business } = useQuery({
    queryKey: ['my-business'],
    queryFn: () => import('@/lib/businessApi').then(m => m.getBusiness()),
  });

  const { data: members = [] } = useQuery({
    queryKey: ['biz-members'],
    queryFn: () => import('@/lib/businessApi').then(m => m.getMembers()),
  });

  useFocusEffect(useCallback(() => {
    qc.invalidateQueries({ queryKey: ['payroll'] });
  }, [qc]));

  const myRole   = business?.teamMembers.find(m => m.userId === session?.user?.id)?.role;
  const canEdit  = myRole === 'owner' || myRole === 'manager';

  const invalidate = () => qc.invalidateQueries({ queryKey: ['payroll'] });

  const toggleMut = useMutation({
    mutationFn: ({ id, paid }: { id: string; paid: boolean }) =>
      paid ? markUnpaid(id, month, year) : markPaid(id, month, year),
    onMutate: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); invalidate(); },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteSalary,
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); invalidate(); },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  function handleDelete(id: string, name: string) {
    Alert.alert(
      'Remove from payroll',
      `Remove ${name} from payroll? This will delete all payment history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => deleteMut.mutate(id) },
      ]
    );
  }

  function prevMonth() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  const salaries     = data?.salaries ?? [];
  const summary      = data?.summary;
  const paidCount    = salaries.filter(s => s.payment.status === 'paid').length;
  const unpaidCount  = salaries.length - paidCount;
  const paidPct      = salaries.length > 0 ? Math.round((paidCount / salaries.length) * 100) : 0;
  const existingIds  = new Set(salaries.map(s => s.userId));

  return (
    <View style={{ flex: 1, backgroundColor: '#060d18', paddingTop: insets.top }}>
      <AddSalaryModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        members={members}
        existingUserIds={existingIds}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 36 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#60a5fa" />}
      >
        {/* ── Header ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 }}>
          <View>
            <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }}>BUSINESS</Text>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 2 }}>Payroll</Text>
          </View>
          {canEdit && (
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowAdd(true); }}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 13, backgroundColor: 'rgba(96,165,250,0.15)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.3)' })}
            >
              <Plus size={16} color="#60a5fa" />
              <Text style={{ color: '#60a5fa', fontWeight: '700', fontSize: 13 }}>Add</Text>
            </Pressable>
          )}
        </View>

        {/* ── Month navigator ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginBottom: 18 }}>
          <Pressable onPress={prevMonth} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' })}>
            <ChevronLeft size={18} color="#9ca3af" />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{MONTH_NAMES[month - 1]} {year}</Text>
            {isCurrentMonth && (
              <View style={{ marginTop: 2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(96,165,250,0.12)' }}>
                <Text style={{ color: '#60a5fa', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }}>CURRENT MONTH</Text>
              </View>
            )}
          </View>
          <Pressable onPress={nextMonth} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' })}>
            <ChevronRight size={18} color="#9ca3af" />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 80 }}>
            <ActivityIndicator color="#60a5fa" size="large" />
          </View>
        ) : (
          <>
            {/* ── Summary banner ── */}
            <View style={{ marginHorizontal: 20, marginBottom: 16 }}>
              <LinearGradient
                colors={['#060e1f', '#0c1e3d']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 24, padding: 22, borderWidth: 1, borderColor: 'rgba(96,165,250,0.18)' }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
                  <View>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '600', letterSpacing: 1, marginBottom: 4 }}>TOTAL PAYROLL</Text>
                    <Text style={{ color: '#fff', fontSize: 38, fontWeight: '800', lineHeight: 42 }}>
                      ${(summary?.totalPayroll ?? 0).toLocaleString()}
                    </Text>
                    <Text style={{ color: '#4b5563', fontSize: 12, marginTop: 4 }}>
                      {salaries.length} employee{salaries.length !== 1 ? 's' : ''} · {MONTH_NAMES[month - 1]}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: 'rgba(96,165,250,0.12)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                      <DollarSign size={22} color="#60a5fa" />
                    </View>
                    <Text style={{ color: '#60a5fa', fontSize: 11, fontWeight: '700' }}>{paidPct}% paid</Text>
                  </View>
                </View>

                {/* Progress bar */}
                {salaries.length > 0 && (
                  <View style={{ marginBottom: 14 }}>
                    <View style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden' }}>
                      <View style={{ height: '100%', width: `${paidPct}%`, borderRadius: 4, backgroundColor: paidPct === 100 ? '#22c55e' : '#60a5fa' }} />
                    </View>
                  </View>
                )}

                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {[
                    { label: 'PAID',   value: `$${(summary?.paidTotal ?? 0).toLocaleString()}`,   color: '#22c55e', count: paidCount },
                    { label: 'DUE',    value: `$${(summary?.unpaidTotal ?? 0).toLocaleString()}`, color: '#fbbf24', count: unpaidCount },
                    { label: 'ANNUAL', value: `$${((summary?.totalPayroll ?? 0) * 12).toLocaleString()}`, color: '#a78bfa', count: null },
                  ].map(s => (
                    <View key={s.label} style={{ alignItems: 'center' }}>
                      <Text style={{ color: '#4b5563', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 }}>{s.label}</Text>
                      <Text style={{ color: s.color, fontSize: 16, fontWeight: '800' }}>{s.value}</Text>
                      {s.count !== null && (
                        <Text style={{ color: '#374151', fontSize: 10, marginTop: 2 }}>{s.count} employee{s.count !== 1 ? 's' : ''}</Text>
                      )}
                    </View>
                  ))}
                </View>
              </LinearGradient>
            </View>

            {/* ── Employee list ── */}
            {salaries.length === 0 ? (
              <View style={{ marginHorizontal: 20, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, padding: 40, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
                <Briefcase size={32} color="#1f3a5f" />
                <Text style={{ color: '#374151', fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 4 }}>No payroll set up</Text>
                <Text style={{ color: '#1f2937', fontSize: 12, textAlign: 'center' }}>
                  {canEdit ? 'Tap Add to set salaries for your team' : 'Payroll hasn\'t been configured yet'}
                </Text>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 20 }}>
                {/* Section headers */}
                {unpaidCount > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                    <Clock size={13} color="#fbbf24" />
                    <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>DUE ({unpaidCount})</Text>
                  </View>
                )}
                {salaries
                  .filter(s => s.payment.status === 'unpaid')
                  .map(s => (
                    <EmployeeRow
                      key={s.id} record={s} month={month} year={year}
                      canEdit={canEdit}
                      onToggle={(id, paid) => toggleMut.mutate({ id, paid })}
                      onDelete={handleDelete}
                    />
                  ))}

                {paidCount > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: unpaidCount > 0 ? 8 : 0, gap: 8 }}>
                    <UserCheck size={13} color="#22c55e" />
                    <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>PAID ({paidCount})</Text>
                  </View>
                )}
                {salaries
                  .filter(s => s.payment.status === 'paid')
                  .map(s => (
                    <EmployeeRow
                      key={s.id} record={s} month={month} year={year}
                      canEdit={canEdit}
                      onToggle={(id, paid) => toggleMut.mutate({ id, paid })}
                      onDelete={handleDelete}
                    />
                  ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
