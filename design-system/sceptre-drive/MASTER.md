# Sceptre Drive — Design System

**Status:** locked 2026-10-24. Machine-readable source: `packages/brand/src/tokens.css`.
This document explains the *why*; the token file is the *what*. If they disagree, the token
file wins and this document is corrected.

**Consumers:** `admin/` (TanStack Start console) and `desktop/` (Electron POS).

---

## 1. Direction

Sceptre Drive sells car parts across a counter in Ghana. The product is used at two
distances: an owner reading a screen at a desk, and a cashier touching one at arm's length
with a customer waiting. The design has to be **quiet enough to read all day** and
**confident enough to trust with money**.

The visual idea is a workshop fascia over a clean bench:

- **Charcoal fascia.** The top bar is `#1B1F23` with light text in both admin and POS. It is
  the one dark band on the screen, and it anchors every page.
- **Paper bench.** Content sits on a warm off-white canvas, not pure white, so cards float
  without heavy shadows.
- **One hot colour.** `#F26A1B` appears once per screen: the active nav rail, the primary
  button, the live indicator. Everything else is ink, rule, and restraint.
- **Figures are furniture.** Money, quantities, and serial numbers are monospaced with
  tabular figures so columns align and a digit never jitters.

**Signature element: the Till Line.** Under the dashboard header, one full-bleed band shows
today's take in large tabular type on the left and a single continuous bar showing *how the
money arrived* — cash, MoMo, card, bank, credit, tax. It is the first thing the owner reads
and the only memorable element. Everything around it stays quiet: no gradients, no glass, no
decorative illustration.

**Explicitly rejected:** gradient hero bands, glassmorphism, animated counters on load,
purple/indigo "AI startup" accents, emoji as icons, and white text on orange.

---

## 2. Colour

| Token | Value | Where |
|---|---|---|
| `--ink` | `#1B1F23` | body text, headings, icon strokes |
| `--brand` | `#F26A1B` | primary button fill, active rail, one chart series |
| `--brand-fg` | `#1B1F23` | **text on** brand — never white |
| `--brand-ink` | `#C25515` | brand **as** text on light surfaces |
| `--brand-tint` | `#FDEADD` | active nav background, subtle emphasis |
| `--canvas` | `#F6F6F4` | app background |
| `--surface` | `#FFFFFF` | cards, popovers, sidebar |
| `--line` | `#E4E3DF` | 1 px borders and dividers |
| `--muted-ink` | `#5C6470` | secondary text |
| `--topbar` | `#1B1F23` | fascia |
| `--topbar-foreground` | `#F6F6F4` | fascia text |
| `--topbar-muted` | `#A8B0B9` | fascia secondary text |
| `--ok` | `#1F7A4C` | success, online, paid |
| `--warn` | `#B45309` | pending, offline, low stock |
| `--danger` | `#B42318` | failed, overdue, destructive |
| `--info` | `#1F5FA8` | neutral information |

Measured contrast (WCAG 2.2, sRGB):

| Pair | Ratio | Allowed use |
|---|---|---|
| ink on brand | **5.41:1** | body text on a primary button ✔ |
| white on brand | 3.06:1 | large text only — **not used** |
| brand-ink on white | **4.56:1** | brand-coloured text ✔ |
| muted-ink on canvas | **5.53:1** | secondary text ✔ |
| ink on canvas | **15.32:1** | primary text ✔ |
| topbar foreground on topbar | **15.32:1** | ✔ |
| topbar-muted on topbar | 7.89:1 | ✔ |
| dark: ink `#F6F6F4` on surface `#22272C` | 13.92:1 | ✔ |
| dark: muted `#A8B0B9` on surface | 6.87:1 | ✔ |

**Rule:** colour never carries meaning alone. Every state is colour **plus** an icon or a
word.

### Chart ramp

Ordered so adjacent series differ in lightness, not only hue:

| Series | Light | Dark | Meaning |
|---|---|---|---|
| 1 | `#F26A1B` | `#F26A1B` | the primary series (revenue, total) |
| 2 | `#1B1F23` | `#F6F6F4` | the comparison series |
| 3 | `#8A939F` | `#9AA3AE` | a volume/neutral series |
| 4 | `#C97B3D` | `#D98B4B` | credit or deferred money |
| 5 | `#2F6F6A` | `#4E9A94` | tax or a fourth category |

Series 3 (`#8A939F`) is 3.11:1 on white — it is usable for a **filled area or bar** but not
for small text or a 1 px line without a second cue. Lines carry a dash pattern or marker as
well as a colour.

---

## 3. Typography

| Role | Family | Usage |
|---|---|---|
| Display | **Space Grotesk Variable** | page titles, the Till Line total, KPI values, the `SD` monogram |
| UI | **Inter Variable** | labels, tables, body, buttons, forms |
| Figures | **JetBrains Mono Variable** | every amount, quantity, receipt number, timestamp, SKU, barcode |

Scale (rem, 16 px root):

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `display-xl` | 40 / 1.05 | 600 | Till Line total only |
| `display-lg` | 30 / 1.1 | 600 | KPI tile value, POS grand total |
| `title` | 24 / 1.2 | 600 | page title |
| `heading` | 16 / 1.35 | 600 | section heading, card title |
| `body` | 14 / 1.5 | 400 | default text |
| `caption` | 12 / 1.4 | 400–500 | helper text, table meta |
| `micro` | 11 / 1.35 | 500 | uppercase eyebrows, `letter-spacing: .06em` |

Rules:
- Titles use `letter-spacing: -0.015em`; micro labels use `+0.06em`.
- Never below 12 px for anything a person must read. 11 px is reserved for uppercase eyebrows
  and dense table meta.
- Money and counts always `font-variant-numeric: tabular-nums`.
- One display weight jump per screen is enough. Three type levels maximum: heading, body,
  caption.

---

## 4. Layout and density

- **Spacing:** 4 px base. Component padding 12–16 px, section gap 24 px, page padding 16/24.
- **Grid:** 12 columns, 24 px gutter, max content width `96rem`. The dashboard spans
  `8+4`, `6+6`, and `3+3+3+3`.
- **Radii:** `--radius` 10 px; cards 14 px (`radius-xl`); inputs and buttons 8–10 px.
- **Borders before shadows.** A card is a 1 px `--line` border on white with
  `--shadow-card` only as a hint. Popovers get `--shadow-pop`.
- **Admin row height:** 40 px. **POS row height:** 44–56 px.
- **Admin sidebar:** `15.5rem` expanded, icon-collapsed at `lg`, `Sheet` below.
- **Topbar:** `3.25rem`, sticky, `z-30`, `print:hidden`.

### Admin shell

```
┌───────────────┬──────────────────────────────────────────────────────┐
│ SD Sceptre    │  breadcrumb            [branch ▾]  [◐]  [avatar ▾]   │ ← charcoal fascia
│               ├──────────────────────────────────────────────────────┤
│ Overview      │  Page title                          [actions]       │
│  Dashboard    │  description                                         │
│ Operations    │                                                      │
│  Catalog      │  ┌─ panel ─────────────┬─ panel ────────────────┐   │
│  Inventory    │  │                     │                        │   │
│  Suppliers    │  └─────────────────────┴────────────────────────┘   │
│ Organisation  │                                                      │
│ System        │                                                      │
└───────────────┴──────────────────────────────────────────────────────┘
```

### POS

```
┌──────────────────────────────────────────────────────────────────────┐
│ BRANCH · T123  Shift 41 · float GHS 200   ●Online  Cashier  [⋯][Lock]│ ← fascia
├──────────────────────┬───────────────────────────────┬───────────────┤
│ Search / scan        │ Cart lines                    │ Customer      │
│ Product grid         │                               │ Credit        │
│                      │ Totals                        │ Loyalty       │
│                      │ [ Charge GHS 95.00    F9 ]    │               │
└──────────────────────┴───────────────────────────────┴───────────────┘
```

The three-column sell layout is unchanged in Phase 10 — only the visual language changes.

---

## 5. Components

- **Button.** `default` = brand fill + ink label; `secondary` = white + line border; `ghost`
  = transparent, hover `--accent`; `destructive` = `--danger` fill + white label. Sizes
  `sm` 32, `default` 36, `lg` 44; the POS primary action is 56. Every button has a visible
  focus ring and a 150 ms colour transition.
- **Card.** White, 1 px line, 14 px radius, 16–20 px padding, title in `heading`.
- **Table.** Sticky header, 40 px rows, `--muted-ink` header labels in `micro`, right-aligned
  numeric columns with tabular figures, row hover `--accent/40`. Never zebra-striped.
- **Status badge.** Pill, tinted background, dot + word. Variants map to the semantic tokens.
- **Form field.** Visible label above the input (never a placeholder as a label), helper text
  below, error in `--danger` adjacent to the field with an icon.
- **Empty state.** Icon, one sentence explaining what is missing, one primary action.
- **Skeleton.** Mirrors the final layout's blocks; never a spinner in a table body.
- **Dialog.** Generated `Dialog`/`AlertDialog`; focus trapped, Escape closes, destructive
  action is not the default focus.

---

## 6. Charts

Built with Recharts 3 through the shadcn `chart` wrapper. Rules:

1. **Chart type follows the question.** Trend → area/line. Composition of a total → stacked
   bar. Ranking → horizontal bar. Single KPI vs target → bullet/progress. Never a pie.
2. **Tokens, not hex.** Series colours are `var(--chart-N)` used directly. In Tailwind v4 the
   token is already a full colour — `hsl(var(--chart-1))` is a bug.
3. **Height is mandatory.** `ChartContainer` always carries `min-h-*` or `aspect-*`.
4. **Readable without hover.** Labelled axes, units in the axis label, a legend when there is
   more than one series, and a one-sentence summary above the chart.
5. **Accessible.** `role="img"` and a descriptive `aria-label`; tooltip opens on keyboard
   focus; a togglable data table provides the same values.
6. **Honest.** Zero baselines for bars, no truncated axes, no dual axes, no 3D, no smoothing
   that implies data between points.
7. **Money on the axis in GHS, data in pesewas.** Conversion happens in the tick formatter.
8. **Empty and loading are designed states**, not blank rectangles.

---

## 7. Motion

- CSS transitions only: 150–200 ms, `ease-out`, colour/opacity/transform/box-shadow.
- No animated `width`/`height`; the sidebar uses transform.
- No entrance animations on a POS selling path.
- `prefers-reduced-motion: reduce` disables animation and smooth scrolling globally.
- No animation library is added in Phases 7–10.

---

## 8. Writing

- Name things by what the person controls: "Send receipt", not "Execute print job".
- Active voice, sentence case, plain verbs. The button says "Save changes"; the toast says
  "Changes saved".
- Errors state what happened and what to do next. No apologies, no stack traces, no codes
  without a sentence.
- Offline is a normal state: "Offline — 3 sales waiting", not "Connection error".
- Empty screens invite action: "No suppliers yet. Add your first supplier."
- Never expose internal names: no `sale_line`, `sync_conflict`, `terminalId` in UI copy.

---

## 9. Accessibility checklist (per screen)

- [ ] Text contrast ≥ 4.5:1 (≥ 3:1 for ≥ 24 px or ≥ 19 px bold)
- [ ] UI borders and chart lines ≥ 3:1 against their background
- [ ] Visible focus ring on every interactive element
- [ ] Keyboard reaches everything; no hover-only action
- [ ] Touch targets ≥ 44×44 px on the POS
- [ ] Every icon-only control has an `aria-label`
- [ ] Every chart has `role="img"` + `aria-label` + a data-table alternative
- [ ] State is never conveyed by colour alone
- [ ] Tables use real `thead`/`th` with `scope`
- [ ] `prefers-reduced-motion` respected
- [ ] Works at 320, 768, 1024, 1440 px with no horizontal scroll
- [ ] Print preview of documents shows no chrome

---

## 10. Never do

- White text on `--brand`.
- A brand hex value inside an app component or app stylesheet.
- A second copy of the token block.
- A hand-rolled dialog, table, or chart.
- A dashboard with six equal stat cards and nothing else.
- Decorative gradients, glows, glass, or emoji.
- Animating a number on load.
- A chart whose only readable value is inside a tooltip.
- A list endpoint aggregated in the browser.
- Any change that can block a sale at the till.
