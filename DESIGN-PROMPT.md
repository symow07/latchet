# Budget — Claude Design brief

This started as a prompt for Claude Design against three references — the Milo
onboarding/assistant/spend set and the Evoo report + Wise-connect pair. It is now
a record of what was built, which is not the same thing.

**Read §1.0 first.** Partway through the build the direction changed: a second
set of references (a dark AI app with magenta mesh gradients and film grain, and
a floating dark pill tab bar) replaced the first, on the instruction "keep
light-first, make it richer" and "skin and layout both". Several clauses below
are therefore *overruled by the build*, and each is marked where it appears
rather than deleted — the original reasoning is worth keeping next to the reason
it lost.

---

## 0. What you're designing

**Budget** is a cross-platform personal + business finance app (React Native /
Expo, iOS first, worldwide audience). It tracks spending, detects subscriptions
from statement imports and forwarded billing emails, scans receipts, and runs an
AI advisor. It has **two profiles behind one account**:

- **Personal** — an individual tracking their own money.
- **Business** — a small business owner with a team: expense approvals, payroll,
  tool spend, tax settings.

The two share **one layout system, one type scale, one component set, and one
neutral ground.** They differ only in a quiet accent hue. Switching profiles
should feel like changing rooms in the same house, not changing apps.

**The single most important instruction in this brief:** this is a *calm* app.
Minimal, bubbly, Apple-like. One job per screen. Whenever you are unsure whether
something belongs on a screen, it doesn't — move it one tap away.

---

## 1. Art direction

### 1.0 The direction change — read before the rest of §1

The first three references produced an app that was correct and cheap-looking.
The tokens were right, the contrast was verified, the layouts were disciplined —
and it read like a wireframe someone had coloured in. The diagnosis, in order of
how much each mattered:

1. **Colour was parked in one object.** One dark card per screen and "colour is
   almost absent" everywhere else meant the ground did no work at all.
2. **Flat interpolated gradients.** A two-stop CSS gradient on a phone screen
   reads as a computer drawing, not as light. Grain is what makes it a surface.
3. **No lit edges.** §12's `rgba(255,255,255,0.06)` top edge was specified for
   dark mode and never implemented anywhere.
4. **Cards 3% off the ground with no border.** White on bone at that distance
   needs an edge or the card does not exist.
5. **A webfont.** Plus Jakarta Sans next to the native controls on the same
   screen reads as a website rendered on a phone.

So: **light-first still holds** — the ground is still bone, dark is still a
derivation. What changed is that richness is now allowed to live *on* the ground
rather than only inside one object. Where a clause below says otherwise, §1.0
wins.

The rest of §1 remains the discipline. The pivot was about depth and colour, not
about density — nothing in it licenses a busier screen.

**The ground is warm and near-white.** Not grey, not stark. A bone/eggshell
canvas with cards in pure white floating on it, separated by soft shadow rather
than borders. Colour is almost absent. Where the Milo screens have one dark navy
card and one lilac icon chip on an entire screen, that is the correct ratio.

**What to take:**

1. **One dark object per screen, maximum.** Milo's spend screen has exactly one:
   the navy card. Evoo's consent screen has exactly one: the black button. That
   object is where the eye lands. Everything else is white, bone, or grey.
2. **Big friendly headlines, sentence case, in plain language.** `Hi, I'm Milo
   👋`, `Take control of your money`, `Evoo uses Wise to connect your bank
   transaction`. 30–36px, bold, near-black, sitting directly on the ground with
   no card around them. Never a shouty uppercase label where a sentence works.
3. **Prose over data.** Milo's assistant screen is three short paragraphs of
   ordinary English and three tappable chips — that is the entire screen. Copy
   is a first-class design element here, not filler. Write real sentences.
4. **Generous, uneven whitespace.** The Milo assistant screen is ~55% empty and
   is better for it. Do not distribute elements evenly to fill the height; let
   content sit at the top and leave the bottom open.
5. **Soft shadow, and a hairline everywhere.** Cards: pure white, 20–24px
   radius. ~~Use a hairline border only where two white surfaces touch.~~
   **Overruled (§1.0.4):** every card, circle action and quick action carries
   `borderWidth: hairlineWidth` in `hairline`. White sits 3% off bone; at that
   distance a shadow alone does not describe an edge, and the card reads as a
   lighter patch of ground rather than an object on it. Shadows also roughly
   doubled from the values first specified here — `near` 0 2 8 at 0.09, `far`
   0 12 24 at 0.08 — for the same reason.
6. **Circular and squircle chrome.** Header actions are 40px white circles with a
   thin-stroke icon. ~~Quick actions are 48px white circles with a 12px label
   underneath.~~ **Overruled — see §6.8:** 56px, an accent wash, a sheen and a
   lit rim. Feature-row icons are 44px squircles (14px radius) in a pale
   tinted fill. ~~Thin strokes (1.5–1.75px), never filled glyphs.~~
   **Overruled — see §3.1.** Filled glyphs everywhere; the hairline stroke set
   is the single thing that made the chrome read as cold and technical.
7. **Pill everything.** Segmented toggles, filter chips, suggested replies,
   primary buttons — all fully rounded. Active state is a solid dark pill with a
   soft shadow; inactive is plain text on the ground with no chrome at all.
8. **Big numbers with dimmed decimals.** `$24.00` with `.00` at ~55% opacity and
   the currency symbol smaller and raised. `$4,230.00` centred inside a thin
   donut with `From $5,500` beneath it in grey. Numbers are the only place where
   scale gets dramatic.
9. **Cards that peek.** The next card in a carousel is clipped by the screen
   edge, with small dot indicators beneath. Never a full-width scroll hint.
10. **Gradient, grain, and a lit edge.** ~~A single gradient moment… on the dark
    card, never on the light ground.~~ **Overruled (§1.0.1–3).** As built:
    - The **hero is the gradient** — the balance card is a three-stop ramp
      (`heroGradient`), not a flat `inkSoft` fill with an arc on it.
    - It carries **grain** at 0.09 and a **lit top edge**,
      `rgba(255,255,255,0.22)`, plus a diagonal sheen. Without the grain the
      ramp bands; without the edge the card has no top.
    - The **ground carries two mesh blooms** — full-bleed, `mesh` colours at
      `MESH_ALPHA` `[0.20, 0.15]`, with grain over the whole screen at 0.035.
      This is the clause that most directly reverses the original: colour is now
      *on the bone*, softly, everywhere.

    What survives intact is the *no text on gradient* rule and §2.3.1: bright
    mint and pale violet are still light-on-dark colours. The mesh is under
    everything and reads nothing; the hero sets text in `onHero`.

    The alphas are load-bearing. `MESH_ALPHA` is capped where it is because
    `inkDim` body text has to stay ≥4.5:1 over the *bloom centres*, not just
    over bare ground — which is why `inkDim` moved to `#474D62` (7.70:1) rather
    than staying at the original `#5C6479`. Raising the mesh means re-verifying
    that, and there is a test that will say so.
11. **A tab bar of clear glass, with a capsule for the selection.**
    ~~Flat, no floating pill, no background chrome, no protruding FAB.~~ The
    original clause is half right again, by a longer route than anyone intended.
    Five bars were built; each failure had its own cause, and they are worth
    keeping apart:

    - **Flat full-width** — a strip of the page rather than an object on it.
    - **Ink pill** — right geometry, wrong everything else: a neutral fill
      cannot look rich, hairline glyphs read as scratches on it, and it floated
      a full safe-area inset off the bottom, which is *above* the home indicator
      and so visibly too high.
    - **Gradient pill** — right colour, right weight, and **inert**. Correct in
      a screenshot and dead in the hand, because a tab bar is a thing you touch
      and nothing in it answered being touched.
    - **Liquid meniscus** — the surface rose into a socket around a bead riding
      above it. It was alive, and it was a great deal of machinery: a module of
      tangent-circle geometry, a masked blur because the shape had a moving bump
      no corner radius could describe, and a path rebuilt on the UI thread every
      frame. It also protruded further than wanted.
    - **Clear glass with a capsule** — where it landed.

    **Sized against the platforms, not by eye.** iOS gives a tab bar 49pt of
    content on the 34pt home-indicator region — 83pt of footprint; Material 3
    gives its navigation bar 80dp. A floating pill is not directly comparable to
    either, because it is inset on all four sides and so reads smaller than a
    flush bar of the same height. At 60 the *footprint* was already in range —
    60 plus an 18pt lift is 78 — while the visible chrome sat under both
    standards, which is what made it look undersized. The bar is 72, putting the
    pill itself between iOS's content height and Material's full bar, for a 90pt
    footprint and a 106pt reserve on every scrolling screen.

    The capsule is sized from the bar and then **clamped by its own slot**: past
    a point the bar's height stops being the binding constraint and the slot's
    width starts. Without that clamp a taller bar grows a capsule taller than it
    is wide — a vertical lozenge around a square icon, which reads as a mistake.

    As built: a blur of the page behind it, lightly tinted, clipped to a pill by
    a corner radius — nothing protrudes, nothing moves but the capsule, and the
    icons stay put. The capsule needs one animated transform, so the mask, the
    glow and all of the meniscus geometry are gone with it.

    **It is a blur under a tint, not UIKit's Liquid Glass — and that was
    tried.** `expo-glass-effect` links and then fails to compile: every
    published version's `GlassContainer.swift` overrides
    `mountChildComponentView`, which on SDK 53 exists on the *New Architecture*
    view classes only, and this app runs with the New Architecture off. No
    version escapes it, because the podspec builds every Swift file in the
    package whether or not the container is used. Reaching the real material
    means enabling the New Architecture or moving to SDK 54+ — neither of which
    is a tab-bar change.

    Worth recording that the first failure was a red herring: the pod was being
    dropped silently because its podspec asks for iOS 16.4 and the project's
    deployment target was the Podfile's 15.1 default, and Expo's autolinking
    skips any pod whose platform the target does not satisfy. `pod install`
    reports success while leaving it out, and the build then succeeds with zero
    errors and throws `Cannot find native module` at runtime.

    The consolation is that this path's legibility is **measured**, which a
    system material's would not have been.

    **Clarity and measured contrast pull against each other, and the tint's
    alpha is where that is settled.** Glass takes its contrast from whatever
    happens to scroll under it, which is unverifiable, so the alpha bounds how
    far the backdrop can drag the bar: the foreground is measured against the
    tint composited over **pure black and pure white**, not a convenient
    backdrop. 0.62 is as clear as this can go — at 0.55 the dark scheme's icons
    fall to 3.77:1 against white content.

    What bought that clarity was **dropping the dimmed inactive state**. Dimming
    was what forced the glass opaque, since a mid-grey needs far more backing
    than the foreground does; the capsule marks the selection instead, so every
    icon sits at full contrast. The references do the same — their inactive
    items are not dimmed either.

    **The capsule is `accentSoft`, and opaque enough to measure against.** The
    glyph on it is the profile's accent, and an accent on glass is unmeasurable
    — what backs it is whatever is scrolling past. On a fixed wash the pair is
    fixed. Mint on light is why `onBarActive` exists rather than just reusing
    `accent`: there, accent measures 4.31:1 on its own soft wash, and
    `accentPress` is used instead.

    This is also the one place a profile's colour appears on the bar. The bar
    itself is neutral and shared; only the selection is branded.

    **Two things that are easy to get wrong here, both learned the hard way.**
    The interior is pinned to one writing direction and the tab order reversed
    by hand: React Native mirrors a flex row on its own *and* swaps `left` for
    `right` on absolutely positioned children, while the capsule's x and its
    `translateX` are plain arithmetic that nothing mirrors. In Arabic the
    selection sat at the far left over the last tab while the active tab's own
    slot went unmarked. One explicit reversal beats three implicit ones that
    disagree.

    And a floating bar is chrome over scrolling content, so **every tab screen
    owes it clearance** — `BAR.clearance`, never a literal. Ten screens had
    `120` hardcoded, sized for a bar two revisions taller.

12. **Trust screens explain themselves in three rows.** The Wise consent screen
    is the model for every permission moment we have (bank linking, email
    forwarding, camera, notifications): two overlapping brand circles, one
    headline naming both parties, three icon+title+body rows, one black
    full-width pill, legal text beneath.

**What to leave behind:** ~~No glows, no grain, no grid texture, no saturated
hero cards.~~ **Partly overruled (§1.0).** Grain and a saturated hero card are
now the direction, not the thing to avoid. What is still banned, and the reason
each still holds:

- **No near-black canvas in light mode.** Light is the app.
- **No glow as a substitute for contrast.** Anything whose shape must be read
  still meets its ratio; see §2.3.1, which the pivot did not touch.
- **No grid texture, no neon.** The grain is 128×128 gaussian noise at ≤0.09 —
  a paper tooth, not a pattern.

If a decision traces back to "make it pop," reverse it. If it traces back to
"give it a surface," it stays.

**Tone words:** calm, warm, roomy, confident, plain-spoken, slightly bubbly.
**Anti-tone:** dashboard, cockpit, analytics suite, dense, technical, neon.

---

## 2. Colour system

Light is the app. Dark is a faithful derivation, designed after light is signed
off — same layouts, same spacing, ground swapped for near-black.

**One exception, deliberate:** `barGradient` / `onBar` / `onBarDim` are identical
in both schemes. A navigation bar that repaints itself when the OS flips reads as
two different apps; the bar is the fixed thing you carry between them. There is a
test that fails if a future change makes it invert, so the decision has to be
re-argued rather than drifted into.

### 2.1 Shared neutrals — the substrate for both profiles

```
ground        #F7F5F1   warm bone canvas
groundAlt     #FFFFFF   cards, sheets, input fields
groundSunk    #EFECE6   input wells, inactive chip fill, chart tracks
ink           #12172B   headlines, amounts, active pills, primary buttons
inkSoft       #1B2036   the "one dark object" card fill
inkDim        #474D62   all secondary body text  (7.70:1 on ground)
inkFaint      #8A90A2   decorative and disabled ONLY, never body text (2.93:1)
hairline      rgba(18,23,43,0.07)
shadowNear    0 2px 12px rgba(18,23,43,0.05)
shadowFar     0 8px 28px rgba(18,23,43,0.04)
positive      #0F6B32   income, approved, under budget   (6.08:1)
negative      #B42318   spend, rejected, over budget     (6.04:1)
warning       #B45309
```

Verified contrast on `#F7F5F1`: ink **16.3:1**, inkDim **7.70:1**. `inkFaint` is
2.93:1 and fails — it is a decoration token, and the brief will be considered
wrong if any sentence is set in it.

`inkDim` was `#5C6479` (5.43:1) and darkened when the mesh blooms landed on the
ground (§1.10). Body text now has to clear 4.5:1 over a *bloom centre*, not over
bare bone, and 5.43:1 did not survive that with margin. This is the coupling to
watch: **mesh alpha and `inkDim` move together.**

### 2.2 Personal — violet accent

```
accent        #6D28D9   6.52:1 on ground — active pill, links, primary CTA fill
accentPress   #5B21B6
accentSoft    #E9DEFF   icon chip fills, selected row wash, quick-action circles
accentMark    #7C3AED   5.23:1 — single-series chart marks, meter fills
accentGlow    #A78BFA   2.50:1 — DECORATIVE ONLY (see the rule below)
heroGradient  #1A0533 → #7C3AED → #E040C0   the balance card (§1.10)
mesh          #8B5CF6, #E879F9              the two ground blooms
onHero        #FFFFFF                       text on the hero
barGradient   #6D28D9 → #4C1D95             the tab bar (§1.11)
onBar         #FFFFFF   7.10:1 / 10.95:1 on the two stops
onBarDim      #E2D4F7   5.07:1 on the lighter stop — inactive tab
```

`gradient 135deg #7C3AED → #A78BFA → #C4B5FD` was the original single-moment
ramp; `heroGradient` replaced it. It runs from near-black violet into magenta so
the card has somewhere dark to hold text — a ramp between three mid-tones has no
anchor and reads as a swatch.

### 2.3 Business — mint green accent

```
accent        #15803D   4.61:1 on ground — active pill, links, primary CTA fill
accentPress   #0F6B32
accentSoft    #D6F5E3   icon chip fills, selected row wash, quick-action circles
accentMark    #15803D   4.61:1 — single-series chart marks, meter fills
accentGlow    #4ADE80   1.60:1 — DECORATIVE ONLY (see the rule below)
heroGradient  #04231A → #0A7D4B → #0D9C86   the balance card (§1.10)
mesh          #34D399, #2DD4BF              the two ground blooms
onHero        #FFFFFF                       text on the hero
barGradient   #0E6E34 → #053F23             the tab bar (§1.11)
onBar         #FFFFFF   6.37:1 / 12.06:1 on the two stops
onBarDim      #D4E5DA   4.86:1 on the lighter stop — inactive tab
```

**The bar is deeper than the accent, and has to be.** At `accent` #15803D the
dimmed inactive label needs 0.92 alpha to clear 4.5:1 — indistinguishable from
white, so the bar would have no readable inactive state at all. §2.3.1 again, in
a new place: the bar buys its dim headroom by going *darker*, never brighter.
The vivid #16A34A is worse still — white on it is **3.30:1** and fails outright.

The mint ramp's teal end is **3.74:1** against white, not 4.5:1 — measured, after
this brief's author claimed otherwise in a comment and a test caught it. Hence
the split rule in §7: hero stops 0 and 1 carry text and clear 4.5:1; stop 2 is
the empty corner and clears 3:1. Do not set a figure in the last third of a hero.

### 2.3.1 The accentGlow rule — read this before using either gradient

`accentGlow` and the gradient stops built from it are **1.6:1 (mint) and 2.5:1
(violet) against the bone ground.** They are invisible there. They may never
carry text, an icon, a chart mark, a meter fill, a border, or any element whose
shape has to be read.

They have exactly one job: **the single gradient moment, and it lives on the
dark `inkSoft` card**, where mint reads at 9.22:1 and violet at 5.91:1 — which is
precisely what the Milo reference does with its rainbow arc. Gradient on dark
card, never gradient on bone.

Anywhere a green element must be *read* on the light ground, it is `#15803D`.
Bright mint is a light-on-dark colour in this system, and that is the whole
reason the business profile can look fresh without becoming illegible.

### 2.4 Dark mode (derive later, do not design first)

All ratios below are measured against the dark ground `#0E1119`.

```
ground        #0E1119
groundAlt     #1A1F2C   cards — RAISED, lighter than ground
groundSunk    #080A10   wells — RECESSED, darker than ground
ink           #F5F3EF   17.03:1
inkDim        #9AA0B4    7.24:1   secondary body text
inkFaint      #626880    3.42:1   decorative and disabled only
hairline      rgba(255,255,255,0.08)
positive      #4ADE80   10.83:1
negative      #F98B80    8.12:1
warning       #FBBF24   11.30:1

personal accent  #A78BFA   6.93:1      business accent  #4ADE80  10.83:1
```

The light-mode semantics **cannot be reused here**: `#0F6B32` is 2.85:1 and
`#B42318` is 2.87:1 on this ground. Since every spend amount in the app is set
in `negative`, reusing them would make the most-read coloured text in the
product unreadable. Use the dark values above.

The "one dark object" inverts to one *light* object — a bone card on near-black.
Shadows are replaced by a 1px `rgba(255,255,255,0.06)` top edge; card separation
in dark mode comes from luminance step, not from shadow.

### 2.5 Category colours

Transactions need categorical marks. Two ramps — a mark must clear **3:1**
against its own ground, and the light ramp cannot simply be reused on dark.

**Light** (on `#F7F5F1`) — as built, chromatic at a consistent weight:
```
violet #5B3FD9   blue   #1E6FD9   teal   #0D8577   green #2E8B4E
amber  #A87400   orange #C25A18   red    #CC3B33   pink  #C0357A
```
The first ramp above these was so muted it read as eight greys — "must never
out-shout accent" had been obeyed to the point of erasure.

**Which category gets which slot is assigned by hand, not hashed.** FNV over six
known names put Shopping, Subscriptions and Other all on slot 5: half the rows in
a six-row list were the same orange while three of eight colours went unused. Six
names over eight buckets is a list, not a hashing problem. Hashing still applies
to custom categories and merchant names, where the input genuinely is unbounded.

The test that let this ship asserted `used.size >= 4` on the six built-ins. It now
asserts all six are distinct. **A test that permits the bug it was written to
catch is worse than no test**, because it reports green.

**Dark** (on `#0E1119`)
```
violet #A99BE8 7.67   blue   #7FB6E0 8.69   teal   #5FC4B4 9.02   green #7FC98D 9.56
amber  #D9B45C 9.55   orange #E0996A 8.03   red    #E58880 7.34   pink  #DB8FAF 7.69
```

These must not out-shout `accent`, but see the note above about what that
constraint did when followed literally. Merchant rows
prefer the **real merchant logo** in a 40px circle (Spotify, Netflix, Uber, AWS)
as both references do; the category colour is the fallback.

---

## 3. Typography

**The platform face** — SF Pro on iOS, Roboto on Android — at weights
400 / 500 / 600 / 700.

~~Plus Jakarta Sans, geometric-humanist, close to the references' warmth.~~
**Overruled (§1.0.5).** Plus Jakarta is a good face and it was the single
largest reason the app read as cheap. Every native control on screen — the
keyboard, the status bar, the share sheet, the system alerts — is set in San
Francisco, and a webfont next to them reads as a website rendered on a phone
rather than as an app. San Francisco is also *engineered* for this: optical
sizing, tighter tracking at display sizes, tabular figures that actually align.

In code this means `F` in `design.ts` carries `fontWeight` and no `fontFamily`,
which is also why there is no font to load and nothing to patch onto RNText.

The size scale below is unchanged — it was never the problem.

```
Balance display   40 / 44   Bold      -2.0%   tabular
Screen title      32 / 38   Bold      -1.5%
Headline (prose)  28 / 36   Bold      -1.0%   the "Hi, I'm…" voice
Section header    20 / 26   Bold      -0.5%
Card title        17 / 23   SemiBold  -0.3%
Body              16 / 24   Regular    0      generous leading — this is prose
Meta              13 / 18   Medium     0      inkDim
Tab label         11 / 14   Medium    +1%
```

Eight sizes, no more. Note there is **no uppercase caption style** — the
references have none, and adding one would make the app look like a dashboard.

### 3.1 Icons

**Solar Bold Duotone** (CC BY 4.0), committed to the repo as SVG path data
rather than pulled from an icon package.

Chosen after the client pointed at **Iconly**, which is commercial and not
redistributable. Solar is the closest freely-licensed set to it and shares the
register: rounded, soft, slightly playful. If Iconly is ever licensed, the
generator takes local SVGs as readily as remote ones — the map is the only thing
that changes.

Four sets were tried, and the reason each failed is the useful part:

- **Lucide** (1.75px hairline outlines) — precise, technical, an engineering
  drawing. The single largest reason the app read as cold, and no recolouring
  fixed it, because a hairline glyph cannot be friendly.
- **Ionicons filled** — a real improvement and still generic, with hairline
  plus/check/close that looked frail beside filled neighbours.
- **Mingcute Fill** — bold, round, legible. A good set; simply not the one.
- **Solar Bold Duotone** — where it landed.

**Duotone only works if the pipeline keeps each path's `opacity`.** The second
tone *is* one path at reduced opacity. Dropping it renders every layer at full
strength, collapsing the glyph into a solid silhouette — which is exactly what
happened the first time duotone was evaluated here and dismissed as looking no
different from flat. It was never duotone.

**The second tone is clamped to 0.7, not Solar's 0.5.** It is not decoration:
strip it from `user` and you have an unlabelled circle, so it owes the 3:1 a
meaningful shape owes. Solar's 0.5 is tuned for the size an icon set is *shown*
at; measured against the surfaces these actually sit on — the bar's capsule, the
tinted tiles, a white card — it lands between 2.2:1 and 2.5:1. 0.68 is the
tightest floor that clears 3:1 everywhere, rounded to 0.7. A test pins it, and
pins that the tone stays below 1 so the clamp can never quietly flatten them.

**Utility marks are `-linear`, not duotone.** A chevron, a tick, a plus, a close
is a mark rather than a picture — there is no second tone for it to have. As
duotone they render as solid filled triangles and blobs, which in a list row
reads as something being broken rather than as emphasis.

**Two parsing traps, both of which shipped before they were caught.** Paint
attributes are commonly set once on the wrapping `<g>` rather than on each
shape: Solar's outline variants put `fill="none" stroke="currentColor"` there and
leave the paths bare, so reading only each shape's own attributes turned every
outline icon into a filled silhouette and the plus — two zero-area lines — into
nothing at all. And Solar draws heads and bodies with `<circle>` and `<ellipse>`
rather than paths; those are converted to arcs at generation time so the
committed data stays a single shape type.

**How it is wired.** `scripts/generate-icons.mjs` fetches from Iconify and writes
`lib/icon-paths.ts`; `components/icons.tsx` draws it with `react-native-svg`,
which the app already had. No new dependency, no native rebuild, no font,
nothing fetched at runtime. The exported names are unchanged, so all 178 call
sites across 42 screens have now survived three complete changes of icon set —
that is the point of the layer.

Four things are pinned by tests: every icon has real path data, every icon
records the `source` it was generated from, every outline has a solid twin, and
nothing in the app imports an icon package directly.

`strokeWidth` is still accepted at every call site and ignored.

---

**Number rules:**
- Tabular figures always; amounts in a column must align.
- Decimals same size, 55% opacity. Currency symbol at 65% size, raised.
- Spend is `−$23.12` in `negative`; income is `+$1,200.00` in `positive`. Always
  a sign, never colour alone.
- One number per screen may be display-sized. Only one.

---

## 4. Layout, shape, motion

```
Artboard          393 × 852  (iPhone 16 Pro logical px)
Scrolling boards  393 × up to 1400, labelled "scroll"
Screen padding    20px horizontal
Safe area         top 59, bottom 34
Section gap       32px   ← deliberately larger than feels necessary
Group gap         18px   ← S.group: within a section, between related blocks
Card padding      20px
Grid              4px base, 8px rhythm

Radii   chip/pill 999 · icon squircle 14 · card 22 · big card 24 · sheet 28
Stroke  icons 1.75px, thin and rounded
Tab bar floating pill, height 70, inset S.screen − 4, bottom max(safe, 12)
```

**The spacing scale, and why screens have one now.**

```
8   tight     inside a block — a label and the thing it labels
16  group     between related blocks
24            related, but wanting more air
32  section   between subjects
```

With only a 32px section gap, everything on a screen was either 32 apart or
touching, so a quick-action row and the budget line beneath it looked as
unrelated as two different sections. Two spacings give a screen grammar: 32
separates subjects, 16 groups things that belong to one.

`group` is 16 rather than 18 so the whole scale sits on the 8pt grid §4 asks
for.

**The scale only helps if screens use it.** They did not: 214 vertical gaps
across 38 screens were hand-picked from 10, 12, 14, 16, 18, 20, 22, 24 and 28,
which is why the rhythm read as arbitrary — gaps doing the same job came out
three different sizes on one screen. They are snapped to the scale now; nothing
moved by more than 4pt, and values at or below 8 were left alone because those
are typographic nudges inside a component rather than spacing between blocks.

**Header hierarchy.** `Header` takes `role`, defaulting to `title`. Both home
screens pass `section` and get out of the way, because their top row holds a
*greeting*: at `title` that is 32px bold over two lines, making the largest thing
on screen the least useful information on it while the balance underneath
competes with it. Every finance app worth the comparison leads with the number.

**Density budget — hold yourself to this.** A screen gets at most:
one headline, one hero element, **three** content blocks, one primary action.
A list may be long; the furniture around it may not.

**One authored moment, not a motion system.** The count-up on the balance is it.
Everything else is press feedback and navigation. Two build notes worth keeping:
a shared value written raw and then animated in the same synchronous block races
and the raw write wins (the count sat at zero for a whole release), and a `text`
written through `animatedProps` is a native-side write this side cannot verify —
so the *declared* value is the answer, not the starting point, and a failed
animation shows the right number rather than a confident zero.

**Motion** (annotate, don't animate): numbers count up on first paint;
cards rise 8px and fade in with a 40ms stagger; the segmented pill slides
between positions (spring, damping 20, stiffness 250); sheets spring from the
bottom; one haptic tick on submit, approve, and reject. Nothing pulses, nothing
glows, nothing loops.

---

## 5. Information architecture — what got cut

The current app stacks balance, budget meter, a 14-day chart, health score,
streak, badges, accounts, and recent activity on one screen. **That screen is
being taken apart.** The redesign is as much editorial as visual.

**Personal home** now holds exactly four things:
1. A greeting line and the balance card (with the next account peeking).
2. One budget line — spent, remaining, a thin track. No segments, no percentage
   ring, one sentence: *"$840 left of $1,200 this month."*
3. **One insight**, written by the advisor in plain English, with up to two
   action chips. This is the Milo idea, borrowed at small scale: *"You've spent
   18% less this week than last. Want to set a savings goal?"*
4. Recent activity — five rows and a "See all".

**Everything else moves.** Health score, streaks, badges, the 14-day chart,
duplicate-charge alerts, weekend-spike detection and seasonal trends all live in
**Insights**, reachable from the tab bar. Accounts and net worth live under the
balance card's own detail screen. Nothing is deleted; everything is one tap
deeper than it was.

**Tabs — five, flat, no FAB.**

- Personal: `Home · Activity · Add · Insights · Settings`
- Business: `Home · Expenses · Add · Team · Settings`
  (Insights, Payroll, Tools and Tax hang off Home as cards.)

`Add` is centre and slightly emphasised — ink-filled circle icon, no protrusion,
no gradient.

---

## 6. Component set — design these once on the foundations sheet

Show each in both accents. Light first.

1. **Balance card** — inkSoft fill, 24px radius, brand badge, `Virtual`/account
   label, display number with dimmed cents, caption, one gradient arc bleeding
   off a corner. Plus the clipped peek of the next card and dot indicators.
2. **Budget line** — label, amount sentence, one 6px rounded track. Three
   states: comfortable, close, over.
3. **Insight card** — no icon, just prose on ground with 1–2 chips beneath.
4. **Suggested-reply chip** — white pill, hairline, shadowNear.
5. **Segmented toggle** — active ink pill with shadow, inactive plain text.
6. **Filter chip row** — groundSunk pills, active fills ink.
7. **Transaction row** — 40px merchant logo circle, title 17, date 13 inkDim,
   right-aligned signed amount. Plus a swiped delete state.
8. **Quick-action trio** — ~~48px white circles, thin icon, 12px label
   beneath.~~ **Overruled — as built: 56px accentSoft circles, a filled duotone
   glyph in `inkDim`, a white sheen, a lit rim with a glint that travels round
   it, and a 12px label beneath.** The size was written for hairline strokes on
   white; a filled glyph needs more room around it, and at 48 four of them read
   as small buttons rather than as the four places the screen sends you.
   `tileSheen` and `tileRim` are the same "light catching the material" move
   §12 asks for on the hero, on a circle instead of a rectangle, and they
   replace a neutral hairline that described a cut-out rather than an edge.

   **The glyph is neutral and the tile carries the colour.** It was the accent
   in both, which set a saturated mark on a saturated disc and left the two
   competing to be the coloured object. This is not a return to the white
   circles above: those had grey glyphs on **white**, which is what made the row
   the largest neutral block on the screen. The colour did not leave — it moved
   from the 26px mark to the 56px surface, which is more of it, not less.

   **It moves in two ways, and only one of them is idle.** Held, the tile takes
   `TILE_PRESS_ALPHA` of the accent and its light rolls off — deepening on
   light, brightening on dark, because the accent is a dark colour in one scheme
   and a light one in the other. At rest, a glint travels round the rim, ~11s a
   turn.

   That the idle motion is on the *rim* is a measurement, not a preference. The
   obvious version drifts and dims the highlight across the tile's face, and it
   cannot be seen: `tileSheen` is contrast-measured at full strength, so the
   face can only ever move between that and darker, and on a pale tint the whole
   budget is about five values of red. Built that way it measured 0.4/255
   between the ends of its cycle — the same failure `BREATH_MS` already records
   for the hero. The rim has no contrast budget to spend, because the glyph is
   nowhere near it.

   The glyphs are chosen by the *slot*, not by the icon set's usual rule. A
   quick-action tile is a picture slot — one glyph alone in a disc — so the
   plus that stays a hairline mark everywhere else becomes `add-square` here,
   and business's double tick becomes a clipboard. Left as marks they sat
   beside a camera and a pie chart looking like a different icon set, which is
   what the row actually looked wrong for.
9. **Feature/permission row** — 44px accentSoft squircle, title, two-line body.
10. **Trust screen** — the Wise pattern, for bank link, email forwarding,
    camera, and notifications.
11. **Primary button** — full-width ink pill, 56px tall, white 17px SemiBold.
    Secondary: white pill with hairline. Tertiary: plain accent text.
12. **Header** — 32px bold title left, one or two 40px white circle actions
    right. Sub-screens: back circle, centred 17px title, overflow circle.
13. **Thin donut** — 12px stroke, mostly groundSunk with `accentMark` arcs, big
    centred number and a grey "from" line beneath.
14. **Bar chart** — 14 rounded bars, accent, no gridlines, no axis labels beyond
    first and last.
15. **Score ring** — one arc, big number, one-line plain-English verdict.
16. **Amount entry** — display number, custom keypad, no visible field chrome.
17. **Empty state** — a 64px accentSoft squircle icon, 20px title, one grey
    sentence, one pill button. Warm, never apologetic.
18. **Approve / Reject pair** — filled positive pill, outlined negative pill.
19. **Member row** — avatar, name, role in inkDim.
20. **Pro chip** — small ink pill with a padlock, for gated features (advisor,
    receipt scan, email detection, bank sync).
21. **Bottom sheet** — 28px top radius, 40×4 grabber, dimmed backdrop.
22. **Profile switcher** — the one screen where both accents appear together:
    two large white cards, violet Personal and mint Business, current one
    checked.
23. **Toast** — white pill, shadowFar, icon + one line.
24. **Tab bar** — five flat items, both profiles.

---

## 7. Constraints — it has to be buildable and shippable

- **React Native / Expo.** Linear and radial gradients only. Blur is available
  but expensive — sheet backdrops only, never on cards. Shadows are the
  `shadowNear`/`shadowFar` pair; do not invent per-component shadows.
- **RTL.** Ships English, French, Arabic, Chinese. Arabic is right-to-left:
  nothing may depend on left-alignment, all chevrons and progress directions
  must mirror, no text baked into an icon. Prove it on one artboard.
- **Text expansion.** French runs ~30% longer. The prose-heavy style makes this
  sharper than usual — show the long-label state on home and settings.
- **Touch targets** ≥ 44×44pt, including chips and tab items.
- **Contrast.** Body ≥ 4.5:1, large text and UI ≥ 3:1, in light and dark. The
  tokens above are pre-verified; if you introduce a colour, verify it. Every
  ratio in this document is pinned by a test rather than by the comment next to
  it — the comments have been wrong twice, and both times the test was what
  noticed. Gradients are verified **per stop against the stop's job**: hero stops
  0 and 1 carry text and clear 4.5:1, stop 2 is the empty corner and clears 3:1.
  A blanket 4.5:1 across all three stops is what forced the ramps flat the first
  time.
- **Currency-agnostic.** `$` `€` `£` `¥` `MAD` `د.م.` — the balance card must
  survive a three-character code and seven significant digits. It did not:
  `−CN¥77,777,884.00` was clipped by the card's own `overflow: hidden`. The
  amount now scales down by `amountScale(glyphs, 11)`, floored at 0.55, so a long
  figure shrinks rather than losing its last digits. **A clipped number is a
  wrong number**, which makes this a correctness constraint, not a layout one.

  RTL bites the same component twice: an amount is a *row* of parts, so it needs
  `flexDirection: row-reverse` under RTL or it mirrors its own digits (`¥0.00`
  rendered `.000¥`). And mirroring an icon uses `rotate: '180deg'`, never
  `scaleX: -1` — the latter flips an SVG out of its own viewport and the back
  chevron simply vanished in Arabic.
- **Real content, never lorem.** Plausible merchants (Spotify, Carrefour, Uber,
  AWS, Figma, Notion), plausible amounts, real 2026 dates. Write the microcopy
  as if a person will read it, because the style depends on it.

---

## 8. Artboards

Lay these out in labelled rows. All light mode unless the row says otherwise.

**Row A — Foundations** (large boards, not phone-sized)
1. Colour tokens — neutrals, both accents, light and dark, with hex, token name
   and measured contrast ratio.
2. Type scale and number specimens.
3. Component library (§6), violet and mint side by side.

**Row B — Entry**
4. Welcome — full-bleed warm photograph, gradient scrim, `Take control of your
   money`, one white pill CTA, progress segments and a Log in pill on top.
5. Log in.
6. Sign up.
7. **Profile picker** — Personal vs Business, the one board with both accents.
8. Onboarding — currency.
9. Onboarding — income and savings goal.
10. Onboarding — primary goal (Track / Save / Stick to budget / Pay off debt).
11. Onboarding — spending style, and Get started.

**Row C — Personal core**
12. **Home** — the flagship, built to the four-item rule in §5. Show it twice:
    once populated, once first-run empty.
13. Balance / accounts detail — the card at full width, account list, net worth.
14. Activity — search, filter chips, day-grouped rows, one swiped row.
15. Add transaction — amount display, keypad, category, account, date, note,
    impulse toggle, and the **time-cost line** (*"that's 3h 20m of work"*) —
    one of the app's best ideas, so give it a whole quiet line of its own.
16. Ask (advisor) — the Milo screen, adapted: prose answer, suggested chips,
    pill input with a mic. Plus the Pro limit state.
17. Settings — grouped white cards on bone: budget, hourly rate, currency,
    language, accounts, import, export, biometrics, Pro, delete account.

**Row D — Personal depth** (everything cut from Home lives here)
18. Insights hub — the home of what used to crowd the dashboard: score, trends,
    alerts, as three calm entry cards.
19. Health score — ring, five breakdown lines, one plain-English verdict.
20. Spending report — thin donut, period switcher, category list.
21. Alerts — duplicate charges, weekend spike, unusual transaction. Plus the
    all-clear state, which should feel like a reward.
22. Subscriptions — monthly total, confirmed / possible / cancelled.
23. Subscription detail — merchant, cycle, price history, cancel steps.
24. Net worth — assets vs liabilities, snapshot history, add-snapshot sheet.
25. Import statement — file pick, AI column-mapping review, result. Error state.
26. Receipt scan — pick, analysing, review, saved (four states, one board).
27. Bill reminders — monthly total, due grouping, paid checkmarks.
28. Recurring — income and expenses, frequency, next run.
29. Category budgets — per-category lines, one over-budget.
30. **Connect a bank** — the Wise-style trust screen.
31. **Email forwarding** — the same trust pattern, plus the address and detected
    list.

**Row E — Business (mint)**
32. **Business home** — the direct counterpart to #12: greeting, approved-total
    card, one budget line, one insight, pending-approval count, recent expenses.
    Same skeleton, mint accent.
33. Expenses — pending queue with approve/reject, receipt thumbnails, filters.
34. New expense — amount, category, description, receipt capture.
35. Team — members with roles, invite code, join-a-business state.
36. Insights — spend vs budget, by category, budget editor.
37. Payroll — employees, salaries, due/paid, month total.
38. Tools — detected SaaS spend, next charge, how-to-cancel steps.
39. Business settings — fiscal year, tax ID, VAT, owner-only lock.

**Row F — Dark derivation** (only after light is signed off)
40. Personal home, dark.
41. Business home, dark.
42. Activity, dark.

**Row G — Localisation proof**
43. Personal home in Arabic, fully mirrored.
44. Personal home in French, long labels.

---

## 9. How to work

- Build **#12 (personal home)** and **#32 (business home)** first and show me
  those two alone before going further. Everything else follows their rhythm,
  and forty-four boards is a lot to redo.
- Design **light first**. Do not start dark mode until light is approved.
- Write the microcopy properly. In a design this quiet, the sentences *are* the
  interface — a placeholder string will make a good layout look empty.
- Every value on the foundations sheet must be a **named token**, so the two
  palettes drop into the codebase as objects with identical keys.
- Show the empty state wherever one exists. This app has many "you haven't
  connected anything yet" moments, and they are where minimal designs fail.
- If a screen ends up with more than three content blocks, stop and tell me what
  you would cut rather than designing it as-is.
