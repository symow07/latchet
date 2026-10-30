# Latchet — Project Audit & Completion Plan

_18 August 2026 · branch `feature/complete-core-features` @ `6f0260e`_

**Coverage:** the entire backend (4,934 LOC, every file) and the entire mobile business-logic
layer (`src/lib/**`, `_layout.tsx`, `db.ts`, `cloud-sync.ts`, onboarding, verify-otp — ~7,000 LOC).
The 26 UI screens were mapped structurally (routing, every API call site, every cross-module import)
rather than read line-by-line; findings that depend on screen internals are marked **[screen-level,
unverified]**.

---

## 1. What this project actually is

A two-part monorepo, formerly built on the Vibecode platform, since fully ejected.

| Part | Stack | LOC |
|---|---|---|
| `backend/` | Bun + Hono + Prisma 5 + SQLite, Better Auth (email+password & email OTP) | 4,934 |
| `mobile/` | Expo 53 / RN 0.79.6, expo-router, NativeWind, TanStack Query, expo-sqlite | 20,681 |

Deployed: backend on Railway (`latchet-production.up.railway.app`), mobile via EAS
(`com.latchet.app`, Expo project `97dd0e8e…`, owner `symow`). Remote: `symow07/latchet` (private).

### The architecture in one paragraph

The mobile app is **local-first**: it owns an on-device SQLite database (`src/lib/db.ts`) and does
all the interesting computation client-side — health score, behaviour detection, subscription
detection, analytics, gamification. The backend is a **secrets tier + intended sync tier**: it owns
auth and holds the three API keys that must never ship in a bundle (OpenAI, Plaid, Google). Two
in-process cron loops materialise recurring transactions and fire bill-due pushes. That's the
design. Section 4.1 is about the fact that half of it isn't wired up.

### Feature inventory

**Personal (5 tabs + 15 stack screens):** dashboard, add transaction, transactions list, AI advisor,
settings · accounts, analytics, health score, net worth, bill reminders, recurring, category budgets,
subscriptions, subscription detail, receipt scan, CSV/Alipay/WeChat import, link bank, email inbox,
onboarding, account type.

**Business (6 tabs):** dashboard, expenses (submit/approve/reject), team (invite codes, roles),
subscriptions, insights, settings · plus payroll and a business-tools screen.

**Backend (17 route modules):** transactions · accounts · settings · bill-reminders · recurring ·
net-worth · category-budgets · business · expenses · business/budget · payroll · ai · achievements ·
push-tokens · plaid · email · sample (dead demo route). Each mounted twice, at `/api/v1/*` and `/api/*`.

---

## 2. Repository & release state

| Finding | Severity |
|---|---|
| **HEAD is 4 commits ahead of `origin/main`, on an unmerged feature branch.** `origin/main` = `273047e`; local `feature/complete-core-features` = `6f0260e`. Railway builds `main`. **Production runs code that predates the currency fixes, the Plus Jakarta Sans redesign, the Alipay/WeChat/Moroccan-bank import, and custom categories.** Local `main` is also 4 behind origin. | 🔴 |
| `mobile/package.json` is still named `"template-app-53"`. | 🟢 |
| `mobile/tsconfig.json` declares `"extends"` **twice** (duplicate JSON key — the second wins). | 🟢 |
| `backend/CLAUDE.md` is stale scaffold text: "No database is configured by default", with a `src/routes/todos.ts` example. Actively misleads any future agent session. | 🟡 |
| `backend/src/routes/sample.ts` — a "Hello from the backend!" demo route, still mounted in production. | 🟡 |
| `src/lib/state/example-state.ts` — template leftover, unreferenced. | 🟢 |

---

## 3. 🔴 The README describes a different product

`README.md`, first three paragraphs:

> "…all running locally on your device."
> "**No cloud sync, no credentials sharing, no data leaving your device — ever.**"
> "100% offline-first with SQLite local storage"
> "**No backend required, no data syncing, no accounts on external servers**"

None of that holds. The app has a Railway backend, mandatory account signup, Plaid bank linking,
forwarded-email ingestion, and OpenAI calls. `PRIVACY.md` — written later — describes the real
system and **directly contradicts the README**. The README also documents a `src/lib/auth.ts` that
no longer exists and a structure missing ~20 screens, and claims the app "seeds 14 days of realistic
demo transactions on first launch" — `seedDemoData()` is dead code, never called, and migration
`v2_clear_seed` exists specifically to delete seeded data.

**Why this is a shipping blocker, not a docs chore:** your App Store Connect privacy declarations
must say you collect financial data, contact info and email content. Your public repo says data
never leaves the device. If a reviewer sees both, that's a Guideline 5.1.1 metadata rejection.

---

## 4. Mobile findings

### 4.1 🔴🔴 The flagship bug: cloud sync only pulls, and the pull corrupts data

Three facts, each verifiable in isolation, that compound into the worst problem in the codebase.

**(a) `pushLocalDataToCloud()` is never called.** It's defined in `src/lib/cloud-sync.ts:22` and
exported. A repo-wide search for its name, and for every write to `/api/transactions/sync`,
`/api/accounts/sync`, and `/api/settings`, finds **only that dead function**. Nothing invokes it.

> Every transaction, account and setting the user enters by hand lives **only** in on-device
> SQLite. It is never uploaded. Delete the app, lose the phone, get a new device → **everything is
> gone, permanently.** The app requires an account and shows a "sync" story; there is no backup.

**(b) The pull path discards server ids, so it duplicates on every login.**
`pullCloudDataToLocal()` is called once per login, from `verify-otp.tsx:44`. For accounts it does:

```ts
if (!localAccountIds.has(acc.id)) { await createAccount({ name: acc.name, … }) }
```

`createAccount()` (`db.ts:241`) generates its **own** id — `acc_${Date.now()}_${random}` — and
throws `acc.id` away. So the cloud id is never present locally, `localAccountIds.has(acc.id)` is
false again next time, and the account is created again. Same for `addTransaction()` (`db.ts:325`)
with `tx.id`. **Every login re-creates every server-side row.**

**(c) Each duplicate also moves the balance.** `addTransaction()` calls `updateAccountBalance()` as
a side effect. So the duplication doesn't just add rows — it **debits the account again**. Balances
drift further from reality on every single login, permanently and silently.

**Is (b)+(c) live today?** Yes, for the rows that *do* exist server-side: transactions created by
the backend's recurring processor, transactions posted by `recurring.tsx:879`, and everything Plaid
syncs. Those duplicate and re-debit on each login. It is masked for hand-entered data only because
of bug (a) — the cloud is empty for those. **Fixing (a) without fixing (b) turns a silent data-loss
bug into an active data-corruption bug on every user's account.** They must be fixed together.

Commit `116eeb4` ("cloud pull sync silently broken — transactions response is paginated") fixed the
pagination of this same function; the id problem underneath it was not visible at the time.

### 4.2 🔴 Four separate subscription detectors, three of them live

| Implementation | Used by | Algorithm |
|---|---|---|
| `subscription-detection.ts` → `scanAndSaveSubscriptions` | `subscriptions.tsx` | merchant-normalise → amount-cluster → interval → confidence, persists to SQLite |
| `behavior-detection.ts` → `detectSubscriptions` | `business-tools.tsx` | key = `roundedAmount_firstWordOfNote`, in-memory only |
| `business-subscription-detection.ts` → `detectSubscriptions` | `(business-tabs)/index.tsx` | third variant |
| `email.ts` → `extractSubscriptions` (OpenAI) | backend `/api/email/scan` | LLM extraction |

Same feature, four answers, guaranteed to disagree on screen. This is the single largest
consolidation opportunity in the app.

**Bugs inside the primary detector (`subscription-detection.ts`):**

- **Line 120 — `const raw = tx.note || tx.category`.** When a transaction has no note it groups by
  *category*, so every "Food" expense becomes one merchant. The app will confidently report
  *"Food — monthly, $45"* as a subscription. Dominant false-positive source.
- **Line 206 — occurrences duplicate on every scan.** `addSubscriptionOccurrence` builds a fresh
  random id then does `INSERT OR IGNORE`. The conflict target is the primary key, which is always
  new, so nothing is ever ignored. Occurrence history grows without bound each scan.
- **Line 186 — `subId` embeds `Math.round(typicalAmount)`.** A price change mints a *new*
  subscription row instead of updating the existing one. Netflix raises prices → two Netflixes.
- **Line 233 — `getUpcomingCharges` off-by-one.** `new Date('2026-08-18')` parses as UTC midnight
  = 08:00 in Hangzhou; compared against local `now`, a charge due *today* disappears from the list
  after 08:00 local. Affects you personally at UTC+8.

### 4.3 🔴 Import silently corrupts European dates and amounts

`import-parser.ts` — the module commit `1687020` extended for Moroccan/French statements.

- **`parseAmount` (line 298) truncates European decimals.** For `"1.234,56"`: the thousands-comma
  regex `/,(?=\d{3}\b)/` doesn't match (comma is followed by `56`), then `/,(\d{1,2})$/` rewrites it
  to `"1.234.56"`, and `parseFloat` stops at the second dot → **1.234**. A €1,234.56 charge imports
  as €1.23.
- **`parseDate` (line 340) misreads DD/MM/YYYY.** The `MM/DD/YYYY` branch matches first, so French
  and Moroccan statements dated `01/09/2026` (1 September) import as **9 January**. Where the day
  is >12 it falls through to `new Date(cleaned)`, which is also US-first. Silent, systematic.
- **Single-amount-column statements import every expense as Income** (line 166): `amount >= 0 →
  'Income'`. Correct only for banks that sign expenses negative; many export positive amounts with
  a separate type column.
- The export→import round-trip claimed in `export-data.ts`'s header comment doesn't hold: `parseCSV`
  ignores the `Category` column the exporter writes, so categories are re-guessed by keyword and
  `isImpulse` is lost entirely.

### 4.4 🟠 Numbers shown to users that are wrong

- **`ai-analysis.ts:266` — projections explode on the 1st of the month.**
  `monthlyNetSavings = income − (currentMonthExpenses / dayOfMonth × 30)`. On day 1, one $200 coffee
  run extrapolates to $6,000/month of expenses. The 6-month and 1-year balance projections go
  wildly negative, and this number is *also* injected into the AI advisor's prompt, so the advisor
  confidently discusses a fabricated crisis.
- **`calculations.ts:90` — average daily spend always divides by 30.** A user two days in with $60
  logged is told they average $2/day, so `calculateSurvivalDays` reports they can last ~2 years.
- **`health-score.ts` disagrees with `calculations.ts` about what "this month" means.**
  `calculations.ts` compares `YYYY-MM-DD` strings (correct). `health-score.ts` does
  `new Date(tx.dateISO).getMonth()` — UTC parse, local getter — in five separate functions
  (`calculateSavingsRateScore`, `calculateBudgetDisciplineScore`, `calculateGoalProgressScore`,
  `calculateImpulseControlScore`, `calculateTrend`). Transactions on month boundaries land in the
  wrong month. `calculateSpendingConsistencyScore:144` compares a UTC date string against
  locally-derived `dateISO`, off by one for everyone east of UTC after 16:00 local.
- **`projectedMonthEndBalance` ignores future income entirely** — systematically pessimistic.
- **`currencies.ts` ships exchange rates from roughly early 2024.** The file's own comment says
  "in production, fetch from an API". TRY at 32, ARS at 875, NGN at 1550, RUB at 92.5, BTC implying
  ~$41.7k. `convertCurrency()` does real money math with these. In a finance app this is both a
  correctness bug and a credibility problem behind the README's "80+ Currencies" headline.
- `calculateLoggingStreak` is O(365 × n) — `Array.some()` inside a 365-iteration loop — and runs on
  render. Noticeable once a user has a few thousand transactions.

### 4.5 🟠 Features that look real but aren't wired to anything

- **`bank-linking.ts:116 SUPPORTED_BANKS`** — 8 hardcoded US banks with emoji logos, labelled
  `// Mock supported banks`. It is rendered by `link-bank.tsx:342` and used at `:563`. A fake bank
  picker in front of a real Plaid integration. **[screen-level, unverified]** whether picking one
  affects the Plaid flow or is purely decorative — either way it shouldn't ship as-is.
- **`getSyncSettings()`** exposes `autoSync`, `syncFrequency`, `notifyOnNewTransactions`,
  `largeTransactionThreshold`. Nothing reads them; there is no auto-sync scheduler anywhere.
- **`getConsentInfo()`** returns hardcoded consent text including "Transaction history (last 90
  days)" regardless of what Plaid actually granted. `checkConnectionHealth()` derives consent expiry
  as `updatedAt + 90d`, but `updatedAt` refreshes on every sync — so consent **never** expires and
  the "expiring soon" state is unreachable.
- **`revenuecatClient.ts`** — 328 lines, fully documented, **zero call sites**. Plus
  `react-native-purchases` and `react-native-purchases-ui` in dependencies. Dead weight in the bundle.
- **`seedDemoData()`** — dead, but still advertised in the README.
- **`patchDefaultFont()` (`design.ts:112`) probably no-ops.** It sets `Text.defaultProps`, which
  React 19 removed for function components; RN 0.79's `Text` is a forwardRef function component. If
  so, the "premium Plus Jakarta Sans" from commit `cdfba58` only applies where a `fontFamily` is set
  explicitly. **Worth a 5-minute check on device — it's cosmetic but it's the whole point of that commit.**
- **Push notification taps go nowhere.** The backend sends `data: {type:'bill-reminder', billId}`,
  but no `addNotificationResponseReceivedListener` exists. Tapping a bill reminder just opens the app.

### 4.6 🟠 Offline-first is only half true

`bill-reminders`, `recurring`, `net-worth`, and `category-budgets` have **no local SQLite table** —
they read and write the backend directly. Those four screens are blank without a network. They are
also, not coincidentally, four of the five backend routes with no request validation (§5.2 R2).

Related: the biometric lock (`_layout.tsx:383`) is evaluated **only on cold start**. There's no
`AppState` listener, so backgrounding and resuming the app skips it. The README's "Face ID / Touch ID
on every app open" is not what the code does.

### 4.7 🟠 Contract mismatch waiting to fire

`onboarding.tsx:51` writes `primaryGoal` ∈ `save | track | reduce_debt | budget`.
`backend/src/routes/settings.ts:17` accepts `track | save | invest | debt`.

`reduce_debt` and `budget` — two of the four options users can pick — would be **rejected with a 400**
the moment settings are pushed. It's invisible today only because of §4.1(a). Fix the enum before
wiring push sync, or the first user to tap "Reduce Debt" silently loses all settings sync.

### 4.8 🟢 What's good on the mobile side

- **Startup is genuinely well-engineered.** `_layout.tsx` has a timeout on DB init, a hard 8s splash
  backstop, a bounded biometric check, a real error screen with Retry, and a "Continue offline"
  escape hatch — with a comment explaining exactly why there is no auto-timeout (it would race the
  session retry). That's the output of someone who actually debugged a hung launch.
- **`api.ts`** has typed error classes (`TimeoutError` / `NetworkError` / `ApiError`), a 15s
  AbortController timeout, and structured logging. Better than most production RN clients.
- **The design system** (`design.ts`) is coherent — two full palettes (personal purple, business
  navy), shared radii, a glow helper. The business/personal split is a real product idea, executed.
- **`cancel-directory.ts`** (25+ services with cancellation steps) is a genuinely differentiating
  feature and the kind of thing competitors don't bother with.
- Zero `TODO`/`FIXME`/`@ts-ignore` in 20,681 lines. Rare.
- Chinese bill import (`parseChineseBill`) correctly handles the metadata preamble, Chinese column
  names, and the 收/支 flag — a thoughtful piece of localisation.

---

## 5. Backend findings

### 5.1 🔴 Security

**S1. The Plaid webhook has no signature verification.** `routes/plaid.ts:69`. Plaid signs every
webhook with a JWT in the `Plaid-Verification` header, verifiable via
`/webhook_verification_key/get`. Without it anyone can POST
`{item_id, webhook_code:"SYNC_UPDATES_AVAILABLE"}` to force unbounded `/transactions/sync` runs
against your Plaid quota and your single SQLite writer — cost amplification and DoS in one. Must be
fixed before `PLAID_ENV=production`.

**S2. Open redirect leaking the user's email.** `routes/email.ts:201` takes `returnUrl` from the
query string and `:123` redirects to `${returnUrl}?status=success&email=<email>` with no scheme
allowlist. `/api/email/auth-url?returnUrl=https://attacker.example` hands the user's email address
to an attacker-controlled host after a successful consent.

**S3. Sign-up has no rate limit at all.** `index.ts:107-113` exempts `/api/auth/sign-up/email`
(and `/api/auth/sign-in/email`) from `generalAuthRateLimiter` — a temporary measure from the
signup-hang investigation, never reverted. `loginRateLimiter` still covers sign-in via the
`/api/auth/sign-in/*` mount, so the real exposure is **sign-up**: unlimited account creation, and
since sign-up sends an OTP, unlimited outbound Resend mail on your bill and your domain reputation.

**S4. Per-identifier rate limiting is dead code.** `auth.ts:39` reads the identifier only from
`?email=` or an `x-rate-limit-identifier` header; the mobile client sends neither. Every
`identifierMax` and identifier-lockout path is unreachable — only per-IP limits are live, which on
mobile CGNAT is simultaneously too loose for an attacker and too tight for real users. The body-free
design is correct (see the excellent comment at `auth.ts:25-38`); the client just needs to send the header.
*Resolved on `fix/session-rate-limit`, differently:* the header and the identifier paths are gone, and
the address limiters are address-only. Limits per account run inside Better Auth's hooks, which see
the parsed body (`backend/src/lib/account-limits.ts`): 10 wrong passwords in 15 minutes pause sign-in
for that address for 15 minutes (a good sign-in or a password reset clears it), and sign-up allows 3
attempts an hour and 10 a day per email.

**S5. `BETTER_AUTH_SECRET` has no minimum length.** `env.ts:8` accepts any non-empty string — and
`lib/crypto.ts:10` derives the **AES-256-GCM key protecting every Plaid access token and Gmail
refresh token** from it via a bare SHA-256. A one-character secret boots happily.

**S6. Timing-unsafe secret comparison.** `routes/email.ts:136` compares the inbound-webhook shared
secret with `!==`. Use `crypto.timingSafeEqual`.

**S7. PBKDF2 at 100k iterations, below current guidance.** `auth.ts:171`. The comment claims OWASP
compliance; OWASP's current figure for PBKDF2-HMAC-SHA256 is 600,000. The original reason for the
low count (Railway shared CPU vs. request timeouts) is real, so this is a genuine trade-off — but it
should be raised as far as the box allows and the comment corrected.

**S8. Unbounded request bodies.** No body-size limit anywhere. Three amplifiers:
`ai.ts:84` accepts `image: z.string().min(1)` with **no max** (a 50 MB base64 blob is buffered and
forwarded to OpenAI); `transactions.ts:110` `/sync` has **no array-length cap** and does a
`findUnique` **per row in a serial loop** before one `$transaction` — 10,000 rows is 10,000
sequential queries against the single SQLite connection, blocking every other request;
`accounts.ts:87` is identical.

**S9. In-memory OAuth state maps never expire.** `plaid.ts:58` and `email.ts:49`. Entries are
deleted only on success, so every abandoned bank link leaks one forever. A Railway redeploy between
"user opens Plaid Link" and "webhook arrives" silently drops the link with no user-visible error.

### 5.2 🔴 Correctness

**C1. Non-recurring bill reminders push every 5 minutes, forever.**
`jobs/bill-reminder-checker.ts:28-49` selects `{isPaid:false, nextDueDate:{lte:today}}`. For
`isRecurring:true` it advances the date, so it fires once. For `isRecurring:false` **nothing is
mutated** — the row matches again on the next tick and every tick after. One unpaid one-off bill =
**288 push notifications a day**. This alone would sink the App Store rating. Needs a `lastNotifiedAt`
column and a skip.

**C2. `PUT /api/settings` wipes fields you didn't send.** Every field in `settings.ts:7-18` is
`.optional().default(…)`, so Zod *fills in* the defaults for omitted keys and the handler passes the
whole object to `upsert({ update: body })`. A partial update of `{currency:"MAD"}` zeroes
`monthlyBudget`, `startingBalance`, `monthlyIncome`, `savingsGoal`, `hourlyValue`. Currently masked
because the only caller sends the full object — a landmine for the next caller.

**C3. `recurring-processor` skips short months.** `jobs/recurring-processor.ts:16-18` uses
`d.setUTCMonth(d.getUTCMonth() + 1)`; 31 January → 3 March, not 28 February. This is *precisely* the
bug that was found and fixed in `bill-reminder-checker.ts:advanceMonth`, whose comment explains it —
the fix was never applied to the sibling file. Monthly recurrences dated the 29th–31st skip months.

**C4. Plaid transactions are orphaned from accounts.** `plaid.ts:317-330` creates `Transaction` rows
with **no `accountId`**, so bank-synced transactions never touch a `BankAccount` balance and can't
be filtered by account. `PlaidAccount` and `BankAccount` are two disconnected mirrors of the same thing.

**C5. Plaid sync ignores `removed` and `modified`.** `plaid.ts:313` iterates `page.added` only.
Pending→posted amount changes and cancelled transactions are never reflected, so balances drift
permanently. The `while (hasMore)` loop is also unbounded.

**C6. An owner can add any user to their business.** `routes/business.ts:204-225` accepts an
arbitrary `userId` with no invitation, consent, or existence check. Because membership resolves via
**`findFirst`** (`lib/get-user-business.ts:6`, `routes/expenses.ts:23`), a victim who doesn't own a
business is silently resolved *into the attacker's business* — their business-mode screens then read
and write someone else's payroll and expenses. **[screen-level, unverified]** whether the UI calls
this endpoint; it is mounted and reachable either way.

**C7. `findFirst` membership resolution is wrong for anyone in >1 business** — same root cause.
Membership needs to be an explicit "current business" selection.

**C8. `GET /api/payroll` writes to the database** (`payroll.ts:63` upserts payment rows), and
`month`/`year` come from `Number(c.req.query(...))` with no validation — `?month=abc` reaches the
upsert as `NaN`.

### 5.3 🟠 Robustness

**R1. There is no global error handler.** No `app.onError`, no `app.notFound`. Every Prisma
`P2025 Record not found` on a wrong-id `PUT`/`DELETE`, every `P2002`, every crash in an unvalidated
route escapes as an opaque `500`. No request id, no error shape, and the client can't tell "not
found" from "server is broken".

**R2. Five route modules have zero request validation** — `recurring.ts`, `bill-reminders.ts`,
`net-worth.ts`, `category-budgets.ts`, and `accounts.ts` PUT all splat `await c.req.json()` straight
into Prisma. `net-worth.ts:36` computes `body.assets - body.liabilities` → stores `NaN` when either
is missing. The other twelve modules use `zValidator` properly; this is drift, not design.

**R3. No timeouts on outbound calls.** `email-otp.ts` correctly wraps its fetches in a 5s timeout.
Nothing else does — `ai.ts:openaiChat`, both OpenAI calls in `email.ts`, every `plaid()` call,
`gmail.ts`, `expo-push.ts`. A hung upstream holds a request (and its SQLite connection) indefinitely.

**R4. `/health` doesn't touch the database** (`index.ts:143`), so Railway's healthcheck passes even
when Prisma can't reach the volume — exactly the failure that matters after a bad deploy.

**R5. Expo push isn't batched** — `expo-push.ts:39` posts all of a user's tokens in one request;
Expo's documented limit is 100 messages per request.

**R6. The AI advisor breaks after a long conversation.** `buildAIPrompt` concatenates the entire
history with no trimming; `ai.ts:61` caps the prompt at `z.string().max(20000)`. Past that, every
message 400s. There's also no `system` role — the whole prompt goes in as `user`, so the GUIDELINES
block is trivially overridable, and a user can use your OpenAI key as a general chatbot (capped at
200/day).

### 5.4 🟠 Deployment

**D1. SQLite on Railway must have a volume attached, and this needs verifying, not assuming.**
`DEPLOYMENT.md` documents it correctly (`DATABASE_URL=file:/data/prod.db`) — but without it every
deploy silently erases all user data. `connection_limit=1` means the whole backend writes one
request at a time. Fine for launch; plan the Postgres migration rather than discovering it.

**D2. Everything stateful is in-process** — rate limiters, usage caps, both OAuth state maps, both
cron jobs. The backend **cannot run more than one instance** without double-fired recurring
transactions, double pushes, reset limits, and broken OAuth returns. Documented in `DEPLOYMENT.md §4`;
deserves a hard guard rail.

**D3. Model choice is stale.** `ai.ts` pins `gpt-4o-mini` and `gpt-4o` (vision). Both are old by
August 2026; newer models are cheaper and materially better at exactly this task shape (structured
JSON extraction from receipts).

### 5.5 🟠 Privacy policy vs. code

`PRIVACY.md` states in bold: *"We extract only the merchant name, amount, currency, billing cycle,
and date — the raw email body is discarded and never stored."*

The body is indeed discarded. But `InboxEmail` (`schema.prisma:284`) also persists **`fromAddr`** and
**`subject`** for every forwarded email, indefinitely (`email.ts:173`). Subject lines routinely carry
amounts, order numbers and personal context. The stored set is larger than the policy claims.

Also unaddressed: **retention**. Nothing is ever deleted — `InboxEmail`, `NetWorthEntry`, and revoked
`EmailConnection` rows accumulate forever — and "Account deletion: contact support" is a manual
process with no implemented endpoint (see §6).

### 5.6 🟢 What's good on the backend

- **The AI proxy is architecturally right** — keys server-side, per-user tiered spend caps, graceful
  503 when unconfigured instead of a boot crash. Plenty of shipped apps still leak the key in the bundle.
- **Secrets at rest are done properly** — AES-256-GCM, random IV per record, auth tag, 29 clean lines, tested.
- **The signup-hang investigation was done well and written down.** The comments at `auth.ts:25-38`
  (Bun body-clone deadlock) and `prisma.ts:4-7` (`connection_limit=1`) are institutional memory that
  usually evaporates.
- **`advanceMonth` is correct**, with a comment explaining the trap it avoids, and a test.
- Ownership checks are consistent in the sync endpoints (skip foreign rows rather than fail the batch).
- **`DEPLOYMENT.md` and `EJECT.md` are unusually honest** — they name the manual steps, the
  third-party approvals with long lead times, and the single-instance constraints instead of
  pretending the system is more finished than it is.
- Pure logic is factored into dependency-free, unit-tested modules (`plaid-mappers`, `inbound-email`,
  `crypto`, `usage-limit`).

---

## 6. App Store readiness

| Item | State |
|---|---|
| Bundle ID `com.latchet.app`, EAS project linked, 3 build profiles | ✅ |
| iOS permission strings (camera, photos, Face ID, media library) via config plugins | ✅ |
| `ITSAppUsesNonExemptEncryption: false` | ✅ |
| **App icon & splash screen** | 🔴 **No `assets/` directory exists anywhere in the repo; `app.json` declares no `icon` or `splash`.** You would ship the Expo placeholder. Hard blocker. |
| Privacy policy at a public URL | 🔴 `PRIVACY.md` exists only in the repo |
| Support email | 🔴 Literal placeholder: `<support email — fill in before publishing>` |
| **In-app account deletion** | 🔴 Required since 2022 for any app with account creation. Not implemented — policy says "contact support". Guaranteed rejection. |
| README vs. privacy declarations | 🔴 See §3 |
| Android permissions | 🟡 Declares `RECORD_AUDIO` and `READ/WRITE_EXTERNAL_STORAGE`, all apparently unused — Play will ask why |
| RevenueCat SDK linked but unused | 🟡 Remove, or ship products |
| `newArchEnabled: false`, Expo SDK 53 | 🟡 Check Apple's current minimum-SDK deadline before submitting |
| Plaid production access | 🔑 Application takes days–weeks. **Apply now** — it's the longest pole. |

---

## 7. The plan

Ordered so that nothing later invalidates something earlier. Rough sizing assumes you're driving and
I'm doing the work.

### Phase 0 — Stop the bleeding (half a day)

1. **Merge `feature/complete-core-features` → `main` and push.** Everything else is theoretical
   until production runs current code.
2. **Fix C1** (the 5-minute push loop). One migration + one condition. Highest harm-per-line-of-fix
   in the repo.
3. **Fix §4.1 (a)+(b)+(c) together.** Preserve server ids on pull (`createAccountWithId` /
   `addTransactionWithId`, no balance side effect on sync-insert), then wire `pushLocalDataToCloud`
   into a real sync trigger. Fix the `primaryGoal` enum (§4.7) in the same change or push sync 400s.
4. **Fix S3** (sign-up rate limit) and **S1** (Plaid webhook verification).

### Phase 1 — Correctness (2–3 days)

5. Import parser: European decimals, DD/MM dates, expense/income sign (§4.3).
6. Health-score timezone unification — one date helper, string comparison everywhere (§4.4).
7. Projection maths: guard the day-1 extrapolation, use elapsed days not a fixed 30 (§4.4).
8. `recurring-processor` month overflow — reuse `advanceMonth` (C3).
9. Plaid: attach `accountId`, handle `removed`/`modified`, bound the sync loop (C4, C5).
10. Live exchange rates with a cached fallback (§4.4).

### Phase 2 — Hardening (2 days)

11. `app.onError` + `app.notFound` + a typed error shape (R1).
12. Zod on the five unvalidated routes; array caps and body limits on the sync endpoints (R2, S8).
13. Timeouts on every outbound fetch (R3); `/health` hits the DB (R4).
14. S2, S5, S6, S7, S9, C6, C7, C8.
15. Business-membership model: explicit current-business selection instead of `findFirst`.

### Phase 3 — Ship (2–3 days + external lead time)

16. **App icon and splash** — the actual blocker. Needs a designed mark, not a placeholder.
17. **In-app account deletion** — `DELETE /api/me` cascading everything, plus a settings entry.
18. Host `PRIVACY.md`, fill in the support email, reconcile it with what `InboxEmail` stores (§5.5).
19. **Rewrite the README** to describe the real architecture (§3).
20. Verify the Railway volume (D1). Strip `sample.ts`, `example-state.ts`, RevenueCat, `seedDemoData`,
    `SUPPORTED_BANKS`, the dead sync settings, and the stale `backend/CLAUDE.md`.
21. App Store Connect metadata, screenshots, privacy declarations. **Apply for Plaid production now.**

### Phase 4 — The improvements you asked for

**Consolidation first, because it unlocks the rest:** collapse the four subscription detectors into
one engine with pluggable sources (transaction / email / Plaid). That's the precondition for any of
the AI work below being coherent.

**Smarter AI** — my picks, in impact order:

- **Move the advisor to a real chat API shape.** System role, tool-calls the client answers from
  local SQLite, streaming responses, and a rolling summary instead of unbounded history (fixes R6
  and makes the advisor feel instant instead of a 6-second wall of text).
- **Make the advisor able to *act*.** "Set my Food budget to 400" should create the category budget,
  not describe how to. This is the difference between a chatbot and a feature.
- **Replace keyword auto-categorisation with a proper classifier**, and let it learn from
  corrections — the current `CATEGORY_KEYWORDS` list is US-brand-centric and useless for a Moroccan
  or Chinese statement, which is exactly the market you just built import support for.
- **Weekly proactive digest push** — "you're 12% over pace on Food, and Spotify renews Thursday."
  The data is already computed; nothing surfaces it unprompted.
- Upgrade both models (D3) and benchmark receipt extraction accuracy before/after.

**UX / visual** — the design system is good; the gaps are structural:

- Empty, loading and error states as first-class components. Right now a new user meets a set of
  zeroes and a "C" grade.
- Onboarding should end in a *win* — import a statement or add one transaction — not a settings dump.
- Charts: `victory-native` and Skia are already dependencies. The dashboard doesn't use them.
- Replace the `Alert.alert` calls (8 screens) with in-app toasts; `burnt` is already installed.
- Accessibility pass — the palette leans on low-contrast `textFaint` over dark plum in several places.

**My own additions, if you want them:** shared/household budgets (the team model already exists);
a rules engine ("anything from Carrefour → Food") which is cheaper and more predictable than AI for
80% of categorisation; and a widget/Live Activity for today's remaining budget, which is the single
highest-retention feature a budgeting app can ship.

---

## 8. Open questions for you

1. **Icon and brand** — do you have a mark, or should that be part of Phase 3?
2. **Plaid** — US-only today (`country_codes: ["US"]`), but your import work targets Morocco, France
   and China. Is Plaid actually the right rail, or is the CSV/Alipay/WeChat import the real product
   and Plaid a US-market bet for later?
3. **Business mode** — ship it in v1, or cut it from the first release and halve the surface area
   you have to get right?
4. **RevenueCat** — monetising at launch, or remove it?
