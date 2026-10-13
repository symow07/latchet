import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { AlertTriangle, Mail } from '@/components/icons';

import { EMAIL_CONNECTIONS_QUERY_KEY, getEmailConnections } from '@/lib/email-connections';
import { scanCardSummary } from '@/lib/email-screen';
import { S, useC } from '@/lib/design';
import { Card, IconTile, LinkRow } from '@/components/kit';

/**
 * The door to the email screen (`/email-inbox`), on the subscriptions screen
 * and on Business Tools: one line on where email stands — nothing connected
 * yet (connect Gmail or Outlook, or forward), an inbox that needs
 * reconnecting, the first year being read, or what has been found.
 *
 * It reads the same query as the email screen, so both say the same thing.
 * Offline or signed out, it still offers the way in.
 */
export function EmailScanCard(_props: {
  /** @deprecated Ignored: one identity, so the tile no longer takes a hue. */
  accent?: string;
}) {
  const C = useC();
  const router = useRouter();

  const { data } = useQuery({
    queryKey: EMAIL_CONNECTIONS_QUERY_KEY,
    queryFn: getEmailConnections,
    retry: false,
    staleTime: 60_000,
  });
  const summary = scanCardSummary(data, Date.now());

  return (
    <View style={{ paddingHorizontal: S.screen }}>
      <Card pal={C} padding={0} contentStyle={{ paddingHorizontal: S.card }}>
        <LinkRow
          pal={C}
          icon={
            <IconTile pal={C}>
              {summary.attention ? (
                <AlertTriangle size={20} color={C.warning} strokeWidth={S.stroke} />
              ) : (
                <Mail size={20} color={C.ink} strokeWidth={S.stroke} />
              )}
            </IconTile>
          }
          title={summary.title}
          body={summary.body}
          onPress={() => router.push('/email-inbox')}
          style={{ paddingVertical: 14 }}
        />
      </Card>
    </View>
  );
}
