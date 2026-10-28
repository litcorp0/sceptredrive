import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { type DbExecutor, db } from '@sceptre/db'
import { normalizeGhanaPhone } from '@sceptre/shared'
import { env } from '../../config/env.ts'
import { AppError, NotFoundError, ValidationError } from '../../http/errors.ts'
import {
  applyTransferEvent,
  getTransferView,
  transferEventFromProvider,
} from '../payables/payables.service.ts'
import type { TransferEvent, TransferView } from '../payables/payables.types.ts'
import { writeAudit } from '../platform/audit.service.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'
import { addConflict } from '../pos/pos.conflicts.ts'
import {
  findRefundTenderByIdForUpdate,
  findRefundTenderByPaymentReferenceForUpdate,
  findRefundTenderByProviderReferenceForUpdate,
  findShiftByIdForUpdate,
  type RefundTenderState,
  selectRefundTendersToDispatch,
  updateRefundTender,
} from '../pos/pos.repository.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { settleMockPayment, settleMockTransfer } from './payments.mock.provider.ts'
import {
  getPaymentProvider,
  type PaymentProvider,
  type ProviderChargeResult,
  type ProviderRefund,
  ProviderUnavailableError,
  type ProviderVerification,
} from './payments.provider.ts'
import type { PaymentPatch, PaymentRow } from './payments.repository.ts'
import * as repo from './payments.repository.ts'
import type {
  ClaimPaymentInput,
  CreatePaymentInput,
  MockSettlementOutcome,
  MockTransferSettlementOutcome,
  PaymentMethod,
  PaymentView,
} from './payments.types.ts'

/**
 * The payment state machine. Money is decided here, never by the terminal:
 * the till creates an intent, the provider is asked once per intent, and the
 * webhook or `verify` is the only writer that can move a payment to `PAID`
 * (P13-D6, P13-D9, P13-D11, P13-D12).
 */

const MAX_PAYMENT_MINOR = 10_000_000

const MOMO_EXPIRY_MS = 180_000
const BANK_TRANSFER_EXPIRY_MS = 15 * 60_000
const CARD_EXPIRY_MS = 30 * 60_000

/** A polling till may force at most one provider verify in this window. */
export const PAYMENT_REFRESH_THROTTLE_MS = 5_000

/** Paystack's own body size is small; anything larger is not a settlement. */
export const MAX_WEBHOOK_BYTES = 1_000_000

const HANDLED_EVENTS = new Set([
  'charge.success',
  'charge.failed',
  'bank.transfer.rejected',
  // Supplier transfers (P14-D30). Only `success` posts a payment; the other two
  // mark the intent and, for a reversal, raise it for a person.
  'transfer.success',
  'transfer.failed',
  'transfer.reversed',
])

/** The three transfer events, and the status each one asserts. */
const TRANSFER_EVENT_STATUS: Record<string, TransferEvent['status']> = {
  'transfer.success': 'success',
  'transfer.failed': 'failed',
  'transfer.reversed': 'reversed',
}

function expiryFor(method: PaymentMethod, now: Date): Date {
  switch (method) {
    case 'MOMO':
      return new Date(now.getTime() + MOMO_EXPIRY_MS)
    case 'BANK_TRANSFER':
      return new Date(now.getTime() + BANK_TRANSFER_EXPIRY_MS)
    case 'CARD':
      return new Date(now.getTime() + CARD_EXPIRY_MS)
  }
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

/** The provider's mandatory email is a routing label, never a contact (P13-D7). */
export function providerEmail(
  terminalCode: string,
  clientPaymentId: string,
  domain: string = env.PAYSTACK_EMAIL_DOMAIN,
): string {
  return `pos+${terminalCode}-${clientPaymentId}@${domain}`
}

function toView(row: PaymentRow): PaymentView {
  return {
    id: row.id,
    clientPaymentId: row.clientPaymentId,
    shiftId: row.shiftId,
    method: row.method,
    amountMinor: row.amountMinor,
    provider: row.provider,
    providerReference: row.providerReference,
    status: row.status,
    channel: row.channel,
    displayText: row.displayText,
    authorizationUrl: row.authorizationUrl,
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    accountBank: row.accountBank,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    failedCode: row.failedCode,
    failedMessage: row.failedMessage,
    orphaned: row.orphaned,
    createdAt: row.createdAt.toISOString(),
  }
}

function deviceFor(row: PaymentRow): DeviceAuthContext {
  return { deviceId: row.deviceId, terminalId: row.terminalId, branchId: row.branchId }
}

async function addPaymentConflict(
  tx: DbExecutor,
  row: PaymentRow,
  type: 'PAYMENT_LATE_SETTLEMENT' | 'PAYMENT_AMOUNT_MISMATCH',
  details: Record<string, unknown>,
): Promise<void> {
  await addConflict(
    tx,
    { device: deviceFor(row), shiftId: row.shiftId },
    {
      type,
      severity: 'HIGH',
      // Ids and amounts only. No phone, no customer, no provider body.
      details: {
        paymentId: row.id,
        providerReference: row.providerReference,
        terminalId: row.terminalId,
        method: row.method,
        ...details,
      },
    },
  )
}

/**
 * The single state writer for the webhook **and** verify.
 *
 * A settled payment is a two-way door only upwards: an `EXPIRED`/`ABANDONED`
 * row may still become `PAID`, but never the reverse. A success whose amount or
 * currency differs is a HIGH conflict and no status change, because a wrong
 * amount must never be booked as our money (P13-D12).
 *
 * A **failed** provider result is different: a rejected transfer is often
 * rejected precisely because the amount differed, and P13-D14 requires that
 * rejection to reach the till as `FAILED` with its message. The mismatch is
 * still recorded, but it does not stop the terminal failure from being written.
 */
export async function applyProviderCharge(
  tx: DbExecutor,
  row: PaymentRow,
  result: ProviderVerification,
): Promise<void> {
  if (row.status === 'PAID') return

  const currency = (result.currency || '').toUpperCase()
  const mismatch = result.amountMinor !== row.amountMinor || currency !== 'GHS'

  if (mismatch && (result.status === 'success' || result.status === 'failed')) {
    await addPaymentConflict(tx, row, 'PAYMENT_AMOUNT_MISMATCH', {
      expectedAmountMinor: row.amountMinor,
      providerAmountMinor: result.amountMinor,
      providerCurrency: currency,
      providerStatus: result.status,
    })
    // A success must never be booked; a failed result is terminal below.
    if (result.status === 'success') return
  }

  if (result.status === 'success') {
    const wasWaiting = row.status === 'ABANDONED' || row.status === 'EXPIRED'

    await repo.updatePaymentStatus(
      row.id,
      {
        status: 'PAID',
        paidAt: toDate(result.paidAt) ?? new Date(),
        channel: result.channel ?? row.channel,
        providerTransactionId: result.transactionId ?? row.providerTransactionId,
        orphaned: wasWaiting || row.orphaned,
        failedCode: null,
        failedMessage: null,
      },
      tx,
    )

    if (wasWaiting) {
      // Never auto-refund: a person decides what happens to money that arrived
      // after the till stopped waiting (P13-D9).
      await addPaymentConflict(tx, row, 'PAYMENT_LATE_SETTLEMENT', {
        amountMinor: row.amountMinor,
        providerPaidAt: result.paidAt,
      })
    }
    return
  }

  if (result.status === 'failed' || result.status === 'abandoned') {
    await repo.updatePaymentStatus(
      row.id,
      {
        status: 'FAILED',
        channel: result.channel ?? row.channel,
        providerTransactionId: result.transactionId ?? row.providerTransactionId,
        failedCode:
          result.failureCode ?? (result.status === 'abandoned' ? 'abandoned' : 'provider_failed'),
        failedMessage: result.failureMessage ?? result.gatewayResponse ?? 'The payment failed',
      },
      tx,
    )
  }

  // pending / ongoing / reversed: the provider has not settled anything.
}

/**
 * The provider's refund vocabulary, and the only place the webhook's event names
 * are translated. `refund.needs-attention` is money Paystack could not move to
 * the customer: it is never retried into `SETTLED` by us (P13-D26).
 */
const REFUND_EVENT_STATUS: Record<string, ProviderRefund['status']> = {
  'refund.pending': 'pending',
  'refund.processing': 'processing',
  'refund.processed': 'processed',
  'refund.failed': 'failed',
  'refund.needs-attention': 'needs-attention',
}

export const REFUND_EVENT_NAMES = new Set(Object.keys(REFUND_EVENT_STATUS))

/**
 * The single state writer for an electronic refund, called by the dispatch job
 * and by the webhook.
 *
 * A `SETTLED` row is terminal: a late or replayed event must not un-settle money
 * the customer already received. Any other row follows the provider, and a
 * failure is an audit row on the tender itself rather than a `sync_conflict`,
 * because the ledgers can express it — Phase 14 lists it (Plan 05 §4).
 */
export async function applyProviderRefund(
  tx: DbExecutor,
  row: RefundTenderState,
  result: ProviderRefund,
  message: string | null = null,
): Promise<void> {
  if (row.status === 'SETTLED') return

  const status: RefundTenderState['status'] =
    result.status === 'processed'
      ? 'SETTLED'
      : result.status === 'failed'
        ? 'FAILED'
        : result.status === 'needs-attention'
          ? 'NEEDS_ATTENTION'
          : 'PENDING'

  await updateRefundTender(
    row.id,
    {
      status,
      providerRefundReference: result.refundReference ?? row.providerRefundReference,
      settledAt: status === 'SETTLED' ? new Date() : null,
      failedMessage:
        status === 'FAILED' || status === 'NEEDS_ATTENTION'
          ? (message ?? 'The provider did not complete the refund')
          : null,
    },
    tx,
  )

  if (status === 'FAILED' || status === 'NEEDS_ATTENTION') {
    await writeAudit(
      {
        action: 'pos.refund.failed',
        entity: 'refund_tender',
        entityId: row.id,
        branchId: row.branchId,
        after: {
          refundId: row.refundId,
          refundNumber: row.refundNumber,
          amountMinor: row.amountMinor,
          providerStatus: result.status,
          providerRefundReference: result.refundReference ?? row.providerRefundReference,
          // A provider message is operational text, never PII or card data.
          message: message ? message.slice(0, 200) : null,
        },
      },
      tx,
    )
  }
}

export interface RefundDispatchSummary {
  examined: number
  dispatched: number
  skipped: number
}

/**
 * Sends every pending electronic refund to the provider, once.
 *
 * Idempotency is structural: the query excludes a tender that already carries a
 * provider refund reference, and the write re-reads the row under a lock before
 * it moves a status. A provider timeout leaves the row `PENDING` for the next
 * sweep — a timeout is "we do not know", never a failure to report.
 */
export async function dispatchPendingRefunds(limit = 50): Promise<RefundDispatchSummary> {
  const pending = await selectRefundTendersToDispatch(new Date(Date.now() - 2_000), limit)
  if (pending.length === 0) return { examined: 0, dispatched: 0, skipped: 0 }

  const provider = getPaymentProvider()
  let dispatched = 0
  let skipped = 0

  for (const tender of pending) {
    if (tender.providerRefundReference || !tender.paymentProviderReference) {
      skipped += 1
      continue
    }

    let result: ProviderRefund
    try {
      result = await provider.refund({
        reference: tender.paymentProviderReference,
        amountMinor: tender.amountMinor,
        note: `Refund ${tender.refundNumber}`,
      })
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        skipped += 1
        continue
      }
      throw error
    }

    await db.transaction(async (tx) => {
      const locked = await findRefundTenderByIdForUpdate(tender.id, tx)
      if (!locked || locked.status !== 'PENDING' || locked.providerRefundReference) return
      await applyProviderRefund(tx, locked, result)
    })
    dispatched += 1
  }

  return { examined: pending.length, dispatched, skipped }
}

/**
 * The `refund.*` webhook arm. The tender is found by the provider's refund
 * reference once dispatch — or an earlier event — has stored it, and before that
 * only by the charge's own reference plus the amount among rows still `PENDING`:
 * a tender a provider already flagged for attention is not guessed at. An event
 * that names nothing we know is ignored, not failed, so Paystack stops retrying.
 */
async function applyRefundEvent(
  tx: DbExecutor,
  eventName: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const providerStatus = REFUND_EVENT_STATUS[eventName]
  if (!providerStatus) return false

  const refundReference = asString(data.refund_reference)
  const transactionReference = asString(data.transaction_reference) ?? asString(data.reference)
  const amountMinor = asInteger(data.amount)
  const message = asString(data.gateway_response) ?? asString(data.message)

  let tender = refundReference
    ? await findRefundTenderByProviderReferenceForUpdate(refundReference, tx)
    : null
  if (!tender && transactionReference && amountMinor !== null) {
    tender = await findRefundTenderByPaymentReferenceForUpdate(
      transactionReference,
      amountMinor,
      tx,
    )
  }
  if (!tender) return false

  await applyProviderRefund(
    tx,
    tender,
    {
      reference: transactionReference ?? tender.paymentProviderReference ?? '',
      status: providerStatus,
      refundReference: refundReference ?? tender.providerRefundReference,
      expectedAt: asString(data.expected_at),
    },
    message,
  )
  return true
}

function verificationFromCharge(
  result: ProviderChargeResult,
  amountMinor: number,
): ProviderVerification {
  const status =
    result.status === 'SUCCESS' ? 'success' : result.status === 'FAILED' ? 'failed' : 'pending'

  return {
    reference: result.reference,
    status,
    amountMinor,
    currency: 'GHS',
    channel: null,
    paidAt: status === 'success' ? new Date().toISOString() : null,
    gatewayResponse: result.failureMessage,
    transactionId: result.transactionId,
    failureCode: result.failureCode,
    failureMessage: result.failureMessage,
  }
}

function projectionFromCharge(result: ProviderChargeResult): PaymentPatch {
  const patch: PaymentPatch = {
    displayText: result.displayText,
    authorizationUrl: result.authorizationUrl,
    accountNumber: result.accountNumber,
    accountName: result.accountName,
    accountBank: result.accountBank,
    providerTransactionId: result.transactionId,
    failedCode: result.failureCode,
    failedMessage: result.failureMessage,
  }

  const expiresAt = toDate(result.expiresAt)
  if (expiresAt) patch.expiresAt = expiresAt
  return patch
}

function callProvider(
  provider: PaymentProvider,
  row: PaymentRow,
  input: CreatePaymentInput,
  phone: string | null,
): Promise<ProviderChargeResult> {
  const base = {
    reference: row.providerReference,
    amountMinor: row.amountMinor,
    email: row.providerEmail,
    currency: 'GHS' as const,
    metadata: { paymentId: row.id, terminalId: row.terminalId, branchId: row.branchId },
  }

  switch (input.method) {
    case 'MOMO':
      if (!input.mobileMoney || !phone) {
        throw new ValidationError('A mobile money payment needs a provider and a phone')
      }
      return provider.createMobileMoneyCharge({
        ...base,
        mobileMoney: { provider: input.mobileMoney.provider, phone },
      })
    case 'CARD':
      return provider.createCardCheckout(base)
    case 'BANK_TRANSFER':
      return provider.createBankTransferCharge({
        ...base,
        bankTransfer: {
          accountExpiresAt: (row.expiresAt ?? expiryFor('BANK_TRANSFER', new Date())).toISOString(),
        },
      })
  }
}

function assertCreateInput(input: CreatePaymentInput): string | null {
  if (
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor < 1 ||
    input.amountMinor > MAX_PAYMENT_MINOR
  ) {
    throw new ValidationError('A payment must be between 1 and 10,000,000 pesewas')
  }

  if (input.method === 'MOMO') {
    if (!input.mobileMoney) {
      throw new ValidationError('A mobile money payment needs a provider and a phone')
    }
    const phone = normalizeGhanaPhone(input.mobileMoney.phone)
    if (!phone) throw new ValidationError('Enter a valid Ghana mobile number')
    return phone
  }

  if (input.mobileMoney) {
    throw new ValidationError('Only a mobile money payment carries a mobile money provider')
  }
  return null
}

async function findPaymentForDevice(device: DeviceAuthContext, id: string): Promise<PaymentRow> {
  const row = await repo.findById(id)
  // Not theirs is indistinguishable from not there: a terminal may not probe
  // another terminal's references (P13-D39, A01).
  if (!row || row.terminalId !== device.terminalId || row.branchId !== device.branchId) {
    throw new NotFoundError('Payment not found')
  }
  return row
}

export async function createPayment(
  device: DeviceAuthContext,
  input: CreatePaymentInput,
): Promise<PaymentView> {
  const phone = assertCreateInput(input)

  // Idempotency is the first thing that happens: a retried POST must never
  // create a second charge, even while the first is still awaiting a prompt.
  const existing = await repo.findByClientId(device.terminalId, input.clientPaymentId)
  if (existing) return toView(existing)

  type Creation = { kind: 'existing'; row: PaymentRow } | { kind: 'created'; row: PaymentRow }
  let creation: Creation

  try {
    creation = await db.transaction(async (tx): Promise<Creation> => {
      const shiftRow = await findShiftByIdForUpdate(input.shiftId, tx)
      if (!shiftRow) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Shift not found')

      if (shiftRow.terminalId !== device.terminalId || shiftRow.branchId !== device.branchId) {
        throw new AppError(403, 'SHIFT_FORBIDDEN', 'This shift does not belong to this terminal')
      }
      if (shiftRow.status !== 'OPEN') {
        throw new AppError(409, 'SHIFT_CLOSED', 'The shift is closed')
      }

      const raced = await repo.findByClientId(device.terminalId, input.clientPaymentId, tx)
      if (raced) return { kind: 'existing', row: raced }

      const terminalCode = await repo.selectTerminalCode(device.terminalId, tx)
      if (!terminalCode) throw new AppError(404, 'TERMINAL_NOT_FOUND', 'Terminal not found')

      const now = new Date()
      const row = await repo.insertPayment(
        {
          branchId: device.branchId,
          terminalId: device.terminalId,
          deviceId: device.deviceId,
          shiftId: input.shiftId,
          clientPaymentId: input.clientPaymentId,
          cashierUserId: shiftRow.cashierUserId,
          cashierStaffId: shiftRow.cashierStaffId,
          method: input.method,
          amountMinor: input.amountMinor,
          provider: getPaymentProvider().name,
          providerReference: `sd-${input.clientPaymentId}`,
          providerEmail: providerEmail(terminalCode, input.clientPaymentId),
          status: 'PENDING',
          expiresAt: expiryFor(input.method, now),
        },
        tx,
      )
      return { kind: 'created', row }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await repo.findByClientId(device.terminalId, input.clientPaymentId)
      if (raced) return toView(raced)
    }
    throw error
  }

  if (creation.kind === 'existing') return toView(creation.row)

  const provider = getPaymentProvider()
  let result: ProviderChargeResult

  try {
    result = await callProvider(provider, creation.row, input, phone)
  } catch (error) {
    // A timeout is uncertain, not a decline: the row stays `PENDING` and a
    // later verify (or the webhook) resolves it.
    if (error instanceof ProviderUnavailableError) return toView(creation.row)
    throw error
  }

  const updated = await db.transaction(async (tx) => {
    const locked = await repo.findByIdForUpdate(creation.row.id, tx)
    if (!locked) return creation.row

    if (result.status === 'SUCCESS' || result.status === 'FAILED') {
      await applyProviderCharge(tx, locked, verificationFromCharge(result, locked.amountMinor))
    }

    const after = await repo.updatePaymentStatus(locked.id, projectionFromCharge(result), tx)
    return after ?? locked
  })

  return toView(updated)
}

export async function getPayment(
  device: DeviceAuthContext,
  id: string,
  opts: { refresh: boolean },
): Promise<PaymentView> {
  const row = await findPaymentForDevice(device, id)
  if (!opts.refresh || row.status !== 'PENDING') return toView(row)

  const now = Date.now()
  const lastVerified = row.lastVerifiedAt?.getTime() ?? 0
  if (now - lastVerified < PAYMENT_REFRESH_THROTTLE_MS) return toView(row)

  // Set the throttle *before* the network call: a hammering client must not be
  // able to turn our API into a Paystack quota sink (P13-D12).
  await repo.updateLastVerifiedAt(row.id, new Date(now))

  let result: ProviderVerification
  try {
    result = await getPaymentProvider().verify(row.providerReference)
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      return toView((await repo.findById(row.id)) ?? row)
    }
    throw error
  }

  const updated = await db.transaction(async (tx) => {
    const locked = await repo.findByIdForUpdate(row.id, tx)
    if (!locked) return row
    await applyProviderCharge(tx, locked, result)
    return (await repo.findById(locked.id, tx)) ?? locked
  })

  return toView(updated)
}

export async function abandonPayment(device: DeviceAuthContext, id: string): Promise<PaymentView> {
  const row = await findPaymentForDevice(device, id)
  if (row.status === 'PAID') return toView(row)

  let transitioned = false
  await db.transaction(async (tx) => {
    const locked = await repo.findByIdForUpdate(row.id, tx)
    if (!locked) return
    if (locked.status === 'PENDING') {
      await repo.updatePaymentStatus(locked.id, { status: 'EXPIRED' }, tx)
      transitioned = true
    }
  })

  // A second abandon is a no-op: no second verify, no second conflict.
  if (!transitioned) return toView((await repo.findById(row.id)) ?? row)

  // The webhook may simply be late. One verify inside the abandon call can still
  // win, and a success then becomes an orphan rather than being lost (P13-D8).
  try {
    const result = await getPaymentProvider().verify(row.providerReference)
    await db.transaction(async (tx) => {
      const locked = await repo.findByIdForUpdate(row.id, tx)
      if (!locked) return
      await applyProviderCharge(tx, locked, result)
    })
  } catch (error) {
    if (!(error instanceof ProviderUnavailableError)) throw error
  }

  return toView((await repo.findById(row.id)) ?? row)
}

export async function claimPayment(
  device: DeviceAuthContext,
  id: string,
  input: ClaimPaymentInput,
): Promise<PaymentView> {
  if (!input.saleId) throw new ValidationError('A sale id is required to claim a payment')

  const row = await findPaymentForDevice(device, id)
  if (row.status !== 'PAID') {
    throw new AppError(409, 'PAYMENT_NOT_PAID', 'Only a settled payment can be claimed')
  }
  if (!row.orphaned) return toView(row)

  const updated = await repo.updatePaymentStatus(row.id, { orphaned: false })
  return toView(updated ?? row)
}

/**
 * HMAC-SHA512 over the **raw** body with the webhook secret (P13-D11). A
 * mismatch is a 401 with no detail; an absent secret fails closed.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string | null = env.paystackWebhookSecret,
): boolean {
  if (!secret || !signature) return false
  if (!/^[a-f0-9]{128}$/i.test(signature)) return false

  const expected = createHmac('sha512', secret).update(rawBody).digest()
  const provided = Buffer.from(signature, 'hex')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

/** The allowlisted projection stored in `payment_event.detail` (P13-D15). */
export function projectProviderDetail(data: Record<string, unknown>): Record<string, unknown> {
  const detail: Record<string, unknown> = {}
  const reference = asString(data.reference)
  const status = asString(data.status)
  const amount = asInteger(data.amount)
  const currency = asString(data.currency)
  const channel = asString(data.channel)
  const paidAt = asString(data.paid_at)
  const gatewayResponse = asString(data.gateway_response)

  if (reference) detail.reference = reference
  if (status) detail.status = status
  if (amount !== null) detail.amount = amount
  if (currency) detail.currency = currency
  if (channel) detail.channel = channel
  if (paidAt) detail.paid_at = paidAt
  if (gatewayResponse) detail.gateway_response = gatewayResponse.slice(0, 200)

  return detail
}

function verificationFromWebhook(
  eventName: string,
  data: Record<string, unknown>,
  reference: string,
): ProviderVerification {
  const success = eventName === 'charge.success'

  return {
    reference,
    status: success ? 'success' : 'failed',
    amountMinor: asInteger(data.amount) ?? 0,
    currency: asString(data.currency) ?? 'GHS',
    channel: asString(data.channel),
    paidAt: asString(data.paid_at),
    gatewayResponse: asString(data.gateway_response),
    transactionId:
      typeof data.id === 'number' || typeof data.id === 'string' ? String(data.id) : null,
    failureCode: success ? null : (asString(data.status) ?? eventName),
    failureMessage: success ? null : (asString(data.gateway_response) ?? 'The payment failed'),
  }
}

/**
 * A `transfer.*` delivery, in the shape the one transfer state writer consumes.
 * `failures` is where Paystack puts the reason for a failed or reversed transfer.
 */
function transferEventFromWebhook(
  status: TransferEvent['status'],
  data: Record<string, unknown>,
  reference: string,
): TransferEvent {
  const failures = Array.isArray(data.failures) ? asRecord(data.failures[0]) : {}

  return {
    reference,
    status,
    transferCode: asString(data.transfer_code),
    transferId: typeof data.id === 'number' || typeof data.id === 'string' ? String(data.id) : null,
    amountMinor: asInteger(data.amount),
    failureCode: asString(failures.reason) ?? asString(data.status),
    failureMessage: asString(failures.message) ?? asString(data.gateway_response),
    occurredAt: toDate(asString(data.transferred_at) ?? asString(data.updated_at)),
    feeMinor: asInteger(data.fee_charged),
  }
}

/**
 * Insert the delivery, apply its state change and mark it processed in one
 * transaction. The unique body hash makes a retry a no-op that still returns
 * 200; if applying throws, the whole transaction (including the event row)
 * rolls back so Paystack's retry reprocesses rather than being swallowed.
 */
export async function processPaystackEvent(rawBody: string, body: unknown): Promise<void> {
  const event = asRecord(body)
  const eventName = asString(event.event)
  const refundEvent = eventName !== null && REFUND_EVENT_NAMES.has(eventName)
  const transferStatus = eventName !== null ? TRANSFER_EVENT_STATUS[eventName] : undefined
  const handled = eventName !== null && (HANDLED_EVENTS.has(eventName) || refundEvent)
  const data = asRecord(event.data)
  const reference = asString(data.reference)
  const providerReference = refundEvent ? (asString(data.refund_reference) ?? reference) : reference
  const bodySha256 = createHash('sha256').update(rawBody).digest('hex')
  const detail = projectProviderDetail(data)
  const eventType = handled && eventName ? eventName : 'IGNORED'

  await db.transaction(async (tx) => {
    const inserted = await repo.insertEvent(
      {
        provider: 'PAYSTACK',
        eventType,
        bodySha256,
        providerReference,
        status: 'RECEIVED',
        detail,
      },
      tx,
    )
    if (!inserted) return

    if (!handled || !eventName) {
      await repo.markEventProcessed(
        inserted.id,
        { status: 'IGNORED', paymentId: null, processedAt: new Date() },
        tx,
      )
      return
    }

    // A transfer event names a `supplier_transfer`, not a payment. It is written
    // through `payables.service` — the one direction that is not a cycle —
    // because the payment it may create is a payables fact (P14-D30).
    if (transferStatus) {
      if (!reference) {
        await repo.markEventProcessed(
          inserted.id,
          { status: 'IGNORED', paymentId: null, processedAt: new Date() },
          tx,
        )
        return
      }

      const outcome = await applyTransferEvent(
        tx,
        transferEventFromWebhook(transferStatus, data, reference),
      )
      await repo.markEventProcessed(
        inserted.id,
        {
          status: outcome.matched ? 'PROCESSED' : 'IGNORED',
          paymentId: null,
          supplierTransferId: outcome.transferId,
          processedAt: new Date(),
        },
        tx,
      )
      return
    }

    // A refund event names a refund tender, not a payment; it never moves a
    // payment's status (P13-D26).
    if (refundEvent) {
      const applied = await applyRefundEvent(tx, eventName, data)
      await repo.markEventProcessed(
        inserted.id,
        { status: applied ? 'PROCESSED' : 'IGNORED', paymentId: null, processedAt: new Date() },
        tx,
      )
      return
    }

    if (!reference) {
      await repo.markEventProcessed(
        inserted.id,
        { status: 'IGNORED', paymentId: null, processedAt: new Date() },
        tx,
      )
      return
    }

    const row = await repo.findByReferenceForUpdate(reference, tx)
    if (!row || row.provider !== 'PAYSTACK') {
      await repo.markEventProcessed(
        inserted.id,
        { status: 'IGNORED', paymentId: null, processedAt: new Date() },
        tx,
      )
      return
    }

    await applyProviderCharge(tx, row, verificationFromWebhook(eventName, data, reference))
    await repo.markEventProcessed(
      inserted.id,
      { status: 'PROCESSED', paymentId: row.id, processedAt: new Date() },
      tx,
    )
  })
}

/** The admin harness mutates only the mock provider; verify does the writing. */
export function settleMockProviderPayment(
  reference: string,
  outcome: MockSettlementOutcome,
): boolean {
  return settleMockPayment(reference, outcome)
}

/** The mock's provider vocabulary, keyed by the harness route's outcome. */
const MOCK_TRANSFER_OUTCOMES: Record<
  MockTransferSettlementOutcome,
  'success' | 'failed' | 'reversed'
> = {
  SUCCESS: 'success',
  FAILED: 'failed',
  REVERSED: 'reversed',
}

function mockTransferNotFound(): AppError {
  return new AppError(
    404,
    'MOCK_TRANSFER_NOT_FOUND',
    'The mock provider has no transfer with that reference',
  )
}

/**
 * The transfer half of the mock harness (P14 walkthrough). It moves the fake
 * provider's state and then settles through the **real** path — provider verify →
 * `transferEventFromProvider` → `applyTransferEvent` — exactly as the console's
 * verify button and the sweep do, so a walkthrough that passes here has exercised
 * the production state machine rather than a direct payment insert.
 *
 * A reference the mock never issued is a 404 with its own code, so "the harness
 * has not seen this reference" is distinguishable from "the route is not mounted"
 * (both would otherwise be a bare `NOT_FOUND`).
 */
export async function settleMockSupplierTransfer(
  reference: string,
  outcome: MockTransferSettlementOutcome,
): Promise<{ transfer: TransferView; paymentId: string | null }> {
  if (!settleMockTransfer(reference, MOCK_TRANSFER_OUTCOMES[outcome])) {
    throw mockTransferNotFound()
  }

  const event = transferEventFromProvider(await getPaymentProvider().verifyTransfer(reference))
  const settled = await db.transaction(async (tx) => applyTransferEvent(tx, event))
  if (!settled.transferId) throw mockTransferNotFound()

  return { transfer: await getTransferView(settled.transferId), paymentId: settled.paymentId }
}
