import type { DbExecutor } from '@sceptre/db'
import { AppError } from '../../http/errors.ts'
import { isUniqueViolation } from './db-errors.ts'
import { findBranchCode, incrementSequenceRow, insertSequenceRow } from './sequences.repository.ts'
import { getSettingValue } from './settings.service.ts'

/**
 * Branch-and-month document numbers: `PO-ACC-202610-0001`.
 *
 * The counter row is locked with `FOR UPDATE`, so two concurrent submits on the
 * same branch and month cannot receive the same number. A rolled-back
 * transaction burns its number and the gap is accepted — a duplicate would be a
 * duplicate purchase order, which is the failure worth paying a gap to avoid.
 */

export type DocumentKind =
  | 'purchase_order'
  | 'supplier_return'
  | 'supplier_credit_note'
  | 'stock_write_off'

export const DOCUMENT_KINDS: Record<
  DocumentKind,
  {
    prefixKey:
      | 'procurement.orderPrefix'
      | 'procurement.returnPrefix'
      | 'procurement.creditNotePrefix'
      | 'inventory.writeOffPrefix'
    label: string
    pad: number
  }
> = {
  purchase_order: {
    prefixKey: 'procurement.orderPrefix',
    label: 'purchase order number',
    pad: 4,
  },
  supplier_return: {
    prefixKey: 'procurement.returnPrefix',
    label: 'purchase return number',
    pad: 4,
  },
  supplier_credit_note: {
    prefixKey: 'procurement.creditNotePrefix',
    label: 'credit note number',
    pad: 4,
  },
  stock_write_off: {
    prefixKey: 'inventory.writeOffPrefix',
    label: 'stock write-off number',
    pad: 4,
  },
}

/**
 * `YYYY-MM` in Africa/Accra. The zone is UTC+0 with no DST, so a UTC month
 * boundary *is* an Accra month boundary; no timezone library is involved.
 */
export function currentDocumentPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

export async function allocateDocumentNumber(
  kind: DocumentKind,
  branchId: string,
  executor: DbExecutor,
  now: Date = new Date(),
): Promise<{ number: string; sequenceValue: number }> {
  const format = DOCUMENT_KINDS[kind]
  const period = currentDocumentPeriod(now)
  const prefix = await getSettingValue(format.prefixKey, {}, executor)
  const branchCode = await findBranchCode(branchId, executor)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const bumped = await incrementSequenceRow(branchId, kind, period, executor)
    if (bumped) {
      const serial = String(bumped.value).padStart(format.pad, '0')
      return {
        number: `${prefix}-${branchCode}-${period.replace('-', '')}-${serial}`,
        sequenceValue: bumped.value,
      }
    }

    try {
      // The counter stores the last serial issued, so a fresh row starts at 0 and
      // the next increment returns 1. `insert … on conflict do nothing` makes the
      // first-use race safe: the loser retries and increments the winner's row.
      await insertSequenceRow(branchId, kind, period, 0, executor)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
    }
  }

  throw new AppError(500, 'INTERNAL', `Could not allocate a ${format.label}`)
}
