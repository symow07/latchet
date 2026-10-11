# Budget — Technical Map

_11 October 2026 · read from code and config only — none of the project's other documents were
used as a source. Every claim cites `file:line`, relative to the repo root. Nothing was changed
except to add this file._

---

## Summary

**What it is.** A React Native app (Expo SDK 53) and a small TypeScript server. The server runs
on **Bun** with the **Hono** web framework, hosted on **Railway**.

**The database is not Postgres.** It is **SQLite** — one file on the server, managed
with Prisma — plus a **second, separate SQLite database on every phone**. Each phone keeps its
own copy of transactions, accounts and settings, and copies them up to the server.

**What lives where.**
- On the phone: transactions, accounts, settings, subscriptions, custom categories and the
  advisor's health profile.
- Only on the server: business mode, household sharing, bill reminders, recurring transactions,
  net worth, category budgets, payroll, linked banks and the email inbox. Those screens are
  blank without a connection.

**Almost all the "smart" parts are plain code running on the phone.** Categorisation, the health
score, spending alerts, insights, subscription detection, streaks and projections are hand-written
rules. The AI (OpenAI, called only from the server) does five jobs: phrasing the advisor's
answers, and reading a receipt photo, a PDF statement, a voice recording, or a forwarded billing
email. The advisor is sent summaries — totals, category sums, the score — not the list of
transactions.

**Sign-in** is email and password, with 7-day sessions kept in the phone's secure storage. On the
server every request is checked and scoped to the signed-in user. **On the phone there is no
per-user separation**: the local database is shared, and signing out does not clear it.

**Four things matter most for a re-architecture:**
1. **Sync only goes up.** The download half exists but is only called from a screen nothing opens,
   so a reinstall or a second phone starts empty.
2. **There are two transaction stores that never reconcile.** Three paths create transactions on
   the server only — recurring "run now", the recurring job, bank sync — and none of them ever
   appear in the app.
3. **One SQLite file, one connection** carries every user's writes, and the rate limits and AI
   caps live in server memory.
4. **84 of the 135 mobile dependencies are never referenced**, many of them leftovers from a
   project template.

§9 lists these and the other structural findings in one place.

---

## 1. Stack and architecture

### 1.1 Languages

| Where | Language | Evidence |
|---|---|---|
| Mobile app | TypeScript (TSX) | `mobile/package.json:172` — `typescript ~5.8.3` |
| Backend | TypeScript | `backend/package.json:18` — `typescript 5.8.3` |
| iOS extensions | Swift | `mobile/plugins/ios/BudgetAppIntents.swift`, `mobile/plugins/ios/ShareExtension/` |
| Schema | Prisma SDL | `backend/prisma/schema.prisma` |
| Local DB | SQL (SQLite dialect), inline | `mobile/src/lib/db.ts:48-156` |

### 1.2 Mobile — frameworks and the libraries actually used

| Library | Version | Role | Evidence |
|---|---|---|---|
| Expo SDK | 53.0.22 | App runtime and build tooling | `mobile/package.json:51` |
| React Native | 0.79.6 | UI runtime, **old architecture** (`newArchEnabled: false`) | `mobile/package.json:115`, `mobile/app.json` |
| React | 19.0.0 | | `mobile/package.json:113` |
| expo-router | ~5.1.8 | File-based navigation (`mobile/src/app/`) | `mobile/package.json:93` |
| @tanstack/react-query | 5.90.2 | Server-state cache | `mobile/package.json:46` |
| zustand | ^5.0.9 | Small local stores (theme, locale, account type) | `mobile/package.json:150` |
| expo-sqlite | ~15.2.9 | **On-device database** | `mobile/package.json:101` |
| @react-native-async-storage | 2.1.2 | Preferences and caches | `mobile/package.json:28` |
| expo-secure-store | ^14.0.1 | Session cookie | `mobile/package.json:95` |
| better-auth + @better-auth/expo | ^1 | Auth client | `mobile/package.json:17,47` |
| react-native-purchases (+ -ui) | ^9.6.7 | RevenueCat in-app purchases and paywall | `mobile/package.json:132-133` |
| react-native-reanimated | 3.17.4 | Animation | `mobile/package.json:134` |
| react-native-gesture-handler | ~2.24.0 | Gestures | `mobile/package.json:120` |
| react-native-svg | 15.12.1 | Icons and charts (drawn as SVG) | `mobile/package.json:138` |
| expo-blur, expo-linear-gradient | ~14.1.4 | Glass tab bar, gradients | `mobile/package.json:58,79` |
| expo-notifications | ~0.31.1 | Push and local notifications | `mobile/package.json:91` |
| expo-local-authentication | ^55.0.8 | Face ID / fingerprint lock | `mobile/package.json:82` |
| expo-audio | ~0.4.9 | Voice capture | `mobile/package.json:54` |
| expo-camera, expo-image-picker | ~16.1 | Receipt capture | `mobile/package.json:61,76` |
| expo-document-picker, expo-file-system | ~13.1 / ~18.1 | Statement import, files | `mobile/package.json:70-71` |
| expo-web-browser | ~14.1.6 | Opens Plaid Hosted Link | `mobile/package.json:107` |
| i18n-js + expo-localization | ^4.5.3 / ~16.1 | Four languages | `mobile/package.json:108,83` |
| date-fns | ^4.1.0 | Dates | `mobile/package.json:50` |
| nativewind + tailwindcss | ~4.1 / ^3.4 | Legacy styling — 3 files still use `className` | `mobile/package.json:110,145` |

Tests run on Bun's test runner (`mobile/package.json:12`), not Jest, though Jest is still declared
(`mobile/package.json:168`).

### 1.3 Backend

| Library | Version | Role | Evidence |
|---|---|---|---|
| Bun | 1.3.12 locally; **not pinned** for production | Runtime, HTTP server, test runner | `backend/package.json:7-13`; no version file in `backend/` |
| Hono | 4.6.0 | Web framework | `backend/package.json:26` |
| @hono/zod-validator + zod | ^0.7.6 / 4.1.11 | Request validation | `backend/package.json:23,27` |
| Prisma (+ client) | 5 | ORM and migrations | `backend/package.json:17,24` |
| better-auth | ^1.5.0 (1.5.0 installed) | Auth server | `backend/package.json:25` |
| @hono/node-server | 1.12.0 | Declared; **not used** — the server is Bun-native | `backend/package.json:22`, `backend/src/index.ts:248` |

There are **no SDKs** for OpenAI, Plaid, Resend, RevenueCat or Google: every external call is a
raw `fetch` (§8).

### 1.4 Dependency hygiene

Of **135** mobile dependencies, **51** are referenced anywhere in the source, plugins or config;
**84 are never named**. A few of those are pulled in implicitly — `expo-constants`, `expo-linking`,
`expo-font`, `expo-asset`, `react-native-screens`, `@react-navigation/native-stack` and
`@expo/metro-runtime` serve Expo or the router, `patch-package` runs on install, and
`react-dom`/`react-native-web` serve the web target — so "unreferenced" is not "removable" for
all of them. Most of the rest are template leftovers with no possible use: `react-native-maps`,
`react-native-vision-camera`, `lottie-react-native`, `react-native-gifted-chat`,
`react-native-mmkv`, `react-native-calendars`, `@shopify/react-native-skia`, `victory-native`,
`expo-contacts`, `expo-location`, `expo-sensors`, `expo-video`, `zeego`, `burnt`. Notably, `zod`
is declared but the app validates nothing with it — validation happens only on the server.

### 1.5 How it connects

```
 ┌──────────────────────────── PHONE (iOS / Android) ────────────────────────────┐
 │                                                                                │
 │   Screens (expo-router)          On-device data                               │
 │   ─────────────────────          ──────────────                               │
 │   Personal tabs     ──reads──▶   SQLite  real_budget.db  (8 tables)            │
 │   Business tabs                  AsyncStorage  (prefs, caches)                 │
 │   Settings, etc.                 SecureStore   (session cookie)                │
 │        │                         Files         (receipts, share-sheet inbox)   │
 │        │                                ▲                                      │
 │        │ on-device logic: categories,   │ Siri intent queue / Share extension  │
 │        │ health score, alerts, insights,│ (App Group)                          │
 │        │ subscriptions, streaks         │                                      │
 │        ▼                                                                       │
 │   api.ts  — every call carries the session cookie by hand                      │
 │        │                       RevenueCat SDK ───────────────▶ RevenueCat      │
 └────────┼───────────────────────────────────────────────────────────────────────┘
          │ HTTPS  /api/... and /api/v1/...
          ▼
 ┌──────────────────────── RAILWAY: one Bun process ─────────────────────────────┐
 │  Hono app   CORS → logger → legacy-alias rewrite → error map → session → route │
 │  Better Auth  /api/auth/*                                                      │
 │  22 routers, 94 endpoints        3 in-process jobs (recurring, bills, purge)   │
 │        │                                                                       │
 │        ▼                                                                       │
 │  Prisma ──▶ SQLite file on a Railway volume  (+ receipts/ next to it)          │
 └────┬──────────┬──────────┬──────────┬──────────┬──────────┬────────────────────┘
      ▼          ▼          ▼          ▼          ▼          ▼
   OpenAI      Plaid     Resend /   RevenueCat   Expo      open.er-api.com
  (chat,     (bank      SMTP relay  (REST +      push      (exchange rates)
  vision,    sync)      (email out)  webhook)    service
  whisper)                                                  + inbound email webhook
                                                              (Cloudflare/SendGrid/Mailgun)
```

---

## 2. Backend

### 2.1 Server and runtime

A custom server: one Hono app, exported as Bun's native server —
`export default { port, fetch: app.fetch }` (`backend/src/index.ts:246-251`). Port from `PORT`,
default 3000.

### 2.2 Hosting

**Railway.** `backend/railway.json:4` starts it with `bun run start:prod`, which runs
`bunx prisma migrate deploy && bun run src/index.ts` (`backend/package.json:10`). Health check
`/health` with a 30 s timeout (`backend/railway.json:7-8`); it runs a real `SELECT 1`
(`backend/src/index.ts:179-187`). The SQLite file sits on a Railway volume
(`backend/src/lib/receipt-store.ts:11-14`). Restart policy: on failure, 5 retries
(`backend/railway.json:5-6`). Nothing in the repo sets the replica count.

### 2.3 Request pipeline

In order (`backend/src/index.ts`):

1. **CORS** — localhost always, plus `CORS_ORIGINS` (`:48-68`). The app itself sends no
   `Origin`, so this governs web clients only.
2. **Logger** (`:70`).
3. **Legacy-alias rewrite** — re-serialises every JSON response to add old field names
   (`teamMembers`, `businessId`) for app builds still in the wild (`:77-90`). It runs on
   every response.
4. **Error handlers** — request ids, Prisma and Zod error mapping, JSON 404 (`:94`).
5. **Session lookup** — `auth.api.getSession` on every non-auth request, 10 s timeout; puts
   `user`/`session` on the context (`:100-133`).
6. **Auth rate limits and the Better Auth handler** on `/api/auth/*` (`:143-174`).
7. **Routes** — each of the 22 routers is mounted twice, at `/api/v1/<name>` and `/api/<name>`
   (`:196-239`). `/api/debug` is mounted only outside production (`:191-193`).

### 2.4 Background jobs

All three run in-process on timers, started at boot (`backend/src/index.ts:242-244`):

| Job | Every | Does | Evidence |
|---|---|---|---|
| Recurring processor | 60 s | Creates a `Transaction` row for each due `RecurringTransaction`, then advances `nextDate` | `backend/src/jobs/recurring-processor.ts:7-30,61` |
| Bill-reminder checker | 5 min | Finds due unpaid bills and sends a push notification | `backend/src/jobs/bill-reminder-checker.ts:57,131` |
| Retention | 24 h | Deletes old `InboxEmail` rows, expired `Session` and `Verification` rows | `backend/src/jobs/retention.ts:50-68,107` |

### 2.5 Every API route

Each path below is also served without `/v1`. Every router except `rates` and the two webhooks
rejects anonymous requests with 401 (§5.4).

**Better Auth** — `/api/auth/*`, handled by the library (`backend/src/index.ts:148`): sign-up,
sign-in, sign-out, session and the email-OTP endpoints. **Health** — `GET /health`
(`backend/src/index.ts:179`).

**`/api/v1/me`** — the current user (`backend/src/routes/me.ts`)

| | Path | Does | Line |
|---|---|---|---|
| GET | `/me` | The user and their tier (`free`/`pro`), decided server-side | `:36` |
| POST | `/me/entitlement/refresh` | Re-reads the tier from RevenueCat right after a purchase | `:57` |
| GET | `/me/deletion-preview` | Shows what deleting the account would remove | `:101` |
| DELETE | `/me` | Deletes the account. Irreversible. | `:205` |

**`/api/v1/transactions`** (`backend/src/routes/transactions.ts`)

| | Path | Does | Line |
|---|---|---|---|
| GET | `/transactions` | The user's transactions, paginated (`limit`, `offset`) | `:38` |
| POST | `/transactions` | Create one | `:58` |
| PUT | `/transactions/:id` | Update one | `:80` |
| DELETE | `/transactions/:id` | Delete one | `:101` |
| POST | `/transactions/sync` | Bulk upsert from the phone; skips rows owned by someone else | `:109` |

**`/api/v1/accounts`** (`backend/src/routes/accounts.ts`)

| | Path | Does | Line |
|---|---|---|---|
| GET | `/accounts` | List | `:33` |
| POST | `/accounts` | Create | `:42` |
| PUT | `/accounts/:id` | Update | `:61` |
| DELETE | `/accounts/:id` | Delete | `:81` |
| POST | `/accounts/sync` | Bulk upsert from the phone, same ownership check | `:88` |
| PUT | `/accounts/:id/share` | Share an account in full with a household, or un-share | `:174` |

**`/api/v1/settings`** (`backend/src/routes/settings.ts`) — `GET` `:46`, `PUT` `:54`: the user's
budget, income, goal, currency and locale.

**`/api/v1/bill-reminders`** (`backend/src/routes/bill-reminders.ts`) — `GET` `:29`,
`POST` `:40`, `PUT /:id` `:61`, `DELETE /:id` `:88`.

**`/api/v1/recurring`** (`backend/src/routes/recurring.ts`) — `GET` `:39`, `POST` `:50`,
`PUT /:id` `:75`, `DELETE /:id` `:98`. The rows themselves are generated by the job in §2.4.

**`/api/v1/net-worth`** (`backend/src/routes/net-worth.ts`) — `GET` `:24` (snapshot history),
`POST` `:36` (record a snapshot).

**`/api/v1/category-budgets`** (`backend/src/routes/category-budgets.ts`) — `GET` `:21`,
`POST` `:31` (upsert one category's limit), `DELETE /:id` `:53`.

**`/api/v1/achievements`** (`backend/src/routes/achievements.ts`)

| | Path | Does | Line |
|---|---|---|---|
| GET | `/achievements` | Badges earned and best streak | `:39` |
| POST | `/achievements/sync` | The phone reports badges it computed; new ones are stored with their first-earned date | `:56` |

**`/api/v1/push-tokens`** (`backend/src/routes/push-tokens.ts`) — `POST` `:30` registers this
device's Expo push token, `DELETE` `:43` removes it.

**`/api/v1/rates`** (`backend/src/routes/rates.ts`) — `GET` `:73`: exchange rates, proxied from
`EXCHANGE_RATES_URL` and cached for 24 h in memory (`:27-46`). **Public** — no session needed.

**`/api/v1/ai`** (`backend/src/routes/ai.ts`) — §6 covers these in detail.

| | Path | Does | Line |
|---|---|---|---|
| POST | `/ai/chat` | Advisor reply | `:112` |
| POST | `/ai/analyze-receipt` | Receipt photo → amount, category, merchant | `:143` |
| POST | `/ai/analyze-statement` | Statement PDF → transaction rows | `:207` |
| POST | `/ai/voice-transactions` | Audio → transcript → transaction rows | `:294` |

**`/api/v1/business`** (`backend/src/routes/business.ts`)

| | Path | Does | Line |
|---|---|---|---|
| POST | `/business` | Create a business | `:51` |
| GET | `/business` | The business the user is currently acting in | `:80` |
| PATCH | `/business` | Edit profile and tax fields (owner) | `:105` |
| DELETE | `/business` | Delete it — requires the name retyped in the body | `:144` |
| PUT · DELETE · GET | `/business/logo` | Upload, remove, serve the logo | `:189`, `:225`, `:241` |
| GET | `/business/invite-code` | Get (or create) the invite code — owner | `:267` |
| POST | `/business/invite-code/refresh` | Rotate it | `:287` |
| POST | `/business/join` | Join with a code | `:314` |
| GET | `/business/members` | Members with user details | `:357` |
| PUT | `/business/active` | Choose which business to act in | `:391` |
| PATCH | `/business/team/:memberId` | Change a member's role | `:422` |
| DELETE | `/business/team/:memberId` | Remove a member | `:451` |

**`/api/v1/business/budget`** (`backend/src/routes/budget.ts`) — `GET` `:32` returns the budget
plus this month's spending by category; `PUT` `:96` sets it (owner or manager).

**`/api/v1/expenses`** (`backend/src/routes/expenses.ts`)

| | Path | Does | Line |
|---|---|---|---|
| POST | `/expenses` | Submit (any member), with an optional receipt image | `:36` |
| GET | `/expenses` | List the business's expenses, `?status=` filter | `:157` |
| GET | `/expenses/:id/receipt` | Serve a receipt image, membership-checked | `:120` |
| PATCH | `/expenses/:id/approve` | Approve (owner/manager) | `:191` |
| PATCH | `/expenses/:id/reject` | Reject (owner/manager) | `:220` |

**`/api/v1/payroll`** (`backend/src/routes/payroll.ts`)

| | Path | Does | Line |
|---|---|---|---|
| GET | `/payroll` | Salaries and paid/unpaid status for a month | `:48` |
| POST | `/payroll` | Set a member's salary (owner/manager) | `:114` |
| DELETE | `/payroll/:id` | Remove a salary | `:158` |
| PATCH | `/payroll/:id/pay` · `/unpay` | Mark a month paid or unpaid | `:183`, `:224` |

**`/api/v1/household`** (`backend/src/routes/household.ts`)

| | Path | Does | Line |
|---|---|---|---|
| POST | `/household` | Create one | `:59` |
| GET | `/household` | The user's household and members | `:90` |
| GET | `/household/preview` | Before joining: exactly what will be shared | `:119` |
| POST | `/household/join` | Join with a code | `:154` |
| PATCH | `/household/my-share-level` | Change what I reveal (`summary`/`categories`/`full`) | `:211` |
| GET | `/household/visibility` | Who can see what of whom | `:278` |
| GET | `/household/dashboard` | Combined month, each member at their own share level | `:312` |
| GET | `/household/invite-code` · POST `/refresh` | Get or rotate the code | `:380`, `:397` |
| DELETE | `/household/leave` | Leave | `:418` |
| DELETE | `/household` | Delete it (owner) | `:442` |

**`/api/v1/plaid`** (`backend/src/routes/plaid.ts`)

| | Path | Does | Line |
|---|---|---|---|
| POST | `/plaid/webhook` | Plaid events, signature-verified; **no session** | `:57` |
| POST | `/plaid/link-token` | Start Hosted Link | `:135` |
| POST | `/plaid/exchange` | Exchange a public token for a stored access token | `:159` |
| GET | `/plaid/accounts` | Linked accounts | `:170` |
| PATCH | `/plaid/accounts/:id` | Turn syncing on or off for an account | `:183` |
| POST | `/plaid/transactions/sync` | Pull new bank transactions into the server's ledger | `:200` |
| DELETE | `/plaid/items/:id` | Unlink a bank | `:220` |

**`/api/v1/email`** (`backend/src/routes/email.ts`)

| | Path | Does | Line |
|---|---|---|---|
| POST | `/email/inbound` | Forwarded billing emails from the inbound provider; shared-secret auth, **no session** | `:147` |
| GET | `/email/inbox-address` | The user's private forwarding address | `:270` |
| GET | `/email/inbox` | Parsed forwarded emails | `:297` |
| POST | `/email/inbox/imported` | Mark items imported | `:308` |
| GET | `/email/status` | Connection status | `:242` |
| GET | `/email/auth-url` · `/callback` | Gmail OAuth start and callback | `:220`, `:72` |
| POST | `/email/scan` | Scan Gmail with the model | `:321` |
| DELETE | `/email/disconnect` | Revoke Gmail | `:360` |

The four Gmail routes have no caller in the app (`mobile/src/lib/emailSubscriptionApi.ts` exports
them; nothing imports them).

**`/api/v1/revenuecat`** (`backend/src/routes/revenuecat.ts`) — `POST /webhook` `:25`: purchase
and expiry events, authenticated by the shared secret, **no session**.

**`/api/debug`** — `GET /signup-prereq` (`backend/src/routes/debug.ts:41`). Never mounted in
production unless `DEBUG_ROUTES=true` (`backend/src/index.ts:191`).

**Totals:** 94 endpoints in 22 routers, plus `/health` and Better Auth's own routes.

---

## 3. Database and data layer

### 3.1 On the server: one SQLite database

- **Engine:** SQLite — `provider = "sqlite"` (`backend/prisma/schema.prisma:5-8`). Not Postgres,
  not hosted.
- **How many:** one. `DATABASE_URL` is a file path, defaulting to `file:./prisma/dev.db`
  (`backend/src/env.ts:7`).
- **Connection:** forced to **one connection** (`connection_limit=1`), WAL journal, foreign keys
  on, 3 s busy timeout (`backend/src/prisma.ts:8-25`). Every user's reads and writes go through
  that one connection.
- **Migrations:** 16, from `20240101000000_init` to `20260828000000_group_generalisation`
  (`backend/prisma/migrations/`).
- **Files:** receipt images and company logos are stored on disk in a `receipts/` folder next to
  the database file, not inside it (`backend/src/lib/receipt-store.ts:76-81`).

### 3.2 On the phone: a second, separate SQLite database

- `expo-sqlite`, one file `real_budget.db` (`mobile/src/lib/db.ts:4,46`).
- 8 tables (§4.3). Schema created in code, with hand-written migrations tracked in a
  `migrations` table (`mobile/src/lib/db.ts:204`).
- **No user column.** Whoever is signed in sees what is in the file.

### 3.3 Other on-device storage

| Store | Holds | Evidence |
|---|---|---|
| **SecureStore** | The Better Auth session cookie, prefix `realbudget` — the only thing kept here | `mobile/src/lib/auth/auth-client.ts:25-29` |
| **AsyncStorage** | `@biometric_lock` — lock on/off | `mobile/src/app/(tabs)/settings.tsx:95` |
| | `@account_type_<userId>` — personal or business | `mobile/src/lib/account-type-store.ts:6` |
| | `theme.preference` | `mobile/src/lib/theme-store.ts:24` |
| | `@locale_chosen_v1` | `mobile/src/lib/i18n/bootstrap.ts:16` |
| | `@real_budget_onboarding` | `mobile/src/lib/onboarding-storage.ts:5` |
| | `@exchange_rates_v1` — rates cache | `mobile/src/lib/rates.ts:15` |
| | `@import_profiles_v1` — remembered CSV column mappings | `mobile/src/lib/import-profiles.ts:19` |
| | `linked_banks`, `linked_accounts` | `mobile/src/lib/bank-linking.ts:121-122` |
| | `pending_capture_seen_v1`, `pending_share_seen_v1` — de-duplication for Siri and share captures | `mobile/src/lib/pending-drain.ts:22`, `mobile/src/lib/share-drain.ts:23` |
| **Files** | Siri's capture queue, in the app's documents folder | `mobile/src/lib/pending-drain.ts:31` |
| | Shared images, moved from the App Group into the app's own folder | `mobile/src/lib/share-drain.ts:49-57` |
| **App Group** | Written by the iOS share extension, read by the app | `mobile/src/lib/share-drain.ts:7,14` |
| **MMKV** | Declared, never used | `mobile/package.json:130` |

Merchant memory has **no store of its own**: it is rebuilt in memory from the local transaction
history whenever it's needed (`mobile/src/lib/merchant-memory.ts:106`).

### 3.4 How data moves between phone and server

**Upload (push)** — `mobile/src/lib/cloud-sync.ts:60-99`. Sends exactly three things: all local
transactions and accounts, in batches of 500 (`:50,75-82`), and the settings row (`:87`). The
health profile is excluded by construction (`mobile/src/lib/sync-redaction.ts`). It fires 5 s
after any local write (`:199,206-214`), and 1 s after the app returns to the foreground
(`:226-228`). Started once the database opens (`mobile/src/app/_layout.tsx:541`).

**Download (pull)** — `pullCloudDataToLocal` (`mobile/src/lib/cloud-sync.ts:126`) fetches
accounts, settings and every transaction 100 at a time (`:102-112`). **Its only caller is
`mobile/src/app/verify-otp.tsx:64`, and no screen navigates to `verify-otp`.** Neither
`login.tsx` nor `signup.tsx` pulls. In practice the sync is upload-only: data goes up and never
comes back, so a reinstall or a new phone starts empty.

**Never synced:** subscriptions, custom categories (only their names travel, on transactions),
the health profile (deliberately), import profiles and every AsyncStorage preference.

**Server-only writes that never reach the phone.** Every transaction list in the app reads local
SQLite (`mobile/src/lib/db.ts:598`). Three paths create transactions on the server only:

| Path | Evidence |
|---|---|
| Recurring "run now" — posts to the server, then refreshes a list that reads local data | `mobile/src/app/recurring.tsx:369-374` |
| The recurring job | `backend/src/jobs/recurring-processor.ts:22-30` |
| Bank sync — the server books Plaid transactions | `mobile/src/lib/bank-linking.ts:233-236` |

With the pull dormant, none of those rows ever appear in the app. They do count on the server —
in household dashboards, for instance.

### 3.5 Feature by feature: local or server-only

| Feature | Lives in | Works offline? | Evidence |
|---|---|---|---|
| Transactions | Phone, uploaded to server | Yes | `mobile/src/lib/db.ts:49,598` |
| Accounts | Phone, uploaded | Yes | `mobile/src/lib/db.ts:77,427` |
| Settings (budget, income, goal, currency, locale) | Phone, uploaded | Yes | `mobile/src/lib/db.ts:62,734` |
| Subscriptions | Phone only | Yes | `mobile/src/lib/db.ts:94,841` |
| Custom categories | Phone only | Yes | `mobile/src/lib/db.ts:124,932` |
| Advisor health profile | Phone only, never uploaded | Yes | `mobile/src/lib/db.ts:131-155` |
| Health score, alerts, insights, streaks, badges | Computed on the phone | Yes | §7 |
| Badges earned (persisted) | Server (`Achievement`) | Display yes; recording needs network | `backend/src/routes/achievements.ts:56` |
| Bill reminders | Server only | **No** | `mobile/src/app/bill-reminders.tsx` (API calls only) |
| Recurring transactions | Server only | **No** | `mobile/src/app/recurring.tsx` |
| Net worth | Server only | **No** | `mobile/src/app/net-worth.tsx` |
| Category budgets | Server only | **No** | `mobile/src/app/category-budgets.tsx` |
| Business — expenses, team, budget, payroll, profile | Server only | **No** | `mobile/src/lib/businessApi.ts`, `expenseApi.ts`, `budgetApi.ts`, `salaryApi.ts` |
| Household | Server only | **No** | `mobile/src/lib/householdApi.ts` |
| Linked banks | Server (`PlaidItem`, `PlaidAccount`) | **No** | `backend/prisma/schema.prisma:257-291` |
| Email inbox | Server (`InboxEmail`), pulled into local subscriptions | **No** | `backend/prisma/schema.prisma:328-346` |
| AI features | Server, then OpenAI | **No** | §6 |
| Exchange rates | Server, cached on the phone | Yes, from cache | `mobile/src/lib/rates.ts:15,43` |

---

## 4. Data structures

### 4.1 Server schema — all 23 models

From `backend/prisma/schema.prisma`. `?` means nullable. Every model's `id` is a string primary
key.

**Users and auth**

| Model | Columns | Line |
|---|---|---|
| `User` | `id`, `name`, `email` (unique), `emailVerified` bool, `image?`, `entitlement` (`free`/`pro`, default free), `entitlementExpiresAt?`, `revenueCatUserId?`, timestamps | `:10` |
| `Session` | `id`, `expiresAt`, `token` (unique), `ipAddress?`, `userAgent?`, `userId` → User (cascade), timestamps | `:47` |
| `Account` (table `AuthAccount`) | Better Auth credentials: `accountId`, `providerId`, `userId` → User, `accessToken?`, `refreshToken?`, `idToken?`, expiries, `scope?`, `password?` (hash) | `:59` |
| `Verification` | `identifier`, `value`, `expiresAt` — OTP codes | `:78` |

**Personal finance**

| Model | Columns | Line |
|---|---|---|
| `BankAccount` | `userId` → User, `name`, `type` (cash/checking/savings/credit/investment/other), `balance` float, `currency`, `color`, `icon`, `isDefault`, `sharedWithGroupId?` → Group (set null) | `:87` |
| `Transaction` | `userId` → User, `accountId?` → BankAccount (set null), `amount` float, `category` string, `type` (Expense/Income), `isImpulse` bool, `note?`, `dateISO` (YYYY-MM-DD string), `currency`. Index `(userId, dateISO)` | `:110` |
| `UserSettings` | `userId` (unique) → User, `monthlyBudget`, `startingBalance`, `hourlyValue`, `showTimeCost`, `currency`, `currencySymbol`, `monthlyIncome`, `savingsGoal`, `spendingStyle`, `primaryGoal`, `locale`, `activeGroupId?` | `:129` |
| `BillReminder` | `userId`, `name`, `amount`, `dueDay` (1–31), `category`, `isRecurring`, `isPaid`, `paidAt?`, `nextDueDate` (string), `lastNotifiedAt?` | `:154` |
| `RecurringTransaction` | `userId`, `accountId?` (no relation), `name`, `amount`, `category`, `type`, `isImpulse`, `frequency` (daily/weekly/biweekly/monthly/yearly), `startDate`, `nextDate`, `lastCreated?`, `isActive`, `currency` | `:177` |
| `NetWorthEntry` | `userId`, `date`, `assets`, `liabilities`, `netWorth`, `breakdown?` (JSON string) | `:200` |
| `CategoryBudget` | `userId`, `category`, `amount`, `period` (default monthly). Unique `(userId, category)` | `:212` |
| `Achievement` | `userId`, `badge`, `earnedAt`, `bestStreak`. Unique `(userId, badge)` | `:228` |
| `PushToken` | `userId`, `token` (unique), `platform?` | `:241` |

**Bank and email connections**

| Model | Columns | Line |
|---|---|---|
| `PlaidItem` | `userId`, `provider` (default plaid), `itemId` (unique), `accessTokenEnc` (AES-256-GCM), `institutionId?`, `institutionName?`, `cursor?`, `status` | `:257` |
| `PlaidAccount` | `itemId` → PlaidItem (cascade), `plaidAccountId` (unique), `name`, `type`, `mask?`, `balance`, `currency`, `isEnabled`, `bankAccountId?` (no relation) | `:275` |
| `EmailConnection` | `userId`, `provider` (gmail/forwarding), `email`, `refreshTokenEnc?`, `inboundToken?` (unique), `forwardingVerified`, `status`, `lastScanAt?`. Unique `(userId, email)` | `:296` |
| `InboxEmail` | `userId`, `senderDomain?`, `label`, `merchant?`, `amount?`, `currency`, `cadence`, `chargedISO?`, `isSubscription`, `status` (parsed/imported/ignored), `receivedAt` | `:328` |

**Groups — business and household share these tables**

| Model | Columns | Line |
|---|---|---|
| `Group` | `ownerId` → User (cascade), `name`, `type` (`business`/`household`), `logoUrl?`, `address?`, `vatNumber?`, `taxId?`, `fiscalYearStartMonth?` (1–12), `inviteCode?` (unique). Unique `(ownerId, type)` — one of each per owner | `:348` |
| `GroupMember` | `groupId` → Group, `userId` → User (both cascade), `role` (business: owner/manager/employee · household: owner/member), `shareLevel` (summary/categories/full, default summary). Unique `(groupId, userId)` | `:383` |
| `Expense` | `groupId` → Group, `submitterId` → User, `reviewerId?` → User (set null), `amount`, `category` (Travel/Software/Meals/Transport/Office/Other), `description`, `imageUrl?`, `status` (pending/approved/rejected), `submittedAt`, `reviewedAt?` | `:403` |
| `GroupBudget` | `groupId` (unique) → Group, `totalMonthly`, `categories?` (JSON string) | `:425` |
| `Salary` | `groupId` → Group, `userId` → User, `amount` (monthly), `currency`, `title?`. Unique `(groupId, userId)` | `:435` |
| `SalaryPayment` | `salaryId` → Salary (cascade), `month` (1–12), `year`, `status` (paid/unpaid), `paidAt?`, `note?`. Unique `(salaryId, month, year)` | `:452` |

Categories, types, statuses and frequencies are all stored as **free strings** — SQLite in Prisma
has no enums — so their vocabularies are enforced only in application code.

### 4.2 Relationships

```
User ─┬─< Session, Account(auth), PushToken, Achievement
      ├── UserSettings (1:1)
      ├─< BankAccount ─< Transaction        (Transaction.accountId optional)
      ├─< Transaction
      ├─< BillReminder, RecurringTransaction, NetWorthEntry, CategoryBudget
      ├─< PlaidItem ─< PlaidAccount ··· bankAccountId (not a relation)
      ├─< EmailConnection, InboxEmail
      ├─< Group (as owner; at most one business + one household)
      └─< GroupMember >── Group ─┬─< Expense (submitter, reviewer → User)
                                 ├── GroupBudget (1:1)
                                 ├─< Salary ─< SalaryPayment
                                 └─< BankAccount (shared accounts)
```

Deleting a `User` cascades to almost everything they own. Deleting a `Group` cascades to its
members, expenses, budget and salaries, and un-shares its accounts.

### 4.3 Device schema — 8 tables

From `mobile/src/lib/db.ts`:

| Table | Columns | Line |
|---|---|---|
| `transactions` | `id` TEXT PK, `amount` REAL, `category`, `type`, `isImpulse` INTEGER 0/1, `note`, `dateISO`, `createdAt`, `accountId`, `currency` | `:49` |
| `settings` | single row (`id = 1`): `monthlyBudget`, `startingBalance`, `hourlyValue`, `showTimeCost`, `currency`, `currencySymbol`, `monthlyIncome`, `savingsGoal`, `spendingStyle`, `primaryGoal`, `locale` | `:62` |
| `accounts` | `id`, `name`, `type`, `balance`, `openingBalance`, `currency`, `color`, `icon`, `isDefault`, `createdAt` | `:77` |
| `subscriptions` | `id`, `merchantDisplay`, `merchantNormalized`, `cadence`, `typicalAmount`, `currency`, `confidenceScore`, `lastChargedAt`, `nextExpectedAt`, `status`, `cancelUrl`, `cancelNotes`, `source` (transaction/email), timestamps | `:94` |
| `subscription_occurrences` | `id`, `subscriptionId` → subscriptions, `transactionId`, `chargedAt`, `amount` | `:112` |
| `custom_categories` | `name` PK, `icon`, `color`, `createdAt` | `:124` |
| `health_profile` | single row: `householdSize`, `city`, `cookingHabits`, `goals`, `activityInterests`, `dietaryPreferences`, `allergies`, `healthConsiderations`, `standardConsentAt`, `sensitiveConsentAt`, `updatedAt` | `:142` |
| `migrations` | `key` PK | `:204` |

The two schemas diverge in small ways that matter for any merge: the device stores
`isImpulse` as 0/1 and the server as a boolean; the device has `accounts.openingBalance` and
derives `balance` from the ledger (`:212-228`), while the server stores `balance` directly.

### 4.4 App-side types

| Type | Shape | Evidence |
|---|---|---|
| `Transaction` | `id, amount, category, type: string, isImpulse: number, note?, dateISO, createdAt`. **Defined three times, identically** — and all three omit `accountId` and `currency`, which the table has | `mobile/src/lib/calculations.ts:10`, `mobile/src/lib/ai-analysis.ts:9`, `mobile/src/lib/behavior-detection.ts:7` |
| `TransactionInput` | `amount, category, type: 'Expense' \| 'Income', isImpulse: boolean, note?, dateISO, accountId?, currency?, createdAt?` | `mobile/src/lib/db.ts:519` |
| `Account` | as the table; `balance` documented as derived | `mobile/src/lib/db.ts:361` |
| `Settings` | as the table | `mobile/src/lib/db.ts:718` |
| `Subscription`, `SubscriptionOccurrence` | as the tables; `status: confirmed \| possible \| canceled` | `mobile/src/lib/db.ts:815,833` |
| `CustomCategory` | `name, icon, color, createdAt` | `mobile/src/lib/db.ts:925` |
| `HealthScoreResult` | `totalScore, grade (A+…F), gradeColor, breakdown, trend, trendValue, suggestions[], personalityType` | `mobile/src/lib/health-score.ts:46` |
| `HealthScoreBreakdown` | five factors, each `{ score, value, maxPoints }` | `mobile/src/lib/health-score.ts:38` |
| `SpendingPersonality` | `saver \| balanced \| spender \| impulsive \| disciplined \| inconsistent` | `mobile/src/lib/health-score.ts:57` |
| `HomeInsight` | `{ key, params, actions[] }` — a translation key and its values, not text | `mobile/src/lib/home-insight.ts:23` |
| `InsightInput` | `monthSpent, monthlyBudget, weekSpent, lastWeekSpent, impulsePercent, streak, savingsGoal, projectedSavings, …` | `mobile/src/lib/home-insight.ts:32` |
| `BizInsight` | same shape for business | `mobile/src/lib/biz-insight.ts:22` |
| `SpendingAnalysis` | everything the advisor prompt is built from | `mobile/src/lib/ai-analysis.ts:48` |
| Server types the app consumes | `Expense`, `ExpenseCategory` · `BudgetData` · `Business`, `GroupMember` · `PayrollData`, `SalaryRecord` · `Household`, `HouseholdDashboard`, `ShareLevel` | `mobile/src/lib/expenseApi.ts:10-19`, `budgetApi.ts:8-10`, `businessApi.ts:10-41`, `salaryApi.ts:10-46`, `householdApi.ts:21-79` |

### 4.5 Category vocabularies

Three of them, kept separately:

| Used for | Values | Evidence |
|---|---|---|
| Personal built-ins | Food, Gym, Transport, Shopping, Subscriptions, Other — plus any custom ones | `mobile/src/lib/category-meta.ts:26-32` |
| What the AI may answer with | The same six | `backend/src/routes/ai.ts:30`, `backend/src/lib/statement-extract.ts:13` |
| Business expenses | Travel, Software, Meals, Transport, Office, Other | `backend/prisma/schema.prisma:409`, `mobile/src/lib/expenseApi.ts:11` |

---

## 5. Auth and users

### 5.1 Sign-up and sign-in

**Email and password**, through Better Auth.
- **App side:** `authClient.signUp.email({ email, password, … })` (`mobile/src/app/signup.tsx:87`)
  and `authClient.signIn.email({ email, password })` (`mobile/src/app/login.tsx:89`).
- **Server side:** `emailAndPassword.enabled` (`backend/src/auth.ts:293-299`), with **no
  `requireEmailVerification`**.
- **Passwords:** hashed with PBKDF2-SHA256 at 600,000 iterations, verifying older 100,000-iteration
  hashes too (`backend/src/auth.ts:189-203`).
- **Email OTP:** the plugin is loaded, 6 digits, 5-minute expiry (`backend/src/auth.ts:349-352`),
  but the app's only OTP screen is unreachable. Nobody's email address is ever verified.
- **No password reset** exists on either side.
- **Rate limits** on sign-up (burst and daily), sign-in, OTP and auth in general
  (`backend/src/auth.ts:132-172`, wired at `backend/src/index.ts:143-147`). They are held in
  process memory, so a restart clears them.

### 5.2 Sessions

- Better Auth stores sessions in the `Session` table (`backend/prisma/schema.prisma:47`).
- **Lifetime 7 days** — the library's default (`expiresIn: 60*60*24*7` in better-auth 1.5.0),
  since `auth.ts` doesn't configure one.
- **On the phone:** the `expoClient` plugin keeps the session cookie in SecureStore
  (`mobile/src/lib/auth/auth-client.ts:25-29`). Every API call attaches it by hand as a `Cookie`
  header (`mobile/src/lib/api/api.ts:38,60-76`). The code calls this load-bearing: expo's fetch
  doesn't share cookies by itself (`api.ts:57-59`).
- **On the server:** the `bearer()` plugin is enabled too (`backend/src/auth.ts:348`), though the
  app uses the cookie.
- **Trusted origins:** `realbudget://*/*`, `exp://*/*`, localhost and `TRUSTED_ORIGINS`
  (`backend/src/auth.ts:336-345`).

### 5.3 Where user data lives

**On the server:**
- Everything in §4.1, keyed by `userId`.
- **Encrypted:** Plaid access tokens and Gmail refresh tokens, with AES-256-GCM. The key comes from
  `TOKEN_ENCRYPTION_KEY`, or from `BETTER_AUTH_SECRET` if that isn't set (`backend/src/env.ts:34-48`).
- **Not encrypted:** everything else. The SQLite file is plain.

**On the phone:**
- §3.2–3.3.
- The health profile exists *only* there.

### 5.4 Isolation per user

**On the server: enforced in code, route by route.**
- Each router's first middleware returns 401 when there is no session. The line in each file:

| Router | Line | Router | Line |
|---|---|---|---|
| `accounts.ts` | `:29` | `household.ts` | `:42` |
| `achievements.ts` | `:28` | `me.ts` | `:32` |
| `ai.ts` | `:42` | `net-worth.ts` | `:26` |
| `bill-reminders.ts` | `:31` | `payroll.ts` | `:16` |
| `budget.ts` | `:18` | `plaid.ts` | `:73` |
| `business.ts` | `:25` | `push-tokens.ts` | `:21` |
| `category-budgets.ts` | `:23` | `recurring.ts` | `:41` |
| `email.ts` | `:150` | `settings.ts` | `:42` |
| `expenses.ts` | `:24` | `transactions.ts` | `:33` |

- After that, queries filter on `user.id`.
- The bulk-sync endpoints check row ownership before writing, and silently skip rows that belong
  to someone else (`backend/src/routes/transactions.ts:139-153`, `backend/src/routes/accounts.ts`
  `/sync`).
- **The database itself has no row-level security.** Isolation is entirely the application's job.

**Groups (business and household).**
- Membership is resolved by `getUserGroup(userId, type)`, which picks the group the user is
  acting in, preferring `activeGroupId` (`backend/src/lib/get-user-group.ts:37-83`).
- Business roles gate approvals, payroll and budget.
- In a household, each member chooses how much of their own data others see, at `summary`,
  `categories` or `full`. The server enforces this when it builds each response
  (`backend/src/lib/share-level.ts:69-85`), and anything it doesn't recognise is treated as
  `summary` (`:19-22`).

**On the phone: none.**
- One database file with no user column.
- Sign-out runs `resetAccountType()`, `authClient.signOut()` and a session invalidation — and
  **does not touch the local database** (`mobile/src/app/(tabs)/settings.tsx:459-463`).
- `resetAllData()` is called only by delete-account and "reset all activity". Even then it clears
  transactions, accounts and some settings, but **not** subscriptions, custom categories or the
  health profile (`mobile/src/lib/db.ts:793-813`).
- So a second account signed in on the same phone:
  - inherits the first user's ledger;
  - inherits the first user's health profile, which goes into its advisor prompts;
  - has the first user's settings uploaded over its own by the next push.

---

## 6. The AI layer

### 6.1 Every call

All calls go **from the server** to OpenAI by raw `fetch`. The key never reaches the app
(`backend/src/routes/ai.ts:17-22`).

| Feature | Endpoint | Model | What is sent | Evidence |
|---|---|---|---|---|
| Personal advisor | `POST /api/ai/chat` | `gpt-4o-mini`, temp 0.7, 600 tokens | Server safety rules + the app's summary (§6.2) + up to 40 turns of conversation | `backend/src/routes/ai.ts:112-130`; `mobile/src/lib/ai-analysis.ts:561-593` |
| Business advisor | `POST /api/ai/chat` | `gpt-4o-mini` | Rules + company name, team size, budget and spend by category, payroll totals, pending count | `mobile/src/app/(business-tabs)/advisor.tsx:123-128`; `mobile/src/lib/business-advisor.ts:13-85` |
| Receipt scan | `POST /api/ai/analyze-receipt` | `gpt-4o` (vision), temp 0 | **The full receipt photo** (base64, ≤10 MB) | `backend/src/routes/ai.ts:143-184`; `mobile/src/app/receipt-scan.tsx:49` |
| PDF statement import | `POST /api/ai/analyze-statement` | `gpt-4o`, temp 0, 8,000 tokens | **The whole statement PDF** (≤10 MB) | `backend/src/routes/ai.ts:207-259`; `mobile/src/app/import.tsx:203` |
| Voice capture | `POST /api/ai/voice-transactions` | `whisper-1`, then `gpt-4o-mini` | **The audio recording** (≤8 MB), then its transcript | `backend/src/routes/ai.ts:294-346`; `mobile/src/lib/voice-api.ts:80` |
| Forwarded billing email | `POST /api/email/inbound` | `gpt-4o-mini` | One email's sender, subject and body. Only the parsed result is stored | `backend/src/routes/email.ts:40,147-199,471` |
| Gmail scan (no caller) | `POST /api/email/scan` | `gpt-4o-mini` | Sender, subject, date and snippet of many emails, cut to 18,000 characters | `backend/src/routes/email.ts:405-427` |

### 6.2 What goes into the advisor prompt

**Built on the phone** by `buildSystemContext` (`mobile/src/lib/ai-analysis.ts:406`), from
`analyzeSpending` (`:79`). Mostly summaries and settings (`ai-analysis.ts:454-495`):
- monthly budget, income, savings goal, spending style, primary goal, hourly rate;
- the health score with all five factors, the trend and the personality label;
- budget used, average daily spend, savings rate, impulse share, week-over-week change;
- spend by category, which categories are over or under last month;
- 6- and 12-month projections, and budget suggestions.

**One exception:** the month's single biggest expense goes in with its **free-text note** — usually
a merchant name (`:500`).

**Health profile:** appended by `buildProfileContext` (`mobile/src/lib/health-profile-prompt.ts:36`).
- Always: household size, city, cooking habits, goals, activity interests, dietary preferences.
- Allergies and health considerations: only once the separate sensitive consent has been recorded
  (`:67-70`).

**No list of transactions is sent.**

### 6.3 Guardrails and limits

**Safety rules.**
- `ADVISOR_SAFETY_RULES` (`backend/src/lib/advisor-safety.ts:28`) are prepended **on the server**
  to whatever the app supplies (`composeSystemPrompt` `:49`, `buildChatMessages` `:78`).
- So no version of the app can leave them out.

**Limits.** The tier is read from the database, never from the request (`backend/src/routes/ai.ts:47-50`).

| Tier | Allowance | When it runs out | Evidence |
|---|---|---|---|
| Free | 5 AI calls a day | HTTP 402 — the paywall | `backend/src/lib/entitlement.ts:27`, `ai.ts:56-64` |
| Pro | Up to 20 per 5 minutes, 200 a day | HTTP 429 | `entitlement.ts:28-30` |

Usage is counted in server memory (`backend/src/lib/usage-limit.ts`), so a restart resets
everyone's count.

**Model outputs** are treated as untrusted:
- the receipt category falls back to "Other" (`ai.ts:172-174`);
- statement and voice rows without a real date and amount are dropped
  (`backend/src/lib/statement-extract.ts`, `backend/src/lib/voice-extract.ts`);
- voice and receipt results are shown for review before anything is saved (`ai.ts:289-292`).

### 6.4 What is real logic and what depends on the AI

| Real logic — deterministic code | Depends on the AI |
|---|---|
| Categorisation of manual entries, imports, Siri and notification captures | Category on a scanned receipt, a PDF statement row, a voice row |
| Health score, grade, personality, suggestions | The advisor's wording |
| Behaviour detection and alerts | Turning a receipt photo into an amount and merchant |
| Home and business insights | Reading a PDF statement |
| Subscription detection from transactions | Transcribing and structuring speech |
| Streaks, badges, projections, time cost | Deciding whether a forwarded email is a subscription |
| CSV import, including European number formats | |
| Household share-level filtering, entitlements | |
| Quick insights on the advisor screen (`getQuickInsights`, no API call — `mobile/src/lib/ai-analysis.ts:596`) | |

Everything in the left column keeps working with no OpenAI key. Everything in the right column
returns 503 without one (`backend/src/routes/ai.ts:43-45`).

---

## 7. Analysis logic — where and how

**Almost all of it runs on the phone, over the local SQLite ledger.** None of it is in the
database itself — no SQL views, triggers or stored procedures — and only the items under
"computed on the server" below run on the backend.

### Categorisation — on the phone

There is one ladder, `categoriseNote` (`mobile/src/lib/categorise.ts:33-38`). It tries, in order:

1. **Merchant memory** — what this user filed the same merchant under before. The longest prefix
   wins, and a history that contradicts itself suggests nothing
   (`mobile/src/lib/merchant-memory.ts:106,160`).
2. **A fixed keyword table** — `CATEGORY_KEYWORDS` (`mobile/src/lib/import-parser.ts:17`), used by
   `autoCategorize` (`:77`). It's built around US brands; the file's own header says it fails for
   the markets the app targets (`merchant-memory.ts:4-9`).
3. **"Other".**

Siri and notification captures use this ladder (`categorise.ts:1-9`). AI paths choose from the six
built-in categories instead (§6.1). Bank transactions are mapped on the server
(`backend/src/lib/plaid-mappers.ts`).

### Health score — on the phone

`calculateHealthScore` (`mobile/src/lib/health-score.ts:351`) adds up five scores into a total out
of 100:

| Factor | Max | How it's scored | Lines |
|---|---|---|---|
| Savings rate | 25 | This month's (income − expenses) ÷ income. 30% or more scores 25; 20% scores 20; 10% scores 15; 5% scores 10 | `:66-93` |
| Budget discipline | 25 | Budget used so far against how far through the month it is. 10+ points under pace scores 25; on pace 22; up to 10 over 18; under budget 12; over budget falls toward 0. No budget set: 12 | `:95-122` |
| Spending consistency | 20 | How much daily spend swings over 30 days (std dev ÷ mean). Under 50% scores 20, then 16, 12, 8, 4. No data: 10 | `:124-163` |
| Goal progress | 15 | This month's savings ÷ savings goal. 100% scores 15, 75% 12, 50% 9, 25% 6. No goal: 8 | `:165-195` |
| Impulse control | 15 | Share of recent transactions flagged impulse | `:197-221` |

- **Grades:** A+ at 90, A at 80, B+ 70, B 60, C+ 50, C 40, D 30, else F (`:281-289`).
- **Personality:** from the factor scores, e.g. "saver" when savings rate and discipline both
  score 20+ (`:256-278`).
- **Suggestions:** written by rules (`:293`).
- **No AI anywhere in it.**

### Behaviour detection and alerts — on the phone

Six functions in `mobile/src/lib/behavior-detection.ts`:

| Detector | Rule | Line |
|---|---|---|
| Subscriptions | Delegates to the subscription engine | `:38-51` |
| Duplicate charges | Expenses on the same day, for the same amount to the cent, with similar descriptions | `:63-90` |
| Unusual transactions | More than 2 standard deviations above that category's mean | `:119-149` |
| Weekend vs weekday | Spending patterns, weekend = Saturday and Sunday | `:191-203` |
| Waste categories | Fixed amount thresholds, e.g. Transport over 200 | `:282-316` |
| Summary | Combines the above | `:372` |

### Insights — on the phone

**Home** — `pickHomeInsight` (`mobile/src/lib/home-insight.ts:57`) runs a fixed priority order
and returns the first that applies: over budget, close to budget, ahead of pace, impulse share,
saving, streak, steady (`:76-135`). It returns a translation key, not text.

**Business** — `pickBizInsight` (`mobile/src/lib/biz-insight.ts:42`), in order: pending approvals,
over budget, tool spend, steady (`:48-64`).

### Subscriptions — on the phone, plus forwarded email on the server

**One engine**, `detectSubscriptions` (`mobile/src/lib/subscriptions/engine.ts:160`). It is pure
code:
- strips noise from merchant names (`:16-38`);
- detects the cadence from the gaps between charges (`:77`);
- predicts the next charge (`:93`);
- scores its confidence — at least 2 occurrences, confirmed at 60 (`:131,157-158`).

**Sources:**
- `mobile/src/lib/subscriptions/sources.ts` turns personal transactions (`:48`) and business
  expenses (`:68`) into the engine's input.
- Forwarded billing emails take a separate route. The server parses each email and stores the
  result (§6.1). The inbox screen then calls `importInboxSubscriptions`
  (`mobile/src/app/email-inbox.tsx:83`), which writes them into the local `subscriptions` table
  with `source: 'email'` via `saveEmailSubscriptions` (`mobile/src/lib/emailSubscriptionApi.ts:100-167`).

### Streaks, badges, projections — on the phone

All in `mobile/src/lib/calculations.ts`:

| Function | Line |
|---|---|
| Logging streak | `:263` |
| Unlocked badges | `:287` |
| Balance | `:84` |
| Month projection | `:178` |
| Survival days | `:201` |
| Discipline grade | `:222` |
| Time cost | `:380` |

Badges are computed on the phone and then reported to the server, which keeps the first-earned date
(`backend/src/routes/achievements.ts:56`).

### Computed on the server

| What | Evidence |
|---|---|
| Business budget vs this month's spend by category | `backend/src/routes/budget.ts:32` |
| The household dashboard — combined totals, each member projected to their own share level | `backend/src/routes/household.ts:312`, `backend/src/lib/share-level.ts:69` |
| Payroll status for a month | `backend/src/routes/payroll.ts:48` |
| Recurring-transaction generation | `backend/src/jobs/recurring-processor.ts` |
| Due-bill detection | `backend/src/jobs/bill-reminder-checker.ts` |
| Pro or free — the entitlement decision | `backend/src/lib/entitlement.ts`, `backend/src/lib/user-entitlement.ts` |

---

## 8. External services

| Service | Used for | Called from | Keys and config | If unset |
|---|---|---|---|---|
| **OpenAI** | Advisor, receipt, statement, voice, email parsing | Server only, raw `fetch` — `backend/src/routes/ai.ts:24-28`, `backend/src/routes/email.ts:39-40` | `OPENAI_API_KEY` (`backend/src/env.ts:33`) | AI routes 503 |
| **Plaid** | Bank linking and transaction sync (sandbox, development or production host) | Server — `backend/src/lib/bank-providers/plaid.ts:27-29`; app opens Hosted Link via `WebBrowser.openAuthSessionAsync` (`mobile/src/app/link-bank.tsx:133`) | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_COUNTRY_CODES` (`env.ts:58-65`) | Plaid routes 503 |
| **RevenueCat** | Pro subscription | **App:** SDK and hosted paywall (`mobile/src/lib/revenuecatClient.ts`, `mobile/src/lib/useEntitlement.ts:53`). **Server:** webhook (`backend/src/routes/revenuecat.ts:25`) and subscriber lookup (`backend/src/lib/user-entitlement.ts:86`) | App: `EXPO_PUBLIC_REVENUECAT_TEST_KEY`, `_APPLE_KEY`, `_GOOGLE_KEY`. Server: `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_API_KEY` (`env.ts:54-55`) | Everyone stays on the free tier |
| **Resend** | Sending OTP email | Server — `backend/src/lib/email-otp.ts:15` | `RESEND_API_KEY`, `EMAIL_FROM` (`env.ts:24-25`) | Dev: OTP is logged. Production: the send throws (`email-otp.ts:66-67`) |
| **Custom SMTP relay** | Alternative to Resend | Server — `backend/src/lib/email-otp.ts` | `SMTP_SERVICE_URL` (`env.ts:26`) | — |
| **Inbound email provider** (Cloudflare Email Worker, SendGrid or Mailgun) | Receives forwarded billing emails and POSTs them to `/api/email/inbound` | Provider → server, shared secret in `x-inbound-secret` (`backend/src/routes/email.ts:142-150`) | `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_SECRET` (`env.ts:84-85`) | Forwarding routes 503 |
| **Google OAuth + Gmail API** | Gmail subscription scan — **no caller in the app** | Server — `backend/src/routes/email.ts:34-37`, `backend/src/lib/email-providers/gmail.ts:9-13` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (`env.ts:76-78`) | Email OAuth routes 503 |
| **Expo push service** | Bill reminders, streak nudges, badge alerts, household notifications | Server — `backend/src/lib/expo-push.ts:10`; app gets a token from `expo-notifications` and registers it at `POST /api/push-tokens` | None | — |
| **Exchange rates** (open.er-api.com) | Currency conversion, cached 24 h on the server and on the phone | Server — `backend/src/routes/rates.ts:33-46` | `EXCHANGE_RATES_URL`, default the free endpoint (`env.ts:69-72`) | Uses the default |
| **Railway** | Hosting, volume for the database and receipts | — | `PORT`, `DATABASE_URL`, `BACKEND_URL` (`env.ts:4-7`) | — |
| **EAS (Expo)** | App builds | — | Project id in `mobile/app.json` `extra.eas.projectId`; profiles `development`, `preview`, `preview-simulator`, `production` (`mobile/eas.json`) | — |

**Not integrated at all:** analytics, crash reporting, feature flags, error monitoring. No SDK for
Sentry, PostHog, Amplitude, Mixpanel, Segment or Firebase is present. The one "Mixpanel" in the
source is an entry in the cancellation-guide list (`mobile/src/lib/cancel-directory.ts:592`).

**Secrets in the repo:**
- `backend/.env` holds `PORT`, `OPENAI_API_KEY`, `DATABASE_URL` and `BETTER_AUTH_SECRET`;
  `mobile/.env` holds the backend URL and the three RevenueCat keys.
- Both files are git-ignored.
- Their values were not read for this document.

---

## 9. Findings that matter for a re-architecture

Only facts — no fixes proposed.

1. **Sync only goes up.** The upload half runs; the download half is reachable only from
   `verify-otp.tsx`, which nothing opens (§3.4). The server holds every user's data; the app never
   reads it back.
2. **Two transaction stores that never reconcile.** The app's ledger is local SQLite; the server's
   is Prisma. Three paths write only to the server: recurring "run now", the recurring job, Plaid
   sync (§3.4).
3. **The phone isn't separated by user.** One shared database file, not cleared on sign-out, and a
   partial reset that leaves subscriptions, custom categories and the health profile behind (§5.4).
4. **A single SQLite connection serves every user** (`backend/src/prisma.ts:8-12`). Rate limits,
   AI usage counts and the rates cache all live in process memory. Both depend on there being
   exactly one server instance.
5. **Server-only features don't work offline:** bill reminders, recurring, net worth, category
   budgets, all of business and household (§3.5).
6. **Duplicated and drifting types.** Three identical `Transaction` interfaces that match neither
   schema (§4.4), and string-typed enums on both sides (§4.1).
7. **A legacy compatibility layer** rewrites every JSON response for old app builds
   (`backend/src/index.ts:77-90`).
8. **Every route is mounted twice** (`/api/...` and `/api/v1/...`); app modules use both prefixes.
9. **Dead or vestigial code:**
   - the email-OTP flow and its screen;
   - the Gmail OAuth path;
   - `@hono/node-server` on the backend;
   - 84 unreferenced mobile dependencies (§1.4).
10. **Categorisation's fallback table is US-centric** by its own documentation
    (`mobile/src/lib/merchant-memory.ts:4-9`).
