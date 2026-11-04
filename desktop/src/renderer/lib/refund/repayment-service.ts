import type { PowerSyncDatabase, Transaction } from '@powersync/web'
import { can } from '@sceptre/shared'
import { getBinding } from '../auth/bindings'
import { requireStaffSession } from '../auth/staff-session'
import type { CartOverrideProof } from '../cart/types'
import { type CreditSnapshot, creditHeadroom, EMPTY_CREDIT } from '../credit/headroom'
import { uuidv7 } from '../id'
import { notifyOutboxChanged } from '../outbox/outbox-events'
import { findOpenShift, insertOutbox } from '../shift/shift-repository'
import { allocateRepaymentNumber } from './refund-numbering'
import { readLocalTerminal } from './refund-repository'
import type { RefundReader } from './refund-types'

/**
 * A credit repayment at the till (Plan 10 Task 5; P13-D27).
 *
 * Cash works with the cable out; MoMo is money only once the server says the
 * payment is `PAID`. Either way the till writes a **negative** `local_credit_delta`
 * and a `CREDIT_REPAYMENT` outbox row in one transaction, so the headroom the
 * cashier sees drops immediately and the ledger reconciles when it uploads.
 *
 * No PIN is needed to pay a debt down — it cannot create credit. The one
 * exception is a profile on hold: money against a held account is how a hold
 * gets quietly bypassed, so that needs a manager's `credit.override`.
 */

export type RepaymentMethod = 'CASH' | 'MOMO'

export type RepaymentErrorCode =
  | 'NOT_SIGNED_IN'
  | 'SHIFT_REQUIRED'
  | 'CUSTOMER_NOT_FOUND'
  | 'INVALID_AMOUNT'
  | 'ACCOUNT_ON_HOLD'
  | 'INVALID_PAYMENT'
  | 'PAYMENT_NOT_PAID'
  | 'SELF_APPROVAL'

export class RepaymentError extends Error {
  readonly code: RepaymentErrorCode

  constructor(code: RepaymentErrorCode, message: string) {
    super(message)
    this.name = 'RepaymentError'
    this.code = code
  }
}

/** What the payment client told the till about a MoMo charge. */
export interface RepaymentPaymentProof {
  id: string
  status: string
  method: string
  amountMinor: number
}

export interface RepaymentInput {
  customerId: string
  amountMinor: number
  method: RepaymentMethod
  payment?: RepaymentPaymentProof | null
  note?: string | null
  override?: CartOverrideProof | null
}

export interface RepaymentResult {
  repaymentId: string
  number: string
  customerId: string
  amountMinor: number
  method: RepaymentMethod
  occurredAt: string
  /** `balance + unacked deltas` after this repayment, before the upload acks. */
  projectedBalanceMinor: number
  headroomMinor: number
  limitMinor: number
}

export interface CreditAccount {
  customerId: string
  name: string
  phone: string
  snapshot: CreditSnapshot
  headroomMinor: number
  /** `balance + pending` — the balance the customer would recognise. */
  projectedBalanceMinor: number
}

interface CustomerRow {
  id: string
  name: string
  phone: string
}

interface ProfileRow {
  limit_minor: number
  balance_minor: number
  hold: number
}

interface TotalRow {
  total: number
}

/**
 * The customer's credit position from local data: the synced profile plus this
 * terminal's unacked deltas, summed **signed** so a repayment lowers the
 * balance before the upload acks.
 */
export async function readCreditAccount(
  reader: RefundReader,
  customerId: string,
  branchId: string,
): Promise<CreditAccount | null> {
  const customer = await reader.getOptional<CustomerRow>(
    'SELECT id, name, phone FROM customer WHERE id = ?',
    [customerId],
  )
  if (!customer) return null

  const [profile, pending] = await Promise.all([
    reader.getOptional<ProfileRow>(
      'SELECT limit_minor, balance_minor, hold FROM credit_profile WHERE customer_id = ? AND branch_id = ?',
      [customerId, branchId],
    ),
    reader.getOptional<TotalRow>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total
         FROM local_credit_delta
        WHERE customer_id = ? AND acked_at IS NULL`,
      [customerId],
    ),
  ])

  const snapshot: CreditSnapshot = profile
    ? {
        hasProfile: true,
        limitMinor: profile.limit_minor,
        balanceMinor: profile.balance_minor,
        pendingMinor: pending?.total ?? 0,
        hold: profile.hold === 1,
      }
    : { ...EMPTY_CREDIT, pendingMinor: pending?.total ?? 0 }

  return {
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    snapshot,
    headroomMinor: creditHeadroom(snapshot),
    projectedBalanceMinor: snapshot.balanceMinor + snapshot.pendingMinor,
  }
}

function assertPositiveAmount(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) {
    throw new RepaymentError('INVALID_AMOUNT', 'A repayment must be a positive whole amount')
  }
}

function assertPayment(input: RepaymentInput): RepaymentPaymentProof | null {
  if (input.method === 'CASH') {
    if (input.payment) {
      throw new RepaymentError('INVALID_PAYMENT', 'A cash repayment carries no payment')
    }
    return null
  }
  const payment = input.payment
  if (!payment) {
    throw new RepaymentError('INVALID_PAYMENT', 'Take the MoMo payment before recording it')
  }
  if (payment.status !== 'PAID') {
    throw new RepaymentError(
      'PAYMENT_NOT_PAID',
      'The MoMo payment has not settled yet — the repayment waits for it',
    )
  }
  if (payment.method !== 'MOMO') {
    throw new RepaymentError('INVALID_PAYMENT', 'That payment was not taken by MoMo')
  }
  if (payment.amountMinor !== input.amountMinor) {
    throw new RepaymentError('INVALID_PAYMENT', 'The payment amount does not match this repayment')
  }
  return payment
}

/**
 * Writes the repayment: the `RP-…` number, the negative delta, and the outbox
 * row, in one transaction. Nothing is sent to the server here.
 */
export async function createRepayment(
  db: PowerSyncDatabase,
  input: RepaymentInput,
  options: { now?: Date; id?: string } = {},
): Promise<RepaymentResult> {
  assertPositiveAmount(input.amountMinor)

  const session = requireStaffSession()
  const binding = await getBinding(db, session.bindingId)
  if (!binding || !binding.isActive) {
    throw new RepaymentError('NOT_SIGNED_IN', 'Sign in with a PIN before taking a repayment')
  }

  const config = await readLocalTerminal(db)
  if (!config) {
    throw new RepaymentError('NOT_SIGNED_IN', 'This terminal is not configured yet')
  }

  const shift = await findOpenShift(db, config.terminal_id)
  if (!shift) {
    throw new RepaymentError('SHIFT_REQUIRED', 'Open a shift before taking money')
  }

  const account = await readCreditAccount(db, input.customerId, config.branch_id)
  // The profile is priced against this terminal's branch; a customer's account
  // at another branch is a different balance.
  if (!account) {
    throw new RepaymentError('CUSTOMER_NOT_FOUND', 'That customer is not on this terminal')
  }

  if (account.snapshot.hold) {
    if (!input.override) {
      throw new RepaymentError(
        'ACCOUNT_ON_HOLD',
        'This account is on hold — a manager must approve taking money',
      )
    }
    if (
      input.override.approverUserId === session.userId ||
      input.override.approverStaffId === session.staffId
    ) {
      throw new RepaymentError('SELF_APPROVAL', 'A manager cannot approve their own repayment')
    }
    if (!can(input.override.approverRole, 'credit.override')) {
      throw new RepaymentError('SELF_APPROVAL', 'This staff member cannot approve a repayment')
    }
  }

  const payment = assertPayment(input)
  const now = options.now ?? new Date()
  const occurredAt = now.toISOString()
  const repaymentId = options.id ?? uuidv7(now.getTime())

  const result = await db.writeTransaction(async (tx: Transaction) => {
    const amountNumber = await allocateRepaymentNumber(
      tx,
      config.terminal_id,
      config.terminal_code,
      now,
    )

    // Negative: this is money in, so the debt and the cached balance go down.
    // The sign is the same one the balance projection sums (P13-D27).
    await tx.execute(
      `INSERT INTO local_credit_delta (id, sale_id, customer_id, amount_minor, acked_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv7(now.getTime()), repaymentId, input.customerId, -input.amountMinor, null],
    )

    // The drawer's own record of the repayment (P20-D1). The credit ledger never
    // reaches the terminal, so without this row the close could not count the
    // notes the cashier is holding and every cash repayment would close as an
    // overage. Written here, in the same transaction as the outbox row, so the
    // till can never print a receipt for money its drawer does not know about.
    await tx.execute(
      `INSERT INTO credit_repayment
         (id, client_transaction_id, number, shift_id, customer_id, customer_name,
          amount_minor, method, occurred_at, cashier_user_id, cashier_staff_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        repaymentId,
        repaymentId,
        amountNumber,
        shift.id,
        input.customerId,
        account.name,
        input.amountMinor,
        input.method,
        occurredAt,
        session.userId,
        session.staffId,
      ],
    )

    await insertOutbox(tx, {
      id: repaymentId,
      clientTransactionId: repaymentId,
      type: 'CREDIT_REPAYMENT',
      occurredAt,
      payload: {
        customerId: input.customerId,
        shiftId: shift.id,
        cashier: {
          userId: session.userId,
          staffId: session.staffId,
          bindingId: binding.bindingId,
          bindingToken: binding.bindingToken,
          pinVersion: binding.pinVersion,
        },
        amountMinor: input.amountMinor,
        method: input.method,
        paymentId: payment?.id ?? null,
        number: amountNumber,
        note: input.note?.trim() || null,
        override: input.override
          ? {
              staffId: input.override.approverStaffId,
              userId: input.override.approverUserId,
              bindingId: input.override.bindingId,
              pinVersion: input.override.pinVersion,
              reasonCode: input.override.reasonCode,
              note: input.override.note,
              occurredAt: input.override.approvedAt,
            }
          : null,
        occurredAt,
      },
    })

    const projectedBalanceMinor = account.projectedBalanceMinor - input.amountMinor
    return {
      repaymentId,
      number: amountNumber,
      customerId: input.customerId,
      amountMinor: input.amountMinor,
      method: input.method,
      occurredAt,
      projectedBalanceMinor,
      // Without a profile there is no limit to be under; showing `0 - balance`
      // as headroom would invent credit the branch never granted.
      headroomMinor: account.snapshot.hasProfile
        ? account.snapshot.limitMinor - projectedBalanceMinor
        : 0,
      limitMinor: account.snapshot.limitMinor,
    }
  })

  notifyOutboxChanged()
  return result
}
