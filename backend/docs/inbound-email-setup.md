# Forwarding setup (the backup to Gmail and Outlook)

Gmail and Outlook mailboxes are read directly over OAuth (`GOOGLE_*`,
`MICROSOFT_*` in `backend/.env.example`). Everyone else — iCloud, Yahoo, GMX,
Proton, a work server — can **forward** billing mail to a private address
Budget gives them, like `u_ab12cd34ef56ab12cd@in.yourdomain.com`. This guide
sets up the receiving side: **Cloudflare Email Routing** (free) receives the
mail and a small **Email Worker** ([`inbound-email-worker.js`](./inbound-email-worker.js))
posts each raw message to the backend, which reads it with the same MIME
parser as Gmail and Outlook mail and stores only what it extracts (merchant,
amount, currency, cycle, dates).

Time: about 20 minutes. Cost: nothing on Cloudflare's free plan.

## What you need

- A domain whose DNS is on Cloudflare (the free plan is fine). Use a
  subdomain you do not receive other mail on, e.g. `in.yourdomain.com`:
  Email Routing takes over its MX records.
- The backend deployed and reachable over HTTPS (its `BACKEND_URL`).

## 1. The shared secret

```bash
openssl rand -hex 32
```

It authenticates the worker to the backend. Keep it for steps 2 and 4.

## 2. Backend variables

On the backend service (Railway → Variables):

```
INBOUND_EMAIL_DOMAIN=in.yourdomain.com
INBOUND_EMAIL_SECRET=<the secret from step 1>
```

Redeploy. `GET /api/v1/email/connections` (signed in) now reports
`"forwarding": { "configured": true }`, and `POST /api/v1/email/inbound`
without the secret answers 401 instead of 503.

## 3. Email Routing on the domain

Cloudflare dashboard → your zone (`yourdomain.com`) → **Email → Email Routing**:

1. **Enable Email Routing** for the subdomain `in.yourdomain.com`. Cloudflare
   offers to add its MX and SPF records; accept. Wait until the status reads
   *Routing status: Enabled* (DNS can take a few minutes).
2. Leave **Routing rules** for now; the catch-all is set in step 5, once the
   worker exists.

## 4. The worker

**Workers & Pages → Create → Create Worker**, name it `budget-inbound-email`,
deploy the starter, then **Edit code**, replace everything with the contents
of [`inbound-email-worker.js`](./inbound-email-worker.js) and **Deploy**.

Worker → **Settings → Variables and Secrets**:

| Name | Type | Value |
|---|---|---|
| `BACKEND_URL` | Text | `https://<your-backend-host>` (no trailing slash) |
| `INBOUND_SECRET` | Secret | the secret from step 1 |
| `INBOUND_DOMAIN` | Text | `in.yourdomain.com` (optional; refuses other domains) |
| `FALLBACK_FORWARD` | Text | optional; see "When the backend is down" |

**CPU.** On the free plan a worker gets 10 ms of CPU per message. Encoding an
ordinary billing email takes a fraction of that; for large ones (PDF
invoices), turn on native encoding: Worker → **Settings → Runtime →
Compatibility flags → Add** `nodejs_compat`. A message that still runs out of
CPU shows as `EXCEEDED_CPU` in the worker's logs.

**Keep mail during an outage (recommended).** Workers & Pages → **KV** →
**Create namespace** `budget-inbound-parked`. Worker → **Settings → Bindings →
Add → KV namespace**: variable name `PARKED`, namespace
`budget-inbound-parked`. Then Worker → **Settings → Triggers → Cron Triggers →
Add**: `*/10 * * * *` (every ten minutes). Deploy again.

## 5. Route the domain's mail to the worker

**Email → Email Routing → Routing rules → Catch-all address → Edit**: action
**Send to a Worker**, destination `budget-inbound-email`. Save and make sure
the catch-all is **enabled**.

## 6. Check it end to end

1. In the app, open the email screen and choose forwarding: it shows the
   private address (`GET /api/v1/email/inbox-address` creates it the first
   time).
2. From any mailbox, forward a real receipt (a Netflix or Spotify one) to that
   address.
3. Within seconds the connection shows as verified
   (`forwardingVerified: true` in `GET /api/v1/email/connections`) and, when
   the message was a bill, a finding appears in `GET /api/v1/email/findings`.
4. Cloudflare dashboard → Email Routing → **Activity log** shows the message
   as *Delivered to worker*; the worker's **Logs** show no exception.

To set up automatic forwarding, users add the address as a forwarding target
in their mail provider and filter billing mail to it. Gmail first sends a
confirmation message with a code to the address; the backend recognises it
and `GET /api/v1/email/inbox-address` returns it as `confirmationCode`, so the
app can show it (kept for 24 hours).

## When the backend is down: no bounce

A user's real mail must not bounce because Budget is down, deploying or
asleep (Railway sleeps idle services). Cloudflare's Email Workers runtime has
no way to answer the sending server "try again later": `setReject` is a
permanent rejection, and an exception that escapes the worker is retried by
Cloudflare a few times and then also reaches the sender as a permanent
failure. So the worker does not rely on either:

1. It **retries** the backend with backoff (`RETRY_DELAYS_MS`, default
   `0,2000,6000`, each attempt waiting up to 20 s). A sleeping Railway service
   wakes on the first request, so this alone covers sleep and deploys.
2. Still failing (a 5xx, 429, timeout, a network error, or a configuration
   problem such as a wrong secret), it **parks** the raw message in the
   `PARKED` KV namespace for up to 7 days; the cron trigger delivers parked
   messages, oldest first, as soon as the backend answers again.
3. Without `PARKED`, it **forwards** the message to `FALLBACK_FORWARD`, which
   must be a verified destination address (Email Routing → Destination
   addresses). Re-send from there once the backend is back.
4. With neither, it throws. Cloudflare retries the worker briefly; after that
   the sender sees a failure. Configure `PARKED`.

The worker rejects (`setReject`, a bounce) only mail that is not for a Budget
address: a local part that is not `u_<token>`, a domain other than
`INBOUND_DOMAIN`, or a token the backend answers 404 `unknown_recipient` for
(no such user, or the account was deleted).

KV's free tier allows 1,000 writes a day, which is plenty for an outage's
backlog; parked messages expire after 7 days and are deleted as soon as they
are delivered.

## The webhook contract

`POST ${BACKEND_URL}/api/v1/email/inbound` (also `/api/email/inbound`)

- Header `X-Inbound-Secret: <INBOUND_EMAIL_SECRET>`.
- Body `{"to": "u_…@in.yourdomain.com", "raw": "<the whole RFC 822 message, base64>"}`,
  at most 36 MB. The worker cuts messages above 8 MB (billing text comes
  before attachments; PDFs are read only up to 2 MB).
- Answers: `200 {"received": true}` (stored, a duplicate, not a bill, or over
  the per-address daily limit — all final); `404 {"error": "unknown_recipient"}`;
  `401` wrong secret; `503 {"error": "not_configured"}`; `400` malformed;
  `413` too large; `5xx` our failure (the worker retries and parks).
- A message delivered twice (a retry, a redelivery) is stored once: findings
  are keyed by a hash of its Message-ID.

Any inbound-mail service that can POST JSON can replace Cloudflare (AWS SES →
Lambda, Postmark, Mailgun routes): send the raw message base64-encoded in
`raw`, with the header above, and retry on anything but 2xx and
`unknown_recipient`.

## Limits and privacy

- Each forwarding address accepts 500 messages a day; beyond that, mail is
  acknowledged and dropped, so a mail-bomb cannot become unbounded work.
- The AI fallback (only when `OPENAI_API_KEY` is set, for bills the rules
  cannot read) is capped per user per day; without it the rules alone run.
- Stored per finding: the kind (renewal, receipt, trial ending, price change,
  cancellation), merchant, the sender's domain, amount, currency, cycle and
  dates. Never the body, the subject (a digit-free remnant only when no
  merchant was found), or the sender's address. Findings are deleted after
  90 days; disconnecting forwarding deletes them at once.
- The worker logs nothing about the message. Parked messages (step 2 above)
  sit in your own KV namespace, encrypted at rest by Cloudflare, until
  delivered or for at most 7 days.
