---
phase: 06-pos-offline-core
plan: 03
wave: 2
title: Device auth, PowerSync sync config, local schema, and connector
requirements: [POS-02, POS-14, SYNC-01, SYNC-02, SYNC-03, SYNC-08]
depends_on: [01, 02]
status: planned
created: 2026-10-22
---

# Plan 03 — Device Auth, Sync Config, Local Schema, Connector

**Goal:** A terminal redeems an enrollment code for a device token, exchanges it for a
short-lived device JWT, and receives a PowerSync JWT bound to its branch and terminal.
The `powersync/sync-config.yaml` stream set is deployed/validated; the renderer defines the
synced and local-only schema, connects without an `uploadData` implementation, and shows
live sync status.

## Task 1 — POS JWT keys, env, and JWKS

**Files:** `api/src/config/env.ts`, `.env.example`, `api/scripts/generate-pos-keys.ts`,
`api/package.json`, `api/src/modules/sync/sync.jwt.ts`,
`api/src/routes/jwks.ts`, `api/src/app.ts`

- Add `jose` (latest compatible) to the API. Env:
  `POWERSYNC_URL` (instance URL, optional in dev), `POWERSYNC_AUDIENCE` (optional; defaults
  to `POWERSYNC_URL`), `POS_JWT_PRIVATE_KEY` (base64url PKCS8 Ed25519),
  `POS_JWT_KEY_ID` (default `pos-v1`), `POS_JWT_TTL_SECONDS` (default 900).
- In production, missing key/URL fails boot with a clear message. In development/test, if
  the key is absent, generate an ephemeral Ed25519 key at boot, log a single warning (no
  key material), and mark tokens as dev-only. `generate-pos-keys.ts` prints a base64url
  private key and JWKS public key for `.env`.
- `sync.jwt.ts`: `signDeviceJwt({ deviceId, terminalId, branchId }, ttl)` with
  `aud='gikautos-pos'`, `sub=deviceId`, `typ='device'`; `signPowersyncJwt(...)` with
  `aud=POWERSYNC_AUDIENCE`, `sub=deviceId`, claims `branch_id`, `terminal_id`,
  `device_id`, `iat/exp`, header `kid`. `verifyDeviceJwt` returns the typed claims or
  throws `AppError(401, 'DEVICE_TOKEN_INVALID')`.
- `GET /.well-known/jwks.json` returns the public JWK (no private material); wire in
  `app.ts` before auth middleware (public).
- Tests: sign/verify round-trip; wrong `aud`, expired, tampered signature reject; JWKS has
  one key with the configured `kid` and no `d`.

**Verify:** `bun run --filter api test`; `curl /api/.well-known/jwks.json` shape; production
boot rejects missing key.
**Commit:** `feat(api): add pos jwt signing and jwks endpoint`

## Task 2 — Enrollment redemption and device token

**Files:** `api/src/modules/org/enrollment.service.ts`,
`api/src/modules/org/enrollment.repository.ts`,
`api/src/modules/org/enrollment.controller.ts`,
`api/src/modules/org/enrollment.validation.ts`,
`api/src/modules/org/terminals.repository.ts`, `api/src/modules/org/enrollment.test.ts`

- Extend `redeemEnrollment(code)` to accept an optional `fingerprint` (machine id hash) and
  return `{ deviceId, deviceToken, terminalId, terminalCode, branchId, branchName,
  branchCode }` once. Generate a 32-byte random token, store
  `hashDeviceToken(token)` (HMAC-SHA256 with `BETTER_AUTH_SECRET`) in `device.tokenHash`,
  set `fingerprint` (default `'unknown'`), `enrolledAt`, `status ACTIVE`; mark the
  enrollment used; audit `device.token.issued` (no token in the audit payload).
- Reject if the terminal is inactive, the branch is a warehouse, or the code is
  used/expired. One device per redemption. The controller stops returning 501.
- Add `findActiveDeviceByTokenHash` and `touchDeviceLastSeen` repository functions.
- Tests: redeem once → 201 with token; second redeem → 400; expired code → 400; warehouse
  terminal → 409; token hash never appears in the response/audit; a revoked device cannot
  redeem again.

**Verify:** HTTP test plus SQL check `device.token_hash <> token`.
**Commit:** `feat(api): issue device tokens on enrollment redemption`

## Task 3 — Device session and PowerSync token endpoints

**Files:** `api/src/modules/sync/sync.schema.ts` (empty marker or re-export),
`api/src/modules/sync/sync.service.ts`, `api/src/modules/sync/sync.repository.ts`,
`api/src/modules/sync/sync.controller.ts`, `api/src/modules/sync/sync.validation.ts`,
`api/src/modules/sync/sync.routes.ts`, `api/src/modules/sync/sync.test.ts`,
`api/src/http/device-auth.ts`, `api/src/app.ts`

- `deviceAuth` middleware: read `Authorization: Bearer <jwt>`, verify with
  `verifyDeviceJwt`, then load the device + terminal + branch and fail closed unless
  `device.status = ACTIVE`, `terminal.isActive`, `branch.type = RETAIL`,
  `branch.isActive`. Attach `{ deviceId, terminalId, branchId }` to context and update
  `device.lastSeenAt` (throttled, e.g. at most once a minute). Errors: 401 for bad tokens,
  403 for revoked/inactive.
- `POST /api/pos/session` (Bearer device token, not JWT): rate-limited; hash and look up the
  device; return `{ deviceId, terminal: { id, code, name }, branch: { id, code, name },
  accessToken, expiresAt, config }`. `config` is the D-snapshot: tax mode
  (`catalog.taxMode`), loyalty settings, `pos.*` settings, receipt footer, server time
  (ISO) and `serverTimeZone: 'Africa/Accra'`. No PIN hashes, staff lists, or secrets.
- `POST /api/pos/powersync/token` (device JWT): if `POWERSYNC_URL` is unset return
  `503 POWERSYNC_NOT_CONFIGURED` with a readable message; otherwise return
  `{ endpoint, token, expiresAt }` with the 15-minute PowerSync JWT.
- `POST /api/pos/session/refresh` may reuse `/api/pos/session`; no separate route.
- `sync.routes.ts` mounted in `app.ts`; routes are public but device-authenticated (no
  Better Auth session).
- Tests: session returns config and no secrets; revoked device → 403; inactive terminal →
  403; warehouse → 403; token endpoint returns a JWT whose claims decode to the right
  branch/terminal; unset URL → 503.

**Verify:** HTTP tests; `jwt.decode` assertions; `check-types`.
**Commit:** `feat(api): add pos device session and powersync token endpoints`

## Task 4 — PowerSync service (self-hosted Docker) and sync config

**Files:** `compose.yaml`, `powersync/sync-config.yaml`, `powersync/service.yaml`,
`powersync/README.md`, `powersync/init/powersync.sql`, root `package.json`,
`.env.example`, `.gitignore`

- **Decision:** development and CI run the official **self-hosted PowerSync service**
  (`journeyapps/powersync-service`), not Cloud. Staging/production reuse the same
  `sync-config.yaml`/`service.yaml`; the deployment target is decided in Phase 9.
- Add a `powersync` service to `compose.yaml` under `profiles: ["sync"]` so it joins the
  existing `gikautos-dev` network and can reach `postgres:5432`:
  - image pinned to a stable tag (`journeyapps/powersync-service:1.27.1`; re-check the
    current stable line at execution and pin it, never `latest`);
  - `command: ["start", "-r", "unified"]` (replication + API + storage in one process);
  - `ports: ["8080:8080"]` (container port is 8080);
  - `depends_on: postgres: condition: service_healthy`;
  - `environment`: `POWERSYNC_CONFIG_PATH=/config/service.yaml`,
    `PS_DATA_SOURCE_URI`, `PS_STORAGE_URI`, `PS_JWKS_URI`, `PS_ADMIN_TOKEN`;
  - `volumes`: `./powersync/service.yaml:/config/service.yaml:ro`,
    `./powersync/sync-config.yaml:/config/sync-config.yaml:ro`;
  - `extra_hosts: ["host.docker.internal:host-gateway"]` (Linux) so the service can fetch
    the API JWKS from `http://host.docker.internal:4000/.well-known/jwks.json`;
  - `healthcheck` against the service's HTTP health endpoint.
- `powersync/service.yaml`:
  ```yaml
  replication:
    connections:
      - type: postgresql
        uri: !env PS_DATA_SOURCE_URI
        sslmode: disable          # local Docker network only
  storage:
    type: postgresql
    uri: !env PS_STORAGE_URI
    sslmode: disable
  port: 8080
  sync_config:
    path: sync-config.yaml
  client_auth:
    jwks_uri: !env PS_JWKS_URI
    audience: ['http://localhost:8080']
  api:
    tokens: [!env PS_ADMIN_TOKEN]
  healthcheck:
    probes:
      use_http: true
  telemetry:
    disable_telemetry_sharing: true
  ```
- `powersync/init/powersync.sql` (run once against the Docker Postgres; idempotent):
  - `CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD …` and
    `GRANT SELECT ON ALL TABLES IN SCHEMA public`, plus default privileges;
  - `CREATE DATABASE gikautos_powersync OWNER powersync_storage` (or create the
    `powersync_storage` role and grant `CREATE` on the DB), for bucket storage;
  - a publication named `powersync` scoped to the synced tables:
    `CREATE PUBLICATION powersync FOR TABLE product, barcode, product_price, stock_level,
    customer, credit_profile, loyalty_account, loyalty_lot;` — avoids replicating
    unrelated/ledger/storage tables. Document that adding a synced table later requires
    `ALTER PUBLICATION powersync ADD TABLE …`.
  - `wal_level=logical`, `max_replication_slots=10`, `max_wal_senders=10` are already set
    in `compose.yaml`; note the service must be restarted after changing them.
- `sync-config.yaml`:
  ```yaml
  config:
    edition: 3
  streams:
    pos_products:
      auto_subscribe: true
      query: SELECT * FROM product WHERE is_active = true
    pos_barcodes:
      auto_subscribe: true
      query: SELECT * FROM barcode
    pos_prices:
      auto_subscribe: true
      query: SELECT * FROM product_price WHERE branch_id = auth.parameter('branch_id')
    pos_stock:
      auto_subscribe: true
      query: SELECT * FROM stock_level WHERE branch_id = auth.parameter('branch_id')
    pos_customers:
      auto_subscribe: true
      query: SELECT * FROM customer WHERE status = 'ACTIVE' AND anonymized_at IS NULL
    pos_credit:
      auto_subscribe: true
      query: SELECT * FROM credit_profile WHERE branch_id = auth.parameter('branch_id')
    pos_loyalty:
      auto_subscribe: true
      queries:
        - SELECT * FROM loyalty_account
        - SELECT * FROM loyalty_lot WHERE remaining_points > 0
  ```
  Products/barcodes/accounts are global by design (20k customers, 5k SKUs); branch-scoped
  rows use the signed claim. No staff, setting, sale, credit ledger, or loyalty ledger
  table is synced.
- Root scripts: `sync:init` (apply `powersync/init/powersync.sql` via
  `docker compose exec -T postgres psql`), `sync:up`
  (`docker compose --profile sync up -d powersync`), `sync:down`, `sync:logs`,
  `sync:config-check` (validate YAML/service logs; run the PowerSync CLI
  `powersync validate` where available). `sync:deploy` is **not** part of the dev loop.
- README: exact order — `bun run db:up`, `bun run sync:init` (first time), migrate/seed,
  start the API with `DATABASE_URL` pointing at the Docker Postgres (`:5433`), then
  `bun run sync:up`; check `docker compose logs powersync` for replication/publication
  errors; the API's JWKS must be reachable from the container; the instance URL is
  `http://localhost:8080`. Document troubleshooting: `sslmode` must be the separate YAML
  key; `replication.connections` (not root `connections`); the publication name must be
  `powersync`; the service listens on 8080.
- **Dev source of truth:** use the Docker Postgres (`:5433`) for Phase 6 sync development
  so the service, API, and tests share one logical-replication database. The operator's
  local `:5432` instance remains the API-test instance (`gikautos_test`) and is not used
  for sync.
- `.env.example` additions: `PS_DATA_SOURCE_URI`, `PS_STORAGE_URI`, `PS_JWKS_URI`,
  `PS_ADMIN_TOKEN`, `POWERSYNC_URL=http://localhost:8080`. No real secrets committed;
  `powersync/cli.yaml` and any token files are gitignored.
- Cloud is **not** used in development. The README notes that the same files can be
  deployed to Cloud later (`powersync link cloud`, deploy `sync-config` only) without
  changing the client contract.

**Verify:** `docker compose --profile sync up -d` starts the service; `docker compose logs
powersync` shows a healthy replication connection and no publication/ssl errors;
`psql` shows the `powersync` publication and the `gikautos_powersync` database; a manual
`curl` from inside the container reaches the API JWKS; a dev token/PowerSync JWT syncs the
demo catalog into a scratch client.
**Commit:** `feat(powersync): add self-hosted docker service and pos sync config`

## Task 5 — Local schema, connector, provider, and sync status

**Files:** `desktop/src/renderer/lib/powersync/schema.ts`,
`desktop/src/renderer/lib/powersync/database.ts`,
`desktop/src/renderer/lib/powersync/connector.ts`,
`desktop/src/renderer/lib/powersync/provider.tsx`,
`desktop/src/renderer/lib/powersync/status.ts`,
`desktop/src/renderer/routes/_pos/route.tsx` (minimal),
`desktop/src/renderer/lib/api/client.ts`

- Synced tables (read-only) with the exact server column names (snake_case) and indexes:
  `product`, `barcode`, `product_price`, `stock_level`, `customer`, `credit_profile`,
  `loyalty_account`, `loyalty_lot`. Dates are ISO text; booleans are integers.
- Local-only tables (`localOnly: true`): `pos_config`, `pos_session`, `staff_binding`,
  `sale`, `sale_line`, `sale_tender`, `shift`, `cash_movement`, `customer_draft`,
  `outbox`, `local_stock_delta`, `local_credit_delta`, `local_loyalty_delta`,
  `document_sequence`, `sync_conflict_local` (device cache of server conflicts).
  Full column lists follow the D8/D11/D16–D19 contracts; include `acked_at`/`status`
  columns and indexes on `outbox(status, created_at)`, `sale(shift_id)`,
  `sale_line(sale_id)`, `shift(status)`, `document_sequence(terminal_id, scope, day)`.
- `database.ts`: create one `PowerSyncDatabase` at module scope with
  `encryptionKey` from the keychain, `dbFilename: 'gikautos-pos.db'`, the VFS chosen by
  the Plan 02 spike; export `db`. Never instantiate twice (Strict Mode guard).
- `connector.ts`: implements `fetchCredentials()` against `POST /api/pos/powersync/token`
  using the device JWT from the session module; returns
  `{ endpoint, token, expiresAt }`. **No `uploadData`** (local-only writes). On 401,
  refresh the device session once and retry; on 403, mark the device revoked locally and
  stop connecting.
- `provider.tsx`: `<PowerSyncContext.Provider value={db}>`, call `db.connect(connector)`
  once after enrollment; expose `useSyncStatus` from `db.registerListener` with
  online, hasSynced, lastSyncedAt, downloading, uploadError (none), and retry.
- `status.ts`: stores `{ online, hasSynced, lastSyncedAt, lastAttemptAt, error }` for the
  header (Plan 08) and never logs tokens.
- Add a `/dev/sync` route showing counts per synced table, `SELECT count(*)` for products,
  stock, customers, credit, loyalty, and the sync status. Gate on dev mode.

**Verify:** after enrollment + connect, the counts match the server for ACC-SPX; killing
the network keeps the data readable; reconnecting updates it; the connector never calls an
upload endpoint; no plaintext DB file is readable (encryption smoke: file header is not
`SQLite format 3`).
**Commit:** `feat(desktop): add powersync schema, connector, and sync status`

## Task 6 — Shared API/client types

**Files:** `desktop/src/renderer/lib/api/client.ts`,
`desktop/src/renderer/lib/api/types.ts`, `desktop/src/renderer/lib/config.ts`

- Typed fetch wrapper: base URL from `pos_config`/keychain, `Authorization: Bearer` device
  JWT, JSON only, timeout via `AbortController`, no cookies, no PII in error messages.
  On 401 → refresh session once; on 403 → surface `DEVICE_REVOKED` and route to enrollment.
- Types mirror the API session/config payloads and the upload envelope (used in Plan 08).
- `config.ts` validates the runtime config with Zod and exposes `apiBaseUrl`,
  `powersyncUrl`, `appVersion`.

**Verify:** unit tests for 401 refresh-once, 403 revocation, timeout, and malformed JSON;
`check-types`.
**Commit:** `feat(desktop): add typed pos api client`

## Done When

A terminal can redeem a code, hold a device token in the keychain, obtain a 15-minute
device JWT and PowerSync JWT, connect to a validated branch-scoped stream set, and read
the synced catalog/stock/customer/credit/loyalty data offline. The connector has no
upload path, and sync status is observable.
