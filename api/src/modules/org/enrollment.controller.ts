import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as enrollmentService from './enrollment.service.ts'
import type { RedeemEnrollmentBody } from './enrollment.types.ts'

export async function createEnrollment(c: Context<AppEnv>, terminalId: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const created = await enrollmentService.createEnrollment(user, actor, terminalId)
  return c.json(
    { enrollment: { code: created.code, expiresAt: created.expiresAt.toISOString() } },
    201,
  )
}

export async function redeemEnrollment(c: Context<AppEnv>, body: RedeemEnrollmentBody) {
  await enrollmentService.redeemEnrollment(body.code)
  return c.json(
    {
      error: {
        message: 'Device tokens are issued in Phase 6 (PowerSync enrollment)',
        code: 'NOT_IMPLEMENTED',
        requestId: c.get('requestId'),
      },
    },
    501,
  )
}
