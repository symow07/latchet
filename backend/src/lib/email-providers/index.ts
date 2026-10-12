/**
 * Inbox reading (I-EMAIL-API): Gmail and Outlook over OAuth, forwarding as
 * the backup. This module wires the pieces from the environment; each piece
 * takes its configuration and HTTP as arguments, so tests run them against a
 * fake provider.
 */

import { env } from "../../env";
import { decryptSecret, encryptSecret } from "../crypto";
import { cappedAi } from "./ai-cap";
import { emailConfigFrom, type EmailConfig } from "./config";
import { gmailProvider, GOOGLE_MANUAL_REVOKE_URL, revokeGoogleToken } from "./gmail";
import { providerHttp, type ProviderHttp } from "./http";
import { MICROSOFT_MANUAL_REVOKE_URL, outlookProvider } from "./outlook";
import type { SyncDeps } from "./sync";
import type { ProviderSet, RevokeResult, TokenCipher } from "./types";

export * from "./types";
export { emailConfigFrom, redirectUriFor, type EmailConfig } from "./config";
export { GOOGLE_MANUAL_REVOKE_URL } from "./gmail";
export { MICROSOFT_MANUAL_REVOKE_URL } from "./outlook";

/** The providers this configuration can use; an unconfigured one is null. */
export function buildProviders(config: EmailConfig, http: ProviderHttp): ProviderSet {
  return {
    gmail: config.google ? gmailProvider(config.google, http) : null,
    outlook: config.microsoft ? outlookProvider(config.microsoft, http) : null,
  };
}

/** lib/crypto under the process's keys (v2 when TOKEN_ENCRYPTION_KEY is set). */
export const processCipher: TokenCipher = { encrypt: encryptSecret, decrypt: decryptSecret };

export function manualRevokeUrlFor(provider: string): string {
  return provider === "outlook" ? MICROSOFT_MANUAL_REVOKE_URL : GOOGLE_MANUAL_REVOKE_URL;
}

/**
 * Give a connection's grant back to its provider, before its token is
 * deleted. Google: revoked through its endpoint (no client credentials
 * needed). Microsoft has no such call for personal accounts: the user is
 * pointed at the page where they remove it. Forwarding grants nothing.
 * Never throws: a failure is reported with the page to do it by hand.
 */
export async function revokeConnection(
  conn: { provider: string; refreshTokenEnc: string | null },
  deps: { http: ProviderHttp; cipher: TokenCipher }
): Promise<RevokeResult> {
  if (conn.provider === "outlook") return { revoked: false, manualRevokeUrl: MICROSOFT_MANUAL_REVOKE_URL };
  if (conn.provider !== "gmail" || !conn.refreshTokenEnc) return { revoked: true };
  try {
    return await revokeGoogleToken(deps.http, deps.cipher.decrypt(conn.refreshTokenEnc));
  } catch {
    return { revoked: false, manualRevokeUrl: GOOGLE_MANUAL_REVOKE_URL };
  }
}

export interface EmailServices {
  config: EmailConfig;
  http: ProviderHttp;
  providers: ProviderSet;
  cipher: TokenCipher;
  sync: SyncDeps;
}

/** Everything built from this process's environment. */
export function emailServicesFromEnv(): EmailServices {
  const config = emailConfigFrom(env);
  const http = providerHttp(config.providerBaseOverride);
  const providers = buildProviders(config, http);
  const cipher = processCipher;
  return {
    config,
    http,
    providers,
    cipher,
    sync: { providers, cipher, aiFor: (userId) => cappedAi(userId, { apiKey: config.openAiKey }) },
  };
}
