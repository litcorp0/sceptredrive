import type { PowerSyncDatabase } from '@powersync/web'
import { accraDay } from '../shift/shift-service'

/**
 * Offline receipt numbering (D13).
 *
 * `${terminal.code}-${YYYYMMDD}-${NNNN}`, allocated from the terminal's local
 * `document_sequence` at commit time. The tender screen only *peeks* at the
 * next number so the cashier can see what the receipt will say; the sequence is
 * consumed when the sale is written, in the same transaction.
 */

export function formatReceiptNumber(terminalCode: string, day: string, sequence: number): string {
  return `${terminalCode}-${day}-${String(sequence).padStart(4, '0')}`
}

export async function peekReceiptNumber(
  db: PowerSyncDatabase,
  terminalId: string,
  terminalCode: string,
  now = new Date(),
): Promise<string> {
  const day = accraDay(now)
  const row = await db.getOptional<{ last_value: number }>(
    'SELECT last_value FROM document_sequence WHERE terminal_id = ? AND scope = ? AND day = ?',
    [terminalId, 'sale', day],
  )
  return formatReceiptNumber(terminalCode, day, (row?.last_value ?? 0) + 1)
}
