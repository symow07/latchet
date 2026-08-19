# Real Budget — Privacy Policy

_Last updated: July 4, 2026_

Real Budget ("the app", "we") helps you track spending, detect subscriptions,
and manage business expenses. This policy explains what data we handle and how.
Host this document at a public URL and link it from the App Store listing.

## Data we collect and why

| Data | Source | Purpose |
|---|---|---|
| Account info (name, email) | You, at sign-up | Authentication, account recovery |
| Transactions & budgets | You, or your linked bank | The app's core budgeting features |
| Bank account data | Plaid (only if you link a bank) | Automatic transaction sync. We never see or store your bank credentials; Plaid provides read-only access tokens, which we store encrypted (AES-256-GCM). |
| Forwarded billing emails | You (via an email filter you create) | Detecting recurring subscriptions. **We extract only the merchant name, amount, currency, billing cycle, and date — the raw email body is discarded and never stored.** |
| Business data (expenses, team, payroll) | You and your team | Business mode features |

## What we do NOT do

- We do not sell or share your data with advertisers or data brokers.
- We do not read your email inbox. Only emails **you choose to forward** to
  your private Real Budget address are processed.
- We do not store raw email content, bank credentials, or card numbers.

## Third-party processors

- **Plaid** (bank connections) — [plaid.com/legal](https://plaid.com/legal)
- **OpenAI** (receipt/email text analysis, AI advisor) — content sent for
  analysis is not used to train OpenAI models per API terms.
- **Railway** (hosting) and **Cloudflare** (email relay) — infrastructure only.

## Security

- All traffic is encrypted in transit (HTTPS).
- OAuth tokens are encrypted at rest (AES-256-GCM).
- Passwords are hashed (PBKDF2-SHA256, 100k iterations); we never store them in
  plaintext.

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

Questions: <support email — fill in before publishing>. You do not need to
contact us to delete your account — Settings → Delete Account does it in full.
