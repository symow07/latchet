import { ActivityIndicator, View } from 'react-native';
import { Building2, Check, ChevronRight, Mail, Upload } from '@/components/icons';
import { BadgePill, Card, IconTile, Touchable, Type, mirror } from '@/components/kit';
import { S, type Palette } from '@/lib/design';
import { t } from '@/lib/i18n/core';
import type { ConnectModel, ConnectOption, ConnectOptionId } from '@/lib/onboarding-flow';

/**
 * Onboarding's "Connect your data": one row per place Latchet can find
 * subscriptions in, as lib/onboarding-flow.ts connectModel offers them —
 * Gmail and Outlook only where the server has them, a statement import, and a
 * bank link only where Plaid serves the region (with the Pro mark for a free
 * user). A done row says so in words and with the tick, never by colour
 * alone; a row in progress shows a spinner and takes no second tap.
 *
 * Rows on one lifted card, like Settings' groups: no espresso here — the
 * screen's one anchor is its Continue button.
 */
export function ConnectSources({
  pal,
  model,
  busy,
  onConnect,
}: {
  pal: Palette;
  model: ConnectModel;
  /** The option whose connection is under way. */
  busy: ConnectOptionId | null;
  onConnect: (id: ConnectOptionId) => void;
}) {
  return (
    <Card pal={pal} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
      {model.options.map((option, i) => (
        <View
          key={option.id}
          style={i > 0 ? { borderTopWidth: 1, borderTopColor: pal.hairline } : undefined}
        >
          <SourceRow pal={pal} option={option} busy={busy === option.id} disabled={busy !== null} onPress={() => onConnect(option.id)} />
        </View>
      ))}
    </Card>
  );
}

function titleOf(id: ConnectOptionId): string {
  switch (id) {
    case 'gmail':
      return t('onboardingFlow.connect.gmail');
    case 'outlook':
      return t('onboardingFlow.connect.outlook');
    case 'statement':
      return t('onboardingFlow.connect.statement');
    case 'bank':
      return t('onboardingFlow.connect.bank');
  }
}

function bodyOf(id: ConnectOptionId): string {
  if (id === 'gmail' || id === 'outlook') return t('onboardingFlow.connect.emailBody');
  if (id === 'statement') return t('onboardingFlow.connect.statementBody');
  return t('onboardingFlow.connect.bankBody');
}

function doneLabel(id: ConnectOptionId): string {
  if (id === 'statement') return t('onboardingFlow.connect.imported');
  if (id === 'bank') return t('onboardingFlow.connect.linked');
  return t('onboardingFlow.connect.connected');
}

function SourceRow({
  pal,
  option,
  busy,
  disabled,
  onPress,
}: {
  pal: Palette;
  option: ConnectOption;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const Icon = option.id === 'statement' ? Upload : option.id === 'bank' ? Building2 : Mail;
  const title = titleOf(option.id);
  // A done row can be opened again (another statement, another inbox is the
  // screen's business, not this one's): it is shown, not offered.
  const pressable = !option.done && option.available && !disabled;
  const note = option.done
    ? null
    : option.capReached
      ? t('onboardingFlow.connect.capReached')
      : option.unverified
        ? t('onboardingFlow.connect.unverified')
        : null;

  return (
    <Touchable
      pal={pal}
      onPress={pressable ? onPress : undefined}
      accessibilityLabel={option.pro ? `${title}, ${t('subscription.proBadge')}` : title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingVertical: 12 }}
    >
      <IconTile pal={pal}>
        <Icon size={20} color={option.available ? pal.accent : pal.inkFaint} strokeWidth={S.stroke} />
      </IconTile>
      <View style={{ flex: 1 }}>
        <Type role="body" color={option.available ? pal.ink : pal.inkDim}>
          {title}
        </Type>
        <Type role="meta" color={pal.inkDim}>
          {bodyOf(option.id)}
        </Type>
        {note ? (
          <Type role="meta" color={option.capReached ? pal.warning : pal.inkDim} style={{ marginTop: 4 }}>
            {note}
          </Type>
        ) : null}
      </View>
      {option.done ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Check size={18} color={pal.positive} />
          <Type role="meta" color={pal.positive}>
            {doneLabel(option.id)}
          </Type>
        </View>
      ) : busy ? (
        <ActivityIndicator size="small" color={pal.inkDim} />
      ) : option.pro ? (
        <BadgePill pal={pal} label={t('subscription.proBadge')} />
      ) : option.available ? (
        <ChevronRight size={18} color={pal.inkFaint} strokeWidth={S.stroke} style={mirror} />
      ) : null}
    </Touchable>
  );
}
