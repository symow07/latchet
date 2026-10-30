# End-to-end tests (Maestro, iOS simulator)

The app as a user drives it, on the iOS simulator, against the **local backend**,
with a dedicated test account. Run after every SDK upgrade step, before
reporting, and before any release build.

```bash
e2e/run.sh step2          # every flow; screenshots in e2e/screenshots/step2/
e2e/run.sh step2 06 07    # one or two flows (01, the sign-in, always runs first)
```

The run prints one line per flow and exits non-zero if any failed. Every
screen the flows visit is saved, in order, in `e2e/screenshots/<label>/`;
a failed flow adds `FAILED-<flow>.png`, the screen at the moment it failed.
Maestro's own logs are in `e2e/output/<label>/`. Both folders are gitignored.

To see what an upgrade changed on screen, compare two runs:

```bash
node e2e/compare.mjs step2 step3
```

It lists every screen by the share of its pixels that changed (the status bar
left out) and writes before | after | changed-in-red images to
`e2e/screenshots/compare-step2-step3/`. Some change is always there: each run
adds its own expenses, dated today and named after the run. The images show
whether a change is that or the app.

## What it needs

- **Maestro**: `brew install mobile-dev-inc/tap/maestro`.
- **The local backend** on http://localhost:3000, database `latchet_dev`,
  calling the runner's fake OpenAI. Never production.

  ```bash
  cd backend && OPENAI_BASE_OVERRIDE=http://localhost:3999 OPENAI_API_KEY=e2e-fake bun run dev
  ```

  (or "Backend (local, e2e)" in `.claude/launch.json`). The runner starts the
  fake itself, on port 3999 (`fake-openai.mjs`). Values set this way win over
  `backend/.env`, and the override is ignored in production.

  **The backend must run in this mode, or flow 09 fails.** Started the ordinary
  way (`bun run dev`, or "Backend (local)"), it calls the real OpenAI with
  whatever key `backend/.env` holds, never the fake: the advisor's review sheet
  does not appear, and no recording reaches `openai-uploads.jsonl`. Restart it
  in e2e mode before a run, and back afterwards if you need the real one.
- **A booted simulator.** The runner uses the first booted one, or the UDID in
  `E2E_DEVICE`. Developed on "iPhone 17 Pro", iOS 26.5, and passes on iOS 27.0
  there too. The iOS 27.1 runtime runs only the "iPhone Duo" foldable, whose
  screen the flows are not made for: iPhone 17 Pro on iOS 27 needs the iOS 27.0
  runtime (`xcodebuild -downloadPlatform iOS -buildVersion 27.0`).
- **The app under test**, a Release build that talks to the local backend.
  The runner installs it from `ios/DerivedData/Build/Products/Release-iphonesimulator/Latchet.app`
  (or `E2E_APP`):

  ```bash
  LANG=en_US.UTF-8 EXPO_PUBLIC_BACKEND_URL=http://localhost:3000 xcodebuild -workspace ios/Latchet.xcworkspace -scheme Latchet -configuration Release -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath ios/DerivedData build
  ```

  Release, not a development build: no dev menu, no LogBox, no Metro, so the
  flows see what a user sees.
- **The E2E account**, an `"e2e"` entry (`email`, `password`) in
  `.claude/test-accounts.local.json`, which is gitignored. It must be an
  `@example.test` address created on the local backend
  (`POST /api/auth/sign-up/email`). The runner refuses any other address.
  Never a real account, and the flows never connect Gmail: each connection uses
  up one of Google's 100 places for the unverified app.
- **Two business accounts** for flows 17-19, entries `"e2e-business"` (it signs
  in to the app, picks Business and creates the business) and
  `"e2e-business-member"` (it never signs in to the app: `business-setup.mjs`
  joins it to the business and submits the expense the owner approves). Both
  `@example.test`, created on the local backend the same way. A run without
  them stops before flow 17.

## The flows

| Flow | Checks |
|---|---|
| 01 sign-in | A fresh install signs in; the account-type picker and onboarding, if shown |
| 02 tabs | Every tab, the animated health ring, Subscriptions, Email receipts |
| 03 add-expense | Keypad, note, "Log it!", the expense in Activity |
| 04 history-swipe | Swiping a row reveals Delete (nothing is deleted) |
| 05 filter-sheet | The date filter sheet opens and drags closed |
| 06 csv-import | Files › On My iPhone › a bank CSV, preview, import; detection finds the monthly charge; notifications are allowed |
| 07 export | Export Data › CSV opens the share sheet with the file |
| 08 receipt-scan | The photo picker opens; a receipt goes through the reader |
| 09 voice | Hold to speak on the advisor; the review sheet shows what was heard, and the runner checks the recording that reached the backend was an MP4 with audio in it |
| 10, 11 face-id | The biometric lock locks a cold start; a matching face opens it |
| 12, 13 share | Photos › Share › Latchet shows the extension; Latchet opens the shared receipt |
| 14, 15 bill-reminder | A bill reminder push arrives and is shown |
| 16 sign-out-in | Log out, and sign back in |
| 17 business-sign-in | A fresh install signs in to the business account; the account-type picker (Business, Create a business) |
| 18 business-insights | Home's "Adjust budget" opens business Insights (the Budget screen), and it stays open |
| 19 business-payroll | Money › Payroll (the route `(business-tabs)/subscriptions`), the salary sheet, Money › Budget |

Flows 18 and 19 run as the business account, so picking either also runs 17
(`e2e/run.sh step5 18` runs 01, 17 and 18).

Business Insights and Payroll are kept off the tab bar. On SDK 58 a tab hidden
with `href: null` was sent back to the first tab as it opened, and "Adjust
budget" landed on Home; flow 18 fails on that build. Home offers "Adjust
budget" only when the month's approved spending is over the budget with
nothing waiting for review, and an owner cannot approve their own expense, so
before flow 18 the runner sets that up through the local backend's API
(`business-setup.mjs`): the member joins, the budget is 10, and the member's
expense of 25, named after the run, is approved.

Between flows the runner does what a flow cannot: it stages the receipt photo
and the CSV, enrols Face ID and sends the matching face, sends the push,
stands in for the share extension's Post (below), and puts the business over
budget (above).

## What it cannot automate, and what covers it instead

- **Selecting a photo in the system photo picker, and tapping Post in the share
  extension.** Both run in another process, and Maestro's taps do not reach
  them. Flow 08 opens and cancels the picker, then hands the receipt in the
  way the share extension does. From iOS 27 Maestro cannot read the picker at
  all, so on that version flow 08 checks that the app is covered and closes the
  picker by its X's position (the runner passes the iOS version as `E2E_IOS`). Flow 12 stops at the extension's sheet. The
  runner then writes the same App Group entry Post writes
  (`ShareViewController.swift`), and flow 13 checks that Latchet picks it up.
- **Opening the app by tapping a notification.** SpringBoard ignores synthesized
  taps on notifications. Flow 15 checks the notification is delivered and
  shown. Where a tap leads is unit-tested in `src/lib/notification-route.test.ts`.
- **What the receipt reader and voice capture extract.** Both call OpenAI from
  the backend, which here calls `fake-openai.mjs` instead. The fake answers the
  voice calls with a fixed transcript and one expense, so flow 09 sees the
  review sheet, and writes down every recording it is sent
  (`e2e/output/<label>/openai-uploads.jsonl`), which the runner checks after
  flow 09. Everything else gets the 401 an invalid key gets, so flow 08 sees
  the app's error and passes because the app handled it. The simulator
  records the Mac's microphone, so voice capture's words are never under test,
  only that a real recording arrives. (Flow 09 used to accept the error too,
  and passed for weeks while no recording was uploaded at all.)
- **The camera.** The simulator has none.

## Fixtures

- `fixtures/receipt.jpg` carries a fixed capture date, 3 February 2001, so Photos
  labels it "Photo, February 03, 2001" and flow 12 can find it.
- `fixtures/statement.csv` is a template. The runner fills in a monthly charge
  named after the run ("E2E STREAM <run>", the last four months), so every run
  imports something new. Detection drops the run number, so it is always the
  same "E2E Stream" subscription. Flow 06 waits for it, then taps "Check now",
  which asks for notification permission on a fresh install, as the app does
  for a real user (flow 15 needs it). The other rows are fixed, so the import
  also shows duplicates being skipped.
- `fixtures/bill-reminder.apns` is the push, in the shape expo-notifications
  reads (the payload under `body`).
