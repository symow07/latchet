/**
 * Minimal Expo Push API client (no SDK dependency). Sends notifications to a
 * batch of Expo push tokens via https://exp.host/--/api/v2/push/send.
 * Invalid tokens (DeviceNotRegistered) are pruned so dead devices stop
 * receiving sends.
 */
import { prisma } from "../prisma";
import { fetchWithTimeout } from "./fetch-timeout";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Expo's documented maximum messages per request. */
const EXPO_BATCH_SIZE = 100;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Send notifications to every push token registered for a user.
 * Best-effort: network/credential failures are logged, never thrown.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const tokens = await prisma.pushToken.findMany({ where: { userId } });
  if (tokens.length === 0) return;

  const messages: PushMessage[] = tokens.map((t) => ({
    to: t.token,
    title,
    body,
    data,
  }));

  const dead: string[] = [];

  // Expo documents a limit of 100 messages per request and rejects larger
  // payloads outright, so a user with more devices than that got no
  // notification at all rather than a partial one.
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
    try {
      const res = await fetchWithTimeout(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.warn(`[expo-push] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        continue;
      }
      const json = (await res.json()) as {
        data?: Array<{ status: string; details?: { error?: string } }>;
      };
      // Receipts come back positionally, so index within this batch.
      (json.data ?? []).forEach((r, idx) => {
        if (r.status === "error" && r.details?.error === "DeviceNotRegistered") {
          const message = batch[idx];
          if (message) dead.push(message.to);
        }
      });
    } catch (e) {
      // One failed batch must not stop the rest.
      console.warn("[expo-push] send failed:", e instanceof Error ? e.message : e);
    }
  }

  // Prune tokens Expo reports as unregistered.
  if (dead.length) {
    await prisma.pushToken
      .deleteMany({ where: { token: { in: dead } } })
      .catch(() => {});
  }
}
