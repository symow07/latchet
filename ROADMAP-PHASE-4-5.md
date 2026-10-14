# Latchet — Phase 4 & 5 Work Order (Tasks 21–24)

> Expands Tasks 21–24 of `ROADMAP.md` with the detail needed to execute them.
> Same rules as before: work in order, tick boxes, commit per task, run
> `bun run typecheck` in **both** halves before every commit.

**Naming is settled:** the app is **Latchet**. `app.json` and the bundle ID
`com.latchet.app` are already correct — **do not rename anything.**

---

## Sequencing — read this first

**Task 22 (RevenueCat) must come before Tasks 23–24 (i18n).** The paywall introduces a screen's
worth of new user-facing strings. Translating 26 screens first and then adding an untranslated
paywall means doing the extraction pass twice. Build the paywall, then translate everything once.

Task 21 (icon) is independent and blocked on a design asset — run it in parallel whenever the
artwork exists.

---

## ☐ Task 22 — RevenueCat, end to end

### What already exists

- `mobile/src/lib/revenuecatClient.ts` — a complete 328-line SDK wrapper (`getOfferings`,
  `purchasePackage`, `getCustomerInfo`, `restorePurchases`, `setUserId`, `logoutUser`,
  `hasEntitlement`, `hasActiveSubscription`, `getPackage`), with graceful degradation when keys
  are absent. **Zero call sites.** The SDK layer is done; the wiring is not.
- `react-native-purchases` and `react-native-purchases-ui` are already dependencies.
- `mobile/.env` already carries `EXPO_PUBLIC_REVENUECAT_TEST_KEY` / `_APPLE_KEY` / `_GOOGLE_KEY`.

### Tier model (decided)

| Free | Pro |
|---|---|
| Manual entry, statement import (CSV/Alipay/WeChat/PDF), budgets, subscriptions, net worth, bill reminders, recurring, business mode | AI advisor, receipt scan, email subscription detection, bank sync (Plaid) |

**Free AI allowance: 5 calls/day.** A taste converts better than a wall. Change the constant if
you disagree — it's one value in `usage-limit.ts`.

### 22a — Client wiring

1. Call `setUserId(session.user.id)` on login and `logoutUser()` on sign-out. **This is
   load-bearing:** RevenueCat's app user ID must equal the Better Auth user id, or the webhook in
   22b cannot map a purchase to an account. Wire it where the session resolves in
   `mobile/src/app/_layout.tsx` (near the existing push-registration effect, which already has the
   "once per authenticated user" pattern to copy).
2. Paywall: use `RevenueCatUI.presentPaywall()` from `react-native-purchases-ui` rather than
   hand-building one. It's already a dependency, it handles the store-specific legal copy Apple
   requires, and it's configured from the RevenueCat dashboard rather than in code.
3. **Restore purchases** — Apple rejects apps without it. Add it to
   `mobile/src/app/(tabs)/settings.tsx`.
4. A `useEntitlement()` hook backed by the server (22b), not by client `CustomerInfo`. The client
   may *optimistically* show Pro immediately after a purchase, but every gate that costs money
   must resolve server-side.

### 22b — Server-side entitlement ⚠️ the part that matters

Client-side gating is bypassed in minutes, and the Pro features are precisely the ones that spend
your money per call. This is not optional.

1. **Schema.** Add to `User`: `entitlement String @default("free")`, `entitlementExpiresAt
   DateTime?`, `revenueCatUserId String?`. Migration required.
2. **Webhook.** `POST /api/v1/revenuecat/webhook`, registered *before* the auth guard (RevenueCat
   calls it server-to-server). Authenticate with the shared `Authorization` header configured in
   the RevenueCat dashboard, compared with `crypto.timingSafeEqual` — match the pattern already
   used for `x-inbound-secret` in `routes/email.ts`. Handle `INITIAL_PURCHASE`, `RENEWAL`,
   `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `PRODUCT_CHANGE`.
3. **Guards.** Check entitlement in the existing auth guards at `backend/src/routes/ai.ts:29` and
   `backend/src/routes/plaid.ts:100`. Return `402 Payment Required` with a machine-readable code so
   the client can present the paywall rather than an error.
4. **The purchase race.** A purchase completes on device seconds before the webhook lands. Do not
   make the user wait. Add `POST /api/v1/me/entitlement/refresh`, which queries RevenueCat's REST
   API for that user directly and updates the row. Client calls it immediately after a successful
   purchase; the webhook remains the source of truth for renewals and cancellations.
5. **Allowances.** Rework `backend/src/lib/usage-limit.ts` so the AI cap is entitlement-aware:
   free = 5/day, Pro = the current 20 per 5 min / 200 per day.

### 22c — Store configuration (needs your accounts, not the agent's)

Products in App Store Connect and Play Console, linked in the RevenueCat dashboard, with an
entitlement named `pro`. Sandbox testers on both platforms.

### Verify

- A free user hits `/api/v1/ai/chat` six times in a day → the sixth returns 402, not 429.
- A forged client claiming Pro still gets 402 — assert this explicitly; it's the whole point.
- Webhook with a wrong/absent `Authorization` header → 401 before any DB write.
- `EXPIRATION` flips the user back to free and the guard follows on the next request.
- Restore purchases returns an existing subscriber to Pro on a fresh install.

---

## ☐ Task 23 — i18n: English, French, Chinese

### Setup

`expo-localization` for device locale + `i18n-js` for lookup (lighter than react-i18next and
sufficient here). Persist the chosen locale in `UserSettings` — the table and its route already
exist — so it follows the user across devices, defaulting to device locale on first run.

### The work

1. Extract strings from all 26 screens in `mobile/src/app/` plus `mobile/src/components/`.
   Namespace by screen. Include the paywall from Task 22.
2. **`formatCurrency` (`mobile/src/lib/calculations.ts:242`) hardcodes `'en-US'`.** Take the active
   locale instead. Grouping and symbol placement are wrong today for every non-US user — a visible
   bug that i18n makes unmissable.
3. Dates via `date-fns` locales, driven by the same setting.
4. A language picker in `mobile/src/app/(tabs)/settings.tsx`.
5. Translate. Keep an `en.json` as the source of truth; the others derive from it.

### Watch for

- Pluralisation — Chinese has no plural forms, French differs from English on zero. Use i18n-js
  pluralisation rather than string concatenation.
- Fixed-width UI. French runs ~20% longer than English; several dashboard tiles are tight already.
- The AI advisor prompt in `mobile/src/lib/ai-analysis.ts` is English. Either instruct the model to
  reply in the user's locale, or translate the system context — decide and be consistent.

---

## ☐ Task 24 — Arabic and RTL

> **Recommendation: ship v1 as English/French/Chinese and land this as v1.1.** RTL isn't hard, it's
> *broad* — it touches every screen at exactly the moment everything else is stabilising. The
> scaffolding from Task 23 is identical either way, so deferring costs nothing. Confirm before starting.

1. `I18nManager.forceRTL` requires an app restart to take effect. It interacts with the startup
   sequence in `mobile/src/app/_layout.tsx` — which has a DB-init timeout, an 8s splash backstop and
   a biometric gate. Handle the restart deliberately; don't let it race the splash.
2. Audit every `flex-row`, absolute position, and horizontal padding/margin across 26 screens.
   Prefer `start`/`end` over `left`/`right` throughout.
3. Directional icons (chevrons, arrows, back buttons) must mirror.
4. Charts — `victory-native` axes do not mirror automatically.
5. Numbers and currency stay LTR inside RTL text; verify amounts render correctly in context.

**Verify:** screenshot every screen in Arabic and compare against the English layout.

---

## ☐ Task 21 — Icon and splash ⚠️ blocked on artwork

There is still **no `assets/` directory in the repo** and `app.json` declares no `icon` or `splash`.
The build ships Expo's placeholder.

Once artwork exists, wire: `icon` (1024×1024, no alpha, no rounded corners — Apple applies the
mask), `android.adaptiveIcon` (foreground + background layers), and `expo-splash-screen` plugin
config with light and dark variants. Then App Store screenshots at every required device size.

---

## Still outstanding — owner actions, not agent work

1. **Rotate the Railway token.**
2. **`RESEND_API_KEY`** — production sign-in is impossible without it.
3. **`OPENAI_API_KEY`** — without it the entire Pro tier returns 503, including everything Task 22
   is built to sell.
4. **A domain** (`latchet.app` matches the existing bundle ID) — unblocks the Resend sending <!-- TODO(domain) -->
   domain, the support email, and privacy-policy hosting in one purchase.
5. **Privacy hosting** — GitHub Pages cannot publish from a private repo on the free plan. A
   separate public repo is the free option.
6. **An EAS build** — Import v2, the subscription consolidation and the delete-account UI have sat
   in `main` across three pushes without reaching a device.
