# Microsoft publisher verification (Outlook)

Latchet reads Outlook.com, Hotmail and Live mail through Microsoft Graph with
the delegated `Mail.Read` permission. Publisher verification replaces the word
"Unverified" on Microsoft's consent prompt with your organisation's name and a
blue verified badge. It is free, and it is not a security assessment: there is
no Microsoft equivalent of Google's CASA for this.

Checked against Microsoft Learn on **12 October 2026**.

## Do you need it?

**Not for personal accounts, which is what Latchet admits today.** With
`MICROSOFT_TENANT=consumers` (the default), only personal Microsoft accounts can
connect. Delegated `Mail.Read` needs no admin consent and "is available for
consent in personal Microsoft accounts"
([Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)).
A personal-account user consents for themselves. Because the app is not
publisher verified, the prompt shows "Unverified" where the publisher's name
would be
([Configure an app's publisher domain](https://learn.microsoft.com/en-us/entra/identity-platform/howto-configure-publisher-domain);
[Consent experience](https://learn.microsoft.com/en-us/entra/identity-platform/application-consent-experience)).
Microsoft's blocking of unverified apps described below is an organisation
policy. Before relying on this, confirm with a fresh personal account that the
prompt lets you accept.

**Yes, if you ever admit work and school accounts** (`MICROSOFT_TENANT=common`).
Risk-based step-up consent is on by default in organisations. It treats a consent
request as risky when the app is a newly registered multitenant app that is not
publisher verified and asks for more than basic sign-in, which `Mail.Read` does.
Such a request "requires a 'step-up' to admin consent". The user sees
`AADSTS90094` and has to ask their administrator
([Risk-based step-up consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-risk-based-step-up-consent);
[Publisher verification overview](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)).
Microsoft also recommends that organisations allow user consent only for apps
from verified publishers
([Configure how users consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent)).

**Cost:** "Microsoft doesn't charge developers for publisher verification. No
license is required"
([Publisher verification overview](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)).
The real cost is the prerequisites: a registered business and a domain with
email.

## What Latchet uses at Microsoft

**The app registration** (Microsoft Entra admin center → Entra ID → App
registrations):

| Setting | Value |
|---|---|
| Supported account types | **Personal Microsoft accounts only**, matching `MICROSOFT_TENANT=consumers`. Choose "Accounts in any organizational directory and personal Microsoft accounts" only together with `MICROSOFT_TENANT=common`. |
| Platform and redirect URI | **Web**, `${BACKEND_URL}/api/v1/email/oauth/outlook/callback`, HTTPS. Move it to your own domain (for example `https://api.latchet.app/...`) when the Google work moves `BACKEND_URL`. <!-- TODO(domain) --> |
| API permissions | Microsoft Graph, **Delegated**: `Mail.Read` (Microsoft's text: "Read user mail"; admin consent: No) and `offline_access` ("Maintain access to data you have given it access to"; admin consent: No). `offline_access` provides the refresh token that lets the server check new mail while the user is away. The code also requests `openid` and `email` (sign-in scopes, no admin consent) so the ID token names the connected address; nothing else (`OUTLOOK_SCOPES` in `backend/src/lib/email-providers/outlook.ts`). If that list changes, change this row and `PRIVACY.md`. |
| Client secret | Certificates & secrets → New client secret. The lifetime is at most 24 months, and Microsoft recommends less than 12. The value "is never displayed again" after you leave the page ([Add and manage app credentials](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials)). |

**The env vars on Railway** (`backend/src/env.ts`):

| Variable | Where it comes from |
|---|---|
| `MICROSOFT_CLIENT_ID` | App registration → Overview → **Application (client) ID** |
| `MICROSOFT_CLIENT_SECRET` | The client secret's **Value**, not its Secret ID |
| `MICROSOFT_TENANT` | `consumers` (default: personal accounts only), or `common` (personal plus work and school). A specific tenant ID would restrict sign-in to one organisation, which is wrong for Latchet. |

**Publisher verification changes none of these.** Latchet has no
"Microsoft verified" switch, and needs none.

Microsoft says client secrets "should not be used in production" and recommends
certificates
([Add and manage app credentials](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials)).
Latchet's code uses a client secret today. Switching to a certificate is a code
change, not part of verification. Until then, rotate the secret before it
expires: add a new secret, set `MICROSOFT_CLIENT_SECRET` on Railway, redeploy,
then delete the old secret. Put the expiry date in the calendar a month early.
An expired secret silently stops every Outlook sync.

## Prerequisites

From the [publisher verification requirements](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview#requirements):

- [ ] **A verified Microsoft AI Cloud Partner Program (CPP) account.** Its
      Partner One ID must be the **partner global account (PGA)**. A partner
      location ID does not work. Joining is free:
      [partner.microsoft.com](https://partner.microsoft.com/membership).
- [ ] **The app registered in a Microsoft Entra tenant by a Microsoft Entra
      (work) account.** "Apps that are registered by using a Microsoft account
      can't be publisher verified." Email-verified (unmanaged) tenants and
      Azure AD B2C tenants are not supported either.
- [ ] **That tenant associated with the PGA** in Partner Center.
- [ ] **A publisher domain on the app**, not `*.onmicrosoft.com`. It must match
      the domain of the email address used in Partner Center verification, or be
      a DNS-verified custom domain in the tenant.
- [ ] **The right roles for the person doing it**: Application Administrator or
      Cloud Application Administrator in Entra, **and** CPP Partner Admin or
      Account Admin in Partner Center.
- [ ] **Multifactor authentication**, performed in the same session as the
      verification.
- [ ] **Acceptance** of the
      [Microsoft identity platform for developers Terms of Use](https://learn.microsoft.com/en-us/legal/microsoft-identity-platform/terms-of-use).

**What Partner Center verifies**
([Understand the verification process](https://learn.microsoft.com/en-us/partner-center/enroll/understand-the-verification-process),
updated 27 July 2026). The steps are independent, and the account is verified
only when all of them pass. "In most cases" it takes three to five business days.

| Check | What it needs |
|---|---|
| Email | The primary contact's **business** email. Use "an employee business email address", "not a personal or free email account". |
| Identity | A government-issued ID whose name matches the user's name on the account. |
| Employment | Current domain documentation for your business from an authorised registrar: business name, address, domains, purchase and expiry dates. |
| Business | Proof that the business is legally registered at the stated address: formation documents, business licence or registration certificate, matching the account exactly. |
| Additional | Sometimes a questionnaire, at Microsoft's discretion. |

**What this means for a solo developer.** You need a legally registered
business (in many countries a registered sole proprietorship counts; check
yours), a domain registered to it, and a mailbox on that domain, for example
`support@latchet.app`. Microsoft publishes no route for an unregistered <!-- TODO(domain) -->
individual. If you have no registered business, skip publisher verification:
personal Outlook users can still connect.

## Steps

### 0. Check how the current app registration was made

If the Outlook app registration was created while signed in with a personal
Microsoft account (for example an Azure account opened with an `@outlook.com`
address), it cannot be verified. Microsoft returns `MSANotSupported`: "Only
applications registered in Microsoft Entra ID by a Microsoft Entra user are
supported"
([Troubleshoot publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/troubleshoot-publisher-verification)).
If you are unsure, go ahead to step 4: the error tells you.

If you have to re-register, you get a new `MICROSOFT_CLIENT_ID` and
`MICROSOFT_CLIENT_SECRET`. Refresh tokens "are bound to a combination of user and
client"
([Refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)),
so every existing Outlook connection stops working at the switch. Each user sees
the connection as needing reconnection and connects once more. If you know you
will verify, register correctly before many people connect.

### 1. Prepare the Entra tenant

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com).
   A free Azure account comes with a tenant.
2. Add your domain: Entra ID → Domain names → Add custom domain →
   `latchet.app`. Add the TXT record it shows at your DNS host and verify <!-- TODO(domain) -->
   ([Add a custom domain](https://learn.microsoft.com/en-us/entra/fundamentals/add-custom-domain)).
3. Create a member user on that domain, for example `admin@latchet.app`. <!-- TODO(domain) -->
   Give it Application Administrator (or Global Administrator) and require MFA
   for it.
4. If step 0 says so, register the app again while signed in as that user,
   with the settings in "What Latchet uses at Microsoft" above.

### 2. Join and verify in Partner Center

1. Sign in at [partner.microsoft.com](https://partner.microsoft.com/membership)
   with the work account from step 1 and join the **Microsoft AI Cloud Partner
   Program**. Enter the legal business name and address exactly as they appear
   on the registration documents. Make the primary contact's email an address on
   your domain.
2. Account settings → **Legal info** → **Verification Summary**: complete the
   email, identity, employment and business checks, and upload the documents
   asked for.
3. When the status is **Authorized**, copy the Partner One ID: partner profile
   → Identifiers → Microsoft Cloud Partners Program tab, the ID of type
   **PartnerGlobal**.
4. If the app's tenant is not the PGA's primary tenant, add it to the Partner
   Center account
   ([Multi-tenant account](https://learn.microsoft.com/en-us/partner-center/multi-tenant-account)).

### 3. Set the publisher domain

App registrations → Latchet → **Branding & properties** → **Publisher
domain** → **Select a verified domain** → `latchet.app` <!-- TODO(domain) -->
([Configure an app's publisher domain](https://learn.microsoft.com/en-us/entra/identity-platform/howto-configure-publisher-domain)).

If the domain is not in the tenant, choose **Verify a new domain** instead and
host this file at
`https://latchet.app/.well-known/microsoft-identity-association.json`, served <!-- TODO(domain) -->
as `application/json`:

```json
{
  "associatedApplications": [
    { "applicationId": "<MICROSOFT_CLIENT_ID>" }
  ]
}
```

You can remove the file after the domain is verified.

### 4. Verify the publisher

From [Mark an app as publisher verified](https://learn.microsoft.com/en-us/entra/identity-platform/mark-app-as-publisher-verified):

1. Sign in with MFA as the user from step 1.
2. App registrations → Latchet → **Branding & properties**.
3. **Add Partner ID to verify publisher** → enter the Partner One ID →
   **Verify and save**.
4. Wait a few minutes. On success the blue verified badge appears next to the
   Publisher display name.

### 5. Check

Connect Outlook in the app with a personal account that has never connected, or
first remove Latchet at
[account.live.com/consent/Manage](https://account.live.com/consent/Manage). The
consent prompt should show the publisher's name with the blue badge. Microsoft
mentions `prompt=consent` to force the prompt for an account that already
consented, "for testing only, and never hard-coded".

## Errors you may meet

From [Troubleshoot publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/troubleshoot-publisher-verification):

| Error | Meaning | Fix |
|---|---|---|
| `MSANotSupported` | The app was registered by a personal Microsoft account | Step 0: re-register under a work account |
| `EmailVerifiedTenantNotAllowed` | The tenant is unmanaged (created by email sign-up) | Use a managed tenant (step 1) |
| `MPNAccountNotVetted` | Partner Center verification is not finished | Finish step 2 |
| `MPNGlobalAccountNotFound` / `MPNAccountInvalid` | A location ID or a wrong ID was entered | Use the PartnerGlobal ID |
| `MPNAccountNotFoundOrNoAccess` | Your user lacks the Partner Center role, or the tenant is not associated | Fix the roles; associate the tenant (step 2.4) |
| `NoPublisherDomainOnApplication` | No publisher domain | Step 3 |
| `PublisherDomainMismatch` | The publisher domain differs from the Partner Center email's domain | Use the same domain, verified |
| `NotAuthorizedToVerifyPublisher` | Your user lacks the Entra role | Assign Application Administrator |
| `InteractionRequired` | MFA was not performed in this session | Require MFA, sign in again |

## What changes for users

- The consent prompt shows your organisation's verified name and a blue badge
  instead of "Unverified".
- Nothing else changes: the same permissions and the same connections, and
  nobody reconnects, unless step 0 forced a new registration.
- If you also switch `MICROSOFT_TENANT` to `common`, work and school accounts
  can connect, subject to their organisation's consent settings. Some
  organisations disable user consent entirely, and their users will need an
  administrator.

## True with or without verification

- **Revocation.** Microsoft's API that invalidates a user's refresh tokens,
  `revokeSignInSessions`, lists personal Microsoft accounts as "Not supported"
  ([user: revokeSignInSessions](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions)).
  An app cannot withdraw its own access to a personal account. On disconnect
  and on account deletion, Latchet deletes its tokens, so it can no longer reach
  the mailbox. The user removes Latchet from their Microsoft account at
  [account.live.com/consent/Manage](https://account.live.com/consent/Manage), or
  at [myapps.microsoft.com](https://myapps.microsoft.com) for a work account.
  `PRIVACY.md` and `homepage-content.md` say exactly this.
- **Token lifetime.** Refresh tokens last 90 days by default and replace
  themselves on each use
  ([Refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)).
  A mailbox the server has not synced for 90 days needs reconnecting. Railway
  sleeps when idle, and the app asks for a sync when it opens, so this affects
  only people who stop opening the app.

## Sources

All read on 12 October 2026.

- Publisher verification overview: https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview
- Mark an app as publisher verified: https://learn.microsoft.com/en-us/entra/identity-platform/mark-app-as-publisher-verified
- Troubleshoot publisher verification: https://learn.microsoft.com/en-us/entra/identity-platform/troubleshoot-publisher-verification
- Configure an app's publisher domain: https://learn.microsoft.com/en-us/entra/identity-platform/howto-configure-publisher-domain
- Consent experience: https://learn.microsoft.com/en-us/entra/identity-platform/application-consent-experience
- Risk-based step-up consent: https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-risk-based-step-up-consent
- Configure how users consent: https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent
- Microsoft Graph permissions reference (`Mail.Read`, `offline_access`): https://learn.microsoft.com/en-us/graph/permissions-reference
- Add and manage app credentials: https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials
- Refresh tokens: https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens
- user: revokeSignInSessions: https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions
- Partner Center verification: https://learn.microsoft.com/en-us/partner-center/enroll/understand-the-verification-process
- Add a custom domain to Entra: https://learn.microsoft.com/en-us/entra/fundamentals/add-custom-domain
- Partner Center multi-tenant account: https://learn.microsoft.com/en-us/partner-center/multi-tenant-account
