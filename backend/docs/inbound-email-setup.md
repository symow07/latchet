# Inbound Email Setup (forward-to-inbox subscription detection)

Budget gives each user a private address like `u_ab12cd34@in.yourdomain.com`.
Users forward billing emails there (a one-time Gmail filter), the backend parses
each one with OpenAI and lists detected subscriptions in the app. This document
sets up the mail infrastructure — **Cloudflare Email Routing** (free) receiving
the mail and a tiny Email Worker relaying it to the backend webhook.

## Prerequisites

- A domain (or subdomain) you control, e.g. `in.yourdomain.com`, with DNS on
  Cloudflare (free plan is fine).
- The backend deployed and reachable over HTTPS.

## 1. Generate the shared secret

```bash
openssl rand -hex 32
```

Keep this value; it authenticates the Worker to the backend.

## 2. Backend env vars

Set on the backend (Railway → Variables):

```
INBOUND_EMAIL_DOMAIN=in.yourdomain.com
INBOUND_EMAIL_SECRET=<the secret from step 1>
```

Redeploy. `GET /api/email/status` should now return `"inboxConfigured": true`.

## 3. Cloudflare Email Routing

1. Cloudflare dashboard → your zone → **Email → Email Routing** → enable it
   (Cloudflare adds the required MX + SPF records automatically).
2. Create the Worker: **Workers & Pages → Create → Worker**, name it
   `budget-inbound-email`, and paste the contents of
   [`inbound-email-worker.js`](./inbound-email-worker.js).
3. Worker → **Settings → Variables**:
   - `BACKEND_URL` = `https://<your-backend-host>` (no trailing slash)
   - `INBOUND_SECRET` = the secret from step 1 (mark as *encrypt*)
4. Back in **Email → Email Routing → Routing rules**: set the **Catch-all
   address** action to **Send to a Worker** → `budget-inbound-email`.

## 4. Verify end-to-end

1. In the app: Subscriptions → "Find subscriptions in your email" → the setup
   screen shows the user's private address (`GET /api/email/inbox-address`
   provisions it on first call).
2. Send any email to that address from a personal account.
3. Within seconds it should appear in the app inbox (`GET /api/email/inbox`)
   and the connection flips to `forwarding.verified: true`.

## How Gmail forwarding confirmation works

When a user adds the private address as a Gmail forwarding target, Gmail sends a
confirmation email containing a numeric code **to that address**. The backend
recognizes it (`forwarding-noreply@google.com`) and stores the code as an inbox
item with `status: "confirmation"`, which the app surfaces so the user can paste
it back into Gmail — no need to check any mailbox manually.

## Cost & abuse guards

- Cloudflare Email Routing + Workers: free tier covers this comfortably.
- The backend caps OpenAI parsing at **60 emails/user/day**
  (`allowUsage("inbound-parse", …)` in `src/routes/email.ts`); excess emails are
  stored unparsed.
- The webhook rejects requests without the correct `X-Inbound-Secret` header.
- Raw email bodies are **not stored** — only sender, subject, and the extracted
  fields (merchant, amount, cadence, date).

## Alternative providers

Any inbound-mail service that can POST JSON works with the same webhook —
AWS SES (inbound receipt rule → Lambda), Postmark (inbound stream), or Mailgun
(routes). Map their payload to `{ to, from, subject, text }` and send the
`X-Inbound-Secret` header.
