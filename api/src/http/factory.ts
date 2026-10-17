import { createFactory } from 'hono/factory'
import type { AuthSession } from '../auth/auth.ts'
import type { Logger } from '../logger.ts'

export type SessionData = AuthSession['session']
export type SessionUser = AuthSession['user']

export interface AppEnv {
  Variables: {
    requestId: string
    logger: Logger
    session: SessionData | null
    user: SessionUser | null
  }
}

export const factory = createFactory<AppEnv>()
