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
    {
      enrollment: {
        code: created.code,
        expiresAt: created.expiresAt.toISOString(),
        // The code is a credential, but the operator who just generated it is
        // entitled to know where it went — and whether it went anywhere at all.
        emailedTo: created.notification.sent,
        emailFailed: created.notification.failed,
        noRecipients: created.notification.noRecipients,
      },
    },
    201,
  )
}

export async function redeemEnrollment(c: Context<AppEnv>, body: RedeemEnrollmentBody) {
  const enrolled = await enrollmentService.redeemEnrollment(body.code, body.fingerprint)
  return c.json(enrolled, 201)
}
