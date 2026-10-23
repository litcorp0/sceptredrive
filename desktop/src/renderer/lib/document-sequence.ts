import type { Transaction } from '@powersync/web'

/**
 * Terminal-scoped document numbering (D13).
 *
 * `document_sequence` is local-only and keyed by `(terminal_id, scope, day)`.
 * A terminal can be offline for a whole day and still print a readable,
 * collision-free number: the sequence increments inside the caller's
 * transaction, so a rolled-back sale never burns a number and a committed sale
 * never reuses one.
 */

/** Anything that can run a single-row read: the database or an open transaction. */
export interface SqlReader {
  getOptional<T>(sql: string, parameters?: unknown[]): Promise<T | null>
}

export function nextValue(lastValue: number | null | undefined): number {
  const base = Number.isInteger(lastValue) && (lastValue ?? 0) >= 0 ? (lastValue as number) : 0
  return base + 1
}

export async function peekDocumentValue(
  reader: SqlReader,
  terminalId: string,
  scope: string,
  day: string,
): Promise<number> {
  const row = await reader.getOptional<{ last_value: number }>(
    'SELECT last_value FROM document_sequence WHERE terminal_id = ? AND scope = ? AND day = ?',
    [terminalId, scope, day],
  )
  return nextValue(row?.last_value)
}

/** Allocates the next value **inside the caller's transaction**. */
export async function nextDocumentValue(
  tx: Transaction,
  terminalId: string,
  scope: string,
  day: string,
): Promise<number> {
  const next = await peekDocumentValue(tx, terminalId, scope, day)
  await tx.execute(
    `INSERT OR REPLACE INTO document_sequence (id, terminal_id, scope, day, last_value)
     VALUES (?, ?, ?, ?, ?)`,
    [`${terminalId}:${scope}:${day}`, terminalId, scope, day, next],
  )
  return next
}
