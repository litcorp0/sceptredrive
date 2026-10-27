import type { Transaction } from '@powersync/web'
import { accraDay } from '@sceptre/shared'
import { nextDocumentValue } from '../document-sequence'

/**
 * Offline numbering for the two documents Plan 10 adds (P13-D37).
 *
 * A refund or a repayment can happen with the cable unplugged, so neither can
 * wait on a server sequence. Both are allocated inside the transaction that
 * writes the document, which means a rolled-back write burns no number and a
 * committed one never reuses it.
 */

export const REFUND_SCOPE = 'refund'
export const REPAYMENT_SCOPE = 'repayment'

export function formatRefundNumber(terminalCode: string, day: string, sequence: number): string {
  return `RF-${terminalCode}-${day}-${String(sequence).padStart(4, '0')}`
}

export function formatRepaymentNumber(terminalCode: string, day: string, sequence: number): string {
  return `RP-${terminalCode}-${day}-${String(sequence).padStart(4, '0')}`
}

/** Consumes the refund sequence. Must run inside the refund's transaction. */
export async function allocateRefundNumber(
  tx: Transaction,
  terminalId: string,
  terminalCode: string,
  now = new Date(),
): Promise<string> {
  const day = accraDay(now)
  const sequence = await nextDocumentValue(tx, terminalId, REFUND_SCOPE, day)
  return formatRefundNumber(terminalCode, day, sequence)
}

/** Consumes the repayment sequence. Must run inside the repayment's transaction. */
export async function allocateRepaymentNumber(
  tx: Transaction,
  terminalId: string,
  terminalCode: string,
  now = new Date(),
): Promise<string> {
  const day = accraDay(now)
  const sequence = await nextDocumentValue(tx, terminalId, REPAYMENT_SCOPE, day)
  return formatRepaymentNumber(terminalCode, day, sequence)
}
