# Research — PowerSync + Electron

> **Update 2026-10-22 (Phase 6 planning):** development and CI now use the **self-hosted
> PowerSync Docker service** (`journeyapps/powersync-service`, `start -r unified`) against
> the Docker Postgres, not Cloud. The Cloud pricing/TLS/IP-allowlist notes below remain
> relevant only if staging/production chooses Cloud in Phase 9. See
> `phases/06-pos-offline-core/01-RESEARCH.md` §4 and `03-PLAN.md` Task 4.


**Researched:** 2026-10-17
**Sources:** `docs.powersync.com` (pricing, sync streams, custom auth, source DB setup,
security and IP filtering, self-hosting), `powersync.com/pricing`, PowerSync SDK references

## Pricing and editions

- **Cloud Free:** 2 GB synced/month, 500 MB hosted, 50 peak concurrent clients,
  2 instances; projects deactivate after 1 week of inactivity.
- **Cloud Pro:** from $49/month; 30 GB synced, 10 GB hosted, 1,000 concurrent clients.
- 5 branches / 20 terminals fits the free tier comfortably at first (initial sync is the
  largest cost, plus small deltas).
- **Self-hosted Open Edition** exists (no license fee, no dashboard) as a fallback.

## Architecture for Electron

- Renderer process (Chromium): use `@powersync/web` + `@powersync/react` (Web SDK,
  wa-sqlite WASM). This is the recommended pattern for Electron.
- Main process (Node): `@powersync/node` + `better-sqlite3` requires `@electron/rebuild`
  and IPC to reach the UI. Heavier; fallback only if the Web SDK worker/WASM path fails.
- Required Vite renderer setup:
  - `vite-plugin-wasm` + `vite-plugin-top-level-await`
  - `optimizeDeps.exclude: ['@journeyapps/wa-sqlite', '@powersync/web']`
  - `worker.format: 'es'` with the same plugins in the worker build
- Electron Forge's Vite plugin is **experimental**. Pin versions and spike PowerSync in
  Phase 6 before building the whole app on it.

## SDK rules (apply to the POS)

- Never define the `id` column in a PowerSync table; it is created automatically.
- Booleans are `column.integer`; dates are `column.text` ISO strings.
- `connect()` is fire-and-forget; use `waitForFirstSync()` when the UI must gate on data.
- `transaction.complete()` is mandatory or the upload queue stalls permanently.
- A 4xx from `uploadData` blocks the queue permanently; return 2xx for validation errors
  and report per-item results in the body.
- `disconnectAndClear()` on logout/user switch to wipe local data.
- Create the database once at module scope (React Strict Mode double-mount hazard).

## Sync Streams and auth

- Sync Streams (edition 3 config) support `auth.parameter(...)`, `subscription.parameter(...)`,
  and `connection.parameter(...)`.
- Use JWT claims for branch scoping: `SELECT * FROM stock_level WHERE branch_id = auth.parameter('branch_id')`.
- JWT requirements: signed with the configured HS256 key or JWKS, `aud` = instance URL,
  `sub` = user/device id, `iat`/`exp` present with ≤ 24 h (60 min recommended).
- Uploads never pass through PowerSync: the client calls our backend from `uploadData()`.

## Source database (VPS Postgres)

- Enable `wal_level = logical`; restart Postgres.
- Create a dedicated role: `REPLICATION BYPASSRLS LOGIN` with `SELECT` only.
- Create a publication named `powersync` (limit it to synced tables).
- PowerSync Cloud **always enforces TLS** and validates the server certificate
  (`verify-full` preferred; `verify-ca` with an explicit CA for self-signed).
- PowerSync Cloud connects from documented static IP ranges per region (EU ranges
  available); restrict Postgres firewall/pg_hba to those addresses.
- Private endpoints (AWS PrivateLink) and client certificates are available on higher plans.
- Postgres 14+ can host both the source and the bucket storage database on one server.

## Implications for Sceptre Drive

- Local SQLite schema mirrors down-synced tables; sales/returns/shifts/receipts/outbox are
  local-only tables.
- The POS uploads a durable outbox to `POST /api/sync/upload`; the server applies one
  atomic transaction per client transaction and returns per-item results with HTTP 200.
- The PowerSync JWT is issued by the API to enrolled, active devices only and expires in 1 hour.
- Deployment must expose Postgres with TLS on the VPS and allowlist PowerSync Cloud EU IPs
  (documented in Phase 9).
