import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Inbox, Mail } from '@/components/icons';

import { getEmailStatus, type EmailStatus } from '@/lib/emailSubscriptionApi';
import { S, useC } from '@/lib/design';
import { Card, IconTile, LinkRow } from '@/components/kit';
import { t } from '@/lib/i18n/core';

/**
 * Entry card for the "inbox inside Budget" subscription finder. Tapping it
 * opens the guided forwarding setup and detected-invoice list
 * (`/email-inbox`).
 *
 * Shared by the personal subscriptions screen and the business tools screen.
 * It used to be a tinted gradient panel with an accent-tinted border, and
 * then a card whose glyph tile was washed in the caller's hue; it is now the
 * same lifted card and feature row as every other entry point — a platinum
 * tile with an ink glyph — which is the point: both screens reach the same
 * feature through the same-looking door.
 */
export function EmailScanCard(_props: {
  /** @deprecated Ignored: one identity, so the tile no longer takes a hue. */
  accent?: string;
}) {
  const C = useC();
  const router = useRouter();

  const { data: status, isLoading } = useQuery<EmailStatus>({
    queryKey: ['email-status'],
    queryFn: getEmailStatus,
    retry: false,
  });

  const verified = !!status?.forwarding?.verified;
  const count = status?.inboxCount ?? 0;
  const subtitle = isLoading
    ? t('emailInbox.checking')
    : count > 0
      ? t('emailInbox.foundCount', { count })
      : verified
        ? t('emailInbox.connected')
        : t('emailInbox.autoDetect');

  return (
    <View style={{ paddingHorizontal: S.screen }}>
      <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
        <LinkRow
          pal={C}
          icon={
            <IconTile pal={C}>
              {count > 0 ? (
                <Inbox size={20} color={C.ink} strokeWidth={S.stroke} />
              ) : (
                <Mail size={20} color={C.ink} strokeWidth={S.stroke} />
              )}
            </IconTile>
          }
          title={t('emailInbox.findSubs')}
          body={subtitle}
          onPress={() => router.push('/email-inbox')}
          style={{ paddingVertical: 14 }}
        />
      </Card>
    </View>
  );
}
