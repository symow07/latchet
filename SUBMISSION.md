# Budget — Submission Checklist

_21 August 2026 · everything left before you can submit, in dependency order._

**The code is essentially done for v1.** Phases 0–3 are shipped and deployed, RevenueCat's client
and server halves are built, and the app is translated into English, French and Chinese. What
remains is almost entirely things only you can do — accounts, keys, purchases and a build.

Two small agent-sized items remain, listed at the bottom.

---

## Do these in order — later steps depend on earlier ones

### 1. Rotate the Railway token · 2 min
It has been used across several sessions and is sitting in transcripts. Independent of everything
else, so do it first and stop thinking about it.

### 2. Buy `realbudget.app` · 10 min
Matches the bundle ID you already own. **One purchase unblocks three separate blockers** — the
Resend sending domain, the support email, and privacy-policy hosting. Nothing else on this list
moves until this does.

### 3. Set the Railway variables · 10 min — one update, one restart
- `OPENAI_API_KEY` — without it the advisor, receipt scan, email detection and PDF import all
  return 503. That is the entire tier RevenueCat was built to sell.
- `RESEND_API_KEY` — without it nobody can sign in to production, including you.
- Confirm `BETTER_AUTH_SECRET` is ≥ 32 chars, and set `TOKEN_ENCRYPTION_KEY`
  (`openssl rand -base64 48`) while you're in there. Check `PLAID_CLIENT_ID` and `GOOGLE_CLIENT_ID`
  first — if both are unset, there is no ciphertext and rotation is free.

Then: `DEBUG_LOGS=true`, one signup, read `[hash:done] op=hash ms=` from the logs to confirm PBKDF2
at 600k is sane on Railway's CPU, and turn the flag straight back off (it also puts email addresses
in your logs).

### 4. Verify the Resend domain · 20 min + DNS propagation
Add the DNS records, set `EMAIL_FROM` to something at `realbudget.app`. Until this is done,
`onboarding@resend.dev` only delivers to your own verified address — fine for testing, useless for
users.

### 5. Run an EAS build · 1 hour
```
eas build --profile preview --platform ios
```
`mobile/ios/` already exists with RevenueCatUI Pods installed, so prebuild and pod install
demonstrably work — the part most likely to fail already passes. This is the **first device
verification of six features**: Import v2, subscription consolidation, account deletion,
RevenueCat, i18n, and category labels. Expect to find things. Better now, in one build, than five
at once during review.

### 6. Privacy policy hosting + support email · 30 min
GitHub Pages cannot publish from a private repo on the free plan. Cheapest path: a separate public
repo with the one file. Then set the real support address — Apple verifies that it resolves.

### 7. App icon and splash · needs design
Still no `assets/` directory; `app.json` declares no `icon`, so prebuild generated Expo's
placeholder and it is sitting in the native project right now. This is the last hard blocker that
isn't a form field.

### 8. RevenueCat store products · 1–2 hours
Products in App Store Connect and Play Console, linked in the RevenueCat dashboard under an
entitlement named `pro`. Sandbox testers on both platforms. Then re-verify: a free user hits the
AI cap at 5/day and gets 402, a forged Pro client still gets 402.

### 9. App Store Connect metadata
Listing name needs a qualifier — store names are unique and BUDGET is an Avis Budget Group brand.
"Budget: Spending Tracker" or similar. Screenshots at every required size. Privacy declarations
matching `PRIVACY.md` — financial data, contact info, email content.

---

## One thing you can drop from the critical path

**Plaid production approval is not a v1 blocker.** Under the import-first decision, statement
import is the universal rail and bank sync is a per-country convenience. The Plaid routes already
degrade to 503 when unconfigured, and Plaid only covers 20 countries anyway. Ship v1 with import
as the headline, keep Plaid in sandbox, and switch it on when approval lands. That removes the
longest-lead external dependency from your launch — apply now, but don't wait on it.

---

## Remaining agent work

Both items previously listed here are done: `ExpenseCategory` is localised through
`expenseCategoryLabel`, and `.github/workflows/ci.yml` runs install → typecheck → test on both
halves, with a step that applies migrations to an empty database.

- **The share extension's own text.** `ShareViewController`'s placeholder is a plain Swift string
  in a separate target, so it needs its own `.lproj` resources — the app's `.lproj` files do not
  reach it.
- **Localised Siri phrases for the extension's target**, same reason.
- **`expo-av` → `expo-audio`.** `voice-api.ts` documents the debt. Worth doing before the next SDK
  bump forces it.

Known gaps, not scheduled:

- **Receipt images are device-local.** `Expense.imageUrl` stores a `file://` path from the picker,
  so a reviewer on another device cannot load the receipt they are approving. A company logo was
  left out of the profile screen for the same reason. Both need real file hosting.
- **No delete-business endpoint.** A company record can be created and edited but not removed
  except by deleting the account.
- **Traditional Chinese narrows to Simplified.** `normalizeLocale` maps `zh-Hant` to `zh`.
- **Notification quick-add's OS half is unverified** — iOS drawing the action and delivering the
  response needs one run on a signed-in device.

---

## Deferred to v1.1, deliberately

Arabic and RTL (Task 24). The i18n scaffolding is in place, so it costs nothing to wait, and it
touches every screen at exactly the moment everything else is stabilising.
