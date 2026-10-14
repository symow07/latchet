# Latchet - Personal Finance Tracker

A beautiful, offline-first personal finance tracker built with React Native, Expo, and SQLite. Track spending, set budgets, and build financial discipline through addictive gamification mechanics.

## Design

The app features a modern, premium dark UI with:
- **Purple gradient headers** - Elegant violet-to-purple gradients on each screen
- **Glassmorphism cards** - Semi-transparent cards with subtle blur effects
- **Dark theme** - Deep black background (#0d0d0f) with gray card accents
- **Haptic feedback** - Touch feedback on all interactive elements
- **Floating action button** - Purple pill-shaped Add button in tab bar

## Features

### 🔐 Authentication & Onboarding
- **Sign Up / Login** - Email + password authentication via Better Auth (persistent sessions)
- **Account Type Selection** - After signup, choose Personal or Business account type
- **Personal → Onboarding** - 4-step questionnaire for personal users
- **Business → Dashboard** - Full business dashboard with expense tracking, team management, payroll, budget, and tools
- **Personalized Onboarding** - 4-step questionnaire to customize the experience:
  - Currency selection (80+ currencies worldwide)
  - Monthly income and savings goal
  - Primary financial goal (save, track, reduce debt, stick to budget)
  - Spending style (frugal, moderate, generous)
- **Auto-calculated budgets** - Suggested budget based on spending style

### 💳 Multi-Account Management
- **Multiple Accounts** - Track cash, checking, savings, credit cards, investments
- **Account Types** - Visual icons and colors for each account type
- **Balance Tracking** - Total net worth across all accounts
- **Auto-deduction** - Transactions automatically update account balances
- **Default Account** - Set primary account for quick transactions

### 🌍 Multi-Currency Support
- **80+ Currencies** - Support for currencies worldwide
- **Currency Symbols** - Proper formatting for each currency
- **Exchange Rates** - Built-in conversion rates (relative to USD)

### 🎯 Core Features
- **Dashboard** - Real-time spending metrics with daily/weekly/monthly breakdowns
- **Survival Days** - How long your current balance will last based on average spending
- **Impulse Tracking** - Mark purchases as impulse vs planned to track decision quality
- **Discipline Grade** - A-F grade based on your spending vs monthly budget
- **Transaction Management** - Full CRUD with date ranges and category filters
- **Budget Settings** - Configure monthly budget, starting balance, hourly rate
- **Biometric Lock** - Face ID / Touch ID app lock via `expo-local-authentication`; prompts on every app open when enabled

### 💡 Smart Feedback System
- **Overspending Warnings** - Alerts when exceeding budget or spending faster than expected
- **Savings Encouragement** - Positive feedback when on track for savings goals
- **Impulse Alerts** - Warnings when impulse purchases exceed 40%
- **Streak Celebration** - Recognition for consistent logging habits
- **Discipline Praise** - Congratulations for A-grade budgeting

### 🤖 AI Financial Advisor
- **Smart Chatbot** - AI-powered financial advisor analyzes your real spending data
- **Pattern Detection** - Identifies spending patterns by category and time
- **Overspending Alerts** - Highlights categories where you're overspending vs last month
- **Spending Spikes** - Detects unusual high-spending days
- **Month-End Projections** - Predicts end-of-month balance based on current trends
- **Personalized Tips** - Actionable advice based on your income, goals, and risk tolerance
- **Contextual Insights** - No generic advice - all recommendations based on your actual data
- **Quick Insights** - Pre-built analysis summaries shown before chatting

### 📥 Secure Transaction Import
- **CSV Upload** - Import bank statements without sharing credentials
- **Auto-Categorization** - Smart category detection based on transaction descriptions
- **Impulse Detection** - Automatic flagging of potential impulse purchases
- **Preview & Edit** - Review all transactions before importing with ability to edit categories
- **Duplicate Detection** - Automatically skips transactions that already exist
- **Privacy First** - Files processed locally on device, never uploaded to servers

### 📊 Smart Analytics & Behavior Detection
- **Subscription Detection** - Automatically identifies recurring charges (weekly/monthly/yearly)
- **Duplicate Charge Alerts** - Flags potential duplicate payments for refunds
- **Unusual Transaction Detection** - Highlights purchases significantly above category averages
- **Weekend Spending Analysis** - Compares weekend vs weekday spending patterns
- **Seasonal Trend Detection** - Identifies month-over-month spending changes
- **Top Waste Categories** - Shows your top 3 money drains with actionable tips
- **Personalized Savings Tips** - Category-specific advice based on your spending habits
- **Potential Savings Calculator** - Estimates how much you could save by reducing waste

### 🏆 Gamification
- **Logging Streak** - Build daily streaks by logging at least one transaction per day
- **Badge System** - Unlock achievements:
  - "0 Impulse Day" - A day with no impulse purchases
  - "7-Day Streak" / "30-Day Streak" - Consistent logging
  - "Budget Master" - Staying under budget
  - "No Subscriptions" - Month without subscription charges

### 💰 Advanced Metrics
- **Time Cost Display** - See purchases in terms of work hours (e.g., "This coffee cost 32 minutes")
- **14-Day Spending Chart** - Visual bar chart of daily spending patterns
- **Average Daily Spend** - Auto-calculated from last 30 days
- **Impulse Percentage** - Track the % of impulse vs planned purchases

### 🔐 Privacy & Offline
- 100% offline-first with SQLite local storage
- No backend required, no data syncing
- Works without internet connection
- All data stays on your device

### 🏢 Business Mode
- **6-tab dashboard** - Dashboard, Expenses, Team, Payroll, Budget, Settings
- **Expense Tracking** - Submit, approve/reject expenses with receipt images
- **Team Management** - Invite codes, roles (owner/manager/employee)
- **Payroll** - Monthly salary tracking, mark paid/unpaid per employee
- **Budget** - Category budget limits with spending progress bars
- **Tools & Subscriptions** - Detect recurring software expenses, monthly cost totals, upcoming charges, and step-by-step cancellation guides for 25+ popular tools

## Tech Stack
- **React Native** 0.79.6
- **Expo** 53
- **TypeScript** - Type-safe throughout
- **SQLite** (expo-sqlite) - Local storage
- **AsyncStorage** - Auth persistence
- **React Query** - Server/async state management
- **NativeWind** - Tailwind CSS for React Native
- **Expo Linear Gradient** - Beautiful gradient headers
- **Expo Haptics** - Touch feedback
- **Lucide Icons** - Beautiful icon system
- **date-fns** - Date utilities
- **React Navigation** - Tab navigation

## Project Structure
```
src/
├── app/
│   ├── _layout.tsx           # Root layout with auth routing
│   ├── login.tsx             # Login screen
│   ├── signup.tsx            # Sign up screen
│   ├── onboarding.tsx        # 4-step onboarding questionnaire
│   ├── accounts.tsx          # Account management screen
│   ├── advisor.tsx           # AI Financial Advisor chatbot
│   ├── import.tsx            # CSV transaction import screen
│   ├── (tabs)/
│   │   ├── _layout.tsx       # Tab navigation config (5 tabs)
│   │   ├── index.tsx         # Dashboard screen
│   │   ├── add.tsx           # Add transaction screen
│   │   ├── transactions.tsx  # Transactions list + filters
│   │   ├── advisor.tsx       # AI Advisor tab redirect
│   │   └── settings.tsx      # Budget & app settings
│   └── add-transaction.tsx   # Modal add screen (alt)
├── lib/
│   ├── db.ts                 # SQLite operations (transactions, accounts, settings)
│   ├── auth.ts               # Authentication functions
│   ├── currencies.ts         # Currency data and conversion
│   ├── calculations.ts       # Financial calculations
│   ├── ai-analysis.ts        # AI spending analysis and prompt building
│   ├── import-parser.ts      # CSV parsing and auto-categorization
│   ├── cn.ts                 # Tailwind class utilities
│   └── ...
└── components/               # Reusable components
```

## Data Model

### Transactions Table
```
id: string (primary)
amount: number
category: 'Food' | 'Gym' | 'Transport' | 'Shopping' | 'Subscriptions' | 'Other'
type: 'Expense' | 'Income'
isImpulse: boolean
note: string (optional)
dateISO: string (YYYY-MM-DD)
createdAt: string (ISO timestamp)
accountId: string (foreign key to accounts)
currency: string (currency code)
```

### Accounts Table
```
id: string (primary)
name: string
type: 'cash' | 'checking' | 'savings' | 'credit' | 'investment' | 'other'
balance: number
currency: string
color: string (hex color)
icon: string
isDefault: boolean
createdAt: string (ISO timestamp)
```

### Settings Table
```
id: 1 (singleton)
monthlyBudget: number
startingBalance: number
hourlyValue: number ($/hour for time cost)
showTimeCost: boolean
currency: string
currencySymbol: string
monthlyIncome: number
savingsGoal: number
spendingStyle: 'frugal' | 'moderate' | 'generous'
primaryGoal: 'save' | 'track' | 'reduce_debt' | 'budget'
```

## Key Calculations

- **Balance** = startingBalance + income - expenses
- **Survival Days** = currentBalance / averageDailySpend
- **Impulse %** = (impulse transactions / total transactions) × 100
- **Discipline Grade** = Based on monthlySpent vs monthlyBudget ratio:
  - A: ≤70% of budget
  - B: ≤85%
  - C: ≤100%
  - D: ≤115%
  - F: >115%
- **Time Cost** = (amount / hourlyValue) × 60 minutes
- **Logging Streak** = Consecutive days with ≥1 transaction
- **Budget Pace** = Compare actual spending % vs expected % for day of month

## Getting Started

### Installation
```bash
# Already installed - just run:
bun start
```

### Initial Setup
1. Open the app
2. Sign up with email and password
3. Complete the 4-step onboarding:
   - Choose your currency
   - Enter monthly income and savings goal
   - Select your primary financial goal
   - Pick your spending style
4. Add your bank accounts (optional)
5. Start adding transactions on Dashboard

### Demo Data
The app seeds with 14 days of realistic demo transactions on first launch if DB is empty.

## Usage

### Adding Transactions
1. Tap the **Add** tab or "Add Transaction" button
2. Enter amount
3. Select type (Expense/Income)
4. Choose category
5. Select account (if multiple accounts)
6. Set date (defaults to today)
7. Toggle Impulse if unplanned
8. Add optional note
9. Save

### Managing Accounts
1. Go to **Settings** > **Manage Accounts**
2. Tap + to add new account
3. Choose account type, name, initial balance, and color
4. Transactions will auto-update account balances

### Filtering Transactions
1. Go to **History** tab
2. Filter by date range, category, or impulse-only
3. View grouped by date with daily totals
4. Swipe to delete individual transactions

### Tracking Discipline
- Check **Dashboard** for:
  - Smart feedback messages (warnings/encouragement)
  - Current balance & survival days
  - Daily/weekly/monthly spending
  - Discipline grade vs budget
  - Impulse percentage
  - Logging streak & badges
  - Account summary

## Styling
- **Dark mode default** for better financial app feel
- **NativeWind** for all styling (Tailwind classes)
- **Lucide icons** for consistent iconography
- **Rounded cards** with subtle depth
- **Color system**: Purple for primary, reds for expenses/warnings, greens for income/success, pinks for impulse

## License
MIT
