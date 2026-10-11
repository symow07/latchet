# Phase 4 — finish features: the work list

_Written 11 October 2026, before Phase 3 began, so nothing found along the way gets lost. The first list is Phase 4 exactly as the master revival prompt sets it out; the second is what Phases 1–3 found and added to it. Every item is required; none is optional._

## From the master prompt

- [ ] **Password reset, end to end, front and back.** The launch blocker. The email transport it needs was kept for this in Phase 1 (`backend/src/lib/email.ts`, `sendEmail`).
- [ ] **Make email verification reachable.**
- [ ] **Restore bank linking's entry point.** The redesign removed it from Home, and now nothing in the app navigates to `mobile/src/app/link-bank.tsx` at all; its only reference is its route registration (`mobile/src/app/_layout.tsx:332`).
- [ ] **Create the Pro store products** so the RevenueCat paywall has something to sell. The simulator logs it today: "there are no Test Store products registered in the RevenueCat dashboard for your offerings."
- [x] **Fix the three dark-mode bugs on business screens** (translucent white on the dark cards). Done in Phase 2, Step 2b (`de128ae`): the white overlays on the business anchors are now silver on espresso, and `conventions.test.ts` fails on any `rgba(`, `'white'` or hex colour in a screen. Seen in dark on the simulator: business Settings and Money (payroll).
- [ ] **Give the four server-only screens offline support:** bill reminders, recurring, net worth, category budgets. (Phase 3's two-way sync is the foundation this builds on.)
- [ ] **Add tests for the health score logic and the behaviour-detection / alerts.**
- [ ] **Replace the US-centric categorisation fallback table** with something appropriate for non-US users.
- [ ] Typecheck, test, commit. Stop and report.

## Added from Phases 1–3

### 1. Approve is offered on your own expense
Business → Expenses shows **Approve** and **Reject** on every pending expense to an owner or manager (`mobile/src/app/(business-tabs)/expenses.tsx:379` sets `canReview` from the role alone; `:315` draws the buttons), including the ones they submitted themselves. The server correctly refuses (`backend/src/routes/expenses.ts:204`, "Cannot approve your own expense", 403), so the person taps a button that can only fail and gets a "Something went wrong" dialog. Found on the simulator in Step 2b.
**Fix:** don't offer review on your own expense (compare `expense.submitterId` with the signed-in user), and say why, e.g. "Waiting for another approver". Test it.

### 2. Count strings that don't pluralise
- "1 expenses" under the Expenses anchor: `businessExpenses.expenseCount` is a flat string (`mobile/src/lib/i18n/locales/en.json:531`, "%{count} expenses"), used at `(business-tabs)/expenses.tsx:426`. The same flat shape is at `en.json:1096` and `bizStats.expensesWaiting` at `en.json:1094`.
- "1 records found" on History: `transactionsScreen.recordsFound` (`en.json:798`, "%{count} records found"), used at `mobile/src/app/(tabs)/transactions.tsx:131`.

The app already has proper plural rules for en, fr, ar and zh (`mobile/src/lib/i18n/core.ts:67–95`), and other keys use them (`en.json:111–113` is a `one`/`other` pair). These keys need converting to that shape in all four locales, plus a test that no `%{count}` string is a flat string.

### 3. Hard-coded English in Receipt Scan
Four user-visible strings in `mobile/src/app/receipt-scan.tsx` bypass i18n:
- `:121` "Camera permission is required to take photos."
- `:134` "Photo library permission is required to choose photos."
- `:150` "Could not read image data. Please try again."
- `:199` "Enter a valid amount greater than 0."

Move them to the locale files in all four languages. The hard-coded-English convention test (`mobile/src/lib/i18n/i18n.test.ts`) missed them; find out why and close the gap.

### 4. Recurring bookings land on no account
A recurring item has no account field (the form in `mobile/src/app/recurring.tsx` never asks for one), so every booking — run-now and the server job alike — is written with `accountId` null. Home's total counts it while the account card does not: on the simulator in Phase 3, a €25 run-now left "Total balance −€37.34" above a Cash account at −€12.34. This predates Phase 3 (the old run-now posted without an account too); Phase 3 only made it visible, because the booking now comes from the server (`backend/src/jobs/recurring-booking.ts`, which books onto `rec.accountId` when it is set).
**Fix:** let a recurring item choose its account, defaulting to the user's default account, and book onto it. Test that a booking moves that account's balance.

### Smaller notes, same rule: fix or consciously drop
- `mobile/src/app/business-tools.tsx` labels business categories with the personal `categoryLabel`, so "Software", "Travel", "Meals" and "Office" are not translated there; `expense-meta.ts` has `expenseCategoryLabel` for this (noted by the Step 2b business agent).
- The Advisor disclaimer reads "Budget guidance only — not medical, nutritional or financial advice." Medical and nutritional look like leftovers from another app.
- `bizHome.quickAdd` and `bizHome.quickReview` are unused since the business shortcuts became Tools and Team; remove them from the four locales.
- One lint warning predates the revival: `mobile/src/app/_layout.tsx` LockScreen's mount-only `useEffect` (react-hooks/exhaustive-deps). Adding the dependency naively could re-prompt Face ID on every parent render; fix it deliberately or document the exemption.
