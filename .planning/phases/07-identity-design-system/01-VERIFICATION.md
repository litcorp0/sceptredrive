# Phase 7 — Verification Report

**Phase:** Identity, Design System & Brand Foundation
**Plan:** 07 (phase verification, evidence, state update)
**Verified:** 2026-10-24
**Verdict:** **Complete.** Every success criterion in `ROADMAP.md` is proven below by a
command or a recorded step, and the three defects the verification found were fixed in this
phase rather than carried.

> Nothing in this report is asserted without an artefact. Each row names the command that
> produces it; the transcript is `evidence/suites.txt` and the screenshots are
> `evidence/shots/plan07-*.png`.

---

## 1. Goal-backward verification

The phase goal: **the product is called Sceptre Drive everywhere it is visible or
load-bearing, and both clients draw from one design-token source, one typography set, one
primitive library, and one date formatter.**

| # | Success criterion (ROADMAP) | Proof | Result |
|---|---|---|---|
| 1 | `brand:check` over the repository returns only the documented allowlist | `bun run brand:check` | **OK — 651 tracked files, old brand absent.** Allowlist is unchanged from Plan 01: `desktop/src/main/config.ts` (the one `SCEPTRE_DOMAIN` placeholder line), `api/migrations/**`, `.planning/phases/**`, `bun.lock`, and the check script itself |
| 2 | Both clients import the same token file; one hex change reaches both | `bun run tokens:check`; emitted-CSS count in `suites.txt` | **OK.** Both stylesheets import `@sceptre/brand/tokens.css` and declare no brand token. 317 tracked app files carry no brand hex. Each emitted bundle has exactly **2** `--brand` declarations, both `#f26a1b`, both from the one package file (`:root` and `.dark`) |
| 3 | The palette is AA-compliant: charcoal on orange, never white on orange | `bun run tokens:check` (measured, not hard-coded) | **OK.** 11 pairs measured with the WCAG 2.2 relative-luminance formula — table in §2. White on brand is asserted to **stay** below 4.5:1, so the rejected pairing cannot be "improved" into a failure |
| 4 | Every date goes through `@sceptre/shared`; no bare `toLocaleDateString` remains | `walkthrough-admin.mjs` step 7; `grep`; desktop receipt test | **OK.** Three screens checked against the one formatter (§3). No ISO or slash date leaks anywhere. The only `toLocaleString`/`toLocaleDateString` left are inside two generated registry files (`components/ui/chart.tsx`, `calendar.tsx`), as recorded in Plan 05 |
| 5 | Both apps build and the full suite passes after the rename: API 354, shared 73, desktop 339, plus the Electron E2E and packaged smoke | `evidence/suites.txt` | **OK and above baseline.** API **360**, shared **96**, desktop **339**, packaged shell E2E **38/38**. Admin build and desktop package both exit 0 |

### Phase-specific claims

| Claim | Proof | Result |
|---|---|---|
| Neither app may define a brand colour | `tokens:check` rule 2 | **OK** — and the gate is proven to fail: `evidence/verify-token-gate.mjs` mutates the tree eleven ways and asserts each breaks the build with a message naming the cause (**22/22**) |
| No remote assets; `font-src 'self'` unchanged | `tokens:check`, `suites.txt` CSS count, `test:e2e` | **OK** — 0 inlined `data:` fonts in both bundles; 16 woff2 files inside the packaged asar; no CSP violation in the console |
| One date formatter, both clients | `walkthrough-admin.mjs` step 7; desktop receipt test | **OK** — API 96 shared tests include the date suite; the printed receipt asserts a 42-column `Date` line reading `23 Oct 2026 10:15` |

---

## 2. Contrast, measured

Computed from `packages/brand/src/tokens.css` by `scripts/check-tokens.mjs` using the WCAG
2.2 relative-luminance formula, never a copied constant. `bun run tokens:check` prints
exactly this.

| Pair | Mode | Measured | Bound | Verdict |
|---|---|---|---|---|
| `--brand-fg` on `--brand` (primary button label) | light | **5.41:1** | ≥ 4.5 | pass |
| `#FFFFFF` on `--brand` (rejected pairing) | light | **3.06:1** | < 4.5 | **pass (must stay rejected)** |
| `--muted-ink` on `--canvas` | light | **5.53:1** | ≥ 4.5 | pass |
| `--ink` on `--canvas` (body) | light | **15.32:1** | ≥ 7 | pass (AAA) |
| `--brand-ink` on `--surface` (brand as text) | light | **4.56:1** | ≥ 4.5 | pass |
| `--ink` on `--surface` (body) | dark | **13.92:1** | ≥ 7 | pass (AAA) |
| `--muted-ink` on `--surface` | dark | **6.87:1** | ≥ 4.5 | pass |
| `--brand-ink` on `--surface` (brand as text) | dark | **6.57:1** | ≥ 4.5 | pass |
| `--line-strong` on `--surface` (control boundary, SC 1.4.11) | light | **3.65:1** | ≥ 3 | pass |
| `--line-strong` on `--canvas` (control boundary) | light | **3.38:1** | ≥ 3 | pass |
| `--line-strong` on `--surface` (control boundary) | dark | **3.11:1** | ≥ 3 | pass |

The gate also resolves the token *graph*, not just literals: `--primary` must resolve to
`--brand`, `--primary-foreground` to `--brand-fg`, and `--input` to `--line-strong`. Aliasing
the button label to white fails at the relationship check even if `--brand-fg` is untouched.

---

## 3. The date walkthrough (step 7)

The claim is a formatting claim, so it is proven per screen: each screen's rendered dates
must be exactly the shared formatter's output for the value that screen displays.

| Screen | Result |
|---|---|
| Audit list | Every rendered timestamp is exactly a `formatDateTime` image of an API `createdAt`. No ISO, no slash date |
| Credit ledger ("Ledger" tab) | Same; the seeded charge `2026-10-20T11:05Z` renders as `20 Oct 2026, 11:05` |
| Loyalty history ("Loyalty" tab) | Same; every timestamp is a `formatDateTime` image |

**Honest limit:** no seeded instant is shared by all three screens — the credit customer
(Akosua Mensah) has no loyalty history and the loyalty customer (Kwame Boateng) has no credit
entries. The identical-rendering property therefore rests on the formatter identity (all
three screens are proven to use the one helper), not on a coincidental shared row. Stated
plainly rather than papered over.

The statement (step 5) carries helper-shaped dates, and the printed receipt asserts the
`formatAccraDateTime` shape.

---

## 4. Gate matrix

The full transcript is `evidence/suites.txt`, produced by `evidence/run-suites.sh`:

| Command | Result |
|---|---|
| `bun install` | exit 0, 650 installs / 813 packages, no changes |
| `bun run lint` | exit 0, 24 warnings (all pre-existing, in earlier-phase evidence files) |
| `bun run check-types` | exit 0, 6/6 workspaces |
| `bun run brand:check` | exit 0, 651 tracked files |
| `bun run tokens:check` | exit 0 |
| `bun run test` | **API 360/360, shared 96/96, desktop 339/339** |
| `bun run --filter admin build` | exit 0 |
| `bun run --filter desktop package` | exit 0 |
| `bun run --filter desktop test:e2e` | **38/38** |
| Emitted CSS | admin and desktop: 2 `--brand` declarations each, 0 inlined `data:` fonts each |

**A trap worth recording:** `bun test` does **not** run the workspace `test` scripts. Bun
resolves it to its own builtin runner, which executes every test file in the repository with
the wrong setup (576 tests, 31 failures on this tree). The root script is `bun run test`.
`AGENTS.md` says `bun test`; it should say `bun run test`.

---

## 5. Walkthrough record

### Admin console — `evidence/walkthrough-admin.mjs`, **38/38**

| Step | Proved |
|---|---|
| 1. Light, 1440 px | four sidebar groups, exactly one current item drawing the 2 px `#f26a1b` rail, charcoal fascia at 52 px, branch switcher, user menu |
| 2. Dark | theme applies, `--canvas` = `#1b1f23` and `--brand` unchanged from the token file, reload applies dark **before hydration** (no flash), layout identical |
| 3. 375 px drawer | opens, Tab stays inside the panel for 12 presses (focus trap), > 5 links reachable, **Escape closes in one press** |
| 4. Keyboard only | first Tab reaches the skip link, the next control draws a solid 2 px outline, the audit row expands from its chevron button with Enter, the customer ledger opens with Enter |
| 5. Print | printed **from dark mode on purpose**: sidebar and fascia `display:none`, statement tables still ≥ 9 px, and the sheet is white with charcoal ink |
| 7. Dates | §3 |

### Desktop POS — `evidence/walkthrough-pos.mjs` + `evidence/run-pos-walkthrough.sh`, **16/16**

| Step | Proved |
|---|---|
| 8. Fresh install | console creates a run-scoped terminal → issues a one-time code → the POS enrols → the cashier authorises with staff code + PIN → signs in → opens a shift with a GHS 200.00 float → sells one item → **receipt number allocated** (`ACC-SPX-T02-20261024-0001`) → **the sale uploads and the outbox drains** |
| 9. Offline | relaunch with every non-`app://` request aborted: the app opens, reports the device **Offline** with no error text, the cashier signs in with the local PIN verifier, the sync badge reads **Offline**, and the catalogue is readable and still sells |
| 10. Packaged shell | `desktop/test/e2e` **38/38** in the packaged binary: title `Sceptre Drive POS`, origin `app://sceptre-drive/`, fuses block `--inspect`, **no CSP violations**, fonts served from the app origin |

### Chart layer — steps 6

`verify-charts-admin.mjs` **61/61** and `verify-charts-desktop.mjs` **60/60** at four widths
(320/768/1024/1440) × light × dark × reduced motion: four containers, no horizontal scroll,
no zero-height chart, first series `rgb(242,106,27)`, tooltip on hover **and** keyboard focus,
no perceptible motion under `prefers-reduced-motion`.

### Screenshot index (`evidence/shots/`)

| File | Step |
|---|---|
| `plan07-01-admin-light-1440.png` | 1 |
| `plan07-02-admin-dark-1440.png` | 2 |
| `plan07-03-admin-375-drawer.png` | 3 |
| `plan07-04-admin-audit-keyboard.png`, `plan07-04-admin-customer-ledger.png` | 4 |
| `plan07-05-admin-statement-print.png` | 5 |
| `plan07-07-admin-credit-ledger.png`, `plan07-07-admin-loyalty.png` | 7 |
| `plan07-08-pos-enrolment.png`, `-authorize.png`, `-pin.png`, `-shift.png`, `-tender.png`, `-receipt.png` | 8 |
| `plan07-09-pos-offline-login.png`, `plan07-09-pos-offline.png`, `plan07-09-pos-offline-cart.png` | 9 |
| `plan04-admin-*`, `plan04-pos-*` | 6 (regenerated by the re-run) |

---

## 6. Defects found by this plan, and fixed

Verification that finds nothing has usually not looked. These were found by the gates above
and fixed inside Phase 7.

1. **A self-hosted font was blocked by the CSP** (`font-src 'self'`). One `@fontsource`
   unicode-range subset (JetBrains Mono cyrillic) is under Vite's 4 KiB `assetsInlineLimit`,
   so it shipped as a `data:` URI and was refused at runtime — one console violation per boot,
   and that subset fell back to a system font. Fixed by opting font files out of inlining in
   **both** apps; the policy was not widened. Both bundles now report 0 inlined fonts.
2. **The mobile drawer needed two Escapes.** Focusing a nav link opened its tooltip, which is
   the innermost dismissable layer and consumed the first Escape. Tooltips are suppressed in
   the drawer, where the label is always visible; the icon-collapsed desktop rail keeps them.
3. **An offline terminal claimed to be synced.** The badge derived "offline" from the uploader
   only, so a till launched with no network read `Downloaded 14:02` from persisted state while
   PowerSync was disconnected. A terminal that has synced before and whose transport is down
   now reports Offline; the `lastSyncedAt` guard prevents a boot-time flash.
4. **A statement printed from dark mode came out as a slab of ink.** Dark is a screen mode, not
   a paper mode. The one token file now resets the palette inside `@media print`, so admin
   documents print as a white A4 sheet with charcoal ink whatever the screen theme. The POS is
   unaffected: its receipts never print from the DOM.

Three test defects were also fixed: the reduced-motion assertion compared the computed
duration to the string `'0s'` while the policy caps it at `0.01ms` (Chrome serialises
`1e-05s`); the packaged smoke connected over CDP before Chromium exposed a page target; and
the admin chart proof measured a cold dev server mid-paint (a 361 px layout against a 320 px
viewport, once) and now waits for the layout to settle.

---

## 7. Deviations from the plan text

Recorded here so the plan and the code do not disagree.

1. **CI job name.** The plan names `.github/workflows/checks.yml`; the repository has
   `ci.yml`. `tokens:check` was added to its existing step sequence after `brand:check`.
2. **"Exactly one `--brand:` occurrence" in the emitted CSS.** Each bundle has **two**:
   `:root` and `.dark` both declare `--brand: #f26a1b`. That is the intent of D7 ("brand
   unchanged" in dark mode) stated in the only place it can be stated, and both declarations
   come from the single package file. The gate asserts the *source* is single and that `.dark`
   redefines every literal colour, which is the property that matters; a literal count of one
   would require deleting a deliberate token.
3. **Six mutation cases became eleven.** The plan listed three ways to break the gate; the
   harness additionally proves the import rule, the dark-mode leak rule, the layout-token
   rule, the 3:1 boundary rule, the duplicate-`date-fns` rule, and that every mutation is
   restored byte-for-byte.
4. **Contrast pairs resolve through the token file** rather than from literals copied into
   the script. The first version compared literals and therefore could not fail when a token
   drifted; the mutation harness caught that and it was rewritten.
5. **Steps 8–9 run the unpackaged build.** A packaged app sets `allowLocalOrigins: false` by
   design, so it cannot reach `http://localhost:4000` — correct behaviour, recorded in
   `main.ts` as "a shipped terminal can never be pointed at a local impersonator". The
   enrolment and sale therefore run in the same `.vite` bundle through the development
   Electron binary, which keeps the `app://sceptre-drive` origin. Step 10 is the packaged
   binary.
6. **The offline leg aborts requests in the driver** instead of killing the developer's API
   process. The renderer sees the same failures (`ERR_INTERNET_DISCONNECTED`); an evidence
   script should not kill a server it does not own.
7. **Each POS run creates its own terminal.** A run opens `…-S-<day>-01` from a fresh local
   database; re-running on the same terminal reuses that number and the server rejects it as a
   duplicate. A run-scoped terminal avoids deleting shipped ledger rows to make room.
8. **The date claim is proven by formatter identity**, not by one seeded instant visible on
   all three screens — see §3 for why.

---

## 8. Carry-forwards (not Phase 7 scope)

1. **Outbox ordering (→ Phase 13).** The outbox drains `created_at ASC`, but a row that failed
   once carries a back-off, so a younger row can overtake it. In the walkthrough a `SHIFT_OPEN`
   that had backed off was overtaken by a sale, which the server then rejected as
   `SHIFT_MISSING` and dead-lettered. The till never blocked the sale — it completed locally
   and stayed for review — so the non-negotiable held, but causal ordering across a back-off
   should be enforced before payments ship.
2. **A first install opens developer diagnostics.** With no hash the POS shows the shell panel
   (app info, keychain self-test) instead of an enrolment screen; the operator navigates to
   `#login`. Phase 10 owns the till home screen.
3. **POS product tiles truncate names** at the default window width (`Bos A…`, `GI…`), and the
   stock chip competes for space. Phase 10 owns the counter layout.
4. **`STAFF_ID_PREFIX` is still `GA`** in `.env`, so staff IDs read `GA-0006`. It is not a
   brand string under D2 (the brand gate passes) and changing it rewrites identity values, so
   it is an operator decision, not a sweep.
5. **Stale processes on this host.** A pre-Phase-7 admin dev server still listens on `:3000`
   and serves a Google Fonts stylesheet; verification used `:3001` (current source). The stale
   process is not part of the tree.

---

## 9. What a human should still confirm

The automated walkthrough covers what a browser can prove. A reviewer should additionally:

1. Open the packaged app on a shop PC and confirm the installed name and `userData` folder
   read "Sceptre Drive POS" (the rename moved it, so a development terminal must re-enrol).
2. Print a real receipt on the counter printer and check the paper columns by eye.
3. Look at the four charts on a 1080p counter monitor and confirm the ramp is distinguishable
   in daylight.
4. Re-enrol one existing development terminal and confirm the flow feels right to a cashier.

---

## 10. Reproduction

```bash
# Gates and the full matrix
bash .planning/phases/07-identity-design-system/evidence/run-suites.sh

# Prove the token gate can fail
node .planning/phases/07-identity-design-system/evidence/verify-token-gate.mjs

# Walkthroughs — each starts and stops its own admin dev server
bash .planning/phases/07-identity-design-system/evidence/run-admin-walkthrough.sh
bash .planning/phases/07-identity-design-system/evidence/run-pos-walkthrough.sh

# Chart layer
ADMIN_URL=http://localhost:3001 \
  node .planning/phases/07-identity-design-system/evidence/verify-charts-admin.mjs
node .planning/phases/07-identity-design-system/evidence/verify-charts-desktop.mjs
```

Each walkthrough writes to `evidence/shots/` and exits non-zero with a named failure list, so
re-running one is the way to check a regression rather than re-reading this document.
