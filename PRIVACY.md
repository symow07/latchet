# Real Budget — Privacy Policy

_Last updated: October 12, 2026_

Real Budget ("the app", "we") helps you track spending, detect subscriptions,
and manage business expenses. This policy explains what data we handle and how.

This document is the source for the published policy: the hosted page is
generated from it automatically whenever it changes on `main`, so the hosted
page and the repository can never disagree.

## Data we collect and why

| Data | Source | Purpose |
|---|---|---|
| Account info (name, email) | You, at sign-up | Authentication, account recovery |
| Transactions & budgets | You, or your linked bank | The app's core budgeting features |
| Accounts, settings, custom categories, tracked subscriptions | You | Synced with your account so a reinstall or a second phone restores them. Each account's copy on a phone is a separate database, removed from the phone when you sign out. |
| Bank account data | Plaid (only if you link a bank) | Automatic transaction sync. We never see or store your bank credentials; Plaid provides read-only access tokens, which we store encrypted (AES-256-GCM). |
| Details from billing emails | Your Gmail or Outlook inbox, only if you connect it; or emails you forward to your private Real Budget address | Detecting subscriptions, free trials and price changes. **We keep only the details we extract — merchant, the sender's domain (e.g. `netflix.com`), amount, currency, billing cycle, dates, and what kind of email it was. Never the email body, its attachments, the subject line as written, or any email address in it.** See "Reading your inbox" below. Deleted after 90 days, or straight away when you disconnect the inbox. |
| Inbox connection | You, when you connect Gmail or Outlook | The address of the inbox you connected, the access token Google or Microsoft issues to us, stored encrypted (AES-256-GCM), and the sync status we show you (when it last synced, how many emails were checked and found, a short error code if something failed). Lets our server check for new billing email. Removed when you disconnect. |
| Business data (expenses, team, payroll) | You and your team | Business mode features |
| Household sharing | You, and the people who join your household | Combined household budgeting. **Each member chooses individually how much they reveal — totals only, totals and categories, or full transactions. Nobody, including the household's owner, can raise another member's setting.** Leaving a household revokes access immediately. |
| Crash reports | The app, when it crashes or hits an error | Finding and fixing crashes. **We send only the kind of error, where in the code it happened, the app version and the device model and OS, tied to your account's random ID. Never your email, name, amounts, notes, merchant or category names, anything you typed, or your IP address.** Sent to Sentry, kept for at most 90 days. |
| Advisor profile, incl. health and allergies | You, optionally | Explaining why some spending categories cost you more than average. **Stored only on your device — see below.** |

## Reading your inbox

Connecting your email is optional. Real Budget also finds subscriptions in your
bank feed and in the statements you import.

### What you can connect

- **Gmail**, with Google's read-only `gmail.readonly` permission.
- **Outlook** (Outlook.com, Hotmail and Live — personal Microsoft accounts),
  with Microsoft's read-only `Mail.Read` permission, plus `offline_access` so
  our server can check for new mail while you are not using the app, and
  `openid` and `email`, which tell us only which address you connected so we
  can show it to you.
- **Forwarding**, for any other provider (iCloud, Yahoo, GMX and others): you
  create a filter that forwards billing emails to your private Real Budget
  address, and we only ever see what you forward.

**None of these lets Real Budget send, delete, move, label or change your
email.**

### What we read

Reading happens on our server; your phone only receives the details we
extract. The tokens Google and Microsoft give us to reach your inbox are
encrypted at rest (AES-256-GCM).

- **On the first connection**, our server asks your provider only for billing
  email from the past 12 months: receipts, invoices, renewal notices, notices
  that a free trial is ending, price changes and cancellations.
- **After that**, it looks only at new mail.
- **Mail that does not look like a bill is not opened or kept.** At most its
  sender and subject line are checked, in memory, to decide.
- **A billing email** — including a PDF invoice attached to it — is read in
  memory and discarded as soon as its details are extracted.

### What we keep

From each billing email, only these details:

- the merchant, and the sender's domain (e.g. `netflix.com`) — never the
  sender's address;
- the amount and currency, and the billing cycle (weekly, monthly, yearly…);
- the dates: when you were charged, when the email was sent, the next charge,
  the end of a free trial;
- the previous price, when the email announces a change;
- what kind of email it was: receipt, renewal, trial ending, price change or
  cancellation;
- whether you were billed through Apple, Google Play or PayPal, so we can tell
  you where to cancel;
- a short label (at most 60 characters) made from the subject line with every
  number removed, so an email we could not attribute still looks familiar;
- how confident the extraction was, and whether our rules or AI read it;
- a one-way hash of the email's message identifier, so the same email is never
  counted twice.

**We never keep the email body, its attachments, the subject line as written,
or the address of anyone who sent or received it.** The only email address we
keep is that of the inbox you connected, to show you which one it is.

Your phone downloads these details and keeps a copy, because subscription
detection runs on the phone; that copy is removed when you sign out. The
subscriptions found this way join your subscription list, which syncs with your
account like everything else you track. **An email never adds spending to your
transactions.**

### Rules first, AI only as a fallback

Our server reads billing email with rules. Only when AI reading is switched on
for our service, and only for a billing email the rules could not read, we send
that email's sender domain, subject and text to **OpenAI**, which returns the
same details; its answer passes the same checks as the rules'. OpenAI does not
use data sent through its API to train its models, and keeps it for at most 30
days to monitor abuse.

### Disconnecting

You can disconnect an inbox in the app at any time. When you do:

- **Gmail:** we revoke Real Budget's access with Google, so our token stops
  working.
- **Outlook:** we delete our tokens. Microsoft gives apps no way to withdraw
  their own access to a personal Microsoft account, so once our tokens are gone
  we simply hold nothing that can reach your mailbox. You can also remove Real
  Budget from your Microsoft account at
  [account.live.com/consent/Manage](https://account.live.com/consent/Manage).
- **Both:** we delete the connection, and every detail we extracted from that
  inbox, from our server.

Subscriptions already in your list stay there until you remove them. You can
also remove Real Budget's access from your Google account at any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions);
the app then shows the connection as needing to be reconnected.

**Deleting your account** revokes every connection first — Gmail with Google,
your bank with Plaid, and for Outlook our tokens are deleted as above — and then
deletes everything, as described under "Your controls".

### One record we keep after you leave

Until Google has verified Real Budget, Google lets it serve at most 100 Gmail
users over its whole lifetime, counting people who have since left. So
that we respect the same limit, we keep a record that an account once connected
Gmail or Outlook, and when. It holds a one-way hash of your account's random ID
— no name, no email address — and once your account is deleted, nothing links
it back to you.

### Google's Limited Use requirements

Real Budget's use and transfer to any other app of information received from
Google APIs will adhere to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the
[Limited Use requirements](https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes).

In practice, for email from Gmail and Outlook alike:

- it is used only to show you your subscriptions, trials and price changes, and
  to remind you about them;
- it is never sold, never used for advertising, never used to decide
  creditworthiness or lending, and never used to train AI models;
- no person at Real Budget reads it, unless you ask us to look at a specific
  email, or the law or the security of the service requires it;
- it is transferred only to provide this feature — to OpenAI as described
  above, and to our hosting provider — or where the law requires it.

## The advisor profile stays on your device

If you fill in the advisor profile — household size, city, dietary
preferences, and optionally allergies or health considerations — **that
information is stored only in the app's local database on your phone.** It is
never uploaded to our servers, is not part of any cloud backup we hold, and is
not included when your transactions sync. If our backend were breached
tomorrow, it would contain no health information from this app, because there
is none there to take.

Health and allergy information is a **separate, explicit opt-in**, kept apart
from the rest of the profile. You can switch it off at any time, which erases
those entries; or delete the whole profile in one tap, which removes it from
the device with nothing recoverable. Deleting your account clears it too.

**One thing this does not mean.** When you ask the advisor a question, your
profile is included in the question sent to OpenAI, so that the answer can
account for your actual circumstances. That transmission is the point of the
feature. It is covered by the same API terms as the rest of our AI use —
content sent for analysis is not used to train OpenAI's models — but it does
leave your device at that moment, and you should know that before you fill the
profile in.

The advisor is constrained, server-side, never to name specific products, to
say whether anything is safe for you to eat, or to give medical, nutritional
or clinical advice. It uses this information to explain costs.

## What we do NOT do

- We do not sell or share your data with advertisers or data brokers.
- We do not store your advisor profile, including any health or allergy
  information, on our servers.
- We do not read your email inbox unless **you connect it**, and then only
  billing email, as described above. We can never send, delete or change your
  email. Without a connection, only emails **you choose to forward** to your
  private Real Budget address are processed.
- We do not store raw email content, sender addresses, subject lines, bank
  credentials, or card numbers.
- We do not use anything from your email for advertising, to judge your
  creditworthiness, or to train AI models.

## Third-party processors

- **Plaid** (bank connections) — [plaid.com/legal](https://plaid.com/legal)
- **Google** (Gmail) and **Microsoft** (Outlook) — only if you connect your
  inbox: they hold your email, and our server reads billing email from them as
  described in "Reading your inbox".
- **OpenAI** (receipt scans, statement import, the AI advisor, and — only when
  AI reading is on — billing emails our rules could not read) — content sent
  for analysis is not used to train OpenAI models per API terms.
- **Railway** (hosting) and **Cloudflare** (relays the emails you forward) —
  infrastructure only.
- **Resend** (email delivery) — sends the password-reset and email-verification messages to your address.
- **RevenueCat** (subscriptions) — manages Pro: it receives your account's random ID and, from Apple or Google, your purchase receipts. It never sees your budget data.
- **Sentry** (crash reporting) — receives the crash reports described above, with your IP address not stored. [sentry.io/privacy](https://sentry.io/privacy/)

## Security

- All traffic is encrypted in transit (HTTPS).
- Bank and inbox connection tokens (Plaid, Google, Microsoft) are encrypted at
  rest (AES-256-GCM).
- Passwords are hashed (PBKDF2-SHA256, 600k iterations — OWASP's current
  guidance); we never store them in plaintext.

## How long we keep things

| Data | Kept for |
|---|---|
| Your transactions, accounts, budgets and business data | Until you delete them, or delete your account |
| Details extracted from billing emails (Gmail, Outlook or forwarded) | 90 days after we record them — or less: they go as soon as you disconnect that inbox or delete your account |
| Records of deleted items (the item's identifier — for a custom category, its name — and when) | 60 days, so your other phones remove the same item |
| Email-forwarding confirmation codes | 24 hours |
| Expired sign-in sessions | 7 days past expiry |
| Used one-time sign-in codes | 24 hours past expiry |
| Inbox connections (the inbox's address and the encrypted tokens) | Until you disconnect the inbox or delete your account |
| The copy of extracted email details on your phone | Until you sign out |
| The record that an account once connected Gmail or Outlook (a one-way hash, no name or email address) | Kept after your account is deleted, because Google's limit counts every user an unverified app has ever had |

The rows with a fixed period are removed automatically by a daily job. Your own
ledger is never expired — it is yours until you remove it.

Subscriptions detected from an email are part of your subscription list and are
not affected when the email details expire or when you disconnect the inbox.

## Your controls

- **Disconnect** a bank or an inbox at any time in the app. Plaid and Google
  tokens are revoked with the provider and removed; Outlook tokens are removed
  (Microsoft offers apps no way to revoke them for personal accounts — see
  "Disconnecting" above). Everything extracted from a disconnected inbox is
  deleted.
- **Reset All Activity** (Settings) permanently deletes your transactions and
  balances.
- **Account deletion**: Settings → Delete Account removes your account and
  everything in it — transactions, accounts, budgets, bill reminders, recurring
  rules, achievements, and any business you own. Bank and inbox connections are
  revoked with the provider first, so they stop sharing data with us (for
  Outlook, we delete our tokens, as above). Deletion is immediate and
  irreversible; we keep no copy — only the anonymous record described under
  "One record we keep after you leave" — and cannot restore it.
  If a provider is unreachable at that moment we still delete your account, and
  the app tells you which connections to revoke yourself.

## Contact

Questions: support@realbudget.app

<!-- TODO(task-20): the address above is a placeholder tied to the app-name
     decision (Cowry / Mizan / Kesh). It MUST be a working inbox before App
     Store submission — Apple checks that the privacy policy contact resolves. -->

You do not need to contact us to delete your account — Settings → Delete Account
does it in full.
