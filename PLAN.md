# Real Budget → v1 — Revised Plan

_18 August 2026 · companion to `AUDIT.md` · reflects your four scope decisions_

**Decisions locked:**

1. **Import is the rail, sync is a bonus.** Statement import is the universal path; aggregators sit behind a provider interface.
2. **New distinctive name**, with a mark designed around it. Bundle ID changes now while it's still free.
3. **Free tracking, Pro = AI + bank sync.** Variable costs sit behind the paywall.
4. **Four languages: English, French, Arabic, Chinese** — Arabic means RTL.

---

## 1. Why "import is the rail" is the right call — the numbers

I checked Plaid's current coverage rather than assuming. **Plaid's Transactions product supports exactly 20 countries**: the US, Canada, and 18 in Europe (Austria, Belgium, Denmark, Estonia, Finland, France, Germany, Ireland, Italy, Latvia, Lithuania, Netherlands, Norway, Poland, Portugal, Spain, Sweden, UK).

Against your three named markets:

| Market | Plaid | Reality |
|---|---|---|
| **France** | ✅ Supported | Bank sync works today |
| **Morocco** | ❌ Not supported | Outside PSD2. ~14 of 41 tracked Moroccan banks are reachable via *some* aggregator (Salt Edge, TrueLayer, Yapily); no bank publishes a public developer portal. Coverage is voluntary and partial. |
| **China** | ❌ Not supported | Alipay and WeChat Pay are not reachable by **any** open-banking aggregator, anywhere. Bill export is the only path — which you have already built. |

Broader aggregators exist — Salt Edge covers 73 countries, TrueLayer 64 — but none is global, all cost more per connection, and each needs its own commercial approval with weeks of lead time.

**So the conclusion isn't a compromise, it's the actual answer:** statement import is the only mechanism that works in 100% of countries, and it's the one you've already invested in. It should be the product's spine, not its fallback. Bank sync becomes a per-country accelerant you can light up market by market without touching the core.

The good news architecturally: your backend is already close. `plaid.ts` is a thin REST wrapper and `plaid-mappers.ts` is already an isolated, tested translation layer. Extracting a `BankProvider` interface is maybe a day's work, and it means adding Salt Edge later is an additive change, not a rewrite.

**The corollary you should feel:** every import bug in `AUDIT.md §4.3` is now a **tier-1 blocker**, not a nice-to-have. European decimals parsing as `1.234` instead of `1234.56`, and `01/09/2026` importing as 9 January instead of 1 September, sit directly on the critical path of your primary acquisition mechanism in your primary markets.

---

## 2. Name shortlist

You'll pick; here's my thinking. Criteria: brandable and searchable, ≤2 syllables, no ugly meaning or pronunciation trap in en/fr/ar/zh, and an icon that works at 60px.

| Name | Story | Mark |
|---|---|---|
| **Cowry** ⭐ | Cowrie shells were the first genuinely *global* currency — used across Africa, South Asia, the Indian Ocean and the Pacific for centuries. For an app whose whole thesis is "works everywhere", the story writes itself. Short, soft, easy to say in all four languages. | A single stylised shell. Distinctive at any size, warm, not another generic wallet/coin/chart glyph. |
| **Mizan** | ميزان — "balance" / "scales" in Arabic, also current in Persian, Urdu and Malay. The concept maps exactly onto what the app does: balance, discipline, weighing. Reads as distinctive rather than foreign in Western markets. | Minimalist scales, or two stacked bars finding equilibrium. |
| **Kesh** | Phonetically "cash" in essentially every market; كاش is everyday Moroccan darija. Four letters, impossible to misspell, very brandable. | A single bold letterform, or a folded-note glyph. |
| **Runway** | Matches your actual hero metric — the app already computes "survival days", which *is* runway. Strong concept fit. | ⚠️ Heavily associated with Runway ML now; I'd rank it last for that reason alone. |

My pick is **Cowry** — the global-currency story is genuinely aligned with the decision you just made, and it gives the designer something to draw that isn't a coin.

Before we commit I'll check App Store name collisions, `.app`/`.com` availability, and the trademark landscape. **Nothing else in the plan is blocked on this** — only Phase 4 (branding) needs the answer.

---

## 3. What the scope decisions add to `AUDIT.md`

Beyond the existing findings, these four choices create new required work:

**Server-side entitlement verification (new, and non-optional).** Monetizing means the client can no longer be trusted to decide who's Pro. Client-only gating is bypassed in minutes, and your Pro features are exactly the ones that cost you real money per call. Required: a RevenueCat webhook → backend stores entitlement state → `ai.ts` and `plaid.ts` check it in their existing auth guards. This slots naturally into middleware that's already there.

**The AI usage caps become a pricing lever.** Today `allowUsageTiered` caps every user at 200 AI calls/day regardless. With a Pro tier that becomes free = small allowance (or zero), Pro = the real cap. One-line change, but it needs deciding.

**Import must get materially better, not just correct.** As the primary rail it needs: the §4.3 fixes, PDF statement parsing (vision model — you already have the OpenAI proxy and receipt-scan plumbing), per-bank format profiles, and a much better failure mode than a thrown error when columns don't match.

**Multi-currency becomes first-class.** `formatCurrency` hardcodes `'en-US'` — with four locales that's a visible bug on every screen. Plus live exchange rates (§4.4), per-account currency, and correct grouping/placement per locale.

**i18n across 26 screens, with RTL.** This is the single largest line item in the plan. Honest assessment below.

**Business mode has a security hole that must close before launch.** `AUDIT.md` C6 — an owner can add any user id to their business with no consent, and `findFirst` membership resolution then silently pulls that victim into the attacker's business. Cutting business mode would have deferred this; shipping it makes it a launch blocker.

---

## 4. The revised plan

Sizing assumes I'm doing the work and you're reviewing. Phases 0–2 are unchanged from the audit and remain the foundation — nothing else is worth building on a sync layer that loses data.

### Phase 0 — Stop the bleeding · ~half a day

1. Merge `feature/complete-core-features` → `main` and push. Production is 4 commits stale.
2. Bill-reminder push loop (C1) — one migration, one condition.
3. **Cloud sync, all three parts together** (§4.1): preserve server ids on pull, drop the balance side-effect on sync-inserts, wire up `pushLocalDataToCloud`. Fix the `primaryGoal` enum mismatch (§4.7) in the same commit or push sync 400s on day one.
4. Sign-up rate limit (S3) and Plaid webhook verification (S1).

### Phase 1 — Correctness · ~3 days

5. **Import parser** — European decimals, DD/MM dates, expense/income sign (§4.3). Now tier-1.
6. Timezone unification across `health-score.ts` (§4.4) — one date helper, string comparison throughout.
7. Projection maths — day-1 extrapolation guard, elapsed days instead of a fixed 30.
8. `recurring-processor` month overflow (C3) — reuse the existing correct `advanceMonth`.
9. Plaid: attach `accountId`, handle `removed`/`modified`, bound the sync loop (C4, C5).
10. Live exchange rates with cached fallback.

### Phase 2 — Hardening · ~2 days

11. `app.onError` / `app.notFound` / typed error shape (R1).
12. Zod on the five unvalidated routes; array caps and body limits (R2, S8).
13. Timeouts on every outbound fetch (R3); `/health` actually checks the DB (R4).
14. S2, S5, S6, S7, S9, C8.
15. **Business membership model** (C6, C7) — explicit current-business selection, invitation-based joins, no more `findFirst`.

### Phase 3 — Global rail · ~4 days

16. Extract a `BankProvider` interface; move Plaid behind it. Drive `country_codes` from the user's locale instead of hardcoded `["US"]`.
17. Import v2 — PDF statements via the vision model, per-bank format profiles, graceful column-mismatch recovery with a manual column mapper.
18. Multi-currency properly — locale-aware formatting, per-account currency, live rates.
19. Consolidate the four subscription detectors into one engine with pluggable sources. This is the precondition for the AI work in Phase 5.

### Phase 4 — Brand & monetization · ~3 days + your design decisions

20. Name decision → bundle ID, `app.json`, scheme, `trustedOrigins`, README all aligned.
21. **Icon, splash, App Store screenshots.** The hard blocker — no `assets/` directory exists at all today.
22. RevenueCat end to end: products in App Store Connect + Play Console, paywall UI, feature gating, restore purchases (Apple requires it), and **server-side entitlement verification via webhook**.
23. Rework the AI usage caps into free vs Pro allowances.

### Phase 5 — Localization · ~5 days, and the riskiest item

24. i18n scaffolding, string extraction across 26 screens, English + French + Chinese.
25. **Arabic + RTL.** Every `flex-row`, every absolute position, every icon direction, every chart axis, across 26 screens. `I18nManager.forceRTL` needs an app restart to take effect, which interacts badly with your startup sequence.

> **My honest read:** RTL is not hard, it's *broad* — it touches every screen you've built, and it lands at the point where everything else is finally stable. If you want to de-risk the launch date, ship v1 with English/French/Chinese and the scaffolding in place, then Arabic as v1.1 two weeks later. Same total work, much smaller thing to get wrong at once. Your call — I'll build it either way, and the scaffolding is identical.

### Phase 6 — Ship · ~2 days + external lead time

26. In-app account deletion (`DELETE /api/me`, full cascade) — Apple requires it, no exceptions.
27. Host the privacy policy, fill in the support email, reconcile it with what `InboxEmail` actually stores (§5.5).
28. Rewrite the README to describe the real architecture (§3 of the audit).
29. Verify the Railway volume is attached (D1). Delete `sample.ts`, `example-state.ts`, `seedDemoData`, `SUPPORTED_BANKS`, the dead sync settings, the stale `backend/CLAUDE.md`.
30. App Store Connect metadata and privacy declarations.

**🔑 Start now, in parallel with everything:** the **Plaid production application**. It takes days to weeks and gates nothing else, so it should be running in the background from today.

### Phase 7 — The improvements

Once the above is real:

- **Advisor as a proper chat agent** — system role, streaming, tool-calls answered from local SQLite, rolling summary instead of unbounded history (fixes R6 and makes it feel instant).
- **An advisor that can act.** "Set my Food budget to 400" should *do it*.
- **Learned categorisation.** The current `CATEGORY_KEYWORDS` list is US-brand-centric — useless against a Moroccan or Chinese statement, which is precisely the market this plan now targets. A rules engine ("anything from Carrefour → Food") handles ~80% cheaper and more predictably than a model; the model handles the tail and learns from corrections.
- **Weekly proactive digest push** — "12% over pace on Food, Spotify renews Thursday." The data is already computed and nothing surfaces it unprompted.
- **Empty / loading / error states as real components.** Today a new user meets a wall of zeroes and a "C" grade.
- **Charts.** `victory-native` and Skia are already dependencies and the dashboard uses neither.
- **Home-screen widget / Live Activity** for today's remaining budget — the highest-retention feature a budgeting app can ship.
- Replace the `Alert.alert` calls across 8 screens with toasts (`burnt` is already installed).

---

## 5. Realistic shape

Phases 0–2 are ~5–6 working days and turn the app from "loses data" into "correct". Phases 3–6 are ~14 days and turn it into "shippable worldwide, monetized, in four languages". That's roughly **four weeks of focused work** before submission, plus Plaid's external approval clock.

The sequencing matters more than the estimate. Phase 0 item 3 in particular is the hinge: fixing the missing push without fixing the id handling would convert a silent data-loss bug into active corruption on every existing user's account. It has to land as one change.

---

## 6. What I need from you

- **The name** — pick from §2 or propose your own. Blocks Phase 4 only.
- **Free-tier AI allowance** — zero AI calls for free users, or a small taste (say 5/day) to drive conversion? I'd suggest a taste.
- **Arabic in v1 or v1.1** — see the note in Phase 5.

Nothing above blocks Phase 0. Say go and I'll start there.
