import type { PowerSyncDatabase } from '@powersync/web'

/**
 * Stops a delta from counting once the fact it belongs to has reached the
 * server.
 *
 * The uploader acks a sale's deltas when it acks the sale (`outbox-repository`),
 * but a refund's stock return and a repayment's credit movement are not sales:
 * their outbox rows are `REFUND` and `CREDIT_REPAYMENT`. Left unacked, a
 * returned unit and a paid-down debt would keep inflating the local stock and
 * headroom figures even after the server's own numbers synced back.
 *
 * The outbox is the authority and it is never deleted before it is acked, so a
 * missing row means it was pruned after an ack. An acked row and a missing row
 * both mean "the server knows"; only a live non-acked row still counts. Running
 * this is idempotent, and it can only ever remove a double count.
 */
export async function reconcileLocalDeltas(db: PowerSyncDatabase, now = new Date()): Promise<void> {
  const ackedAt = now.toISOString()
  for (const table of ['local_stock_delta', 'local_credit_delta', 'local_loyalty_delta']) {
    await db.execute(
      `UPDATE ${table}
          SET acked_at = ?
        WHERE acked_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM outbox o
             WHERE o.id = ${table}.sale_id
               AND o.status <> 'acked'
          )`,
      [ackedAt],
    )
  }
}
