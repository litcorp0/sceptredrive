import { createFactory } from 'hono/factory'
import type { Logger } from '../logger.ts'

export interface AppEnv {
  Variables: {
    requestId: string
    logger: Logger
  }
}

export const factory = createFactory<AppEnv>()
