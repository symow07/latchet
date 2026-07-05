# Deployment Checklist

Everything that must be true before real users touch the app. Items marked 🔑
require accounts/credentials only the owner can provide.

## 1. Database persistence (critical) 🔑

The backend uses SQLite at `DATABASE_URL` (default `file:./prisma/dev.db`).
**Railway's filesystem is ephemeral — without a volume, every deploy erases all
user data.**

- Railway → service → **Volumes** → attach a volume (e.g. mount at `/data`).
- Set `DATABASE_URL=file:/data/prod.db`.
- `bun run start:prod` already runs `prisma migrate deploy` on boot, so the
  schema is created/upgraded automatically on first start.
- Longer-term: migrate to Postgres before the user base grows (SQLite is
  single-writer; the code already forces `connection_limit=1`).

## 2. Environment variables (backend) 🔑

| Variable | Required | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ | Also derives the AES key encrypting Plaid/Gmail tokens — **changing it invalidates all stored tokens**. Back it up. |
| `BACKEND_URL` | ✅ | Public HTTPS URL of the backend. |
| `DATABASE_URL` | ✅ | Point at the persistent volume (see §1). |
| `NODE_ENV=production` | ✅ | Disables `/api/debug` routes and verbose PII logging. |
| `OPENAI_API_KEY` | For AI features | Advisor chat, receipt OCR, email parsing (503 without it). |
| `INBOUND_EMAIL_DOMAIN` / `INBOUND_EMAIL_SECRET` | For email feature | See `backend/docs/inbound-email-setup.md`. |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | For bank linking | `PLAID_ENV=production` requires Plaid production approval (apply early — takes days/weeks). Sandbox works immediately. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Optional | Legacy Gmail OAuth scan path. Works in Google "Testing" mode for ≤100 test users; public launch would need Google's restricted-scope verification + CASA. The forward-to-inbox path avoids this entirely. |
| `DEBUG_ROUTES` / `DEBUG_LOGS` | Leave unset | Emergency-only overrides to re-enable diagnostics in production. |

Mobile: `EXPO_PUBLIC_BACKEND_URL` must point at the production backend.

## 3. Third-party sign-offs 🔑

- **Plaid production access** — dashboard application (company info, security
  questionnaire). Until approved, keep `PLAID_ENV=sandbox`.
- **App Store privacy** — declare data collection (financial data, email
  content, contact info) in App Store Connect; host `PRIVACY.md` at a public
  URL and link it. Build & submit with EAS: `eas build --platform ios` then
  `eas submit` (see `EJECT.md` for the standalone build setup).

## 4. Single-instance constraints (documented, acceptable at launch)

Keep the backend at **one instance**. These use in-process memory and would
misbehave across replicas:

- OAuth pending-session maps (`routes/plaid.ts`, `routes/email.ts`)
- Rate limiters (`auth.ts`) and usage caps (`lib/usage-limit.ts`)

Move these to DB/Redis before scaling horizontally.

## 5. Pre-launch smoke test

1. Sign up with a fresh email → OTP arrives → session persists after app restart.
2. Add a transaction; check dashboard totals, streak, health score.
3. Link a Plaid sandbox bank → transactions sync.
4. Email inbox: provision address, send a test receipt, see it parsed in-app,
   confirm subscription appears with a working cancel link.
5. Business mode: create business, invite code join, expense approve/reject,
   payroll toggle, budget edit.
6. AI advisor answers a question (and returns a friendly 429 after spamming).
7. Redeploy the backend → **verify data survived** (proves §1 works).

## 6. Post-launch monitoring

- Railway logs: `console.error`/`console.warn` still emit in production
  (`[otp:*]`, `[email:*]`, `[plaid:*]` prefixes are searchable).
- Watch OpenAI usage dashboard the first weeks; caps are 200 AI calls/user/day,
  60 inbound email parses/user/day, 12 email scans/user/day.
