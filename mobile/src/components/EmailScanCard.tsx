import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useC } from '@/lib/design';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Mail, ChevronRight, CheckCircle2, Inbox } from 'lucide-react-native';

import { getEmailStatus, type EmailStatus } from '@/lib/emailSubscriptionApi';

/**
 * Entry card for the "inbox inside Budget" subscription finder. Tapping it opens
 * the guided forwarding setup + detected-invoice list (`/email-inbox`). Reused by
 * both the purple personal subscriptions screen and the navy business tools
 * screen, so it styles with the passed `accent` and plain Plus Jakarta Sans text.
 */
export function EmailScanCard({ accent }: { accent?: string }) {
  const C = useC();
  const hue = accent ?? C.p500;
  const router = useRouter();

  const { data: status, isLoading } = useQuery<EmailStatus>({
    queryKey: ['email-status'],
    queryFn: getEmailStatus,
    retry: false,
  });

  const verified = !!status?.forwarding?.verified;
  const count = status?.inboxCount ?? 0;
  const subtitle = isLoading
    ? 'Checking…'
    : count > 0
    ? `${count} subscription${count === 1 ? '' : 's'} found in your email`
    : verified
    ? 'Connected — forwarded receipts appear here'
    : 'Auto-detect subscriptions from your receipts';

  return (
    <View className="mx-4 mb-4">
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push('/email-inbox');
        }}
      >
        <View className="rounded-2xl overflow-hidden" style={{ borderWidth: 1, borderColor: `${hue}33`, backgroundColor: C.glass }}>
          <LinearGradient
            colors={[`${hue}22`, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}
          >
            <View className="w-11 h-11 rounded-xl items-center justify-center" style={{ backgroundColor: `${hue}26` }}>
              {count > 0 ? <Inbox size={22} color={hue} /> : <Mail size={22} color={hue} />}
            </View>
            <View className="flex-1">
              <Text style={{ color: C.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 }}>
                Find subscriptions in your email
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                {verified && <CheckCircle2 size={12} color="#22c55e" />}
                <Text style={{ color: C.textDim, fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12, flex: 1 }} numberOfLines={1}>
                  {subtitle}
                </Text>
              </View>
            </View>
            {isLoading ? <ActivityIndicator size="small" color={hue} /> : <ChevronRight size={20} color={hue} />}
          </LinearGradient>
        </View>
      </Pressable>
    </View>
  );
}
