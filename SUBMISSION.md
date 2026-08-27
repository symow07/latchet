# Budget — Submission Checklist

_27 August 2026 · everything left before you can submit, in dependency order._

**The code is done for v1; the deployment is not configured.** Phases 0–3 are shipped, RevenueCat's
client and server halves are built, and the app is translated into English, French, Simplified
Chinese and Arabic. What remains is almost entirely things only you can do — accounts, keys,
purchases and a build.

⚠️ **The production backend today has only `BETTER_AUTH_SECRET` and `DATABASE_URL` set.** It is
live and its database is reachable, but with no email provider **nobody can sign in at all**
(`lib/email-otp.ts:67` throws), and with no `OPENAI_API_KEY` every AI route returns 503
(`routes/ai.ts:42`). Step 3 below is not a polish item — it is what makes the deployment usable.

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

### 7. ☑ App icon and splash — done
`mobile/assets/` holds `icon.png` (1024², RGB, no alpha), `adaptive-icon.png`, `splash-icon.png`
and `favicon.png`, all declared in `app.json` and confirmed rendering in the simulator launcher.
Only the App Store *screenshots* remain, and they belong to step 9.

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

Nothing. Everything previously listed here is done, including the two items this file wrongly
still claimed were outstanding, the app icon, and every gap flagged in the last review.

Known gaps, recorded rather than scheduled:

- **Arabic is written but unread by a native speaker.** The six CLDR plural forms are implemented
  and the pluralizer is tested at 0, 1, 2, 5, 30, 100, 103 and 111, so the grammar is structurally
  right; the wording still deserves a review by someone who reads Arabic.
- **Receipts submitted before they were uploaded are gone.** Those `file://` paths only ever
  resolved on the submitter's own phone; the app labels them unavailable.
- **Recording is unverified since the expo-audio port.** It compiles, links and resolves; actually
  speaking into it needs a signed-in personal account on a device.
- **Notification quick-add's OS half is unverified** — iOS drawing the action and delivering the
  response needs one run on a signed-in device.
- **The production database file is called `dev.db`.** It sits inside the Railway volume, so
  persistence is fine and nothing is at risk — the name is just wrong. Renaming needs
  `DATABASE_URL` changed and the file moved on the volume in one window; doing only the former
  points production at an empty database.
- **The advisor's refusal behaviour has never been tested against a live model.** The guardrails
  are enforced server-side and the static tests prove they reach the model, but only
  `advisor-adversarial.test.ts` proves it obeys, and that needs a working OpenAI key. It is written
  and skips loudly. Run it before shipping the health tier.
- **The OPENAI_API_KEY in backend/.env is a placeholder**, not a real credential — it is shaped like
  one and ends in "r3al", and every request with it returns 401.
- **Phase 7 remains deliberate.** The model upgrade in particular has an acceptance criterion —
  benchmark receipt accuracy before and after — that needs an API key and a corpus.

## Deferred to v1.1, deliberately

Nothing. Arabic and RTL (Task 24) were the entry here and shipped instead — the app runs in
English, French, Simplified Chinese and Arabic, and mirrors its layout for the last of those.
