import type { PowerSyncDatabase } from '@powersync/web'
import { CART_VOID_REASONS, type CartVoidReason, cartVoidNoteProblem } from '@sceptre/shared'
import { getBinding } from '../auth/bindings'
import { requireStaffSession } from '../auth/staff-session'
import { uuidv7 } from '../id'
import { notifyOutboxChanged } from '../outbox/outbox-events'
import { readPosIdentity } from '../pos-config'
import { findOpenShift, insertOutbox } from '../shift/shift-repository'
import type { CartState } from './types'

/**
 * Abandoning a cart is a recorded fact, not a silent clear (P13-D28).
 *
 * A cart carries no money, so a void needs no PIN — a void that needed a manager
 * would be a void that never gets recorded, which is how shrink hides. It is
 * still a document: the reason, the priced gross, the item count, and a snapshot
 * of the lines, written with its `CART_VOID` outbox row in one transaction so a
 * crash cannot leave a voided basket with nothing to report.
 *
 * The void belongs to the shift that is **open now**, not to the shift the cart
 * was built in: a held cart from last night is voided tonight, and the server
 * refuses a void against a closed shift.
 */

export type CartVoidErrorCode =
  | 'INVALID_REASON'
  | 'NOTE_REQUIRED'
  | 'INVALID_CART'
  | 'NO_IDENTITY'
  | 'NO_SHIFT'
  | 'NOT_SIGNED_IN'

export class CartVoidError extends Error {
  readonly code: CartVoidErrorCode

  constructor(code: CartVoidErrorCode, message: string) {
    super(message)
    this.name = 'CartVoidError'
    this.code = code
  }
}

/** One line of the abandoned cart, as it stood at the moment of the void. */
export interface CartVoidLine {
  productId: string
  name: string
  quantity: number
  unitPriceMinor: number
}

/** The priced snapshot of a live cart, ready to be voided. */
export function cartVoidLines(cart: CartState): CartVoidLine[] {
  return cart.lines.map((line) => ({
    productId: line.productId,
    name: line.name,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
  }))
}

export interface RecordCartVoidInput {
  lines: readonly CartVoidLine[]
  /** Sum of quantities, from the priced cart. */
  itemCount: number
  /** The priced total at the moment of the void — what the customer did not pay. */
  grossMinor: number
  reasonCode: CartVoidReason
  note?: string | null
  /** The held cart's label, when the void abandons a hold. */
  label?: string | null
  /**
   * A held cart is deleted in the same transaction that records its void, so the
   * hold cannot be recalled after it has been reported as abandoned.
   */
  holdId?: string | null
  now?: Date
}

export interface RecordCartVoidResult {
  voidId: string
  occurredAt: string
}

function assertWholeAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CartVoidError('INVALID_CART', `${label} must be a whole, non-negative amount`)
  }
}

export async function recordCartVoid(
  db: PowerSyncDatabase,
  input: RecordCartVoidInput,
): Promise<RecordCartVoidResult> {
  if (!CART_VOID_REASONS.includes(input.reasonCode)) {
    throw new CartVoidError('INVALID_REASON', 'Choose a reason for discarding this cart')
  }
  const note = input.note?.trim() || null
  const noteProblem = cartVoidNoteProblem(input.reasonCode, note)
  if (noteProblem) throw new CartVoidError('NOTE_REQUIRED', noteProblem)

  assertWholeAmount(input.itemCount, 'The item count')
  assertWholeAmount(input.grossMinor, 'The cart total')
  if (input.lines.length > 200) {
    throw new CartVoidError('INVALID_CART', 'A cart carries at most 200 lines')
  }

  let session: ReturnType<typeof requireStaffSession>
  try {
    session = requireStaffSession()
  } catch {
    throw new CartVoidError('NOT_SIGNED_IN', 'Sign in with a PIN before discarding a cart')
  }

  const identity = await readPosIdentity(db)
  if (!identity) throw new CartVoidError('NO_IDENTITY', 'This terminal is not configured yet')

  const shift = await findOpenShift(db, identity.terminalId)
  if (!shift) throw new CartVoidError('NO_SHIFT', 'Open a shift before discarding a cart')

  const binding = await getBinding(db, session.bindingId)
  if (!binding || !binding.isActive) {
    throw new CartVoidError('NOT_SIGNED_IN', 'This staff member is no longer bound to the till')
  }

  const now = input.now ?? new Date()
  const occurredAt = now.toISOString()
  const voidId = uuidv7(now.getTime())
  const label = input.label?.trim() || null
  const lines = input.lines.map((line) => ({
    productId: line.productId,
    name: line.name,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
  }))

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO cart_void (id, shift_id, reason_code, note, item_count, gross_minor, label,
                              lines, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        voidId,
        shift.id,
        input.reasonCode,
        note,
        input.itemCount,
        input.grossMinor,
        label,
        JSON.stringify(lines),
        occurredAt,
        occurredAt,
      ],
    )

    await insertOutbox(tx, {
      id: voidId,
      clientTransactionId: voidId,
      type: 'CART_VOID',
      occurredAt,
      payload: {
        shiftId: shift.id,
        cashier: {
          userId: session.userId,
          staffId: session.staffId,
          bindingId: binding.bindingId,
          bindingToken: binding.bindingToken,
          pinVersion: binding.pinVersion,
        },
        reasonCode: input.reasonCode,
        note,
        itemCount: input.itemCount,
        grossMinor: input.grossMinor,
        label,
        lines,
        occurredAt,
      },
    })

    if (input.holdId) {
      await tx.execute('DELETE FROM held_cart_line WHERE hold_id = ?', [input.holdId])
      await tx.execute('DELETE FROM held_cart WHERE id = ?', [input.holdId])
    }
  })

  // After the commit, so the drain always sees the row.
  notifyOutboxChanged()

  return { voidId, occurredAt }
}
