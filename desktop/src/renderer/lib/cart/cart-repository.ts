import type { TaxCategory } from '@gikautos/shared'
import type { PowerSyncDatabase, Transaction } from '@powersync/web'
import type { CartCustomer, CartLine, CartOverrideProof, CartState } from './types'

/**
 * Cart draft persistence (Plan 06 Task 1).
 *
 * The in-progress sale survives a crash, a power cut, or a mis-click on Close.
 * The draft id **is** the future sale id, so completing the sale reuses the id
 * for the receipt, the local sale row, and the outbox row.
 *
 * `toDraftRows` / `fromDraftRows` are pure so the round-trip is unit-testable
 * without a database; the database functions are thin.
 */

export interface CartDraftRow {
  id: string
  shift_id: string | null
  customer_id: string | null
  customer_draft_id: string | null
  customer_name: string | null
  customer_phone: string | null
  loyalty_redeem_points: number
  sale_discount_minor: number
  sale_discount_reason: string | null
  sale_discount_note: string | null
  sale_discount_override: string | null
  credit_override: string | null
  updated_at: string
}

export interface CartDraftLineRow {
  draft_id: string
  line_number: number
  line_id: string
  product_id: string
  sku: string
  name: string
  barcode: string | null
  quantity: number
  unit_price_minor: number
  tax_category: string
  line_discount_minor: number
  line_discount_reason: string | null
  line_discount_note: string | null
  line_discount_override: string | null
}

const PROOF_STRING_KEYS = [
  'approverUserId',
  'approverStaffId',
  'approverRole',
  'bindingId',
  'reasonCode',
  'approvedAt',
] as const

/** Parses a stored proof; anything malformed is dropped rather than trusted. */
export function parseProof(json: string | null): CartOverrideProof | null {
  if (!json) return null
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    for (const key of PROOF_STRING_KEYS) {
      if (typeof record[key] !== 'string') return null
    }
    if (!Number.isSafeInteger(record.pinVersion) || (record.pinVersion as number) < 0) {
      return null
    }
    if (
      record.approverRole !== 'ADMIN' &&
      record.approverRole !== 'MANAGER' &&
      record.approverRole !== 'CASHIER'
    ) {
      return null
    }
    return {
      approverUserId: record.approverUserId as string,
      approverStaffId: record.approverStaffId as string,
      approverRole: record.approverRole,
      bindingId: record.bindingId as string,
      pinVersion: record.pinVersion as number,
      reasonCode: record.reasonCode as string,
      note: typeof record.note === 'string' ? record.note : null,
      approvedAt: record.approvedAt as string,
    }
  } catch {
    return null
  }
}

export function toDraftRows(state: CartState): {
  draft: CartDraftRow
  lines: CartDraftLineRow[]
} {
  return {
    draft: {
      id: state.saleId,
      shift_id: state.shiftId,
      customer_id: state.customer?.customerId ?? null,
      customer_draft_id: state.customer?.draftId ?? null,
      customer_name: state.customer?.name ?? null,
      customer_phone: state.customer?.phone ?? null,
      loyalty_redeem_points: state.loyaltyRedeemPoints,
      sale_discount_minor: state.saleDiscount?.amountMinor ?? 0,
      sale_discount_reason: state.saleDiscount?.reasonCode ?? null,
      sale_discount_note: state.saleDiscount?.note ?? null,
      sale_discount_override: state.saleDiscount?.override
        ? JSON.stringify(state.saleDiscount.override)
        : null,
      credit_override: state.creditOverride ? JSON.stringify(state.creditOverride) : null,
      updated_at: state.updatedAt,
    },
    lines: state.lines.map((line, index) => ({
      draft_id: state.saleId,
      line_number: index + 1,
      line_id: line.id,
      product_id: line.productId,
      sku: line.sku,
      name: line.name,
      barcode: line.barcode,
      quantity: line.quantity,
      unit_price_minor: line.unitPriceMinor,
      tax_category: line.taxCategory,
      line_discount_minor: line.lineDiscountMinor,
      line_discount_reason: line.discountReasonCode,
      line_discount_note: line.discountNote,
      line_discount_override: line.discountOverride ? JSON.stringify(line.discountOverride) : null,
    })),
  }
}

export function fromDraftRows(draft: CartDraftRow, lines: CartDraftLineRow[]): CartState {
  const customer: CartCustomer | null = draft.customer_id
    ? {
        customerId: draft.customer_id,
        draftId: null,
        name: draft.customer_name ?? '',
        phone: draft.customer_phone ?? '',
        isDraft: false,
      }
    : draft.customer_draft_id
      ? {
          customerId: null,
          draftId: draft.customer_draft_id,
          name: draft.customer_name ?? '',
          phone: draft.customer_phone ?? '',
          isDraft: true,
        }
      : null

  const cartLines: CartLine[] = [...lines]
    .sort((left, right) => left.line_number - right.line_number)
    .map((row) => ({
      id: row.line_id,
      productId: row.product_id,
      sku: row.sku,
      name: row.name,
      barcode: row.barcode,
      quantity: row.quantity,
      unitPriceMinor: row.unit_price_minor,
      taxCategory: row.tax_category as TaxCategory,
      lineDiscountMinor: row.line_discount_minor,
      discountReasonCode: row.line_discount_reason as CartLine['discountReasonCode'],
      discountNote: row.line_discount_note,
      discountOverride: parseProof(row.line_discount_override),
    }))

  return {
    saleId: draft.id,
    shiftId: draft.shift_id,
    lines: cartLines,
    saleDiscount:
      draft.sale_discount_minor > 0 && draft.sale_discount_reason
        ? {
            amountMinor: draft.sale_discount_minor,
            reasonCode: draft.sale_discount_reason as NonNullable<
              CartState['saleDiscount']
            >['reasonCode'],
            note: draft.sale_discount_note,
            override: parseProof(draft.sale_discount_override),
          }
        : null,
    loyaltyRedeemPoints: draft.loyalty_redeem_points,
    customer,
    creditOverride: parseProof(draft.credit_override),
    updatedAt: draft.updated_at,
  }
}

/**
 * The draft for this shift, if one was left behind by a crash. Drafts from a
 * previous (closed) shift are discarded: a cart belongs to the shift it was
 * built in.
 *
 * A draft whose id already exists as a committed sale is also discarded. The
 * cart store writes on a 150 ms debounce, so a completed sale can race one last
 * write; the sale is the truth and the draft must never resurrect it.
 */
export async function loadCartDraft(
  db: PowerSyncDatabase,
  shiftId: string | null,
): Promise<CartState | null> {
  if (!shiftId) {
    await db.execute('DELETE FROM cart_draft')
    return null
  }

  await db.execute('DELETE FROM cart_draft WHERE shift_id IS NULL OR shift_id <> ?', [shiftId])
  await db.execute('DELETE FROM cart_draft WHERE id IN (SELECT id FROM sale)')
  await db.execute('DELETE FROM cart_draft_line WHERE draft_id NOT IN (SELECT id FROM cart_draft)')

  const draft = await db.getOptional<CartDraftRow>(
    'SELECT * FROM cart_draft WHERE shift_id = ? ORDER BY updated_at DESC LIMIT 1',
    [shiftId],
  )
  if (!draft) return null

  const lines = await db.getAll<CartDraftLineRow>(
    'SELECT * FROM cart_draft_line WHERE draft_id = ? ORDER BY line_number',
    [draft.id],
  )
  if (lines.length === 0) {
    await db.execute('DELETE FROM cart_draft WHERE id = ?', [draft.id])
    return null
  }

  return fromDraftRows(draft, lines)
}

async function writeDraft(tx: Transaction, state: CartState): Promise<void> {
  const { draft, lines } = toDraftRows(state)

  await tx.execute('DELETE FROM cart_draft WHERE id <> ?', [draft.id])
  await tx.execute('DELETE FROM cart_draft_line WHERE draft_id <> ?', [draft.id])
  await tx.execute('DELETE FROM cart_draft_line WHERE draft_id = ?', [draft.id])

  await tx.execute(
    `INSERT OR REPLACE INTO cart_draft
       (id, shift_id, customer_id, customer_draft_id, customer_name, customer_phone,
        loyalty_redeem_points, sale_discount_minor, sale_discount_reason, sale_discount_note,
        sale_discount_override, credit_override, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      draft.id,
      draft.shift_id,
      draft.customer_id,
      draft.customer_draft_id,
      draft.customer_name,
      draft.customer_phone,
      draft.loyalty_redeem_points,
      draft.sale_discount_minor,
      draft.sale_discount_reason,
      draft.sale_discount_note,
      draft.sale_discount_override,
      draft.credit_override,
      draft.updated_at,
    ],
  )

  for (const line of lines) {
    await tx.execute(
      `INSERT INTO cart_draft_line
         (draft_id, line_number, line_id, product_id, sku, name, barcode, quantity,
          unit_price_minor, tax_category, line_discount_minor, line_discount_reason,
          line_discount_note, line_discount_override)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        line.draft_id,
        line.line_number,
        line.line_id,
        line.product_id,
        line.sku,
        line.name,
        line.barcode,
        line.quantity,
        line.unit_price_minor,
        line.tax_category,
        line.line_discount_minor,
        line.line_discount_reason,
        line.line_discount_note,
        line.line_discount_override,
      ],
    )
  }
}

/** Writes the cart and its lines in one transaction; safe to call on a debounce. */
export async function saveCartDraft(db: PowerSyncDatabase, state: CartState): Promise<void> {
  await db.writeTransaction(async (tx) => {
    await writeDraft(tx, state)
  })
}

/** After a completed sale the draft is gone; the next cart starts with a new id. */
export async function clearCartDrafts(db: PowerSyncDatabase): Promise<void> {
  await db.writeTransaction(async (tx) => {
    await tx.execute('DELETE FROM cart_draft_line')
    await tx.execute('DELETE FROM cart_draft')
  })
}
