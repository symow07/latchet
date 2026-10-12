# Verification, for later

Real Budget reads billing mail from Gmail and Outlook so it can find subscriptions
and free trials the user has forgotten. Today it does this **without** Google's
verification and **without** Microsoft publisher verification, because both cost
time, and Google's costs money. That is a deliberate choice (PLAN Decision 1). It
blocks nothing.

The documents here turn verification into a checklist for the day there is
budget, or the day the Gmail user cap gets close. None of them is needed to ship.

Sources were checked on **12 October 2026**. Google and Microsoft change their
consoles and their rules often. Re-read the linked pages before each step.

## What is here

| Document | Use it for |
|---|---|
| [`google-verification-and-casa.md`](google-verification-and-casa.md) | The whole Google path: prerequisites, console fields, the `gmail.readonly` justification, submission, the CASA security assessment and its cost, what comes back, and how to stay under the 100-user cap until then. |
| [`limited-use-privacy-wording.md`](limited-use-privacy-wording.md) | The exact Limited Use statement for the privacy policy and homepage, Budget's full data-handling paragraph, and the in-app consent text. |
| [`homepage-content.md`](homepage-content.md) | The public homepage copy Google requires on your own domain. |
| [`demo-video-script.md`](demo-video-script.md) | The shot list for the demo video Google's reviewers watch, plus a short Microsoft version. |
| [`microsoft-publisher-verification.md`](microsoft-publisher-verification.md) | Microsoft publisher verification for the Outlook connection: prerequisites, steps, what changes for users, and the env vars. |

`PRIVACY.md` at the repository root already describes inbox reading and carries
Google's Limited Use statement. It is the policy the consent screen links to.

## Where things stand today

- **Gmail** uses the restricted `gmail.readonly` scope. The Google Cloud project
  is in the **In production** publishing status and is **unverified**: each user
  sees Google's "unverified app" warning before the consent screen, and Google
  allows at most 100 new users for the whole life of the project. Budget enforces
  its own cap too (`GMAIL_USER_CAP`, default 100). The app explains the warning
  to users while `GOOGLE_OAUTH_VERIFIED` is `false`.
- Do **not** switch the project to the **Testing** status to dodge the warning:
  in Testing, Google expires refresh tokens after 7 days, so every Gmail
  connection would break weekly, and only test users you list by hand can sign
  in. See the Google guide, section 1.
- **Outlook** uses Microsoft Graph `Mail.Read` for personal Microsoft accounts
  (`MICROSOFT_TENANT=consumers`). Personal-account users see "Unverified" on
  Microsoft's consent prompt and consent for themselves; confirm this once with
  a fresh personal account (see the Microsoft guide).
- **Forwarding** stays the fallback for every other provider (iCloud, Yahoo,
  GMX) and for anyone past the Gmail cap.

## Order of steps

Google (the long one):

1. **Buy the domain and publish the homepage and privacy policy on it.**
   LAUNCH-CHECKLIST §4 (domain) and §7 (privacy policy hosting). The homepage
   copy is in `homepage-content.md`. A `github.io` address will not pass:
   Google wants the homepage on a domain you own and have verified.
2. **Move the OAuth callback onto that domain**, for example
   `https://api.realbudget.app` as a Railway custom domain on the Budget
   service. Set `BACKEND_URL` to it, and register
   `${BACKEND_URL}/api/v1/email/oauth/gmail/callback` (and the Outlook one) with
   Google and Microsoft. Google verifies every domain the project uses,
   redirect URIs included, and you cannot verify `up.railway.app`.
3. **Verify the domain in Google Search Console** with the Google account that
   owns the Cloud project.
4. **Fill the Branding, Audience and Data Access pages** of the Google Auth
   Platform exactly as the Google guide lists, and paste the scope justification.
5. **Record and upload the demo video** (`demo-video-script.md`).
6. **Submit** in the Verification Center. Brand verification comes first, then
   the restricted-scope review.
7. **Pass CASA** when Google's Trust and Safety team writes to you. Pick a lab,
   pay it, fix what it finds, and get the Letter of Validation.
8. **When Google approves**, set `GOOGLE_OAUTH_VERIFIED=true` in Railway → Budget
   → Variables and redeploy.
9. **Every 12 months** after the Letter of Validation, Google asks you to
   re-verify and pass CASA again. Put it in the calendar.

Microsoft (independent of Google, any time):

1. Register a business with an email address on your own domain, join the
   Microsoft AI Cloud Partner Program, and pass its verification.
2. Make sure the app registration lives in a Microsoft Entra tenant and was
   created by a work account, not a personal Microsoft account.
3. Set the publisher domain, then add the Partner One ID under **Branding &
   properties → Add Partner ID to verify publisher**.

## What flips in the app afterwards

- **Google approved:** set `GOOGLE_OAUTH_VERIFIED=true`. That is the only change.
  It lifts Budget's own Gmail cap (`GMAIL_USER_CAP` is then ignored) and removes
  the in-app "Google hasn't verified this app" explainer. Google removes its own
  warning and cap on its side. The client ID, the scope, the stored tokens and
  every existing connection stay exactly as they are; nobody has to reconnect.
- **Microsoft publisher verified:** nothing changes in Budget's configuration.
  The consent prompt shows your organisation's name with a blue verified badge
  instead of "Unverified". Existing connections keep working.

## Keep these documents true

Google compares the privacy policy, the homepage, the consent screen and the
demo video with what the app actually does. If the code changes what it reads,
keeps or sends anywhere (a new scope, a new processor, keeping more fields,
a longer retention), update `PRIVACY.md`, `limited-use-privacy-wording.md` and
`homepage-content.md` in the same change. A new scope also needs a new review
before it ships, or users see the unverified warning again.
