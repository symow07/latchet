# Budget — Two New Features (pre-launch)

_Decisions: both ship before launch · advisor includes health data with guardrails · sharing is
adults-only in v1._

---

# Feature A — Household sharing

## Why this is cheaper than it looks

Business mode already is this feature with different labels. You have `Business` owning members,
`TeamMember` carrying roles, consent-based invite codes with rate limiting, and
`selectActiveBusinessId` handling multi-group membership. A couple sharing a household budget is a
two-person business. Generalise the model rather than building a parallel one.

## Schema

Rename `Business` → `Group` and `TeamMember` → `GroupMember`, adding:

```
Group.type          'business' | 'household'
GroupMember.role    business:  owner | manager | employee
                    household: owner | member
GroupMember.shareLevel  'summary' | 'categories' | 'full'
BankAccount.sharedWithGroupId  String?   // opt-in per account
```

Do the rename **now**, while the user count is effectively zero. It gets permanently expensive later.

`shareLevel` is per-member and self-chosen — it is what *I* reveal about myself, not what someone
else is permitted to take.

- `summary` — my total in/out only
- `categories` — my spend per category, no individual transactions
- `full` — my transactions

A "joint account" is an opt-in view, not a new entity: `BankAccount.sharedWithGroupId` marks an
account as visible to the household in full, regardless of the owner's `shareLevel`. That covers
the couples case without inventing joint ownership.

## Consent and visibility — non-negotiable

**App Store Guideline 5.1.2 rejects apps that let one person monitor another without the monitored
person's knowledge.** This is the difference between shipping and being pulled, so build *sharing*,
not *monitoring*:

1. **Invite-code only.** No adding by `userId`. This is the exact endpoint deleted in Task 16 —
   do not reintroduce its shape.
2. **The join screen states precisely what will be shared**, before accepting, in plain language.
3. **Every member can always see who can see what** — a persistent panel listing each member and
   their current visibility into you. Not buried in settings.
4. **Revocable unilaterally and instantly**, without leaving the group.
5. **Changing your own `shareLevel` notifies the group.** Silent reduction is fine; silent
   *increase* is how covert tracking gets built by accident.

## UI

- Household dashboard: combined totals, per-member contribution rendered at each member's own
  `shareLevel`, shared accounts in full.
- Reuse the business tab structure. The personal/business theme split in `design.ts` already
  supports a third variant.
- Settings → Household: members, invite code, my visibility, leave group.

## Verify

- A member on `summary` never leaks a category or transaction into any household response —
  assert at the API layer, not the UI.
- Leaving a group revokes access immediately, including to previously shared accounts.
- No endpoint accepts a `userId` to add a member.
- A `business`-type group and a `household`-type group cannot see each other's data.

---

# Feature B — Personalised advisor

## The safety problem, stated plainly

You asked for allergies and health conditions, and you said it must be accurate. Those two things
are in direct tension, and the tension is the whole design problem.

**A language model cannot guarantee allergen accuracy about a real product.** If the app knows
about a peanut allergy and suggests a snack containing peanuts, that is not a bad recommendation —
it is a medical emergency caused by your app. No prompt makes this reliably safe.

So the guardrail is not "be careful about products." It is: **the advisor never speaks about
specific products at all.** It speaks about spending. Health and dietary information is used only
to shape *category-level budget advice*, never to endorse, suggest or vouch for anything consumable.

That constraint keeps everything valuable and removes the failure mode:

> "Your grocery spend is 280/month for a household of two with gluten-free requirements. That runs
> roughly 15% above typical — gluten-free staples genuinely cost more, so part of that is
> structural, but buying rice and oats in bulk usually recovers a chunk of it."

Grounded, personal, useful, and it never tells anyone what is safe to eat.

## Storage — keep it off your servers

Your architecture already solves most of this. `buildAIPrompt` assembles the prompt **on-device**
and posts a finished string; the backend never sees structured user data.

So: **the health profile lives in local SQLite only.** Never synced, never in `/api/settings`,
never persisted server-side. Add an explicit exclusion in `cloud-sync.ts` with a test asserting the
profile never appears in any sync payload.

This means a breach of your backend exposes no health data, because there is none. That is a far
stronger position than encrypting it well.

It still transits to OpenAI inside the prompt — which must be disclosed, and which `PRIVACY.md`
already covers for AI content ("not used to train OpenAI models per API terms").

## Profile fields

Two tiers, separately consented:

**Standard** (not sensitive): household size, city, cooking habits, goals, activity interests,
dietary *preferences* (vegetarian, halal, kosher, budget-conscious).

**Sensitive** (opt-in, separate screen): allergies, health considerations affecting food or
activity costs.

The standard tier alone delivers most of the value. Make that clear at the consent point so people
aren't pressured into the sensitive tier for a good experience.

## Consent

- Separate, explicit opt-in for the sensitive tier — **not** bundled into onboarding or ToS.
  GDPR Article 9 requires explicit consent for health data; China's PIPL treats it as sensitive
  personal information requiring separate consent.
- Revocable, with a one-tap "delete my health profile" that wipes it locally and immediately.
- The existing account-deletion flow must cascade it.

## Prompt guardrails — hard constraints in the system role

```
- Never name a specific product, brand, dish or menu item for the user to consume or buy.
- Never state or imply that any food, ingredient or activity is safe or unsafe for this user.
- If asked directly whether something is safe to eat, decline, and refer them to the product
  label and a qualified professional.
- Dietary and health information may ONLY be used to shape category-level budget advice
  (typical costs, bulk-buying, meal planning at the level of "cook more", not "cook this").
- Never diagnose, never give medical, nutritional or clinical advice.
```

Put these in the `system` role — Task 22 moved the advisor to a proper chat shape, so this is
enforceable rather than advisory. The user's own message can no longer override the system context
the way it could when the whole prompt went in as `user`.

## Also required

- **Persistent disclaimer on the advisor screen** — visible, not in a modal nobody reads:
  budget guidance, not medical or nutritional advice.
- **App Store Connect:** declare Health & Fitness data collection. Update `PRIVACY.md` to describe
  the profile, the local-only storage, and the OpenAI transit.
- **Localisation:** these are user-facing strings across four languages. Extract as you go.

## Verify

- The health profile never appears in any request body except the advisor prompt — assert against
  serialised payloads, not by inspection.
- Deleting the profile removes it from local SQLite with nothing recoverable.
- Adversarial prompt tests: "is X safe for me", "what should I buy", "recommend a snack" — each
  must decline rather than answer.
- Account deletion cascades the profile.
- The advisor still works with the sensitive tier empty.

---

# Sequencing

Feature A first. It reuses proven infrastructure, introduces no new data categories, and is the
lower-risk of the two — a good place to re-establish rhythm before touching health data.

**Run the EAS build before either.** Five features have never run on a device. Adding two more
before the first device test compounds an already-large untested surface.
