---
phase: 06-pos-offline-core
name: POS Offline Core
depends_on: [01-foundation, 02-catalog-pricing, 03-inventory-transfers, 04-customers-credit, 05-suppliers-payables]
requirements: [POS-01..09, POS-14, SYNC-01..08]
status: planned
created: 2026-10-22
---

# Phase 6 — POS Offline Core — Locked Context

**Goal:** A cashier enrolls a Windows terminal, logs in with a PIN, opens a shift, sells
for cash or credit with loyalty, prints a receipt, and everything reconciles after
reconnecting — without blocking a sale.

This document records the decisions taken with the operator before writing the plans.
It overrides convenience in any later plan.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Phase boundary | Phase 6 sells **cash and credit only** (single tender), earns/redeems loyalty, opens/closes shifts with cash in/out, and prints receipts. Electronic tenders, split tender, returns/refunds, POS repayments, X/Z reports, reprints-from-server, and conflict resolution UI are Phase 7/8. The receipt schema reserves E-VAT fields but prints none yet | ROADMAP Phase 6/7 split; POS-01..09/14 + SYNC-01..08 only |
| D2 | Desktop stack | `desktop/` = Electron Forge **8.0.1** + Vite **8.3** + React **19.2**, TanStack Router with `createHashHistory`, Tailwind v4 + shadcn, `@powersync/web` **2.5.0**, `@powersync/react` **2.1.0**, `@journeyapps/wa-sqlite` **2.0.8**, Electron **45** | Official current versions verified 2026-10-22; Forge 8 promoted the Vite plugin to stable and targets Vite 8 |
| D3 | Packaging | Forge 8 ESM config, Vite plugin, main/preload emitted as `.cjs` (`"main": ".vite/build/main.cjs"`), `asar: true`, fuses plugin, auto-unpack-natives, `maker-squirrel` for Windows + `maker-zip` for dev. `desktop` is a **self-contained Bun workspace** (`installConfig.hoistingLimits: "workspaces"`) so Forge sees real copies, not workspace symlinks. Windows `make` runs on `windows-latest` CI; signing/auto-update stay Phase 9 | Forge's module crawler is naive about symlinks; Bun's self-contained workspace solves it without breaking the single root lockfile |
| D4 | Electron security | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, no `webview`, typed preload API only, no remote content, `app://` custom standard protocol for the packaged renderer (workers/IndexedDB need a real origin), restrictive CSP (`script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src` API + PowerSync only), navigation/new-window/permission handlers deny by default, IPC sender validated, devtools off in production, Forge fuses on | POS-01; Electron security checklist items 2–4, 6–7, 13–14, 17–20; wa-sqlite needs WASM and blob workers |
| D5 | Secrets at rest | The long-lived device token, PowerSync encryption key, and any printer credentials are stored through Electron **async `safeStorage`** (DPAPI on Windows). The PowerSync SQLite database is encrypted with a random 32-byte key (ChaCha20 via the Web SDK). No secret is written to plaintext config, localStorage, or logs | POS-02; Electron 45 deprecates sync `safeStorage` (removed in 46); Ghana DPA + OWASP A02/A04 |
| D6 | Device identity and auth | Enrollment redemption issues a one-time device token (32 random bytes, stored hashed). The POS exchanges it at `POST /api/pos/session` for a **15-minute device access JWT** (`aud=gikautos-pos`, claims `sub=deviceId`, `branch_id`, `terminal_id`, `device_id`). PowerSync gets a separate **15-minute** JWT from `POST /api/pos/powersync/token` with the same branch/terminal claims. Every token and upload re-checks `device.status=ACTIVE`, terminal active, and branch retail. Revocation fails closed immediately on the next request. Staff sessions are never used by the POS | POS-02, SYNC-02/03; device-bound and short-lived |
| D7 | PowerSync architecture | Web SDK in the renderer. **Downloads only** through Sync Streams; the POS never writes to synced tables and therefore never uses PowerSync's CRUD upload queue. All local mutations go to **local-only tables** plus our own durable outbox and `POST /api/pos/sync/upload`. `uploadData()` is intentionally absent. Reads are watched local queries | Research: local-only tables are not queued; our domain needs one atomic server transaction per sale, not per-row CRUD |
| D8 | Synced vs local data | **Synced (read-only):** `product`, `product_barcode`, `product_price`, `stock_level`, `customer`, `credit_profile`, `loyalty_account` (+ `loyalty_lot` for expiry hints) — branch-scoped where applicable. **Local-only:** `pos_config`, `pos_session`, `staff_binding`, `sale`, `sale_line`, `sale_tender`, `shift`, `cash_movement`, `customer_draft`, `outbox`, `local_stock_delta`, `local_credit_delta`, `local_loyalty_delta`, `document_sequence`, `sync_conflict`. No staff, PIN hash, setting, sale, or audit table is synced down | SYNC-01; keeps client intent local and server truth authoritative |
| D9 | Sync Streams | One `powersync/sync-config.yaml` with `config.edition: 3` and branch-scoped streams using `auth.parameter('branch_id')`: products/barcodes/prices (active), stock levels for the branch, customers (active global identity), credit profiles for the branch, loyalty accounts + live lots (global). `auto_subscribe: true` on all of them. No prices for warehouses; terminals only exist in retail branches. PowerSync Cloud for staging/prod, a local self-hosted instance for development/CI (same config, no Cloud account required) | SYNC-01/02; PowerSync docs confirm `auth.parameter()` is signed and tamper-proof |
| D10 | Local schema rules | Never declare `id` in a PowerSync table; booleans are `column.integer`; timestamps are ISO `column.text`; only `text`/`integer`/`real`. Client IDs are UUIDv7 generated at capture. One `PowerSyncDatabase` instance per file, created at module scope. No local migrations; additive schema changes only. `disconnectAndClear()` on device reset/logout-to-enroll | PowerSync SDK rules; crash safety and future upgrades |
| D11 | Outbox contract | A user action and its outbox row commit in **one** `db.writeTransaction`. Transaction types: `SALE`, `SHIFT_OPEN`, `CASH_MOVEMENT`, `SHIFT_CLOSE`. States: `pending` → `in_flight` → `acked` \| `conflict` \| `dead_letter`. Strict FIFO per terminal. Retries use bounded exponential backoff with jitter (1s → 5m, max 10 attempts), pause on 401/403 until a fresh device JWT is obtained, and never drop a sale. The row stores `client_transaction_id`, `type`, `occurred_at`, `payload_version`, payload JSON, attempt count, last error, and server result | SYNC-04/07; research principles 1–6 |
| D12 | Upload contract | `POST /api/pos/sync/upload` body `{ batchId, deviceId, terminalId, transactions[] }`, max 50 per batch. Authentication is the device JWT; the JWT is the source of truth for branch/terminal/device. Response is **HTTP 200** with per-item `{ clientTransactionId, status: APPLIED \| REPLAYED \| REJECTED, serverId, conflicts[], resolved }`; 401/403 for auth, 5xx only for transient infrastructure. One server DB transaction per client transaction, applied in array order. Each transaction reserves a `pos_sync_transaction` row unique on `(terminal_id, client_transaction_id)`; a replay returns the stored result without re-applying | SYNC-04; PowerSync's 2xx guidance adapted to our own uploader |
| D13 | Receipt and sale numbering | Offline receipt number = `${terminal.code}-${YYYYMMDD}-${NNNN}` from a per-terminal/day local sequence (e.g. `SPX-T01-20261022-0007`). The sale keeps the client UUID as `id`, `client_transaction_id`, `receipt_number`, `occurred_at` (device clock), and `received_at` (server clock). `receipt_number` is globally unique. A global `SALE-#####` sequence is **not** introduced | Operator decision: readable, printable immediately, collision-free, sortable by terminal/date |
| D14 | Pricing and tax | All cart math lives in `@gikautos/shared` as pure functions: gross → line discounts → sale discount (pro-rata, largest remainder) → loyalty redemption (pre-tax, pro-rata) → per-line `taxBreakdown` with the product's category and the catalog tax mode. Integer pesewas only; every line satisfies `base + VAT + NHIL + GETFund = total`; cart total equals the sum of line totals. The client uses these helpers for the live cart; the server recomputes with the same helpers. The price the cashier charged is a fact and is never retroactively rewritten | CAT-07, POS-05/08; single shared implementation prevents drift |
| D15 | Price and total mismatches | The server loads the current effective branch price and recomputes the cart. A charged unit price or total that differs from the server result still applies at the **charged** amount, records `PRICE_MISMATCH` or `TOTAL_MISMATCH` (HIGH), and stores both charged and computed values in the conflict details. Reports use the charged money; the conflict is the reconciliation hook | Research principle 7 ("never reprice a pending sale") + server-authoritative audit |
| D16 | Stock offline | Local available quantity = synced `stock_level.quantity_on_hand` + Σ pending `local_stock_delta`. The UI warns at zero but never blocks. Completion writes a `SALE` stock movement server-side through `postMovements` with `allowNegative: true`; when the resulting on-hand is negative the server records `STOCK_OVERSELL` (HIGH) referencing the sale. `stock_movement_type` gains `SALE`; `reference_type` gains `SALE`; `reference_number` = receipt number. Ledger stays append-only | INV-01/02, POS-06, roadmap criterion 3; Phase 3 `postMovements` already supports `allowNegative` |
| D17 | Credit offline | The POS reads the branch `credit_profile` + pending `local_credit_delta` to show headroom. A charge within limit completes offline. Over-limit or held requires a cached **manager PIN** and a reason. On sync the server revalidates the approver (active, branch, `credit.override`) and the current limit; the sale always applies, a valid approval writes the normal override audit, and an invalid one records `CREDIT_OVER_LIMIT` or `CREDIT_HOLD` (HIGH). `postEntry` gains an internal bypass used **only** by POS replay so the ledger records the debt instead of dropping the sale | POS-07, CUS-04; server revalidation + never block |
| D18 | Loyalty offline | The POS caches the global balance, earn rate, redemption rate, and minimum. Redemption is quoted offline and applied as a pre-tax discount; earn is previewed. On sync the server recomputes earn at the current rate and posts it, and records `LOYALTY_RATE_CHANGED` (LOW) if the preview differs. Redemption points are recorded as redeemed; if the current balance cannot cover them the entry is still posted (negative balance allowed) and `LOYALTY_NEGATIVE` (HIGH) is raised. Double-spend becomes a conflict, never a dropped sale | POS-08, SYNC-05; Phase 4 `postEntry` already allows negative balances for clawback, extended for replay |
| D19 | Offline customers | Lookup searches synced customers plus local `customer_draft` rows by normalized phone digits or name. "Create customer" writes a draft with a client UUID and normalized phone, usable immediately. On sale sync the server inserts the customer (same UUID) if the phone is free, or links to the existing customer and records `DUPLICATE_CUSTOMER` (LOW) with both ids; the upload result returns `resolvedCustomerId` and the device rewrites pending references. The branch credit profile is bootstrapped lazily by the credit posting | Operator decision; POS-09; CUS-01 |
| D20 | Shifts | One open shift per terminal is enforced locally and by a partial unique index server-side. `SHIFT_OPEN` carries opening float; `CASH_MOVEMENT` carries `CASH_IN`/`CASH_OUT` with a reason; `SHIFT_CLOSE` carries counted cash and a note. Expected cash = opening float + cash sales − change − cash refunds (none yet) + cash in − cash out. Variance = counted − expected. Both client-expected and server-computed values are stored; a difference raises `SHIFT_VARIANCE_MISMATCH` (MEDIUM). No GL/cash ledger is created; Phase 7 builds X/Z reports on these rows. Closing offline is allowed | Operator decision; POS-04; Phase 7 owns Z-reports |
| D21 | Offline PIN | PINs are 4–6 digits, hashed with the existing Argon2id profile (64 MiB, t=3, p=4). A manager/admin sets a temporary PIN in the console (`pinVersion++`); the cashier changes it at the POS after the first online authorization. The device stores only a **device-bound verifier** `Argon2id(PIN, random 16-byte device salt)` and the salt in the encrypted local DB, plus a server-issued `pos_staff_binding` reference. Verification runs in the main process behind IPC; the renderer never sees a hash. Failed attempts lock the staff binding for `pos.pinLockMinutes` after `pos.pinMaxAttempts`; a cached manager PIN unlocks. Every PIN reset bumps `pinVersion`, invalidates bindings, and forces re-authorization online | POS-03; operator decision; ASVS authentication controls |
| D22 | Manager overrides | Discount caps: cashier ≤ `pos.maxCashierDiscountPercent` (default 0), manager/admin ≤ `pos.maxManagerDiscountPercent` (default 100). Exceeding the cashier cap requires a cached manager PIN and a reason code (`STAFF`, `DAMAGE`, `PROMO`, `OTHER`). Credit over-limit uses the existing `credit.override` reason codes. Every override records approver staff id, role, binding id, `pin_version`, reason, note, and `occurred_at`. The server revalidates role/permission/branch/active state; an invalid override still applies the sale and raises `OVERRIDE_INVALID` (HIGH) | POS-05/07; operator decision; auditability |
| D23 | Discount mechanics | Line discounts and one sale-level discount are integer pesewas, each `0 ≤ discount ≤ gross`; a sale discount is allocated pro-rata across lines by net, largest remainder. No negative line totals, no free-text price overrides. Discounting is reason-coded. Totals remain server-recomputed | POS-05; integer money rule |
| D24 | New settings | `pos.maxCashierDiscountPercent` (0–100, default 0), `pos.maxManagerDiscountPercent` (0–100, default 100), `pos.pinMaxAttempts` (3–10, default 5), `pos.pinLockMinutes` (1–60, default 5), `pos.clockSkewToleranceMinutes` (1–120, default 10), `pos.syncBatchSize` (1–50, default 25), `pos.receiptFooter` (≤ 200 chars), `pos.salesRequireOpenShift` (default true). All global/admin-only except none branch-scoped in this phase | Central tuning without a client release |
| D25 | New permissions | `staff.pin.reset` (admin + manager, branch-scoped) and `pos.discount` (admin + manager) for over-cap approval. Cashiers keep `[]` — they never call the admin API. Device authorization is not a role permission | Phase 1 permission model; POS-03/05 |
| D26 | Server audit | Every applied transaction writes audit rows in the same DB transaction: `pos.sale.applied`, `pos.sale.conflict`, `pos.shift.opened`, `pos.shift.closed`, `pos.cash.movement`, `pos.staff.binding.created/revoked`, `staff.pin.reset`, `device.token.issued`. Sale audit includes receipt number, terminal, cashier, totals, conflict types — never customer PII beyond the customer id | FOUND-10; OWASP A09 |
| D27 | Receipt contract | A receipt is rendered from the **local sale row** (not a server response): seller name, branch, terminal, receipt number, date/time, cashier, customer name/phone (optional), lines with qty/price/discount/tax category, subtotal, discounts, loyalty redemption, VAT/NHIL/GETFund, total, tender (cash/credit), change, points earned/redeemed, footer, and a `Reprint` marker. E-VAT QR/serial/signature fields are placeholders for Phase 8. 80 mm, 42 columns, Ghana cedi formatting | POS-06; EVAT-01 contract continuity |
| D28 | Printing | A `ReceiptPrinter` port with a main-process ESC/POS adapter (`@maxxuxx/node-printer` 1.6.11 — Windows spooler RAW + network TCP 9100, prebuilt native binaries, Electron-main support) and a `fake` adapter that writes text files for dev/CI. Printer selection and a test print live in POS settings. The cash drawer kick is sent only **after** the sale transaction commits and only for cash tenders. Print failure never rolls back or blocks a sale: the sale is committed, the receipt is marked `PRINT_FAILED`, and reprint is offered | POS-06; hardware-agnostic port; avoids the abandoned `electron-printer` driver |
| D29 | Sync status UI | Persistent header shows online/offline, pending-upload count, last successful sync time, current backoff, and an open-conflict badge. A Sync screen lists local outbox rows and conflicts; nothing blocks selling. Errors are human-readable and never include tokens or PII | POS-14, SYNC-08 |
| D30 | Conflict records | `sync_conflict` (branch, terminal, device, sale/shift, type, severity LOW/MEDIUM/HIGH, status OPEN/RESOLVED/DISMISSED, details jsonb, resolution fields). Types: `STOCK_OVERSELL`, `CREDIT_OVER_LIMIT`, `CREDIT_HOLD`, `LOYALTY_NEGATIVE`, `LOYALTY_RATE_CHANGED`, `PRICE_MISMATCH`, `TOTAL_MISMATCH`, `SHIFT_VARIANCE_MISMATCH`, `STALE_CREDENTIALS`, `OVERRIDE_INVALID`, `DUPLICATE_CUSTOMER`, `CLOCK_SKEW`, `INVALID_CUSTOMER`, `UNKNOWN_PRODUCT`. Devices read their own; Phase 8 adds the manager resolution UI/endpoint | SYNC-05; POS-14 |
| D31 | Idempotency and ordering | `pos_sync_transaction` unique `(terminal_id, client_transaction_id)` stores `{type, status, result, conflict_count, applied_at}`. A replay returns `REPLAYED` with the stored result. Transactions in a batch apply in order; one failing transaction does not stop the rest. A sale whose product no longer exists is `REJECTED`/dead-lettered (products are archived, never deleted, so this is an integrity failure, not normal operation) | SYNC-04/07; exactly-once |
| D32 | Clock skew | `occurred_at` is kept as the device fact; `received_at` is the server fact. If `|received_at − occurred_at| > pos.clockSkewToleranceMinutes`, the transaction still applies and records `CLOCK_SKEW` (LOW) with both timestamps. Shift and day boundaries use the terminal's local Africa/Accra date | Research principle 9; reporting needs both facts |
| D33 | Reconciliation | New read-only `reconcileSales(branchId?)` proves per sale: Σ line totals = sale subtotal/tax/total, Σ tenders = total, cash change arithmetic, credit tender = credit ledger charge, loyalty redemption points = loyalty entry, and one `SALE` movement per line with matching quantity/reference. Existing `reconcileBranch`, credit ledger sums, and `reconcileAccounts` stay green. A `reconcileShifts(branchId?)` proves expected/variance arithmetic. Discrepancies are returned, never auto-corrected | SYNC-06; Phase 3/4/5 reconciliation pattern |
| D34 | Module layout | Two API modules in the seven-file layout: `pos` (sale/shift/conflict schema, device-facing reads, sale/shift application, reconciliation) and `sync` (device enrollment redemption, session/token endpoints, JWKS, upload orchestration, device conflict reads). Dependencies: `sync → pos → inventory/credit/loyalty/customers/products`; `pos → org`; no cycles. Shared cart math and cart types live in `@gikautos/shared/pos.ts` | AGENTS.md; Phase 1–5 pattern |
| D35 | Demo seed | Add the Phase 6 POS settings, a demo PIN for the cashier (documented, temp), and one closed demo shift with one cash sale + one credit sale at ACC-SPX (built through the service layer so every ledger reconciles), plus a demo `sync_conflict` marked RESOLVED. All idempotent. This gives Phase 8 report development real data without a terminal | Phase 3–5 D-seed pattern; no admin sales UI until Phase 8 |
| D36 | Verification contract | Fresh-DB cycle; API/SQL walkthrough (device enrollment, token refresh, revoked device, sale replay, oversell race, credit/loyalty conflicts, shift variance, reconciliation, permission matrix); a scripted two-device last-unit race; an Electron E2E (Playwright `_electron.launch`) covering enrollment → PIN → shift → offline cart → sale → fake print → restart → reconnect → exactly-once upload → conflict badge; unsigned Windows packaging on `windows-latest`; scripts, logs, screenshots under `phases/06-pos-offline-core/evidence/` | Phase 4/5 Plan 08 pattern; roadmap criteria 1–7 |

## Refinements to approved answers (flagged for operator review)

Three mechanics were pinned during planning; intent is unchanged:

1. **Charged vs computed totals:** the server recomputes with the shared cart engine but
   stores the amount the cashier charged. A difference is a HIGH conflict, not a silent
   repricing. This preserves "never reprice a pending sale" while keeping server
   arithmetic visible for reconciliation.
2. **Loyalty redemption value drift:** the printed discount is honoured (it is part of the
   money), points are debited as recorded, and a rate change is a conflict. Earn points
   are server-computed, since points are not cash and the server owns the rate.
3. **Offline shift close with pending sales:** a close may be uploaded before a
   dead-lettered sale; the server stores both the client expected cash and its own
   computed expected cash and raises a variance conflict if they differ. Phase 7's Z-report
   must use the server value and show the difference.

## Architectural Invariants (do not violate)

- **The till never blocks.** Stock oversell, credit over-limit/hold, loyalty double-spend,
  price drift, stale PIN bindings, and clock skew all apply the sale and record a conflict.
  The only non-applied sale is an integrity failure (unknown product), which dead-letters
  for manager review.
- **One atomic local transaction per action.** Sale + lines + tenders + pending deltas +
  outbox row commit together; the app can be killed at any point without losing or
  half-writing a sale.
- **One atomic server transaction per client transaction.** Sale + lines + tenders + stock
  movements + credit entry + loyalty entries + conflicts + audit + idempotency row commit
  together.
- **Server owns money, tax, credit, loyalty, and stock projections.** The client shows
  provisional values from the shared pure functions; it never invents a ledger.
- **Integer money.** Pesewas and quantities are integers everywhere; no floats.
- **Append-only ledgers.** `stock_movement`, `credit_ledger_entry`, and
  `loyalty_ledger_entry` gain rows, never edits. Corrections are compensating entries.
- **No secrets or PII in logs.** Tokens, PINs, PIN hashes, customer phone/name, and card
  data never reach logs or audit snapshots beyond ids.
- **Fail closed on auth.** Revoked devices, inactive terminals, inactive staff, stale PIN
  versions, and wrong branches are rejected before any read or write; the outbox pauses.
- **No remote code.** The renderer only loads packaged assets over `app://`; no remote
  URLs, no `shell.openExternal` with untrusted input.

## Verified Research (see 01-RESEARCH.md)

- Electron Forge **8.0.1** (2026-09-29) is ESM-only on Node ≥ 22.13, the Vite plugin is
  stable and targets **Vite 8**, main/preload emit `.cjs`, and `create-electron-app` owns
  scaffolding. Electron **45.0.0** is current; async `safeStorage` is the supported API
  (sync removed in 46) and uses DPAPI on Windows.
- PowerSync JS Web SDK **2.5.0** / React **2.1.0** (2026-10-19): ESM-only, HTTP streaming by
  default, `db.syncStream(name, params).subscribe()`, no `id` column in schemas, local-only
  tables via `{ localOnly: true }` (not uploaded), ChaCha20 encryption at rest, worker
  assets via `powersync-web copy-assets`, WASM requires `'wasm-unsafe-eval'` and
  `worker-src blob:`.
- PowerSync Sync Streams edition 3: top-level `config.edition: 3`, `auto_subscribe`,
  `auth.parameter('branch_id')` for signed JWT claims, subscription TTL defaults to 24 h.
- PowerSync JWT requirements: `aud` = instance URL, `sub` = device id, `iat`/`exp` present
  and ≤ 24 h (60 min recommended), `kid` matching a JWKS key; asymmetric EdDSA/RS256 is
  recommended, HS256 is development-only.
- Bun workspaces support `installConfig.hoistingLimits: "workspaces"` (or root
  `workspaces.selfContained`) to materialise a complete real `node_modules` tree for a
  workspace, which is exactly what Forge's naive packaging crawler needs.
- `@maxxuxx/node-printer` 1.6.11 (2026-09-29) supports Windows spooler RAW, TCP 9100,
  Electron main process, prebuilt binaries, receipt builder, cut, and cash drawer. The
  older `node-thermal-printer` system path depends on `electron-printer` (last published
  2016) and is not viable on Electron 45.
- TanStack Router's `createHashHistory` is the documented Electron-compatible history
  (browser history breaks under `file://`); the POS uses hash history even with `app://`.
- `@node-rs/argon2` 2.2.2 (N-API, prebuilt) runs in the Electron main process; the existing
  API Argon2id profile (64 MiB, t=3, p=4) is reused for PINs.

## Bootstrap Order

> **Execution notes:** load `hono` before API plans (01, 03, 04, 05, 08), `powersync`
> before Plans 02–03 and 08, `supabase-postgres-best-practices` before schema/index work
> (01), `web-design-guidelines` / `frontend-design` / `ui-ux-pro-max` before the POS UI
> plans (02, 04, 06, 07), and `owasp-security` throughout (AGENTS.md mandate).

1. Schema, shared cart math, settings, permissions, seed (Plan 01).
2. Desktop shell, security baseline, keychain, PowerSync/Vite/Forge spike (Plan 02).
3. Device auth, PowerSync streams/config, local schema, connector (Plan 03).
4. Offline PIN/bindings, shift lifecycle (client + server), console PIN reset (Plan 04).
5. Server sale upload/application, conflicts, idempotency, reconciliation (Plan 05).
6. Selling UI — catalog, scan/search, cart, customer, credit, loyalty, discounts (Plan 06).
7. Sale completion, receipt rendering, ESC/POS printing, cash drawer (Plan 07).
8. Outbox uploader, retries, sync status, conflict surfacing (Plan 08).
9. Phase verification, evidence, state update (Plan 09).

## Open Items (carry into later phases)

- PowerSync Cloud account + staging/prod instances: development uses a local self-hosted
  instance; Cloud is required for the Phase 6 human verification against the real service.
- Physical Windows terminal, 80 mm ESC/POS printer, keyboard-wedge scanner, and cash
  drawer for the human verification pass. CI uses the fake printer and a simulated scanner.
- Windows code signing and auto-update are Phase 9; Phase 6 produces an unsigned Squirrel
  installer in CI.
- Phase 7: split tender, electronic tenders, returns/refunds, POS repayments, X/Z reports,
  reprint-from-server.
- Phase 8: conflict resolution UI/endpoint, POS oversight screens, sales/shift reports,
  E-VAT QR/serial/signature, sales CSV.
- Phase 9: signed installer, auto-update, offline drills at scale, production PowerSync
  Cloud TLS/IP allowlist.
- Ghana DPA: customer identity now lives on encrypted POS disks; Phase 9 must document
  device wipe/loss procedures and retention.
