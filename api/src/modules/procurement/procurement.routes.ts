import { factory } from '../../http/factory.ts'

/**
 * Procurement routes. The paths are added by the plan that owns them; mounting an empty
 * router here keeps `app.ts` out of every later plan's diff.
 */
export const procurementRoutes = factory.createApp()
