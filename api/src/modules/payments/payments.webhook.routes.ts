import { env } from '../../config/env.ts'
import { factory } from '../../http/factory.ts'
import * as paymentsController from './payments.controller.ts'

/**
 * The Paystack webhook: one route, no session and no device JWT. Its only
 * credential is `x-paystack-signature`, which is why `app.ts` registers it
 * before `loadSession` (P13-D11).
 *
 * The secret is a parameter so a test can mount this exact route with a known
 * key; the default route resolves `env.paystackWebhookSecret`, which falls back
 * to the charge key when no dedicated webhook secret is staged.
 */
export function createPaystackWebhookRoutes(options: { secret?: string | null } = {}) {
  const secret = options.secret === undefined ? env.paystackWebhookSecret : options.secret
  const app = factory.createApp()

  app.post('/api/payments/webhook/paystack', (c) =>
    paymentsController.receivePaystackWebhook(c, secret),
  )

  return app
}

export const paystackWebhookRoutes = createPaystackWebhookRoutes()
