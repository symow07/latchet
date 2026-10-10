import { useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  Check,
  ChevronDown,
  Copy,
  Crown,
  RefreshCw,
  Shield,
  User2,
  UserPlus,
} from '@/components/icons';
import { useSession } from '@/lib/auth/use-session';
import {
  getBusiness,
  getInviteCode,
  getMembers,
  joinBusiness,
  refreshInviteCode,
  removeMember,
  updateMemberRole,
  type GroupMember,
} from '@/lib/businessApi';
import { R, S, useB, type BizPalette } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  BalanceCard,
  Card,
  CircleAction,
  Empty,
  Field,
  FormError,
  PrimaryButton,
  Screen,
  SectionHeader,
  Sheet,
  SubHeader,
  Type,
} from '@/components/kit';
import { t } from '@/lib/i18n/core';

type Role = 'owner' | 'manager' | 'employee';

/** Icon per role. The label comes from `roles.*`, which is where the three
 *  hardcoded English words used to live — inside a `ROLE_META` table that
 *  also assigned each role an off-system colour (amber, blue, teal). */
const ROLE_ICON: Record<Role, React.ComponentType<{ size: number; color: string; strokeWidth?: number }>> = {
  owner: Crown,
  manager: Shield,
  employee: User2,
};

const roleLabel = (role: string) =>
  t(`roles.${role in ROLE_ICON ? role : 'employee'}`);

// ─── Invite code ─────────────────────────────────────────────────────────────

function InviteCodePanel({ pal }: { pal: BizPalette }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['invite-code'], queryFn: getInviteCode });
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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View style={{ marginTop: S.section }}>
      <SectionHeader pal={pal} title={t('businessTeam.inviteCode')} />
      <View style={{ paddingHorizontal: S.screen }}>
        <Card pal={pal}>
          <Type role="body" color={pal.inkDim}>
            {t('businessTeam.shareCode')}
          </Type>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <View
              style={{
                flex: 1,
                minHeight: 52,
                justifyContent: 'center',
                borderRadius: R.sm,
                backgroundColor: pal.groundSunk,
              }}
            >
              {isLoading ? (
                <ActivityIndicator color={pal.accent} size="small" />
              ) : (
                <Type
                  role="section"
                  color={pal.ink}
                  style={{ letterSpacing: 6, textAlign: 'center', fontVariant: ['tabular-nums'] }}
                >
                  {data?.code ?? '------'}
                </Type>
              )}
            </View>
            <CircleAction
              pal={pal}
              size={44}
              label={t('businessTeam.inviteCode')}
              onPress={handleCopy}
            >
              {copied ? (
                <Check size={18} color={pal.accent} strokeWidth={2.4} />
              ) : (
                <Copy size={18} color={pal.ink} strokeWidth={S.stroke} />
              )}
            </CircleAction>
            <CircleAction
              pal={pal}
              size={44}
              label={t('businessTeam.inviteCode')}
              onPress={refreshMut.isPending ? undefined : () => refreshMut.mutate()}
            >
              {refreshMut.isPending ? (
                <ActivityIndicator color={pal.inkDim} size="small" />
              ) : (
                <RefreshCw size={17} color={pal.ink} strokeWidth={S.stroke} />
              )}
            </CircleAction>
          </View>
        </Card>
      </View>
    </View>
  );
}

// ─── Join sheet ──────────────────────────────────────────────────────────────

function JoinSheet({
  pal,
  visible,
  onClose,
  onJoined,
}: {
  pal: BizPalette;
  visible: boolean;
  onClose: () => void;
  onJoined: () => void;
}) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const joinMut = useMutation({
    mutationFn: () => {
      if (code.trim().length < 4) throw new Error(t('businessTeam.errCode'));
      return joinBusiness(code.trim());
    },
    onSuccess: (data) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t('businessTeam.joinedTitle'), t('businessTeam.joinedBody', { name: data.businessName }));
      close();
      onJoined();
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErr(e.message);
    },
  });

  function close() {
    setCode('');
    setErr('');
    onClose();
  }

  return (
    <Sheet pal={pal} visible={visible} onClose={close} title={t('businessTeam.joinBusiness')}>
      <View style={{ paddingHorizontal: S.card }}>
        <Type role="body" color={pal.inkDim}>
          {t('businessTeam.enterCodeLong')}
        </Type>
        <Field
          pal={pal}
          value={code}
          onChangeText={(v) => {
            setCode(v.toUpperCase());
            setErr('');
          }}
          placeholder="ABC123"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          style={{ marginTop: 16 }}
        />
        <FormError pal={pal} message={err} />
        <PrimaryButton
          pal={pal}
          label={joinMut.isPending ? t('businessTeam.joining') : t('businessTeam.joinButton')}
          onPress={() => joinMut.mutate()}
          disabled={joinMut.isPending}
          style={{ marginTop: 16 }}
        />
      </View>
    </Sheet>
  );
}

// ─── Member row (§6.19) ──────────────────────────────────────────────────────

function MemberRow({
  pal,
  member,
  isMe,
  isOwner,
  onRemove,
  onChangeRole,
}: {
  pal: BizPalette;
  member: GroupMember;
  isMe: boolean;
  isOwner: boolean;
  onRemove: (id: string) => void;
  onChangeRole: (id: string, role: 'manager' | 'employee') => void;
}) {
  const [roleOpen, setRoleOpen] = useState(false);
  const RoleIcon = ROLE_ICON[(member.role as Role) in ROLE_ICON ? (member.role as Role) : 'employee'];
  const initials = (member.user?.name ?? '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const canEdit = isOwner && member.role !== 'owner';

  return (
    <View style={{ paddingVertical: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: pal.groundSunk,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Type role="cardTitle" color={pal.inkDim}>
            {initials}
          </Type>
        </View>

        <View style={{ flex: 1 }}>
          <Type role="cardTitle" color={pal.ink} numberOfLines={1}>
            {isMe
              ? `${member.user?.name ?? t('businessTeam.unknownMember')} · ${t('businessTeam.you')}`
              : (member.user?.name ?? t('businessTeam.unknownMember'))}
          </Type>
          {/* §6.19: role in inkDim. It was a coloured pill in one of three
              hues, which asked the reader to learn a colour code to find out
              who could approve an expense. */}
          <Type role="meta" color={pal.inkDim} numberOfLines={1}>
            {member.user?.email ? `${roleLabel(member.role)} · ${member.user.email}` : roleLabel(member.role)}
          </Type>
        </View>

        {canEdit ? (
          <PressableScale
            onPress={() => setRoleOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={roleLabel(member.role)}
            hitSlop={8}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              minHeight: 34,
              paddingHorizontal: 12,
              borderRadius: R.pill,
              backgroundColor: pal.groundSunk,
            }}
          >
            <RoleIcon size={13} color={pal.inkDim} strokeWidth={S.stroke} />
            <ChevronDown size={13} color={pal.inkDim} strokeWidth={S.stroke} />
          </PressableScale>
        ) : (
          <RoleIcon size={16} color={pal.inkFaint} strokeWidth={S.stroke} />
        )}
      </View>

      {roleOpen && canEdit ? (
        <View
          style={{
            marginTop: 12,
            borderRadius: R.sm,
            backgroundColor: pal.groundSunk,
            overflow: 'hidden',
          }}
        >
          {(['manager', 'employee'] as const).map((r) => {
            const RI = ROLE_ICON[r];
            return (
              <PressableScale
                key={r}
                onPress={() => {
                  setRoleOpen(false);
                  onChangeRole(member.id, r);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: member.role === r }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 56,
                  paddingHorizontal: 14,
                }}
              >
                <RI size={17} color={pal.inkDim} strokeWidth={S.stroke} />
                <View style={{ flex: 1 }}>
                  <Type role="cardTitle" color={pal.ink}>
                    {roleLabel(r)}
                  </Type>
                  <Type role="meta" color={pal.inkDim}>
                    {r === 'manager' ? t('businessTeam.canApprove') : t('businessTeam.canSubmit')}
                  </Type>
                </View>
                {member.role === r ? (
                  <Check size={16} color={pal.accent} strokeWidth={2.4} />
                ) : null}
              </PressableScale>
            );
          })}
          <PressableScale
            onPress={() => {
              setRoleOpen(false);
              onRemove(member.id);
            }}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={t('businessTeam.remove')}
            style={{
              minHeight: 52,
              justifyContent: 'center',
              paddingHorizontal: 14,
              borderTopWidth: 1,
              borderTopColor: pal.hairline,
            }}
          >
            <Type role="cardTitle" color={pal.negative}>
              {t('businessTeam.remove')}
            </Type>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

/**
 * The team — DESIGN-PROMPT.md board §35.
 *
 * The hero was a mint gradient slab carrying a glow, and its caption was
 * `rgba(255,255,255,0.5)`. In dark mode the "one dark object" inverts to a
 * *bone* card, so that caption was white text on a bone surface — the label
 * telling you what the big number counts, invisible.
 *
 * Roles were the other problem: `ROLE_META` held three hardcoded English
 * words and three colours from no palette (`#f59e0b`, `#3b82f6`, `#14b8a6`),
 * so a French user saw "Manager" in a blue pill they had to decode. §6.19
 * asks for a member row to be an avatar, a name, and the role in `inkDim` —
 * which is what it is now, in the reader's own language.
 */
export default function TeamScreen() {
  const B = useB();
  const qc = useQueryClient();
  const router = useRouter();
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

  const myMembership = members.find((m) => m.userId === userId);
  const isOwner = myMembership?.role === 'owner';
  const isInBusiness = !!myMembership;

  const changeRoleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'manager' | 'employee' }) =>
      updateMemberRole(id, role),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['biz-members'] });
    },
    onError: (e: Error) => Alert.alert(t('common.error'), e.message),
  });
  const removeMut = useMutation({
    mutationFn: removeMember,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      qc.invalidateQueries({ queryKey: ['biz-members'] });
    },
    onError: (e: Error) => Alert.alert(t('common.error'), e.message),
  });

  function handleRemove(memberId: string) {
    Alert.alert(t('dialogs.removeMember'), t('dialogs.removeMemberBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('dialogs.remove'), style: 'destructive', onPress: () => removeMut.mutate(memberId) },
    ]);
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['biz-members'] });
    qc.invalidateQueries({ queryKey: ['my-business'] });
  };

  return (
    <Screen pal={B}>
      <JoinSheet pal={B} visible={showJoin} onClose={() => setShowJoin(false)} onJoined={invalidate} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 90 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={B.accent} />
        }
      >
        {/* Team was a tab until it moved into Settings, and a tab needs no way
            back. As a pushed screen it did — and shipped without one, which
            left the only route out of it a swipe people had no reason to
            guess at. */}
        <SubHeader
          pal={B}
          title={t('businessTeam.title')}
          onBack={() => router.back()}
          action={
            !isInBusiness ? (
              <CircleAction pal={B} label={t('businessTeam.join')} onPress={() => setShowJoin(true)}>
                <UserPlus size={19} color={B.ink} strokeWidth={S.stroke} />
              </CircleAction>
            ) : undefined
          }
        />

        <BalanceCard
          pal={B}
          label={t('businessTeam.members')}
          amount={members.length}
          format={(n) => String(Math.round(n))}
          caption={
            business?.name ?? (bizLoading ? t('businessTeam.loading') : t('businessTeam.noBusiness'))
          }
          style={{ paddingHorizontal: S.screen, marginTop: 24 }}
        />

        {isOwner && business ? <InviteCodePanel pal={B} /> : null}

        {!isInBusiness && !bizLoading ? (
          <Empty
            pal={B}
            icon={<UserPlus size={26} color={B.accent} strokeWidth={S.stroke} />}
            title={t('businessTeam.joinBusiness')}
            body={t('businessTeam.enterCode')}
            actionLabel={t('businessTeam.joinButton')}
            onAction={() => setShowJoin(true)}
            style={{ marginTop: S.section }}
          />
        ) : null}

        {members.length > 0 ? (
          <View style={{ marginTop: S.section }}>
            <SectionHeader
              pal={B}
              title={t('businessTeam.memberCount', { count: members.length })}
            />
            <View style={{ paddingHorizontal: S.screen }}>
              {membersLoading ? (
                <ActivityIndicator color={B.accent} />
              ) : (
                <Card pal={B} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
                  {members.map((member, i) => (
                    <View
                      key={member.id}
                      style={i > 0 ? { borderTopWidth: 1, borderTopColor: B.hairline } : undefined}
                    >
                      <MemberRow
                        pal={B}
                        member={member}
                        isMe={member.userId === userId}
                        isOwner={isOwner}
                        onRemove={handleRemove}
                        onChangeRole={(id, role) => changeRoleMut.mutate({ id, role })}
                      />
                    </View>
                  ))}
                </Card>
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
