import { z } from 'zod'
import { currentUser, requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { rateLimit } from '../../http/rate-limit.ts'
import { requireSession } from '../../http/session.ts'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'
import { actorFromContext } from '../platform/audit.service.ts'
import { createEnrollment, redeemEnrollment } from './enrollment.service.ts'
import {
  createTerminal,
  getTerminal,
  listDevices,
  listTerminals,
  revokeDevice,
  updateTerminal,
} from './terminals.service.ts'

const idParamSchema = z.object({ id: z.uuid() })

const createTerminalSchema = z
  .object({
    branchId: z.uuid(),
    name: z.string().trim().min(2).max(80),
  })
  .strict()

const updateTerminalSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })

const listQuerySchema = z.object({
  branchId: z.uuid().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

const redeemSchema = z
  .object({
    code: z.string().trim().min(4).max(32),
  })
  .strict()

export const terminalsRoutes = factory.createApp()

terminalsRoutes.get(
  '/api/terminals',
  requireSession,
  requirePermission('terminal.read'),
  validateQuery(listQuerySchema),
  async (c) => {
    const user = currentUser(c)
    const query = c.req.valid('query')
    const terminals = await listTerminals(user, {
      branchId: query.branchId,
      includeInactive: query.includeInactive,
    })
    return c.json({ terminals })
  },
)

terminalsRoutes.post(
  '/api/terminals',
  requireSession,
  requirePermission('terminal.create'),
  validateJson(createTerminalSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const created = await createTerminal(user, actor, c.req.valid('json'))
    return c.json({ terminal: created }, 201)
  },
)

terminalsRoutes.get(
  '/api/terminals/:id',
  requireSession,
  requirePermission('terminal.read'),
  validateParam(idParamSchema),
  async (c) => {
    const user = currentUser(c)
    const found = await getTerminal(user, c.req.valid('param').id)
    return c.json({ terminal: found })
  },
)

terminalsRoutes.patch(
  '/api/terminals/:id',
  requireSession,
  requirePermission('terminal.update'),
  validateParam(idParamSchema),
  validateJson(updateTerminalSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const updated = await updateTerminal(user, actor, c.req.valid('param').id, c.req.valid('json'))
    return c.json({ terminal: updated })
  },
)

terminalsRoutes.post(
  '/api/terminals/:id/enrollment',
  requireSession,
  requirePermission('terminal.update'),
  validateParam(idParamSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const created = await createEnrollment(user, actor, c.req.valid('param').id)
    return c.json(
      { enrollment: { code: created.code, expiresAt: created.expiresAt.toISOString() } },
      201,
    )
  },
)

terminalsRoutes.get(
  '/api/terminals/:id/devices',
  requireSession,
  requirePermission('device.read'),
  validateParam(idParamSchema),
  async (c) => {
    const user = currentUser(c)
    const devices = await listDevices(user, c.req.valid('param').id)
    return c.json({ devices })
  },
)

terminalsRoutes.post(
  '/api/devices/:id/revoke',
  requireSession,
  requirePermission('device.revoke'),
  validateParam(idParamSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const revoked = await revokeDevice(user, actor, c.req.valid('param').id)
    return c.json({ device: revoked })
  },
)

// Device-facing: the POS redeems an enrollment code before it has credentials.
terminalsRoutes.post(
  '/api/enrollments/redeem',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'enrollments:redeem' }),
  validateJson(redeemSchema),
  async (c) => {
    await redeemEnrollment(c.req.valid('json').code)
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
  },
)
