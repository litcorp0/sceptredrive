import type { PowerSyncDatabase } from '@powersync/web'
import type { UploadItemResult } from '../api/types'
import {
  errorSummary,
  OUTBOX_STATUSES,
  OUTBOX_TYPES,
  type OutboxRow,
  type OutboxStatus,
  type OutboxType,
} from './outbox-types'

/**
 * Durable outbox data access (Plan 08 Task 1).
 *
 * All state transitions are parameterised SQL. `nextBatch` claims rows inside
 * one write transaction, so an app crash can only ever leave `in_flight` rows,
 * which the uploader resets to `pending` before the next drain (the server's
 * `(terminal_id, client_transaction_id)` key makes the replay safe).
 */

const OUTBOX_COLUMNS = `id, client_transaction_id, type, occurred_at, payload_version,
  payload, status, attempts, next_attempt_at, last_error, last_error_code,
  last_error_message, server_result, acked_at, created_at, updated_at`

/** `sale` also has `id`, so the joined read must qualify every outbox column. */
const OUTBOX_COLUMNS_QUALIFIED = OUTBOX_COLUMNS.split(',')
  .map((column) => `o.${column.trim()}`)
  .join(', ')

interface OutboxDbRow {
  id: string
  client_transaction_id: string
  type: string
  occurred_at: string
  payload_version: number
  payload: string
  status: string
  attempts: number
  next_attempt_at: string | null
  last_error: string | null
  last_error_code: string | null
  last_error_message: string | null
  server_result: string | null
  acked_at: string | null
  created_at: string
  updated_at: string
  receipt_number?: string | null
}

export interface OutboxCounts {
  /** Rows still owed to the server (`pending` + `in_flight`). */
  pending: number
  deadLetters: number
  conflicts: number
}

export interface OutboxStore {
  resetInFlight(now: string): Promise<number>
  nextBatch(limit: number, now: string): Promise<OutboxRow[]>
  markAcked(row: OutboxRow, result: UploadItemResult, now: string): Promise<void>
  markRejected(row: OutboxRow, result: UploadItemResult, now: string): Promise<void>
  deadLetterBatch(rows: OutboxRow[], code: string, message: string, now: string): Promise<void>
  backoffRows(
    rows: OutboxRow[],
    delayMs: number,
    code: string,
    message: string,
    now: string,
  ): Promise<void>
  delayRows(rows: OutboxRow[], nextAttemptAt: string, now: string): Promise<void>
  releaseRows(rows: OutboxRow[], now: string): Promise<void>
  retryDeadLetter(id: string, now: string): Promise<void>
  counts(): Promise<OutboxCounts>
  listRecent(limit: number): Promise<OutboxRow[]>
  pruneAcked(beforeIso: string): Promise<number>
  readLastSuccessAt(): Promise<string | null>
  writeLastSuccessAt(iso: string): Promise<void>
}

function isStatus(value: string): value is OutboxStatus {
  return (OUTBOX_STATUSES as readonly string[]).includes(value)
}

function isType(value: string): value is OutboxType {
  return (OUTBOX_TYPES as readonly string[]).includes(value)
}

/** The code a row carries when its stored `type` is not one this build can send. */
export const UNKNOWN_OUTBOX_TYPE = 'UNKNOWN_OUTBOX_TYPE'

function unknownTypeMessage(stored: string): string {
  return `This till cannot upload an outbox row of type "${stored}" — update the POS and retry it`
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

/**
 * A stored row, or `null` when its `type` is not one this build knows.
 *
 * The old mapper turned every unknown type into `SALE`, which would have handed a
 * Phase 14 refund row to the sale endpoint as a sale. The wire union is closed,
 * so an unknown type cannot be dispatched at all: `nextBatch` dead-letters it
 * with the stored value in the message (see `unknownTypeMessage`) instead of
 * inventing a meaning for it.
 */
function toRow(row: OutboxDbRow): OutboxRow | null {
  if (!isType(row.type)) return null
  return {
    id: row.id,
    clientTransactionId: row.client_transaction_id,
    type: row.type,
    occurredAt: row.occurred_at,
    payloadVersion: row.payload_version,
    payload: parseJson<unknown>(row.payload),
    status: isStatus(row.status) ? row.status : 'pending',
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    serverResult: parseJson<UploadItemResult>(row.server_result),
    ackedAt: row.acked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    receiptNumber: row.receipt_number ?? null,
  }
}

function draftCustomerId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const customer = (payload as { customer?: unknown }).customer
  if (!customer || typeof customer !== 'object') return null
  const id = (customer as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

async function updateRows(
  tx: { execute(sql: string, parameters?: unknown[]): Promise<unknown> },
  rows: readonly OutboxRow[],
  sql: string,
  parameters: (row: OutboxRow) => unknown[],
): Promise<void> {
  for (const row of rows) {
    await tx.execute(sql, parameters(row))
  }
}

export function createOutboxStore(db: PowerSyncDatabase): OutboxStore {
  return {
    async resetInFlight(now) {
      const row = await db.getOptional<{ count: number }>(
        `SELECT COUNT(*) AS count FROM outbox WHERE status = 'in_flight'`,
      )
      if (!row?.count) return 0
      await db.execute(
        `UPDATE outbox SET status = 'pending', next_attempt_at = NULL, updated_at = ?
          WHERE status = 'in_flight'`,
        [now],
      )
      return row.count
    },

    async nextBatch(limit, now) {
      const rows = await db.writeTransaction(async (tx) => {
        const claimed = await tx.getAll<OutboxDbRow>(
          `SELECT ${OUTBOX_COLUMNS} FROM outbox
            WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY created_at ASC, id ASC
            LIMIT ?`,
          [now, limit],
        )
        const uploadable: OutboxDbRow[] = []
        for (const row of claimed) {
          if (!isType(row.type)) {
            // Dead-lettered inside the claim, not on the next drain: the row can
            // never be sent by this build, so leaving it pending would spin.
            const message = unknownTypeMessage(row.type)
            await tx.execute(
              `UPDATE outbox
                  SET status = 'dead_letter', last_error_code = ?, last_error_message = ?,
                      last_error = ?, next_attempt_at = NULL, updated_at = ?
                WHERE id = ? AND status = 'pending'`,
              [
                UNKNOWN_OUTBOX_TYPE,
                message.slice(0, 200),
                errorSummary(UNKNOWN_OUTBOX_TYPE, message),
                now,
                row.id,
              ],
            )
            continue
          }
          await tx.execute(
            `UPDATE outbox SET status = 'in_flight', updated_at = ?
              WHERE id = ? AND status = 'pending'`,
            [now, row.id],
          )
          uploadable.push(row)
        }
        return uploadable
      })
      return rows.flatMap((row) => {
        const mapped = toRow(row)
        return mapped ? [mapped] : []
      })
    },

    async markAcked(row, result, now) {
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `UPDATE outbox
              SET status = 'acked', acked_at = ?, server_result = ?,
                  next_attempt_at = NULL, last_error = NULL, last_error_code = NULL,
                  last_error_message = NULL, updated_at = ?
            WHERE id = ?`,
          [now, JSON.stringify(result), now, row.id],
        )

        // The deltas a document produced stop counting once it is server truth:
        // a sale moves stock, credit and loyalty; a refund moves stock back; a
        // repayment moves credit down. `acked_at IS NULL` makes a second ack of
        // the same row a no-op, so a replay cannot rewrite the first ack time.
        // `reconcileLocalDeltas` (lib/refund/local-deltas.ts) is the backstop
        // for rows that were acked before this arm existed, and for one whose
        // outbox row has since been pruned.
        const deltaTables =
          row.type === 'SALE'
            ? ['local_stock_delta', 'local_credit_delta', 'local_loyalty_delta']
            : row.type === 'REFUND'
              ? ['local_stock_delta']
              : row.type === 'CREDIT_REPAYMENT'
                ? ['local_credit_delta']
                : []
        for (const table of deltaTables) {
          await tx.execute(
            `UPDATE ${table} SET acked_at = ? WHERE sale_id = ? AND acked_at IS NULL`,
            [now, row.id],
          )
        }

        const draftId = draftCustomerId(row.payload)
        const resolvedId = result.resolved?.customerId
        if (draftId && resolvedId && draftId !== resolvedId) {
          await tx.execute(
            `UPDATE customer_draft SET linked_customer_id = ?, acked_at = ? WHERE id = ?`,
            [resolvedId, now, draftId],
          )
          await tx.execute(`UPDATE sale SET customer_id = ? WHERE id = ? AND customer_id = ?`, [
            resolvedId,
            row.id,
            draftId,
          ])
          await tx.execute(
            `UPDATE local_credit_delta SET customer_id = ?
              WHERE sale_id = ? AND customer_id = ?`,
            [resolvedId, row.id, draftId],
          )
          await tx.execute(
            `UPDATE local_loyalty_delta SET customer_id = ?
              WHERE sale_id = ? AND customer_id = ?`,
            [resolvedId, row.id, draftId],
          )
        }
      })
    },

    async markRejected(row, result, now) {
      const code = result.error?.code ?? 'REJECTED'
      const message = result.error?.message ?? 'The server rejected this transaction'
      await db.execute(
        `UPDATE outbox
            SET status = 'dead_letter', server_result = ?, last_error_code = ?,
                last_error_message = ?, next_attempt_at = NULL, updated_at = ?
          WHERE id = ?`,
        [JSON.stringify(result), code, message.slice(0, 200), now, row.id],
      )
    },

    async deadLetterBatch(rows, code, message, now) {
      await db.writeTransaction(async (tx) => {
        await updateRows(
          tx,
          rows,
          `UPDATE outbox
              SET status = 'dead_letter', last_error_code = ?, last_error_message = ?,
                  last_error = ?, next_attempt_at = NULL, updated_at = ?
            WHERE id = ?`,
          (row) => [code, message.slice(0, 200), errorSummary(code, message), now, row.id],
        )
      })
    },

    async backoffRows(rows, delayMs, code, message, now) {
      const next = new Date(Date.parse(now) + delayMs).toISOString()
      await db.writeTransaction(async (tx) => {
        await updateRows(
          tx,
          rows,
          `UPDATE outbox
              SET status = 'pending', attempts = attempts + 1, next_attempt_at = ?,
                  last_error_code = ?, last_error_message = ?, last_error = ?, updated_at = ?
            WHERE id = ?`,
          (row) => [next, code, message.slice(0, 200), errorSummary(code, message), now, row.id],
        )
      })
    },

    async delayRows(rows, nextAttemptAt, now) {
      await db.writeTransaction(async (tx) => {
        await updateRows(
          tx,
          rows,
          `UPDATE outbox SET status = 'pending', next_attempt_at = ?, updated_at = ?
            WHERE id = ?`,
          (row) => [nextAttemptAt, now, row.id],
        )
      })
    },

    /** Returns ambiguous/auth-paused rows to `pending` without a backoff. */
    async releaseRows(rows, now) {
      await db.writeTransaction(async (tx) => {
        await updateRows(
          tx,
          rows,
          `UPDATE outbox SET status = 'pending', next_attempt_at = NULL, updated_at = ?
            WHERE id = ?`,
          (row) => [now, row.id],
        )
      })
    },

    async retryDeadLetter(id, now) {
      await db.execute(
        `UPDATE outbox
            SET status = 'pending', attempts = 0, next_attempt_at = NULL,
                last_error = NULL, last_error_code = NULL, last_error_message = NULL,
                server_result = NULL, acked_at = NULL, updated_at = ?
          WHERE id = ? AND status = 'dead_letter'`,
        [now, id],
      )
    },

    async counts() {
      const row = await db.getOptional<{
        pending: number
        dead_letters: number
        conflicts: number
      }>(
        `SELECT
           COALESCE(SUM(CASE WHEN status IN ('pending', 'in_flight') THEN 1 ELSE 0 END), 0) AS pending,
           COALESCE(SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END), 0) AS dead_letters,
           COALESCE(SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END), 0) AS conflicts
         FROM outbox`,
      )
      return {
        pending: row?.pending ?? 0,
        deadLetters: row?.dead_letters ?? 0,
        conflicts: row?.conflicts ?? 0,
      }
    },

    async listRecent(limit) {
      const rows = await db.getAll<OutboxDbRow>(
        `SELECT ${OUTBOX_COLUMNS_QUALIFIED}, s.receipt_number AS receipt_number
           FROM outbox o
           LEFT JOIN sale s ON s.id = o.id
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT ?`,
        [limit],
      )
      return rows.flatMap((row) => {
        const mapped = toRow(row)
        return mapped ? [mapped] : []
      })
    },

    async pruneAcked(beforeIso) {
      const row = await db.getOptional<{ count: number }>(
        `SELECT COUNT(*) AS count FROM outbox
          WHERE status = 'acked' AND acked_at IS NOT NULL AND acked_at < ?`,
        [beforeIso],
      )
      if (!row?.count) return 0
      await db.execute(
        `DELETE FROM outbox WHERE status = 'acked' AND acked_at IS NOT NULL AND acked_at < ?`,
        [beforeIso],
      )
      return row.count
    },

    async readLastSuccessAt() {
      const row = await db.getOptional<{ value: string }>(
        `SELECT value FROM device_setting WHERE key = 'sync.lastUploadAt'`,
      )
      return row?.value ?? null
    },

    async writeLastSuccessAt(iso) {
      const now = new Date().toISOString()
      await db.execute(
        `INSERT OR REPLACE INTO device_setting (id, key, value, updated_at)
         VALUES ('sync.lastUploadAt', 'sync.lastUploadAt', ?, ?)`,
        [iso, now],
      )
    },
  }
}
