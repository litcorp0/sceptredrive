# Verification — Plan 03: device auth, sync config, local schema, connector

**Date:** 2026-10-22
**Environment:** local Docker Postgres (`:5434`, `POSTGRES_PORT`), self-hosted PowerSync
`journeyapps/powersync-service:1.27.1`, API on `:4000`, Electron 45 (unpackaged production
build).

## Results

| Suite | Result |
|---|---|
| API tests | **305/305** (25 files; +28 vs Phase 5) |
| Desktop unit tests | **60/60** (8 files) |
| Shell E2E (`test:e2e`) | **35/35** |
| PowerSync gate (`test:spike`) | **8/8** |
| Device/sync walkthrough (`walkthrough-sync.mjs`) | **24/24** |
| Desktop sync E2E (`test:sync`) | **18/18** |

## What each suite proves

### `walkthrough-sync.mjs` (HTTP + SQL)

Enrolment is seeded straight into Postgres (no admin TOTP in the loop), then the whole
device path runs over HTTP:

- redeem → **201** with a 43-char device token; the database stores only
  `HMAC-SHA256(token)`, and the code cannot be redeemed twice (400);
- `POST /api/pos/session` → JWT + config snapshot (tax mode, loyalty rates, POS policy,
  `Africa/Accra`, server time); the payload contains no device token, PIN hash, or password;
- the device token doubles as the refresh credential;
- `POST /api/pos/powersync/token` → JWT whose `branch_id` / `terminal_id` / `aud` match the
  terminal; a malformed token is rejected by the service (`401 PSYNC_S2101`) while ours is
  **accepted** (stream opens);
- revoking the device immediately blocks both the session and the PowerSync token (403).

### `test:sync` (real renderer → real service)

- The device token is written through the preload keychain bridge, then `#dev/sync` waits
  for the first full sync.
- Every synced table matches the server's own count for `ACC-SPX`:
  products **12**, barcodes **14**, branch prices **1**, stock levels **12**, customers
  **3**, credit profiles **1**, loyalty accounts **3**, loyalty lots **1** (47 put
  operations in the service log).
- `hasSynced=true`; the local `pos_config` records `ACC-SPX` / `ACC-SPX-T01`.
- Going offline keeps every row readable (the view is re-mounted and re-queried from disk),
  and reconnecting returns to `online`.
- The OPFS database file exists under `userData` and its header is **not**
  `SQLite format 3` — the database is encrypted with the keychain key.
- No renderer errors during the run.

Service log excerpt (first sync):

```
Sync stream started {user_id: <device id>}
New checkpoint: 59 | buckets: 7 |
  ["1#pos_products|0[]","1#pos_barcodes|0[]","1#pos_prices|0[\"<branch>\"]",
   "1#pos_stock|0[\"<branch>\"]","1#pos_customers|0[]","1#pos_credit|0[\"<branch>\"]",
   "1#pos_loyalty|0[]"]
checkpoint_complete: 59 | operations_synced: 47
```

## Deviations and decisions

1. **Docker host port.** `:5433` is used by an unrelated container on this machine, so the
   compose port is now `${POSTGRES_PORT:-5433}` (default unchanged; `.env` sets 5434 here).
   `db:test:prepare` honours the same variable. CI is unaffected.
2. **CORS.** The POS renderer origin `app://gikautos` must be in `CORS_ORIGINS`; without it
   every API call fails as a network error. Added to `.env.example` with an explanation.
3. **CSP meta superset.** Browsers intersect the header and `<meta>` policies; the
   build-time meta was narrower than the runtime header and blocked `localhost` in an
   unpackaged build. The meta is now always built with local origins included
   (`allowLocalOrigins: true`) and the header stays authoritative.
4. **Local-origin policy.** `isDev` now means "Vite dev server"; a new
   `allowLocalOrigins = isDev || !app.isPackaged` gate decides whether `http://localhost`
   is acceptable. A packaged app is unchanged: localhost is rejected and the config fails
   closed.
5. **Generated service config.** The container cannot reach a process on the host on this
   machine (firewall drops container→host), so `sync:up` writes
   `powersync/.generated/service.yaml` with the API's public JWK inlined. Production/CI keep
   the committed `service.yaml` with `jwks_uri`. A stable `POS_JWT_PRIVATE_KEY` in `.env`
   keeps the inline key valid across restarts.
6. **Task 6 files** (`lib/api/client.ts`, `types.ts`, `config.ts` and their tests) shipped
   with the schema/connector commit; the 403 → enrolment step landed separately as
   `feat(desktop): surface device revocation …`.

## Not covered here

- PIN login, shifts, and selling (Plans 04–06).
- The outbox uploader and conflict handling (Plan 05/08): `uploadData` intentionally throws
  and no upload endpoint exists yet.
- Real Windows hardware (Phase 9 checklist).
