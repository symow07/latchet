# Phase 4 — finish features: the work list

_Written 11 October 2026, before Phase 3 began, so nothing found along the way gets lost; closed out 12 October 2026 at the end of Phase 4. The first list is Phase 4 exactly as the master revival prompt sets it out; the second is what Phases 1–4 found and added to it. Every item is done, or marked HANDOFF with who does what._

## From the master prompt

- [x] **Password reset, end to end, front and back.** Done in `72135fe`: "Forgot password?" on sign-in, an emailed link that opens the app's reset screen, single-use tokens, every session revoked on reset; the request never reveals whether an account exists. Checked on the simulator against the local backend.
- [x] **Make email verification reachable.** Done in `72135fe`: a link on sign-up, Verified / Not verified with a resend in both Settings screens, and a landing screen for the link. Offered, not required to sign in.
- [ ] HANDOFF (you): **Production mail.** Reset and verification work in production, but no mail goes out until `RESEND_API_KEY` (and a verified `EMAIL_FROM` domain) is set on the Railway Latchet service. DEPLOYMENT.md §2–§3.
- [x] **Restore bank linking's entry point.** Done in `419b6f1`: Settings → Accounts and the Accounts screen open `/link-bank`, with a Pro badge for free users.
- [ ] HANDOFF (you): **Create the Pro store products.** They live in App Store Connect / Play Console and RevenueCat, which only you can reach. The app needs no product ids: attach the products to the entitlement `pro`, put them in an offering marked Current with a paywall, add Test Store products for development, and point the webhook at the backend. Step by step in DEPLOYMENT.md §3.
- [x] **Fix the three dark-mode bugs on business screens** (translucent white on the dark cards). Done in Phase 2, Step 2b (`de128ae`).
- [x] **Give the four server-only screens offline support:** bill reminders, recurring, net worth, category budgets. Server in `c71cc7b`, phone in `61ca96a`: they read and write the phone's database and sync both ways. Checked on the simulator with the backend stopped.
- [x] **Add tests for the health score logic and the behaviour-detection / alerts.** Done in `378c50b`: 40 health-score and 46 behaviour tests, and the scoring bugs they found fixed.
- [x] **Replace the US-centric categorisation fallback table.** Done in `9a81d9b`: plain words in four languages, regional brands by currency (US/Canada, euro area, UK, Morocco, China), whole-word matching.
- [x] Typecheck, test, commit and push as each piece landed. Stop and report before Phase 5.

Also done first, as the top priority: **sheets froze on drag-to-dismiss** (`8c4b195`; `timed()` lacked its worklet directive, and a test now checks every UI-thread call).

## Added from Phases 1–4

### 1. Approve is offered on your own expense
**Done** in `419b6f1`: Approve/Reject appear only on expenses you did not submit; your own say "Waiting for another approver". Business Home counts only what waits on you. Tested.

### 2. Count strings that don't pluralise
**Done** in `419b6f1`: every count string is a plural in all four locales (six Arabic forms); unused count keys removed; a test fails on any flat count string.

### 3. Hard-coded English in Receipt Scan
**Done** in `419b6f1`: the four messages are in the locales, and the scan now catches strings passed to calls and reads the library modules whose text reaches the screen (it missed them because it only read JSX text, attributes and object properties, and never read `src/lib`).

### 4. Recurring bookings land on no account
**Done**: the server books onto the series' account, else the default account (`c71cc7b`); the form has an account picker defaulting to the default account (`61ca96a`). Tested end to end and on the simulator (run-now moved the default account by −35.50 on server and phone).

### 5. Found while mapping Phase 4
- [x] The net-worth breakdown never showed, and "today" was the UTC date — fixed in `61ca96a`.
- [x] The New Recurring form kept the last values after a create — fixed in `61ca96a`.
- [x] `behavior-detection.ts` read weekdays from a UTC parse (`378c50b`), hard-coded `$` and English month names (`419b6f1`) — fixed.
- [x] Health-score suggestions and the advisor's quick insights were hard-coded English — fixed in `419b6f1`.
- [x] Business Home counted your own pending expenses — fixed in `419b6f1`.
- [x] A bill due today was counted as overdue; net worth with one snapshot asked for your first; Business Tools counted a yearly tool as monthly — fixed in `419b6f1`.

### 6. Left for Phase 5 (found during Phase 4, outside its scope)
- **Recurring bookings are dated by the server's UTC day.** A series run just after local midnight is booked on the previous date (seen on 12 Oct, booked 11 Oct). A proper fix needs the user's timezone on the server — a small schema change; your call.
- **English still built in three places:** `mobile/src/lib/notifications.ts` (the lock-screen action labels and the streak nudge), `emailSubscriptionApi.ts`'s fallback cancel instructions, and the `*Api.ts` modules' "Failed to…" errors that screens show through `e.message`.
- **The import screen never passes the user's categorisation history** to the parser (only the currency), so history-based suggestions don't apply to CSV imports.

### Smaller notes
- [x] `business-tools.tsx` labels business categories with `expenseCategoryLabel` (`419b6f1`).
- [x] The Advisor disclaimer: kept medical/nutritional on the personal advisor (it collects health data for the advisor profile), gave the business advisor its own, and the Arabic now says financial (`419b6f1`).
- [x] `bizHome.quickAdd` / `bizHome.quickReview` removed from all four locales (`419b6f1`).
- [x] The LockScreen effect: `onUnlock` held in a ref, dependencies complete, still prompts once; lint reports no problems at all (`419b6f1`).
