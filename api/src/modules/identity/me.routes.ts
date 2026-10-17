import { z } from 'zod'
import { currentUser } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireFreshSession, requireSession } from '../../http/session.ts'
import { validateJson } from '../../http/validation.ts'
import { actorFromContext } from '../platform/audit.service.ts'
import { changeOwnPassword } from './staff.service.ts'

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(12).max(128),
  })
  .strict()

export const meRoutes = factory.createApp()

// requireSession admits this path even while mustChangePassword is set.
meRoutes.post(
  '/api/me/password',
  requireSession,
  requireFreshSession,
  validateJson(changePasswordSchema),
  async (c) => {
    const user = currentUser(c)
    const session = c.get('session')
    if (!session) {
      return c.json(
        {
          error: {
            message: 'Authentication required',
            code: 'UNAUTHORIZED',
            requestId: c.get('requestId'),
          },
        },
        401,
      )
    }
    const actor = actorFromContext(c)
    await changeOwnPassword(user, session, actor, c.req.valid('json'))
    return c.json({ ok: true })
  },
)
