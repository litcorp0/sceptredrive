import { createFactory } from 'hono/factory'
import type { AuthSession } from '../auth/auth.ts'
import type { Logger } from '../logger.ts'
import type { DeviceAuthContext } from '../modules/sync/sync.types.ts'

export type SessionData = AuthSession['session']
export type SessionUser = AuthSession['user']

export interface AppEnv {
  Variables: {
    requestId: string
    logger: Logger
    session: SessionData | null
    user: SessionUser | null
    /** Set by `requireDeviceJwt` on device-authenticated POS routes. */
    device: DeviceAuthContext | null
  }
}

export const factory = createFactory<AppEnv>()
