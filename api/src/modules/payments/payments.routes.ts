import type { Hono } from 'hono'
import { env } from '../../config/env.ts'
import { requirePermission } from '../../http/authorize.ts'
import { requireDeviceJwt } from '../../http/device-auth.ts'
import { type AppEnv, factory } from '../../http/factory.ts'
import { rateLimit } from '../../http/rate-limit.ts'
import { requireSession } from '../../http/session.ts'
import * as paymentsController from './payments.controller.ts'
import type { PaymentMode } from './payments.types.ts'
import {
  validateClaimPayment,
  validateCreatePayment,
  validateMockSettle,
  validateMockSettleTransfer,
  validatePaymentIdParam,
  validatePaymentQuery,
} from './payments.validation.ts'

/**
 * Device-facing payment intents. A terminal has no browser session; the device
 * JWT is the identity, and the bucket is the terminal so a shared shop IP does
 * not throttle every till at once (P13-D10, P13-D39).
 */
export const paymentsRoutes = factory.createApp()

paymentsRoutes.post(
  '/api/pos/payments',
  requireDeviceJwt,
  rateLimit({
    windowMs: 60_000,
    max: 30,
    keyPrefix: 'pos:payment:create',
    keyForRequest: (c) => c.get('device')?.deviceId ?? null,
  }),
  validateCreatePayment,
  (c) => paymentsController.createPayment(c, c.req.valid('json')),
)

paymentsRoutes.get(
  '/api/pos/payments/:id',
  requireDeviceJwt,
  rateLimit({
    windowMs: 60_000,
    max: 120,
    keyPrefix: 'pos:payment:get',
    keyForRequest: (c) => c.get('device')?.deviceId ?? null,
  }),
  validatePaymentIdParam,
  validatePaymentQuery,
  (c) =>
    paymentsController.getPayment(c, c.req.valid('param').id, {
      refresh: c.req.valid('query').refresh === '1',
    }),
)

paymentsRoutes.post(
  '/api/pos/payments/:id/abandon',
  requireDeviceJwt,
  rateLimit({
    windowMs: 60_000,
    max: 30,
    keyPrefix: 'pos:payment:abandon',
    keyForRequest: (c) => c.get('device')?.deviceId ?? null,
  }),
  validatePaymentIdParam,
  (c) => paymentsController.abandonPayment(c, c.req.valid('param').id),
)

paymentsRoutes.post(
  '/api/pos/payments/:id/claim',
  requireDeviceJwt,
  rateLimit({
    windowMs: 60_000,
    max: 30,
    keyPrefix: 'pos:payment:claim',
    keyForRequest: (c) => c.get('device')?.deviceId ?? null,
  }),
  validatePaymentIdParam,
  validateClaimPayment,
  (c) => paymentsController.claimPayment(c, c.req.valid('param').id, c.req.valid('json')),
)

/**
 * The harness route is built in its own app and registered only when
 * `PAYSTACK_MODE === 'mock'` (P13-D10). In `test`/`live` it does not exist, so
 * no session, permission or configuration can reach it.
 */
export const mockPaymentRoutes = factory.createApp()

mockPaymentRoutes.post(
  '/api/payments/mock/settle',
  requireSession,
  requirePermission('settings.update'),
  validateMockSettle,
  (c) => paymentsController.settleMockPayment(c, c.req.valid('json')),
)

// The supplier-transfer half of the same harness: it settles through
// `applyTransferEvent`, so ending a walkthrough with a real payment proves the
// path Paystack's webhook and the console's verify will take in production.
mockPaymentRoutes.post(
  '/api/payments/mock/settle-transfer',
  requireSession,
  requirePermission('settings.update'),
  validateMockSettleTransfer,
  (c) => paymentsController.settleMockTransfer(c, c.req.valid('json')),
)

/** One seam for `app.ts` and the mode test: the mock route is conditional. */
export function mountPaymentRoutes(
  target: Hono<AppEnv>,
  mode: PaymentMode = env.PAYSTACK_MODE,
): void {
  target.route('/', paymentsRoutes)
  if (mode === 'mock') target.route('/', mockPaymentRoutes)
}
