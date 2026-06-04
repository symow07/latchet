/**
 * Minimal Expo Push API client (no SDK dependency). Sends notifications to a
 * batch of Expo push tokens via https://exp.host/--/api/v2/push/send.
 * Invalid tokens (DeviceNotRegistered) are pruned so dead devices stop
 * receiving sends.
 */
import { prisma } from "../prisma";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

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

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.warn(`[expo-push] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    }
    const json = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
    // Prune tokens Expo reports as unregistered.
    const receipts = json.data ?? [];
    const dead: string[] = [];
    receipts.forEach((r, i) => {
      if (r.status === "error" && r.details?.error === "DeviceNotRegistered") {
        dead.push(messages[i]!.to);
      }
    });
    if (dead.length) {
      await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    }
  } catch (e) {
    console.warn("[expo-push] send failed:", e instanceof Error ? e.message : e);
  }
}
