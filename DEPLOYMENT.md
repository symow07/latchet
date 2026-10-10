# Deployment Checklist

Everything that must be true before real users touch the app. Items marked 🔑
require accounts/credentials only the owner can provide.

## 1. Database persistence (critical) 🔑

The backend uses SQLite at `DATABASE_URL` (default `file:./prisma/dev.db`).
**Railway's filesystem is ephemeral — without a volume, every deploy erases all
user data.**

- Railway → service → **Volumes** → attach a volume (e.g. mount at `/data`).
- Set `DATABASE_URL=file:/data/prod.db`.
- Receipt images are written to a `receipts/` directory **beside the database**, so the same volume
  holds both and there is nothing extra to configure. Set `RECEIPT_DIR` only to override that.
  Losing the volume loses the receipts as well as the data.
- `bun run start:prod` already runs `prisma migrate deploy` on boot, so the
  schema is created/upgraded automatically on first start.
- Longer-term: migrate to Postgres before the user base grows (SQLite is
  single-writer; the code already forces `connection_limit=1`).

## 2. Environment variables (backend) 🔑

| Variable | Required | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ | Min 32 chars. Signs sessions. **Safe to rotate** once `TOKEN_ENCRYPTION_KEY` is set — costs only a forced re-login. See "Key rotation" below. |
| `TOKEN_ENCRYPTION_KEY` | Strongly recommended | Min 32 chars. Encrypts Plaid access tokens at rest. **Not safe to rotate** without re-encrypting stored tokens. Back it up. |
| `BACKEND_URL` | ✅ | Public HTTPS URL of the backend. |
| `DATABASE_URL` | ✅ | Point at the persistent volume (see §1). |
| `NODE_ENV=production` | ✅ | Disables `/api/debug` routes and verbose PII logging. |
| `OPENAI_API_KEY` | For AI features | Advisor chat, receipt OCR, email parsing (503 without it). |
| `INBOUND_EMAIL_DOMAIN` / `INBOUND_EMAIL_SECRET` | For email feature | See `backend/docs/inbound-email-setup.md`. |
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
SELECT COUNT(*) AS plaid FROM PlaidItem;
```

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

- The pending bank-link session map (`routes/plaid.ts`)
- Rate limiters (`auth.ts`) and usage caps (`lib/usage-limit.ts`)

Move these to DB/Redis before scaling horizontally.

## 5. Pre-launch smoke test

1. Sign up with a fresh email and password → session persists after app restart.
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
  (`[mail]`, `[email:*]`, `[plaid:*]` prefixes are searchable).
- Watch OpenAI usage dashboard the first weeks; caps are 200 AI calls/user/day and
  60 inbound email parses/user/day.
