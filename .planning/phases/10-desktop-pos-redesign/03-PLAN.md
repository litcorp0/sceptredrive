---
phase: 10-desktop-pos-redesign
plan: 03
title: Primitives, chrome, and counter ergonomics
lane: pos
depends_on: [02]
requirements: [UIX-08, UIX-09]
---

# Plan 03 — Primitives, chrome, and counter ergonomics

## Goal

The terminal stops looking like a different product from the console. The hand-written `Modal`
becomes the registry `Dialog`; raw ul-buttons become `Button` variants; empty states become
`Empty`; loading states become `Spinner`/`Skeleton`. Every counter control reaches a 44 × 44 px
hit area and the primary action stays 56 px. No copy changes, no layout rewrites — the screens
are retuned in Plans 06–08, not here.

## Read first

- `00-CONTEXT.md` D7, D8, D9; `00-DECISIONS.md` P10-D9.
- `desktop/src/renderer/components/common/modal.tsx` — the behaviour the replacement must keep.
- `STATE.md` Phase 7 Plan 04 — **the shadcn CLI hazard**: it overwrites existing primitives even
  without `--overwrite` and appends 16 token variables to the app stylesheet.
- `desktop/src/renderer/index.css:28-47` — the unlayered focus-visible rule and why it exists.
- `admin/src/components/ui/empty.tsx` — the shape the desktop is about to gain.
- `desktop/components.json` — aliases, `new-york`, `zinc`, `cssVariables: true`.

## Tasks

### 1. Generate `empty` and `spinner` — with the ritual

1. Move every existing `components/ui/*.tsx` aside (outside the tree).
2. `bunx shadcn@latest add empty spinner` in `desktop/`.
3. Restore the existing primitives **byte-identical** (`git diff` must be empty for them).
4. `git diff desktop/src/renderer/index.css` — revert any injected `--primary`, `--sidebar*`, or
   oklch/hsl block. The brand tokens are the only token source; `tokens:check` will fail if a
   literal colour appears under `desktop/src/renderer`, so this is enforced, not remembered.
5. The generated files import `cn` from `@/lib/utils`, which does not exist (the desktop's
   primitives import `cn` from the `cn` package — Phase 7 deleted `lib/utils.ts`). Rewrite that
   one import line in each generated file to `import { cn } from 'cn'`, and add the rule to the
   modules README so the next generation does the same.

### 2. `Dialog` replaces `Modal`

Delete `components/common/modal.tsx` and move its five consumers
(`discount-dialog`, `customer-dialog`, `customer-create-dialog`, `loyalty-redeem-dialog`,
`manager-override-dialog`) plus `shift-dialogs` and `manager-unlock` to
`Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter`.

Behaviour that must survive, and how to prove it:

| Behaviour today | After |
|---|---|
| Escape closes (window keydown listener) | Radix handles Escape; the global shortcut hook stays disabled while open |
| Focus moves into the panel; returns to the trigger | Radix traps focus, but **does not restore it here**: every POS dialog opens from state, so `DialogTrigger` is absent and `DialogContent`'s close handler skips its restore. `components/common/use-dialog-focus-return.ts` captures the opener and restores it via `onCloseAutoFocus`. |
| Backdrop tap closes on a touch screen | `DialogContent` `onPointerDownOutside` |
| `aria-labelledby` / `aria-describedby` | `DialogTitle` / `DialogDescription`, generated ids |
| `wide` prop (`max-w-2xl`) | `className="max-w-2xl"` at the call sites that use it |
| `data-testid` | preserved on `DialogContent` — the E2E and walkthrough selectors must not move |

There are **eight** `Modal` consumers, not seven: the clear-cart confirmation inside the sell page
is one too, and it is module-local (`modules/sell/components/clear-cart-dialog.tsx`) because it
acts on the cart.

The `Modal` shell's own header/footer chrome is replaced by `DialogHeader`/`DialogFooter`; keep
the 90vh cap and the scrolling body so a long customer-change dialog still fits at 1024×768.

### 3. Buttons, chips, and tables

- Every `rounded-md border border-border px-3 text-sm font-medium hover:bg-muted` becomes
  `Button variant="outline"`; destructive actions become `variant="destructive"`. The primary
  counter action (`Start selling`, `Pay`, `Complete sale`, `Close shift`) is
  `size="lg"` at **56 px** with `charcoal-on-orange` — never white on orange (Phase 7's measured
  contrast).
- Status chips (print status, stock badges, movement types) become `Badge` variants **without
  changing any label text**; the Phase 7 rule stands: the tint or the dot carries the colour and
  the label stays `text-foreground`.
- Hand-written dashed "empty" boxes become `Empty`: the product grid's no-results state
  (`catalog/components/product-grid.tsx`), today's-sales with no sales, the sync screen with an
  empty outbox, and settings with nothing configured.
- `Loading…` paragraphs become `Skeleton` rows or `Spinner` where a duration is unknown.

### 4. Counter ergonomics (D8, D9)

- Every interactive element measures **≥ 44 × 44 px of hit area**. Where a dense table row
  needs a smaller visual, pad the hit area (or use a `::after` overlay) rather than shrinking
  the target; the audit in Plan 09 measures `getBoundingClientRect()` of the interactive
  element itself.
- Amounts: `font-mono tabular-nums` on every money figure, including the cart line totals and
  the home tiles when they arrive. No proportional figures on a column of money.
- No animated layout on the selling path: no height/width transitions on panels that move the
  pay button. Colour-only transitions are fine.
- `prefers-reduced-motion: reduce` still caps transition durations (the token file already
  does); the charts added later must not animate under it.

### 5. Chrome

`components/layout/app-header.tsx`:

- **the unprinted-receipt count becomes a module query.** Move its SQL
  (`components/pos/app-header.tsx:37-41`) into `modules/sales/api/queries.ts` and export
  `useUnprintedCount()`; the header consumes it now and the home strip consumes the same string
  later. This extraction lives here, not in Plan 04, so that Plan 04 writes only
  `modules/home/**` — which is what makes wave 4 in the README legal.
- the unprinted button keeps its place, its label, and `data-testid="unprinted-count"`;
- the sync cluster keeps `SyncBadge` **byte-identical in state machine and labels** — Phase 7
  fixed a bug there ("Downloaded 14:02" when offline) and it must not regress;
- all header controls stay ≥ 44 px; heights come from `--layout-topbar-height`, not magic
  numbers;
- **not in this plan:** the home affordance. It navigates to `#home`, which does not exist until
  Plan 05, so adding it now would send a cashier to the diagnostics fallback in the interim.
  Plan 05 owns it, and owns this file for that one bullet.

### 6. Two float round-trips in money inputs

`discount-dialog.tsx:45` and `shift-dialogs.tsx:183` seed an editable amount with
`(minor / 100).toFixed(2)`. Replace both with `formatMinorPlain(minor)` from `lib/format.ts`,
which is integer-only. This is a two-line fix that removes the only two places the renderer
converts money through a float.

### 7. `components/common/screen-header.tsx`

The five screens repeat the same `<h1>` + subtitle + optional actions block
(`sales`, `sync`, `settings`, `receipt`, `shift`). Extract it once, keep every string identical,
and let Plans 06–08 consume it.

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run lint
bun run tokens:check
bun run brand:check
bun run modules:check:pos
grep -rn "from '@/lib/utils'" desktop/src/renderer   # expect nothing
grep -rn "toFixed(" desktop/src/renderer --include='*.ts*' | grep -v test   # expect nothing
```

Expected: desktop suite green with no test edited except selectors that named `Modal` (list them
in the commit message); `tokens:check` proves the CLI injected no palette; the Electron E2E's
dialog steps pass unchanged.

Manual pass at 1024×768: open each of the seven dialogs, Tab through it, Escape out, and
confirm focus returns to the control that opened it.

## Commits

1. `feat(desktop): empty and spinner primitives from the registry`
2. `refactor(desktop): Dialog replaces the hand-written Modal`
3. `refactor(desktop): buttons, badges, and empty states use the primitives`
4. `fix(desktop): seed money inputs from integer pesewas, not a float`
5. `refactor(desktop): one screen header, and the unprinted count out of the chrome`

## Done when

- `Modal` no longer exists; seven dialogs use `Dialog` with focus trap, Escape, and restored
  focus.
- `Empty`, `Spinner`, `Skeleton`, `Button`, and `Badge` are the only primitives in use; no
  hand-rolled panel, chip, or dialog markup remains in `modules/` or `components/`.
- Every interactive control has a ≥ 44 × 44 px hit area; the primary action is 56 px.
- Money never round-trips through `Number.toFixed` anywhere in the renderer.
- `useUnprintedCount()` lives in `modules/sales/api/queries.ts` and the header imports it; no
  unprinted-receipt SQL remains in `components/layout/`. (`sync-badge.tsx` keeps its own
  conflicts query: it must stay byte-identical in state machine and labels, and moving its SQL
  was not this plan's job.)
- `tokens:check` and `brand:check` are green, and `components/ui/*` is byte-identical to what it
  was before the registry run, apart from the two new files.
