import { env } from "../../env";
import type { EmailProvider, RawEmail } from "./types";

/**
 * Gmail implementation of EmailProvider using the Gmail REST API directly
 * (no googleapis SDK), mirroring the plain-fetch style of routes/plaid.ts.
 *
 * Scope required: https://www.googleapis.com/auth/gmail.readonly
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Gmail search query that surfaces receipt / billing / subscription emails from
// the last year. `category:purchases` catches most auto-classified receipts;
// the subject terms widen the net for renewals and invoices.
const SEARCH_QUERY =
  '(category:purchases OR subject:(receipt OR invoice OR subscription OR renewal OR "payment received" OR "your receipt")) newer_than:1y';

interface GmailHeader {
  name: string;
  value: string;
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Gmail token refresh failed (${res.status}): ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.access_token;
}

function header(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export class GmailProvider implements EmailProvider {
  async listSubscriptionMessages(refreshToken: string, limit = 40): Promise<RawEmail[]> {
    const accessToken = await getAccessToken(refreshToken);
    const authHeaders = { Authorization: `Bearer ${accessToken}` };

    // 1. List matching message ids.
    const listRes = await fetch(
      `${GMAIL_BASE}/messages?maxResults=${limit}&q=${encodeURIComponent(SEARCH_QUERY)}`,
      { headers: authHeaders }
    );
    const listJson = (await listRes.json()) as { messages?: { id: string }[] };
    if (!listRes.ok) {
      throw new Error(`Gmail list failed (${listRes.status}): ${JSON.stringify(listJson).slice(0, 200)}`);
    }
    const ids = (listJson.messages ?? []).map((m) => m.id);

    // 2. Fetch metadata (headers + snippet) for each. Run in parallel but cap
    //    concurrency implicitly via the bounded `limit`.
    const emails = await Promise.all(
      ids.map(async (id): Promise<RawEmail | null> => {
        try {
          const res = await fetch(
            `${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: authHeaders }
          );
          if (!res.ok) return null;
          const msg = (await res.json()) as {
            snippet?: string;
            payload?: { headers?: GmailHeader[] };
          };
          const headers = msg.payload?.headers ?? [];
          return {
            id,
            from: header(headers, "From"),
            subject: header(headers, "Subject"),
            date: header(headers, "Date"),
            snippet: msg.snippet ?? "",
          };
        } catch {
          return null;
        }
      })
    );

    return emails.filter((e): e is RawEmail => e !== null);
  }
}
