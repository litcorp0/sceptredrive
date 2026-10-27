import type { PowerSyncDatabase, Transaction } from '@powersync/web'
import {
  can,
  isElectronicTender,
  REFUND_REASONS,
  type RefundReason,
  refundAllocationProblem,
} from '@sceptre/shared'
import { getBinding } from '../auth/bindings'
import { requireStaffSession } from '../auth/staff-session'
import type { CartOverrideProof } from '../cart/types'
import { uuidv7 } from '../id'
import { notifyOutboxChanged } from '../outbox/outbox-events'
import { insertStockDeltas } from '../sale/sale-repository'
import { findOpenShift, insertOutbox } from '../shift/shift-repository'
import { allocateRefundNumber } from './refund-numbering'
import {
  priceRefundLines,
  type RefundComponentTotals,
  refundableLineQuantity,
} from './refund-pricing'
import { loadRefundSource, readLocalTerminal } from './refund-repository'
import { refundNoteProblem } from './refund-rules'
import {
  RefundError,
  type RefundRequestedLine,
  type RefundRequestedTender,
  type RefundSource,
} from './refund-types'

/**
 * Writing a refund on the till (Plan 10 Task 2; P13-D17/D18/D19/D22).
 *
 * One local transaction, no network: a cash refund has to work with the cable
 * out. The server is still authoritative — it re-derives every cap under a lock
 * and refuses a self-approval — but a till that can build an impossible refund
 * is a till that uploads a refusal, so the same shared arithmetic runs here
 * first.
 *
 * Electronic tenders are written `PENDING` and are never sent to the payment
 * client from here: the server dispatches the provider refund after the upload
 * (P13-D26). The till must show that status, never claim it settled.
 */

export interface RefundInput {
  saleId: string
  lines: RefundRequestedLine[]
  tenders: RefundRequestedTender[]
  reasonCode: RefundReason
  note?: string | null
  approval: CartOverrideProof
}

export interface RefundTenderResult {
  saleTenderId: string
  sequence: number
  method: RefundSource['tenders'][number]['method']
  amountMinor: number
  status: 'SETTLED' | 'PENDING'
  paymentId: string | null
}

export interface RefundResult {
  refundId: string
  number: string
  refundedMinor: number
  occurredAt: string
  reasonCode: RefundReason
  note: string | null
  lines: Array<{
    saleLineId: string
    name: string
    quantity: number
    restock: RefundRequestedLine['restock']
    damageReason: string | null
    totalMinor: number
  }>
  tenders: RefundTenderResult[]
  totals: RefundComponentTotals
  managerStaffId: string
}

const REFUND_PROBLEM_COPY: Record<
  'EXCEEDS_LINE' | 'EXCEEDS_TENDER' | 'EXCEEDS_SALE' | 'SUM_MISMATCH' | 'NO_ALLOCATION',
  { code: RefundError['code']; message: string }
> = {
  EXCEEDS_LINE: { code: 'EXCEEDS_LINE', message: 'That is more than is left of this line' },
  EXCEEDS_TENDER: { code: 'EXCEEDS_TENDER', message: 'That is more than this tender holds' },
  EXCEEDS_SALE: { code: 'EXCEEDS_SALE', message: 'That is more than this sale kept' },
  SUM_MISMATCH: {
    code: 'SUM_MISMATCH',
    message: 'The tender allocations must add up to the refunded amount',
  },
  NO_ALLOCATION: {
    code: 'NO_ALLOCATION',
    message: 'A refund needs at least one line and one tender',
  },
}

interface RefundRow {
  id: string
  number: string
  saleId: string
  shiftId: string
  reasonCode: RefundReason
  note: string | null
  refundedMinor: number
  approvedByStaffId: string
  approvedAt: string
  occurredAt: string
}

async function insertRefundRow(
  tx: Transaction,
  row: RefundRow,
  totals: RefundComponentTotals,
): Promise<void> {
  await tx.execute(
    `INSERT INTO refund (id, number, sale_id, shift_id, reason_code, note, refunded_minor,
                         base_minor, vat_minor, nhil_minor, getfund_minor, tax_total_minor,
                         total_minor, approved_by_staff_id, approved_at, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.number,
      row.saleId,
      row.shiftId,
      row.reasonCode,
      row.note,
      row.refundedMinor,
      totals.baseMinor,
      totals.vatMinor,
      totals.nhilMinor,
      totals.getfundMinor,
      totals.taxTotalMinor,
      totals.totalMinor,
      row.approvedByStaffId,
      row.approvedAt,
      row.occurredAt,
      row.occurredAt,
    ],
  )
}

export interface PreparedRefund {
  rows: RefundResult
  lines: Array<{
    saleLineId: string
    productId: string
    quantity: number
    restock: RefundRequestedLine['restock']
    damageReason: string | null
    totalMinor: number
  }>
  tenders: RefundTenderResult[]
  stockDeltas: Array<{ productId: string; quantityDelta: number }>
}

/**
 * The pure half: reads nothing, writes nothing, and throws the refusal the
 * screen shows. Exported so the caps are testable without a database.
 */
export function prepareRefund(
  source: RefundSource,
  input: RefundInput,
  number: string,
  occurredAt: string,
): PreparedRefund {
  if (!REFUND_REASONS.includes(input.reasonCode)) {
    throw new RefundError('INVALID_REASON', 'Choose a reason for this refund')
  }
  const noteProblem = refundNoteProblem(input.reasonCode, input.note ?? null)
  if (noteProblem) {
    throw new RefundError('NOTE_REQUIRED', noteProblem)
  }

  const pricing = priceRefundLines(source, input.lines)

  const problem = refundAllocationProblem({
    allocation: {
      lines: input.lines.map((line) => ({
        saleLineId: line.saleLineId,
        quantity: line.quantity,
      })),
      tenders: input.tenders.map((tender) => ({
        saleTenderId: tender.saleTenderId,
        amountMinor: tender.amountMinor,
      })),
    },
    lines: source.lines.map((line) => ({
      saleLineId: line.saleLineId,
      quantity: line.quantity,
      refundedQuantity: line.quantity - refundableLineQuantity(line),
    })),
    tenders: source.tenders.map((tender) => ({
      saleTenderId: tender.saleTenderId,
      method: tender.method,
      amountMinor: tender.amountMinor,
      refundedMinor: tender.alreadyRefundedMinor,
    })),
    refundedMinor: pricing.refundedMinor,
    saleTenderTotalMinor: source.tenderTotalMinor,
    saleChangeMinor: source.changeMinor,
    previouslyRefundedMinor: source.previouslyRefundedMinor,
  })
  if (problem) {
    const copy = REFUND_PROBLEM_COPY[problem]
    throw new RefundError(copy.code, copy.message)
  }

  const tenders: RefundTenderResult[] = input.tenders.map((allocation, index) => {
    const tender = source.tenders.find((row) => row.saleTenderId === allocation.saleTenderId)
    if (!tender) {
      throw new RefundError('INVALID_TENDER', 'That tender is not on this sale')
    }
    const electronic = isElectronicTender(tender.method)
    if (electronic && !tender.paymentId) {
      throw new RefundError(
        'INVALID_TENDER',
        'This electronic tender has no payment to refund against',
      )
    }
    return {
      saleTenderId: tender.saleTenderId,
      sequence: index + 1,
      method: tender.method,
      amountMinor: allocation.amountMinor,
      status: electronic ? 'PENDING' : 'SETTLED',
      paymentId: tender.paymentId,
    }
  })

  // Stock comes back only for resalable goods; a damaged or unreturned unit
  // never left sellable stock, so posting a movement would invent one
  // (P13-D22). Two refund lines of one product are one movement.
  const byProduct = new Map<string, number>()
  for (const line of pricing.lines) {
    if (line.restock !== 'RESALABLE') continue
    byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + line.quantity)
  }

  return {
    lines: pricing.lines.map((line) => ({
      saleLineId: line.saleLineId,
      productId: line.productId,
      quantity: line.quantity,
      restock: line.restock,
      damageReason: line.damageReason,
      totalMinor: line.totalMinor,
    })),
    tenders,
    stockDeltas: [...byProduct.entries()].map(([productId, quantityDelta]) => ({
      productId,
      quantityDelta,
    })),
    rows: {
      refundId: '',
      number,
      refundedMinor: pricing.refundedMinor,
      occurredAt,
      reasonCode: input.reasonCode,
      note: input.note?.trim() || null,
      lines: pricing.lines.map((line) => ({
        saleLineId: line.saleLineId,
        name: line.name,
        quantity: line.quantity,
        restock: line.restock,
        damageReason: line.damageReason,
        totalMinor: line.totalMinor,
      })),
      tenders,
      totals: pricing.totals,
      managerStaffId: input.approval.approverStaffId,
    },
  }
}

/**
 * Writes the refund: the number, the three documents, the stock deltas, and the
 * outbox row, all in one transaction.
 */
export async function createRefund(
  db: PowerSyncDatabase,
  input: RefundInput,
  options: { now?: Date; id?: string } = {},
): Promise<RefundResult> {
  const session = requireStaffSession()
  const binding = await getBinding(db, session.bindingId)
  if (!binding || !binding.isActive) {
    throw new RefundError('NOT_SIGNED_IN', 'Sign in with a PIN before refunding')
  }

  const config = await readLocalTerminal(db)
  if (!config) {
    throw new RefundError('NOT_SIGNED_IN', 'This terminal is not configured yet')
  }

  const shift = await findOpenShift(db, config.terminal_id)
  if (!shift) {
    throw new RefundError('SHIFT_REQUIRED', 'Open a shift before refunding money')
  }

  // The approval ships in the payload and the server revalidates it. The same
  // no-self-approval rule is enforced here so the till does not upload a
  // document that is certain to be refused (P13-D24).
  if (
    input.approval.approverUserId === session.userId ||
    input.approval.approverStaffId === session.staffId
  ) {
    throw new RefundError('SELF_APPROVAL', 'A manager cannot approve their own refund')
  }
  if (!can(input.approval.approverRole, 'pos.refund')) {
    throw new RefundError('SELF_APPROVAL', 'This staff member cannot approve a refund')
  }

  const now = options.now ?? new Date()
  const occurredAt = now.toISOString()
  const refundId = options.id ?? uuidv7(now.getTime())

  const prepared = await db.writeTransaction(async (tx) => {
    const source = await loadRefundSource(tx, input.saleId, config.terminal_id)
    const number = await allocateRefundNumber(tx, config.terminal_id, config.terminal_code, now)
    const ready = prepareRefund(source, input, number, occurredAt)

    await insertRefundRow(
      tx,
      {
        id: refundId,
        number,
        saleId: input.saleId,
        shiftId: shift.id,
        reasonCode: input.reasonCode,
        note: ready.rows.note,
        refundedMinor: ready.rows.refundedMinor,
        approvedByStaffId: input.approval.approverStaffId,
        approvedAt: input.approval.approvedAt,
        occurredAt,
      },
      ready.rows.totals,
    )

    for (const line of ready.lines) {
      await tx.execute(
        `INSERT INTO refund_line (id, refund_id, sale_line_id, quantity, restock,
                                  damage_reason, total_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv7(now.getTime()),
          refundId,
          line.saleLineId,
          line.quantity,
          line.restock,
          line.damageReason,
          line.totalMinor,
        ],
      )
    }

    for (const tender of ready.tenders) {
      await tx.execute(
        `INSERT INTO refund_tender (id, refund_id, sequence, method, amount_minor,
                                    sale_tender_id, payment_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv7(now.getTime()),
          refundId,
          tender.sequence,
          tender.method,
          tender.amountMinor,
          tender.saleTenderId,
          tender.paymentId,
          tender.status,
        ],
      )
    }

    await insertStockDeltas(
      tx,
      ready.stockDeltas.map((row) => ({
        saleId: refundId,
        productId: row.productId,
        quantityDelta: row.quantityDelta,
        ackedAt: null,
      })),
    )

    await insertOutbox(tx, {
      id: refundId,
      clientTransactionId: refundId,
      type: 'REFUND',
      occurredAt,
      payload: {
        saleId: input.saleId,
        number,
        shiftId: shift.id,
        cashier: {
          userId: session.userId,
          staffId: session.staffId,
          bindingId: binding.bindingId,
          bindingToken: binding.bindingToken,
          pinVersion: binding.pinVersion,
        },
        reasonCode: input.reasonCode,
        note: ready.rows.note,
        approval: {
          staffId: input.approval.approverStaffId,
          userId: input.approval.approverUserId,
          bindingId: input.approval.bindingId,
          pinVersion: input.approval.pinVersion,
          reasonCode: input.approval.reasonCode,
          note: input.approval.note,
          occurredAt: input.approval.approvedAt,
        },
        lines: ready.lines.map((line) => ({
          saleLineId: line.saleLineId,
          quantity: line.quantity,
          restock: line.restock,
          damageReason: line.damageReason,
        })),
        tenders: input.tenders.map((tender) => ({
          saleTenderId: tender.saleTenderId,
          amountMinor: tender.amountMinor,
        })),
        refundedMinor: ready.rows.refundedMinor,
        occurredAt,
      },
    })

    return { ready, number }
  })

  // The uploader subscribes to this; a write that returned before the event
  // would leave the row waiting for the next unrelated change.
  notifyOutboxChanged()

  return { ...prepared.ready.rows, refundId }
}
