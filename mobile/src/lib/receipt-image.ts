/**
 * Loading a receipt that lives on the server.
 *
 * Expense.imageUrl now holds a path — `/api/expenses/<id>/receipt` — not a
 * URL, so the backend can move without rewriting stored rows. It also needs
 * the session: the endpoint is scoped to the caller's business, and an <Image>
 * does not send cookies of its own accord the way a browser would.
 *
 * Rows written before this change still hold a `file://` path from the
 * submitter's phone. Those never worked for anyone else and cannot be
 * recovered — the bytes only ever existed on that device — so they are
 * reported as unavailable rather than rendered as a broken image.
 */
import { authClient } from './auth/auth-client';
import { isLegacyLocalReceipt } from './receipt-path';

const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

export interface ReceiptSource {
  uri: string;
  headers: Record<string, string>;
}

/**
 * An image source for a stored receipt, or null when there is nothing
 * loadable — no receipt, or one of the old device-local paths.
 */
export function receiptSource(imageUrl: string | null | undefined): ReceiptSource | null {
  if (!imageUrl || isLegacyLocalReceipt(imageUrl)) return null;
  return {
    uri: `${backendUrl}${imageUrl}`,
    // Same reason api.ts sets it by hand: expo/fetch and the image loader do
    // not share cookies from SecureStore, so without this the request is
    // anonymous and comes back 401.
    headers: { Cookie: authClient.getCookie() },
  };
}
