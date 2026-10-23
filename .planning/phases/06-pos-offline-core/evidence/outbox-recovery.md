# Plan 08 — Outbox recovery and exactly-once upload

Date: 2026-10-23
Scope: Phase 6 Plan 08 (outbox state machine, uploader, sync status, conflicts).

## What is proved

| Claim | Evidence |
|---|---|
| Strict FIFO, batch limit, crash-safe `in_flight` reset | `outbox-repository.test.ts`, `uploader.test.ts` |
| APPLIED/REPLAYED ack the row and its sale deltas; REJECTED dead-letters without acking | `outbox-repository.test.ts`, `uploader.test.ts` |
| Resolved customer drafts are linked back onto the sale and pending deltas | `outbox-repository.test.ts` |
| Exponential backoff ±20%, Retry-After, 60-minute cap | `outbox.test.ts` |
| 401 pauses after the one refresh; 403 revokes and pauses; 429 honours Retry-After; 5xx/network back off | `uploader.test.ts` + simulation |
| One drain at a time, batch split, no duplicate after a lost response | `uploader.test.ts` + simulation |
| Conflicts upsert by server id and link the local receipt | `conflicts.test.ts` |
| Badge/`/sync` show pending, last upload, dead letters, conflicts without PII | `sync-badge.tsx`, `routes/_pos/sync.tsx`, `sync-log.tsx`, `conflict-list.tsx` |
| Real SQLite transitions and recovery | `evidence/verify-outbox.ts` — **41/41** |

Commands:

```bash
bun run --filter desktop test        # 332/332
bun run --filter desktop check-types # clean
bunx biome check src test            # clean
bun .planning/phases/06-pos-offline-core/evidence/verify-outbox.ts  # 41/41
```

## Simulation results (real store, scripted server)

`verify-outbox.ts` opens an in-memory SQLite database, creates the real outbox
tables, seeds sales, and runs the **real** `createOutboxStore` + `createUploader`
with a controllable clock and scripted responses. It writes
`outbox-recovery.json`.

| # | Scenario | Result |
|---|---|---|
| 1 | 5 offline sales → online → 5 acked, 1 batch, deltas acked | PASS |
| 2 | Request applied, response lost → backoff → retry returns REPLAYED, server applied each transaction once | PASS |
| 3 | 503 twice → +1s, +2s backoff → ack | PASS |
| 4 | 401 → pause AUTH, rows pending, manual retry acks | PASS |
| 5 | 403 revoked → pause REVOKED, rows pending, revocation hook once | PASS |
| 6 | Batch size 1 (25 requests) and 25 (1 request) | PASS |
| 7 | REJECTED item dead-letters; later row still acks | PASS |
| 8 | Acked rows kept inside 30 days, pruned outside it | PASS |
| 9 | In-flight row from a crash reset and replayed | PASS |

Timings are deterministic (injected clock); no wall-clock flakes. Backoff
values observed: attempt 1 → 1 000 ms, attempt 2 → 2 000 ms (random = 0.5, so
zero jitter).

## Behaviour notes

- **`navigator.onLine === false` is honoured for scheduled drains, but a manual
  "Sync now" still attempts.** Electron/Chromium docs warn that `false` is a
  strong offline signal while `true` is not proof of reachability; Windows NCSI
  blocked by a firewall can report offline while the LAN server is reachable.
  Blocking the manual action would strand sales, so the operator's explicit
  retry bypasses the hint. Documented in `uploader.ts`.
- **A 403 pauses and calls `markDeviceRevoked`;** pending rows are untouched and
  the app routes to enrolment via the session listener.
- **A 400 dead-letters the batch.** A valid client should never produce one;
  a corrupt local payload is dead-lettered per row as `INVALID_PAYLOAD`.
- **`REPLAYED` is a success.** The server's `(terminal_id, client_transaction_id)`
  reservation is the exactly-once mechanism; the device never counts it twice.
- **Acknowledged rows are retained 30 days** and pruned on uploader start; they
  remain an audit trail for the retention window.
- **No PII or tokens** are written to the outbox error fields, the status store,
  or the console. Errors are short codes plus server messages.

## Deferred to Plan 09

The full enrolled-device E2E (real API + PowerSync service: enrol → sell
offline → reconnect → exactly-once upload → conflict badge → revoked device)
still requires the running backend and remains the Plan 09 gate, exactly as for
Plan 07. Plan 08 proves the state machine, real SQL transitions, and the UI
against scripted responses.
