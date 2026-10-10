import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

export const authClient = createAuthClient({
  baseURL: process.env.EXPO_PUBLIC_BACKEND_URL! as string,
  fetchOptions: {
    onRequest: (ctx) => {
      // The backend's per-identifier rate limits and lockouts read the
      // identifier from a header or the query string — never from the request
      // body, which deadlocks under Bun (see backend/src/auth.ts). The client
      // sent neither, so every per-identifier limit was unreachable and only
      // the per-IP ones did anything. Surface the email explicitly.
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email === "string" && email) {
        const headers = new Headers(ctx.headers as HeadersInit | undefined);
        headers.set("x-rate-limit-identifier", email);
        return { ...ctx, headers };
      }
      return ctx;
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
