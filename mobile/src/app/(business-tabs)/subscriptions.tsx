import type { StyleProp, ViewStyle } from 'react-native';
import {
  View, ScrollView, Pressable, Modal, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  RefreshControl,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
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
import { type GroupMember } from '@/lib/businessApi';
import { roleOf } from '@/lib/group-members';
import { R, glow, useB } from '@/lib/design';
import { Txt, GlassCard, IconBubble, Pill, BizBackground, BubbleButton } from '@/components/ui';
import { t } from '@/lib/i18n/core';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function FieldLabel({ children }: { children: string }) {
  const B = useB();
  return <Txt weight="bold" size={11} color={B.textFaint} style={{ letterSpacing: 1.2, marginBottom: 8 }}>{children}</Txt>;
}

// ─── Add Salary Modal ──────────────────────────────────────────────────────────────
function AddSalaryModal({ visible, onClose, members, existingUserIds }: { visible: boolean; onClose: () => void; members: GroupMember[]; existingUserIds: Set<string> }) {
  const B = useB();
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [dropOpen, setDropOpen] = useState(false);
  const [err, setErr] = useState('');

  const eligible = members.filter(m => m.role !== 'owner' && !existingUserIds.has(m.userId));
  const selected = members.find(m => m.userId === selectedUserId);

  const saveMut = useMutation({
    mutationFn: () => {
      if (!selectedUserId) throw new Error('Select a team member');
      const num = parseFloat(amount);
      if (isNaN(num) || num <= 0) throw new Error('Enter a valid monthly salary');
      return setSalary({ userId: selectedUserId, amount: num, title: title.trim() || null });
    },
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); qc.invalidateQueries({ queryKey: ['payroll'] }); setSelectedUserId(''); setAmount(''); setTitle(''); setErr(''); onClose(); },
    onError: (e: Error) => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); setErr(e.message); },
  });

  function handleClose() { setSelectedUserId(''); setAmount(''); setTitle(''); setErr(''); setDropOpen(false); onClose(); }

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={handleClose} />
        <View style={{ backgroundColor: B.slate900, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, borderColor: `${B.accent}26`, paddingBottom: 44, maxHeight: '88%' }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22 }}>
            <View style={{ width: 40, height: 4, backgroundColor: B.slate700, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <Txt weight="bold" size={20} color={B.text}>{t('businessPayroll.addSalary')}</Txt>
              <Pressable onPress={handleClose} hitSlop={10}><X size={22} color={B.textFaint} /></Pressable>
            </View>

            {!!err && (
              <GlassCard padding={12} radius={R.sm} tint={`${B.red}16`} border={`${B.red}33`} style={{ marginBottom: 14 }}>
                <Txt size={13} color={B.red} style={{ textAlign: 'center' }}>{err}</Txt>
              </GlassCard>
            )}

            <FieldLabel>{t('businessPayroll.employee')}</FieldLabel>
            {eligible.length === 0 ? (
              <GlassCard padding={14} radius={R.sm} style={{ marginBottom: 14 }}>
                <Txt size={13} color={B.textFaint} style={{ textAlign: 'center' }}>{t('businessPayroll.allHaveSalaries')}</Txt>
              </GlassCard>
            ) : (
              <>
                <Pressable onPress={() => setDropOpen(v => !v)}>
                  <GlassCard padding={0} radius={R.md} border={dropOpen ? `${B.accent}55` : B.glassBorder} style={{ marginBottom: dropOpen ? 0 : 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 }}>
                      <View style={{ flex: 1 }}>
                        {selected ? (
                          <>
                            <Txt weight="semibold" size={15} color={B.text}>{selected.user?.name}</Txt>
                            <Txt size={11} color={B.textFaint} style={{ marginTop: 2 }}>{selected.user?.email}</Txt>
                          </>
                        ) : <Txt size={15} color={B.textFaint}>{t('businessPayroll.selectMember')}</Txt>}
                      </View>
                      <ChevronDown size={16} color={B.textFaint} />
                    </View>
                  </GlassCard>
                </Pressable>
                {dropOpen && (
                  <GlassCard padding={0} radius={R.md} tint={B.bgDeep} style={{ marginBottom: 14, overflow: 'hidden' }}>
                    {eligible.map(m => {
                      const initials = (m.user?.name ?? '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                      return (
                        <Pressable key={m.userId} onPress={() => { setSelectedUserId(m.userId); setDropOpen(false); setErr(''); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, backgroundColor: selectedUserId === m.userId ? `${B.accent}12` : 'transparent' })}>
                          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: `${B.accent}1f`, alignItems: 'center', justifyContent: 'center', marginEnd: 12 }}>
                            <Txt weight="bold" size={13} color={B.accent}>{initials}</Txt>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Txt weight="semibold" size={14} color={B.text}>{m.user?.name}</Txt>
                            <Txt size={11} color={B.textFaint}>{m.role} · {m.user?.email}</Txt>
                          </View>
                          {selectedUserId === m.userId && <Check size={14} color={B.accent} />}
                        </Pressable>
                      );
                    })}
                  </GlassCard>
                )}
              </>
            )}

            <FieldLabel>{t('businessPayroll.jobTitle')}</FieldLabel>
            <TextInput value={title} onChangeText={setTitle} placeholder={t('fields.rolePlaceholder')} placeholderTextColor={B.textFaint} style={{ color: B.text, fontSize: 15, fontFamily: 'PlusJakartaSans_500Medium', backgroundColor: B.glass, borderRadius: R.md, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: B.glassBorder, marginBottom: 14 }} selectionColor={B.accent} />

            <FieldLabel>{t('businessPayroll.monthlySalary')}</FieldLabel>
            <GlassCard padding={0} radius={R.md} border={`${B.accent}33`} style={{ marginBottom: 22 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
                <Txt weight="bold" size={20} color={B.accent} style={{ marginEnd: 8 }}>$</Txt>
                <TextInput value={amount} onChangeText={v => { setAmount(v); setErr(''); }} placeholder="0.00" placeholderTextColor={B.textFaint} keyboardType="decimal-pad" style={{ flex: 1, color: B.text, fontSize: 24, fontFamily: 'PlusJakartaSans_700Bold', padding: 0 }} selectionColor={B.accent} />
              </View>
            </GlassCard>

            <BubbleButton label={saveMut.isPending ? t('businessPayroll.adding') : t('businessPayroll.addToPayroll')} onPress={() => { if (eligible.length > 0) saveMut.mutate(); }} disabled={saveMut.isPending || eligible.length === 0} radius={R.md} colors={[B.accentDeep, B.accent]} glowColor={B.accent} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Pay Toggle ──────────────────────────────────────────────────────────────────
function PayToggle({ paid, onToggle, disabled }: { paid: boolean; onToggle: () => void; disabled: boolean }) {
  const B = useB();
  const tx = useSharedValue(paid ? 22 : 2);
  const handleToggle = () => { if (disabled) return; const next = !paid; tx.value = withSpring(next ? 22 : 2, { damping: 18, stiffness: 200 }); onToggle(); };
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  return (
    <Pressable onPress={handleToggle} disabled={disabled} style={{ width: 50, height: 28, borderRadius: 14, backgroundColor: paid ? `${B.teal}2a` : 'rgba(255,255,255,0.08)', borderWidth: 1.5, borderColor: paid ? `${B.teal}55` : 'rgba(255,255,255,0.12)', justifyContent: 'center' }}>
      <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: paid ? B.teal : '#3a4660' }, thumbStyle]} />
    </Pressable>
  );
}

// ─── Employee Row ────────────────────────────────────────────────────────────────
function EmployeeRow({ record, month, canEdit, onToggle, onDelete }: { record: SalaryRecord; month: number; year: number; canEdit: boolean; onToggle: (id: string, paid: boolean) => void; onDelete: (id: string, name: string) => void }) {
  const B = useB();
  const paid = record.payment.status === 'paid';
  const initials = (record.user.name ?? '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <GlassCard padding={16} radius={R.lg} tint={paid ? `${B.teal}0a` : B.glass} border={paid ? `${B.teal}26` : B.glassBorder}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: paid ? `${B.teal}1f` : `${B.accent}1f`, borderWidth: 1.5, borderColor: paid ? `${B.teal}40` : `${B.accent}33`, alignItems: 'center', justifyContent: 'center', marginEnd: 12 }}>
          <Txt weight="bold" size={15} color={paid ? B.teal : B.accent}>{initials}</Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={15} color={B.text}>{record.user.name}</Txt>
          <Txt size={12} color={B.textFaint} style={{ marginTop: 2 }}>{record.title || record.user.email}</Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <Txt weight="bold" size={16} color={B.text}>${record.amount.toLocaleString()}</Txt>
          {canEdit ? (
            <PayToggle paid={paid} onToggle={() => onToggle(record.id, paid)} disabled={false} />
          ) : (
            <Pill label={paid ? t('businessPayroll.paidPill') : t('businessPayroll.duePill')} color={paid ? B.teal : B.amber} />
          )}
        </View>
      </View>

      {(paid || canEdit) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: B.glassBorder }}>
          <View style={{ flex: 1 }}>
            {paid && record.payment.paidAt && <Txt size={11} color={B.textFaint}>Paid {new Date(record.payment.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Txt>}
            {!paid && <Txt size={11} color={B.textFaint}>{t('businessPayroll.pendingFor', { month: MONTH_NAMES[month - 1] })}</Txt>}
          </View>
          {canEdit && (
            <Pressable onPress={() => onDelete(record.id, record.user.name)} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Trash2 size={14} color={B.textFaint} />
            </Pressable>
          )}
        </View>
      )}
    </GlassCard>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────────
/**
 * Also rendered inside the Money tab, which supplies the background, the
 * heading and the segmented control. `embedded` drops this screen's own
 * chrome so the two do not stack — the action button stays, because it acts
 * on this view specifically.
 */
/** BizBackground normally; a bare View when the Money tab already drew one. */
function Wrapper({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const embedded = !!(style && typeof style === 'object' && 'flex' in (style as object));
  return embedded
    ? <View style={style}>{children}</View>
    : <BizBackground style={style}>{children}</BizBackground>;
}

export default function PayrollScreen({ embedded }: { embedded?: boolean } = {}) {
  const B = useB();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({ queryKey: ['payroll', month, year], queryFn: () => getPayroll(month, year) });
  const { data: business } = useQuery({ queryKey: ['my-business'], queryFn: () => import('@/lib/businessApi').then(m => m.getBusiness()) });
  const { data: members = [] } = useQuery({ queryKey: ['biz-members'], queryFn: () => import('@/lib/businessApi').then(m => m.getMembers()) });

  useFocusEffect(useCallback(() => { qc.invalidateQueries({ queryKey: ['payroll'] }); }, [qc]));

  const myRole = roleOf(business, session?.user?.id);
  const canEdit = myRole === 'owner' || myRole === 'manager';
  const invalidate = () => qc.invalidateQueries({ queryKey: ['payroll'] });

  const toggleMut = useMutation({
    mutationFn: ({ id, paid }: { id: string; paid: boolean }) => paid ? markUnpaid(id, month, year) : markPaid(id, month, year),
    onMutate: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); invalidate(); },
    onError: (e: Error) => Alert.alert(t('common.error'), e.message),
  });
  const deleteMut = useMutation({ mutationFn: deleteSalary, onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); invalidate(); }, onError: (e: Error) => Alert.alert(t('common.error'), e.message) });

  function handleDelete(id: string, name: string) {
    Alert.alert(t('dialogs.removePayroll'), t('dialogs.removePayrollBody', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('dialogs.remove'), style: 'destructive', onPress: () => deleteMut.mutate(id) },
    ]);
  }

  function prevMonth() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); }
  function nextMonth() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); }
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  const salaries = data?.salaries ?? [];
  const summary = data?.summary;
  const paidCount = salaries.filter(s => s.payment.status === 'paid').length;
  const unpaidCount = salaries.length - paidCount;
  const paidPct = salaries.length > 0 ? Math.round((paidCount / salaries.length) * 100) : 0;
  const existingIds = new Set(salaries.map(s => s.userId));

  return (
    <Wrapper style={embedded ? { flex: 1 } : { paddingTop: insets.top }}>
      <AddSalaryModal visible={showAdd} onClose={() => setShowAdd(false)} members={members} existingUserIds={existingIds} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={B.accent} />}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: embedded ? 0 : 16, paddingBottom: embedded ? 4 : 14 }}>
          {embedded ? <View /> : (
            <View>
              <Txt weight="bold" size={12} color={B.accent} style={{ letterSpacing: 1.6 }}>{t('business.label')}</Txt>
              <Txt weight="bold" size={25} color={B.text} style={{ marginTop: 2 }}>{t('businessPayroll.title')}</Txt>
            </View>
          )}
          {canEdit && (
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowAdd(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 13, backgroundColor: `${B.accent}22`, borderWidth: 1.5, borderColor: `${B.accent}44` })}>
              <Plus size={16} color={B.accent} />
              <Txt weight="bold" size={13} color={B.accent}>{t('businessPayroll.addButton')}</Txt>
            </Pressable>
          )}
        </View>

        {/* Month nav */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginBottom: 18 }}>
          <Pressable onPress={prevMonth} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, width: 36, height: 36, borderRadius: 11, backgroundColor: B.glass, borderWidth: 1, borderColor: B.glassBorder, alignItems: 'center', justifyContent: 'center' })}>
            <ChevronLeft size={18} color={B.textDim} />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Txt weight="bold" size={17} color={B.text}>{MONTH_NAMES[month - 1]} {year}</Txt>
            {isCurrentMonth && <View style={{ marginTop: 3 }}><Pill label={t('businessPayroll.currentMonth')} color={B.accent} /></View>}
          </View>
          <Pressable onPress={nextMonth} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, width: 36, height: 36, borderRadius: 11, backgroundColor: B.glass, borderWidth: 1, borderColor: B.glassBorder, alignItems: 'center', justifyContent: 'center' })}>
            <ChevronRight size={18} color={B.textDim} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 80 }}><ActivityIndicator color={B.accent} size="large" /></View>
        ) : (
          <>
            {/* Summary banner */}
            <View style={{ marginHorizontal: 20, marginBottom: 16 }}>
              <LinearGradient colors={[B.heroFrom, '#102a4a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: R.lg, padding: 22, borderWidth: 1, borderColor: `${B.accent}2a` }, glow(B.accentDeep, 0.25, 20, B.glowScale)]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
                  <View>
                    <Txt weight="semibold" size={12} color="rgba(255,255,255,0.4)" style={{ letterSpacing: 1, marginBottom: 4 }}>{t('businessPayroll.total')}</Txt>
                    <Txt weight="bold" size={38} color="#fff" style={{ lineHeight: 42 }}>${(summary?.totalPayroll ?? 0).toLocaleString()}</Txt>
                    <Txt size={12} color={B.textFaint} style={{ marginTop: 4 }}>{salaries.length} employee{salaries.length !== 1 ? 's' : ''} · {MONTH_NAMES[month - 1]}</Txt>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: `${B.accent}1f`, borderWidth: 1.5, borderColor: `${B.accent}33`, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                      <DollarSign size={22} color={B.accent} />
                    </View>
                    <Txt weight="bold" size={11} color={B.accent}>{paidPct}% paid</Txt>
                  </View>
                </View>

                {salaries.length > 0 && (
                  <View style={{ marginBottom: 14, height: 7, backgroundColor: B.glassStrong, borderRadius: 4, overflow: 'hidden' }}>
                    <View style={{ height: '100%', width: `${paidPct}%`, borderRadius: 4, backgroundColor: paidPct === 100 ? B.teal : B.accent }} />
                  </View>
                )}

                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {[
                    { label: 'PAID', value: `$${(summary?.paidTotal ?? 0).toLocaleString()}`, color: B.teal, count: paidCount },
                    { label: 'DUE', value: `$${(summary?.unpaidTotal ?? 0).toLocaleString()}`, color: B.amber, count: unpaidCount },
                    { label: 'ANNUAL', value: `$${((summary?.totalPayroll ?? 0) * 12).toLocaleString()}`, color: '#a78bfa', count: null as number | null },
                  ].map(s => (
                    <View key={s.label} style={{ alignItems: 'center' }}>
                      <Txt weight="bold" size={10} color={B.textFaint} style={{ letterSpacing: 0.8, marginBottom: 4 }}>{s.label}</Txt>
                      <Txt weight="bold" size={16} color={s.color}>{s.value}</Txt>
                      {s.count !== null && <Txt size={10} color={B.textFaint} style={{ marginTop: 2 }}>{s.count} employee{s.count !== 1 ? 's' : ''}</Txt>}
                    </View>
                  ))}
                </View>
              </LinearGradient>
            </View>

            {/* List */}
            {salaries.length === 0 ? (
              <View style={{ marginHorizontal: 20 }}>
                <GlassCard padding={40} radius={R.lg} style={{ alignItems: 'center' }}>
                  <Briefcase size={32} color={B.slate700} />
                  <Txt weight="semibold" size={14} color={B.textDim} style={{ marginTop: 12, marginBottom: 4 }}>{t('businessPayroll.none')}</Txt>
                  <Txt size={12} color={B.textFaint} style={{ textAlign: 'center' }}>{canEdit ? t('businessPayroll.tapAdd') : t('businessPayroll.notConfigured')}</Txt>
                </GlassCard>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 20, gap: 10 }}>
                {unpaidCount > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Clock size={13} color={B.amber} />
                    <Txt weight="bold" size={11} color={B.amber} style={{ letterSpacing: 1 }}>{t('businessPayroll.dueCount', { count: unpaidCount })}</Txt>
                  </View>
                )}
                {salaries.filter(s => s.payment.status === 'unpaid').map(s => (
                  <EmployeeRow key={s.id} record={s} month={month} year={year} canEdit={canEdit} onToggle={(id, paid) => toggleMut.mutate({ id, paid })} onDelete={handleDelete} />
                ))}

                {paidCount > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: unpaidCount > 0 ? 6 : 0 }}>
                    <UserCheck size={13} color={B.teal} />
                    <Txt weight="bold" size={11} color={B.teal} style={{ letterSpacing: 1 }}>{t('businessPayroll.paidCount', { count: paidCount })}</Txt>
                  </View>
                )}
                {salaries.filter(s => s.payment.status === 'paid').map(s => (
                  <EmployeeRow key={s.id} record={s} month={month} year={year} canEdit={canEdit} onToggle={(id, paid) => toggleMut.mutate({ id, paid })} onDelete={handleDelete} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Wrapper>
  );
}
