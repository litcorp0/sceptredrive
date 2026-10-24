import { factory } from '../http/factory.ts'
import { getSettingValue } from '../modules/platform/settings.service.ts'

export const authPolicyRoutes = factory.createApp()

/**
 * Public authentication policy.
 *
 * The console's route guards need to know whether TOTP is compulsory before
 * they can decide where to send a signed-in administrator. The value is a
 * single boolean and carries no secrets, so it is safe to read anonymously.
 * The setting itself is admin-only and validated server-side.
 *
 * Registered **before** the Better Auth catch-all so it is not swallowed by it.
 */
authPolicyRoutes.get('/api/auth/policy', async (c) => {
  const requireTwoFactor = await getSettingValue('auth.requireTwoFactor')
  // A policy change must take effect on the next navigation, not after a cache.
  c.header('Cache-Control', 'no-store')
  return c.json({ requireTwoFactor })
})
