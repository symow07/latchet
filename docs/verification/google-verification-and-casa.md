# Google OAuth verification and the CASA security assessment

This is the checklist for taking Real Budget's Gmail connection from Google's
unverified mode to verified. Do it when there is budget for the security
assessment (section 8) or when the 100-user cap gets close (section 2).

Everything below was checked against Google's pages on **12 October 2026**.
Each claim links to its source. Where a page has moved or changed, trust the
page over this document, and update this document.

Contents:

1. [Where Budget stands today](#1-where-budget-stands-today)
2. [Keeping the 100-user cap safe meanwhile](#2-keeping-the-100-user-cap-safe-meanwhile)
3. [Prerequisites](#3-prerequisites)
4. [The console fields](#4-the-console-fields)
5. [Scope justification for gmail.readonly](#5-scope-justification-for-gmailreadonly)
6. [The demo video](#6-the-demo-video)
7. [Submitting](#7-submitting)
8. [CASA, the security assessment](#8-casa-the-security-assessment)
9. [What to expect back, and after approval](#9-what-to-expect-back-and-after-approval)
10. [Sources](#10-sources)

---

## 1. Where Budget stands today

**The scope.** Budget asks for one Google scope:
`https://www.googleapis.com/auth/gmail.readonly`. Google classifies it as
**restricted**, the most protected class
([Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)).
Restricted scopes need verification before a public launch, unless the app
qualifies for an exception such as personal use or staying in Testing
([Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).

**The two publishing statuses**
([Manage App Audience](https://support.google.com/cloud/answer/15549945)):

| | Testing | In production, unverified (Budget today) |
|---|---|---|
| Who can connect | Only the test users you list by hand, up to 100 | Anyone with a Google account, up to the cap below |
| Warning | Yes | Yes: Google's "unverified app" screen appears before the consent screen ([Unverified apps](https://support.google.com/cloud/answer/7454865)) |
| Refresh tokens | **Expire after 7 days** when the app requests sensitive or restricted scopes ([OAuth 2.0 overview, refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)) | Do not expire on a timer; they stop working if the user revokes access, if they go unused for six months, or if the user changes their Google password, because the token carries Gmail scopes (same page) |
| User cap | The 100 listed test users | **100 new users in total, for the lifetime of the project; Google says it "cannot be reset or changed"** ([Manage App Audience](https://support.google.com/cloud/answer/15549945)) |

Budget runs **In production, unverified**. Testing would break every Gmail
connection each week, because Budget reads mail in the background with a
refresh token.

**What turns verification on in the app:** `GOOGLE_OAUTH_VERIFIED` in
`backend/src/env.ts`. While it is `false` (the default), Budget enforces its own
cap (`GMAIL_USER_CAP`, default `100`) and the app explains Google's warning.
Set it to `true` only after Google approves (section 9).

## 2. Keeping the 100-user cap safe meanwhile

Google counts **Google accounts** that pass the unverified screen: "100 new
users in total, after the app presents the unverified app screen"
([Unverified apps](https://support.google.com/cloud/answer/7454865)). The count
never resets. Budget counts **Budget users**: the first successful Gmail grant
for a user writes one `EmailOAuthGrant` row (provider `gmail`, a SHA-256 of the
user ID). The row survives account deletion, as Google's count does. Once the
count reaches `GMAIL_USER_CAP`, `GET /api/v1/email/connections` reports
`providers.gmail.capReached: true` and `POST /connect/gmail` answers
`409 cap_reached`. The app then offers Outlook and forwarding instead.

The two counts can disagree, and only one direction is dangerous:

| Situation | Google's count | Budget's count | Risk |
|---|---|---|---|
| One Budget user connects two Gmail addresses | +2 | +1 | **Budget under-counts** |
| You test with your own Google accounts on the production client | +1 each | +1 per Budget test user | **Budget may under-count** |
| A user deletes their Budget account, signs up again, reconnects the same Gmail | +0 | +1 | Budget over-counts (safe) |
| A user disconnects and reconnects | +0 | +0 | none |

Google does not say whether someone who sees the unverified screen and then
cancels counts. Assume they might.

What to do:

- **Leave headroom.** Set `GMAIL_USER_CAP=90` in Railway → Budget → Variables.
  That keeps about ten Google slots for multi-inbox users and your own tests.
  Lower it further if you test a lot on the production client.
- **Never develop against the production OAuth client.** Google's own advice is
  a separate project for production
  ([OAuth 2.0 policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)).
  Create a second Cloud project for development, leave it in **Testing**, list
  yourself as a test user, and put its client in your local `.env`. The 7-day
  expiry does not matter for development.
- **Keep the scopes in the code and on the Data Access page identical.** If they
  differ, Google shows the unverified screen even after verification
  ([Unverified apps](https://support.google.com/cloud/answer/7454865)).
- **Watch the count.** Count the `EmailOAuthGrant` rows with
  `provider = 'gmail'` in Postgres. Start the steps below when the count passes
  about 60, because Google's restricted-scope review takes weeks (section 7).

## 3. Prerequisites

Do these before opening the Verification Center. Each one is a common reason for
rejection.

- [ ] **Your own domain**, for example `realbudget.app` (LAUNCH-CHECKLIST §4).
  Do not use shared provider domains you don't own, such as `github.io` or
  `up.railway.app`
  ([OAuth 2.0 policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)).
- [ ] **A public homepage on that domain.** It must be reachable without signing
  in, must describe what the app does, and "can not be only a login page"
  ([Verification requirements](https://support.google.com/cloud/answer/13464321)).
  It must link to the privacy policy. The copy is in `homepage-content.md`.
- [ ] **The privacy policy on the same domain**, linked from the homepage, and
  the **same URL** entered on the consent screen
  ([Verification requirements](https://support.google.com/cloud/answer/13464321)).
  It must say how the app "accesses, uses, stores, and/or shares Google user
  data", and must carry the Limited Use statement. `PRIVACY.md` already does
  both. Publish it at, for example, `https://realbudget.app/privacy`
  (LAUNCH-CHECKLIST §7).
- [ ] **The OAuth callback on your domain.** Google verifies every domain tied
  to the project: homepage, privacy policy, terms, **redirect URIs** and
  JavaScript origins
  ([OAuth 2.0 policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)).
  Give the Budget service a custom domain in Railway (Settings → Networking →
  Custom Domain), for example `api.realbudget.app`. Then set `BACKEND_URL` to
  `https://api.realbudget.app` and register
  `https://api.realbudget.app/api/v1/email/oauth/gmail/callback` on the OAuth
  client. Remove the `up.railway.app` redirect URI from the OAuth client once
  the new one works, but keep the `up.railway.app` domain itself serving: app
  builds already installed call it, and bank links made earlier have their Plaid
  webhook set to the old `BACKEND_URL`. Redirect URIs must be HTTPS.
- [ ] **Search Console verification of the domain**, done by a Google account
  that is an Owner or Editor of the Cloud project
  ([Unverified apps](https://support.google.com/cloud/answer/7454865)). Add a
  **Domain** property, add the TXT record Search Console gives you at your DNS
  host, and click Verify. DNS can take "up to two or three days". **Keep the
  record**: removing it can lose the verification
  ([Verify your site ownership](https://support.google.com/webmasters/answer/9008080)).
- [ ] **A support email that works**, for example `support@realbudget.app`
  (LAUNCH-CHECKLIST §5). Users see it on the consent screen.
- [ ] **Developer contact emails that you read.** Google sends every request
  and deadline to the project's Owners and Editors and warns that ignoring them
  "could result in the loss of access to the Google APIs"
  ([OAuth 2.0 policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)).
  Add a second Google account as Owner so the annual recertification mail
  cannot be missed
  ([Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
- [ ] **One app name everywhere**: consent screen, homepage, store listings and
  the demo video. The name is still undecided (see the TODO in `PRIVACY.md`).
  Settle it before submitting, because changing the product name after
  verification can trigger re-verification
  ([Unverified apps](https://support.google.com/cloud/answer/7454865)).
- [ ] **A production-only OAuth client.** Production clients must not include
  test redirect URIs or origins that only you can reach
  ([OAuth 2.0 policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)).
  Remove `localhost` and Expo URIs from the production client.
- [ ] **Budget's own house in order** for CASA (section 8): `TOKEN_ENCRYPTION_KEY`
  set explicitly in production, not derived from `BETTER_AUTH_SECRET`.

## 4. The console fields

Google Cloud console → **Google Auth Platform**. It has Branding, Audience,
Data Access, Clients and the Verification Center
([Get started with the Google Auth Platform](https://support.google.com/cloud/answer/15544987)).

**Branding** ([Manage OAuth App Branding](https://support.google.com/cloud/answer/15549049)):

| Field | Value |
|---|---|
| App name | The final app name, for example `Real Budget` |
| User support email | `support@realbudget.app` |
| App logo | Optional: the app icon, square, 120×120 px recommended, at most 1 MB, JPG, PNG or BMP. Google shows the logo (and the name) only once the brand is verified. |
| Application home page | `https://realbudget.app` |
| Application privacy policy link | `https://realbudget.app/privacy` (the same page the homepage links to) |
| Application terms of service link | Optional; leave empty unless you publish terms |
| Authorized domains | `realbudget.app` (it covers `api.realbudget.app`) |
| Developer contact information | Two addresses you read |

**Audience:** User type **External**. Publishing status **In production**.

**Data Access:** add exactly one scope,
`https://www.googleapis.com/auth/gmail.readonly`. Do not add `openid`, `email`,
`profile` or anything else unless the code requests it. The list here must match
the code's authorization request exactly.

**Clients:** one OAuth client of type **Web application**. Its authorized
redirect URI is `${BACKEND_URL}/api/v1/email/oauth/gmail/callback`. Its ID and
secret are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on Railway.

**"What features will you use?"** In the verification request, Google asks you
to pick an application type. If none fits, leave it empty and "the Google API's
verification team will then determine the application type"
([Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
Budget matches the Gmail use case Google permits as "applications that use
information from emails to provide reporting or monitoring services for the
benefit of users", the same family as flight and package tracking
([Google Workspace API user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)).
Budget is not an email client, a backup tool or a one-time export. The policy
names the last one as **not** permitted.

## 5. Scope justification for gmail.readonly

Google asks for "a detailed justification that explains why narrower scopes
would not work"
([Verification requirements](https://support.google.com/cloud/answer/13464321)).
Paste the text below into the Data Access justification field. Edit it if the
code has changed.

> **What the feature does.** Real Budget is a personal-finance app. Its
> subscription tracker finds the recurring charges and free trials a user has
> forgotten and warns them before the next charge. When the user connects
> Gmail, our server searches the user's mailbox for billing email from the past
> 12 months (receipts, invoices, renewal notices, trial-ending notices, price
> changes and cancellations), then checks new mail periodically. From each
> billing email it extracts the merchant, amount, currency, billing cycle and
> dates. The app turns these into the user's subscription list and schedules
> reminders before each renewal or trial end. This is a reporting and
> monitoring service for the user's benefit, shown prominently in the app's
> Subscriptions and Email screens.
>
> **Why gmail.readonly, and why narrower scopes do not work.**
> - `gmail.metadata` gives labels and headers but not the body. The amount, the
>   next charge date and the trial end date are in the body, often in an HTML
>   table or a PDF invoice. Also, the Gmail API's `q` search parameter "cannot be
>   used when accessing the api using the gmail.metadata scope". Without search
>   we would have to list every message in the mailbox and read headers one by
>   one. That is more access, not less.
> - The `gmail.addons.current.message.*` scopes work only while a Google
>   Workspace add-on is running inside Gmail, on the message the user has open.
>   Budget is a mobile app that has to notice a renewal or trial-ending notice
>   in the background, before the charge, without the user opening that email.
> - Apart from these and `gmail.labels` (label names only), there is no
>   narrower way to read mail. We never request `gmail.modify`,
>   `gmail.compose`, `gmail.send` or full `mail.google.com` access. Budget never
>   sends, deletes, labels or changes any email.
>
> **How we limit what we touch.** The search query is restricted to billing
> terms and to the past year. Each result's sender and subject are checked
> before the message is opened, and only billing-looking messages are fetched
> in full. Messages are parsed in memory on our server. We store only the
> extracted fields (merchant, sender's domain, amount, currency, billing cycle,
> dates and kind of email), never the body, attachments, the subject line as
> written, or any email address apart from the connected account's own. OAuth
> tokens are encrypted at rest with AES-256-GCM. Disconnecting revokes the
> token with Google and deletes every finding. Deleting the Real Budget
> account does the same.
>
> **Limited Use.** Data is used only for this user-facing feature. It is never
> sold, never used for advertising, never used to decide creditworthiness or
> lending, and never used to train AI models. No human reads it. If AI parsing
> is enabled, the text of a billing email our rules cannot parse is sent to
> OpenAI's API to extract the same fields. OpenAI does not use API data for
> training. The user is told about this before they connect. Our privacy policy
> states that our use and transfer of information received from Google APIs
> adheres to the Google API Services User Data Policy, including the Limited
> Use requirements.

Sources for the technical claims in that text: the `q` parameter restriction
([users.messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list));
`FULL` and `RAW` formats are not available under `gmail.metadata`
([Format](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format));
add-on scopes apply only while the add-on runs
([Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes));
OpenAI does not train on API data by default
([OpenAI, your data](https://developers.openai.com/api/docs/guides/your-data)).

Before pasting it, check three claims against the code in
`backend/src/lib/email-providers/` and `backend/src/jobs/email-sync.ts`: the
search really is limited to billing terms and the past year, each message's
sender and subject are checked before the full message is fetched, and the
authorization request asks for `gmail.readonly` alone. If the code does
something different, correct the text to match the code. Google compares the
two.

## 6. The demo video

The shot list is in [`demo-video-script.md`](demo-video-script.md). Google's
requirements, summarised from
[Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
and [Demo video](https://support.google.com/cloud/answer/13804565):

- Show the whole OAuth grant flow, in **English**, including the consent screen.
  Set the language selector at the bottom left of the consent screen to English.
- Show the **app name** on the consent screen, and the same app and branding you
  submitted.
- Show the **OAuth client ID in the browser address bar**.
- Show the consent screen with **exactly** the scopes you request.
- Show each feature that uses the scope's data.
- Upload it to YouTube as **unlisted** and paste the link. The help page also
  accepts Google Drive or another accessible link.
- Narration, spoken or as captions, is recommended.

## 7. Submitting

From [Submitting your app for verification](https://support.google.com/cloud/answer/13461325)
and [Get started with the Google Auth Platform](https://support.google.com/cloud/answer/15544987):

1. Make sure the publishing status is **In production**. "Apps in development,
   testing or staging are not applicable for verification."
2. Open the **Verification Center**. It tracks two statuses: **branding** (name,
   logo, links) and **data access** (scopes). Branding must be verified before
   you can request data-access verification.
3. Review the details, add the scope justification (section 5) and the demo
   video link, and click **Submit for verification**.
4. Answer every email from the review team quickly. The timeline depends "on
   developer responsiveness".

How long it takes, from Google's own estimates, which Google says "are not
guaranteed"
([Verification FAQ](https://support.google.com/cloud/answer/13463817)):

| Review | Estimate |
|---|---|
| Brand verification | 2–3 business days |
| Sensitive scope verification | about 10 business days |
| **Restricted scope verification** (Budget) | **about 6 weeks**, mostly the security assessment. The restricted-scope page says "several weeks" and the unverified-apps page warns it can take "several months". |

Brand verification results must be published within 7 days of approval, or you
start again
([Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).

## 8. CASA, the security assessment

**Why Budget needs it.** "If you store or transmit restricted scope data on
servers, then you need to complete a security assessment"
([Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
Budget's server fetches and parses mail (PLAN Decision 2), so there is no
exemption. Only an app that reads Gmail entirely on the phone could avoid it.

**What it is.** The Cloud Application Security Assessment (CASA) of the App
Defense Alliance, based on the OWASP Application Security Verification Standard
(ASVS)
([CASA](https://appdefensealliance.dev/casa);
[Security assessment](https://support.google.com/cloud/answer/13465431)). It
checks that the app "can handle data securely and delete user data on request".
The full requirement list is the
[CASA Specification](https://github.com/appdefensealliance/ASA-WG/blob/main/CASA/CASA%20Specification.md).

**When.** It is "the final step of the restricted scopes review process". "The
Google Trust and Safety team will contact you when it is time to initiate the
security assessment process." Do not buy an assessment before that email
([Security assessment](https://support.google.com/cloud/answer/13465431)).

**Levels.** Google and the Alliance now use **assurance levels**: **AL1** and
**AL2**. Both are "lab tested, lab verified". AL2 is the comprehensive one: the
lab tests the application, its deployment infrastructure and any user-data
storage. **Google, not you, decides the level**, from the scopes, the user count
and other risk signals. The level can rise at renewal, and once an app reaches
AL2 it stays there
([Assurance levels](https://appdefensealliance.dev/casa/casa-tiering);
[Security assessment](https://support.google.com/cloud/answer/13465431)).
Older pages and many vendors still say **Tier 2** (a scan the lab validates) and
**Tier 3** (a full lab penetration test). The level a new, small app gets is
Google's call, and its email tells you. Budget for AL1, and keep AL2's price in
mind.

**Authorised labs.** Labs must be ISO/IEC 17025 accredited and authorised by
the Alliance. On 12 October 2026 the
[authorised labs page](https://www.appdefensealliance.org/certification/authorized-labs)
listed Bishop Fox, DEKRA, Eydle, Leviathan Security, NCC Group, NetSentries,
NowSecure, Prescient Security, TAC Security and ValueMentor. Not every lab
offers CASA, so ask each one.

**Cost.** "Google does not charge the developer any fees for security
assessment"; the price "is agreed on between the developer and the assessor"
([Verification FAQ](https://support.google.com/cloud/answer/13463817)). Prices
vary by lab, level and year. Get two quotes. Published figures:

| Source, date read | Lower level | Higher level |
|---|---|---|
| TAC Security storefront, read 12 Oct 2026 ([casa.tacsecurity.com](https://casa.tacsecurity.com/site/home)) | AL1 Basic **$675** per app (2 revalidation cycles, 2–3 weeks to the letter); AL1 Premium **$855** (unlimited revalidations) | AL2 Enterprise **$5,400** per year |
| Switch Labs comparison of several labs, figures "as of 2024", third-party ([article](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option)) | "Tier 2": about **$540–$1,500+** | "Tier 3": about **$4,500–$8,000+** |

Treat the third-party figures as a range only. Several labs quote on request
only.

**Timeline.** The lab's part is usually a few weeks; TAC states 2–3 weeks to
the letter for AL1, longer if the scan finds issues you must fix and re-scan.
That time sits inside Google's roughly six-week restricted-scope estimate.

**The result.** A **Letter of Validation (LOV)** from the lab. Google's
developer pages also call it a Letter of Assessment (LOA).

**Every 12 months.** "Apps that access restricted scopes are required to
complete a security assessment every 12 months", counted from the previous
letter's date. Google emails the project's Owners and Editors when it is due.
Adding a restricted scope that the last assessment did not cover can force an
earlier reassessment
([Annual recertification](https://support.google.com/cloud/answer/13463816);
[Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)).
Budget the assessment as a yearly cost, not a one-off.

**Getting ready.** Labs test against ASVS-derived requirements. Check these
before the lab does, because a re-scan costs time and sometimes money:

- [ ] Tokens encrypted at rest: Gmail, Outlook and Plaid tokens use AES-256-GCM
      (`backend/src/lib/crypto.ts`). `TOKEN_ENCRYPTION_KEY` is set explicitly in
      production.
- [ ] Nothing sensitive in logs: no tokens, email content, subjects, addresses
      or amounts tied to a person (a project rule; Sentry gets no personal
      data).
- [ ] HTTPS only, including every redirect URI; no plain-HTTP origin.
- [ ] Access control on every `/api/v1/email` route: a session is required, and
      a connection can be read, synced or deleted only by its owner.
- [ ] OAuth state is single-use and expires after 10 minutes (stored in
      `CacheEntry`). PKCE is used where the provider supports it.
- [ ] Rate limits: sign-in attempts (`RateLimitBucket`), and manual sync at
      most once a minute per connection.
- [ ] Deletion on request works end to end: disconnect revokes and deletes the
      findings, account deletion revokes every connection, and the retention job
      runs daily.
- [ ] Dependencies audited, with no known high-severity vulnerabilities in the
      backend.
- [ ] Secrets only in Railway variables, never in the repository.
- [ ] MFA on every account that can reach production: Google Cloud, Railway,
      GitHub, the domain registrar.
- [ ] A test account and a short description of the architecture ready for the
      lab: phone → HTTPS API on Railway → Postgres; Gmail and Microsoft Graph
      called only from the server.

## 9. What to expect back, and after approval

**During review**, Google writes to the project's Owners and Editors. Typical
requests, from the "common issues" Google lists
([Demo video](https://support.google.com/cloud/answer/13804565);
[Verification requirements](https://support.google.com/cloud/answer/13464321)):

- the homepage is not public, is only a login page, or does not explain the app;
- the privacy policy link differs between the homepage and the consent screen,
  or the policy does not describe Google user data;
- the video does not show the client ID, the English consent screen, or how the
  scope's data is used;
- the justification does not explain why a narrower scope would not work;
- a request to narrow the scope.

Fix what they ask and reply in the same thread.

**After approval:**

1. Railway → Budget → Variables: `GOOGLE_OAUTH_VERIFIED=true`. Redeploy.
2. Check: in the app, connect a Google account that has never connected
   before. There should be no unverified warning in Google's screens or in the
   app.
3. Nothing else changes: the same client ID, scope and stored tokens. Existing
   users do not reconnect. `GMAIL_USER_CAP` no longer applies.
4. Put the **12-month** recertification date in the calendar, counted from the
   Letter of Validation.

**Things that send you back to review**: changing the OAuth client, adding a
scope, adding redirect URIs or JavaScript origins, or renaming the product
([Unverified apps](https://support.google.com/cloud/answer/7454865)). Changing
the name, logo or links triggers brand re-review
([Get started with the Google Auth Platform](https://support.google.com/cloud/answer/15544987)).

## 10. Sources

All read on 12 October 2026.

Google:
- Restricted scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- OAuth 2.0 policy compliance: https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- Gmail API scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- users.messages.list (the `q` restriction): https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- Message formats: https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format
- Manage App Audience (Testing vs In production; lifetime cap): https://support.google.com/cloud/answer/15549945
- Unverified apps: https://support.google.com/cloud/answer/7454865
- Refresh token expiration: https://developers.google.com/identity/protocols/oauth2#expiration
- Get started with the Google Auth Platform: https://support.google.com/cloud/answer/15544987
- Manage OAuth App Branding: https://support.google.com/cloud/answer/15549049
- Verification requirements: https://support.google.com/cloud/answer/13464321
- Submitting your app for verification: https://support.google.com/cloud/answer/13461325
- Demo video: https://support.google.com/cloud/answer/13804565
- Verification FAQ (timelines, cost, disclosure example): https://support.google.com/cloud/answer/13463817
- Security assessment: https://support.google.com/cloud/answer/13465431
- Annual recertification: https://support.google.com/cloud/answer/13463816
- Google API Services User Data Policy: https://developers.google.com/terms/api-services-user-data-policy
- Google Workspace API user data and developer policy (Gmail use cases, AI/ML rule): https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- Search Console, verify site ownership: https://support.google.com/webmasters/answer/9008080

App Defense Alliance:
- CASA overview: https://appdefensealliance.dev/casa
- Assurance levels: https://appdefensealliance.dev/casa/casa-tiering
- Authorised labs: https://www.appdefensealliance.org/certification/authorized-labs
- CASA Specification: https://github.com/appdefensealliance/ASA-WG/blob/main/CASA/CASA%20Specification.md

Prices (vary; re-check before buying):
- TAC Security CASA storefront: https://casa.tacsecurity.com/site/home
- Switch Labs comparison (third-party, 2024 figures): https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option

OpenAI:
- API data usage and retention: https://developers.openai.com/api/docs/guides/your-data
