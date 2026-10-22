# Research — Phase 6: POS Offline Core

**Researched:** 2026-10-22 **Sources:** PowerSync docs (JavaScript Web SDK, Sync Streams,
parameters, custom auth, local-only tables, writing data, upload/validation semantics,
encryption, CLI, supported platforms, self-hosted Docker local development, self-hosted
instance configuration, source database setup), PowerSync JS release notes (v2.5.0,
2026-10-19), Electron Forge 8.0.1 release notes (2026-09-29), electronforge.io (Vite plugin,
CLI packaging), Electron 45 security checklist and `safeStorage` docs, TanStack Router
history docs, Bun workspaces docs, npm registry metadata, `@maxxuxx/node-printer` docs, and
the verified Phase 1–5 codebase patterns (`postMovements`, `postEntry`, settings sequences,
device/enrollment schema, shared tax engine).

## 1. PowerSync Web SDK — current shape (v2.5.0, React 2.1.0)

- **v2 is ESM-only** and the sync and database workers were merged; pre-bundled worker
  assets are copied with `powersync-web copy-assets` (output configurable). Vite still
  needs `optimizeDeps.exclude: ['@powersync/web']` and `worker.format: 'es'`; wa-sqlite is
  a peer dependency (`@journeyapps/wa-sqlite` 2.0.8).
- **HTTP streaming is the default** connection method; WebSockets are optional. Sync
  Streams are subscribed with `db.syncStream(name, params).subscribe()`;
  `subscription.waitForFirstSync()` gates readiness; TTL defaults to 24 h after
  unsubscribe. `auto_subscribe: true` streams start on connect.
- **Schema rules:** never declare `id` (the SDK creates a text primary key); only
  `column.text`, `column.integer`, `column.real`; booleans as integers, dates as ISO text.
  Schema changes apply on next open; removed columns are inaccessible; there are no
  migrations.
- **Local-only tables** are `new Table({...}, { localOnly: true })`. Their writes are
  **not** put in the upload queue. This is the key to D7: the POS writes sales, shifts,
  outbox, and pending deltas locally without PowerSync trying to upload row-level CRUD.
  Synced tables are read-only from the POS's perspective.
- **Encryption at rest:** pass `encryptionKey` to `PowerSyncDatabase`; the Web SDK uses
  ChaCha20 (SQLite3MultipleCiphers). The key is random per device and protected with
  Electron `safeStorage`.
- **VFS choices:** default `IDBBatchAtomicVFS` (IndexedDB, broad compatibility);
  `OPFSCoopSyncVFS`/`AccessHandlePoolVFS`/`OPFSWriteAheadVFS` are faster but depend on
  OPFS. For an Electron renderer served from a custom `app://` standard scheme, the
  default IndexedDB VFS is the lowest-risk start; the spike in Plan 02 compares the default
  and `OPFSCoopSyncVFS`.
- **Platform note:** PowerSync lists Electron 28+ as supported via the Web SDK, but marks
  it "TO BE VERIFIED"; the official Electron demo is Forge/Vite based. Hence the Plan 02
  spike is a phase gate, not a nice-to-have.
- **CSP:** wa-sqlite is WASM and PowerSync uses workers. The renderer CSP needs
  `script-src 'self' 'wasm-unsafe-eval'` and `worker-src 'self' blob:` (SQLite's own CSP
  guidance says `wasm-unsafe-eval` is sufficient for WASM; `unsafe-eval` is not needed).
  `connect-src` must include the API origin and the PowerSync instance origin.

## 2. Sync Streams, auth, and upload semantics

- **Edition 3 config** must begin with a top-level `config: { edition: 3 }`; streams live
  under `streams:`. `auto_subscribe` cannot be combined with subscription parameters, but
  works with auth parameters. Branch scoping uses the signed claim:
  `WHERE branch_id = auth.parameter('branch_id')`. PowerSync docs explicitly recommend
  auth parameters as the tamper-proof option; subscription parameters need an extra auth
  guard.
- **JWT requirements:** signed with a JWKS key (recommended: EdDSA/RS256) or an HS256
  shared secret (development only); `kid` must match; `aud` must equal the instance URL;
  `sub` is the user/device id; `iat`/`exp` must be present and at most 24 h apart, with
  60 min or less recommended. There is no per-token revocation, so short expiry plus
  server-side device checks on every upload is the revocation story.
- **Upload semantics:** writes to synced tables go to the CRUD queue; `uploadData()` must
  apply them synchronously, and a 4xx blocks the queue permanently. Our design avoids
  this entirely (local-only writes + custom outbox), but the same principles apply:
  validation failures return 2xx with per-item results, 5xx only for transient failures.
- **Why not use the CRUD queue:** our atomic unit is a sale (header + lines + tenders +
  stock + credit + loyalty + conflicts + audit), not independent row PUT/PATCH/DELETE
  operations. Sending a sale as CRUD would let the server see partial documents and would
  couple the contract to PowerSync's row model. The outbox + upload endpoint is the
  documented alternative ("you define how to structure your backend API").
- **Client IDs:** PowerSync recommends client-generated UUIDs for offline inserts. We use
  UUIDv7 for sale/shift/outbox/customer ids and a separate `client_transaction_id` for
  idempotency.

## 3. Electron Forge 8 and Electron 45

- **Forge 8.0.1** (2026-09-29) is a major change: ESM-only, Node ≥ 22.13 (22.17 recommended
  in the release notes), `@electron-forge/plugin-vite` is **stable** and targets **Vite 8**,
  main/preload bundles are emitted as **`.cjs`**, `publish` becomes `release`, `init` moved
  to `create-electron-app`, and config templating was removed. The desktop app must set
  `"main": ".vite/build/main.cjs"` and load the preload as
  `path.join(__dirname, 'preload.cjs')`.
- **Scaffolding:** `npx create-electron-app@latest desktop --template=vite --typescript`
  is the supported path; Forge 8's `init` asks for a package manager (npm/pnpm/yarn) and
  does not list Bun. We scaffold with the official template, then switch scripts to
  `bun x electron-forge` / `bun run` and keep one root lockfile.
- **Packaging with Bun workspaces:** Forge crawls `node_modules` and does not follow
  symlinks (documented on electronforge.io). Bun's **self-contained workspace** support
  (`installConfig.hoistingLimits: "workspaces"` in `desktop/package.json`, or
  `workspaces.selfContained` at the root) makes `desktop/node_modules` a complete tree of
  real copies, including workspace dependencies. This is the mitigation; if it regresses,
  the fallback is a `packageAfterCopy` hook that runs a production install inside the
  packaged app.
- **Electron 45 security checklist:** context isolation, sandbox, no node integration in
  renderers, no `webSecurity: false`, restrictive CSP, limit navigation and window
  creation, validate IPC senders, avoid `file://` (use a custom protocol), use fuses, keep
  Electron current. `shell.openExternal` is not used with user data. Devtools are disabled
  in production.
- **Custom protocol:** `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges:
  { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])` plus
  `protocol.handle('app', ...)` gives the packaged renderer a normal origin. This matters
  for web workers, IndexedDB/OPFS, and a strict CSP; `file://` is an opaque origin and
  worker loading is fragile.
- **`safeStorage`:** Electron 45 deprecates the synchronous API (`isEncryptionAvailable`,
  `encryptString`, `decryptString`) and removes it in 46. Use
  `isAsyncEncryptionAvailable()`, `encryptStringAsync()`, `decryptStringAsync()`; the async
  API handles key rotation (`shouldReEncrypt`) and temporary unavailability. On Windows it
  is DPAPI, tied to the OS user.
- **Fuses:** `RunAsNode: false`, `EnableNodeOptionsEnvironmentVariable: false`,
  `EnableNodeCliInspectArguments: false`, `EnableEmbeddedAsarIntegrityValidation: true`,
  `OnlyLoadAppFromAsar: true`, `EnableCookieEncryption: true`.
- **Windows installer:** `@electron-forge/maker-squirrel` is the standard unsigned
  installer for Phase 6. `maker-msix` exists but needs packaging/signing infrastructure;
  `maker-wix` needs WiX. Squirrel + `electron-squirrel-startup` is the lowest-risk path and
  leaves Phase 9 room for signing/auto-update. Building on Linux needs Wine/Mono, so the
  installer job runs on `windows-latest`.

## 4. PowerSync service: self-hosted Docker for development

- **Image and mode:** `journeyapps/powersync-service` from Docker Hub. Pin a **stable tag**
  (currently the `1.27.x` line) rather than `latest`; `latest` tracks Stable but can advance
  across majors and is development-only. Run the single-process dev stack with
  `command: ["start", "-r", "unified"]` (replication + API + storage in one container). The
  service listens on container port **8080** — map `8080:8080`, never `8080:80`.
- **Config:** mount `service.yaml` and set `POWERSYNC_CONFIG_PATH` (or use
  `POWERSYNC_CONFIG_B64` / `-c`). Top-level keys: `replication.connections` (not a root
  `connections`), `storage`, `port`, `sync_config.path`, `client_auth`, `api.tokens`,
  `healthcheck`, `system.logging`. `!env PS_…` substitution is supported (only `PS_`
  prefixed variables; `::number`/`::boolean` casts).
- **Source database (our Docker Postgres):** `wal_level=logical` (the repo `compose.yaml`
  already sets it with 10 slots), a `powersync_role` with `REPLICATION BYPASSRLS LOGIN` and
  `SELECT` on replicated tables, and a publication named `powersync`. For local Postgres,
  `sslmode: disable` must be a **separate YAML key** — the pgwire replication client does
  not honour `sslmode` in the URI and fails with "postgres does not support ssl".
- **Bucket storage:** use **Postgres** rather than MongoDB to avoid a second database.
  Postgres 14+ may host the source and bucket storage on the same server (ours is 17);
  create a `powersync_storage_user` and let the service create the `powersync` schema (or
  create it manually and grant usage). `storage: { type: postgresql, uri, sslmode: disable }`.
  Postgres storage does not support storage version 4; the default is version 2, which is
  fine for our scale.
- **Client auth:** point `client_auth.jwks_uri` at the API's `/.well-known/jwks.json`. In
  Docker, the API runs on the host, so use `http://host.docker.internal:4000/...` and add
  `extra_hosts: ["host.docker.internal:host-gateway"]` on Linux. `audience` must include the
  instance URL clients use (`http://localhost:8080` for dev). `api.tokens` holds
  `PS_ADMIN_TOKEN` for CLI access.
- **Sync config:** `sync_config.path: sync-config.yaml` with the file mounted next to
  `service.yaml`. The CLI (`powersync validate`, `powersync docker start`) can scaffold and
  manage the stack, but a committed compose file is preferable so `bun run sync:up` is
  reproducible in CI. `powersync deploy`/Cloud commands are not part of the dev loop.
- **Health:** enable `healthcheck.probes.use_http: true` and gate the E2E on the health
  endpoint; also confirm replication is healthy before running sync assertions.
- **Production note:** the same `sync-config.yaml` and `service.yaml` shape apply to a VPS
  self-hosted deployment or PowerSync Cloud. `.planning/PROJECT.md` records self-hosted
  Docker as the development default and leaves the staging/production target open for
  Phase 9 (operator decision).

## 5. Bun workspace packaging

- Bun 1.3.14 is installed. Bun's `installConfig.hoistingLimits: "workspaces"` (the Yarn
  key) or root `workspaces.selfContained: ["desktop"]` makes that workspace a hoisting
  barrier: dependencies are materialised as real copies under `desktop/node_modules`, not
  symlinks into `node_modules/.bun`. This directly addresses Forge's crawler.
- The setting is read from `package.json` on every install (including
  `--frozen-lockfile`), so CI and local installs behave the same; the lockfile is
  unchanged.
- `electron` and `@electron-forge/*` remain devDependencies of `desktop`; the packaged app
  only needs runtime dependencies in `dependencies` (PowerSync, React, printer transport,
  etc.). Native modules (`@maxxuxx/node-printer`) must be in `dependencies` and unpacked
  from asar (`plugin-auto-unpack-natives`).

## 6. Receipt printing and cash drawer

- **Requirement:** 80 mm ESC/POS, silent (no OS dialog), cash drawer kick on cash tender,
  reprint, works offline.
- **Candidates checked (npm, 2026-10-22):**
  - `node-thermal-printer` 4.6.1 (updated 2026-08-18) — mature command builder, but its
    system-printer path requires a driver module; the documented `electron-printer` driver
    was last published in **2016** and is not viable on Electron 45. Network (TCP 9100) and
    serial work, but most Ghanaian USB 80 mm printers are installed as Windows spooler
    queues, not network printers.
  - `@maxxuxx/node-printer` 1.6.11 (2026-09-29) — unified ESC/POS transports including
    **Windows spooler RAW** with bundled prebuilds, CUPS, serial, network; explicitly
    supports the Electron main process; receipt builder (text, rows, QR, barcode, image,
    raw, cut) and printer status/paper width. This is the Phase 6 adapter target.
  - `electron-pos-printer` 1.4.0 — wraps PowerShell/Windows printing and supports a cash
    drawer, but it is a higher-level HTML-to-print wrapper; less control over raw ESC/POS
    and a smaller API surface.
- **Decision (D28):** define a `ReceiptPrinter` port. Production adapter =
  `@maxxuxx/node-printer` in the main process, selected by printer name (winspool) or
  `tcp://host:9100`; dev/CI adapter = `fake` writing receipt text to a file. The renderer
  never imports native modules; preload exposes `printer.list`, `printer.print`,
  `printer.openDrawer`, `printer.test`. Print failure is recorded on the local sale and
  never rolls it back.
- **Cash drawer:** ESC/POS `ESC p` pulse via the printer; sent after commit for cash
  tenders. If the printer is unavailable, the sale still completes and the UI prompts to
  open the drawer manually / retry the kick.
- **Hardware caveat:** no physical device in this environment. Plan 09's human checklist
  covers a real Windows terminal, printer, scanner, and drawer; automated verification
  asserts the byte stream/commands through the fake adapter and a transport spy.

## 7. Offline PIN and Electron crypto

- `@node-rs/argon2` 2.2.2 is an N-API package with prebuilt binaries and runs in the
  Electron main process (no Electron rebuild needed for N-API). The API's existing
  Argon2id profile (`memoryCost 65536`, `timeCost 3`, `parallelism 4`, `outputLen 32`) is
  reused for staff PINs so there is one hashing policy.
- Hashing/verification must run in the **main** process; exposing Argon2 or a hash to the
  renderer defeats the purpose of context isolation. Preload exposes only
  `pin.hash(pin, salt)` / `pin.verify(hash, pin)`, with input validation and no logging.
- The **device-bound verifier** is `Argon2id(pin, deviceSalt)` computed on the device, not
  the server PIN hash. The server hash is only used for the first online authorization and
  console resets. This means a stolen local database does not yield a verifier that can be
  replayed on another device, and a stolen server hash does not unlock a terminal.
- `pinVersion` on the user row is the invalidation lever: console reset, cashier PIN
  change, staff deactivation, and role/branch changes bump or invalidate bindings. Uploads
  carry the binding id and `pin_version`; mismatches apply the sale but raise
  `STALE_CREDENTIALS` (and pause future sales for that binding until re-authorization).
- Lockout is local per binding (`pos.pinMaxAttempts`, `pos.pinLockMinutes`) with a manager
  PIN unlock. The server authorize endpoint is rate-limited independently.
- OWASP ASVS L2: PINs are a knowledge factor, not a password replacement; the device is
  the possession factor. 4–6 digits are acceptable only with device binding + lockout +
  rate limiting, which is exactly the design.

## 8. Shared cart math (client/server parity)

- The existing `@gikautos/shared` tax engine is integer-only and guarantees
  `base + VAT + NHIL + GETFund = total` per line, with the rounding residual in VAT for
  inclusive prices. Phase 6 must add a pure cart function so the POS preview and the
  server recomputation are the *same code*, not two implementations:
  - `allocateProportionally(amountMinor, weights[])` — integer largest-remainder
    allocation that always sums exactly to `amountMinor` (weights can be zero; handle
    total weight 0).
  - `priceCart(lines, { taxMode, saleDiscountMinor, loyaltyDiscountMinor })` — computes
    per-line net after line discounts, allocates the sale discount by net, allocates the
    loyalty discount by remaining net (clamped at zero), computes per-line tax with
    `taxBreakdown`, and sums. Returns `{ lines, subtotal, discountTotal, loyaltyTotal,
    taxTotal, total }` plus per-line breakdowns.
  - `resolveEffectivePrice` already exists for branch overrides; the server and client
    both use it.
- Edge cases to test: zero-priced lines, 100% discounts, loyalty discount larger than the
  cart (clamp), odd pesewas across three lines, zero-rated/exempt mixed carts, quantity
  > 1, and a one-pesewa allocation residual. The invariant is
  `Σ line.total === cart.total` and each line's components sum exactly.

## 9. Local schema and pending deltas

- Synced tables cannot be written locally without entering PowerSync's CRUD queue, so the
  POS never writes `stock_level`, `credit_profile`, or `loyalty_account`. Instead:
  - `local_stock_delta(sale_id, product_id, quantity, acked_at)` — pending sale quantities.
    Available = `stock_level.quantity_on_hand + SUM(pending quantity)` (delta is negative
    for a sale).
  - `local_credit_delta(sale_id, customer_id, amount_minor, acked_at)` — pending charges
    for the cached limit/balance view.
  - `local_loyalty_delta(sale_id, customer_id, points_delta, acked_at)` — pending earn and
    redeem for the cached balance/expiry view.
  - On an `APPLIED`/`REPLAYED` result, mark the deltas `acked_at`; keep the rows for audit
    until the corresponding synced projection catches up. Exclude `acked_at IS NOT NULL`
    from available calculations.
- `customer_draft` is local-only: `id` (UUIDv7), normalized phone, name, created_at,
  linked_customer_id (set from the upload result), acked_at. Search unions
  `customer` and `customer_draft WHERE acked_at IS NULL`.
- `pos_config` is local-only and written from the device session response: branch/terminal
  identity, tax mode, loyalty settings, discount caps, PIN policy, receipt footer, sync
  batch size, server time offset. It is refreshed on every session/token response.
- `document_sequence` is local-only: `(terminal_id, scope, day, last_value)` for receipt
  and shift numbers; allocate inside the sale transaction with `UPDATE ... RETURNING`.

## 10. Sync/upload design consequences

- Because the POS uses local-only tables, PowerSync never calls `uploadData`. The connector
  implements only `fetchCredentials`; the PowerSync token endpoint is the single auth
  dependency. A missing `uploadData` is valid for download-only sync.
- The custom uploader must own retry/backoff, exactly-once idempotency, and ordering. It
  sends strict FIFO batches, marks `in_flight` before the HTTP call, and uses the server's
  per-item result to move rows to `acked`/`conflict`/`dead_letter`. A crash between
  `in_flight` and the response is safe because the server replay returns `REPLAYED` with
  the stored result.
- Batch size comes from `pos.syncBatchSize`; the server caps at 50. A batch is one HTTP
  request; each transaction is one server DB transaction. A slow/failed item does not
  roll back its neighbours.
- The server stores `pos_sync_transaction.result` jsonb so a replay after a lost response
  returns the original ids/conflicts instead of re-running side effects.

## 11. What this means for the plans

- The riskiest unknowns are (a) PowerSync Web SDK + WASM workers inside an Electron 45
  `app://` renderer, and (b) Forge 8 packaging of a Bun workspace with native printer
  modules. Both are front-loaded: Plan 02 is a spike that must pass before the UI is built.
- The second riskiest area is the sale application transaction: it touches inventory,
  credit, loyalty, audit, conflicts, and idempotency. Plan 05 isolates it behind one
  `applySale` service and proves it with HTTP/SQL walkthroughs and concurrency tests.
- The POS UI is intentionally split from sale application and printing so each can be
  verified independently: UI/cart math (Plan 06), receipt/printing (Plan 07), uploader
  (Plan 08).
- Existing seams are reusable: `postMovements` with `allowNegative`, `postEntry` for credit
  and loyalty with `occurredAt` + idempotency keys, `allocateFromSequence` (not used for
  POS receipts, but for staff/PIN flows if needed), `writeAudit`, `resolveBranchFilter`,
  `requirePermission`, and the shared tax engine.
