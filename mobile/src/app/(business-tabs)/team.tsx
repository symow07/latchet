import {
  View, ScrollView, Pressable, Modal, TextInput,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Users, UserPlus, Crown, Shield, User2, Copy, RefreshCw,
  LogIn, X, Check, ChevronDown,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/auth/use-session';
import {
  getBusiness, getMembers, getInviteCode, refreshInviteCode,
  joinBusiness, updateMemberRole, removeMember, type TeamMember,
} from '@/lib/businessApi';
import { B, R, glow } from '@/lib/design';
import { Txt, GlassCard, IconBubble, Pill, BizBackground, BubbleButton } from '@/components/ui';

const ROLE_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ size: number; color: string }> }> = {
  owner: { label: 'Owner', color: B.amber, icon: Crown },
  manager: { label: 'Manager', color: B.accent, icon: Shield },
  employee: { label: 'Employee', color: B.teal, icon: User2 },
};

function Label({ children }: { children: string }) {
  return <Txt weight="bold" size={11} color={B.textFaint} style={{ letterSpacing: 1.4, marginBottom: 10 }}>{children}</Txt>;
}

// ─── Invite Code Panel ───────────────────────────────────────────────────────────
function InviteCodePanel() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['invite-code'], queryFn: getInviteCode });
  const refreshMut = useMutation({ mutationFn: refreshInviteCode, onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); qc.invalidateQueries({ queryKey: ['invite-code'] }); } });

  async function handleCopy() {
    if (!data?.code) return;
    await Clipboard.setStringAsync(data.code);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
      <Label>INVITE CODE</Label>
      <GlassCard padding={18} radius={R.lg} tint={B.slate900} border={`${B.accent}2a`}>
        <Txt size={12} color={B.textFaint} style={{ marginBottom: 12 }}>Share this code with teammates so they can join</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, backgroundColor: B.glass, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: B.glassBorder }}>
            {isLoading ? (
              <ActivityIndicator color={B.accent} size="small" />
            ) : (
              <Txt weight="bold" size={24} color={B.accent} style={{ letterSpacing: 8, textAlign: 'center' }}>{data?.code ?? '------'}</Txt>
            )}
          </View>
          <Pressable onPress={handleCopy} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, width: 48, height: 48, borderRadius: 14, backgroundColor: copied ? `${B.teal}1f` : `${B.accent}1f`, borderWidth: 1.5, borderColor: copied ? `${B.teal}44` : `${B.accent}44`, alignItems: 'center', justifyContent: 'center' })}>
            {copied ? <Check size={18} color={B.teal} /> : <Copy size={18} color={B.accent} />}
          </Pressable>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); refreshMut.mutate(); }} disabled={refreshMut.isPending} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, width: 48, height: 48, borderRadius: 14, backgroundColor: B.glass, borderWidth: 1, borderColor: B.glassBorder, alignItems: 'center', justifyContent: 'center' })}>
            {refreshMut.isPending ? <ActivityIndicator color={B.textDim} size="small" /> : <RefreshCw size={16} color={B.textFaint} />}
          </Pressable>
        </View>
      </GlassCard>
    </View>
  );
}

// ─── Join Modal ──────────────────────────────────────────────────────────────────
function JoinModal({ visible, onClose, onJoined }: { visible: boolean; onClose: () => void; onJoined: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const joinMut = useMutation({
    mutationFn: () => { if (code.trim().length < 4) throw new Error('Enter a valid invite code'); return joinBusiness(code.trim()); },
    onSuccess: (data) => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); Alert.alert('Joined!', `You've joined ${data.businessName}`); setCode(''); setErr(''); onJoined(); onClose(); },
    onError: (e: Error) => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); setErr(e.message); },
  });

  function handleClose() { setCode(''); setErr(''); onClose(); }

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={handleClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: B.slate900, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, borderColor: `${B.accent}26`, padding: 22, paddingBottom: 44 }}>
        <View style={{ width: 40, height: 4, backgroundColor: B.slate700, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Txt weight="bold" size={20} color={B.text}>Join a Business</Txt>
          <Pressable onPress={handleClose} hitSlop={10}><X size={22} color={B.textFaint} /></Pressable>
        </View>
        <Txt size={13} color={B.textFaint} style={{ marginBottom: 16 }}>Enter the 6-character invite code your manager shared with you.</Txt>
        {!!err && (
          <GlassCard padding={12} radius={R.sm} tint={`${B.red}16`} border={`${B.red}33`} style={{ marginBottom: 14 }}>
            <Txt size={13} color={B.red} style={{ textAlign: 'center' }}>{err}</Txt>
          </GlassCard>
        )}
        <TextInput value={code} onChangeText={t => { setCode(t.toUpperCase()); setErr(''); }} placeholder="ABC123" placeholderTextColor={B.textFaint} autoCapitalize="characters" maxLength={6} style={{ backgroundColor: B.glass, borderRadius: R.md, paddingHorizontal: 16, paddingVertical: 16, color: B.accent, fontSize: 28, fontFamily: 'Quicksand_700Bold', letterSpacing: 10, textAlign: 'center', borderWidth: 1, borderColor: `${B.accent}33`, marginBottom: 20 }} selectionColor={B.accent} />
        <BubbleButton label={joinMut.isPending ? 'Joining…' : 'Join Business'} onPress={() => joinMut.mutate()} disabled={joinMut.isPending} radius={R.md} colors={[B.accentDeep, B.accent]} glowColor={B.accent} />
      </View>
    </Modal>
  );
}

// ─── Member Row ──────────────────────────────────────────────────────────────────
function MemberRow({ member, isMe, isOwner, onRemove, onChangeRole }: { member: TeamMember; isMe: boolean; isOwner: boolean; onRemove: (id: string) => void; onChangeRole: (id: string, role: 'manager' | 'employee') => void }) {
  const [roleOpen, setRoleOpen] = useState(false);
  const meta = ROLE_META[member.role] ?? ROLE_META.employee;
  const RoleIcon = meta.icon;
  const initials = (member.user?.name ?? '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <GlassCard padding={14} radius={R.md}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: `${meta.color}1f`, borderWidth: 1, borderColor: `${meta.color}40`, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Txt weight="bold" size={15} color={meta.color}>{initials}</Txt>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Txt weight="semibold" size={15} color={B.text}>{member.user?.name ?? 'Unknown'}</Txt>
            {isMe && <Pill label="YOU" color={B.accent} />}
          </View>
          <Txt size={12} color={B.textFaint} style={{ marginTop: 2 }}>{member.user?.email ?? ''}</Txt>
        </View>
        {isOwner && member.role !== 'owner' ? (
          <Pressable onPress={() => setRoleOpen(v => !v)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: `${meta.color}16`, borderWidth: 1, borderColor: `${meta.color}30` })}>
            <RoleIcon size={11} color={meta.color} />
            <Txt weight="bold" size={11} color={meta.color}>{meta.label}</Txt>
            <ChevronDown size={11} color={meta.color} />
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: `${meta.color}16` }}>
            <RoleIcon size={11} color={meta.color} />
            <Txt weight="bold" size={11} color={meta.color}>{meta.label}</Txt>
          </View>
        )}
      </View>

      {roleOpen && isOwner && member.role !== 'owner' && (
        <View style={{ marginTop: 10, backgroundColor: B.bgDeep, borderRadius: 12, borderWidth: 1, borderColor: B.glassBorder, overflow: 'hidden' }}>
          {(['manager', 'employee'] as const).map(r => {
            const rm = ROLE_META[r]; const RI = rm.icon;
            return (
              <Pressable key={r} onPress={() => { setRoleOpen(false); onChangeRole(member.id, r); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, gap: 10, backgroundColor: member.role === r ? `${rm.color}12` : 'transparent' })}>
                <RI size={14} color={rm.color} />
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold" size={13} color={rm.color}>{rm.label}</Txt>
                  <Txt size={11} color={B.textFaint}>{r === 'manager' ? 'Can approve/reject expenses' : 'Can submit expenses'}</Txt>
                </View>
                {member.role === r && <Check size={14} color={rm.color} />}
              </Pressable>
            );
          })}
          <Pressable onPress={() => { setRoleOpen(false); onRemove(member.id); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, gap: 10 })}>
            <X size={14} color={B.red} />
            <Txt weight="semibold" size={13} color={B.red}>Remove from team</Txt>
          </Pressable>
        </View>
      )}
    </GlassCard>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────────
export default function TeamScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [showJoin, setShowJoin] = useState(false);

  const { data: business, isLoading: bizLoading } = useQuery({ queryKey: ['my-business'], queryFn: getBusiness });
  const { data: members = [], isLoading: membersLoading, refetch, isRefetching } = useQuery({ queryKey: ['biz-members'], queryFn: getMembers });

  const myMembership = members.find(m => m.userId === userId);
  const isOwner = myMembership?.role === 'owner';
  const isInBusiness = !!myMembership;

  const changeRoleMut = useMutation({ mutationFn: ({ id, role }: { id: string; role: 'manager' | 'employee' }) => updateMemberRole(id, role), onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); qc.invalidateQueries({ queryKey: ['biz-members'] }); }, onError: (e: Error) => Alert.alert('Error', e.message) });
  const removeMut = useMutation({ mutationFn: removeMember, onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); qc.invalidateQueries({ queryKey: ['biz-members'] }); }, onError: (e: Error) => Alert.alert('Error', e.message) });

  function handleRemove(memberId: string) {
    Alert.alert('Remove member', 'Are you sure you want to remove this person from your team?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMut.mutate(memberId) },
    ]);
  }

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['biz-members'] }); qc.invalidateQueries({ queryKey: ['my-business'] }); };

  return (
    <BizBackground style={{ paddingTop: insets.top }}>
      <JoinModal visible={showJoin} onClose={() => setShowJoin(false)} onJoined={invalidate} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={B.accent} />}>
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Txt weight="bold" size={12} color={B.accent} style={{ letterSpacing: 1.6 }}>BUSINESS</Txt>
            <Txt weight="bold" size={25} color={B.text} style={{ marginTop: 2 }}>Team</Txt>
          </View>
          {!isInBusiness && (
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowJoin(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 13, backgroundColor: `${B.accent}22`, borderWidth: 1.5, borderColor: `${B.accent}44` })}>
              <LogIn size={15} color={B.accent} />
              <Txt weight="bold" size={13} color={B.accent}>Join</Txt>
            </Pressable>
          )}
        </View>

        {/* Team summary */}
        <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
          <LinearGradient colors={[B.slate800, '#16365f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: R.lg, padding: 20, borderWidth: 1, borderColor: `${B.accent}2a`, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, glow(B.accentDeep, 0.25, 18)]}>
            <View>
              <Txt size={13} color="rgba(255,255,255,0.5)" style={{ marginBottom: 4 }}>Team members</Txt>
              <Txt weight="bold" size={36} color="#fff">{membersLoading ? '—' : members.length}</Txt>
              <Txt weight="semibold" size={13} color={B.accentSoft} style={{ marginTop: 2 }}>{business?.name ?? (bizLoading ? 'Loading...' : 'Not in a business yet')}</Txt>
            </View>
            <View style={{ width: 56, height: 56, borderRadius: 20, backgroundColor: `${B.accent}26`, borderWidth: 1.5, borderColor: `${B.accent}44`, alignItems: 'center', justifyContent: 'center' }}>
              <Users size={26} color={B.accent} />
            </View>
          </LinearGradient>
        </View>

        {isOwner && business && <InviteCodePanel />}

        {!isInBusiness && !bizLoading && (
          <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowJoin(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, backgroundColor: `${B.accent}0e`, borderRadius: R.lg, padding: 28, alignItems: 'center', borderWidth: 1.5, borderColor: `${B.accent}2a`, borderStyle: 'dashed' })}>
              <UserPlus size={28} color={B.slate700} style={{ marginBottom: 10 }} />
              <Txt weight="bold" size={15} color={B.textDim} style={{ marginBottom: 4 }}>Join a business</Txt>
              <Txt size={12} color={B.textFaint} style={{ textAlign: 'center' }}>Enter an invite code from your manager</Txt>
            </Pressable>
          </View>
        )}

        {members.length > 0 && (
          <View style={{ paddingHorizontal: 20 }}>
            <Label>{`MEMBERS (${members.length})`}</Label>
            {membersLoading ? (
              <ActivityIndicator color={B.accent} />
            ) : (
              <View style={{ gap: 8 }}>
                {members.map(member => (
                  <MemberRow key={member.id} member={member} isMe={member.userId === userId} isOwner={isOwner} onRemove={handleRemove} onChangeRole={(id, role) => changeRoleMut.mutate({ id, role })} />
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </BizBackground>
  );
}
