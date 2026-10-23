---
phase: 06-pos-offline-core
plan: 09
wave: 6
title: Phase 6 verification and state update
requirements: [POS-01..09, POS-14, SYNC-01..08]
depends_on: [05, 07, 08]
status: verified 2026-10-23
created: 2026-10-22
---

# Plan 09 — Phase 6 Verification

**Goal:** Prove the phase goal on a fresh database and a real Electron build — an enrolled
terminal sells cash and credit offline, prints, survives restart, uploads exactly once,
records conflicts for oversell/credit/loyalty, reconciles every ledger, and honours
revocation — then record the evidence and update the project state.

## Task 1 — Fresh-database cycle and full suite

**Files:** none (execution); evidence noted in
`.planning/phases/06-pos-offline-core/01-VERIFICATION.md`

- Stop the API and PowerSync service; reset the **Docker dev database** with
  `docker compose down -v` → `bun run db:up` (this gives a clean `gikautos` on `:5433` with
  logical replication), migrate, `bun run db:seed`, `bun run db:seed --demo` **twice**
  (second run creates nothing), prepare `gikautos_test` for the test suites, then run
  `bun run lint`, `bun run check-types`, `bun run test`, `bun run build`.
- Run `bun run sync:init` once (replication role, `gikautos_powersync` storage database,
  `powersync` publication), start the self-hosted PowerSync service (`bun run sync:up`),
  and start the API against the same Docker database (`DATABASE_URL=…:5433/gikautos`).
  Validate the service logs (replication healthy, publication found) and confirm
  replication is receiving changes.
- Re-bootstrap the admin TOTP secret (`/tmp/opencode/admin-totp.json`) and enroll two
  simulated devices (two terminal records, two codes, two device tokens) for the race
  scenarios.
- Record the exact command list and outcomes in `01-VERIFICATION.md`.

**Verify:** every command green; `\dt` shows the Phase 6 tables; demo counts unchanged
after the second seed; the PowerSync instance reports replication healthy; the JWKS is
reachable.
**Commit:** `chore: record phase 6 verification setup` (only if incidental files change)

## Task 2 — API + SQL walkthrough

**Files:** `.planning/phases/06-pos-offline-core/evidence/walkthrough-pos.mjs`

- Fresh-DB-only Node script against `http://localhost:4000` with trusted `Origin` headers
  and direct `psql` assertions. Sections and asserts:
  1. **Enrollment/auth:** redeem a code → device token + device id; reuse → 400;
     `/api/pos/session` returns config with no hashes; `/api/pos/powersync/token` returns
     a decodable JWT with branch/terminal claims and `exp-iat ≤ 900`; wrong audience/
     tampered token → 401; warehouse/inactive terminal → 403; revoked device → 403.
  2. **PIN/binding:** manager sets a temporary PIN (branch-scoped); cashier authorizes
     online; binding token is hashed at rest; wrong PIN → 401 generic; PIN change revokes
     old bindings; stale `pinVersion` upload → conflict but sale applies; deactivated
     cashier cannot re-authorize.
  3. **Shift:** open with float; second open for the same terminal rejected; cash in/out;
     close with counted cash; assert `serverExpected` arithmetic, variance, and the
     partial unique index; client/server expected mismatch → `SHIFT_VARIANCE_MISMATCH`.
  4. **Cash sale:** upload a clean sale; assert sale/lines/tenders, `SALE` stock movements
     (`referenceNumber` = receipt), negative level, loyalty earn, no credit; replay the
     same `clientTransactionId` → `REPLAYED`, one sale, one movement set, one earn.
  5. **Credit sale:** within limit → balance increases, sale paid, no conflict; over
     limit without override → sale applied + `CREDIT_OVER_LIMIT` + ledger debt; with a
     valid manager override → normal override audit and only the intended conflict
     absent; held account → `CREDIT_HOLD`.
  6. **Loyalty:** redeem within balance → pre-tax discount, points down, lots consumed;
     redeem beyond balance → sale applied + `LOYALTY_NEGATIVE`; rate change → 
     `LOYALTY_RATE_CHANGED`; earn rate drift → conflict, server points stored.
  7. **Stock race:** two devices (two device JWTs) upload a sale for the last unit
     concurrently; both apply; one `STOCK_OVERSELL` references the second; on-hand
     `-1`; ledger = projection; no deadlock/500.
  8. **Pricing/customers/clock:** price mismatch applies the charged price + conflict;
     total mismatch stores charged totals + conflict; duplicate phone links the existing
     customer + `DUPLICATE_CUSTOMER`; invalid phone → `INVALID_CUSTOMER`; skew beyond the
     tolerance → `CLOCK_SKEW`; unknown product → `REJECTED` + dead letter, later rows
     still apply.
  9. **Reconciliation:** `reconcileSales` and `reconcileShifts` return zero divergences;
     raw SQL independently proves line sums, tender sums, credit/loyalty links, stock
     movement references, and one open shift per terminal; audit rows exist for every
     transaction type; every `sync_conflict` is linked to a sale/shift where applicable.
  10. **Scoping:** terminal A cannot read terminal B conflicts; a manager session cannot
      call device endpoints; a device JWT cannot call admin endpoints.
- Output a pass/fail summary; save raw output under `evidence/`.

**Verify:** 0 failures on a fresh database; any failure is fixed in code, never by
weakening an assert.
**Commit:** `test(api): add phase 6 pos walkthrough`

## Task 3 — Two-device last-unit race and duplicate-upload drill

**Files:** `.planning/phases/06-pos-offline-core/evidence/race-last-unit.mjs`,
`.planning/phases/06-pos-offline-core/evidence/duplicate-upload.mjs`

- Race script: seed product P with on-hand 1; build two valid sale payloads (two device
  JWTs, same product/quantity 1, different terminals/receipts); fire both uploads in
  parallel; assert both 200, both sales exist, exactly one `STOCK_OVERSELL`, on-hand = −1,
  and the movement ledger sums to −1.
- Duplicate script: send the same batch three times (sequentially and with a simulated
  timeout after the server applied), assert `APPLIED` then `REPLAYED`, one sale, one
  credit/loyalty movement, one audit row, and identical `serverId`.
- Run both on the fresh verification database after Task 2; save logs.

**Verify:** both scripts pass; no 5xx; the reconciliation stays green.
**Commit:** `test(api): prove last-unit race and duplicate upload`

## Task 4 — Electron end-to-end (offline → restart → sync)

**Files:** `.planning/phases/06-pos-offline-core/evidence/e2e-pos.mjs`,
`.planning/phases/06-pos-offline-core/evidence/screenshots/*`

- Use Playwright's `_electron.launch` with two `userData` dirs (two terminals) and the
  **fake** printer; the PowerSync self-hosted instance and API run locally.
- Scenario A (single terminal):
  1. enroll with a one-time code, store the token, connect PowerSync, wait for the first
     sync (products/stock/customers present);
  2. activate the cashier's temp PIN, change it, log in;
  3. open a shift with a float;
  4. go offline (block the API origin via `session.setOffline`/request interception);
  5. scan a barcode, search a product, add quantities, attach a customer, redeem loyalty,
     apply a manager-approved discount, complete a cash sale;
  6. assert the receipt file exists, the drawer log has one kick, the sale is local, and
     the header shows 1 pending;
  7. quit the app, relaunch offline, log in with the PIN, assert the pending sale and open
     shift survive, reprint works;
  8. reconnect, wait for the pending count to reach 0, assert the server has one sale and
     the on-hand moved; assert the UI shows Synced.
- Scenario B (conflict): over-limit credit offline → sale completes → reconnect → HIGH
  conflict visible in `/sync`.
- Scenario C (revocation): revoke the device in the admin console/API while the POS is
  online → the next upload/session fails 403, the POS pauses and shows a clear message
  with pending rows intact.
- Capture screenshots (selling screen, offline badge, receipt, sync page, conflict
  detail) into `evidence/`; save the Playwright report/log.

**Verify:** all scenarios pass; no unhandled console errors; no token/PII in logs;
screenshots readable.
**Commit:** `test(pos): add phase 6 electron end-to-end walkthrough`

## Task 5 — Packaging, security, and performance pass

**Files:** `.planning/phases/06-pos-offline-core/evidence/packaging.md`,
`.planning/phases/06-pos-offline-core/evidence/security-review.md`

- Build an unsigned Windows Squirrel installer on `windows-latest` (or document the exact
  pending run if the remote is unavailable); install it on a clean Windows VM if one is
  available; verify it launches, loads the `app://` renderer, has no Node in the
  renderer, enforces the CSP, and can enroll/sell with the fake or real printer.
- Security review against OWASP ASVS L2 / Top 10: device token entropy + hashing, JWT
  audience/expiry/kid, fail-closed revocation, PIN lockout and Argon2id, no PIN/hash/token
  in logs or audit, branch scoping on every read/write, upload size/rate limits, input
  validation, no `eval`/remote content, CSP, safeStorage, dependency audit
  (`bun pm audit` or the available equivalent) with accepted findings noted.
- Performance: measure app cold start, first sync time for 5k products/20k customers,
  search latency, sale commit latency, receipt print, and outbox drain of 100 sales;
  record numbers. The 5k/20k scale target must remain usable on a mid-range Windows PC
  (targets: search < 150 ms after sync, sale commit < 100 ms, cold start < 5 s excluding
  first sync).
- Record accepted limitations (0.0.1 unsigned, PowerSync Cloud staging/prod instances not
  provisioned yet, hardware not present) explicitly.

**Verify:** installer artifact + hash recorded; security checklist has no open HIGH;
performance numbers within targets or an explicit operator decision.
**Commit:** `chore(pos): record packaging, security, and performance evidence`

## Task 6 — Verification record and state update

**Files:** `.planning/phases/06-pos-offline-core/01-VERIFICATION.md`,
`.planning/STATE.md`, `.planning/ROADMAP.md`, `AGENTS.md` (only if the command list
changes)

- `01-VERIFICATION.md`: goal restated; the seven roadmap success criteria each mapped to
  concrete evidence (commands, walkthrough sections, SQL, screenshots, race logs);
  requirement trace (`POS-01…09`, `POS-14`, `SYNC-01…08` → implementation → proof);
  deviations with justification; residual risks (hardware, self-hosted PowerSync service
  operations/upgrades, Cloud staging/prod instances not yet provisioned, app:// worker
  quirks, 20k customer sync cost); human verification checklist (real printer/drawer/
  scanner, Cloud staging instance, Windows VM).
- `STATE.md`: progress table (Phase 6 ✅ with plan count), a "Phase 6 additions" section
  (schema, modules, sync config, desktop architecture, shared cart engine, PIN/binding,
  outbox, printing, seed story, verification numbers), decisions log entries for D1–D36 as
  implemented, open items (PowerSync staging/prod deployment target, hardware, signing,
  Phase 7/8 hand-offs), and
  **Next action: plan Phase 7 (POS Payments, Returns & Shifts)**.
- `ROADMAP.md`: mark Phase 6 complete with the verification date and the evidence path.
- Session notes: load `powersync` before sync changes; local-only tables must never be
  converted to synced writes; `applySale` is the only sale write path; `priceCart` is the
  only pricing path; outbox rows are never deleted before ack; the fake printer and how to
  run the E2E; the self-hosted PowerSync Docker commands (`sync:init`, `sync:up`,
  `sync:logs`) and how the same config maps to a Cloud/self-hosted production instance.
- Commit the phase documents and evidence together (no secrets; receipts/screenshots may
  contain demo data only).

**Verify:** STATE/ROADMAP read correctly at a glance; every success criterion cites
evidence; no lingering "planned" status for Phase 6; the next action is Phase 7.
**Commit:** `docs(phase-6): record verification and update state`

## Done When

A fresh database plus a real Electron build reproduce the whole offline POS story; the
walkthroughs, race/duplicate drills, and E2E pass with 0 failures; the seven roadmap
criteria are each backed by a command output, SQL result, or screenshot; and `.planning/`
points at Phase 7 as the next step.
