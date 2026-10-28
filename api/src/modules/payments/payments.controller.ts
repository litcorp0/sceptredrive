import { db } from '@sceptre/db'
import type { Context } from 'hono'
import { currentUser } from '../../http/authorize.ts'
import { AppError, NotFoundError, UnauthorizedError } from '../../http/errors.ts'
import type { AppEnv } from '../../http/factory.ts'
import {
  applyTransferEvent,
  getTransfer,
  transferEventFromProvider,
} from '../payables/payables.service.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { settleMockTransfer as settleMockProviderTransfer } from './payments.mock.provider.ts'
import { getPaymentProvider } from './payments.provider.ts'
import * as paymentsService from './payments.service.ts'
import type {
  ClaimPaymentInput,
  CreatePaymentInput,
  MockSettlementOutcome,
  MockSettleTransferInput,
  PaymentQuery,
} from './payments.types.ts'

/**
 * HTTP handlers only. Every decision about money, status or ownership happens
 * in the service; the controller turns a device context into an argument and a
 * view into a response.
 */

function deviceFrom(c: Context<AppEnv>): DeviceAuthContext {
  const device = c.get('device')
  if (!device) throw new UnauthorizedError()
  return device
}

export async function createPayment(c: Context<AppEnv>, input: CreatePaymentInput) {
  const payment = await paymentsService.createPayment(deviceFrom(c), input)
  return c.json({ payment }, 201)
}

export async function getPayment(c: Context<AppEnv>, id: string, query: PaymentQuery) {
  const payment = await paymentsService.getPayment(deviceFrom(c), id, { refresh: query.refresh })
  return c.json({ payment })
}

export async function abandonPayment(c: Context<AppEnv>, id: string) {
  const payment = await paymentsService.abandonPayment(deviceFrom(c), id)
  return c.json({ payment })
}

export async function claimPayment(c: Context<AppEnv>, id: string, input: ClaimPaymentInput) {
  const payment = await paymentsService.claimPayment(deviceFrom(c), id, input)
  return c.json({ payment })
}

interface MockSettleBody {
  reference: string
  outcome: MockSettlementOutcome
}

export async function settleMockPayment(c: Context<AppEnv>, input: MockSettleBody) {
  const settled = paymentsService.settleMockProviderPayment(input.reference, input.outcome)
  if (!settled) throw new NotFoundError('Mock payment not found')
  return c.json({ ok: true })
}

/** The mock's provider vocabulary, keyed by the harness route's outcome. */
const MOCK_TRANSFER_OUTCOMES = {
  SUCCESS: 'success',
  FAILED: 'failed',
  REVERSED: 'reversed',
} as const

/**
 * The transfer half of the harness (P14 walkthrough). It moves the fake
 * provider's state and then settles through the **real** path — provider verify
 * → `transferEventFromProvider` → `applyTransferEvent` — exactly as the console's
 * verify button and the sweep do, so a walkthrough that passes here has exercised
 * the production state machine rather than a direct payment insert.
 *
 * A reference the mock never issued is a 404 with its own code, so "the harness
 * has not seen this reference" is distinguishable from "the route is not mounted"
 * (both would otherwise be a bare `NOT_FOUND`).
 */
export async function settleMockTransfer(c: Context<AppEnv>, input: MockSettleTransferInput) {
  if (!settleMockProviderTransfer(input.reference, MOCK_TRANSFER_OUTCOMES[input.outcome])) {
    throw mockTransferNotFound()
  }

  const event = transferEventFromProvider(
    await getPaymentProvider().verifyTransfer(input.reference),
  )
  // `applyTransferEvent` owns the transaction's work; the route opens the same
  // connection the verify path does and writes no ledger row of its own.
  const outcome = await db.transaction(async (tx) => applyTransferEvent(tx, event))
  if (!outcome.transferId) throw mockTransferNotFound()

  const detail = await getTransfer(currentUser(c), outcome.transferId)
  return c.json({ transfer: detail.transfer, paymentId: outcome.paymentId })
}

function mockTransferNotFound(): AppError {
  return new AppError(
    404,
    'MOCK_TRANSFER_NOT_FOUND',
    'The mock provider has no transfer with that reference',
  )
}

/**
 * The only sessionless mutating handler. The raw body is read exactly once:
 * re-serialising it would break the HMAC that is the sole credential.
 */
export async function receivePaystackWebhook(c: Context<AppEnv>, secret: string | null) {
  const rawBody = await c.req.text()

  if (rawBody.length > paymentsService.MAX_WEBHOOK_BYTES) {
    throw new AppError(413, 'WEBHOOK_TOO_LARGE', 'Webhook body is too large')
  }

  const signature = c.req.header('x-paystack-signature')
  if (!paymentsService.verifyWebhookSignature(rawBody, signature, secret)) {
    // No detail: the caller learns only that the signature did not match.
    return c.json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } }, 401)
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    throw new AppError(400, 'INVALID_WEBHOOK_BODY', 'Invalid webhook body')
  }

  await paymentsService.processPaystackEvent(rawBody, body)
  return c.json({ received: true })
}
