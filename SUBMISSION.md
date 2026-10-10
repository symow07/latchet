# Budget — Submission Checklist

_27 August 2026 · everything left before you can submit, in dependency order._

**The code is done for v1; the deployment is not configured.** Phases 0–3 are shipped, RevenueCat's
client and server halves are built, and the app is translated into English, French, Simplified
Chinese and Arabic. What remains is almost entirely things only you can do — accounts, keys,
purchases and a build.

⚠️ **The production backend today has only `BETTER_AUTH_SECRET` and `DATABASE_URL` set.** It is
live and its database is reachable, but with no `OPENAI_API_KEY` every AI route returns 503
(`routes/ai.ts:42`). (This line used to say nobody could sign in without an email provider. Sign-in
is email and password and sends no mail, and the OTP flow was removed on 11 October 2026.) Step 3 below is not a polish item — it is what makes the deployment usable.

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
- `RESEND_API_KEY` — not needed to sign in. It is for the verification and password-reset mail
  that is not built yet.
- Confirm `BETTER_AUTH_SECRET` is ≥ 32 chars, and set `TOKEN_ENCRYPTION_KEY`
  (`openssl rand -base64 48`) while you're in there. Check `PLAID_CLIENT_ID`
  first — if it is unset, there is no ciphertext and rotation is free.

Then: `DEBUG_LOGS=true`, one signup, read `[hash:done] op=hash ms=` from the logs to confirm PBKDF2
at 600k is sane on Railway's CPU, and turn the flag straight back off (it also puts email addresses
in your logs).

### 4. Verify the Resend domain · 20 min + DNS propagation
Add the DNS records, set `EMAIL_FROM` to something at `realbudget.app`. Until this is done,
`onboarding@resend.dev` only delivers to your own verified address — fine for testing, useless for
users.

### 5. Run an EAS build · blocked on two things, neither of them code

```
eas build --profile preview --platform ios
```

**Two blockers, found by trying it on 27 August 2026.**

1. **This account's free-plan iOS builds are used up for the month**, resetting
   Tue 1 Sep. Cloud builds fail immediately with that message. Upgrading is a
   purchase decision and yours alone.
2. **The `preview` profile is a device build and has no credentials.** Every
   build this project has ever run — all of them — used `preview-simulator`.
   No device build has been attempted, so no Apple distribution certificate or
   provisioning profile exists on EAS. `--profile preview` will stop at an
   Apple Developer login.

`--local` is not a way around it either: it shells out to fastlane, which is
not installed on this machine.

**What was verified instead, without EAS.** The same artifact was built
directly with Xcode 26.6 (`-configuration Release -sdk iphonesimulator`),
which exercises the identical prebuild → pods → native compile → JS bundle
path:

- **BUILD SUCCEEDED**, 4,112 compile steps, no errors.
- `main.jsbundle` produced at 11.7 MB — the production bundle builds.
- `BudgetShareExtension.appex` embedded in `PlugIns/`.
- App icons present (`Assets.car`, `AppIcon60x60@2x.png`).
- Installed and launched: the session persisted, SecureStore worked, and both
  new features (household sharing, advisor profile) render correctly from the
  bundled JS with no Metro attached.

One trap worth writing down: building with `CODE_SIGNING_ALLOWED=NO` strips
every entitlement, and the app then dies at startup with `KeyChainException: A
required entitlement isn't present` from expo-secure-store. That is the build
flag, not the app — Xcode's default simulator signing works fine. It cost
about twenty minutes to rule out as a real bug.

Still genuinely unverified: anything that needs real hardware — Face ID,
notification delivery, the share sheet under a real App Group, and voice
recording.

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

⚠️ **Every build that exists predates two fixes it needs.** The newest build — 26 August,
`00f35e33` — calls the business backend with bare `fetch` and `credentials: 'include'`, which
attaches nothing on this stack. Every business screen therefore requests logged out, gets a 403,
and renders an empty state; that is the reported "the business profile doesn't work". Fixed in
`5a1d2b4`. Separately, the same build reads `business.teamMembers`, renamed to `members` on 27
August, which crashes once a business row exists — now absorbed server-side by
`lib/legacy-aliases.ts`, verified by running that exact binary against production.

Nothing in the App Store or on a phone gets either fix without a new build. EAS iOS builds are
exhausted until 1 September; a working simulator build can be produced locally with Xcode in the
meantime (see step 5).

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
- **Arabic users' settings sync was broken and is now fixed.** `PUT /api/settings` validated
  locale against `["en","fr","zh"]`, and zod rejects the whole body on one bad field — so it was
  not that their locale reset, it was that every setting they changed silently stopped syncing.
  A test now reads both files and fails if the lists disagree.
- **The OPENAI_API_KEY in backend/.env is a placeholder**, not a real credential — it is shaped like
  one and ends in "r3al", and every request with it returns 401.
- **The Gmail OAuth half of email subscriptions was removed on 11 October 2026.** It had no caller —
  the app uses email *forwarding*, a separate path that works. (`saveEmailSubscriptions` was wrongly
  listed here as dead; `email-inbox.tsx` calls it, and it stays.)
- **Phase 7 remains deliberate.** The model upgrade in particular has an acceptance criterion —
  benchmark receipt accuracy before and after — that needs an API key and a corpus.

## Deferred to v1.1, deliberately

Nothing. Arabic and RTL (Task 24) were the entry here and shipped instead — the app runs in
English, French, Simplified Chinese and Arabic, and mirrors its layout for the last of those.
