# Real Budget — Personal Finance, Reimagined

> A local-first personal finance tracker built with React Native & Expo, backed by a
> Bun + Hono API. Your ledger lives on your device and works offline; an account keeps
> it backed up and unlocks bank sync, receipt scanning and the AI advisor.

![React Native](https://img.shields.io/badge/React_Native-0.79.6-61dafb?style=flat-square&logo=react&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-53-000000?style=flat-square&logo=expo&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-Hono_+_Prisma-fbf0df?style=flat-square&logo=bun&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-5dc46f?style=flat-square)

---

## What is Real Budget?

A full personal-finance system: multi-account tracking, gamified discipline mechanics,
subscription detection, statement import, an AI advisor, and a complete business mode —
in one app with a dark, deliberately un-spreadsheet-like UI.

**Local-first, not offline-only.** Every transaction is written to SQLite on your device
and all analytics are computed there, so the app is fully usable with no signal. Because
the app requires an account, that ledger is also synced to your account so a reinstall
doesn't lose it. Some features necessarily reach out further — the table below says
exactly which, and nothing leaves your device for a feature you haven't turned on.

---

## What leaves your device

| Feature | What is sent | Where |
|---|---|---|
| Core tracking, budgets, analytics | — | Stays on device |
| CSV statement import | — | Parsed entirely on device |
| Account sync & backup | Your transactions, accounts and settings | Our API |
| Bank linking *(optional)* | Nothing — you sign in on your bank's own page | Plaid |
| Receipt scan *(optional)* | The photo | Our API → OpenAI |
| PDF statement import *(optional)* | The PDF (you're asked first) | Our API → OpenAI |
| AI advisor *(optional)* | A summary of your spending — no raw ledger | Our API → OpenAI |
| Email subscription scan *(optional)* | Only emails you forward yourself | Our API → OpenAI |

We never see or store bank credentials. Plaid access tokens and Gmail refresh tokens are
encrypted at rest (AES-256-GCM). Full details in [PRIVACY.md](./PRIVACY.md) — and if the
two documents ever disagree, PRIVACY.md is the one that governs.

---

## Features

### Tracking & accounts
- Cash, checking, savings, credit and investment accounts, with net worth across all of them
- Balances derived from the ledger, so they can't silently drift out of sync
- Built-in categories plus your own, with icons and colours
- 75 currencies, with live exchange rates (cached, with an offline fallback)

### Statement import — the universal rail
Bank sync covers 20 countries. Import covers everywhere, so it gets the attention:
- CSV from any bank, parsed on device
- The file's own conventions are detected — decimal separator, day/month order, whether an
  unsigned amount means spending — so `1.234,56` and `01/09/2026` mean what your bank meant
- If the columns can't be recognised, you're asked to point them out rather than turned away
- Each bank's format is remembered, so the next statement needs no setup
- PDF statements read by AI, for banks that offer nothing else
- Alipay and WeChat Pay bill exports
- Export is lossless — re-importing a backup restores categories and flags unchanged

### Subscriptions
- One detector across transactions, business expenses and forwarded email
- Groups by merchant, tolerates price changes, predicts the next charge
- Cancellation guides for 52 services, consumer and SaaS

### AI advisor
- Reads your actual spending, not generic advice
- Overspending vs last month, spending spikes, category concentration
- Projections that decline to guess: under a week of history it says so rather than
  extrapolating a single purchase into a crisis

### Gamification
- Daily logging streaks and badges
- Impulse vs planned tracking, and a discipline grade (A–F) against your budget
- Time cost — see a purchase in work hours

### Business mode
- Dashboard, expenses, team, payroll, budget
- Expense submission with receipts and an approval flow
- Team invite codes with owner / manager / employee roles

### Privacy & security
- SQLite on device; the app works fully offline
- Biometric lock on app launch (Face ID / Touch ID)
- Delete your account and everything in it, from Settings — no email required

---

## Repository layout

A monorepo with two halves:

```
backend/                 Bun + Hono + Prisma 5 + SQLite, Better Auth. Deployed on Railway.
  src/routes/            One router per resource, mounted at /api/v1/x and /api/x
  src/lib/               Dependency-free logic, each with tests beside it
  src/jobs/              Recurring transactions, bill reminders
  prisma/schema.prisma   Data model; every user-owned table cascades from User

mobile/                  Expo 53, React Native 0.79.6, expo-router, NativeWind
  src/app/               Screens (file-based routing)
  src/lib/               Local SQLite, analytics, import, sync — the app's real logic
  src/components/        Shared UI
```

Analytics, health score, projections and subscription detection all run **on device**,
against the local database. The backend owns authentication, sync, the three secret API
keys, and the third-party integrations.

---

## Getting started

```bash
git clone https://github.com/symow07/budget
cd budget
```

**Backend**

```bash
cd backend
bun install
cp .env.example .env     # then fill in the required values below
bun run dev
```

Required: `BETTER_AUTH_SECRET` (32+ chars) and `DATABASE_URL`. Strongly recommended:
`TOKEN_ENCRYPTION_KEY` (32+ chars) — it decouples token encryption from the auth secret so
the latter can be rotated. For a working sign-in you also need `RESEND_API_KEY` or
`SMTP_SERVICE_URL`; without either, non-production builds log the OTP to the console.
Everything else (`OPENAI_API_KEY`, `PLAID_*`, `GOOGLE_*`) is optional — those features
return 503 until configured. See [DEPLOYMENT.md](./DEPLOYMENT.md).

**Mobile**

```bash
cd mobile
bun install
npx expo start
```

Point `EXPO_PUBLIC_BACKEND_URL` at your backend.

---

## Development

```bash
# backend
bun run typecheck     # tsc --noEmit (strict)
bun test              # 195 tests

# mobile
bun run typecheck
bun run lint
bun test src          # 118 tests
bun run test:tz       # the suite under Asia/Shanghai, America/Los_Angeles and UTC
```

Date handling must pass `test:tz`. Anything comparing calendar dates goes through
`src/lib/dates.ts` and compares `YYYY-MM-DD` strings — parsing a date string and reading it
back with local getters puts month-boundary transactions in the wrong month.

Pure logic lives in modules importing nothing native, so it can be tested without a
simulator. See `import-parser`, `subscriptions/engine`, `sync-merge` on the mobile side and
`recurrence`, `crypto`, `plaid-webhook` on the backend.

---

## Key calculations

```
Balance          = openingBalance + income - expenses   (derived, per account)
Survival Days    = currentBalance / averageDailySpend   (null under 7 days of history)
Impulse %        = (impulse transactions / total) × 100
Time Cost        = (amount / hourlyValue) × 60 minutes

Discipline Grade:  A ≤ 70% of monthly budget · B ≤ 85% · C ≤ 100% · D ≤ 115% · F > 115%
```

---

## License

MIT — free to use, modify, and distribute.

---

*Built by [@symow07](https://github.com/symow07)*
