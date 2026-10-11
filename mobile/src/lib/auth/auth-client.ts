import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { getLocale } from "../i18n/core";

/**
 * Where the server sends someone back into the app from an emailed link. The
 * expo client rewrites only relative callbacks, and Better Auth would read a
 * relative one as a path on the backend, so both are absolute deep links into
 * the public landings (src/app/reset-password.tsx, verify-email.tsx). The
 * backend trusts the scheme (trustedOrigins realbudget://*\/*).
 */
export const RESET_PASSWORD_REDIRECT = "realbudget://reset-password";
export const VERIFY_EMAIL_CALLBACK = "realbudget://verify-email";

export const authClient = createAuthClient({
  baseURL: process.env.EXPO_PUBLIC_BACKEND_URL! as string,
  fetchOptions: {
    onRequest: (ctx) => {
      const headers = new Headers(ctx.headers as HeadersInit | undefined);
      // The reset and verification emails are written in the account's saved
      // language; an account that has none yet (the verification mail goes
      // out at sign-up) gets the language the app is showing, from this.
      headers.set("accept-language", getLocale());
      // The backend's per-identifier rate limits and lockouts read the
      // identifier from a header or the query string — never from the request
      // body, which deadlocks under Bun (see backend/src/auth.ts). The client
      // sent neither, so every per-identifier limit was unreachable and only
      // the per-IP ones did anything. Surface the email explicitly.
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email === "string" && email) {
        headers.set("x-rate-limit-identifier", email);
      }
      return { ...ctx, headers };
    },
  },
  plugins: [
    expoClient({
      scheme: "realbudget",
      storagePrefix: "realbudget",
      storage: SecureStore,
    }),
  ],
});
