# Demo video script

Google's reviewers watch this video to see that Latchet asks for
`gmail.readonly`, shows the user an honest consent screen, uses the data only for
the feature it describes, and lets the user disconnect. A video that misses one
requirement is the most common cause of a slow review.

## What Google requires

From [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
and [Demo video](https://support.google.com/cloud/answer/13804565), checked on
12 October 2026:

| Requirement | Covered in shot |
|---|---|
| The end-to-end OAuth grant flow, in English | 2, 4 |
| The app name on the consent screen, matching what you submitted | 2, 4 |
| The **OAuth client ID visible in the browser address bar** | 2 |
| The complete consent screen showing exactly the scopes requested | 2, 4 |
| The consent screen's language selector (bottom left) set to English | 2 |
| The functionality the scope enables, every point where Gmail data is used | 5 |
| The app's overall purpose | 1, 3 |
| Narration (voice or captions) is recommended | all |
| Uploaded to YouTube as unlisted; link pasted into the submission | upload |

Latchet has one OAuth client. If you ever add a second client ID for Gmail, the
video must show data access through each one.

## Why there are two recordings of the consent screen

Latchet is a mobile app. It opens Google's sign-in in the system's
authentication sheet, which shows only the host name, `accounts.google.com`, and
hides the address bar, so the client ID cannot be seen there. Shot 2 therefore
opens the **same authorization request** in a desktop browser, where the address
bar shows `client_id=…`. Then shots 3–4 complete the real flow in the app. Say
this in the narration, so the reviewer knows why.

## Before recording

- [ ] **The production setup.** Production backend, production OAuth client:
      the client ID you are submitting. A TestFlight or preview build that talks
      to production.
- [ ] **A demo Google account** made for this. Not your personal one, because
      its inbox is on camera. It takes one of the 100 unverified slots. Put
      realistic billing emails in it, all dated within the past 12 months: two
      or three monthly receipts (for example a streaming service and a music
      service), a free-trial-ending notice, a price-increase notice and an
      annual renewal. Forward real ones from your own mail, or send them from
      another account.
- [ ] **A demo Latchet account**, signed in, with the subscriptions list
      empty, so detection is visible.
- [ ] **English everywhere**: the phone or simulator, the Google account
      language, and the consent screen's language selector.
- [ ] **Nothing secret on screen**: never show the OAuth client secret, tokens,
      `.env` or Railway variables. Close other tabs. Silence notifications.
- [ ] **The authorization URL for shot 2.** Build it by hand. Replace the two
      placeholders and keep everything else as is:

      ```text
      https://accounts.google.com/o/oauth2/v2/auth?client_id=<GOOGLE_CLIENT_ID>&redirect_uri=<URL-encoded BACKEND_URL>%2Fapi%2Fv1%2Femail%2Foauth%2Fgmail%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly&access_type=offline&prompt=consent
      ```

      For example, with `BACKEND_URL=https://api.latchet.app` the <!-- TODO(domain) -->
      `redirect_uri` value is
      `https%3A%2F%2Fapi.latchet.app%2Fapi%2Fv1%2Femail%2Foauth%2Fgmail%2Fcallback`. <!-- TODO(domain) -->
      It must be exactly the redirect URI registered on the client, or Google
      shows an error instead of the consent screen. This URL carries no `state`
      that the server issued, so **do not grant** in this window, because the
      server would reject the callback. Shot 4 does the real grant.
- [ ] **Recording**: macOS screen recording (Shift-Command-5) of the desktop with
      the iOS Simulator window, 1080p or better. Zoom in afterwards on the
      address bar, the client ID and the scope line.

## Shot list (about 5 minutes)

### Shot 0: title card (0:00–0:10)

On screen: "Latchet: Gmail API verification demo. Scope:
gmail.readonly. OAuth client ID: `<client ID>`."

### Shot 1: the app and its homepage (0:10–0:40)

Desktop browser. Open `https://latchet.app`. Scroll through "What Latchet <!-- TODO(domain) -->
does" and "How inbox reading works". Click **Privacy policy**. Scroll to
"Reading your inbox" and stop on the Limited Use statement.

> **Narration:** "Latchet is a personal-finance app. Its subscription
> tracker finds recurring charges and free trials people forget, and reminds
> them before the next charge. Users can connect Gmail so Latchet can find
> subscription receipts. Our privacy policy, linked from the homepage and from
> the consent screen, explains what we read and keep, and states that our use of
> Google user data follows the Google API Services User Data Policy, including
> the Limited Use requirements."

### Shot 2: the OAuth client ID and the consent screen (0:40–1:40)

1. Google Cloud console → Google Auth Platform → **Clients** → the Web
   application client. Zoom on the **Client ID**. Do not open the secret.
2. Open a new browser window. Paste the authorization URL. **Widen the window**
   until the whole `client_id=…apps.googleusercontent.com` part of the address
   bar is readable. Zoom on it and hold for three seconds.
3. Choose the demo Google account.
4. If verification is still pending, Google shows its unverified-app warning.
   Continue past it.
5. The **consent screen**: hold on the app name, the support email, and the
   line for the `gmail.readonly` permission (Google words it as reading your
   email messages and settings). Scroll to the bottom left and show the
   language selector set to **English**.
6. Close the window **without granting**.

> **Narration:** "This is our OAuth client ID in the Cloud console. Latchet
> is a mobile app whose sign-in sheet hides the address bar, so here is the
> identical authorization request in a desktop browser. The address bar shows
> the same client ID. The app requests one scope, gmail.readonly, read-only
> access. The consent screen is in English. We will grant access from the app
> itself in a moment."

### Shot 3: the in-app disclosure (1:40–2:05)

iOS Simulator. Latchet, signed in to the demo account. Open the email
screen and show the **Connect Gmail** disclosure (the text in
`limited-use-privacy-wording.md` §4). Hold long enough to read it. Tap
**Continue to Google**.

> **Narration:** "Before anything opens, the app tells the user what it will
> read, what it keeps, that it never sends, deletes or changes email, that the
> data is never sold or used for ads, and how to disconnect."

### Shot 4: granting access in the app (2:05–2:40)

The authentication sheet opens on `accounts.google.com`. Choose the demo
account. Continue past the unverified warning if shown. On the **consent
screen**, show the app name and the `gmail.readonly` line again, then tap
**Continue**. The app returns and shows Gmail as connected, scanning.

> **Narration:** "Same app name, same single read-only scope. After the user
> continues, our server receives an authorization code, exchanges it, and stores
> the tokens encrypted. The first scan looks for billing email from the past
> 12 months."

### Shot 5: the feature that uses the data (2:40–4:00)

1. The email screen: the scan finishes and shows how many messages were
   checked and how many billing emails were found.
2. Open **Subscriptions**. The services from the demo inbox are listed with
   amount, billing cycle and next charge date.
3. Open one subscription. Show that it came from email, its next charge date,
   and the reminder offered before it.
4. Open the free trial. Show the trial end date and the "trial ends soon"
   reminder.
5. Open the service with the price increase. Show the old and new price.
6. Optional: trigger or show a scheduled reminder notification ("Keep it, or
   did you forget?") and tap it to open the subscription.

> **Narration:** "This is everything Latchet does with Gmail data. From
> each billing email our server extracts only the merchant, amount, currency,
> billing cycle and dates. It never stores the message, its attachments or any
> email address. The app turns these into the subscription list, the trial and
> renewal reminders, and price-rise alerts. Nothing else uses this data: no
> ads, no sale, no AI training, and no person reads it."

### Shot 6: disconnecting and revocation (4:00–4:45)

1. In the app, open the Gmail connection and tap **Disconnect**. Confirm. The
   connection and its findings disappear.
2. Desktop browser: `https://myaccount.google.com/permissions`, signed in as the
   demo account. Show that Latchet is **no longer listed** among the apps
   with access. If it still appears, wait a moment and refresh: Google says a
   revocation "might take some time" to take full effect
   ([Token revocation](https://developers.google.com/identity/protocols/oauth2/web-server)).

> **Narration:** "Users can disconnect at any time. Disconnecting revokes Real
> Latchet's token with Google, which you can see here in the Google account's
> third-party access list, and deletes everything we extracted from that inbox.
> Deleting a Latchet account revokes every connection the same way."

### Shot 7: end card (4:45–4:55)

"Latchet · latchet.app · privacy policy: latchet.app/privacy · support:
support@latchet.app" <!-- TODO(domain) -->

## Upload

- YouTube Studio → Upload → visibility **Unlisted**.
- Title: "Latchet: Gmail API OAuth verification demo (gmail.readonly)".
- Add captions from the narration above (or upload them as an `.srt`).
- Open the link in a private window to check that it plays when signed out.
- Paste the link into the Verification Center submission.

## Microsoft (optional, short version)

Microsoft does not ask for a video for publisher verification
([Mark an app as publisher verified](https://learn.microsoft.com/en-us/entra/identity-platform/mark-app-as-publisher-verified)).
A short recording is still useful for App Store review, for support, and to show
the consent prompt before and after verification. Ninety seconds is enough:

1. In the app, open the email screen and show the disclosure. Tap **Connect
   Outlook**.
2. Sign in with a personal Microsoft account (Outlook.com or Hotmail).
3. Microsoft's **consent screen**: show the app name, the publisher line
   ("Unverified" today, your organisation's name with a blue verified badge
   afterwards), and the permissions: `Mail.Read` (Microsoft's text: "Read user
   mail") and `offline_access` ("Maintain access to data you have given it
   access to")
   ([Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference);
   [Consent experience](https://learn.microsoft.com/en-us/entra/identity-platform/application-consent-experience)).
   Accept.
4. The scan runs. Show the detected subscriptions.
5. **Disconnect** in the app. Then open `https://account.live.com/consent/Manage`
   and remove Latchet there too. Microsoft offers apps no way to withdraw
   their own access to a personal account, so this page is where the user
   removes it at Microsoft's end. Disconnecting in the app already deleted
   Latchet's tokens.
