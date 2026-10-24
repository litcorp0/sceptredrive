# Research — Offline-First POS Patterns

**Researched:** 2026-10-17
**Sources:** offline-first POS architecture articles and case studies (idempotent sync,
client-owned intent/server-owned truth, append-only event models, conflict handling)

## The principles that hold up

1. **Client generates identity before the network exists.** Use UUIDv7 ids and idempotency
   keys generated at capture time; reuse the same key on every retry. The primary key is
   the idempotency key (`INSERT ... ON CONFLICT DO NOTHING` returns nothing for a replay).
2. **Client owns intent, server owns truth.** The device records what the cashier tried to
   do; the server validates it against current state and returns the canonical record.
3. **Append-only beats merge.** Sales and ledger movements are immutable facts, not mutable
   documents. Addition is commutative: out-of-order arrival changes nothing. Reports use
   `occurred_at`, which travelled with the record.
4. **The local machine is the source of interaction; the server owns shared invariants.**
   The UI reads the local database; the server owns permissions, limits, and confirmed versions.
5. **Never block a sale at the till.** If stock is stale or two terminals sell the last unit,
   the sale still completes; the discrepancy becomes an explicit reconciliation conflict.
6. **Durable mutation queue.** The user action and its queue record commit in one local
   transaction. Queue states: `pending`, `in_flight`, `acked`, `conflict`, `dead_letter`.
   Retries use bounded exponential backoff with jitter; auth failures pause the queue;
   conflicts wait for a decision instead of retrying forever.
7. **Price changes never retroactively reprice pending sales.** A sale syncs at the price
   the cashier charged; a mismatch against the current price is flagged, not rewritten.
8. **Payments are the one place for pessimistic rules.** Cash is final offline; electronic
   payments require connectivity because confirmation comes from Paystack, not the client.
9. **Conflicts are information.** Record both versions (or the offending intent) and let a
   manager resolve with an audit trail instead of silently dropping one side.
10. **Backward compatibility matters.** Deployed POS builds update slowly; the upload
    contract stays additive, and incompatible changes get an explicit replacement plan.

## Mapping to Sceptre Drive

- **Local:** PowerSync Web SDK SQLite; sales, lines, tenders, returns, shifts, cash
  movements, receipts, and the outbox are local tables. The outbox row is written in the
  same transaction as the sale.
- **Upload:** the PowerSync connector drains the outbox to `POST /api/sync/upload` with
  `{ batchId, deviceId, terminalId, branchId, transactions[] }`. Each transaction carries
  `clientTransactionId`, `idempotencyKey`, `occurredAt`, and a payload.
- **Server:** authenticates the device, processes transactions in recorded order, applies
  one atomic DB transaction per client transaction, recomputes totals/tax/credit/loyalty,
  posts ledger movements, writes audit rows, and returns per-item results (HTTP 200).
- **Idempotency:** unique `(terminal_id, client_transaction_id)`; replays return the
  existing result without inserting duplicates.
- **Conflicts:** stock oversell, credit over limit, loyalty negative balance, price
  mismatch, stale/revoked credentials, and clock skew beyond a threshold create
  `sync_conflict` rows with enough context for a manager to resolve.
- **Reconciliation:** scheduled checks compare stock projections with the movement ledger
  and credit/loyalty projections with their ledgers; discrepancies are surfaced in admin.
