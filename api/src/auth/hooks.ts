import type { BetterAuthOptions } from 'better-auth'
import { clientIpFromHeaders } from '../http/request-meta.ts'
import { writeAudit } from '../modules/platform/audit.service.ts'

type DatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>
type UserCreateAfter = NonNullable<
  NonNullable<NonNullable<DatabaseHooks['user']>['create']>['after']
>
type HookContext = Parameters<UserCreateAfter>[1]

interface HookMeta {
  ip: string | null
  userAgent: string | null
  requestId: string | null
}

function metaFrom(context: HookContext): HookMeta {
  const headers = context?.request?.headers ?? context?.headers
  if (!headers) return { ip: null, userAgent: null, requestId: null }
  return {
    ip: clientIpFromHeaders(headers),
    userAgent: headers.get('user-agent'),
    requestId: headers.get('x-request-id'),
  }
}

/**
 * Better Auth database hooks: append-only audit entries for security-relevant
 * auth events, plus a fail-closed gate that refuses to create sessions for
 * deactivated accounts.
 */
export const authDatabaseHooks: DatabaseHooks = {
  user: {
    create: {
      after: async (user, context) => {
        await writeAudit({
          actorId: user.id,
          action: 'auth.user.created',
          entity: 'user',
          entityId: user.id,
          after: { role: user.role ?? null },
          ...metaFrom(context),
        })
      },
    },
    update: {
      after: async (user, context) => {
        await writeAudit({
          action: 'auth.user.updated',
          entity: 'user',
          entityId: user.id,
          ...metaFrom(context),
        })
      },
    },
  },
  session: {
    create: {
      before: async (session, context) => {
        const adapter = context?.context?.adapter
        if (!adapter) return false
        const target = await adapter.findOne<{ isActive: boolean | null }>({
          model: 'user',
          where: [{ field: 'id', value: session.userId }],
        })
        return target?.isActive === true
      },
      after: async (session, context) => {
        await writeAudit({
          actorId: session.userId,
          action: 'auth.session.created',
          entity: 'session',
          entityId: session.id,
          ...metaFrom(context),
        })
      },
    },
    delete: {
      after: async (session, context) => {
        await writeAudit({
          actorId: session.userId,
          action: 'auth.session.revoked',
          entity: 'session',
          entityId: session.id,
          ...metaFrom(context),
        })
      },
    },
  },
  account: {
    create: {
      after: async (account, context) => {
        await writeAudit({
          actorId: account.userId,
          action: 'auth.account.linked',
          entity: 'account',
          entityId: account.id,
          after: { providerId: account.providerId },
          ...metaFrom(context),
        })
      },
    },
  },
}
