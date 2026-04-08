import {
  View, Text, ScrollView, Pressable, Modal, TextInput,
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

const ROLE_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ size: number; color: string }> }> = {
  owner:    { label: 'Owner',    color: '#fbbf24', icon: Crown   },
  manager:  { label: 'Manager',  color: '#60a5fa', icon: Shield  },
  employee: { label: 'Employee', color: '#34d399', icon: User2   },
};

// ─── Invite Code Panel ────────────────────────────────────────────────────────

function InviteCodePanel({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['invite-code', businessId],
    queryFn: getInviteCode,
  });

  const refreshMut = useMutation({
    mutationFn: refreshInviteCode,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['invite-code'] });
    },
  });

  async function handleCopy() {
    if (!data?.code) return;
    await Clipboard.setStringAsync(data.code);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
      <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 }}>
        INVITE CODE
      </Text>
      <LinearGradient
        colors={['#091428', '#0e1f42']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 20, padding: 18, borderWidth: 1, borderColor: 'rgba(96,165,250,0.18)' }}
      >
        <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 10 }}>
          Share this code with teammates so they can join
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            {isLoading ? (
              <ActivityIndicator color="#60a5fa" size="small" />
            ) : (
              <Text style={{ color: '#60a5fa', fontSize: 24, fontWeight: '800', letterSpacing: 8, textAlign: 'center' }}>
                {data?.code ?? '------'}
              </Text>
            )}
          </View>
          <Pressable
            onPress={handleCopy}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, width: 48, height: 48, borderRadius: 14, backgroundColor: copied ? 'rgba(34,197,94,0.15)' : 'rgba(96,165,250,0.15)', borderWidth: 1.5, borderColor: copied ? 'rgba(34,197,94,0.3)' : 'rgba(96,165,250,0.3)', alignItems: 'center', justifyContent: 'center' })}
          >
            {copied ? <Check size={18} color="#22c55e" /> : <Copy size={18} color="#60a5fa" />}
          </Pressable>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); refreshMut.mutate(); }}
            disabled={refreshMut.isPending}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' })}
          >
            {refreshMut.isPending ? <ActivityIndicator color="#9ca3af" size="small" /> : <RefreshCw size={16} color="#4b5563" />}
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

// ─── Join Code Modal ──────────────────────────────────────────────────────────

function JoinModal({ visible, onClose, onJoined }: { visible: boolean; onClose: () => void; onJoined: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const joinMut = useMutation({
    mutationFn: () => {
      if (code.trim().length < 4) throw new Error('Enter a valid invite code');
      return joinBusiness(code.trim());
    },
    onSuccess: (data) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Joined!', `You've joined ${data.businessName}`);
      setCode(''); setErr('');
      onJoined();
      onClose();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message);
    },
  });

  function handleClose() { setCode(''); setErr(''); onClose(); }

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={handleClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#0d1828', borderTopLeftRadius: 32, borderTopRightRadius: 32, borderWidth: 1, borderColor: 'rgba(96,165,250,0.15)', padding: 24, paddingBottom: 48 }}>
        <View style={{ width: 40, height: 4, backgroundColor: '#1e3a5f', borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>Join a Business</Text>
          <Pressable onPress={handleClose} hitSlop={10}><X size={22} color="#4b5563" /></Pressable>
        </View>
        <Text style={{ color: '#4b5563', fontSize: 13, marginBottom: 16 }}>
          Enter the 6-character invite code your manager shared with you.
        </Text>
        {!!err && (
          <View style={{ backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' }}>
            <Text style={{ color: '#f87171', fontSize: 13, textAlign: 'center' }}>{err}</Text>
          </View>
        )}
        <TextInput
          value={code}
          onChangeText={t => { setCode(t.toUpperCase()); setErr(''); }}
          placeholder="ABC123"
          placeholderTextColor="#1f3a5f"
          autoCapitalize="characters"
          maxLength={6}
          style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16, color: '#60a5fa', fontSize: 28, fontWeight: '800', letterSpacing: 10, textAlign: 'center', borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)', marginBottom: 20 }}
          selectionColor="#60a5fa"
        />
        <Pressable onPress={() => joinMut.mutate()} disabled={joinMut.isPending} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          <LinearGradient
            colors={joinMut.isPending ? ['#1e3a5f', '#1e3a5f'] : ['#1d4ed8', '#3b82f6']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ borderRadius: 18, paddingVertical: 18, alignItems: 'center' }}
          >
            {joinMut.isPending
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Join Business</Text>
            }
          </LinearGradient>
        </Pressable>
      </View>
    </Modal>
  );
}

// ─── Member Row ───────────────────────────────────────────────────────────────

function MemberRow({
  member, isMe, isOwner, onRemove, onChangeRole,
}: {
  member: TeamMember;
  isMe: boolean;
  isOwner: boolean;
  onRemove: (id: string) => void;
  onChangeRole: (id: string, role: 'manager' | 'employee') => void;
}) {
  const [roleOpen, setRoleOpen] = useState(false);
  const meta = ROLE_META[member.role] ?? ROLE_META.employee;
  const RoleIcon = meta.icon;
  const initials = (member.user?.name ?? '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: `${meta.color}18`, borderWidth: 1, borderColor: `${meta.color}30`, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Text style={{ color: meta.color, fontWeight: '800', fontSize: 15 }}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: '#e5e7eb', fontSize: 15, fontWeight: '600' }}>{member.user?.name ?? 'Unknown'}</Text>
            {isMe && <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(96,165,250,0.15)' }}><Text style={{ color: '#60a5fa', fontSize: 10, fontWeight: '700' }}>YOU</Text></View>}
          </View>
          <Text style={{ color: '#4b5563', fontSize: 12, marginTop: 2 }}>{member.user?.email ?? ''}</Text>
        </View>
        {/* Role badge / selector */}
        {isOwner && member.role !== 'owner' ? (
          <Pressable
            onPress={() => setRoleOpen(v => !v)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: `${meta.color}12`, borderWidth: 1, borderColor: `${meta.color}25` })}
          >
            <RoleIcon size={11} color={meta.color} />
            <Text style={{ color: meta.color, fontSize: 11, fontWeight: '700' }}>{meta.label}</Text>
            <ChevronDown size={11} color={meta.color} />
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: `${meta.color}12` }}>
            <RoleIcon size={11} color={meta.color} />
            <Text style={{ color: meta.color, fontSize: 11, fontWeight: '700' }}>{meta.label}</Text>
          </View>
        )}
      </View>

      {/* Role dropdown */}
      {roleOpen && isOwner && member.role !== 'owner' && (
        <View style={{ marginTop: 8, backgroundColor: '#0a1422', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
          {(['manager', 'employee'] as const).map(r => {
            const rm = ROLE_META[r];
            const RI = rm.icon;
            return (
              <Pressable
                key={r}
                onPress={() => { setRoleOpen(false); onChangeRole(member.id, r); }}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)', backgroundColor: member.role === r ? `${rm.color}10` : 'transparent' })}
              >
                <RI size={14} color={rm.color} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: rm.color, fontSize: 13, fontWeight: '600' }}>{rm.label}</Text>
                  <Text style={{ color: '#4b5563', fontSize: 11 }}>{r === 'manager' ? 'Can approve/reject expenses' : 'Can submit expenses'}</Text>
                </View>
                {member.role === r && <Check size={14} color={rm.color} />}
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => { setRoleOpen(false); onRemove(member.id); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 10 })}
          >
            <X size={14} color="#ef4444" />
            <Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '600' }}>Remove from team</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function TeamScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [showJoin, setShowJoin] = useState(false);

  const { data: business, isLoading: bizLoading } = useQuery({
    queryKey: ['my-business'],
    queryFn: getBusiness,
  });

  const { data: members = [], isLoading: membersLoading, refetch, isRefetching } = useQuery({
    queryKey: ['biz-members'],
    queryFn: getMembers,
  });

  const myMembership  = members.find(m => m.userId === userId);
  const isOwner       = myMembership?.role === 'owner';
  const isInBusiness  = !!myMembership;

  const changeRoleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'manager' | 'employee' }) => updateMemberRole(id, role),
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); qc.invalidateQueries({ queryKey: ['biz-members'] }); },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  const removeMut = useMutation({
    mutationFn: removeMember,
    onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); qc.invalidateQueries({ queryKey: ['biz-members'] }); },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });

  function handleRemove(memberId: string) {
    Alert.alert('Remove member', 'Are you sure you want to remove this person from your team?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMut.mutate(memberId) },
    ]);
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['biz-members'] });
    qc.invalidateQueries({ queryKey: ['my-business'] });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#060d18', paddingTop: insets.top }}>
      <JoinModal
        visible={showJoin}
        onClose={() => setShowJoin(false)}
        onJoined={invalidate}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#60a5fa" />}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: '#60a5fa', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }}>BUSINESS</Text>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 2 }}>Team</Text>
          </View>
          {!isInBusiness && (
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowJoin(true); }}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 13, backgroundColor: 'rgba(96,165,250,0.15)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.3)' })}
            >
              <LogIn size={15} color="#60a5fa" />
              <Text style={{ color: '#60a5fa', fontWeight: '700', fontSize: 13 }}>Join</Text>
            </Pressable>
          )}
        </View>

        {/* Team summary card */}
        <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
          <LinearGradient
            colors={['#091428', '#0e1f42']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ borderRadius: 20, padding: 20, borderWidth: 1, borderColor: 'rgba(96,165,250,0.18)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View>
              <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 4 }}>Team members</Text>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 36 }}>{membersLoading ? '—' : members.length}</Text>
              <Text style={{ color: '#60a5fa', fontSize: 13, fontWeight: '600', marginTop: 2 }}>
                {business?.name ?? (bizLoading ? 'Loading...' : 'Not in a business yet')}
              </Text>
            </View>
            <View style={{ width: 56, height: 56, borderRadius: 20, backgroundColor: 'rgba(96,165,250,0.15)', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.25)', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={26} color="#60a5fa" />
            </View>
          </LinearGradient>
        </View>

        {/* Invite code — only for owners */}
        {isOwner && business && (
          <InviteCodePanel businessId={business.id} />
        )}

        {/* Join button for users not in a business */}
        {!isInBusiness && !bizLoading && (
          <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowJoin(true); }}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, backgroundColor: 'rgba(96,165,250,0.07)', borderRadius: 20, padding: 28, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.18)', borderStyle: 'dashed' })}
            >
              <UserPlus size={28} color="#1e3a5f" style={{ marginBottom: 10 }} />
              <Text style={{ color: '#1e3a5f', fontSize: 15, fontWeight: '700', marginBottom: 4 }}>Join a business</Text>
              <Text style={{ color: '#172c4a', fontSize: 12, textAlign: 'center' }}>Enter an invite code from your manager</Text>
            </Pressable>
          </View>
        )}

        {/* Members list */}
        {members.length > 0 && (
          <View style={{ paddingHorizontal: 20 }}>
            <Text style={{ color: '#4b5563', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 }}>
              MEMBERS ({members.length})
            </Text>
            {membersLoading ? (
              <ActivityIndicator color="#60a5fa" />
            ) : (
              members.map(member => (
                <MemberRow
                  key={member.id}
                  member={member}
                  isMe={member.userId === userId}
                  isOwner={isOwner}
                  onRemove={handleRemove}
                  onChangeRole={(id, role) => changeRoleMut.mutate({ id, role })}
                />
              ))
            )}
          </View>
        )}

      </ScrollView>
    </View>
  );
}
