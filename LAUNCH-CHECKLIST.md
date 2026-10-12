# Launch checklist — the steps only you can do

_12 October 2026. Everything the code needs is done or in flight; what is left needs your accounts, your money or your phone. Do the sections in order: later ones depend on earlier ones. Tell me when you finish a step marked **→ tell me**, and I'll take the next part._

Identifiers you'll need throughout: bundle ID / package **`com.realbudget.app`**, Expo project **`@symow/budget`**, Railway project **budget**, service **Budget**, production URL `https://budget-production-5a9d.up.railway.app`.

---

## 1. Rotate the Railway token (2 min)

The current token has been used across many sessions and appears in old transcripts.

1. Open railway.com → your avatar → **Account Settings → Tokens**.
2. Create a new token (name it e.g. `claude-2026-10`), copy it once.
3. Wherever you use Railway from tools (the Railway connector in Claude, any CLI login), replace the old token with the new one. For the CLI: `railway logout` then `railway login`.
4. Back in **Tokens**, delete every older token.
5. Check: run `railway whoami` (or ask me to list the project) — it should still work with the new token only.

## 2. Delete the old SQLite volume (2 min)

Production has run on Postgres since 11 October and has been healthy; the old volume is only kept for a rollback you no longer need. I don't delete data permanently myself, so this one is yours.

1. Railway → project **budget** → service **Budget** → **Settings → Volumes**.
2. Find **`budget-data`** mounted at **`/data`**. (Not `postgres-volume` — that one belongs to the **Postgres** service and holds the live database.)
3. **Detach** it from the Budget service and let the service redeploy.
4. Check the deploy is green and `https://budget-production-5a9d.up.railway.app/health` returns `{"status":"ok"}`.
5. Then open the detached volume and **Delete** it.

## 3. Set the production keys on Railway (10 min, one restart) → tell me

Today the Budget service has only `BACKEND_URL`, `BETTER_AUTH_SECRET`, `DATABASE_URL` and `NODE_ENV`.

1. Railway → **Budget → Variables → New Variable**, add:
   - `OPENAI_API_KEY` — a real key from platform.openai.com. Without it the advisor, receipt scan, email detection and PDF import answer 503.
   - `TOKEN_ENCRYPTION_KEY` — generate with `openssl rand -base64 48`. Back it up in your password manager; it cannot be rotated later without re-encrypting bank tokens.
   - `RESEND_API_KEY` and `EMAIL_FROM` — after section 6.
   - `REVENUECAT_WEBHOOK_SECRET` (16+ characters, any random string) and `REVENUECAT_API_KEY` (RevenueCat secret API key) — during section 10.
2. Apply the changes (one redeploy).
3. **→ tell me** once `OPENAI_API_KEY` is set: I'll run the live advisor safety tests through `railway run`, which injects the key without anyone reading it.

## 3a. Crash reporting with Sentry (15 min) — before the first device build

The app reports crashes to Sentry once it has a DSN, and sends no personal data (PRIVACY.md lists exactly what). Until you do this, builds work and simply report nothing.

1. sentry.io → create a free account and organization → **Projects → Create Project → React Native**, name it `budget`.
2. Project → **Settings → Security & Privacy**: turn on **Prevent Storing of IP Addresses**; keep **Data Scrubber** and **Use Default Scrubbers** on.
3. Copy the project's **DSN** (Settings → Client Keys). Create an **auth token**: Settings → Developer Settings → Organization Tokens → Create (it uploads source maps so crashes show readable code).
4. In `mobile/`, store them as EAS environment variables (replace the `<…>`):
   1. `eas env:create --name EXPO_PUBLIC_SENTRY_DSN --value "<dsn>" --visibility plaintext --environment production --environment preview --environment development`
   2. `eas env:create --name SENTRY_ORG --value "<org-slug>" --visibility plaintext --environment production --environment preview --environment development`
   3. `eas env:create --name SENTRY_PROJECT --value "budget" --visibility plaintext --environment production --environment preview --environment development`
   4. `eas env:create --name SENTRY_AUTH_TOKEN --value "<token>" --visibility secret --environment production --environment preview --environment development`
5. **→ tell me**: the next build will upload source maps; I'll check a test crash reaches Sentry with nothing personal in it.

## 4. Buy the domain (10 min)

`realbudget.app` matches the bundle ID you already use. One purchase unblocks the support email, the sending domain and the privacy-policy URL.

1. Decide the public name first if it isn't settled: the store listing needs a qualifier anyway — "Budget" alone is an Avis Budget Group brand (e.g. "Real Budget: Spending Tracker").
2. Buy `realbudget.app` (or your chosen name) at any registrar — Cloudflare Registrar sells at cost and gives you free DNS and email forwarding.
3. Note: `.app` domains only work over HTTPS (the whole TLD is HSTS-preloaded). Every host below serves HTTPS, so this only matters if you point the domain somewhere unusual.

## 5. Support email (15 min)

Apple and Google both check that the support address works, and the privacy policy already names `support@realbudget.app`.

1. Pick a mailbox. Two easy ways:
   - **iCloud+ Custom Email Domain** (you already use iCloud): iCloud Settings → **Custom Email Domain → Add a domain you own**, follow its DNS steps, create `support@realbudget.app`. You can send and receive from Mail.
   - **Cloudflare Email Routing** (free): Cloudflare → your domain → **Email → Email Routing**, route `support@` to your existing inbox. Receiving only.
2. Send a test message to `support@realbudget.app` from another account and check it arrives.
3. If you chose a different domain or address, tell me and I'll update `PRIVACY.md` and the in-app "no mail app" message.

## 6. Sending domain for password reset and verification mail (20 min + DNS time)

1. resend.com → **Domains → Add Domain** → `realbudget.app` (or a subdomain like `mail.realbudget.app`, which keeps app mail apart from your support inbox).
2. Add the DNS records Resend shows (SPF, DKIM, and the MX for bounces) at your DNS host. Add a DMARC record too: `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:support@realbudget.app`.
3. Wait for Resend to show **Verified** (minutes to a few hours).
4. Resend → **API Keys → Create**, sending access only.
5. Railway → Budget → Variables: `RESEND_API_KEY` = that key, `EMAIL_FROM` = `Real Budget <no-reply@realbudget.app>`.
6. Check: in the app, sign-in → **Forgot password?** with your own account; the email should arrive within a minute and its link should open the app. Then Settings → **Send link** for verification.

## 7. Host the privacy policy (20 min)

The listing needs a public URL, and App Review compares it with what the app does. The repo already has `.github/workflows/publish-privacy.yml`, which builds a page from `PRIVACY.md`, but this repo is private and GitHub Pages won't publish from a private repo on the free plan. Pick one:

1. **Easiest — a small public repo:**
   1. Create a public GitHub repo, e.g. `symow07/realbudget-site`.
   2. Ask me to set it up: I'll copy the generated page there and keep it in sync from this repo's workflow.
   3. Repo → **Settings → Pages** → deploy from the `main` branch; add the custom domain `realbudget.app` (or `www.`), tick **Enforce HTTPS**, and add the DNS records GitHub shows.
2. **Or — serve it from the backend:** say so and I'll add a `/privacy` page to the API, served at the Railway URL or a custom domain on the Budget service (Railway → Budget → Settings → Networking → Custom Domain).
3. Check: open `https://realbudget.app/privacy` (or the URL you chose) on your phone. Use that URL in sections 9 and 10.

## 8. First device build and a walk-through on your iPhone (30–60 min) → tell me

I tried it on 12 October (`eas build --profile preview --platform ios --non-interactive`): it stops at "couldn't find any credentials suitable for internal distribution", because no device build has ever been set up. The first run has to be interactive, with your Apple sign-in. After that I can start builds myself.

1. Give EAS builds the RevenueCat public SDK keys (they're in your local `mobile/.env`, which EAS doesn't upload; public SDK keys aren't secret). In `mobile/`:
   1. `eas env:create --name EXPO_PUBLIC_REVENUECAT_APPLE_KEY --value "<appl_… key>" --visibility plaintext --environment preview --environment production`
   2. `eas env:create --name EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY --value "<goog_… key>" --visibility plaintext --environment preview --environment production`
   Without them the app runs, but Pro and the paywall are switched off in that build.
2. Register your iPhone with EAS: in `mobile/`, run `eas device:create`, choose **Website**, open the link it prints on your iPhone and install the profile it offers.
3. Run `eas build --profile preview --platform ios` (interactive). When it asks, sign in with your Apple Developer account and let EAS create the distribution certificate and the ad hoc provisioning profile (it includes the device you just registered). The App Group `group.com.realbudget.app` must be enabled for the App ID and the share extension — EAS will offer to do it.
4. When the build finishes, open its page (it prints a link and a QR code) on your iPhone and install.
5. Walk it, especially what the simulator can't test:
   1. Sign up, onboarding, add an expense, sign out and back in (data comes back).
   2. **Face ID** lock (Settings → security), then background and return.
   3. **Notifications**: allow them; add a bill due today and wait for the reminder; the quick-add notification action.
   4. **Share sheet**: share a receipt photo from Photos to Budget.
   5. **Siri**: "Log 5 dollars for coffee in Budget".
   6. **Voice**: hold to speak a spending.
   7. **Business mode**: create a business, add an expense, check Approve isn't offered on your own.
   8. Airplane mode: add a bill and a budget, turn it off again, check they sync.
6. **→ tell me** what you saw, with a screenshot of anything wrong.

## 9. App Store Connect listing (1–2 hours)

1. appstoreconnect.apple.com → **Apps → + → New App**: platform iOS, name (with the qualifier from §4), primary language, bundle ID `com.realbudget.app`, SKU (any, e.g. `realbudget-ios`).
2. **App Information**: category **Finance**; content rights; age rating questionnaire (no objectionable content → 4+).
3. **App Privacy**: privacy policy URL from §7; data types, matching `PRIVACY.md`: contact info (email, name), financial info (transactions, bank data via Plaid), user content (emailed receipts, photos you scan), identifiers (user ID), and **Diagnostics → Crash Data** (Sentry, through the account's random ID only) — all **linked to the user** (Apple counts a random account ID as linking), **not used for tracking**.
4. **Pricing and Availability**: free, with in-app subscriptions (§11); choose countries.
5. **Prepare for Submission**: screenshots at 6.9" (1320×2868) — I can produce them from the simulator if you tell me which screens; description, keywords, support URL (`https://realbudget.app` or the privacy page), marketing URL optional.
6. **App Review Information**: a demo account (create one in the app; give its email and password only in this form), and a note: "Bank linking needs Plaid; statement import is the main path."
7. **Export compliance**: the app uses only standard HTTPS encryption → answer that it qualifies for the exemption (add `ITSAppUsesNonExemptEncryption = false` — tell me and I'll set it in `app.json` so you're not asked on every build).
8. Upload a production build: `eas build --profile production --platform ios`, then `eas submit --platform ios`, or download from EAS and upload with Transporter. Test it in **TestFlight** first.

## 10. Google Play Console listing (1–2 hours, plus a 14-day test if your account is new)

1. play.google.com/console → **Create app**: name, default language, App, Free.
2. **Store listing**: short and full description, icon 512×512, feature graphic 1024×500, phone screenshots.
3. **App content**: privacy policy URL (§7); **Data safety** form matching `PRIVACY.md` (include **App info and performance → Crash logs**, collected, not shared, for analytics/app functionality); **Financial features** declaration (personal finance / budgeting, no lending); content rating questionnaire; target audience 18+; ads: none; **App access**: the demo account.
4. If your developer account is a **personal** account created after November 2023, Google requires a **closed test with at least 12 testers opted in for 14 days** before you can publish to production — start this early.
5. Build and upload: `eas build --profile production --platform android` (an `.aab`), upload it to the internal testing track first. For `eas submit`, create a Google service account with Play Console access and give EAS its JSON key when asked.

## 11. Pro subscription products (1–2 hours)

The app needs no product IDs in code; it sells whatever is in RevenueCat's **Current** offering, attached to the entitlement **`pro`**.

1. App Store Connect → your app → **Subscriptions**: create a subscription group (e.g. "Real Budget Pro") with monthly and yearly products, prices, and a review screenshot each.
2. Play Console → **Monetize → Subscriptions**: the same products (if Android ships).
3. RevenueCat → your project → **Apps**: add the iOS app (shared secret / App Store Connect API key) and the Android app (service-account key).
4. **Products**: import the store products; also add **Test Store** products so development builds show prices.
5. **Entitlements**: create `pro` (exactly that identifier) and attach every product.
6. **Offerings**: create one, add monthly and yearly packages, mark it **Current**, attach a **Paywall**.
7. **Integrations → Webhooks**: URL `https://budget-production-5a9d.up.railway.app/api/v1/revenuecat/webhook`, Authorization header = the `REVENUECAT_WEBHOOK_SECRET` you set in §3; also set `REVENUECAT_API_KEY` (secret key) on Railway.
8. Check with a sandbox tester: Settings → Upgrade to Pro shows the paywall with prices; after buying, the advisor and bank linking unlock; reinstalling and tapping **Restore** brings Pro back.

## 12. Optional, not a launch blocker: Plaid production

Statement import is the main path; bank sync is a per-country extra and degrades gracefully when Plaid isn't configured.

1. dashboard.plaid.com → **Production access**: company details and the security questionnaire. It takes days to weeks; apply now, launch without it.
2. When approved, set `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production` on Railway.
