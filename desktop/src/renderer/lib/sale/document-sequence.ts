import type { PowerSyncDatabase, Transaction } from '@powersync/web'
import { accraDay } from '@sceptre/shared'
import { nextDocumentValue, peekDocumentValue } from '../document-sequence'

/**
 * Offline receipt numbering (D13).
 *
 * `${terminal.code}-${YYYYMMDD}-${NNNN}`, allocated at commit time from the
 * terminal's local `document_sequence`. The tender screen only *peeks* at the
 * next number so the cashier can see what the receipt will say; the sale
 * transaction consumes it, so the printed number is the stored number.
 */

export const RECEIPT_SCOPE = 'sale'

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
  const next = await peekDocumentValue(db, terminalId, RECEIPT_SCOPE, day)
  return formatReceiptNumber(terminalCode, day, next)
}

/** Consumes the sequence. Must run inside the sale's transaction. */
export async function allocateReceiptNumber(
  tx: Transaction,
  terminalId: string,
  terminalCode: string,
  now = new Date(),
): Promise<string> {
  const day = accraDay(now)
  const sequence = await nextDocumentValue(tx, terminalId, RECEIPT_SCOPE, day)
  return formatReceiptNumber(terminalCode, day, sequence)
}
