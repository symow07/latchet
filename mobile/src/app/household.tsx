import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Home, RefreshCw } from '@/components/icons';

import {
  createHousehold,
  deleteHousehold,
  getDashboard,
  getHousehold,
  getInviteCode,
  getVisibility,
  leaveHousehold,
  refreshInviteCode,
  setAccountSharing,
  setMyShareLevel,
  SHARE_LEVELS,
  type ShareLevel,
} from '@/lib/householdApi';
import { getAccounts, type Account } from '@/lib/db';
import { useSession } from '@/lib/auth/use-session';
import { formatCurrency } from '@/lib/calculations';
// Categories are stored canonically in English and translated for display only —
// the stored value and the wire format never change. See category-meta.ts.
import { categoryLabel } from '@/lib/category-meta';
import { categoryIcon } from '@/components/category-icon';
import { S, useC } from '@/lib/design';
import { PressableScale } from '@/components/motion';
import {
  Card,
  ChoiceRow,
  CircleAction,
  Empty,
  Field,
  InfoRow,
  PrimaryButton,
  Row,
  Screen,
  SectionHeader,
  Stat,
  SubHeader,
  SwitchRow,
  Type,
} from '@/components/kit';
import { t } from '@/lib/i18n/core';

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
 *
 * Every amount here used to be `$${n.toFixed(2)}` from a local helper, on a
 * screen whose whole point is comparing what two people spent — so a household
 * budgeting in euros compared two figures labelled in dollars. It goes through
 * the shared formatter now.
 */

const LEVEL_META: Record<ShareLevel, { labelKey: string; descKey: string }> = {
  summary: { labelKey: 'household.levelSummary', descKey: 'household.levelSummaryDesc' },
  categories: { labelKey: 'household.levelCategories', descKey: 'household.levelCategoriesDesc' },
  full: { labelKey: 'household.levelFull', descKey: 'household.levelFullDesc' },
};

/** Rows on one card, hairline-separated. */
function Rows({
  pal,
  children,
}: {
  pal: ReturnType<typeof useC>;
  children: React.ReactNode;
}) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: S.screen }}>
      <Card pal={pal} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
        {items.map((child, i) => (
          <View
            key={i}
            style={i > 0 ? { borderTopWidth: 1, borderTopColor: pal.hairline } : undefined}
          >
            {child}
          </View>
        ))}
      </Card>
    </View>
  );
}

export default function HouseholdScreen() {
  const C = useC();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [newName, setNewName] = useState('');
  // Typed confirmation for deleting a household, matching the company flow.
  const [confirmName, setConfirmName] = useState('');

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

  // Local-first accounts, cross-referenced against the server's list of which
  // ones are shared. The sharing flag is server state and the accounts are
  // device state, so neither side alone can render this row.
  const { data: myAccounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: getAccounts,
    enabled: hasHousehold,
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
  const shareAccount = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      setAccountSharing(id, on ? household!.household!.id : null),
    onSuccess: invalidate,
  });
  const leave = useMutation({
    mutationFn: leaveHousehold,
    onSuccess: () => {
      invalidate();
      router.back();
    },
  });
  const destroy = useMutation({
    mutationFn: () => deleteHousehold(confirmName.trim()),
    onSuccess: () => {
      setConfirmName('');
      invalidate();
    },
  });

  const myLevel =
    (visibility?.members ?? []).find((m) => m.isYou)?.shareLevel ??
    (household?.members ?? []).find((m) => m.userId === session?.user?.id)?.shareLevel ??
    'summary';

  // Leaving cannot be undone from this screen — rejoining needs a fresh invite
  // code from the owner — so it asks first. It used to happen on one tap.
  const confirmLeave = () => {
    Alert.alert(t('household.leave'), t('household.leaveNotice'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('household.leave'), style: 'destructive', onPress: () => leave.mutate() },
    ]);
  };

  if (isLoading) {
    return (
      <Screen pal={C}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.accent} />
        </View>
      </Screen>
    );
  }

  const canDestroy =
    !!household?.household && confirmName.trim() === household.household.name.trim();

  return (
    <Screen pal={C}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SubHeader pal={C} title={t('household.title')} onBack={() => router.back()} />

        {!hasHousehold ? (
          <>
            <Empty
              pal={C}
              icon={<Home size={26} color={C.accent} strokeWidth={S.stroke} />}
              title={t('household.emptyTitle')}
              body={t('household.emptySubtitle')}
              style={{ marginTop: 56 }}
            />

            <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
              <Card pal={C}>
                <Type role="cardTitle" color={C.ink}>
                  {t('household.createTitle')}
                </Type>
                <Field
                  pal={C}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder={t('household.namePlaceholder')}
                  style={{ marginTop: 12 }}
                />
                <PrimaryButton
                  pal={C}
                  label={t('household.createCta')}
                  onPress={() => create.mutate()}
                  disabled={newName.trim().length === 0 || create.isPending}
                  style={{ marginTop: 16 }}
                />
              </Card>

              <PressableScale
                onPress={() => router.push('/household-join')}
                accessibilityRole="button"
                accessibilityLabel={t('household.joinInstead')}
                style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}
              >
                <Type role="cardTitle" color={C.accent}>
                  {t('household.joinInstead')}
                </Type>
              </PressableScale>
            </View>
          </>
        ) : (
          <>
            {/* ── Combined totals: the screen's one espresso anchor ───────── */}
            <View style={{ paddingHorizontal: S.screen, marginTop: 24 }}>
              <Card pal={C} anchor>
                <Type role="meta" color={C.onEspressoDim}>
                  {household!.household!.name}
                </Type>
                <View style={{ flexDirection: 'row', gap: 32, marginTop: 12 }}>
                  <Stat
                    pal={C}
                    label={t('household.totalIn')}
                    value={dashboard?.combined.totalIn ?? 0}
                    format={formatCurrency}
                    size={22}
                    tone={C.onEspresso}
                    labelTone={C.onEspressoDim}
                  />
                  <Stat
                    pal={C}
                    label={t('household.totalOut')}
                    value={dashboard?.combined.totalOut ?? 0}
                    format={formatCurrency}
                    size={22}
                    tone={C.onEspresso}
                    labelTone={C.onEspressoDim}
                  />
                </View>
              </Card>
            </View>

            {/* ── Who can see what: deliberately here, not in settings ────── */}
            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('household.visibilityTitle')} />
              <Type role="body" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginBottom: 12 }}>
                {t('household.visibilityBlurb')}
              </Type>
              <Rows pal={C}>
                {(visibility?.members ?? []).map((m) => (
                  <InfoRow
                    key={m.userId}
                    pal={C}
                    title={m.isYou ? t('household.you', { name: m.name }) : m.name}
                    meta={t(LEVEL_META[m.shareLevel].labelKey)}
                    trailing={
                      m.sharedAccounts.length > 0 ? (
                        <Type role="meta" color={C.inkDim}>
                          {t('household.sharedAccountCount', { count: m.sharedAccounts.length })}
                        </Type>
                      ) : null
                    }
                  />
                ))}
              </Rows>
            </View>

            {/* ── My own dial ─────────────────────────────────────────────── */}
            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('household.myVisibilityTitle')} />
              <View style={{ paddingHorizontal: S.screen, gap: 8 }}>
                <Type role="body" color={C.inkDim} style={{ marginBottom: 6 }}>
                  {t('household.myVisibilityBlurb')}
                </Type>
                {SHARE_LEVELS.map((level) => (
                  <ChoiceRow
                    key={level}
                    pal={C}
                    title={t(LEVEL_META[level].labelKey)}
                    body={t(LEVEL_META[level].descKey)}
                    selected={myLevel === level}
                    onPress={() => changeLevel.mutate(level)}
                  />
                ))}
                <Type role="meta" color={C.inkDim} style={{ marginTop: 6 }}>
                  {t('household.raiseNotice')}
                </Type>
              </View>
            </View>

            {/* ── Per-member contribution, at each member's own level ─────── */}
            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('household.contributionsTitle')} />
              <Rows pal={C}>
                {(dashboard?.members ?? []).map((m) => (
                  <InfoRow
                    key={m.userId}
                    pal={C}
                    title={m.name}
                    amount={m.totalOut}
                    format={formatCurrency}
                    footer={
                      m.byCategory ? (
                        <View style={{ marginTop: 8, gap: 4 }}>
                          {Object.entries(m.byCategory).map(([cat, amount]) => (
                            <View key={cat} style={{ flexDirection: 'row', gap: 12 }}>
                              <Type role="meta" color={C.inkDim} style={{ flex: 1 }}>
                                {categoryLabel(cat)}
                              </Type>
                              <Type role="meta" color={C.inkDim}>
                                {formatCurrency(amount)}
                              </Type>
                            </View>
                          ))}
                        </View>
                      ) : (
                        /* Withheld, not zero. Saying so is the honest rendering. */
                        <Type role="meta" color={C.inkDim} style={{ marginTop: 8 }}>
                          {t('household.notShared')}
                        </Type>
                      )
                    }
                  />
                ))}
              </Rows>
            </View>

            {/* ── Shared accounts, in full ────────────────────────────────
                An opt-in view rather than a new entity. A shared account is
                visible to the whole household regardless of its owner's
                shareLevel, which is the one place the dial does not apply —
                so the switch says exactly that before it is flipped. */}
            <View style={{ marginTop: S.section }}>
              <SectionHeader pal={C} title={t('household.sharedAccountsTitle')} />
              <Type role="body" color={C.inkDim} style={{ paddingHorizontal: S.screen, marginBottom: 12 }}>
                {t('household.sharedAccountsBlurb')}
              </Type>
              <Rows pal={C}>
                {myAccounts.map((account) => {
                  const isShared = (dashboard?.sharedAccounts ?? []).some((a) => a.id === account.id);
                  return (
                    <SwitchRow
                      key={account.id}
                      pal={C}
                      title={account.name}
                      body={isShared ? t('household.accountShared') : t('household.accountPrivate')}
                      value={isShared}
                      onValueChange={(on) => shareAccount.mutate({ id: account.id, on })}
                    />
                  );
                })}
              </Rows>

              {/* What the household actually sees from those accounts. Money
                  moving, so green in / red out with a sign, and the category
                  marked by its glyph. Amounts arrive unsigned; `type` says
                  which way they went. */}
              {(dashboard?.sharedTransactions?.length ?? 0) > 0 ? (
                <View style={{ marginTop: 16 }}>
                  <SectionHeader pal={C} title={t('household.sharedActivity')} />
                  <Rows pal={C}>
                    {(dashboard?.sharedTransactions ?? []).slice(0, 10).map((tx) => (
                      <Row
                        key={tx.id}
                        pal={C}
                        title={tx.note ?? categoryLabel(tx.category)}
                        meta={`${tx.dateISO} · ${categoryLabel(tx.category)}`}
                        amount={tx.type === 'Income' ? tx.amount : -tx.amount}
                        format={formatCurrency}
                        icon={categoryIcon(tx.category, tx.type)}
                      />
                    ))}
                  </Rows>
                </View>
              ) : null}
            </View>

            {/* ── Invite ──────────────────────────────────────────────────── */}
            {household?.isOwner && invite ? (
              <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
                <Card pal={C}>
                  <Type role="cardTitle" color={C.ink}>
                    {t('household.inviteTitle')}
                  </Type>
                  <Type role="body" color={C.inkDim} style={{ marginTop: 4 }}>
                    {t('household.inviteBlurb')}
                  </Type>
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}
                  >
                    <Type
                      role="section"
                      color={C.ink}
                      style={{ flex: 1, letterSpacing: 4, fontVariant: ['tabular-nums'] }}
                    >
                      {invite.code}
                    </Type>
                    <CircleAction
                      pal={C}
                      label={t('household.inviteTitle')}
                      size={36}
                      onPress={() => refresh.mutate()}
                    >
                      <RefreshCw size={17} color={C.ink} strokeWidth={S.stroke} />
                    </CircleAction>
                  </View>
                </Card>
              </View>
            ) : null}

            {/* ── Deleting, for the owner ─────────────────────────────────
                The owner cannot leave — there would be nobody to own the
                group — so the way out is deleting it. Typed confirmation,
                because this takes the shared view away from everyone at once. */}
            {household?.isOwner ? (
              <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
                <Card pal={C}>
                  <Type role="cardTitle" color={C.negative}>
                    {t('household.deleteTitle')}
                  </Type>
                  <Type role="body" color={C.inkDim} style={{ marginTop: 6 }}>
                    {t('household.deleteBody', { name: household!.household!.name })}
                  </Type>
                  <Field
                    pal={C}
                    value={confirmName}
                    onChangeText={setConfirmName}
                    placeholder={household!.household!.name}
                    autoCorrect={false}
                    style={{ marginTop: 12 }}
                  />
                  <PressableScale
                    onPress={canDestroy && !destroy.isPending ? () => destroy.mutate() : undefined}
                    haptic="light"
                    accessibilityRole="button"
                    accessibilityLabel={t('household.deleteCta')}
                    accessibilityState={{ disabled: !canDestroy }}
                    style={{
                      minHeight: 48,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: 12,
                      opacity: canDestroy ? 1 : 0.4,
                    }}
                  >
                    <Type role="cardTitle" color={C.negative}>
                      {t('household.deleteCta')}
                    </Type>
                  </PressableScale>
                </Card>
              </View>
            ) : null}

            {/* ── Leave ──
                Members only. An owner has no "leave" — there would be nobody
                left to own the group — so the note about leaving belongs
                inside this branch rather than under both. */}
            {!household?.isOwner ? (
              <View style={{ paddingHorizontal: S.screen, marginTop: S.section }}>
                <PressableScale
                  onPress={leave.isPending ? undefined : confirmLeave}
                  haptic="light"
                  accessibilityRole="button"
                  accessibilityLabel={t('household.leave')}
                  style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Type role="cardTitle" color={C.negative}>
                    {t('household.leave')}
                  </Type>
                </PressableScale>
                <Type role="meta" color={C.inkDim} style={{ marginTop: 6, textAlign: 'center' }}>
                  {t('household.leaveNotice')}
                </Type>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
