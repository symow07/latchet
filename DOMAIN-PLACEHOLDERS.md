# Domain placeholders

TODO(domain): no domain is bought yet. Everywhere the app, backend or docs need a real domain they use the placeholder **latchet.app**. When the domain is bought, switch every use listed here (and re-run the search: `grep -rn "latchet\.app" --exclude-dir=node_modules . | grep -v "com\.latchet\.app"`). The iOS/Android identifiers `com.latchet.app` and `group.com.latchet.app` are not domains and stay.

## What each placeholder stands for

| Placeholder | Becomes | Uses |
|---|---|---|
| `latchet.app` | the website / the domain itself | 41 |
| `support@latchet.app` | the support inbox | 19 |
| `in.latchet.app` | the forwarding subdomain (INBOUND_EMAIL_DOMAIN) | 8 |
| `api.latchet.app` | the backend on its own domain (BACKEND_URL), needed for Google verification | 7 |
| `no-reply@latchet.app` | the sender of account emails (EMAIL_FROM) | 3 |
| `mail.latchet.app` | the mail subdomain for the sending domain | 1 |
| `u_ab12cd34ef56ab12cd@in.latchet.app` | an address on the domain | 1 |
| `2fapi.latchet.app` | the same backend host inside a URL-encoded redirect | 1 |
| `admin@latchet.app` | an address on the domain | 1 |
| `u-7f3a@in.latchet.app` | an address on the domain | 1 |
| `u_ab12@in.latchet.app` | an address on the domain | 1 |

## Files that cannot hold a TODO comment

These are registered here instead of carrying a `TODO(domain)` marker:

- `mobile/src/lib/i18n/locales/ar.json` — line 952 (support@latchet.app)
- `mobile/src/lib/i18n/locales/en.json` — line 1057 (support@latchet.app)
- `mobile/src/lib/i18n/locales/fr.json` — line 1057 (support@latchet.app)
- `mobile/src/lib/i18n/locales/zh.json` — line 1057 (support@latchet.app)
- `.claude/roadmap.json` — line 60 (latchet.app), 784 (latchet.app)

## Every use

- `.claude/roadmap.json`: 60 (latchet.app), 784 (latchet.app)
- `AUDIT-2026-10-11.md`: 235 (latchet.app), 289 (latchet.app)
- `LAUNCH-CHECKLIST.md`: 7 (latchet.app), 59 (latchet.app), 61 (latchet.app), 66 (support@latchet.app), 69 (support@latchet.app), 71 (support@latchet.app), 76 (latchet.app), 76 (mail.latchet.app), 77 (support@latchet.app), 80 (no-reply@latchet.app), 90 (latchet.app), 92 (latchet.app), 122 (latchet.app)
- `NAMING.md`: 71 (latchet.app)
- `PRIVACY.md`: 257 (support@latchet.app), 259 (latchet.app)
- `REVIEW-2026-08-29.md`: 125 (support@latchet.app), 159 (latchet.app)
- `ROADMAP-PHASE-4-5.md`: 161 (latchet.app)
- `ROADMAP.md`: 18 (support@latchet.app), 890 (support@latchet.app)
- `SUBMISSION.md`: 26 (latchet.app), 45 (latchet.app)
- `backend/.env.example`: 41 (latchet.app), 42 (no-reply@latchet.app), 78 (in.latchet.app), 79 (latchet.app)
- `backend/docs/inbound-email-setup.md`: 6 (u_ab12cd34ef56ab12cd@in.latchet.app), 18 (in.latchet.app), 22 (latchet.app), 22 (in.latchet.app), 39 (in.latchet.app), 49 (latchet.app), 51 (in.latchet.app), 69 (in.latchet.app)
- `backend/docs/inbound-email-worker.js`: 33 (latchet.app), 34 (in.latchet.app)
- `backend/src/env.ts`: 38 (latchet.app), 39 (no-reply@latchet.app), 90 (in.latchet.app), 90 (latchet.app)
- `docs/verification/README.md`: 12 (latchet.app), 60 (api.latchet.app)
- `docs/verification/demo-video-script.md`: 63 (api.latchet.app), 65 (2Fapi.latchet.app), 83 (latchet.app), 179 (latchet.app), 179 (latchet.app), 180 (support@latchet.app)
- `docs/verification/google-verification-and-casa.md`: 102 (latchet.app), 115 (latchet.app), 122 (api.latchet.app), 123 (api.latchet.app), 124 (api.latchet.app), 136 (support@latchet.app), 167 (support@latchet.app), 169 (latchet.app), 170 (latchet.app), 172 (latchet.app), 172 (api.latchet.app)
- `docs/verification/homepage-content.md`: 3 (latchet.app), 114 (latchet.app), 120 (support@latchet.app)
- `docs/verification/microsoft-publisher-verification.md`: 53 (api.latchet.app), 117 (support@latchet.app), 146 (latchet.app), 148 (admin@latchet.app), 174 (latchet.app), 179 (latchet.app)
- `mobile/src/app/(business-tabs)/settings.tsx`: 102 (support@latchet.app), 113 (latchet.app), 114 (support@latchet.app)
- `mobile/src/lib/email-connections.test.ts`: 28 (latchet.app), 29 (u-7f3a@in.latchet.app)
- `mobile/src/lib/email-screen.test.ts`: 27 (latchet.app), 28 (u_ab12@in.latchet.app)
- `mobile/src/lib/i18n/locales/ar.json`: 952 (support@latchet.app)
- `mobile/src/lib/i18n/locales/en.json`: 1057 (support@latchet.app)
- `mobile/src/lib/i18n/locales/fr.json`: 1057 (support@latchet.app)
- `mobile/src/lib/i18n/locales/zh.json`: 1057 (support@latchet.app)
