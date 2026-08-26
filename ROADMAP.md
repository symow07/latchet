# Real Budget — Execution Roadmap

> **Status, 26 August 2026.** 27 of 30 tasks are shipped and marked ☑ below, plus a
> Phase 8 (fast capture) added afterwards — see the end of this file.
> Three remain open, and none of them is code:
>
> - **Task 21 — app icon and splash.** Needs design. Still no `assets/`, and
>   `app.json` declares no `icon`, so prebuild is shipping Expo's placeholder.
>   The roadmap calls this a hard blocker and it still is.
> - **Task 24 — Arabic and RTL.** Deliberately deferred to v1.1. The i18n
>   scaffolding is in place, so it costs nothing to wait.
> - **Task 29 — deployment verification.** Needs the Railway dashboard: the
>   volume attachment and the single-instance check cannot be confirmed from
>   the repo.
>
> One thing left unresolved rather than silently decided: Task 20 chose
> "Budget" as the app name, and `app.json` says so, but `README.md` still
> leads with "Real Budget" — which also matches the bundle id and the domain.
> Both readings are defensible (long brand, short app name), so it is marked
> done on the code rollout and the store listing name is tracked in
> SUBMISSION.md item 9.

> **For the agent working this file.** This is a self-contained work order. You do not need
> prior context. Every task states the file, the defect, the fix, and how to verify it.
> Work tasks **in order** — later ones assume earlier ones landed. Tick the boxes as you go and
> commit after each numbered task.
>
> Findings were produced by a full read of the backend (4,934 LOC) and the mobile business-logic
> layer. Line numbers are from commit `6f0260e` — re-grep if they've drifted.

---

## 0. Orientation

**Monorepo, two halves:**

| Path | Stack | Notes |
|---|---|---|
| `backend/` | Bun + Hono + Prisma 5 + SQLite, Better Auth | Deployed on Railway, builds `main` |
| `mobile/` | Expo 53, RN 0.79.6, expo-router, NativeWind, TanStack Query, expo-sqlite | EAS, bundle `com.realbudget.app` |

**Architecture in one line:** the mobile app is local-first (its own SQLite in `mobile/src/lib/db.ts`,
all analytics computed on-device); the backend owns auth, the three secret API keys (OpenAI, Plaid,
Google), and is *supposed* to own sync.

**Commands:**

```bash
# backend
cd backend && bun install
bun run dev            # hot reload
bun run typecheck      # tsc --noEmit
bun test               # bun test
bun run start:prod     # prisma migrate deploy && start

# mobile
cd mobile && bun install
npx expo start
bun run typecheck
bun run lint
```

**Ground rules:**

- Run `bun run typecheck` in **both** halves before every commit. Both are `strict`.
- Backend uses `zValidator` + Zod on most routes — match that style, don't invent a new one.
- Pure logic goes in dependency-free modules with tests (see `backend/src/lib/plaid-mappers.ts`,
  `crypto.ts`, `inbound-email.ts`, `usage-limit.ts` for the established pattern).
- Do **not** remove the comments in `backend/src/auth.ts:25-38` or `backend/src/prisma.ts:4-7`.
  They document a Bun body-clone deadlock and the SQLite `connection_limit=1` fix — hard-won and
  easy to accidentally regress.
- Conventional commits (`fix:`, `feat:`, `chore:`), matching existing history.

**Pending product decisions** (do not block on these; they only gate Phase 4/5):

- App name — shortlist is Cowry / Mizan / Kesh. Gates bundle ID, icon, store metadata.
- Free-tier AI allowance — 0/day or ~5/day.
- Arabic in v1 or v1.1.

---

## Phase 0 — Stop the bleeding

### ☑ Task 1 — Merge and push the feature branch

Local `feature/complete-core-features` (`6f0260e`) is **4 commits ahead of `origin/main`**
(`273047e`). Railway deploys `main`, so production is running code that predates the currency
fixes, the Plus Jakarta Sans redesign, the Alipay/WeChat/Moroccan import, and custom categories.
Local `main` is also 4 behind origin.

```bash
git fetch origin
git checkout main && git pull origin main
git merge feature/complete-core-features
bun run typecheck   # in both halves
git push origin main
```

**Verify:** `git log origin/main --oneline -1` shows `6f0260e` or a merge commit above it. Railway
redeploys green. `curl https://budget-production-5a9d.up.railway.app/health` → `{"status":"ok"}`.

---

### ☑ Task 2 — Bill reminders push every 5 minutes, forever

**File:** `backend/src/jobs/bill-reminder-checker.ts:18-49`

`checkBillReminders()` selects `{ isPaid: false, nextDueDate: { lte: today } }`. When
`isRecurring: true` it advances `nextDueDate`, so it fires once. When `isRecurring: false`
**nothing is mutated** — the row matches again on the next 5-minute tick and every tick after.
One unpaid one-off bill = **288 push notifications per day**.

**Fix:**

1. Prisma migration: add `lastNotifiedAt DateTime?` to `BillReminder`.
2. Exclude rows already notified for the current due date:
   `where: { isPaid: false, nextDueDate: { lte: today }, OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: <start of nextDueDate> } }] }`
3. Set `lastNotifiedAt: new Date()` after a successful send, for recurring **and** non-recurring.
4. While here: the push body hardcodes `$` (`:37`). Use the user's `UserSettings.currencySymbol`.

**Verify:** unit test with a non-recurring unpaid reminder due today — two consecutive
`checkBillReminders()` calls must produce exactly one `sendPushToUser` call. Extend
`backend/src/jobs/bill-reminder.test.ts`.

---

### ☑ Task 3 — Cloud sync: never pushes, and the pull corrupts data ⚠️ **highest risk in the repo**

Three defects that **must land as one commit**. Fixing the first without the others converts silent
data loss into active corruption on every existing account.

**(a) `pushLocalDataToCloud()` is never called.**
`mobile/src/lib/cloud-sync.ts:22` — defined, exported, zero call sites. Grep the repo: the only
writes to `/api/transactions/sync`, `/api/accounts/sync` and `/api/settings` live inside that dead
function. Every hand-entered transaction, account and setting exists **only** in on-device SQLite.
Reinstall the app → permanent loss. The app requires an account and implies a backup that isn't there.

**(b) The pull discards server ids and duplicates on every login.**
`pullCloudDataToLocal()` (`cloud-sync.ts:62`) is called from `mobile/src/app/verify-otp.tsx:44` on
every login. At `:76` it calls `createAccount({ name: acc.name, … })` — but `createAccount`
(`db.ts:231`, id generated at `:241`) mints its **own** `acc_<ts>_<rand>` and throws `acc.id` away.
The cloud id is therefore never present locally, `localAccountIds.has(acc.id)` is false again next
login, and the row is created again. Identical problem at `:96` with `addTransaction` (`db.ts:314`,
id at `:325`) and `tx.id`.

**(c) Each duplicate also moves the balance.**
`addTransaction` calls `updateAccountBalance` at `db.ts:353-360`. So duplication doesn't just add
rows, it **re-debits the account**. Balances drift further from reality on every login, silently.

> Currently live for rows that already exist server-side: backend recurring-processor output,
> transactions posted by `mobile/src/app/recurring.tsx:879`, and everything Plaid syncs.

**Fix:**

1. Add id-preserving, side-effect-free variants in `db.ts`:
   `createAccountWithId(id, …)` and `addTransactionWithId(id, …)`. The transaction variant must
   **not** call `updateAccountBalance` — synced rows already reflect the server's balance.
2. Rewrite `pullCloudDataToLocal` to use them, keying dedup on the server id.
3. Recompute account balances once after a pull completes, rather than incrementally.
4. Wire `pushLocalDataToCloud` to a real trigger: after onboarding completes, on app foreground
   (debounced), and after any local mutation (debounced). Keep it best-effort — local stays the
   source of truth.
5. **Ship Task 4 in the same commit** or push sync 400s immediately.

**Verify:** log in twice on a seeded account. Transaction count and every account balance must be
**identical** after both logins. Add a regression test for `pullCloudDataToLocal` id preservation.

---

### ☑ Task 4 — `primaryGoal` enum mismatch (ship with Task 3)

- `mobile/src/app/onboarding.tsx:36-37, 51` writes `'save' | 'track' | 'reduce_debt' | 'budget'`
- `backend/src/routes/settings.ts:17` accepts `['track','save','invest','debt']`

Two of the four options a user can tap would be **rejected with a 400** the moment settings sync.
Invisible today only because of Task 3(a).

**Fix:** align on the mobile vocabulary (`save | track | reduce_debt | budget`) — it's the
user-facing one. Update the backend enum, `mobile/src/lib/onboarding-storage.ts:11`, and add a
migration mapping any existing `invest`/`debt` rows.

**Verify:** complete onboarding choosing "Reduce Debt", confirm `PUT /api/settings` returns 200.

---

### ☑ Task 5 — Sign-up has no rate limit

**File:** `backend/src/index.ts:107-113`

`/api/auth/sign-up/email` and `/api/auth/sign-in/email` are explicitly exempted from
`generalAuthRateLimiter` — a temporary measure from the signup-hang investigation, never reverted.
Sign-in is still covered by `loginRateLimiter` via the `/api/auth/sign-in/*` mount, so the real
exposure is **sign-up**: unlimited account creation, and because sign-up triggers an OTP send,
unlimited outbound Resend mail on your bill and your domain reputation.

**Fix:** remove the exemption. Add a dedicated `signupRateLimiter` (suggest 5/IP/hour, 20/IP/day).
Verify the original hang does not return — the cause was body-cloning in `extractIdentifier`
(see `auth.ts:25-38`), which is already gone, so a header-only limiter is safe.

**Related (`auth.ts:39`):** `extractIdentifier` reads the identifier only from `?email=` or an
`x-rate-limit-identifier` header, and the mobile client sends neither — so every per-identifier
limit and lockout is unreachable. Fix by having `mobile/src/lib/api/api.ts` send
`x-rate-limit-identifier` on auth calls. **Do not** reintroduce body parsing.

**Verify:** 6 rapid sign-ups from one IP → the 6th returns 429. Then confirm a normal sign-up still
completes end to end without timing out.

---

### ☑ Task 6 — Plaid webhook has no signature verification

**File:** `backend/src/routes/plaid.ts:69`

The webhook is correctly registered before the auth guard (Plaid calls it server-to-server) but
performs **no verification**. Anyone can POST
`{item_id, webhook_code: "SYNC_UPDATES_AVAILABLE"}` to force unbounded `/transactions/sync` runs
against your Plaid quota and your single SQLite writer — cost amplification and DoS at once.

**Fix:** verify the `Plaid-Verification` JWT header against the key from
`/webhook_verification_key/get`, per Plaid's documented flow (cache keys by `key_id`; reject
`kid`-less or stale tokens). Reject unverified requests with 401 before any DB work.

**Blocker to note:** this must be in place before `PLAID_ENV=production`.

**Verify:** unsigned POST → 401. A correctly signed sandbox webhook → 200.

---

## Phase 1 — Correctness

### ☑ Task 7 — Import parser corrupts European data ⚠️ tier-1

Import is the product's primary universal rail (bank sync covers only 20 countries). These are
blockers, not polish. **File:** `mobile/src/lib/import-parser.ts`

- **`parseAmount` (:298) truncates European decimals.** For `"1.234,56"` the thousands regex
  `/,(?=\d{3}\b)/` doesn't match (comma followed by `56`), then `/,(\d{1,2})$/` produces
  `"1.234.56"`, and `parseFloat` stops at the second dot → **1.234**. €1,234.56 imports as €1.23.
- **`parseDate` (:322) misreads DD/MM/YYYY.** The `MM/DD/YYYY` branch matches first, so
  `01/09/2026` (1 September on a French/Moroccan statement) becomes **9 January**. Where day > 12
  it falls through to `new Date(cleaned)`, also US-first.
- **Single-amount-column statements import expenses as Income** (:166): `amount >= 0 → 'Income'`.
  Correct only for banks that sign expenses negative.
- If only a debit column exists (no credit), `amountIdx === debitIdx` and the single-column path
  treats a positive debit as Income.

**Fix:** detect the decimal convention per file (sample several amount cells: if commas appear as
the last separator with 1–2 trailing digits, it's European). Add an explicit date-format hint
inferred from the file, or a user-facing format picker in `import.tsx`, defaulting to DD/MM for
non-US locales. Add a sign convention control to the preview screen so the user can flip
expense/income if detection is wrong.

**Verify:** new unit-test fixtures for a US bank CSV, a French bank CSV (`1.234,56` + DD/MM), a
Moroccan CSV, an Alipay export, and a WeChat export. Assert amounts and dates exactly.

---

### ☑ Task 8 — Timezone bugs make "this month" mean two different things

**File:** `mobile/src/lib/health-score.ts`

`calculations.ts` compares `YYYY-MM-DD` strings (correct). `health-score.ts` uses
`new Date(tx.dateISO).getMonth()` — UTC parse, local getter — at `:68`, `:108`, `:192`, `:226`,
`:259`. Month-boundary transactions land in the wrong month. `:144`
(`calculateSpendingConsistencyScore`) compares a UTC `toISOString()` date string against
locally-derived `dateISO`, off by one for everyone east of UTC after 16:00 local.

**Fix:** one shared helper module (`lib/dates.ts`) doing all comparison on `YYYY-MM-DD` strings.
Replace every `new Date(dateISO)` used for calendar comparison. Same bug class in
`subscription-detection.ts:233` (`getUpcomingCharges` hides a charge due *today* after 08:00 local
at UTC+8) — fix it here too.

**Verify:** tests with `TZ=Asia/Shanghai` and `TZ=America/Los_Angeles` producing identical
month-bucket results for the same fixture.

---

### ☑ Task 9 — Projections explode on the 1st of the month

**File:** `mobile/src/lib/ai-analysis.ts:266`

`monthlyNetSavings = income − (currentMonthExpenses / dayOfMonth × 30)`. On day 1 a single $200
purchase extrapolates to $6,000/month; the 6-month and 1-year projections go wildly negative — and
this number is injected into the AI advisor prompt (`:413-414`), so the advisor discusses a
fabricated crisis.

Also `mobile/src/lib/calculations.ts:90`: `calculateAverageDailySpend` always divides by 30, so a
two-day-old account showing $60 reports $2/day and `calculateSurvivalDays` claims ~2 years.

**Fix:** require a minimum sample (≥7 days of history) before extrapolating; below that, return
`null` and have the UI show "not enough data yet". Divide by actual elapsed days, not a constant.
Blend the current month with the prior month's actuals when early in a month. Also
`projectedMonthEndBalance` ignores expected income — factor in `settings.monthlyIncome`.

**Verify:** fixture dated the 1st with one transaction produces a `null`/low-confidence projection,
not a six-figure negative.

---

### ☑ Task 10 — Recurring processor skips short months

**File:** `backend/src/jobs/recurring-processor.ts:16-18`

`d.setUTCMonth(d.getUTCMonth() + 1)` turns 31 January into 3 March. This is exactly the bug already
found **and fixed** in `bill-reminder-checker.ts:advanceMonth` (whose comment explains it) — the fix
was never applied to the sibling. Monthly recurrences dated the 29th–31st skip months.

**Fix:** export `advanceMonth` from a shared module and use it in both. Add tests for 31 Jan, 30 Jan
in a leap year, and 31 Mar.

---

### ☑ Task 11 — Plaid sync gaps

**File:** `backend/src/routes/plaid.ts`

- **`:317-330`** creates `Transaction` rows with **no `accountId`**, so bank-synced transactions
  never touch a `BankAccount` balance and can't be filtered by account. Map `PlaidAccount` →
  `BankAccount` (create the local account on first sync) and set `accountId`.
- **`:313`** iterates `page.added` only. `/transactions/sync` also returns `modified` and `removed`;
  pending→posted amount changes and cancellations are never applied, so balances drift permanently.
  Handle all three arrays.
- **`:306`** `while (hasMore)` is unbounded — cap iterations and move long syncs to a background job.
- **`:118`** `country_codes: ["US"]` is hardcoded. Drive it from the user's locale/currency, limited
  to Plaid's actual 20 (US, CA + AT, BE, DK, EE, FI, FR, DE, IE, IT, LV, LT, NL, NO, PL, PT, ES, SE, GB).

---

### ☑ Task 12 — Exchange rates are ~2 years stale

**File:** `mobile/src/lib/currencies.ts`

Hardcoded rates from roughly early 2024 (TRY 32, ARS 875, NGN 1550, BTC implying ~$41.7k). The
file's own comment says "in production, fetch from an API". `convertCurrency()` does real money math
with these.

**Fix:** backend endpoint `GET /api/v1/rates` proxying a rates provider, cached ~24h server-side;
mobile caches locally with the bundled table as offline fallback. Show a "rates as of <date>" line
wherever conversion is displayed.

Also `calculations.ts:242` hardcodes `'en-US'` in `Intl.NumberFormat` — wrong grouping and symbol
placement for every non-US locale. Becomes a visible bug in Phase 5; fix it here.

---

## Phase 2 — Hardening

### ☑ Task 13 — Global error handling

**File:** `backend/src/index.ts`

No `app.onError`, no `app.notFound`. Every Prisma `P2025` on a wrong-id `PUT`/`DELETE`, every
`P2002`, every crash in an unvalidated route escapes as an opaque 500 with no request id.

**Fix:** add `app.onError` mapping Prisma codes to proper statuses (`P2025`→404, `P2002`→409,
Zod→400), returning `{ error, code, requestId }`. Add `app.notFound`. Generate a request id in
middleware and log it. Never leak stack traces when `NODE_ENV=production`.

---

### ☑ Task 14 — Five routes have zero request validation

`backend/src/routes/`: `recurring.ts`, `bill-reminders.ts`, `net-worth.ts`, `category-budgets.ts`,
and the `PUT` in `accounts.ts` all splat `await c.req.json()` straight into Prisma.
`net-worth.ts:36` computes `body.assets - body.liabilities` → stores **NaN** when either is missing.

**Fix:** add `zValidator` schemas matching the style of `transactions.ts` / `settings.ts`.

Also cap the sync endpoints — `transactions.ts:110` and `accounts.ts:87` accept **unbounded arrays**
and do a `findUnique` **per row in a serial loop** before one `$transaction`. 10,000 rows = 10,000
sequential queries against the single SQLite connection, blocking everything. Cap at 1,000 rows per
request and replace the loop with one batched `findMany({ where: { id: { in: ids } } })`.

And `backend/src/routes/ai.ts:84` — `image: z.string().min(1)` with **no max**. Cap at ~10 MB base64.

---

### ☑ Task 15 — Timeouts, health check, misc security

- **No timeouts on outbound calls.** `email-otp.ts` does it right (5s). Nothing else does:
  `ai.ts:openaiChat`, both OpenAI calls in `email.ts`, every `plaid()` call, `gmail.ts`,
  `expo-push.ts`. Add `AbortController` timeouts to all of them.
- **`index.ts:143`** — `/health` returns ok unconditionally. Make it run `SELECT 1` so Railway's
  healthcheck fails when the DB volume is unreachable.
- **`routes/email.ts:201, :123`** — open redirect: `returnUrl` comes off the query string and is
  used in `c.redirect(\`${returnUrl}?status=success&email=<email>\`)` with no allowlist, leaking the
  user's email to any host. Allowlist the `realbudget://` scheme (and the new scheme after rename).
- **`env.ts:8`** — `BETTER_AUTH_SECRET` has no minimum length, yet `lib/crypto.ts:10` derives the
  AES-256-GCM key protecting every Plaid access token and Gmail refresh token from it. Require ≥32 chars.
- **`routes/email.ts:136`** — replace `!==` on the inbound webhook secret with `crypto.timingSafeEqual`.
- **`auth.ts:171`** — PBKDF2 at 100k iterations; OWASP's current figure for PBKDF2-HMAC-SHA256 is
  600k. Raise as far as Railway's CPU allows without breaching request timeouts; measure and correct
  the comment. Keep existing hashes verifiable (store the iteration count in the hash string).
- **`plaid.ts:58` / `email.ts:49`** — in-memory OAuth state maps never expire; every abandoned link
  leaks an entry forever. Add TTL + periodic sweep (mirror the pattern in `usage-limit.ts:51`).
- **`payroll.ts:34-35`** — `month`/`year` from `Number(c.req.query(...))` with no validation;
  `?month=abc` reaches the upsert as `NaN`. Validate. Also `:63` — a `GET` performing an upsert;
  move `ensurePayment` out of the read path.
- **`expo-push.ts:39`** — batch sends in chunks of 100 (Expo's documented limit).
- **`ai.ts:61`** — prompt capped at 20,000 chars while `buildAIPrompt` concatenates unbounded
  history, so the advisor **hard-fails after a long chat**. Add rolling-summary trimming client-side.

---

### ☑ Task 15b — Decouple the token-encryption key from `BETTER_AUTH_SECRET` ⚠️ do this before launch

**Files:** `backend/src/lib/crypto.ts`, `backend/src/env.ts`, `backend/src/routes/plaid.ts`,
`backend/src/routes/email.ts`

Task 15 made `BETTER_AUTH_SECRET` hard to be *weak* (min 32 chars, hard boot failure). It did not
fix the underlying coupling, which is the more serious property:

`crypto.ts:10` derives the AES-256-GCM key that protects **every stored Plaid access token and
Gmail refresh token** directly from `BETTER_AUTH_SECRET` via a bare SHA-256. That single value
therefore controls two unrelated concerns at once — session signing and data-at-rest encryption.

The consequence: **the auth secret can never be rotated.** Changing it silently makes every stored
token undecryptable, and every affected user has to relink their bank and inbox. So a secret leak,
a departing collaborator, or ordinary hygiene rotation all become "force every user to relink",
which in practice means it never gets rotated at all. That is the wrong failure mode for a fintech
app's most sensitive key.

**Why now:** the fix is cheap only while there is little or no ciphertext. Check first:

```sql
SELECT (SELECT COUNT(*) FROM PlaidItem) AS plaid,
       (SELECT COUNT(*) FROM EmailConnection WHERE refreshTokenEnc IS NOT NULL) AS gmail;
```

If both are 0 (likely — not launched, Plaid still sandbox), this is a pure refactor with no data
migration. Post-launch it becomes a re-encryption job across live user data.

**Fix:**

1. Add `TOKEN_ENCRYPTION_KEY` to `env.ts` — optional, min 32 chars when present. When absent, fall
   back to deriving from `BETTER_AUTH_SECRET` exactly as today, so existing deployments keep working.
2. Version the ciphertext. Current format is `base64(iv).base64(tag).base64(data)`. Emit
   `v2.<iv>.<tag>.<data>` for anything written with `TOKEN_ENCRYPTION_KEY`; treat a 3-part payload
   with no version prefix as v1 and decrypt it with the legacy derived key. Mirror the approach
   already used for password hashes in `auth.ts` (`pbkdf2:<iterations>:<salt>:<key>` vs. the 3-part
   legacy form) — same problem, same shape of solution.
3. `encryptSecret` always writes v2 when the key is configured; `decryptSecret` dispatches on the
   prefix. Callers in `plaid.ts` and `email.ts` need no changes.
4. Prefer HKDF over bare SHA-256 for the derivation, with a fixed `info` string
   (e.g. `"realbudget/token-encryption/v2"`) for domain separation.
5. Document both variables in `DEPLOYMENT.md`, and state plainly which one is safe to rotate
   (`BETTER_AUTH_SECRET`, once decoupled — costs only a forced re-login) and which is not
   (`TOKEN_ENCRYPTION_KEY` — requires re-encryption).

**Verify:**

- Unit test: a v1 payload produced by the legacy derivation still decrypts after the change.
- Unit test: with `TOKEN_ENCRYPTION_KEY` set, a value round-trips through v2, and a payload written
  under one auth secret still decrypts after `BETTER_AUTH_SECRET` is changed — this is the whole
  point, so assert it explicitly.
- Unit test: a tampered auth tag still throws.
- Confirm the backend boots with `TOKEN_ENCRYPTION_KEY` unset (backwards compatibility).

---

### ☑ Task 16 — Business membership authorization hole ⚠️ launch blocker

**Files:** `backend/src/routes/business.ts:204-225`, `backend/src/lib/get-user-business.ts:6`,
`backend/src/routes/expenses.ts:23`

`POST /api/business/team` accepts an **arbitrary `userId`** with no invitation, consent, or existence
check and creates a `TeamMember` row. Because membership resolves via **`findFirst`**, a victim who
doesn't own a business is then silently resolved *into the attacker's business* — their business-mode
screens read and write someone else's payroll and expense data.

**Fix:**

1. Delete the arbitrary-`userId` path. Joining happens only via invite code
   (`POST /api/business/join`, already implemented and rate-limited) or an explicit invitation the
   invitee accepts.
2. Replace `findFirst` membership resolution with an explicit current-business selection
   (`UserSettings.activeBusinessId`, or a header) so multi-business users are deterministic.
3. Add authorization tests: a user in two businesses; a user added without consent must not resolve.

---

## Phase 3 — Global rail

### ☑ Task 17 — Provider abstraction for bank sync

Plaid Transactions covers exactly **20 countries** (US, CA + 18 EU). Morocco and China are not
among them, and Alipay/WeChat are unreachable by any aggregator — import is the only universal path.

**Fix:** extract a `BankProvider` interface (`createLinkSession`, `exchange`, `listAccounts`,
`syncTransactions`, `removeItem`) and move the existing Plaid code behind it.
`backend/src/lib/plaid-mappers.ts` is already isolated and tested, so this is mostly mechanical.
Adding Salt Edge (73 countries) or TrueLayer (64) later becomes additive.

---

### ☑ Task 18 — Import v2

Import is now the primary rail; make it excellent.

- PDF statement parsing via the vision model (reuse the `receipt-scan.tsx` → `/api/ai/analyze-receipt` plumbing).
- Per-bank format profiles, auto-detected and remembered.
- Replace the thrown `Error('Could not identify required columns')` (`import-parser.ts:127`) with a
  manual column-mapping UI so no file is ever a dead end.
- Round-trip fidelity: `export-data.ts` writes a `Category` column that `parseCSV` ignores, so
  categories are re-guessed and `isImpulse` is lost. Make export/import lossless.

---

### ☑ Task 19 — Consolidate four subscription detectors into one

Four implementations of the same feature, three of them live, guaranteed to disagree on screen:

| Implementation | Consumer |
|---|---|
| `lib/subscription-detection.ts` → `scanAndSaveSubscriptions` | `app/subscriptions.tsx` |
| `lib/behavior-detection.ts` → `detectSubscriptions` | `app/business-tools.tsx` |
| `lib/business-subscription-detection.ts` → `detectSubscriptions` | `app/(business-tabs)/index.tsx` |
| backend `routes/email.ts` → `extractSubscriptions` (OpenAI) | `/api/email/scan` |

**Fix:** one engine with pluggable sources (transaction / email / bank). Delete the other two mobile
implementations. Fix these bugs from the primary detector while consolidating:

- **`:120`** `const raw = tx.note || tx.category` — with no note it groups by *category*, so every
  "Food" expense becomes one merchant and the app reports *"Food — monthly, $45"* as a subscription.
  Require a real merchant string; skip transactions without one.
- **`:206`** occurrences duplicate on every scan — `addSubscriptionOccurrence` builds a fresh random
  id then does `INSERT OR IGNORE`, so the conflict target never collides. Make the id deterministic
  (`socc_<subId>_<transactionId>`).
- **`:186`** `subId` embeds `Math.round(typicalAmount)`, so a price change mints a *new* subscription
  instead of updating. Drop the amount from the id.

**This task is a precondition for the AI work in Phase 7.**

---

## Phase 4 — Brand & monetization

*Blocked on the name decision (Cowry / Mizan / Kesh).*

### ☑ Task 20 — Name and identity rollout

Naming is inconsistent today: `app.json` says `"Budget"`, README says "Real Budget", bundle is
`com.realbudget.app`. Once the name is chosen, update in lockstep — `app.json` (`name`, `slug`,
`scheme`, `ios.bundleIdentifier`, `android.package`), `mobile/src/lib/auth/auth-client.ts:10`
(`scheme`, `storagePrefix`), `backend/src/auth.ts:274` (`trustedOrigins`),
`backend/src/routes/plaid.ts:114` (`client_name`), `emailSubscriptionApi.ts:47`
(`EMAIL_RETURN_URL`), `email-otp.ts`, README, EAS config.

### ☐ Task 21 — App icon and splash ⚠️ hard blocker

**There is no `assets/` directory anywhere in the repo**, and `app.json` declares no `icon` or
`splash`. The app would ship with the Expo placeholder — an automatic rejection risk and an instant
credibility loss.

Produce: 1024×1024 icon, adaptive icon (foreground/background), splash, and App Store screenshots
for every required device size.

### ☑ Task 22 — RevenueCat end to end

`mobile/src/lib/revenuecatClient.ts` is 328 lines with **zero call sites** today, plus
`react-native-purchases` and `react-native-purchases-ui` in dependencies.

Tier model: **free** = manual tracking, import, budgets, subscriptions, business mode basics.
**Pro** = AI advisor, receipt scan, email detection, bank sync.

1. Create products in App Store Connect, Play Console, and RevenueCat.
2. Paywall UI + feature gating.
3. **Restore purchases** — Apple requires it.
4. ⚠️ **Server-side entitlement verification.** Client-side gating is bypassed in minutes, and the
   Pro features are exactly the ones that cost real money per call. Add a RevenueCat webhook →
   persist entitlement on `User` → check it in the existing auth guards in `routes/ai.ts:29` and
   `routes/plaid.ts:100`. Non-negotiable.
5. Rework `lib/usage-limit.ts` caps into free vs Pro allowances (free allowance TBD — 0/day or ~5/day).

---

## Phase 5 — Localization

### ☑ Task 23 — i18n scaffolding + English, French, Chinese

String extraction across all 26 screens. Locale-aware currency and date formatting (depends on
Task 12). Wire locale to `UserSettings`.

### ☐ Task 24 — Arabic + RTL

Every `flex-row`, absolute position, icon direction and chart axis across 26 screens.
`I18nManager.forceRTL` requires an app restart, which interacts with the startup sequence in
`mobile/src/app/_layout.tsx` — handle deliberately.

> **Recommendation:** ship v1 as English/French/Chinese with scaffolding in place, Arabic as v1.1.
> Same total work, much smaller surface to get wrong while everything else is stabilizing.
> Confirm with the owner before starting.

---

## Phase 6 — Ship

### ☑ Task 25 — In-app account deletion ⚠️ Apple requirement

Required since 2022 for any app with account creation. Not implemented; `PRIVACY.md` says "contact
support", which is an automatic rejection.

Add `DELETE /api/v1/me` cascading User → sessions, transactions, accounts, settings, business,
Plaid items (revoke with Plaid first), email connections (revoke with Google first), inbox emails,
push tokens. Add a confirm-flow entry in `mobile/src/app/(tabs)/settings.tsx`.

### ☑ Task 26 — Privacy policy accuracy and hosting

- Host `PRIVACY.md` at a public URL; fill in the support email (currently the literal placeholder
  `<support email — fill in before publishing>`).
- **Reconcile it with the code.** It states in bold that only merchant/amount/currency/cycle/date is
  kept — but `InboxEmail` (`schema.prisma:284`) also persists `fromAddr` and `subject` indefinitely
  (`routes/email.ts:173`), and subject lines routinely carry amounts and order numbers. Either stop
  storing them after parsing, or amend the policy. App Store privacy declarations are checked
  against this document.
- Add a retention policy — nothing is ever deleted today.

### ☑ Task 27 — Rewrite the README ⚠️ store-rejection risk

`README.md` currently claims "No cloud sync, no credentials sharing, **no data leaving your device
— ever**" and "No backend required, no data syncing, no accounts on external servers". All false —
and it directly contradicts `PRIVACY.md` on exactly the question App Review cares about
(Guideline 5.1.1). It also documents a `src/lib/auth.ts` that no longer exists and claims the app
seeds demo data (`seedDemoData()` is dead code; migration `v2_clear_seed` exists to delete it).

### ☑ Task 28 — Dead code and config cleanup

- Delete `backend/src/routes/sample.ts` (a "Hello from the backend!" demo route, mounted in production).
- Delete `mobile/src/lib/state/example-state.ts` (template leftover).
- Delete `seedDemoData()` from `db.ts`.
- `mobile/src/lib/bank-linking.ts:116` — `SUPPORTED_BANKS`, 8 hardcoded US banks with emoji logos
  marked `// Mock supported banks`, rendered by `link-bank.tsx:342`. Remove or replace with the real
  provider institution list.
- Same file — `getSyncSettings()` exposes `autoSync`/`syncFrequency`/`notifyOnNewTransactions`
  that nothing reads (there is no scheduler). `getConsentInfo()` returns hardcoded consent text.
  `checkConnectionHealth()` derives expiry from `updatedAt + 90d`, but `updatedAt` refreshes on
  every sync, so consent never expires.
- Replace `backend/CLAUDE.md` — it's stale scaffold text claiming "No database is configured by
  default" with a `todos.ts` example. Actively misleads future agent sessions.
- Fix the duplicate `"extends"` key in `mobile/tsconfig.json`.
- Rename `mobile/package.json` from `"template-app-53"`.
- Trim unused Android permissions in `app.json` (`RECORD_AUDIO`, `READ/WRITE_EXTERNAL_STORAGE`).
- Verify `patchDefaultFont()` (`mobile/src/lib/design.ts:112`) actually works — it sets
  `Text.defaultProps`, which React 19 removed for function components. If it no-ops, the Plus
  Jakarta Sans rollout from commit `cdfba58` only applies where `fontFamily` is set explicitly.

### ☐ Task 29 — Deployment verification

- ⚠️ **Confirm the Railway volume is attached** and `DATABASE_URL=file:/data/prod.db`. Without it
  every deploy silently erases all user data.
- Confirm the backend runs at **exactly one instance** — rate limiters, usage caps, both OAuth state
  maps and both cron jobs are all in-process (`DEPLOYMENT.md §4`).
- App Store Connect metadata and privacy declarations.

### 🔑 Start immediately, in parallel — Plaid production application

Takes days to weeks and gates nothing else. Should be running in the background from day one.

---

## Phase 7 — Improvements

Only after the above.

- **Advisor as a proper chat agent** — `system` role (today the entire prompt goes in as `user`, so
  the GUIDELINES block is trivially overridable), streaming, tool-calls answered from local SQLite,
  rolling summary instead of unbounded history.
- **An advisor that can act** — "set my Food budget to 400" should do it, not describe it.
- **Learned categorisation.** `import-parser.ts:14` `CATEGORY_KEYWORDS` is US-brand-centric and
  useless against a Moroccan or Chinese statement — precisely the markets this plan targets. A user
  rules engine ("anything from Carrefour → Food") handles ~80% more cheaply and predictably; the
  model handles the tail and learns from corrections.
- **Weekly proactive digest push** — the data is already computed and nothing surfaces it unprompted.
- **Empty / loading / error states as real components** — a new user currently meets a wall of zeroes
  and a "C" grade.
- **Charts** — `victory-native` and Skia are already dependencies; the dashboard uses neither.
- **Home-screen widget / Live Activity** for remaining budget today.
- Replace `Alert.alert` across 8 screens with toasts (`burnt` is already installed).
- Re-lock biometrics on app foreground — `_layout.tsx:383` only checks on cold start, so
  backgrounding and resuming skips it, contradicting the "Face ID on every open" claim.
- Handle push taps — the backend sends `data: { type: 'bill-reminder', billId }` but no
  `addNotificationResponseReceivedListener` exists, so tapping just opens the app.
- Upgrade the OpenAI models — `routes/ai.ts:16-17` pins `gpt-4o-mini` / `gpt-4o`, both old by
  August 2026. Benchmark receipt-extraction accuracy before and after.
- Offline support for `bill-reminders`, `recurring`, `net-worth`, `category-budgets` — these have no
  local SQLite table and are blank without a network, contradicting "offline-first".

---

## Phase 8 — Fast capture

Not part of the original 30. Added after the observation that people abandon budgeting apps
because manual entry costs more than the insight is worth, so every path here is about getting a
transaction in without opening a form.

- ☑ **Voice memo capture.** Hold the mic on the advisor tab, describe the day, and Whisper plus a
  structured extraction turn it into rows. Nothing is written until the user has seen it —
  `VoiceReviewSheet` shows the transcript above editable amounts, because a misheard "fifty" for
  "fifteen" is the likely error and speech is the least reliable input the app has.
  `voice-capture.ts` holds the decision logic and is tested without a microphone.
- ☑ **Merchant memory.** What the user filed this merchant under last time beats any keyword table.
  `merchant-memory.ts`, shared by the CSV importer and both capture paths via `categorise.ts`.
- ☑ **Siri App Intents.** "Log an expense in Budget" — `plugins/ios/BudgetAppIntents.swift`,
  injected by `plugins/withAppIntents.js`. Declared in the **main app target**, not an extension:
  an extension would need an App Group to share a file with the app, and an App Group needs the
  capability provisioned against the App ID. Staying in the app target costs no provisioning at all.
  The intent cannot reach the database — Siri background-launches the app with no React Native in
  the process — so it appends to a queue that `pending-drain.ts` drains on the next foreground.
  Verified end to end on the simulator: three queued captures inserted with categories resolved
  from their notes, a torn final line dropped, and a replay of already-drained ids inserting nothing.
- ☑ **Notification quick-add.** The evening streak nudge carries a text field, so "12.50 coffee"
  logs from the lock screen. `quick-add.ts` holds the parsing (14 tests); `quick-add-notify.ts`
  holds the plumbing (7 tests).
  **Partly unverified:** the OS half — iOS drawing the action button and delivering the response —
  was not exercised, because the streak reminder only schedules for an authenticated session and
  logging in was not something to do on the user's behalf. The JS either side of that boundary is
  tested; the boundary itself needs one run on a signed-in device.

Still open from the four speed-ups chosen:

- **Share-sheet capture** — send a receipt or a payment confirmation to Budget from any app.
- **Localised Siri phrases** — the phrases in `BudgetAppIntents.swift` are English only. The app is
  translated; Siri phrases are matched from the binary's metadata and need a String Catalog per
  language.
- **expo-av → expo-audio** — `voice-api.ts` documents this debt. Worth doing before the next SDK
  bump forces it.
