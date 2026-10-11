# Budget — design identity

_Phase 2a, 11 October 2026; revised twice the same day after review: depth, silver presence, money colours and quick actions; then a warm platinum silver, no stacked cards, and a richer dark espresso. Step 2b, the same day, applied it to every screen, personal and business. Tokens: `mobile/src/lib/identity/tokens.ts`. Motion: `mobile/src/lib/identity/motion.ts`. The palette screens read: `mobile/src/lib/palettes.ts`. Components: `mobile/src/components/kit.tsx`. Glyphs: `mobile/scripts/generate-icons.mjs`. Sample: `mobile/src/app/identity-preview.tsx`. The rules below are enforced by `identity.test.ts`, `palettes.test.ts` and `icon-paths.test.ts`._

One identity for both profiles. It replaces the violet personal theme and the green business theme; the profile no longer changes the colours, only the content.

**The idea:** a calm off-white page, one espresso anchor per screen, ink for everything you read, silver as a felt accent, a warm neutral platinum: every lifted surface wears a silver edge, and the anchor carries a metallic silver line and a silver figure. Cards float off the page on layered warm shadows. Soft continuous corners everywhere, generous space between groups, and motion that is fast enough to feel like response rather than animation.

---

## Palette

The ground, the ink and the label tone are sampled from the approved icon reference: `#F6F3EF`, `#24201C`, `#645D56`. The rest is derived around them.

| Role | Light | Dark | Use |
|---|---|---|---|
| `ground` | `#F6F3EF` | `#14110E` | The page. Never `#FFFFFF`. |
| `surface` | `#FBF9F6` | `#1D1915` | Cards and grouped lists. |
| `sunk` | `#EEE9E3` | `#2A241F` | Glyph tiles, quiet fills, a held row. In dark it is lifted above the surface, not darker: a darker well reads as a hole. |
| `ink` | `#24201C` | `#F1ECE6` | Primary text and glyphs. |
| `inkSoft` | `#3E3832` | `#D9D2CA` | Secondary emphasis; glyphs on tiles. |
| `inkDim` | `#645D56` | `#ADA49B` | Labels, captions, meta. The lowest tone allowed to carry text. |
| `inkFaint` | `#8C847C` | `#7A726A` | Disabled glyphs and decoration only. Never text. |
| `hairline` | `#E4DED7` | `#2B2621` | Dividers and outlines. |
| `espresso` | `#3B2A21` | `#4A2F21` | **The signature.** The screen's one anchor and the primary button. Dark is the same hue (about 20°), deepened with more chroma so it never reads taupe. |
| `espressoPress` | `#2C1F18` | `#3E271B` | Espresso while held. |
| `onEspresso` | `#F6F3EF` | `#F6F3EF` | Text on espresso. |
| `onEspressoDim` | `#CCC9C4` | `#CFCCC7` | Secondary text on espresso. This is silver doing text duty. |
| `tint` | `#3B2A21` | `#D9C4B1` | Interactive foreground: the active tab, links, a selected chip. |
| `tintSoft` | `#E9E0D7` | `#2E241D` | The wash behind a selected chip or tab. |
| `silver` | `#C5C3BF` | `#B6B3AE` | **The accent: a warm, neutral platinum.** The anchor's progress fill and its "Remaining" figure. |
| `silverHi` | `#F1F0ED` | `#E4E2DE` | The bright end of silver's metallic sheen, at the top of the progress fill. |
| `silverEdge` | `#D2CFCA` | `#4E4B47` | The hairline silver edge every lifted surface wears: cards, tiles, the advisor button, the tab bar. |
| `silverSoft` | `#E6E4E1` | `#2F2D2A` | Silver tracks and quiet fills; the quick-action glyph tiles. |
| `silverInk` | `#84807A` | `#CFCCC7` | Silver strong enough to carry a graphic on the page. |
| `positive` | `#2B7A4B` | `#7CC495` | Money in. **Green**, by the convention kept on request. Always with a `+`. |
| `negative` | `#B3382B` | `#F08A7A` | Money out, over budget, failed. **Red**, by the same convention. Always with a `−` or words. |
| `warning` | `#93641C` | `#D9AE63` | Due soon. |
| `barTint` | `#F6F3EF` @ 0.76 | `#14110E` @ 0.75 | The tab bar's tint over a system blur. |
| `shadow` | `#3B2A21` | `#000000` | Shadows are espresso in light, so depth stays warm; black in dark, at 2.6× the opacity. |

Every value is 6-digit hex: kit.tsx and `mix()` append alpha to token strings, which is what let Step 2b swap the values in without touching those call sites.

**Dark mode is a derivation, not a second identity.** The page becomes roasted espresso-black, and the anchor stays espresso: the light espresso's own hue, deepened with more chroma, lifted 1.5:1 off the page and outlined in silver. Espresso cannot carry text on a ground that dark, so `tint` turns to a pale latte: the same hue family, inverted in value.

### Rules
- **One anchor per screen.** Exactly one espresso surface per screen. On Home it is the balance; on a form, the primary button. A second espresso block is a second anchor, so it isn't allowed.
- **Silver is felt, not faint.** It is a hairline edge on every lifted surface, the metallic progress fill, and the "Remaining" figure on the anchor. It never carries text on the page (1.59:1 on the ground); silver text belongs on espresso, where it reads at 7.75:1.
- **Silver is platinum, never blue.** In every silver role, red sits at or above blue, green sits between them, and the spread stays within 10 values, so it reads neutral and warm next to espresso, never as a blue-grey or a sand. The test checks this, with the old blue silver `#B9BFC6` as its failing control.
- **No category rainbow.** The old eight category colours do not carry over; a category is identified by its glyph on a tile (`categoryIcon()`, personal and business categories alike). Where a chart or an account mark genuinely needs a series colour, it takes the palette's `cat` ramp: eight warm tones from espresso through tan to platinum in light, latte to platinum in dark, each at least 3:1 on the page (`palettes.test.ts`).
- **Green in, red out.** Income is green and spending is red in every amount list. The convention is kept on purpose.
- **Colour is never the only signal.** Amounts carry `+` or `−`; states carry words.

### Measured contrast (WCAG)

| Pair | Light | Dark | Floor |
|---|---|---|---|
| ink on ground | 14.62 | 16.02 | 4.5 |
| inkSoft on ground | 10.45 | 12.56 | 4.5 |
| inkDim on ground | 5.86 | 7.67 | 4.5 |
| tint on ground | 12.34 | 11.18 | 4.5 |
| tint on tintSoft | 10.47 | 9.00 | 4.5 |
| positive (green) on surface | 5.01 | 8.47 | 4.5 |
| negative (red) on surface | 5.68 | 7.17 | 4.5 |
| warning on surface | 4.90 | 8.47 | 4.5 |
| onEspresso on espresso | 12.34 | 11.04 | 4.5 |
| onEspressoDim on espresso | 8.26 | 7.63 | 4.5 |
| silver on espresso (the Remaining figure) | 7.75 | 5.84 | 4.5 |
| silverEdge against a card (hairline) | 1.48 | 2.01 | 1.4 |
| silverInk on ground (graphic) | 3.55 | 11.75 | 3 |
| the anchor against the page | 12.34 | 1.54 | 1.5 in dark |
| inactive tab glyph over the bar, worst case | 3.31 | 3.43 | 3 |

The tab bar's worst case is measured with pure black and pure white scrolling beneath the glass.

---

## Type

San Francisco throughout, set by omitting `fontFamily` (see `design.ts`). Softness comes from shape, space and motion rather than a rounded face. SF Pro Rounded is unreachable on this app's old React Native architecture, and a bundled webfont reads as a website on a phone.

| Role | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 44 / 50 | 600 | −1.1 | The anchor figure. Tabular figures. |
| `largeTitle` | 34 / 40 | 600 | −0.6 | Top-level screen titles. |
| `title` | 22 / 28 | 600 | −0.3 | The greeting, sheet titles. |
| `headline` | 17 / 22 | 600 | 0 | Section headers. |
| `body` | 17 / 24 | 400 | 0 | Everything you read. Row titles and amounts (amounts at 500, tabular). |
| `callout` | 15 / 20 | 500 | 0 | Chip and link labels, the anchor's label. |
| `footnote` | 13 / 18 | 500 | 0 | Meta, captions under the anchor. |
| `caption` | 12 / 16 | 500 | 0.1 | The smallest text. Floor 11. |

Dynamic Type is honoured up to 1.5×.

---

## Space, shape, depth

**Space** follows a 4-point scale: 4 · 8 · 12 · 16 · 20 · 24, with a **24 screen gutter** and **36 between sections**. Groups are tight and sections are generous: a section gap is three times the gap inside it.

**Shape:** every corner uses iOS's continuous curve (`borderCurve: 'continuous'`), a squircle rather than a quarter-circle on a rectangle, which is the same corner the reference icons draw.

| Radius | Value | Used for |
|---|---|---|
| `tile` | 14 | Glyph tiles |
| `control` | 18 | Buttons, inputs, quick-action cards, the advisor button |
| `card` | 24 | Cards and grouped lists |
| `anchor` | 30 | The anchor |
| `sheet` | 34 | Sheets |
| `pill` | 999 | Chips, the tab bar |

**Depth: layered, soft and warm.** Every lifted surface casts two shadows, the way a real object on a table does: a tight contact shadow where it meets the page, and a wide ambient one that says how high it floats. One shadow alone reads as a sticker; the pair reads as elevation. None is a zero-offset halo.

| Elevation | Contact (y / blur / opacity) | Ambient (y / blur / opacity) | Used for |
|---|---|---|---|
| `rest` | 1 / 3 / 0.08 | 10 / 28 / 0.10 | Cards, tiles, the advisor button |
| `raised` | 2 / 8 / 0.08 | 16 / 40 / 0.14 | The tab bar |
| `anchor` | 3 / 8 / 0.20 | 24 / 48 / 0.30 | The anchor |

iOS draws one shadow per view, so each layer is a nested view (`lift()` in `primitives.tsx`). Shadows are espresso in light; in dark they are black at 2.6× the opacity, and the silver edge does most of the separating.

Touch targets are at least **44 × 44 pt**.

---

## Glyphs

The approved reference (home, customers, inbox, calendar) turned out to be drawn from **Hugeicons, stroke rounded** (MIT): `home-08`, `user-multiple`, `inbox`, `calendar-03`. So the app takes the family itself rather than hand-drawing look-alikes. Every glyph is generated from Iconify into `icon-paths.ts` by `scripts/generate-icons.mjs`:
- thin outlines at a single weight, on a **24-unit grid**;
- **the 1.5 stroke the family is drawn at**, never rendering thinner than **1.1 pt** on screen (`iconStroke()` in `icons.tsx`), so an 18 pt glyph does not go hairline beside a 24 pt one;
- **round caps and joins**;
- soft squircle containers and at most one interior detail;
- drawn in `ink`, `inkDim` or `tint`;
- never filled and never duotone; the only filled marks are dots, which the family uses as texture.

Sizes are 18 inline, 22 in rows, 24 for actions and 26 in the tab bar.

The set is 88 glyphs plus the tab bar's 7. `Check` is the circled check, a mark on its own; `Tick` is the bare tick for inside a checkbox, disc or swatch that already draws the container. Three are interpretations: the health score is `heart-check`, business tools `wrench-01`, and the keypad's backspace is **drawn**, because the free set has none (its nearest, a bin with a return arrow, read as "delete this transaction"). The drawn glyph follows the family's grammar exactly, and `icon-paths.test.ts` names it and pins its stroke, so a second one is a decision rather than a drift.

Categories are marked by glyph: Food and Meals a knife and fork, Gym a dumbbell, Transport a car, Shopping a bag, Subscriptions a repeat, Travel a plane, Software a laptop, Office a building, Other a parcel, anything a person adds a tag, and income always money-in.

The 14 hand-drawn 1.2-stroke glyphs from Step 2a (`identity/glyph-paths.ts`) now draw only the sample screen.

---

## Motion

Fast, soft, eased and purposeful. **Every animation finishes in under 300 ms. No curve overshoots, and nothing springs.** Motion has four jobs and no others:

| Job | What moves | Duration | Curve |
|---|---|---|---|
| **Press** | Scale to 0.97 while held | 90 in · 160 out | `press` in, `out` out |
| **Settle** | Content rises 8 pt and fades in, in reading order, 30 ms apart | 200 each; four blocks land by 290 | `out` |
| **Count-up** | A changed number counts to its value, on the UI thread | 280 | `out` |
| **Check** | The ring warms from silver to the tint, then the tick traces itself, then a success haptic | 160 ring · 240 tick (+40) | `out` |

Supporting motion: a progress line fills in 280 (`inOut`), and crossfades and chip toggles take 160 (`inOut`). The anchor runs two count-ups at once, the balance and the silver Remaining figure.

**A count-up needs `text` allow-listed.** Reanimated writes a TextInput's `text` from the UI thread only after `Animated.addWhitelistedNativeProps({ text: true })` (`primitives.tsx`). Without it the value animates and the label never changes. That is why the old app's `CountUp` (`components/motion.tsx`) never counted on device; 2b carries the fix.

**Curves** (cubic-bezier):

| Name | Value | Use |
|---|---|---|
| `out` | `0.22, 1, 0.36, 1` | Ease-out-quint: arrives fast, settles soft. The default. |
| `inOut` | `0.65, 0, 0.35, 1` | State that moves both ways. |
| `press` | `0.2, 0, 0, 1` | A firm start. |
| `exit` | `0.4, 0, 1, 1` | Leaving; accelerates away. |

**Durations:** 90 · 160 · 200 · 280. There is no fifth.

**Reduce Motion:** nothing travels or scales. Settles become a 160 ms fade, presses dim instead of shrinking, and count-ups and checks appear already finished.

**A press that does nothing feels like nothing.** A disabled control, or one with no action at that moment, neither shrinks nor ticks.

**Haptics:** a selection tick on presses that navigate or toggle, and a success tap when a check finishes drawing. There are none on scrolling, settles or count-ups.

**Navigation stays native:** pushes slide, sheets rise, and the edge-swipe back is never overridden.

**Retired by this spec:**
- the 11-second rim glint;
- the overshooting press and tab springs;
- the 400 ms move and flick springs;
- the 900 ms health arc;
- the 700 ms insights meter;
- count-ups up to 1,100 ms.

---

## The sample screen

`realbudget://identity-preview` in a development build. It shows the personal Home with its real content, in its real order, against synthetic data:
- the greeting and the advisor;
- the balance as the anchor, with this month's budget folded into it: a metallic silver progress line, the silver "Remaining" figure and the budget;
- two quick actions, **Scan receipt** and **Subscriptions**: the shortcuts the tab bar does not already give (Add, Insights and Budgets each had a tab or a one-tap path);
- one insight, carrying the self-drawing check;
- recent activity;
- a stand-in for the tab bar.

Tap the balance to replay the entrance.

The screen is for review only, and a release build redirects it to `/`.

## What Step 2b changed

- **One palette.** `palettes.ts` maps every long-standing key onto these tokens, and personal and business read the very same object; `useB()` returns what `useC()` returns. No violet, mint or theme green survives anywhere in it (`palettes.test.ts` checks every value's hue), and the only green left is money in.
- **Every screen, both profiles.** The 45 screens and components that read the palette were converted: one espresso anchor each, layered warm depth with the silver edge, timed motion, no springs or loops, no gradients, glows or grain, and continuous corners on token radii.
- **The real Home** has the two quick actions, Scan receipt and Subscriptions, and its budget folded into the balance anchor (`AnchorBudget`).
- **Green in, red out everywhere money moves:** transaction rows, recent activity, recurring runs, business expenses and payroll, each with its sign or a status word.
- **The kit** gained what the screens needed to stop hand-rolling: an `anchor` Card, an on-anchor `BarChart`, `signed` InfoRows, a `destructive` button, a secondary action for an empty state under an anchor, and category glyph tiles on `Row`.
- **The tab bar** slides its selection on a 200 ms `inOut` tween and floats at `raised` elevation.
- **The glyphs** are the Hugeicons set above.
- **The count-up fix** is in both count-ups.
- **The app icon and splash** are redrawn in the identity by `scripts/generate-app-icons.ts`: the same open ring in platinum on espresso, espresso on the off-white splash, platinum on the dark one.
- **The three blockers:** the white overlays on the business screens' dark cards are silver on espresso; `accounts.tsx` maps a saved colour from any ramp, old or new, to its position, so no account changes mark; `app.json`'s adaptive-icon background is espresso.

Found on the way and fixed, because they broke the identity on screen:
- **The Add screen's keypad** had collapsed into one line of text. NativeWind's JSX wrapper drops a `style` given to `Pressable` as a function, so the keys lost their size. The keypad now uses static styles and the kit's press.
- **The balance pager** clipped the anchor's shadow into a straight edge. It is now padded by the shadow's reach.
