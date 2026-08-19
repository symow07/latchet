# Real Budget — Privacy Policy

_Last updated: August 19, 2026_

Real Budget ("the app", "we") helps you track spending, detect subscriptions,
and manage business expenses. This policy explains what data we handle and how.

This document is the source for the published policy: it is rendered to
<https://symow07.github.io/budget/> automatically whenever it changes on `main`,
so the hosted page and the repository can never disagree.

## Data we collect and why

| Data | Source | Purpose |
|---|---|---|
| Account info (name, email) | You, at sign-up | Authentication, account recovery |
| Transactions & budgets | You, or your linked bank | The app's core budgeting features |
| Bank account data | Plaid (only if you link a bank) | Automatic transaction sync. We never see or store your bank credentials; Plaid provides read-only access tokens, which we store encrypted (AES-256-GCM). |
| Forwarded billing emails | You (via an email filter you create) | Detecting recurring subscriptions. **We extract only the merchant name, amount, currency, billing cycle, and date. The email body, the sender's address and the subject line are all discarded — we keep the sender's domain (e.g. `netflix.com`) and a subject remnant with every number removed, so an email we could not identify still shows you something recognisable.** Deleted after 90 days. |
| Business data (expenses, team, payroll) | You and your team | Business mode features |

## What we do NOT do

- We do not sell or share your data with advertisers or data brokers.
- We do not read your email inbox. Only emails **you choose to forward** to
  your private Real Budget address are processed.
- We do not store raw email content, sender addresses, subject lines, bank
  credentials, or card numbers.

## Third-party processors

- **Plaid** (bank connections) — [plaid.com/legal](https://plaid.com/legal)
- **OpenAI** (receipt/email text analysis, AI advisor) — content sent for
  analysis is not used to train OpenAI models per API terms.
- **Railway** (hosting) and **Cloudflare** (email relay) — infrastructure only.

## Security

- All traffic is encrypted in transit (HTTPS).
- OAuth tokens are encrypted at rest (AES-256-GCM).
- Passwords are hashed (PBKDF2-SHA256, 600k iterations — OWASP's current
  guidance); we never store them in plaintext.

## How long we keep things

| Data | Kept for |
|---|---|
| Your transactions, accounts, budgets and business data | Until you delete them, or delete your account |
| Forwarded billing emails | 90 days — long enough to see an annual renewal cycle |
| Email-forwarding confirmation codes | 24 hours |
| Expired sign-in sessions | 7 days past expiry |
| Used one-time sign-in codes | 24 hours past expiry |

Everything above the first row is removed automatically by a daily job. Your own
ledger is never expired — it is yours until you remove it.

Subscriptions detected from a forwarded email are stored separately and are not
affected when the email itself expires.

## Your controls

- **Disconnect** a bank or email connection at any time in the app; tokens are
  revoked and removed.
- **Reset All Activity** (Settings) permanently deletes your transactions and
  balances.
- **Account deletion**: Settings → Delete Account removes your account and
  everything in it — transactions, accounts, budgets, bill reminders, recurring
  rules, achievements, and any business you own. Bank and inbox connections are
  revoked with the provider first, so they stop sharing data with us. Deletion
  is immediate and irreversible; we keep no copy and cannot restore it.
  If a provider is unreachable at that moment we still delete your account, and
  the app tells you which connections to revoke yourself.

## Contact

Questions: support@realbudget.app

<!-- TODO(task-20): the address above is a placeholder tied to the app-name
     decision (Cowry / Mizan / Kesh). It MUST be a working inbox before App
     Store submission — Apple checks that the privacy policy contact resolves. -->

You do not need to contact us to delete your account — Settings → Delete Account
does it in full.
