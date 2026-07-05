# Leaving the Vibecode platform — what changed & how to run standalone

This project was originally built on the Vibecode platform. It has now been
**fully decoupled** — no `@vibecodeapp/*` packages, no `vibecode.*` domains, no
platform-injected env vars. It's a plain Expo app + Bun/Hono backend you can run
and deploy anywhere. This file documents what changed and what you now provide
yourself.

## What was removed / replaced

| Was (Vibecode) | Now |
|---|---|
| App named **"vibecode"** (`app.json`) | **"Budget"**, slug `budget`, scheme `realbudget://`, bundle ID `com.realbudget.app` |
| `@vibecodeapp/sdk/metro` bundler wrapper | Standard Expo Metro + `react-native-svg-transformer` (`metro.config.js`) |
| `@vibecodeapp/proxy` (backend fetch proxy) | Direct calls to OpenAI/Plaid/etc. with **your own** API keys |
| `smtp.vibecodeapp.com` OTP sender | `lib/email-otp.ts` → **Resend**, or your own webhook, or dev-console fallback |
| `@vibecodeapp/backend-sdk`, `@vibecodeapp/cloud-studio` | Removed; `bun run studio` now uses `prisma studio` |
| `*.vibecode.run` / `*.vibecodeapp.com` trusted origins & CORS | Env-driven `TRUSTED_ORIGINS` / `CORS_ORIGINS` |
| `EXPO_PUBLIC_VIBECODE_REVENUECAT_*` | `EXPO_PUBLIC_REVENUECAT_*` |
| Vibecode managed dev server & phone preview | Your own `expo start` / EAS builds (see below) |

## What you now need to provide

1. **AI** (advisor, receipt OCR, email parsing): a real `OPENAI_API_KEY` on the
   backend. Without it those routes return 503; the rest of the app works.
2. **OTP email**: set `RESEND_API_KEY` (+ `EMAIL_FROM`) on the backend — get a
   key at [resend.com](https://resend.com) and verify your sending domain.
   Alternatively point `SMTP_SERVICE_URL` at your own relay. In local dev with
   neither set, the OTP is printed to the backend console so signup still works.
3. **Bank linking** (optional): `PLAID_CLIENT_ID` / `PLAID_SECRET`.
4. **Subscriptions email inbox** (optional): see `backend/docs/inbound-email-setup.md`.
5. **In-app purchases** (optional): your own RevenueCat keys as `EXPO_PUBLIC_REVENUECAT_*`.

Full env var table is in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Running it yourself

### Backend
```bash
cd backend
bun install
bun run dev            # local, hot reload  (uses the dev-console OTP sender)
# or: bun run start:prod   # runs prisma migrate deploy, then the server
```

### Mobile (your own Expo dev server — replaces the Vibecode preview)
```bash
cd mobile
bun install
npx expo start         # scan the QR with Expo Go, or press i / a for a simulator
```
Set `EXPO_PUBLIC_BACKEND_URL` in `mobile/.env` to wherever your backend runs.

### Building for the App Store / Play Store
The app is now a standard Expo project, so use **EAS Build** (no Vibecode
"Submit" flow needed):
```bash
npm i -g eas-cli
eas login
eas build:configure
eas build --platform ios      # or android
eas submit --platform ios
```
`com.realbudget.app` is your permanent bundle identifier — register it in Apple
Developer / Google Play Console and in RevenueCat if you use purchases.

## Note on the custom scheme
`realbudget://` is the deep-link scheme (used by the auth session and the
bank/email OAuth return URLs). It's set consistently in `app.json`,
`src/lib/auth/auth-client.ts`, and the backend `trustedOrigins`. If you change
it, change it in all three.
