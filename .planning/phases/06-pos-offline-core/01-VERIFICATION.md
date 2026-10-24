# Phase 6 — Verification record

**Phase:** 06-pos-offline-core
**Verified:** 2026-10-23
**Environment:** Linux x64 dev host, Node 24.18, Bun 1.3.14, Electron 45.0.0,
PostgreSQL 18 (Docker, host port 5434), self-hosted PowerSync Service `journeysapps/
powersync-service:1.27.1` (unified mode) on :8080, API on :4000 (`Africa/Accra`,
tax-inclusive).

**Goal (restated):** an enrolled terminal sells cash and credit offline, prints, survives
a restart, uploads exactly once, records conflicts for oversell/credit/loyalty, reconciles
every ledger, and honours revocation — without ever blocking a sale.

## Fresh-database cycle

```bash
docker compose --profile sync down -v
bun run db:up                                   # clean gikautos on :5434
DATABASE_URL=postgresql://gikautos:gikautos@localhost:5434/gikautos bun run db:migrate
DATABASE_URL=… bun run db:seed                  # admin
DATABASE_URL=… bun run db:seed --demo           # demo data
DATABASE_URL=… bun run db:seed --demo           # second run: "already present"
docker compose exec -T postgres psql -U gikautos -d gikautos -c 'CREATE DATABASE gikautos_test'
DATABASE_URL=…:5434/gikautos_test bun run db:migrate
bun run sync:init                               # role, storage DB, publication
DATABASE_URL=… bun run dev:api                  # (started with :5434)
bun run sync:up                                 # JWKS inlined, container restarted
```

Observed: all 10 migrations apply cleanly; the demo seed creates 12 products, 3 customers,
2 sales, 1 closed shift, 1 resolved conflict; the second demo seed is a no-op. PowerSync
reports every one of the 8 synced tables replicated (`product 12`, `barcode 14`,
`stock_level 24`, `customer 3`, `credit_profile 1`, `loyalty_account 3`, `loyalty_lot 1`,
`product_price 1`) and the replication stream activates at a fresh LSN.

## Suites and evidence scripts

| Evidence | Command | Result |
|---|---|---|
| Shared unit tests | `bun run --filter shared test` | **73/73** |
| API unit + integration tests | `bun run --filter api test` (TEST_DATABASE_URL :5434) | **354/354** |
| Desktop unit tests | `bun run --filter desktop test` | **339/339** |
| Lint / types | `bun run lint`, `bun run check-types` | clean (5/5 workspaces type-check) |
| API + SQL walkthrough | `node …/walkthrough-pos.mjs` | **162/162** |
| Last-unit race | `node …/race-last-unit.mjs` | **18/18** |
| Duplicate-upload drill | `node …/duplicate-upload.mjs` | **24/24** |
| Electron E2E (offline → restart → sync, conflict, revocation) | `node …/e2e-pos.mjs` | **51/51** |
| Packaged security shell | `bun run --filter desktop test:e2e` | **38/38** |
| Packaged print/drawer | `node desktop/test/e2e/print-smoke.mjs` | **21/21** |
| Packaging / performance | `packaging.md`, `performance.json`, `perf-pos.mjs` | recorded |

Raw logs are in `evidence/logs/`; screenshots in `evidence/screenshots/`; receipts in
`evidence/receipts-e2e/`; package hashes in `evidence/logs/package-sha256.txt`.

## Success criteria → evidence

### 1. With the network unplugged, a cashier completes cash sales, prints receipts, and stock deducts locally

- `e2e-pos.mjs` A3: the terminal goes offline, adds a product from the synced catalogue,
  attaches a customer, redeems 100 loyalty points, applies a 10% line discount approved by
  a manager PIN, completes a cash sale, renders the receipt, prints it (fake ESC/POS), and
  kicks the drawer exactly once.
- The local `stock_level` projection and `local_stock_delta` are written in the same local
  transaction as the sale and outbox row; the sync screen shows the sale pending.
- `walkthrough-pos.mjs` §4 proves the server-side equivalent: one `SALE` movement with the
  receipt number and a projection that matches the ledger.

### 2. On reconnect, queued sales upload exactly once; on-hand equals the ledger; no duplicate sale

- `duplicate-upload.mjs` **24/24**: APPLIED → REPLAYED → REPLAYED under a new batch id;
  one sale, line, tender, stock movement, credit charge, loyalty earn, audit row, and
  `pos_sync_transaction`; the same `serverId` every time; reconciliation green.
- `walkthrough-pos.mjs` §4: manual replay returns REPLAYED with the same id and creates no
  second row.
- `e2e-pos.mjs` A4: after the offline relaunch and reconnect the outbox drains to 0, the
  server holds exactly one copy, the stock movement references the receipt, and stock moved
  by the sold quantity.
- The fresh-DB reconciliation reports no divergence for every cash, credit, and loyalty
  sale (only the deliberately drifted header in §8 is reported).

### 3. Two terminals sell the last unit offline; both apply; a reconciliation conflict is recorded

- `race-last-unit.mjs` **18/18**: one unit on hand, two device JWTs, parallel uploads,
  both HTTP 200 and APPLIED, exactly one `STOCK_OVERSELL` (HIGH) linked to the losing sale,
  on-hand `-1`, ledger `-1`, reconciliation green.

### 4. A credit sale within the cached limit completes offline; over-limit requires a manager PIN; the server revalidates and flags conflicts

- `walkthrough-pos.mjs` §5: within-limit charge (balance moves, no conflict); over-limit
  without approval (sale applies, debt recorded, `CREDIT_OVER_LIMIT`); valid manager proof
  (no `CREDIT_OVER_LIMIT`, `credit.override` audit and entry approver); forged proof
  (`OVERRIDE_INVALID` + `CREDIT_OVER_LIMIT`, sale still applies); held account
  (`CREDIT_HOLD`).
- `e2e-pos.mjs` B: an over-limit credit sale completed offline with "continue without
  approval"; after reconnect the till shows the HIGH conflict and the server stores
  `CREDIT_OVER_LIMIT` (HIGH) against the sale.
- Manager approval is proven on the terminal in A3 (discount) and in the API walkthrough
  (credit); the server revalidates every proof.

### 5. Loyalty earn/redeem works offline within the cached balance; double-spend is flagged

- `e2e-pos.mjs` A3: 100 points redeemed offline; the pre-tax discount is applied to the
  cart and the printed total.
- `walkthrough-pos.mjs` §6: one REDEEM entry, FEFO lot consumption, balance drop; a
  redemption beyond balance applies with `LOYALTY_NEGATIVE`; a rate change and an
  earn-preview drift apply with `LOYALTY_RATE_CHANGED`; the server's earned points are
  stored.

### 6. PIN login works offline after enrollment; revoked or disabled staff are rejected on sync

- `e2e-pos.mjs` A1/A4: enrollment, manager and cashier PIN changes, then a **relaunch with
  the API stopped** — the PIN logs in offline and the open shift and pending sale survive.
- `walkthrough-pos.mjs` §2: binding hashed at rest, wrong PIN is a generic 401, PIN change
  revokes the previous binding, a stale `pinVersion` upload applies but raises
  `STALE_CREDENTIALS`, a deactivated cashier cannot authorize, reactivation bumps the
  version.
- `e2e-pos.mjs` C: revoking the device makes the next sync fail 403, the POS pauses with
  "This terminal was revoked — enrol it again", the pending sale is kept, and the revoked
  upload never reaches the server.
- Revoked device and inactive terminal/branch are refused on session and PowerSync token
  minting (`walkthrough-pos.mjs` §1).

### 7. Killing and restarting the app preserves pending sales and the outbox

- `e2e-pos.mjs` A4: the app is quit; the API is stopped; the app relaunches with the same
  profile; PIN login works; the open shift is shown; the sale is listed under Today's sales;
  the outbox still holds the receipt; an offline reprint is marked `*** REPRINT ***`
  without a second drawer kick; after the API returns, the outbox drains and the header
  reports Synced.
- The device token is now persisted in the keychain at enrollment (finding fixed during
  this verification).

## Requirement trace

| Requirement | Implementation | Proof |
|---|---|---|
| POS-01 | Forge 8 + Vite 8 + Electron 45 shell, `app://` protocol, CSP header + meta, fuses, typed preload | shell E2E 38/38; packaging.md. **Windows installer pending** (workflow_dispatch, no remote). |
| POS-02 | One-time enrollment (`terminal_enrollment`), HMAC-hashed token, keychain storage, revocation | walkthrough §1/§9; E2E A1/A4/C |
| POS-03 | Argon2id verifier in the main process, device pepper, per-binding lockout, manager unlock | walkthrough §2; desktop unit tests; E2E A1 |
| POS-04 | Local `shift`/`cash_movement` + outbox, server expected cash, variance conflict | walkthrough §3; E2E A2 |
| POS-05 | Product search/scan, cart reducer, permissioned discounts, shared `priceCart` per line | E2E A3 (search + discount); selling contract 32/32; shared 73/73 |
| POS-06 | Offline cash sale, 42-column ESC/POS receipt, drawer kick | E2E A3; print smoke 21/21 |
| POS-07 | Cached headroom, manager proof, server revalidation, conflicts | walkthrough §5; E2E B |
| POS-08 | Points quote off the tax-exclusive base, pre-tax discount, FEFO consumption | E2E A3; walkthrough §6 |
| POS-09 | Offline `customer_draft`, phone normalization, duplicate linking, lazy credit profile | walkthrough §7; E2E A3 |
| POS-14 | Three-column touch UI, shortcuts, badge with pending/last sync, sync screen | E2E A3/A4; selling UI smoke |
| SYNC-01 | Local schema mirrors 8 synced tables; 15+ local-only tables; PowerSync adds columns | E2E first sync 5k/20k; sync smoke 18/18 (Plan 03) |
| SYNC-02 | Edition 3 Sync Streams; branch/terminal claims | walkthrough §1; service logs |
| SYNC-03 | `POST /api/pos/powersync/token`, device JWT only, `aud=POWERSYNC_URL` | walkthrough §1 |
| SYNC-04 | Ordered batches, one transaction per client transaction, idempotent reservation, 200 per-item results | duplicate 24/24; walkthrough §4/§7 |
| SYNC-05 | Oversell, credit over-limit/hold, loyalty negative, price/total drift, stale credentials, override invalid, clock skew, duplicate/invalid customer, unknown product | walkthrough §5–§8; race 18/18; E2E B |
| SYNC-06 | `reconcileSales`/`reconcileShifts` + `/api/pos/reconciliation` | walkthrough §8 (and the two reconciliation fixes found here) |
| SYNC-07 | Sale + outbox in one local transaction; restart/crash safe; backoff; dead letter only for rejection/corruption | outbox recovery 41/41 (Plan 08); E2E A4 |
| SYNC-08 | Sync badge, sync screen, outbox log, conflicts, dead-letter retry; API reads for the console | E2E A4/B/C. **Admin conflict-resolution UI deferred to Phase 8** (the requirement itself defers manager resolution there). |

## Performance (5 000 products, 20 000 customers)

Measured on the production renderer with the fake printer (`performance.json`):

| Metric | Measured | Target | Verdict |
|---|---|---|---|
| Cold start (launch → enrolment screen) | **1.66 s** | < 5 s excluding first sync | ✅ |
| First full sync (5 018 products, 20 006 customers) | **19.9–24.1 s** | — (recorded) | ✅ practical |
| Search (type → results, includes 150 ms debounce) | 338 / 18 / 369 ms | < 150 ms after sync | ⚠️ ~190–220 ms query+render on this host |
| Sale commit (complete click → receipt screen) | 125 ms cold, 132 ms warm | < 100 ms commit | ⚠️ includes navigation/print orchestration |
| Receipt print (fake adapter) | 40 ms | — | ✅ |
| Outbox drain, 2 rows | 10 ms | — | ✅ |
| Server upload, 100 transactions (4 × 25) | 4.9 s (~49 ms/tx) | — | ✅ |

The two ⚠️ rows are UI-perceived timings, not just the local transaction; the local write
is a subset. They are within normal counter-terminal expectations, but they do miss the
strict targets in this verification plan. **Operator decision requested:** accept as-is for
v1 and tune search/commit in Phase 7 (SQLite index/query work and deferring print
orchestration), or block Phase 6 on hitting the targets. No sale is ever blocked by either.

## Deviations

1. **Windows installer not built.** No git remote exists, so the `windows-latest` job cannot
   run. The job is written and the Linux package is verified; the installation and hardware
   pass is on the human checklist.
2. **The packaged binary cannot talk to a local API** (deliberate: a shipped terminal must
   never be pointed at a local impersonator). The Electron E2E therefore drives the
   unpackaged production build — the same renderer, main bundle, CSP, and IPC. Packaged
   startup/security and printing are verified separately (38/38, 21/21).
3. **`zip` is absent on this host**, so Forge's ZIP maker failed at the archive step; the
   package was archived with Python for hashing. CI/Windows have `zip`.
4. **Deliberate header drift is reported by reconciliation by design.** The walkthrough
   asserts the clean set is empty and that only the `TOTAL_MISMATCH` receipt is flagged
   (`HEADER_TOTALS`), rather than weakening the reconciliation.
5. **Admin conflict-resolution UI** (SYNC-08 second half) is Phase 8 scope per the roadmap;
   the API reads and the POS UI are complete.
6. **Two reconciliation bugs were found and fixed** during verification: credit-only
   tenders were flagged as `TENDER_TOTALS` divergences, and the stock-movement side was not
   branch-scoped. Both have regression tests.

## Residual risks

- Hardware (physical ESC/POS printer, drawer, scanner, Windows terminal) not present.
- Self-hosted PowerSync service version upgrades and Cloud staging/production instances are
  Phase 9 setup gates.
- The `basic_text` Linux keychain is degraded; production Windows uses DPAPI (`os`).
- 20k customer sync is ~20 s on first sync; acceptable for installation/day-one, and
  PowerSync streams are incremental afterwards.
- Search/commit timings above are host-specific and flagged for Phase 7 tuning.

## Human verification checklist

- [ ] Build/run the Windows Squirrel installer on a clean Windows VM (launch, enrol, sell,
      print; SmartScreen warning expected while unsigned).
- [ ] Print on a real ESC/POS printer (42 columns), open the drawer on a cash tender, scan a
      barcode with a keyboard-wedge scanner.
- [ ] Provision PowerSync Cloud staging/production instances and point a staging build at
      them.
- [ ] Confirm the operator decision on search/commit performance above.
- [ ] Visual pass on the POS selling, tender, receipt, and sync screens on a touchscreen.

## Verdict

The phase goal is met on a fresh database and a real Electron build: **every evidence suite
passed with zero failures** (162 + 18 + 24 + 51 checks), the full test suites are green
(shared 73, API 354, desktop 339), the packaged shell and printer smokes pass (38 + 21), and
the seven success criteria are each backed by a command output, SQL assertion, screenshot,
or receipt. Remaining items are hardware, signing, Cloud provisioning, and the explicit
performance decision — none of them block the till.

---

## Post-verification follow-up (2026-10-24)

Two authentication defects were reported after the phase record and fixed:

1. **Backup codes were rejected.** Better Auth issues mixed-case backup codes and compares
   them with an exact string match; the console uppercased what the operator typed. The
   console now preserves the case, accepts a pasted code without the dash, and disables
   autocapitalisation. Backup codes are also hidden during setup: they recover a future
   sign-in and cannot finish enrolment (only the authenticator code can). Evidence:
   `verify-two-factor-backup.mjs` **9/9** (throwaway admin → TOTP → browser sign-in with the
   exact mixed-case code), plus API regression tests (mixed case accepted, uppercased
   rejected).
2. **Forced TOTP is now a toggle.** `auth.requireTwoFactor` (default **off**) lives in
   Settings > Security; the console guards read the public `GET /api/auth/policy`. Turning
   it on requires the acting administrator to have enrolled, so the toggle cannot lock its
   owner out. Evidence: `verify-two-factor-policy.mjs` **9/9** and screenshots 11–15.
   Break-glass for a lost authenticator **and** backup codes:
   `bun run --filter api two-factor:reset -- --email <address>` (audited).

Suites after the fix: API **360/360**, shared 73/73, desktop 339/339; lint and types clean.
The requirement is **off** as of 2026-10-24, as requested.
