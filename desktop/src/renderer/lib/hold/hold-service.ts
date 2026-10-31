import type { PowerSyncDatabase, Transaction } from '@powersync/web'
import {
  type CartVoidReason,
  type CatalogueSnapshotLine,
  type HoldDifference,
  type HoldLine,
  holdLabelProblem,
  MAX_HELD_CARTS,
  priceCart,
  repriceHeldCart,
  type TaxCategory,
} from '@sceptre/shared'
import { requireStaffSession } from '../auth/staff-session'
import { parseProof } from '../cart/cart-repository'
import { sanitizeCartState } from '../cart/reducer'
import {
  type CartPricingContext,
  type CartTotals,
  loyaltyValueMinor,
  pointsForValueMinor,
} from '../cart/totals'
import type { CartCustomer, CartOverrideProof, CartState, DiscountReasonCode } from '../cart/types'
import { DISCOUNT_REASON_CODES } from '../cart/types'
import { recordCartVoid } from '../cart/void-service'
import { uuidv7 } from '../id'
import { availablePoints } from '../loyalty/balance'

/**
 * Parked carts (P13-D29, P13-D35).
 *
 * A hold is terminal-scoped, not shift-scoped: it lives in its own tables beside
 * the draft so `loadCartDraft`'s shift pruning cannot touch it, and so a queue
 * survives a restart and a shift change. `cart_draft` keeps its single-active
 * invariant; recall **deletes** the hold in the transaction that writes the
 * recalled draft, so a hold cannot be served twice.
 *
 * Recall re-prices against today's catalogue and reports every difference. A
 * missing or archived product blocks completion until the cashier removes or
 * replaces the line; a loyalty redemption that no longer fits is reduced with an
 * explicit notice rather than spent against a balance that has moved.
 */

export type HoldErrorCode =
  | 'EMPTY_CART'
  | 'INVALID_LABEL'
  | 'HOLD_LIMIT'
  | 'NOT_FOUND'
  | 'NOT_SIGNED_IN'
  | 'NO_IDENTITY'

export class HoldError extends Error {
  readonly code: HoldErrorCode

  constructor(code: HoldErrorCode, message: string) {
    super(message)
    this.name = 'HoldError'
    this.code = code
  }
}

/** What a hold stores: the cart, priced at the moment it was parked. */
export interface HoldableCart {
  lines: CartState['lines']
  saleDiscount: CartState['saleDiscount']
  loyaltyRedeemPoints: number
  customer: CartCustomer | null
  totals: CartTotals
  shiftId: string | null
}

export interface HeldCartSummary {
  id: string
  label: string
  heldAt: string
  heldByUserId: string
  heldByStaffId: string
  heldByName: string | null
  /** Two letters for the chip; the full name is in the accessible label. */
  heldByInitials: string
  customerName: string | null
  itemCount: number
  totalMinor: number
}

export interface HoldCartResult {
  holdId: string
  label: string
  heldAt: string
}

export interface RecallLoyaltyNotice {
  requestedPoints: number
  points: number
  /** Null when the redemption survived unchanged. */
  notice: string | null
}

export interface RecallResult {
  holdId: string
  cart: CartState
  differences: HoldDifference[]
  blockingProductIds: string[]
  requiresAcknowledgement: boolean
  loyalty: RecallLoyaltyNotice
  /** The active basket that was parked to make room, when there was one. */
  autoHeld: { holdId: string; label: string } | null
}

interface HeldCartRow {
  id: string
  label: string
  held_at: string
  held_by_user_id: string
  held_by_staff_id: string
  shift_id: string | null
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  loyalty_redeem_points: number
  sale_discount_minor: number
  sale_discount_reason: string | null
  sale_discount_note: string | null
  sale_discount_override: string | null
  subtotal_minor: number
  total_minor: number
  item_count: number
}

interface HeldCartLineRow {
  hold_id: string
  line_number: number
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

const HELD_CART_COLUMNS = `id, label, held_at, held_by_user_id, held_by_staff_id, shift_id,
  customer_id, customer_name, customer_phone, loyalty_redeem_points, sale_discount_minor,
  sale_discount_reason, sale_discount_note, sale_discount_override, subtotal_minor, total_minor,
  item_count`

const HELD_LINE_COLUMNS = `hold_id, line_number, product_id, sku, name, barcode, quantity,
  unit_price_minor, tax_category, line_discount_minor, line_discount_reason, line_discount_note,
  line_discount_override`

/** `AM` for "Ama Mensah"; the staff id's tail when the name is unknown. */
export function staffInitials(name: string | null, staffId: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase()
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase()
  return staffId
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(-2)
    .toUpperCase()
}

function toHeldLine(row: HeldCartLineRow): HoldLine {
  return {
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    quantity: row.quantity,
    unitPriceMinor: row.unit_price_minor,
    taxCategory: row.tax_category as TaxCategory,
    lineDiscountMinor: row.line_discount_minor,
    lineDiscountReason: row.line_discount_reason,
    lineDiscountNote: row.line_discount_note,
  }
}

/** Next free `Cart #N`, so two auto-held baskets never share a name. */
export function nextCartLabel(labels: readonly string[]): string {
  const used = new Set<number>()
  for (const label of labels) {
    const match = /^Cart #(\d+)$/.exec(label.trim())
    if (match) used.add(Number(match[1]))
  }
  let next = 1
  while (used.has(next)) next += 1
  return `Cart #${next}`
}

function discountReason(value: string | null): DiscountReasonCode | null {
  return value && (DISCOUNT_REASON_CODES as readonly string[]).includes(value)
    ? (value as DiscountReasonCode)
    : value
      ? 'OTHER'
      : null
}

interface HeldLineInput {
  productId: string
  sku: string
  name: string
  barcode: string | null
  quantity: number
  unitPriceMinor: number
  taxCategory: TaxCategory
  lineDiscountMinor: number
  lineDiscountReason: string | null
  lineDiscountNote: string | null
  lineDiscountOverride: CartOverrideProof | null
}

async function insertHold(
  tx: Transaction,
  input: {
    holdId: string
    label: string
    heldAt: string
    heldByUserId: string
    heldByStaffId: string
    cart: HoldableCart
    lines: readonly HeldLineInput[]
  },
): Promise<void> {
  const { cart } = input
  await tx.execute(
    `INSERT INTO held_cart (${HELD_CART_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.holdId,
      input.label,
      input.heldAt,
      input.heldByUserId,
      input.heldByStaffId,
      cart.shiftId,
      cart.customer?.customerId ?? null,
      cart.customer?.name ?? null,
      cart.customer?.phone ?? null,
      cart.loyaltyRedeemPoints,
      cart.saleDiscount?.amountMinor ?? 0,
      cart.saleDiscount?.reasonCode ?? null,
      cart.saleDiscount?.note ?? null,
      cart.saleDiscount?.override ? JSON.stringify(cart.saleDiscount.override) : null,
      cart.totals.priced.subtotalMinor,
      cart.totals.priced.totalMinor,
      cart.totals.itemCount,
    ],
  )

  for (const [index, line] of input.lines.entries()) {
    await tx.execute(
      `INSERT INTO held_cart_line (id, ${HELD_LINE_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv7(),
        input.holdId,
        index + 1,
        line.productId,
        line.sku,
        line.name,
        line.barcode,
        line.quantity,
        line.unitPriceMinor,
        line.taxCategory,
        line.lineDiscountMinor,
        line.lineDiscountReason,
        line.lineDiscountNote,
        line.lineDiscountOverride ? JSON.stringify(line.lineDiscountOverride) : null,
      ],
    )
  }
}

function toHeldLineInputs(cart: HoldableCart): HeldLineInput[] {
  return cart.lines.map((line) => ({
    productId: line.productId,
    sku: line.sku,
    name: line.name,
    barcode: line.barcode,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    taxCategory: line.taxCategory,
    lineDiscountMinor: line.lineDiscountMinor,
    lineDiscountReason: line.discountReasonCode,
    lineDiscountNote: line.discountNote,
    lineDiscountOverride: line.discountOverride,
  }))
}

export async function countHeldCarts(db: PowerSyncDatabase): Promise<number> {
  const row = await db.getOptional<{ total: number }>('SELECT COUNT(*) AS total FROM held_cart')
  return row?.total ?? 0
}

export async function listHeldCarts(db: PowerSyncDatabase): Promise<HeldCartSummary[]> {
  const rows = await db.getAll<{
    id: string
    label: string
    held_at: string
    held_by_user_id: string
    held_by_staff_id: string
    held_by_name: string | null
    customer_name: string | null
    item_count: number
    total_minor: number
  }>(
    `SELECT hc.id, hc.label, hc.held_at, hc.held_by_user_id, hc.held_by_staff_id,
            sb.name AS held_by_name, hc.customer_name, hc.item_count, hc.total_minor
       FROM held_cart hc
       LEFT JOIN staff_binding sb ON sb.staff_id = hc.held_by_staff_id
      ORDER BY hc.held_at ASC`,
  )

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    heldAt: row.held_at,
    heldByUserId: row.held_by_user_id,
    heldByStaffId: row.held_by_staff_id,
    heldByName: row.held_by_name,
    heldByInitials: staffInitials(row.held_by_name, row.held_by_staff_id),
    customerName: row.customer_name,
    itemCount: row.item_count,
    totalMinor: row.total_minor,
  }))
}

/**
 * Parks the cart. The caller clears the draft **after** this resolves, so a
 * failed hold leaves the basket exactly where it was.
 */
export async function holdCart(
  db: PowerSyncDatabase,
  input: { label: string; cart: HoldableCart; now?: Date },
): Promise<HoldCartResult> {
  if (input.cart.lines.length === 0 || input.cart.totals.itemCount === 0) {
    throw new HoldError('EMPTY_CART', 'There is nothing to hold — add an item first')
  }

  let session: ReturnType<typeof requireStaffSession>
  try {
    session = requireStaffSession()
  } catch {
    throw new HoldError('NOT_SIGNED_IN', 'Sign in with a PIN before holding a cart')
  }

  const label = input.label.trim()
  const held = await countHeldCarts(db)
  const problem = holdLabelProblem(label, held)
  if (problem) {
    throw new HoldError(held >= MAX_HELD_CARTS ? 'HOLD_LIMIT' : 'INVALID_LABEL', problem)
  }

  const now = input.now ?? new Date()
  const holdId = uuidv7(now.getTime())
  const heldAt = now.toISOString()

  await db.writeTransaction(async (tx) => {
    await insertHold(tx, {
      holdId,
      label,
      heldAt,
      heldByUserId: session.userId,
      heldByStaffId: session.staffId,
      cart: input.cart,
      lines: toHeldLineInputs(input.cart),
    })
  })

  return { holdId, label, heldAt }
}

interface PosConfigRow {
  branch_id: string
  tax_mode: string
  config_json: string | null
}

const DEFAULT_POINTS_PER_CEDI = 100

/**
 * The pricing context recall re-prices through: today's tax mode and the
 * branch's loyalty rate, read from the cached session snapshot.
 */
export function heldPricingContext(row: {
  tax_mode: string
  config_json: string | null
}): CartPricingContext {
  let pointsPerCedi = DEFAULT_POINTS_PER_CEDI
  let earnPointsPerCedi = 1
  // A hold taken before the flag existed priced with tax, so an absent value is
  // `true` rather than `false`: a missing field must never silently untax a cart.
  let vatRegistered = true
  if (row.config_json) {
    try {
      const parsed = JSON.parse(row.config_json) as {
        vatRegistered?: boolean
        loyalty?: { pointsPerCedi?: number; earnPointsPerCedi?: number }
      }
      if (typeof parsed.vatRegistered === 'boolean') vatRegistered = parsed.vatRegistered
      const configuredPoints = parsed.loyalty?.pointsPerCedi
      const configuredEarn = parsed.loyalty?.earnPointsPerCedi
      if (typeof configuredPoints === 'number' && Number.isSafeInteger(configuredPoints)) {
        pointsPerCedi = configuredPoints
      }
      if (typeof configuredEarn === 'number' && Number.isSafeInteger(configuredEarn)) {
        earnPointsPerCedi = configuredEarn
      }
    } catch {
      // A corrupt snapshot prices at the documented default rather than failing
      // a recall: the till must serve the queue.
    }
  }
  return {
    taxMode: row.tax_mode === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE',
    vatRegistered,
    loyalty: { pointsPerCedi, earnPointsPerCedi },
  }
}

/**
 * A redemption is preserved as points when the account still holds them, and
 * reduced to the affordable maximum with a notice when it does not (P13-D35).
 * The effective figure is bounded by the discount `priceCart` actually applied,
 * so a cart can never claim to spend points that bought nothing.
 */
export function recallLoyalty(input: {
  requestedPoints: number
  availablePoints: number
  appliedDiscountMinor: number
  pointsPerCedi: number
}): RecallLoyaltyNotice {
  const requested = Number.isSafeInteger(input.requestedPoints)
    ? Math.max(0, input.requestedPoints)
    : 0
  if (requested === 0) return { requestedPoints: 0, points: 0, notice: null }

  const affordable = Math.max(0, Math.min(requested, input.availablePoints))
  const effective = Math.min(
    affordable,
    pointsForValueMinor(input.appliedDiscountMinor, input.pointsPerCedi),
  )
  if (effective === requested)
    return { requestedPoints: requested, points: effective, notice: null }

  const reason =
    affordable < requested
      ? `the balance is ${input.availablePoints}`
      : 'the cart is worth less than the points'
  return {
    requestedPoints: requested,
    points: effective,
    notice: `${requested} points → ${effective}, ${reason}`,
  }
}

interface CatalogueRow {
  product_id: string
  name: string
  sku: string
  unit_price_minor: number
  tax_category: string
  is_active: number
}

async function readCatalogue(tx: Transaction, branchId: string): Promise<CatalogueSnapshotLine[]> {
  const rows = await tx.getAll<CatalogueRow>(
    `SELECT p.id AS product_id, p.name, p.sku,
            COALESCE(pp.price_minor, p.base_price_minor) AS unit_price_minor,
            p.tax_category, p.is_active
       FROM product p
       LEFT JOIN product_price pp ON pp.product_id = p.id AND pp.branch_id = ?`,
    [branchId],
  )
  return rows.map((row) => ({
    productId: row.product_id,
    name: row.name,
    sku: row.sku,
    unitPriceMinor: row.unit_price_minor,
    taxCategory: row.tax_category as TaxCategory,
    isActive: row.is_active === 1,
  }))
}

async function heldCustomerPoints(tx: Transaction, customerId: string | null): Promise<number> {
  if (!customerId) return 0
  const balance = await tx.getOptional<{ balance_points: number }>(
    'SELECT balance_points FROM loyalty_account WHERE customer_id = ?',
    [customerId],
  )
  const pending = await tx.getAll<{ points_delta: number }>(
    'SELECT points_delta FROM local_loyalty_delta WHERE customer_id = ? AND acked_at IS NULL',
    [customerId],
  )
  return availablePoints(balance?.balance_points ?? 0, pending)
}

/**
 * A draft customer is restored by phone, because `held_cart` carries no draft id
 * — only the name and the number. An unsynced customer recalled this way stays a
 * draft, so the sale still attaches to the right person.
 */
async function heldCustomer(tx: Transaction, row: HeldCartRow): Promise<CartCustomer | null> {
  if (row.customer_id) {
    return {
      customerId: row.customer_id,
      draftId: null,
      name: row.customer_name ?? '',
      phone: row.customer_phone ?? '',
      isDraft: false,
    }
  }
  if (!row.customer_phone) return null

  const draft = await tx.getOptional<{ id: string; name: string; phone: string }>(
    'SELECT id, name, phone FROM customer_draft WHERE phone = ? ORDER BY created_at DESC LIMIT 1',
    [row.customer_phone],
  )
  if (!draft) return null
  return {
    customerId: null,
    draftId: draft.id,
    name: draft.name,
    phone: draft.phone,
    isDraft: true,
  }
}

/**
 * Recall: read the hold, re-price it against today's catalogue, park the active
 * basket if there is one, then replace the draft and delete the hold in **one**
 * transaction. Nothing is written until everything can be written, so a refusal
 * leaves both baskets untouched.
 */
export async function recallHeldCart(
  db: PowerSyncDatabase,
  holdId: string,
  input: {
    shiftId: string | null
    /** The live cart, the truth rather than the 150 ms-debounced draft. */
    activeCart?: HoldableCart | null
    now?: Date
  },
): Promise<RecallResult> {
  let session: ReturnType<typeof requireStaffSession>
  try {
    session = requireStaffSession()
  } catch {
    throw new HoldError('NOT_SIGNED_IN', 'Sign in with a PIN before recalling a cart')
  }

  const now = input.now ?? new Date()
  const recalledAt = now.toISOString()

  return db.writeTransaction(async (tx) => {
    const hold = await tx.getOptional<HeldCartRow>(
      `SELECT ${HELD_CART_COLUMNS} FROM held_cart WHERE id = ?`,
      [holdId],
    )
    if (!hold) throw new HoldError('NOT_FOUND', 'That cart is no longer held')

    const lineRows = await tx.getAll<HeldCartLineRow>(
      `SELECT ${HELD_LINE_COLUMNS} FROM held_cart_line WHERE hold_id = ? ORDER BY line_number`,
      [holdId],
    )

    const config = await tx.getOptional<PosConfigRow>(
      'SELECT branch_id, tax_mode, config_json FROM pos_config WHERE id = ?',
      ['current'],
    )
    if (!config) throw new HoldError('NO_IDENTITY', 'This terminal is not configured yet')

    const pricing = heldPricingContext(config)
    const requestedValue = loyaltyValueMinor(
      hold.loyalty_redeem_points,
      pricing.loyalty.pointsPerCedi,
    )
    const catalogue = await readCatalogue(tx, config.branch_id)
    const repriced = repriceHeldCart({
      lines: lineRows.map(toHeldLine),
      catalogue,
      loyaltyPointsRequested: hold.loyalty_redeem_points,
      pricing: {
        taxMode: pricing.taxMode,
        vatRegistered: pricing.vatRegistered,
        saleDiscountMinor: hold.sale_discount_minor,
        loyaltyDiscountMinor: requestedValue,
      },
    })

    // The active basket is parked before the recalled one lands, so no keystroke
    // is lost. Ten holds is the cap: refuse rather than destroy the basket.
    const activeCart = input.activeCart ?? null
    let autoHeld: RecallResult['autoHeld'] = null
    if (activeCart && activeCart.lines.length > 0) {
      const existing = await tx.getAll<{ label: string }>('SELECT label FROM held_cart')
      if (existing.length >= MAX_HELD_CARTS) {
        throw new HoldError(
          'HOLD_LIMIT',
          'Ten carts are already held on this till. Use one or void one before recalling another.',
        )
      }
      const label = nextCartLabel(existing.map((row) => row.label))
      const autoHoldId = uuidv7(now.getTime())
      await insertHold(tx, {
        holdId: autoHoldId,
        label,
        heldAt: recalledAt,
        heldByUserId: session.userId,
        heldByStaffId: session.staffId,
        cart: activeCart,
        lines: toHeldLineInputs(activeCart),
      })
      autoHeld = { holdId: autoHoldId, label }
    }

    const customer = await heldCustomer(tx, hold)
    const appliedLoyaltyMinor = priceCart(
      repriced.lines.map((line) => ({
        productId: line.productId,
        name: line.name,
        sku: line.sku,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: line.lineDiscountMinor,
        taxCategory: line.taxCategory,
      })),
      {
        taxMode: pricing.taxMode,
        vatRegistered: pricing.vatRegistered,
        saleDiscountMinor: hold.sale_discount_minor,
        loyaltyDiscountMinor: requestedValue,
      },
    ).loyaltyDiscountMinor
    const loyalty = customer
      ? recallLoyalty({
          requestedPoints: hold.loyalty_redeem_points,
          availablePoints: await heldCustomerPoints(tx, hold.customer_id),
          appliedDiscountMinor: appliedLoyaltyMinor,
          pointsPerCedi: pricing.loyalty.pointsPerCedi,
        })
      : { requestedPoints: 0, points: 0, notice: null }

    // A line discount's approval travels with the line: the server revalidates
    // the proof, and dropping it would turn a manager's approval into a conflict.
    const proofsByProduct = new Map<string, CartOverrideProof>()
    for (const row of lineRows) {
      const proof = parseProof(row.line_discount_override)
      if (proof) proofsByProduct.set(row.product_id, proof)
    }

    const recalled: CartState = sanitizeCartState({
      saleId: uuidv7(now.getTime()),
      shiftId: input.shiftId,
      lines: repriced.lines.map((line) => ({
        id: uuidv7(now.getTime()),
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        barcode: null,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        taxCategory: line.taxCategory,
        lineDiscountMinor: line.lineDiscountMinor,
        discountReasonCode:
          line.lineDiscountMinor > 0 ? discountReason(line.lineDiscountReason) : null,
        discountNote: line.lineDiscountNote,
        discountOverride:
          line.lineDiscountMinor > 0 ? (proofsByProduct.get(line.productId) ?? null) : null,
      })),
      saleDiscount:
        hold.sale_discount_minor > 0 && hold.sale_discount_reason
          ? {
              amountMinor: hold.sale_discount_minor,
              reasonCode: hold.sale_discount_reason as NonNullable<
                CartState['saleDiscount']
              >['reasonCode'],
              note: hold.sale_discount_note,
              override: parseProof(hold.sale_discount_override),
            }
          : null,
      loyaltyRedeemPoints: customer ? loyalty.points : 0,
      customer,
      creditOverride: null,
      updatedAt: recalledAt,
    })

    await writeRecalledDraft(tx, recalled)
    await tx.execute('DELETE FROM held_cart_line WHERE hold_id = ?', [holdId])
    await tx.execute('DELETE FROM held_cart WHERE id = ?', [holdId])

    return {
      holdId,
      cart: recalled,
      differences: repriced.differences,
      blockingProductIds: repriced.blockingProductIds,
      requiresAcknowledgement: repriced.requiresAcknowledgement,
      loyalty,
      autoHeld,
    }
  })
}

/**
 * The recalled cart replaces the active draft (the draft is single-active by
 * construction). `writeDraft` in `cart-repository` is private, and recall must
 * write the draft inside the transaction that deletes the hold, so the same
 * three statements are repeated here rather than opening a second transaction.
 */
async function writeRecalledDraft(tx: Transaction, state: CartState): Promise<void> {
  await tx.execute('DELETE FROM cart_draft WHERE id <> ?', [state.saleId])
  await tx.execute('DELETE FROM cart_draft_line WHERE draft_id <> ?', [state.saleId])
  await tx.execute('DELETE FROM cart_draft_line WHERE draft_id = ?', [state.saleId])

  await tx.execute(
    `INSERT OR REPLACE INTO cart_draft
       (id, shift_id, customer_id, customer_draft_id, customer_name, customer_phone,
        loyalty_redeem_points, sale_discount_minor, sale_discount_reason, sale_discount_note,
        sale_discount_override, credit_override, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      state.saleId,
      state.shiftId,
      state.customer?.customerId ?? null,
      state.customer?.draftId ?? null,
      state.customer?.name ?? null,
      state.customer?.phone ?? null,
      state.loyaltyRedeemPoints,
      state.saleDiscount?.amountMinor ?? 0,
      state.saleDiscount?.reasonCode ?? null,
      state.saleDiscount?.note ?? null,
      state.saleDiscount?.override ? JSON.stringify(state.saleDiscount.override) : null,
      state.creditOverride ? JSON.stringify(state.creditOverride) : null,
      state.updatedAt,
    ],
  )

  for (const [index, line] of state.lines.entries()) {
    await tx.execute(
      `INSERT INTO cart_draft_line
         (id, draft_id, line_number, line_id, product_id, sku, name, barcode, quantity,
          unit_price_minor, tax_category, line_discount_minor, line_discount_reason,
          line_discount_note, line_discount_override)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv7(),
        state.saleId,
        index + 1,
        line.id,
        line.productId,
        line.sku,
        line.name,
        line.barcode,
        line.quantity,
        line.unitPriceMinor,
        line.taxCategory,
        line.lineDiscountMinor,
        line.discountReasonCode,
        line.discountNote,
        line.discountOverride ? JSON.stringify(line.discountOverride) : null,
      ],
    )
  }
}

/** Abandons a held cart: a `CART_VOID` carrying its label, then the row goes. */
export async function voidHeldCart(
  db: PowerSyncDatabase,
  holdId: string,
  reasonCode: CartVoidReason,
  note: string | null,
): Promise<void> {
  const hold = await db.getOptional<HeldCartRow>(
    `SELECT ${HELD_CART_COLUMNS} FROM held_cart WHERE id = ?`,
    [holdId],
  )
  if (!hold) throw new HoldError('NOT_FOUND', 'That cart is no longer held')

  const lines = await db.getAll<HeldCartLineRow>(
    `SELECT ${HELD_LINE_COLUMNS} FROM held_cart_line WHERE hold_id = ? ORDER BY line_number`,
    [holdId],
  )

  await recordCartVoid(db, {
    lines: lines.map((line) => ({
      productId: line.product_id,
      name: line.name,
      quantity: line.quantity,
      unitPriceMinor: line.unit_price_minor,
    })),
    itemCount: hold.item_count,
    grossMinor: hold.total_minor,
    reasonCode,
    note,
    label: hold.label,
    holdId,
  })
}

/** Re-exported so the tray and the dialogs share one vocabulary. */
export { MAX_HELD_CARTS }
