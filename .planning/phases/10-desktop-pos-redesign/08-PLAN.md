---
phase: 10-desktop-pos-redesign
plan: 08
title: Shift, login, settings, sales, and sync modules
lane: pos
depends_on: [03]
requirements: [UIX-08, UIX-09]
---

# Plan 08 — Shift, login, settings, sales, and sync

> **Ordering.** In the serial order this runs after Plan 07. It shares no file with Plans 06 or
> 07, so it may run beside them under README wave 4's directory split — this plan owns
> `modules/{shift,auth,settings,sales,sync}` and `modules/sales/api/queries.ts` stays frozen as
> Plan 03 left it.

## Goal

The remaining six screens join the design system, and two carried-forward defects are fixed: a
first install opens **enrolment**, not the diagnostics shell, and the day window is computed by
one shared helper instead of an inline copy.

Nothing about shift arithmetic, PIN verification, uploads, or conflict handling changes.

## Read first

- `00-CONTEXT.md` D2, D8, D10, D12.
- `modules/auth/pages/login-page.tsx` (632 lines) — enrolment → activation → PIN pad → forced
  PIN change → manager unlock. The **flow order is behaviour** and does not change.
- `modules/shift/pages/shift-page.tsx` and `components/shift-dialogs.tsx` — float, expected,
  variance, cash in/out, close.
- `lib/auth/pin.ts`, `lib/auth/bindings.ts`, `lib/shift/shift-service.ts` — read only.
- `lib/sale/sale-repository.ts` — `listSalesBetween`, and the inline `dayBounds`
  (`modules/sales/pages/sales-page.tsx:31-38`) that Plan 01 replaced.
- `STATE.md` Phase 7 carry-forward: *"A first install opens the diagnostics shell rather than
  enrolment."*

## Tasks

### 1. First install opens enrolment

`main.tsx` currently falls through to `<App />` (the diagnostics shell) for an empty hash and
for any unknown route. A freshly installed terminal therefore boots into a developer screen.

After:

- `parseHash('')` resolves to the **login** branch, which already renders enrolment when the
  device has no credential and the PIN pad when it does;
- the diagnostics shell stays reachable at a named route (`#diagnostics`) for support, and
  `App.tsx` gains one line of copy saying what it is and that it is not the till;
- `#spike` keeps working — it is Phase 6's evidence panel and costs nothing;
- a test asserts: empty hash → login route; `#diagnostics` → the shell; `#spike` → the spike
  panel.

This is a real product defect, not cosmetics: a shop receiving a new terminal must see an
enrolment code field.

### 2. Login and PIN

- Enrolment: one field, one button, 44 px minimum, a clear error for a used or expired code
  (the server's 400/409 messages already say which).
- PIN pad: keys ≥ 64 px (it is a touch target by definition), digits reachable by the number
  row and by Tab, `inputMode="numeric"` on the hidden field, and the entered count announced
  (`aria-live`) without announcing the digits themselves.
- Lockout copy names the remaining time, not the attempt count alone.
- Manager unlock is a separate `Dialog` (Plan 03) and never blocks a sale in progress — it is
  reached from the override dialog, not on top of a completed tender.
- Forced PIN change keeps `pinMustChange` semantics exactly; the temp-PIN banner stays.
  *(Correction after execution: there is no temp-PIN banner anywhere in the renderer — the only
  trace was a comment claiming one exists. The comment now says what actually happens, that
  `pinMustChange` stays set so the next sign-in asks again. Nothing was removed.)*
- Every string stays in the operator's voice: "Enter your PIN", not "Authentication required".

### 3. Shift

- Float, expected cash, variance as three tabular figures; variance colours carry a word
  ("Over GHS 12.00" / "Short GHS 4.00") so it is not colour-only.
  *(Correction after execution: variance cannot exist until the drawer is counted, so while the
  shift is open the third figure reads "—" with the caption "Known when you count the drawer".
  A zero would have said the drawer balanced.)*
- Open and close dialogs are `Dialog`s with a money input seeded by `formatMinorPlain` (fixed in
  Plan 03) and parsed by `parseGhsToMinor`; a non-numeric value is rejected inline, not on
  submit.
- Cash in/out keep their reason field and their audit intent; nothing about the outbox rows
  changes.
- After closing, the success panel shows expected, counted, and variance and a single action
  back to the shift screen.
- Lock is still refused while a shift is open, with the same sentence.

### 4. Settings

- Two `Card` sections: terminal (identity, read-only) and printer (target, copies, charset,
  cedi glyph, drawer pin) — the same `device_setting` keys, unchanged.
  *(Correction after execution: the selling-policy, loyalty, and PIN rows are labelled groups
  inside the identity card rather than deleted. Read literally, "two sections" would have removed
  the discount caps and lockout policy a manager reads on the till.)*
- Manager-only, exactly as today (`staff.role === 'CASHIER'` cannot reach it).
- A printer self-test button and its result line, with the outcome in words rather than a
  colour.
- No credential, token, or key material is ever rendered, including in the identity block.

### 5. Today's sales

- Replace the inline `dayBounds` with `accraDayBounds` and `accraIsoDay` from `@sceptre/shared`.
  The screen's behaviour is identical; the arithmetic now has one implementation (Plan 01).
- The table gains a caption and a per-row accessible name ("Receipt … at … paid by …"), keeps
  `ACC-SPX-T01-S-…`-style receipt numbers in `font-mono tabular-nums`, and its Open action
  reaches 44 px of hit area.
- Empty state becomes `Empty`: *"No sales yet today."* plus what appears here and that it
  survives a restart (the existing, useful sentence).
- An unprinted older receipt is still listed, because a printer problem must never hide a sale.
  *(Correction after execution: this needed no code. `listSalesBetween` already carries
  `OR print_status IN ('PENDING','FAILED','PRINTING')`; only the screen's copy understated it.)*

### 6. Sync

- Offline is a normal state (`D10`): the header badge keeps its exact state machine and labels;
  the sync screen repeats them without red.
- Outbox rows show `formatRelative` for the next attempt with the absolute time in `title`
  (Phase 7 behaviour), the attempt count, and the last error **code** plus message.
- Conflicts: `HIGH` severity is the only thing styled as a problem, and it is styled with a word
  plus a `--danger` dot. A conflict row links to the receipt when the sale is local.
- Upload controls (try now, and the dev-only diagnostics links) stay where they are; nothing on
  this screen is hover-only.

### 7. Raw palette cleanup

Finish the sweep started in Plan 06: zero `amber-*`, `emerald-*`, `sky-*`, `red-*`, `zinc-*`
classes remain in `modules/**`, `components/{layout,common}/**`, or
`routes/{login,shift}.tsx`. `#dev/sync`, `#dev/print`, `#spike`, and `#diagnostics` are exempt as
diagnostics and the audit's allowlist names them.

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run lint
bun run modules:check:pos:strict
bun run modules:check
bun run --filter desktop test:e2e            # shell + packaged
grep -rn "amber-\|emerald-\|sky-\|red-\|zinc-" desktop/src/renderer/modules \
  desktop/src/renderer/components/layout desktop/src/renderer/components/common   # expect nothing

# Note: that pattern also matches 'stored-token' in desktop-api.test.ts ('red-' inside
# 'stored-'). A gate needs a class-shaped pattern, not a substring.
```

(The `routes/**` files are thin re-exports after Plan 02, so they carry no classes and are not
listed. `#dev/sync`, `#dev/print`, `#spike`, and `#diagnostics` stay exempt as diagnostics.)

Manual: delete the local app data (or use a fresh `userData`), launch, and confirm the first
screen is enrolment. Then enrol, set a temporary PIN, change it, open a shift, sell, close, and
read the Z figures against the sales list.

## Commits

1. `fix(desktop): a first install opens enrolment, not the diagnostics shell`
2. `feat(desktop): the PIN pad and enrolment at touch scale`
3. `feat(desktop): the shift screen reads float, expected, and variance at a glance`
4. `refactor(desktop): settings on Cards with an honest printer self-test`
5. `refactor(desktop): today's sales uses the shared Accra day window`
6. `feat(desktop): sync and conflicts read as normal states`
7. `refactor(desktop): finish the semantic colour sweep`

## Done when

- A fresh install lands on enrolment; `#diagnostics` still opens the shell deliberately.
- Every control on the six screens is ≥ 44 × 44 px and every amount is tabular.
- `accraDayBounds` is the only day-window implementation in the renderer.
- Zero raw palette classes outside the four named diagnostic surfaces.
- `modules:check:pos:strict` is green and the desktop suite passes with no behavioural
  assertion edited.
