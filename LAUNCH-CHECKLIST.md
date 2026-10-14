# Launch checklist — the steps only you can do

_12 October 2026, §13 added 13 October 2026. Everything the code needs is done or in flight; what is left needs your accounts, your money or your phone. Do the sections in order: later ones depend on earlier ones. Tell me when you finish a step marked **→ tell me**, and I'll take the next part._

Identifiers you'll need throughout: bundle ID / package **`com.latchet.app`**, App Group **`group.com.latchet.app`**, Expo project **`@symow/latchet`**, Railway project **latchet**, service **Latchet**, production URL `https://latchet-production.up.railway.app`.

**TODO(domain):** `latchet.app` — the support and no-reply addresses, the website and the privacy-policy URL below — is a placeholder until the domain is bought in §4. Every line that uses it carries a `TODO(domain)` mark; if you buy a different domain, change those lines.

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

1. Railway → project **latchet** → service **Latchet** → **Settings → Volumes**.
2. Find the volume mounted at **`/data`**: that is the old SQLite one. (Not `postgres-volume` — that one belongs to the **Postgres** service and holds the live database.)
3. **Detach** it from the Latchet service and let the service redeploy.
4. Check the deploy is green and `https://latchet-production.up.railway.app/health` returns `{"status":"ok"}`.
5. Then open the detached volume and **Delete** it.

## 3. Set the production keys on Railway (10 min, one restart) → tell me

Today the Latchet service has only `BACKEND_URL`, `BETTER_AUTH_SECRET`, `DATABASE_URL` and `NODE_ENV`.

1. Railway → **Latchet → Variables → New Variable**, add:
   - `OPENAI_API_KEY` — a real key from platform.openai.com. Without it the advisor, receipt scan and PDF import answer 503. Email detection works without it (rules first); with it, AI also reads the billing emails the rules can't (at most 40 a user a day).
   - `TOKEN_ENCRYPTION_KEY` — generate with `openssl rand -base64 48`. Back it up in your password manager; it cannot be rotated later without re-encrypting bank tokens.
   - `RESEND_API_KEY` and `EMAIL_FROM` — after section 6.
   - `REVENUECAT_WEBHOOK_SECRET` (16+ characters, any random string) and `REVENUECAT_API_KEY` (RevenueCat secret API key) — during section 10.
2. Apply the changes (one redeploy).
3. **→ tell me** once `OPENAI_API_KEY` is set: I'll run the live advisor safety tests through `railway run`, which injects the key without anyone reading it.

## 3a. Crash reporting with Sentry (15 min) — before the first device build

The app reports crashes to Sentry once it has a DSN, and sends no personal data (PRIVACY.md lists exactly what). Until you do this, builds work and simply report nothing.

1. sentry.io → create a free account and organization → **Projects → Create Project → React Native**, name it `latchet`.
2. Project → **Settings → Security & Privacy**: turn on **Prevent Storing of IP Addresses**; keep **Data Scrubber** and **Use Default Scrubbers** on.
3. Copy the project's **DSN** (Settings → Client Keys). Create an **auth token**: Settings → Developer Settings → Organization Tokens → Create (it uploads source maps so crashes show readable code).
4. In `mobile/`, store them as EAS environment variables (replace the `<…>`):
   1. `eas env:create --name EXPO_PUBLIC_SENTRY_DSN --value "<dsn>" --visibility plaintext --environment production --environment preview --environment development`
   2. `eas env:create --name SENTRY_ORG --value "<org-slug>" --visibility plaintext --environment production --environment preview --environment development`
   3. `eas env:create --name SENTRY_PROJECT --value "latchet" --visibility plaintext --environment production --environment preview --environment development`
   4. `eas env:create --name SENTRY_AUTH_TOKEN --value "<token>" --visibility secret --environment production --environment preview --environment development`
5. **→ tell me**: the next build will upload source maps; I'll check a test crash reaches Sentry with nothing personal in it.

## 4. Buy the domain (10 min)

`latchet.app` matches the bundle ID you already use. One purchase unblocks the support email, the sending domain and the privacy-policy URL. <!-- TODO(domain) -->

1. Buy `latchet.app` (or another domain if it is taken) at any registrar — Cloudflare Registrar sells at cost and gives you free DNS and email forwarding. <!-- TODO(domain) -->
2. Note: `.app` domains only work over HTTPS (the whole TLD is HSTS-preloaded). Every host below serves HTTPS, so this only matters if you point the domain somewhere unusual.

## 5. Support email (15 min)

Apple and Google both check that the support address works, and the privacy policy already names `support@latchet.app`. <!-- TODO(domain) -->

1. Pick a mailbox. Two easy ways:
   - **iCloud+ Custom Email Domain** (you already use iCloud): iCloud Settings → **Custom Email Domain → Add a domain you own**, follow its DNS steps, create `support@latchet.app`. You can send and receive from Mail. <!-- TODO(domain) -->
   - **Cloudflare Email Routing** (free): Cloudflare → your domain → **Email → Email Routing**, route `support@` to your existing inbox. Receiving only.
2. Send a test message to `support@latchet.app` from another account and check it arrives. <!-- TODO(domain) -->
3. If you chose a different domain or address, tell me and I'll update `PRIVACY.md` and the in-app "no mail app" message.

## 6. Sending domain for password reset and verification mail (20 min + DNS time)

1. resend.com → **Domains → Add Domain** → `latchet.app` (or a subdomain like `mail.latchet.app`, which keeps app mail apart from your support inbox). <!-- TODO(domain) -->
2. Add the DNS records Resend shows (SPF, DKIM, and the MX for bounces) at your DNS host. Add a DMARC record too: `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:support@latchet.app`. <!-- TODO(domain) -->
3. Wait for Resend to show **Verified** (minutes to a few hours).
4. Resend → **API Keys → Create**, sending access only.
5. Railway → Latchet → Variables: `RESEND_API_KEY` = that key, `EMAIL_FROM` = `Latchet <no-reply@latchet.app>`. <!-- TODO(domain) -->
6. Check: in the app, sign-in → **Forgot password?** with your own account; the email should arrive within a minute and its link should open the app. Then Settings → **Send link** for verification.

## 7. Host the privacy policy (20 min)

The listing needs a public URL, and App Review compares it with what the app does. The repo already has `.github/workflows/publish-privacy.yml`, which builds a page from `PRIVACY.md`, but this repo is private and GitHub Pages won't publish from a private repo on the free plan. Pick one:

1. **Easiest — a small public repo:**
   1. Create a public GitHub repo, e.g. `symow07/latchet-site`.
   2. Ask me to set it up: I'll copy the generated page there and keep it in sync from this repo's workflow.
   3. Repo → **Settings → Pages** → deploy from the `main` branch; add the custom domain `latchet.app` (or `www.`), tick **Enforce HTTPS**, and add the DNS records GitHub shows. <!-- TODO(domain) -->
2. **Or — serve it from the backend:** say so and I'll add a `/privacy` page to the API, served at the Railway URL or a custom domain on the Latchet service (Railway → Latchet → Settings → Networking → Custom Domain).
3. Check: open `https://latchet.app/privacy` (or the URL you chose) on your phone. Use that URL in sections 9 and 10. <!-- TODO(domain) -->

## 8. First device build and a walk-through on your iPhone (30–60 min) → tell me

I tried it on 12 October (`eas build --profile preview --platform ios --non-interactive`): it stops at "couldn't find any credentials suitable for internal distribution", because no device build has ever been set up. The first run has to be interactive, with your Apple sign-in. After that I can start builds myself.

1. Give EAS builds the RevenueCat public SDK keys (they're in your local `mobile/.env`, which EAS doesn't upload; public SDK keys aren't secret). In `mobile/`:
   1. `eas env:create --name EXPO_PUBLIC_REVENUECAT_APPLE_KEY --value "<appl_… key>" --visibility plaintext --environment preview --environment production`
   2. `eas env:create --name EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY --value "<goog_… key>" --visibility plaintext --environment preview --environment production`
   Without them the app runs, but Pro and the paywall are switched off in that build.
2. Register your iPhone with EAS: in `mobile/`, run `eas device:create`, choose **Website**, open the link it prints on your iPhone and install the profile it offers.
3. Run `eas build --profile preview --platform ios` (interactive). When it asks, sign in with your Apple Developer account and let EAS create the distribution certificate and the ad hoc provisioning profile (it includes the device you just registered). The App Group `group.com.latchet.app` must be enabled for the App ID and the share extension — EAS will offer to do it.
4. When the build finishes, open its page (it prints a link and a QR code) on your iPhone and install.
5. Walk it, especially what the simulator can't test:
   1. Sign up, onboarding, add an expense, sign out and back in (data comes back).
   2. **Face ID** lock (Settings → security), then background and return.
   3. **Notifications**: allow them; add a bill due today and wait for the reminder; the quick-add notification action.
   4. **Share sheet**: share a receipt photo from Photos to Latchet.
   5. **Siri**: "Log 5 dollars for coffee in Latchet".
   6. **Voice**: hold to speak a spending.
   7. **Business mode**: create a business, add an expense, check Approve isn't offered on your own.
   8. Airplane mode: add a bill and a budget, turn it off again, check they sync.
6. **→ tell me** what you saw, with a screenshot of anything wrong.

## 9. App Store Connect listing (1–2 hours)

1. appstoreconnect.apple.com → **Apps → + → New App**: platform iOS, name **Latchet**, primary language, bundle ID `com.latchet.app`, SKU (any, e.g. `latchet-ios`).
2. **App Information**: category **Finance**; content rights; age rating questionnaire (no objectionable content → 4+).
3. **App Privacy**: privacy policy URL from §7; data types, matching `PRIVACY.md`: contact info (email, name), financial info (transactions, bank data via Plaid), user content (emailed receipts, photos you scan), identifiers (user ID), and **Diagnostics → Crash Data** (Sentry, through the account's random ID only) — all **linked to the user** (Apple counts a random account ID as linking), **not used for tracking**.
4. **Pricing and Availability**: free, with in-app subscriptions (§11); choose countries.
5. **Prepare for Submission**: screenshots at 6.9" (1320×2868) — I can produce them from the simulator if you tell me which screens; description, keywords, support URL (`https://latchet.app` or the privacy page), marketing URL optional. <!-- TODO(domain) -->
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

1. App Store Connect → your app → **Subscriptions**: create a subscription group (e.g. "Latchet Pro") with monthly and yearly products, prices, and a review screenshot each.
2. Play Console → **Monetize → Subscriptions**: the same products (if Android ships).
3. RevenueCat → your project → **Apps**: add the iOS app (shared secret / App Store Connect API key) and the Android app (service-account key).
4. **Products**: import the store products; also add **Test Store** products so development builds show prices.
5. **Entitlements**: create `pro` (exactly that identifier) and attach every product.
6. **Offerings**: create one, add monthly and yearly packages, mark it **Current**, attach a **Paywall**.
7. **Integrations → Webhooks**: URL `https://latchet-production.up.railway.app/api/v1/revenuecat/webhook`, Authorization header = the `REVENUECAT_WEBHOOK_SECRET` you set in §3; also set `REVENUECAT_API_KEY` (secret key) on Railway.
8. Check with a sandbox tester: Settings → Upgrade to Pro shows the paywall with prices; after buying, the advisor and bank linking unlock; reinstalling and tapping **Restore** brings Pro back.

## 12. Optional, not a launch blocker: Plaid production

Statement import is the main path; bank sync is a per-country extra and degrades gracefully when Plaid isn't configured.

1. dashboard.plaid.com → **Production access**: company details and the security questionnaire. It takes days to weeks; apply now, launch without it.
2. When approved, set `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production` on Railway.

## 13. Switch on automatic detection: each source, its keys (free tiers)

Each source is off until its keys exist, and the app says so instead of failing. Do them in any order. Generate `TOKEN_ENCRYPTION_KEY` once (`openssl rand -base64 48`), keep it in your password manager, and use the same value everywhere: it encrypts Plaid, Gmail and Outlook tokens, and changing it later means everyone reconnects.

### 13a. Bank linking on Plaid's free sandbox → tell me
1. dashboard.plaid.com → sign up (free) → **Developers → Keys**: copy the **client_id** and the **Sandbox** secret.
2. In `backend/.env` (local only for now):
   `PLAID_CLIENT_ID=…`, `PLAID_SECRET=…` (the sandbox secret), `PLAID_ENV=sandbox`,
   `PLAID_COUNTRY_CODES=US,CA,GB,AT,BE,DK,EE,FI,FR,DE,IE,IT,LV,LT,NL,NO,PL,PT,ES,SE`,
   `TOKEN_ENCRYPTION_KEY=…`, and `DEV_PRO_OVERRIDE=true` (development only: everyone counts as Pro so bank linking opens without a purchase; ignored in production).
3. In `mobile/.env`: `EXPO_PUBLIC_DEV_PRO=true` (ignored in release builds).
4. **→ tell me**: I run the whole sandbox flow on the simulator (link with Plaid's test login `user_good` / `pass_good`, accounts appear, transactions sync, detection runs, disconnect with keep and with delete).
5. Production later is §12. Each region (US/Canada, UK, EU) must also be enabled for your Plaid account.

### 13b. Gmail inbox reading (free, unverified, at most 100 users)
1. console.cloud.google.com → create a project ("Latchet").
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **Google Auth Platform → Branding**: app name "Latchet", your support email, your developer email.
4. **Audience**: user type **External**, then **Publish app** so the status is **In production**. Do not leave it in **Testing**: there Google expires every connection after 7 days and only hand-listed test users can connect.
5. **Data Access → Add or remove scopes**: add `https://www.googleapis.com/auth/gmail.readonly` and nothing else.
6. **Clients → Create client → Web application**. Authorized redirect URIs:
   `https://latchet-production.up.railway.app/api/v1/email/oauth/gmail/callback` and, for testing, `http://localhost:3000/api/v1/email/oauth/gmail/callback`.
   If Google refuses the railway.app address, put the backend on your own domain first (Railway → Latchet → Settings → Custom domain, e.g. `api.yourdomain`), set `BACKEND_URL` to it, and register that callback instead. You will need that domain for verification anyway.
7. Railway → Latchet → Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_USER_CAP=90` (headroom under Google's 100: your own test accounts count there and not in ours), `TOKEN_ENCRYPTION_KEY`.
8. What users see: Google's "Google hasn't verified this app" screen. The app explains it before opening Google's page (Advanced → Go to Latchet). Past the cap, the app points people to forwarding.
9. Later, with budget: `docs/verification/` (Google verification, the CASA assessment, the demo video). When Google approves, set `GOOGLE_OAUTH_VERIFIED=true`; nothing else changes.

### 13c. Outlook inbox reading (free, no cap)
1. entra.microsoft.com → sign in with a **work or school** account. A free Azure account gives you a tenant; Microsoft no longer lets a personal Microsoft account own app registrations.
2. **App registrations → New registration**: name "Latchet"; supported account types **Personal Microsoft accounts only**; redirect URI, platform **Web**: `https://latchet-production.up.railway.app/api/v1/email/oauth/outlook/callback`. Add `http://localhost:3000/api/v1/email/oauth/outlook/callback` under **Authentication** for testing.
3. **API permissions → Add → Microsoft Graph → Delegated**: `Mail.Read`, `offline_access`, `openid`, `email`. No admin consent is needed.
4. **Certificates & secrets → New client secret**: copy the **Value** at once. It expires (at most 24 months); put the date in your calendar.
5. Railway: `MICROSOFT_CLIENT_ID` (the Application (client) ID), `MICROSOFT_CLIENT_SECRET` (the secret's value). `MICROSOFT_TENANT` stays `consumers`.
6. Users see "unverified" on Microsoft's prompt until publisher verification (`docs/verification/microsoft-publisher-verification.md`, needs a registered business); personal accounts can still consent.

### 13d. Forwarding, the backup for iCloud, Yahoo, GMX (free)
Needs your domain on Cloudflare (§4). Follow `backend/docs/inbound-email-setup.md` step by step: a shared secret, `INBOUND_EMAIL_DOMAIN` and `INBOUND_EMAIL_SECRET` on Railway, Email Routing, the worker with its `PARKED` KV namespace (so mail waits instead of bouncing while the backend sleeps), and the end-to-end check.

### 13e. Keeping email current while the app is closed (optional, costs money)
The Latchet service sleeps when idle (Railway **App Sleeping**). Mail is still synced every time someone opens the app, and reminders already scheduled on the phone fire regardless. To also sync inboxes in the background, turn App Sleeping off in Railway → Latchet → Settings (the service then bills for the hours it runs).

