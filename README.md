# Real Budget — Personal Finance, Reimagined

> An offline-first, AI-powered personal finance tracker built with React Native & Expo. Gamified discipline mechanics, multi-account management, smart analytics, and a full business mode — all running locally on your device.

![React Native](https://img.shields.io/badge/React_Native-0.79.6-61dafb?style=flat-square&logo=react&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-53-000000?style=flat-square&logo=expo&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-offline--first-f4b942?style=flat-square&logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-5dc46f?style=flat-square)

---

## What is Real Budget?

Real Budget is not just another expense tracker. It's a full-featured personal finance system built with a privacy-first, offline-only philosophy. No cloud sync, no credentials sharing, no data leaving your device — ever.

It combines **AI-driven spending insights**, **gamified discipline mechanics**, and a **complete business mode** into a single polished mobile app with a premium dark UI.

---

## Scale at a Glance

| 80+ Currencies | 25+ Subscription Guides | 5 Account Types | A–F Discipline Grade |
|:-:|:-:|:-:|:-:|
| Worldwide support | Step-by-step cancellation | Cash to investments | Based on budget vs spend |

---

## Features

### Authentication & Onboarding
- Email + password authentication via Better Auth with persistent sessions
- Account type selection: **Personal** or **Business** at signup
- 4-step personalized onboarding — currency, income, savings goal, spending style
- Auto-calculated budget suggestions based on spending style

### Multi-Account Management
- Track cash, checking, savings, credit cards, and investments
- Real-time net worth across all accounts
- Auto-deduction — transactions automatically update account balances
- Set a default account for quick transactions

### AI Financial Advisor
- Analyses your **real** spending data — no generic advice
- Detects spending patterns by category and time period
- Flags overspending vs last month, spending spikes, and recurring waste
- Projects your end-of-month balance based on current trends
- Personalized tips based on your income, goals, and risk tolerance

### Smart Analytics & Behaviour Detection
- Subscription detection — automatically identifies recurring charges
- Duplicate charge alerts for potential refunds
- Weekend vs weekday spending comparison
- Seasonal trend detection month-over-month
- Top 3 money drain categories with actionable tips
- Potential savings calculator

### Gamification Engine
- Daily logging streaks
- Badge system: `0 Impulse Day`, `7-Day Streak`, `30-Day Streak`, `Budget Master`, `No Subscriptions`
- Impulse vs planned purchase tracking
- Discipline grade (A–F) based on budget adherence
- Time cost display — see purchases in work hours (e.g. "This cost 32 minutes")

### Secure Transaction Import
- CSV bank statement import — no credentials required
- Auto-categorization based on transaction descriptions
- Impulse detection on import
- Preview and edit before saving
- Duplicate detection — skips existing transactions
- All files processed locally, never uploaded

### Privacy & Security
- 100% offline-first with SQLite local storage
- Biometric lock — Face ID / Touch ID on every app open
- No backend required, no data syncing, no accounts on external servers

### Business Mode
- 6-tab dashboard: Dashboard, Expenses, Team, Payroll, Budget, Settings
- Expense submission with receipt images and approval/rejection flow
- Team management with invite codes and roles (owner / manager / employee)
- Monthly payroll tracking — mark paid/unpaid per employee
- Subscription tool tracker with cancellation guides for 25+ popular tools

---

## Tech Stack

| Technology | Role |
|---|---|
| React Native 0.79.6 | Cross-platform mobile UI |
| Expo 53 | Build tooling and runtime |
| TypeScript | Type-safe throughout |
| SQLite (expo-sqlite) | Local data persistence |
| NativeWind | Tailwind CSS for React Native |
| React Query | Async and server state management |
| Expo Linear Gradient | Premium gradient UI |
| Expo Haptics | Touch feedback |
| Expo Local Authentication | Face ID / Touch ID |
| Lucide Icons | Consistent icon system |
| date-fns | Date utilities |
| React Navigation | Tab and stack routing |

---

## Project Structure

```
src/
├── app/
│   ├── _layout.tsx           # Root layout with auth routing
│   ├── login.tsx             # Login screen
│   ├── signup.tsx            # Sign up screen
│   ├── onboarding.tsx        # 4-step onboarding questionnaire
│   ├── accounts.tsx          # Account management
│   ├── advisor.tsx           # AI Financial Advisor chatbot
│   ├── import.tsx            # CSV transaction import
│   └── (tabs)/
│       ├── index.tsx         # Dashboard
│       ├── add.tsx           # Add transaction
│       ├── transactions.tsx  # Transaction list + filters
│       └── settings.tsx      # Budget & app settings
├── lib/
│   ├── db.ts                 # SQLite operations
│   ├── auth.ts               # Authentication functions
│   ├── currencies.ts         # 80+ currency data and conversion
│   ├── calculations.ts       # Financial calculations
│   ├── ai-analysis.ts        # AI spending analysis and prompt building
│   ├── import-parser.ts      # CSV parsing and auto-categorization
│   └── cn.ts                 # Tailwind class utilities
└── components/               # Reusable UI components
```

---

## Key Calculations

```
Balance          = startingBalance + income - expenses
Survival Days    = currentBalance / averageDailySpend
Impulse %        = (impulse transactions / total transactions) × 100
Time Cost        = (amount / hourlyValue) × 60 minutes
Budget Pace      = actual spend % vs expected % for day of month

Discipline Grade:
  A  ≤ 70% of monthly budget
  B  ≤ 85%
  C  ≤ 100%
  D  ≤ 115%
  F  > 115%
```

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/symow07/budget
cd budget

# Install dependencies (using bun)
bun install

# Start the development server
bun start
```

### Initial Setup

1. Open the app and sign up with email and password
2. Choose **Personal** or **Business** account type
3. Complete the 4-step onboarding:
   - Select your currency
   - Enter monthly income and savings goal
   - Choose your primary financial goal
   - Pick your spending style
4. Optionally add your bank accounts
5. Start logging transactions from the Dashboard

> The app seeds 14 days of realistic demo transactions on first launch if the database is empty.

---

## Data Model

### Transactions
| Field | Type | Description |
|---|---|---|
| id | string | Primary key |
| amount | number | Transaction amount |
| category | string | Food, Transport, Shopping, Subscriptions, Gym, Other |
| type | string | Expense or Income |
| isImpulse | boolean | Unplanned purchase flag |
| note | string | Optional note |
| dateISO | string | YYYY-MM-DD |
| accountId | string | Foreign key to accounts |
| currency | string | Currency code |

### Accounts
| Field | Type | Description |
|---|---|---|
| id | string | Primary key |
| name | string | Account name |
| type | string | cash, checking, savings, credit, investment, other |
| balance | number | Current balance |
| currency | string | Currency code |
| isDefault | boolean | Primary account flag |

---

## License

MIT — free to use, modify, and distribute.

---

*Built by [@symow07](https://github.com/symow07) · Offline-first · Privacy by design*
