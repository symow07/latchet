# Deployment Checklist

Everything that must be true before real users touch the app. Items marked 🔑
require accounts/credentials only the owner can provide.

## 1. Database: self-hosted Postgres on Railway (critical) 🔑

The backend's database is **Postgres** (Prisma, `backend/prisma/schema.prisma`). It runs as its
own service in the Railway **budget** project: the official Postgres 18 image
(`ghcr.io/railwayapp-templates/postgres-ssl:18`) with its own `postgres-volume`, in the same region
as the backend. It is not a hosted database product; the data lives on that volume.

- **Schema.** One migration, `prisma/migrations/20261011120000_postgres_init`, creates every
  table plus the database triggers the sync relies on: `serverUpdatedAt` stamped from the
  database clock, account `balance` derived from `openingBalance` and the ledger, and a
  `SyncTombstone` row for every deleted synced row. `bun run start:prod` runs
  `prisma migrate deploy` on boot, so an empty database is set up on first start.
- **Receipts and company logos** are stored in Postgres (`StoredFile`), not on disk, so the
  backend needs no volume of its own.
- **Backups:** Railway's volume backups on the Postgres service. There is nothing else to back up.

### Local development

Postgres 16+ (Homebrew `postgresql@18` is what this repo was built against):

```sh
createdb budget_dev
cd backend && DATABASE_URL=postgresql://$USER@localhost:5432/budget_dev bunx prisma migrate deploy
DATABASE_URL=postgresql://$USER@localhost:5432/budget_dev bun run dev
```

The URL must name the user: Prisma, unlike `psql`, sends an empty user name otherwise.
`bun test` never touches that database: the suite uses `budget_test` (or
`TEST_DATABASE_URL`, whose name must contain "test"), creating and migrating it as needed.

### Cutover (done 11 October 2026)

Production moved from the SQLite build to Postgres on 11 October 2026:

1. The Budget service's `DATABASE_URL` was set to the reference `${{Postgres.DATABASE_URL}}`
   (the Postgres service's private-network URL) **without redeploying**, so the running SQLite
   build never restarted against it.
2. `main` was pushed (`29c488c`). Deployment `c23defec` ran `prisma migrate deploy`, which applied
   `20261011120000_postgres_init` to the empty database, and passed its `/health` check.
3. Checked against production: `/health` ok; the sync and run-now routes answer 401 without a
   session; a new account signed up, its settings and a transaction were pushed, and a run-now
   booking reached the phone's ledger once.
4. The production SQLite data was test data and was **not migrated**: every account signs up
   again.

Still to do, when nothing needs the old build: detach and delete the Budget service's
`budget-data` volume (the old SQLite file and receipt folder). Until then a rollback can use it.

**Rollback:** in Railway, roll the Budget service back to deployment `dce10784` (commit
`25432f6`, the last SQLite build). A Railway rollback restores that deployment's image *and* its
variables, so `DATABASE_URL` returns to the old `file:` value with it. Then stop `main` from
redeploying Postgres code (revert or disconnect) before the next push.

## 2. Environment variables (backend) 🔑

| Variable | Required | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ | Min 32 chars. Signs sessions. **Safe to rotate** once `TOKEN_ENCRYPTION_KEY` is set — costs only a forced re-login. See "Key rotation" below. |
| `TOKEN_ENCRYPTION_KEY` | Strongly recommended | Min 32 chars. Encrypts Plaid access tokens at rest. **Not safe to rotate** without re-encrypting stored tokens. Back it up. |
| `BACKEND_URL` | ✅ | Public HTTPS URL of the backend. |
| `DATABASE_URL` | ✅ | A `postgres://` or `postgresql://` URL naming the user. On Railway, the reference `${{Postgres.DATABASE_URL}}` (see §1). |
| `NODE_ENV=production` | ✅ | Disables `/api/debug` routes and verbose PII logging. |
| `OPENAI_API_KEY` | For AI features | Advisor chat, receipt OCR, email parsing (503 without it). |
| `INBOUND_EMAIL_DOMAIN` / `INBOUND_EMAIL_SECRET` | For email feature | See `backend/docs/inbound-email-setup.md`. |
| `RESEND_API_KEY` (or `SMTP_SERVICE_URL`) | For password reset and email verification | Without one, production cannot send the reset or verification email: the request still answers normally (no account enumeration) and sign-up still works, but no mail goes out. `EMAIL_FROM` sets the sender (default `Budget <onboarding@resend.dev>`, which only delivers to your own Resend address until you verify a domain). |
| `REVENUECAT_WEBHOOK_SECRET` / `REVENUECAT_API_KEY` | For Pro | The webhook's Authorization value (16+ chars) and the secret API key the entitlement refresh uses. See §3 "Pro store products". |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | For bank linking | `PLAID_ENV=production` requires Plaid production approval (apply early — takes days/weeks). Sandbox works immediately. |
| `DEBUG_ROUTES` / `DEBUG_LOGS` | Leave unset | Emergency-only overrides to re-enable diagnostics in production. |

Mobile: `EXPO_PUBLIC_BACKEND_URL` must point at the production backend.

### Key rotation

These two variables have deliberately different rotation properties, and the
distinction matters when a secret leaks or a collaborator leaves.

| | `BETTER_AUTH_SECRET` | `TOKEN_ENCRYPTION_KEY` |
|---|---|---|
| Protects | Session signing | Plaid tokens at rest |
| Rotating it | **Safe.** Every user is logged out and signs in again. | **Destructive.** Stored tokens become unreadable; every affected user must relink their bank. |
| If lost | Set a new one. | Stored tokens are unrecoverable. |

They used to be the same value: `crypto.ts` derived the AES-256-GCM key from
`BETTER_AUTH_SECRET` with a bare SHA-256. That meant the auth secret could
never be rotated — any change silently broke every stored token — so in
practice it never was, which is the wrong failure mode for the most sensitive
key in the system.

**Set `TOKEN_ENCRYPTION_KEY` before launch.** With it unset the old coupling
still applies (the key is derived from `BETTER_AUTH_SECRET` exactly as before,
so existing deployments keep working), and `BETTER_AUTH_SECRET` stays
un-rotatable.

Ciphertext is versioned, so adopting the new key needs no migration:

- `base64(iv).base64(tag).base64(data)` — v1, read with the key derived from
  `BETTER_AUTH_SECRET`. Still decrypts forever.
- `v2.base64(iv).base64(tag).base64(data)` — written whenever
  `TOKEN_ENCRYPTION_KEY` is set, using HKDF-SHA256.

Existing v1 rows are only rewritten as v2 when a user relinks. To rotate
`BETTER_AUTH_SECRET` while v1 ciphertext still exists, re-encrypt those rows
first — or check that there are none:

```sql
SELECT COUNT(*) AS plaid FROM "PlaidItem";
```

## 3. Third-party sign-offs 🔑

- **Plaid production access** — dashboard application (company info, security
  questionnaire). Until approved, keep `PLAID_ENV=sandbox`.
- **App Store privacy** — declare data collection (financial data, email
  content, contact info) in App Store Connect; host `PRIVACY.md` at a public
  URL and link it. Build & submit with EAS: `eas build --platform ios` then
  `eas submit` (see `EJECT.md` for the standalone build setup).

- **Pro store products** (not done yet; the app needs no product ids). Pro is the
  RevenueCat entitlement **`pro`**: the server reads it (`backend/src/lib/entitlement.ts`)
  and the paywall shows the dashboard's **current offering**
  (`RevenueCatUI.presentPaywall`). To sell it:
  1. App Store Connect → the app (`com.realbudget.app`) → Subscriptions: create a
     subscription group and the products (e.g. monthly and yearly), with prices and
     review screenshots. Play Console → Monetize → Subscriptions: the same, if Android ships.
  2. RevenueCat → Products: import those products (and add **Test Store** products, so
     the development build's test key has something to show).
  3. RevenueCat → Entitlements: attach every product to the entitlement **`pro`**
     (the identifier must be exactly `pro`).
  4. RevenueCat → Offerings: create an offering with the packages, mark it **Current**,
     and attach a paywall to it.
  5. RevenueCat → Integrations → Webhooks: `<BACKEND_URL>/api/v1/revenuecat/webhook`,
     Authorization header = `REVENUECAT_WEBHOOK_SECRET`; set `REVENUECAT_API_KEY` (secret
     key) on the Budget service too.
  6. Check: Settings → Upgrade to Pro shows the paywall with prices; a sandbox purchase
     makes bank sync and the advisor available.
- **Production mail** — set `RESEND_API_KEY` (and a verified `EMAIL_FROM` domain) on the
  Budget service, then use "Forgot password?" on a real account and the verification
  resend in Settings to confirm both emails arrive.

## 4. More than one instance

The backend no longer assumes it is the only process. Everything that used to live in one
process's memory or on its disk is in Postgres:

- **Rate limits** (sign-up, sign-in lockouts, auth in general), **AI usage counts**, and the
  household and business join limiters: atomic counters in `RateLimitBucket`.
- **The exchange-rates cache** and the **Plaid link state**: `CacheEntry`, with expiry.
- **Receipts and logos**: `StoredFile`.
- **Interval jobs** (recurring transactions, bill reminders, retention): each tick takes a
  `JobLease`, and the recurring job also claims each due row, so two instances never book the
  same occurrence. Recurring "run now" (`POST /api/v1/recurring/:id/run`) books through the
  same code under the same deterministic id.

The one thing kept in memory on purpose is the Plaid webhook signing-key cache: public keys
that never change, where losing the cache costs one refetch.

## 5. Sync between phone and server

The phone keeps its own SQLite database, one file per signed-in user, and syncs both ways:

- `POST /api/v1/sync/push` sends the phone's changed rows and deletions (transactions,
  accounts, settings, custom categories, subscriptions). Conflicts go to the most recent edit
  (`clientUpdatedAt`); a fresh device's defaults are dated 1970 so they never overwrite real data.
- `GET /api/v1/sync/pull?cursor=…` returns everything that changed on the server since the
  cursor, including rows the server wrote itself (the recurring job, run-now, bank sync) and
  deletions. With no cursor it returns a full snapshot, which is how a reinstall or a second
  phone restores the account.
- Explicit sign-out sends anything unsynced, then deletes that user's file from the phone.
- The advisor's health profile never leaves the phone (`mobile/src/lib/sync-redaction.ts`), so
  it does not survive a sign-out or a reinstall.

## 6. Pre-launch smoke test

1. Sign up with a fresh email and password → session persists after app restart.
2. Add a transaction; check dashboard totals, streak, health score.
3. Link a Plaid sandbox bank → transactions sync.
4. Email inbox: provision address, send a test receipt, see it parsed in-app,
   confirm subscription appears with a working cancel link.
5. Business mode: create business, invite code join, expense approve/reject,
   payroll toggle, budget edit.
6. AI advisor answers a question (and returns a friendly 429 after spamming).
7. Redeploy the backend → **verify data survived** (proves §1 works).
8. Sign in on a second phone (or reinstall) → the ledger, accounts, settings, categories and
   subscriptions come back. Run a recurring item now → it appears once on both phones.

## 7. Post-launch monitoring

- Railway logs: `console.error`/`console.warn` still emit in production
  (`[mail]`, `[email:*]`, `[plaid:*]` prefixes are searchable).
- Watch OpenAI usage dashboard the first weeks; caps are 200 advisor AI calls/user/day,
  40 email AI extractions/user/day (only for billing emails the rules cannot read, and only
  when OPENAI_API_KEY is set) and 500 forwarded messages per address per day.
