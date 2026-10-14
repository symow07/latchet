# Limited Use wording: privacy policy, homepage and in-app consent

Google requires three things of an app that reads Gmail with a restricted
scope, and checks all three during verification:

1. A privacy policy that discloses how the app "accesses, uses, stores, and/or
   shares Google user data", hosted on the homepage's domain and linked from
   the consent screen
   ([Verification requirements](https://support.google.com/cloud/answer/13464321)).
2. An affirmative statement that the app's use of the data complies with the
   Limited Use requirements, "disclosed in your application or on a website
   belonging to your web-service or application", for example through a
   homepage link to the privacy policy
   ([Google Workspace API user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)).
3. In-product privacy notices that are "prominently displayed in your app
   interface"
   ([Verification requirements](https://support.google.com/cloud/answer/13464321)).

`PRIVACY.md` already carries items 1 and 2. This document is the source text for
all three, so the policy, the homepage and the app say the same thing. Checked
against Google's pages on 12 October 2026.

## The rules being promised

From the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
(last updated 15 February 2024) and, because Gmail is a Google Workspace API,
the [Google Workspace API user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
(last updated 3 September 2026):

- **Use**: only to provide or improve user-facing features that are prominent
  in the app's interface.
- **Transfer**: only (a) to provide or improve those features, with the user's
  consent; (b) for security; (c) to comply with law; (d) in a merger,
  acquisition or asset sale, after the user's explicit prior consent.
- **Human reading**: not allowed unless the user explicitly agrees for specific
  data, it is needed for security or by law, or the data is aggregated and
  anonymised for internal operations.
- **Prohibited**: selling or transferring data to advertising platforms, data
  brokers or information resellers; serving ads, including retargeting and
  interest-based ads; determining creditworthiness or lending; and
  "transferring, selling, or using user data to create, train, or improve a
  machine learning or artificial intelligence model" beyond that user's own
  personalised model.
- These rules cover raw data and anything derived from it, aggregated or
  anonymised.

Latchet is a finance app, so the creditworthiness and lending prohibition is
worth stating outright, even though Latchet does neither.

## 1. The Limited Use statement

Put this sentence, with both links, in the privacy policy **and** on the
homepage. It is the example in Google's
[Verification FAQ](https://support.google.com/cloud/answer/13463817), widened
from "use" to "use and transfer to any other app" so that it also covers the
OpenAI fallback:

> Latchet's use and transfer to any other app of information received from
> Google APIs will adhere to the
> [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
> including the
> [Limited Use requirements](https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes).

Markdown, ready to paste:

```markdown
Latchet's use and transfer to any other app of information received from
Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the [Limited Use requirements](https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes).
```

If the app is renamed, change "Latchet" here, in `PRIVACY.md` and on the
homepage at the same time.

## 2. The privacy-policy paragraph (Gmail and Outlook)

This is the substance `PRIVACY.md` carries in its "Reading your inbox" section.
If you edit one, edit the other.

> **What we read.** If you connect Gmail (Google's read-only `gmail.readonly`
> permission) or Outlook (Microsoft's read-only `Mail.Read` permission), our
> server looks only for billing email: on the first connection, receipts,
> invoices, renewal and trial notices, price changes and cancellations from the
> past 12 months; after that, new mail as it arrives. Mail that does not look
> like a bill is not opened or kept. At most its sender and subject line are
> checked, in memory, to decide. We can never send, delete, move or change your
> email.
>
> **What we keep.** From each billing email we keep only the fields we
> extracted: the merchant, the sender's domain (such as `netflix.com`), the
> amount and currency, the billing cycle, the dates (charge, email, next
> charge, trial end), a previous price if it changed, the kind of email, where it was billed
> (Apple, Google Play or PayPal) and a short label made from the subject with
> every number removed. We never keep the body, attachments, the subject line
> as written, or anyone's email address apart from your own connected
> address, which we keep to show you which inbox is connected.
>
> **How it is read.** Parsing is rule-based, on our server. Only if AI reading
> is switched on for our service, and only for a billing email the rules could
> not read, we send that email's sender domain, subject and text to OpenAI to
> extract the same fields. OpenAI does not use data sent through its API to
> train its models.
>
> **What we never do.** We never sell this data, never use it for advertising,
> never use it to decide creditworthiness or lending, and never use it to train
> AI models. No person at Latchet reads it, unless you ask us to look at a
> specific email, or the law or the security of the service requires it. It is
> transferred only to provide this feature (to OpenAI, as above, and to our hosting provider), or
> where the law requires it.
>
> **Your control.** Disconnecting the inbox in the app ends our access and
> deletes everything we extracted from it. Deleting your account does the same
> for every connection.
>
> Latchet's use and transfer to any other app of information received from
> Google APIs will adhere to the Google API Services User Data Policy, including
> the Limited Use requirements.

Microsoft has no Limited Use policy, but Latchet makes Outlook users the same
promises. One rule keeps the code honest: data from any inbox is handled the
same way.

## 3. Homepage version (short)

For the "How inbox reading works" block on the homepage
(`homepage-content.md` uses it):

> Latchet reads only billing email, keeps only the merchant, amount,
> currency, billing cycle and dates it finds, and never keeps the message
> itself. It can never send, delete or change your email. Your data is never
> sold, never used for ads, never used to judge your credit, and never used to
> train AI.
>
> Latchet's use and transfer to any other app of information received from
> Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
> including the [Limited Use requirements](https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes).

## 4. In-app consent text

Show this on the screen where the user taps "Connect Gmail" or "Connect Outlook",
**before** the provider's sign-in sheet opens. It is the prominent in-product
disclosure Google asks for, and it is where the user consents to the OpenAI
transfer. The demo video films this screen (shot 3).

The app's strings live in `mobile/src/lib/i18n/locales/fragments/emailConnect.json`
in English, French, Chinese and Arabic. This is the English source. Translate
the meaning, not word for word.

**Title:** Find subscriptions in your email

**Body:**

> Latchet will look for billing email (receipts, renewals, trial and price
> notices) from the past year, then new ones as they arrive.
>
> - **Read-only.** It can never send, delete or change your email.
> - **Only what it needs.** It keeps the merchant, amount, currency, billing
>   cycle and dates. Never the message, its attachments or other people's
>   addresses.
> - **Never sold or used for ads.** Not used to judge your credit, and not used
>   to train AI.
> - **AI only as a fallback.** If our rules can't read a billing email, its
>   text may be sent to OpenAI to pull out the same details. OpenAI does not
>   train on it.
> - **Disconnect any time.** Access ends and everything found is deleted.

**Link:** How we handle your data → the privacy policy URL

**Button:** Continue to Google (or Continue to Microsoft)

**While Google has not verified the app** (`GOOGLE_OAUTH_VERIFIED=false`), add
one line before the button:

> Google will warn that it hasn't verified Latchet yet. That review is in
> progress. If you continue, Latchet reads your mail exactly as described
> above, and you can disconnect at any time.

Only write "in progress" while a verification request has actually been
submitted. Until then, use: "Google will warn that it hasn't verified
Latchet. Verification is a paid review we haven't done yet; the app reads your
mail exactly as described above."

## 5. Where each piece goes

| Text | Where | Owner |
|---|---|---|
| Limited Use statement (§1) | `PRIVACY.md` and the homepage | `PRIVACY.md`: done. Homepage: when it is built. |
| Policy paragraph (§2) | `PRIVACY.md`, "Reading your inbox" | done |
| Homepage block (§3) | homepage | `homepage-content.md` |
| In-app consent (§4) | Connect screens in the app | `emailConnect.json` fragment, all four languages |
