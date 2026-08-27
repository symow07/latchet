# Budget — Claude Design brief

Paste everything below the line into Claude Design, and attach the reference
screenshot (the purple Parex / Trips fintech mockup) in the same message.

---

## 0. What you're designing

**Budget** is a cross-platform personal + business finance app (React Native /
Expo, iOS first, worldwide audience). It tracks spending, detects subscriptions
from bank imports and forwarded billing emails, scans receipts, and runs an AI
advisor. It has **two distinct product surfaces behind one account**:

- **Personal profile** — an individual tracking their own money. Playful,
  confident, a little indulgent.
- **Business profile** — a small business owner with a team: expense approvals,
  payroll, tool/subscription spend, tax settings. Same skeleton, calmer and more
  structured, but never grey and corporate.

The two surfaces share **one layout system, one type scale, one component set,
and one motion language**. They differ **only in hue**. A user switching profiles
should feel the app change temperature, not change apps.

Deliver a **design canvas of artboards** (see §7 for the full list), then a
foundations sheet so the tokens can be lifted straight into code.

---

## 1. Art direction — read the attached reference first

The attached screenshot is the target mood. Extract these specific qualities;
do not copy its content (it's a card/travel app, we're a budget app).

**What to take:**

1. **Near-black canvas with a coloured bloom.** Background is not flat. A large,
   soft radial glow of the brand hue sits behind the hero area and falls off to
   near-black at the edges. A faint 1px grid (3–4% opacity) and a fine film
   grain (3%) sit over everything. This texture is what makes it feel premium
   rather than templated.
2. **One saturated hero card doing all the shouting.** A single big rounded
   rectangle in full brand colour, ~28px radius, carrying the primary number.
   Everything else on the screen is dark glass. The contrast between one loud
   card and many quiet ones is the whole composition.
3. **Organic shapes inside the hero card.** Two or three large translucent
   circles (white at 8–12%) bleeding off the card's edges, partially clipped.
   They add depth without adding elements.
4. **Huge numbers with dimmed decimals.** `$6 045.00` — the cents stay the same
   size but drop to ~45% opacity. Thousands are separated by a thin space, not a
   comma. Tabular figures, tight negative tracking.
5. **The peeking next card.** To the right of the hero, a dashed-outline
   placeholder with vertical text and a `+`, clipped by the screen edge. It
   tells you the hero is a carousel without a dot indicator.
6. **Segmented progress bars.** Progress is drawn as ~7 discrete rounded
   segments, not one continuous track. The filled segments are white/bright; the
   trailing unfilled ones take a *contrasting cool accent* (cyan in the
   reference) rather than a grey. Steal this exactly — it's the signature.
7. **Section headers with count badges.** `Recent activity ②` — a small filled
   amber pill with a number, sitting inline after a 22px bold header.
8. **Rows built from a squircle icon chip + two-line text block + right-aligned
   value.** Icon chip ~48px, 16px radius, translucent fill tinted by the row's
   category colour.
9. **Inline label/value chip strips.** `Terminal C1 · Seat Number A10 · Gate B`
   — dim label immediately followed by bright value, separated by tiny dot
   markers. Extremely dense and still readable. Reuse this for transaction
   metadata, bill schedules, and tax fields.
10. **Underlined tab navigation** with a count badge on one tab, and **pill
    status chips** with a small leading icon on a brand fill.

**What to leave behind:** the travel content, the boarding-pass QR block as-is
(reinterpret it as a receipt/share tile), and the perspective phone mockups —
design flat artboards.

**Tone:** vibey, high-saturation, generous radii, soft glows, breathing room.
Not neon, not glassmorphism-for-its-own-sake, not brutalist. Every screen should
survive a squint test: one hero, then a calm list.

---

## 2. Colour system

Two palettes, **identical key names**, so a component reads `accent` without
knowing which profile is active. Four sets total: personal dark, personal light,
business dark, business light.

### 2.1 Personal — violet (dark)

```
bg            #0B0611   canvas
bgDeep        #070410   below the fold / gradient foot
bgRaise       #17102A   raised surface, modal, sheet
p950          #1E0A3C
p900          #331066
p800          #4C1D95
p700          #7018D8
p600          #8B2FF0
p500          #A855F7   PRIMARY
p400          #C084FC
p300          #D8B4FE
p200          #EDE0FF
heroGradient  135deg  #9333EA → #A855F7 → #B968FF
cool          #7DD3FC   trailing progress segments, links
positive      #34D399   income, approved, under budget
warning       #FBBF24   count badges, due-soon
negative      #FB7185   overspend, rejected
text          #F7F2FF
textDim       #B9A6DB
textFaint     #7C6C9E
glass         rgba(255,255,255,0.055)
glassStrong   rgba(255,255,255,0.09)
glassBorder   rgba(216,180,254,0.16)
glowScale     1.0
```

Hero card text is **white**. `$6 045.00` at 100% white, `.00` at 45%.

Contrast caveat, verified: white on `#A855F7` is only **3.96:1** — fine for the
56px balance, short of AA for the 13px labels. So on the violet hero, angle the
gradient so small text ("Card balance", "Cashback", the meter %) sits over the
deeper stops `#9333EA` (5.38:1) or `#8B2FF0` (5.58:1), never over `#B968FF`.

### 2.2 Personal — violet (light)

```
bg            #FFFFFF
bgDeep        #F3EEFA
bgRaise       #FAF7FD
p500          #7E22CE   PRIMARY (shifted darker to hold contrast on white)
p600          #6B21A8
p700          #581C87
p400          #9333EA
p300          #A855F7
p200          #C084FC
heroGradient  135deg  #6D28D9 → #8B5CF6 → #A855F7   (still white text)
cool          #0369A1
positive      #047857
warning       #B45309
negative      #E11D48
text          #170F22
textDim       #574768
textFaint     #8A7BA1
glass         rgba(88,28,135,0.045)
glassStrong   rgba(88,28,135,0.08)
glassBorder   rgba(88,28,135,0.12)
glowScale     0.25   ← coloured haze reads as grime on white; nearly kill glows
```

The light theme keeps the hero card fully saturated. Everything else becomes
white-on-white with hairline lavender borders. The grain drops to 1.5%; the grid
disappears.

### 2.3 Business — bright mint / spring green (dark)

The business surface is the **same design, tuned green**. Fresh and vibey, not
"accounting software green."

```
bg            #06110C   canvas — a green-tinted near-black, NOT the violet one
bgDeep        #040B08
bgRaise       #0D1F17
g950          #032716
g900          #06421E
g800          #0C5F2C
g700          #12813C
g600          #16A34A
g500          #22C55E   PRIMARY
g400          #4ADE80
g300          #86EFAC
g200          #DCFCE7
heroGradient  135deg  #16A34A → #22C55E → #4ADE80
cool          #2DD4BF   trailing progress segments (teal is green's cyan)
accentPop     #A3E635   sparingly — one lime highlight per screen, max
positive      #4ADE80
warning       #FBBF24
negative      #FB7185
text          #F0FFF6
textDim       #9CC7AF
textFaint     #6A8B79
glass         rgba(255,255,255,0.05)
glassStrong   rgba(255,255,255,0.085)
glassBorder   rgba(167,243,208,0.16)
glowScale     1.0
```

**One deliberate structural divergence:** on the bright mint hero card, text and
icons are **ink-dark `#04240F`, not white.** White on `#22C55E` is 2.28:1 and
fails outright; ink on `#22C55E` is **7.29:1** and on `#4ADE80` is **9.53:1** —
comfortable at every size, and it gives the business profile its own signature
at a glance. Keep the same shape, radius, circles, and layout as the personal
hero — only the fill and the ink flip. Everywhere *off* the hero card, mint is
used as an accent on dark surfaces, where it's brilliant and legible.

If ink-on-mint ever feels too soft for a particular hero, the fallback is a
deeper gradient `#065F35 → #10894A` with white text and `#4ADE80` accents —
but try ink-on-mint first, it's the more distinctive answer.

### 2.4 Business — bright mint (light)

```
bg            #FFFFFF
bgDeep        #EEF6F1
bgRaise       #F7FCF9
g500          #15803D   PRIMARY
g600          #166534
g400          #16A34A
g300          #22C55E
heroGradient  135deg  #16A34A → #22C55E → #4ADE80   (ink #04240F text, unchanged)
cool          #0F766E
positive      #047857
warning       #B45309
negative      #DC2626
text          #07130C
textDim       #47604F
textFaint     #7B9285
glass         rgba(6,66,30,0.04)
glassStrong   rgba(6,66,30,0.07)
glassBorder   rgba(6,66,30,0.12)
glowScale     0.25
```

### 2.5 Category colours (shared by both profiles)

Transactions and budgets need a categorical set that reads on both violet and
mint canvases. Use one 8-colour ramp, tuned for dark backgrounds, applied at 13%
opacity for chip fills and full strength for icons and chart marks:

`#A78BFA` `#38BDF8` `#2DD4BF` `#4ADE80` `#FACC15` `#FB923C` `#F87171` `#F472B6`

Never let a category colour compete with the active profile's primary — the
primary is reserved for actions and the hero.

---

## 3. Typography

**Plus Jakarta Sans** throughout (400 / 500 / 600 / 700). Geometric-humanist,
matches the reference's warmth, and is already loaded in the app.

```
Balance display   56 / 60   Bold      -2.0% tracking   tabular
Screen title      32 / 38   Bold      -1.5%
Section header    22 / 28   Bold      -1.0%
Card title        17 / 22   SemiBold  -0.5%
Body              15 / 21   Medium     0
Meta / secondary  13 / 18   Medium     0     textDim
Caption           11 / 15   SemiBold  +6%    uppercase, used sparingly
Amount (row)      16 / 20   SemiBold  -0.5%  tabular
```

**Number rules — enforce these everywhere:**

- Tabular figures always. Amounts in a column must align.
- Thin space as thousands separator: `6 045.00`, not `6,045.00`. (Also dodges
  the comma/period locale problem.)
- Decimals at 45% opacity of the surrounding text colour, same size.
- Currency symbol at 70% size, raised, tight to the first digit.
- Negative amounts get a leading `−` (true minus) and `negative`; income gets
  `+` and `positive`. Never rely on colour alone.

---

## 4. Layout, shape, motion

```
Artboard          393 × 852  (iPhone 16 Pro logical px)
Scrolling boards  393 × up to 1500, marked "scroll"
Screen padding    20px horizontal
Safe area         top 59, bottom 34
Section gap       28px
Card padding      18–20px
Grid              4px base; 8px rhythm

Radii   chip 16 · card 24 · hero 28 · sheet 32 · pill 999
Border  1px hairline in glassBorder on every glass surface

Shadow (dark)   colour = primary, y+8, blur 24, opacity 0.35
Shadow (light)  same × glowScale 0.25 → effectively a soft neutral drop
```

**Tab bar:** floating, inset 16px from the sides and 20px from the bottom,
blurred dark fill, pill highlight behind the active icon (primary @ 15%), and a
**centre FAB** — 58px, gradient in the profile's hero gradient, 22px radius,
lifted −22px above the bar with a 4px ring in the canvas colour so it punches
through. Five slots.

- Personal tabs: Dashboard · Transactions · **Add (FAB)** · Advisor · Settings
- Business tabs: Overview · Expenses · **Add (FAB)** · Team · Insights
  (Payroll and Settings live one level down.)

**Motion notes** (annotate, don't animate): hero number counts up on load;
segmented meters fill left-to-right, 40ms stagger per segment; rows enter with a
12px rise + fade, 30ms stagger; sheets spring in (damping 18, stiffness 220);
haptic tick on approve/reject and on logging a transaction.

---

## 5. Component set — design these once on the foundations sheet

Show each in **both profile colours**, dark and light.

1. **Hero balance card** + clipped dashed "Add account" placeholder to its right.
2. **Segmented progress meter** (7 segments) — under-budget, at-limit, over.
3. **Avatar rail** — 56px circles, leading `+` circle, 13px name labels below.
4. **Section header + count badge** (amber pill).
5. **List row** — 48px squircle category chip, title + meta line, right-aligned
   amount and time. Plus a swiped state revealing delete.
6. **Underlined tab bar** with a badge on one tab.
7. **Status pill** with leading icon (pending / approved / rejected / due soon).
8. **Timeline row with dotted connector** — the reference's `NYC ⋯✈ 4h 45m⋯ LDN`
   pattern, reinterpreted for recurring transactions and bill cycles:
   `Last charge ⋯ 💳 monthly ⋯ Next charge`.
9. **Inline label/value chip strip** with dot separators.
10. **Bar chart** (14-day spend) and **donut** (category split), using the
    category ramp, dark-first.
11. **Score ring** — 0–100 arc with a gradient stroke, big centre number,
    trend chip beneath.
12. **Bottom sheet** — 32px top radius, 40×4 grabber, blurred backdrop.
13. **Amount entry** — oversized display number + custom keypad.
14. **Empty state** — soft glowing icon bubble, 17px title, 15px dim body,
    single primary pill button.
15. **Toggle, segmented control, text field, dropdown** — all pill or 16px.
16. **Approve / Reject action pair** (business) — filled positive, outlined
    negative.
17. **Member row** with role pill and avatar.
18. **Pro lock chip** — small padlock + "Pro" on a gradient fill, for gated
    features (AI advisor, receipt scan, email detection, bank sync).
19. **Toast / inline alert** — success, warning, error.
20. **Profile switcher** — the moment the app changes from violet to mint.
    Design this explicitly: a sheet with two large cards, Personal (violet hero
    thumbnail) and Business (mint hero thumbnail), current one checked.

---

## 6. Hard constraints — the design has to be buildable and shippable

- **React Native / Expo.** Gradients are linear or radial only (no conic, no CSS
  filters, no `backdrop-filter` beyond a blur view). Blur is available but
  costly — use it on the tab bar and sheet backdrops, not on every card. Prefer
  a solid tinted fill over a blur where the difference is invisible.
- **No text over busy imagery.** Receipts are the only photography in the app.
- **RTL.** The app ships English, French, Arabic, Chinese. Arabic is
  right-to-left: nothing may depend on left-alignment to make sense, chevrons
  and progress direction must be mirrorable, and no text may be baked into an
  icon. Design at least one artboard mirrored in Arabic to prove the layout
  holds.
- **Text expansion.** French runs ~30% longer than English. Every label, button,
  and chip needs slack or a defined truncation. Show the long-label state on at
  least the dashboard and settings artboards.
- **Touch targets** ≥ 44×44pt, including the small chips and the tab icons.
- **Contrast.** Body text ≥ 4.5:1, large text and UI ≥ 3:1, in all four themes.
  This is what forces ink-on-mint for the business hero.
- **Currency-agnostic.** Amounts may be `$`, `€`, `£`, `¥`, `MAD`, `د.م.` — the
  hero must survive a 3-character currency code and 7 significant digits.
- **Real content, never lorem.** Use plausible merchants (Spotify, Carrefour,
  Uber, AWS, Figma, Notion, Adobe), plausible amounts, real dates in 2026.
  Include at least one empty state and one error state per major flow.

---

## 7. Artboards to produce

Lay these out on the canvas in labelled rows. Everything dark unless the row
says light.

**Row A — Foundations (large boards, not phone-sized)**
1. Colour system — all four palettes as swatch grids with hex + token name.
2. Typography scale + number treatment specimens.
3. Component library sheet (§5), violet and mint side by side.

**Row B — Entry & onboarding (personal violet)**
4. Login — email + password, "Welcome back", social/biometric affordance.
5. Sign up.
6. **Account type picker** — the fork in the road: two large cards, Personal
   (violet) and Business (mint). This is where both palettes appear together.
7. Onboarding 1 — currency picker (popular + all, searchable).
8. Onboarding 2 — monthly income + savings goal.
9. Onboarding 3 — primary goal (Track / Save / Stick to budget / Pay off debt).
10. Onboarding 4 — spending style (Frugal / Moderate / Generous) + Get started.

**Row C — Personal core**
11. **Dashboard** — the flagship. Hero balance card + "Add account" peek;
    segmented budget meter with % used; this-week / this-month / today toggle;
    14-day spend bar chart; health score ring card; streak + badges row;
    "My accounts" avatar-style rail; "Recent activity ③" list. Mark as scroll.
12. Transactions — search, category filter chips, date range, impulse-only
    toggle, grouped-by-day list, one swiped-to-delete row.
13. Add transaction — big amount display, keypad, category grid, account picker,
    date, note, "impulse buy" toggle, and the **time-cost line** ("that's 3h 20m
    of work") which is a signature feature — give it real presence.
14. AI advisor — chat surface, suggested prompt chips ("Am I overspending?",
    "How can I save more?"), quick-insight cards, voice input state, and the Pro
    limit-reached state.
15. Settings — grouped list: monthly budget, hourly rate, currency, language,
    accounts, import, export (CSV/JSON), biometrics, Pro, delete account.

**Row D — Personal depth**
16. Analytics — three tabs (Overview / Insights / Alerts): top waste, duplicate
    charges, weekend spike, seasonal trend, potential savings.
17. Health score — big ring, five breakdown bars (savings rate, discipline,
    consistency, impulse, goal progress), trend chip, "Get advice" CTA.
18. Subscriptions — confirmed / possible / cancelled tabs, confidence meters,
    monthly total hero, rescan action.
19. Subscription detail — merchant, cycle timeline row, price history, cancel
    steps.
20. Net worth — assets vs liabilities hero, snapshot history chart, category
    breakdown, new-snapshot sheet.
21. Accounts — cards for checking / savings / credit / cash / investment, each
    with its own colour, total net worth header.
22. Import statement — file picker, AI column-mapping review, date-order and
    sign detection, duplicates-skipped result. Empty and error states.
23. Receipt scan — four steps on one board: pick, analysing, review extracted
    fields, saved.
24. Bill reminders — monthly total, due-today / overdue / upcoming grouping,
    paid checkboxes.
25. Recurring — active income vs expenses, frequency pills, next-run timeline.
26. Category budgets — per-category limits with segmented meters, over-budget
    state.
27. Email inbox — the forwarding address, setup instructions, detected list.
28. Link bank — provider list, trust/security messaging, connected state.

**Row E — Business (mint green)**
29. **Business overview** — mint hero (total approved expenses, ink text);
    pending review / approved / rejected stat trio; quick actions; detected
    tools with monthly cost; recent expenses. Mark as scroll. This board is the
    direct green counterpart to #11 — same skeleton, same rhythm.
30. Expenses — pending queue with approve/reject pairs, receipt thumbnails,
    submitted / approved / rejected filter, total.
31. New expense — amount, category, description, receipt camera/gallery.
32. Team — member list with roles (can submit / can approve), invite code with
    share sheet, join-a-business state.
33. Insights — monthly spend vs budget, by-category breakdown, category budget
    editor, over-budget-by state.
34. Payroll — employees, monthly salary, due / paid pills, month total,
    add-to-payroll sheet.
35. Business tools — detected SaaS spend, annual cost, next charge, "how to
    cancel" steps.
36. Business settings — fiscal year, tax ID, VAT rate, owner-only lock state.

**Row F — Light mode**
37. Personal dashboard, light.
38. Business overview, light.
39. Transactions, light.
40. Add transaction, light.

**Row G — Localisation proof**
41. Personal dashboard in Arabic, fully mirrored RTL.
42. Personal dashboard in French, showing long-label behaviour.

---

## 8. How to work

- Start with **#11 (personal dashboard)** and **#29 (business overview)**. Get
  those two right and everything else follows. Show them to me before building
  out the rest of the canvas.
- Design **dark first**; light is a derivation, not a redesign.
- Keep every value on the foundations sheet as a **named token**, so the palette
  can be dropped into the codebase as two objects with identical keys.
- Where a screen has an empty, loading, and error state, show at least the empty
  one — this app has a lot of "you haven't linked anything yet" moments and they
  are where most designs fall apart.
- Annotate anything non-obvious directly on the canvas: gradient angles, blur
  radii, stagger timings, which token drives which surface.
