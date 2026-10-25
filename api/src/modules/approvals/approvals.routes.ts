import { factory } from '../../http/factory.ts'

/**
 * Approvals routes. The paths are added by the plan that owns them; mounting an empty
 * router here keeps `app.ts` out of every later plan's diff.
 */
export const approvalsRoutes = factory.createApp()
