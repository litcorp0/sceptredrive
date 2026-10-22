---
phase: 06-pos-offline-core
plan: 08
wave: 5
title: Outbox uploader, retries, sync status, and conflict surfacing
requirements: [POS-14, SYNC-04, SYNC-07, SYNC-08]
depends_on: [05, 06]
status: planned
created: 2026-10-22
---

# Plan 08 — Outbox Uploader, Retries, Sync Status, Conflicts

**Goal:** The outbox drains to the server in strict order with exactly-once semantics,
survives restarts and lost responses, pauses safely on auth failures, backs off on
transient errors, and surfaces pending counts, last-sync time, dead letters, and conflicts
without ever blocking a sale.

## Task 1 — Outbox state machine and repository

**Files:** `desktop/src/renderer/lib/outbox/outbox-repository.ts`,
`desktop/src/renderer/lib/outbox/outbox-types.ts`,
`desktop/src/renderer/lib/outbox/outbox.test.ts`

- States: `pending`, `in_flight`, `acked`, `conflict`, `dead_letter`; columns `attempts`,
  `next_attempt_at`, `last_error_code`, `last_error_message`, `server_result` json,
  `acked_at`.
- `nextBatch(limit)`: oldest `pending` rows with `next_attempt_at <= now`, ordered by
  `created_at, id`; excludes `in_flight` from other runs; uses a transaction to mark the
  batch `in_flight` and return it. On boot, any `in_flight` row is reset to `pending`
  (a crash mid-flight is safe because the server replays).
- `applyResult(row, result)`: `APPLIED`/`REPLAYED` → `acked`, store result, mark the
  sale's pending deltas `acked_at` and link a `customer_draft` if
  `resolvedCustomerId` is present; `REJECTED` → `dead_letter`, store the error, do **not**
  ack deltas; a result with conflicts but APPLIED still acks (the conflict is information,
  not a reason to stop).
- `backoff(attempts)`: `min(1s × 2^attempts, 5m)` + ±20% jitter; `next_attempt_at` stored.
  `pauseUntil` for 401/403/429.
- `retryDeadLetter(id)` (manager-only UI) resets to `pending` with attempts 0; used after a
  manager resolves an integrity issue (Phase 8 wires the server side).
- Never delete outbox rows; acked rows are retained for 30 days then pruned by a local job
  (keeps the DB small; sale rows remain).

**Verify:** unit tests: FIFO order, batch limit, restart resets in_flight, applied/replayed
ack and delta behavior, rejected dead-letters, backoff math with an injected clock,
pruning leaves recent rows.
**Commit:** `feat(pos): add durable outbox state machine`

## Task 2 — Uploader loop

**Files:** `desktop/src/renderer/lib/outbox/uploader.ts`,
`desktop/src/renderer/lib/outbox/uploader.test.ts`,
`desktop/src/renderer/lib/api/sync-client.ts`,
`desktop/src/renderer/lib/powersync/provider.tsx`

- Start after login/enrollment and after every sale/shift mutation:
  - trigger an immediate drain (debounced ~200 ms);
  - a 15-second timer while rows are pending;
  - `window.addEventListener('online', drain)` and a successful PowerSync sync as an
    additional trigger;
  - a manual "Sync now" from the status screen.
- Drain loop:
  1. if `navigator.onLine === false`, wait for the event; never call the network;
  2. take `pos.syncBatchSize` rows; build `{ batchId: uuidv7, deviceId, terminalId,
     transactions }` from `outbox.payload` + `clientTransactionId/type/occurredAt`;
  3. `POST /api/pos/sync/upload` with the device JWT (refresh once on 401 via
     `/api/pos/session`; 403 → mark device revoked, stop, route to enrollment);
  4. apply each result in order; on a missing/mismatched result, treat the batch as
     ambiguous and leave rows `in_flight` for the next drain (server replay is safe);
  5. continue immediately while a full batch was acked; stop on the first empty batch;
  6. 429: honor `Retry-After`; 5xx/network: backoff; 400: dead-letter the batch with a
     readable error (should not happen with a valid client); 401 after refresh: pause.
- A single uploader instance (module-level promise guard); no two drains concurrently.
  Killing the app mid-request is safe: rows are `in_flight`, reset on boot, and the server
  replays.
- The uploader never awaits inside the sale completion path; it only enqueues and
  schedules.
- Emit status events `{ online, draining, pending, lastSuccessAt, pauseReason,
  lastError }` to the status store.

**Verify:** unit tests with a mocked fetch: ordered batches, success drain, duplicate
response (REPLAYED), 401 refresh once then success, 403 pause, 429 Retry-After, 5xx
backoff, network loss, concurrent drain guard, batch split.
**Commit:** `feat(pos): drain the outbox with exactly-once retries`

## Task 3 — Sync status UI and conflict surfacing

**Files:** `desktop/src/renderer/lib/sync/sync-status-store.ts`,
`desktop/src/renderer/components/pos/sync-badge.tsx`,
`desktop/src/renderer/routes/_pos/sync.tsx`,
`desktop/src/renderer/components/pos/conflict-list.tsx`,
`desktop/src/renderer/components/pos/sync-log.tsx`

- Header badge: green "Synced HH:mm", amber "N pending" (pulsing while draining), red
  "Offline — N pending", red "Action needed" when dead letters or HIGH conflicts exist.
  Tapping opens `/sync`.
- `/sync` page (manager/admin sees all; cashier sees their terminal):
  - connection state, last successful upload, last PowerSync download, pending count,
    manual "Sync now";
  - outbox table: receipt/type, time, attempts, next retry, state, last error (no PII);
  - conflicts: type, severity, receipt/shift, time, status; expandable details (amounts,
    product ids, on-hand, limit/balance, timestamps); a HIGH conflict banner explains that
    the sale is recorded and a manager will review it (Phase 8 resolution);
  - dead letters: "Retry" (manager only) and a note to contact support.
- Poll the device conflict endpoint (`GET /api/pos/sync/conflicts?since=…`) after each
  successful drain and on page open; upsert into local `sync_conflict_local` by id. Keep
  the local cache even offline.
- `sync-badge` is present on the selling screen and never opens a modal that blocks a sale.

**Verify:** E2E with a mock/throttled server: offline sales show pending count; reconnect
drains and the badge turns green; an oversell response shows a HIGH conflict in `/sync`;
a dead letter shows Retry; no token/PII appears in the UI or console.
**Commit:** `feat(pos): surface sync status and conflicts`

## Task 4 — Endurance and recovery scenarios

**Files:** `desktop/e2e/outbox.spec.ts`,
`.planning/phases/06-pos-offline-core/evidence/outbox-recovery.md`

- Scenarios (fake adapter + mocked/unstable network or a controllable proxy):
  1. complete 5 sales offline → pending 5 → reconnect → 5 acked exactly once;
  2. kill the app after the request is sent but before the response → relaunch → no
     duplicate (server REPLAYED) and the outbox drains;
  3. server returns 500 twice then succeeds → backoff, then ack, sale never lost;
  4. 401 → session refresh → continue; 403 (device revoked) → paused, clear message,
     pending rows intact;
  5. batch size 1 and 25 both drain correctly;
  6. a rejected transaction dead-letters without blocking later rows.
- Record timings, attempt counts, and DB state in `evidence/outbox-recovery.md`.

**Verify:** E2E green; server SQL shows exactly one sale per client transaction; the
outbox has zero `pending`/`in_flight` after recovery.
**Commit:** `test(pos): prove outbox recovery and exactly-once upload`

## Done When

The POS drains its outbox strictly in order with exactly-once results, survives crashes,
lost responses, token expiry, revocation, throttling, and server errors, and shows an
honest, non-blocking sync/conflict status at all times.
