import { useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Home, Eye, LogOut, RefreshCw, Users, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  getHousehold, getDashboard, getVisibility, getInviteCode, refreshInviteCode,
  setMyShareLevel, leaveHousehold, createHousehold,
  SHARE_LEVELS, type ShareLevel,
} from '@/lib/householdApi';
import { useSession } from '@/lib/auth/use-session';
import { R, useC } from '@/lib/design';
import { Txt, GlassCard, BubbleButton, ScreenBackground, EmptyState } from '@/components/ui';
import { t } from '@/lib/i18n/core';

/** Matches the business tabs, which format inline rather than via a helper. */
const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * The household.
 *
 * Structured so the visibility panel is the FIRST thing under the totals, not
 * a settings row. "Who can see what" being one tap from the dashboard is what
 * separates this from a tracking feature: a member who cannot easily check
 * what they are revealing is not really consenting to it.
 *
 * Everything below `full` renders as withheld rather than as zero. A member on
 * summary shows a total and an explicit "categories not shared" line, because
 * a blank space reads as "spent nothing" and would misrepresent them.
 */

const LEVEL_META: Record<ShareLevel, { labelKey: string; descKey: string }> = {
  summary: { labelKey: 'household.levelSummary', descKey: 'household.levelSummaryDesc' },
  categories: { labelKey: 'household.levelCategories', descKey: 'household.levelCategoriesDesc' },
  full: { labelKey: 'household.levelFull', descKey: 'household.levelFullDesc' },
};

export default function HouseholdScreen() {
  const C = useC();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [newName, setNewName] = useState('');

  const { data: household, isLoading } = useQuery({ queryKey: ['household'], queryFn: getHousehold });
  const hasHousehold = !!household?.household;

  const { data: dashboard } = useQuery({
    queryKey: ['household', 'dashboard'],
    queryFn: () => getDashboard(),
    enabled: hasHousehold,
  });
  const { data: visibility } = useQuery({
    queryKey: ['household', 'visibility'],
    queryFn: getVisibility,
    enabled: hasHousehold,
  });
  const { data: invite } = useQuery({
    queryKey: ['household', 'invite'],
    queryFn: getInviteCode,
    enabled: hasHousehold && household?.isOwner === true,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['household'] });

  const create = useMutation({
    mutationFn: () => createHousehold(newName.trim()),
    onSuccess: invalidate,
  });
  const changeLevel = useMutation({
    mutationFn: (level: ShareLevel) => setMyShareLevel(level),
    onSuccess: invalidate,
  });
  const refresh = useMutation({ mutationFn: refreshInviteCode, onSuccess: invalidate });
  const leave = useMutation({
    mutationFn: leaveHousehold,
    onSuccess: () => { invalidate(); router.back(); },
  });

  const myLevel =
    visibility?.members.find((m) => m.isYou)?.shareLevel ??
    household?.members?.find((m) => m.userId === session?.user?.id)?.shareLevel ??
    'summary';

  if (isLoading) {
    return (
      <ScreenBackground>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.p400} />
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color={C.text} />
          </Pressable>
          <Txt weight="bold" size={22} style={{ marginStart: 12 }}>
            {t('household.title')}
          </Txt>
        </View>

        {!hasHousehold ? (
          <View>
            <EmptyState
              icon={<Home size={38} color={C.textFaint} />}
              title={t('household.emptyTitle')}
              body={t('household.emptySubtitle')}
            />
            <GlassCard padding={16} radius={R.md} style={{ marginTop: 16 }}>
              <Txt weight="semibold" size={14}>{t('household.createTitle')}</Txt>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder={t('household.namePlaceholder')}
                placeholderTextColor={C.textDim}
                style={{
                  marginTop: 10, borderRadius: R.sm, paddingHorizontal: 14, paddingVertical: 12,
                  backgroundColor: C.glass, color: C.text, fontSize: 15,
                }}
              />
              <BubbleButton
                label={t('household.createCta')}
                onPress={() => { Haptics.selectionAsync(); create.mutate(); }}
                disabled={newName.trim().length === 0 || create.isPending}
                style={{ marginTop: 12 }}
              />
            </GlassCard>
            <Pressable
              onPress={() => router.push('/household-join')}
              style={{ marginTop: 14, alignItems: 'center' }}
            >
              <Txt size={14} color={C.p400} weight="semibold">{t('household.joinInstead')}</Txt>
            </Pressable>
          </View>
        ) : (
          <>
            {/* ── Combined totals ─────────────────────────────────────────── */}
            <GlassCard padding={18} radius={R.md}>
              <Txt size={13} color={C.textDim}>{household!.household!.name}</Txt>
              <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Txt size={12} color={C.textDim}>{t('household.totalIn')}</Txt>
                  <Txt weight="bold" size={20} style={{ marginTop: 2 }}>
                    {money(dashboard?.combined.totalIn ?? 0)}
                  </Txt>
                </View>
                <View style={{ flex: 1 }}>
                  <Txt size={12} color={C.textDim}>{t('household.totalOut')}</Txt>
                  <Txt weight="bold" size={20} style={{ marginTop: 2 }}>
                    {money(dashboard?.combined.totalOut ?? 0)}
                  </Txt>
                </View>
              </View>
            </GlassCard>

            {/* ── Who can see what: deliberately here, not in settings ────── */}
            <View style={{ marginTop: 18 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Eye size={16} color={C.p400} />
                <Txt weight="semibold" size={15} style={{ marginStart: 8 }}>
                  {t('household.visibilityTitle')}
                </Txt>
              </View>
              <Txt size={12} color={C.textDim} style={{ marginBottom: 10, lineHeight: 18 }}>
                {t('household.visibilityBlurb')}
              </Txt>

              {visibility?.members.map((m) => (
                <GlassCard key={m.userId} padding={14} radius={R.sm} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Txt weight="semibold" size={14}>
                        {m.isYou ? t('household.you', { name: m.name }) : m.name}
                      </Txt>
                      <Txt size={12} color={C.textDim} style={{ marginTop: 2 }}>
                        {t(LEVEL_META[m.shareLevel].labelKey)}
                      </Txt>
                    </View>
                    {m.sharedAccounts.length > 0 && (
                      <Txt size={11} color={C.p400}>
                        {t('household.sharedAccountCount', { count: m.sharedAccounts.length })}
                      </Txt>
                    )}
                  </View>
                </GlassCard>
              ))}
            </View>

            {/* ── My own dial ─────────────────────────────────────────────── */}
            <View style={{ marginTop: 18 }}>
              <Txt weight="semibold" size={15} style={{ marginBottom: 4 }}>
                {t('household.myVisibilityTitle')}
              </Txt>
              <Txt size={12} color={C.textDim} style={{ marginBottom: 10, lineHeight: 18 }}>
                {t('household.myVisibilityBlurb')}
              </Txt>
              {SHARE_LEVELS.map((level) => {
                const active = myLevel === level;
                return (
                  <Pressable
                    key={level}
                    onPress={() => { Haptics.selectionAsync(); changeLevel.mutate(level); }}
                    disabled={changeLevel.isPending}
                  >
                    <GlassCard
                      padding={14}
                      radius={R.sm}
                      style={{ marginBottom: 8 }}
                      border={active ? C.p500 : undefined}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                          <Txt weight="semibold" size={14}>{t(LEVEL_META[level].labelKey)}</Txt>
                          <Txt size={12} color={C.textDim} style={{ marginTop: 3, lineHeight: 17 }}>
                            {t(LEVEL_META[level].descKey)}
                          </Txt>
                        </View>
                        {active && <Check size={18} color={C.p400} />}
                      </View>
                    </GlassCard>
                  </Pressable>
                );
              })}
              <Txt size={11} color={C.textDim} style={{ marginTop: 2, lineHeight: 16 }}>
                {t('household.raiseNotice')}
              </Txt>
            </View>

            {/* ── Per-member contribution, at each member's own level ─────── */}
            <View style={{ marginTop: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Users size={16} color={C.p400} />
                <Txt weight="semibold" size={15} style={{ marginStart: 8 }}>
                  {t('household.contributionsTitle')}
                </Txt>
              </View>
              {dashboard?.members.map((m) => (
                <GlassCard key={m.userId} padding={14} radius={R.sm} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row' }}>
                    <Txt weight="semibold" size={14} style={{ flex: 1 }}>{m.name}</Txt>
                    <Txt weight="semibold" size={14}>{money(m.totalOut)}</Txt>
                  </View>
                  {m.byCategory ? (
                    <View style={{ marginTop: 8 }}>
                      {Object.entries(m.byCategory).map(([cat, amount]) => (
                        <View key={cat} style={{ flexDirection: 'row', marginTop: 3 }}>
                          <Txt size={12} color={C.textDim} style={{ flex: 1 }}>{cat}</Txt>
                          <Txt size={12} color={C.textDim}>{money(amount)}</Txt>
                        </View>
                      ))}
                    </View>
                  ) : (
                    /* Withheld, not zero. Saying so is the honest rendering. */
                    <Txt size={12} color={C.textDim} style={{ marginTop: 6, fontStyle: 'italic' }}>
                      {t('household.notShared')}
                    </Txt>
                  )}
                </GlassCard>
              ))}
            </View>

            {/* ── Invite ──────────────────────────────────────────────────── */}
            {household?.isOwner && invite && (
              <GlassCard padding={16} radius={R.md} style={{ marginTop: 18 }}>
                <Txt weight="semibold" size={14}>{t('household.inviteTitle')}</Txt>
                <Txt size={12} color={C.textDim} style={{ marginTop: 4, lineHeight: 18 }}>
                  {t('household.inviteBlurb')}
                </Txt>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                  <Txt weight="bold" size={24} style={{ flex: 1, letterSpacing: 4 }}>
                    {invite.code}
                  </Txt>
                  <Pressable
                    onPress={() => { Haptics.selectionAsync(); refresh.mutate(); }}
                    hitSlop={12}
                  >
                    <RefreshCw size={18} color={C.textDim} />
                  </Pressable>
                </View>
              </GlassCard>
            )}

            {/* ── Leave ───────────────────────────────────────────────────── */}
            {!household?.isOwner && (
              <Pressable
                onPress={() => { Haptics.selectionAsync(); leave.mutate(); }}
                disabled={leave.isPending}
                style={{ marginTop: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
              >
                <LogOut size={16} color="#f87171" />
                <Txt size={14} color="#f87171" weight="semibold" style={{ marginStart: 8 }}>
                  {t('household.leave')}
                </Txt>
              </Pressable>
            )}
            <Txt size={11} color={C.textDim} style={{ marginTop: 8, textAlign: 'center', lineHeight: 16 }}>
              {t('household.leaveNotice')}
            </Txt>
          </>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}
