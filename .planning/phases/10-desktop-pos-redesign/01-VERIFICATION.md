# Phase 10 — Verification

**Phase:** Desktop POS Modules, Chrome & Shift Home
**Verified:** 2026-10-25
**Plans:** 10/10 complete
**Branch:** `dev`
**Transcript:** `evidence/suites.txt` (one full gate matrix, `evidence/run-suites.sh`)
**Counter audit:** `desktop/test/e2e/counter-audit.mjs` — `bun run --filter desktop test:counter`
**Contract:** `00-CONTEXT.md`, amended by `00-DECISIONS.md` (P10-D1…P10-D15)
**Screenshots:** `evidence/shots/counter-{home,sell,tender,receipt,sales,shift,sync,settings,login}-1024.png`

Goal-backward: every section below names the command or recorded step that would fail if the
claim were false. Nothing here reasons from "tasks done".

---

## Roadmap success criteria

### 1. `modules/` holds every POS domain with the same seven folders, and `routes/` files resolve a hash route to a module page

- `bun run modules:check:pos:strict` → **14/14 modules migrated**, and the same gate runs inside
  `bun run modules:check:strict`, which CI already invokes (`ci.yml:58`). The gate enforces the
  allowed folder set (`api/ components/ hooks/ pages/ types/ ui/ utils/ index.ts`), forbids a
  module from deep-importing a sibling, and requires a route file to hold no markup — it fails
  the build, it does not warn.
- `find desktop/src/renderer/modules -mindepth 1 -maxdepth 1 -type d | wc -l` → **14**
  (transcript, gateway invariants).
- The fourteen modules are `auth cart catalog credit customers home loyalty receipt sales sell
  settings shift sync tender`. A folder exists only when it has content (D2's refinement of the
  admin's seven-folder rule), so the shape column reads 1–6 rather than 7 everywhere.
- `desktop/src/renderer/routes/` is five files: `login.tsx` and `shift.tsx` (5 lines each — a doc
  comment and one export of the module page), `_pos/app.tsx`, and two `_pos/dev-*.tsx`
  diagnostics. `_pos/app.tsx` is **162 lines** and holds the guard ladder, the provider wiring,
  and the `screen` switch — behaviour, not markup.
- `main.tsx` resolves **7** top-level hash routes through `topLevelScreen(parseHash(hash))`, a pure
  function with five routing cases in `lib/router.test.ts` — including "an empty hash is sign-in,
  never the diagnostics shell".

### 2. A cashier signs in, lands on the shift home, sees today's take, cash in drawer, credit given, items sold, the day's hourly shape, and top sellers — then starts selling in one action

The counter audit proves this against a real terminal, not a mock:

- **§1 boot**: a fresh `userData` opens the enrolment form; the code redeems; the temporary PIN
  forces a change; the new PIN lands on `#shift`.
- **§2 sell**: opening a shift lands on **`#home`** (asserted by hash); **Start selling** lands on
  the sell screen with the search field focused; three baskets are sold — cash with change, exact
  cash, and credit against a customer with headroom.
- **§3 home**, each figure against arithmetic the script owns in integer pesewas:
  - take = the sum of the three sale totals — `GH₵515.00` from `75.00 + 160.00 + 280.00`;
  - credit given = the credit sale's total — `GH₵280.00`;
  - sub-line counts `3 sales · 4 items`;
  - average basket = `averageBasketMinor(take, 3)` **imported from `@sceptre/shared`**, the same
    function the console uses (P10-D3) — `GH₵171.67`;
  - tax included is non-zero and less than the take — `GH₵85.84`, which is the sum of the
    per-line integer tax, not a single division of the total;
  - expected in the drawer = float + cash tendered − change = `200 + 95 + 160 − 20` —
    `GH₵435.00`;
  - the hourly chart has exactly one brand-orange bar (`rgb(242,106,27)`), the current hour, and
    the summary sentence names the real peak: *"Busiest at 14:00 with GH₵515.00."*;
  - the top-five list has the product sold most first.
- **§5 keyboard**: `Tab` reaches **Start selling**, `Enter` opens the sell screen with the search
  focused, typing a SKU and pressing `Enter` adds the line, `F9` tenders, the number row types the
  amount, `F9` completes — a whole sale with no pointer.
- The screenshot `shots/counter-home-1024.png` is the screen at the smallest supported counter
  size: take, drawer, credit, tax, the hourly shape, the peak sentence, and *Start selling* above
  the fold.

**Command:** `bun run --filter desktop test:counter` → **150/150**.

### 3. The home screen and every redesigned screen work with the network unplugged; charts read the local PowerSync database

- **No network call exists to fail.** `modules/home/api/queries.ts` is SQL over the local
  database; the module imports no `fetch`, no `api` client, and no `@sceptre/api`. The home
  screen's four sources are the local `sale`, `sale_line`, `sale_tender`, `cash_movement`,
  `sync_conflict_local`, and `outbox` tables (P10-D1, P10-D4).
- **§7 offline**, with the driver's network emulation rather than a killed service:
  - the sync badge reports `Offline` and is not styled as an error;
  - a sale still completes, prints, and the home take moves;
  - the outbox shows the waiting count, and the attention strip names the uploads waiting;
  - quit and relaunch, still offline: the terminal asks for a PIN (**not** for enrolment), lands
    on `#home`, and the figures are identical to the pre-relaunch read.
- **§4 matrix**: all nine screens render at 1024×768, 1366×768, and 1920×1080 with no horizontal
  scroll and no motion above 1 ms under `prefers-reduced-motion: reduce`.
- The one thing the terminal deliberately cannot show is branch takings: `sale` is a local-only
  table and `powersync/sync-config.yaml` excludes it, so the heading says **"This terminal
  today"** and every caption repeats the scope (P10-D1).

### 4. The redesign changes nothing about the money rules

Re-run in `evidence/suites.txt` today:

| Suite | Result | Phase start |
|---|---|---|
| `bun run --filter desktop test` | **413/413** (50 files) | 339 |
| `bun run --filter api test` | **394/394** | 394 |
| `bun run --filter @sceptre/shared test` | **149/149** | 127 |
| `bun run --filter desktop test:e2e` (packaged shell) | **40/40** | 38 |
| `bun run --filter desktop test:print` (fake ESC/POS) | **21/21** | 21 |
| `bun run --filter desktop test:counter` | **150/150** | new |

- **No money rule moved.** `lib/sale/complete-sale.ts`, `lib/sale/sale-repository.ts`,
  `lib/sale/sale-draft.ts`, `lib/printing/**`, `lib/outbox/**`, and `lib/document-sequence.ts`
  are untouched by this phase; the sale is still one local transaction with its outbox row, and a
  print failure still never voids a sale.
- **Integer money throughout.** The gateway invariant reports **0** uses of `toFixed(` in the
  renderer's non-test sources, and the counter audit compares formatted strings derived from
  integer pesewas — no float comparison enters it.
- **One average-basket implementation.** `export function averageBasketMinor` appears once
  (`packages/shared/src/money.ts`); the console and the till both call it (five call sites).
- **The print path is unchanged and still prints.** 21/21 through the fake ESC/POS adapter:
  42-column text, the `GHS` symbol, VAT/NHIL/GETFund lines, change, the reprint marker, and the
  drawer kick.

**Not re-run, and why.** Phase 6's 51-check `evidence/e2e-pos.mjs` is the phase's "offline
walkthrough". It starts and stops the API because it *assumes it owns `:4000`*, so running it
would kill the developer's API process and rewrite terminal state. Its POS legs are re-proven
today by the counter audit §1, §2, and §7 against the same code paths, and its paper leg by the
print smoke. Its device-revocation, duplicate-upload, and last-unit-race legs are **not** covered
by anything in this phase; they belong to Phase 15's offline drill suite, and that gap is recorded
in `STATE.md` rather than papered over.

### 5. Offline is presented as a normal state with an honest sync badge, never as an error, and no counter action is hover-only

- The badge's state machine and labels were not touched by this phase. `SyncBadge` derives its
  state from what a cashier can act on and renders a dot **plus an icon plus a word**; the counter
  audit asserts `data-state="offline"` offline and that the badge carries no error styling.
- The sync screen repeats the states without red: a waiting queue is informational, `HIGH` is the
  only conflict severity styled as a problem and it says *"High — needs review"*.
- **No hover-only affordance on a counter surface.** The gateway invariant greps
  `modules/**`, `components/layout/**`, and `components/common/**` for `group-hover`/`peer-hover`
  and reports **0**. The three matches in the renderer are inside the generated
  `components/ui/sidebar.tsx`, which the POS never imports or renders.
- **Every target is reachable with a glove on.** The matrix asserts `≥ 44 × 44` for every element
  the browser would hit-test on every screen at every width, excluding only `sr-only` fields
  (clipped 1 px controls with a real accessible name, not touch targets). The primary action on
  each screen is inside the viewport at 1024×768 without scrolling.

---

## Defects found and fixed in this phase

| Defect | Found by | Fix |
|---|---|---|
| A first install opened the diagnostics shell instead of enrolment | Plan 08 | `topLevelScreen`; the shell moved to `#diagnostics` |
| POS product tiles truncated names | Plan 06 | content-sized card with a measured height |
| `(minor / 100).toFixed(2)` in two money inputs | Plan 03 | `formatMinorPlain` |
| ~100 raw Tailwind palette classes across the renderer | Plans 06–09 | semantic tokens; 0 remain outside the four diagnostics surfaces |
| The tender keypad was pointer-only for cash entry | Plan 09 audit | `appendPesewaDigit`/`removePesewaDigit` + number-row shortcuts |
| The tender screen reported "no credit account" while its local read was running | Plan 09 audit | `CustomerContext.creditLoading` |
| The number row died after every failed PIN | Plan 08 review | `readOnly` instead of `disabled` |
| Autofocus swallowed the staff code on the activation screen | Plan 08 review | opt-in `autoFocus` |
| No visible focus indicator on four screens | Plan 08 review | `focus-within` ring on the PIN display |
| A pending receipt's badge read as printed to the E2E | Plan 07 review | `Pending` no longer contains the word |
| Today's sales counted other days' unprinted receipts as today's | Plan 08 review | the caption totals today's window only |

## What this phase did not prove

- **Physical hardware.** The 80 mm printer, barcode scanner, and cash drawer are driven through
  the fake adapter and the IPC bridge, never through a real device. Phase 15's human checklist.
- **A Windows build.** Packaging is proven on Linux; the Squirrel installer and the native printer
  module on Windows remain Phase 15's.
- **The sell screen's credit panel** still flashes "No account here" for one frame while its local
  read runs. Cosmetic — nothing acts on it — and recorded rather than fixed in a verification plan.
- **`components/ui/sidebar.tsx`** is a generated registry file the POS never renders. Dead weight
  in the renderer bundle; not removed here because the registry set is shared with the admin.
