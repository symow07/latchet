# Homepage content

The copy for the public homepage at, for example, `https://realbudget.app`.

Google's reviewers open this page. Their requirements
([Verification requirements](https://support.google.com/cloud/answer/13464321);
[OAuth 2.0 policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)):

- It is **public**: no sign-in, no app-only link.
- It is on a **domain you own and have verified** in Search Console, not
  `github.io` or `up.railway.app`.
- It **describes what the app does**. It "can not be only a login page".
- It **links to the privacy policy**, and that link is **the same URL** as the
  one on the OAuth consent screen.
- The app name and branding match the consent screen and the demo video.

Apple's and Google Play's listings can use the same page as the support or
marketing URL (LAUNCH-CHECKLIST §9 and §10).

Replace the bracketed placeholders before publishing. Keep the facts in step
with `PRIVACY.md`. If the app changes what it reads or keeps, change both.

---

## Page title

Real Budget: find the subscriptions you forgot

## Hero

**Every subscription and free trial, caught before it charges you.**

Real Budget tracks your spending and budgets, and finds the recurring charges
you forgot about: in your bank feed, in the statements you import, and in your
email receipts. It reminds you before the next charge, so you can keep it or
cancel it in time.

[Download on the App Store] [Get it on Google Play]

## What Real Budget does

- **Budgets and spending.** Add expenses in seconds, set monthly budgets, and
  see where your money goes, in your own currency.
- **Subscriptions it finds for you.** Real Budget spots recurring charges from
  your bank, your imported statements and your billing email, and merges them,
  so Netflix appears once even if it shows up in all three.
- **Reminders before you pay.** A heads-up before each renewal and before a free
  trial turns into a paid plan, plus an alert when a price goes up or a
  cancelled service charges you again.
- **Help cancelling.** Step-by-step instructions and direct links for each
  service, including subscriptions billed through Apple or Google Play.
- **Your data, your phone.** Your budget works offline on your phone and syncs
  to your account so a new phone gets it back.

## How inbox reading works

Connecting your email is optional. You can also forward receipts by hand, or
not use email at all.

- **Gmail and Outlook.** You sign in with Google or Microsoft and grant
  read-only access: Google's `gmail.readonly` permission or Microsoft's
  `Mail.Read` permission. Real Budget can never send, delete, move or change
  your email.
- **Only billing email.** On the first connection, Real Budget looks for
  receipts, invoices, renewal and trial notices, price changes and
  cancellations from the past 12 months. After that, it checks new mail only.
  Other mail is not opened or kept.
- **Only a few facts are kept.** From each billing email Real Budget keeps the
  merchant, the sender's website (such as `netflix.com`), the amount, the
  currency, the billing cycle and the dates. Never the message itself, its
  attachments, or the email addresses in it.
- **Rules first, AI only as a fallback.** Billing emails are read by rules on
  our server. If AI reading is on and the rules cannot read an email, its text
  may be sent to OpenAI to extract the same details. OpenAI does not train on
  it.
- **Never sold, never used for ads.** Your email data is not sold, not used for
  advertising, not used to judge your credit, and not used to train AI. Nobody
  at Real Budget reads it.
- **Other providers.** For iCloud, Yahoo, GMX and others, forward billing
  emails to your private Real Budget address. They are read and kept the same
  way.

Real Budget's use and transfer to any other app of information received from
Google APIs will adhere to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the
[Limited Use requirements](https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes).

## Disconnect and delete, any time

- **Disconnect an inbox** in the app. Real Budget stops reading it at once and
  deletes everything it found there. For Gmail, it also withdraws its access
  with Google. Microsoft gives apps no way to withdraw
  their own access to a personal Outlook account, so Real Budget deletes its
  keys to your mailbox. You can also remove the app yourself:
  - Google: [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
  - Microsoft: [account.live.com/consent/Manage](https://account.live.com/consent/Manage)
- **Disconnect a bank** in the app. Plaid's access is withdrawn and the
  connection is deleted.
- **Delete your account** in the app: Settings → Delete Account. Real Budget
  withdraws every inbox and bank connection first (for Outlook, by deleting its
  keys, as above), then deletes your account and everything in it, immediately
  and permanently.

## Security

- Everything travels over HTTPS.
- The keys to your inbox and your bank connection are encrypted on our server
  (AES-256-GCM).
- Your password is never stored, only a strong one-way hash of it.

## Privacy policy

Read the full [privacy policy]([PRIVACY POLICY URL, e.g. https://realbudget.app/privacy]).
It lists exactly what Real Budget collects, why, who processes it and for how
long.

## Contact

Questions or problems: [SUPPORT EMAIL, e.g. support@realbudget.app]

## Footer

© [YEAR] [LEGAL NAME OF THE PUBLISHER] · [Privacy policy]([PRIVACY POLICY URL]) ·
[Support](mailto:[SUPPORT EMAIL])

---

## Before publishing

- [ ] The privacy policy URL here is identical to the one in Google Auth
      Platform → Branding.
- [ ] The support email works (LAUNCH-CHECKLIST §5).
- [ ] The page loads signed out, on a phone and a desktop.
- [ ] The app name matches the consent screen and the store listings.
- [ ] Every statement still matches `PRIVACY.md`. In particular, if AI reading
      is off in production (`OPENAI_API_KEY` unset), the AI sentence can stay:
      it says "may", and it stays true if AI is switched on later.
