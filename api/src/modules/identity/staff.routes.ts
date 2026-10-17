import { ROLES } from '@gikautos/shared'
import { z } from 'zod'
import { currentUser, requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireFreshSession, requireSession } from '../../http/session.ts'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'
import { actorFromContext } from '../platform/audit.service.ts'
import {
  createStaff,
  getStaff,
  listStaff,
  resetStaffPassword,
  setStaffActive,
  updateStaff,
} from './staff.service.ts'

// Better Auth user IDs are opaque 32-char strings, not UUIDs.
const idParamSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
})

const createStaffSchema = z
  .object({
    email: z.email(),
    name: z.string().trim().min(2).max(120),
    role: z.enum(ROLES),
    branchId: z.uuid().nullish(),
    phone: z.string().trim().min(3).max(32).optional(),
  })
  .strict()

const updateStaffSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().min(3).max(32).optional(),
    role: z.enum(ROLES).optional(),
    branchId: z.uuid().nullish(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })

const listQuerySchema = z.object({
  role: z.enum(ROLES).optional(),
  branchId: z.uuid().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const staffRoutes = factory.createApp()

staffRoutes.get(
  '/api/staff',
  requireSession,
  requirePermission('staff.read'),
  validateQuery(listQuerySchema),
  async (c) => {
    const user = currentUser(c)
    const query = c.req.valid('query')
    const result = await listStaff(user, {
      role: query.role,
      branchId: query.branchId,
      includeInactive: query.includeInactive,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    })
    return c.json(result)
  },
)

staffRoutes.post(
  '/api/staff',
  requireSession,
  requirePermission('staff.create'),
  validateJson(createStaffSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const result = await createStaff(user, actor, c.req.valid('json'))
    return c.json(result, 201)
  },
)

staffRoutes.get(
  '/api/staff/:id',
  requireSession,
  requirePermission('staff.read'),
  validateParam(idParamSchema),
  async (c) => {
    const user = currentUser(c)
    const staff = await getStaff(user, c.req.valid('param').id)
    return c.json({ staff })
  },
)

staffRoutes.patch(
  '/api/staff/:id',
  requireSession,
  requirePermission('staff.update'),
  validateParam(idParamSchema),
  validateJson(updateStaffSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const staff = await updateStaff(user, actor, c.req.valid('param').id, c.req.valid('json'))
    return c.json({ staff })
  },
)

staffRoutes.post(
  '/api/staff/:id/reset-password',
  requireSession,
  requireFreshSession,
  requirePermission('staff.reset-password'),
  validateParam(idParamSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const result = await resetStaffPassword(user, actor, c.req.valid('param').id)
    return c.json(result)
  },
)

staffRoutes.post(
  '/api/staff/:id/deactivate',
  requireSession,
  requirePermission('staff.update'),
  validateParam(idParamSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const staff = await setStaffActive(user, actor, c.req.valid('param').id, false)
    return c.json({ staff })
  },
)

staffRoutes.post(
  '/api/staff/:id/reactivate',
  requireSession,
  requirePermission('staff.update'),
  validateParam(idParamSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const staff = await setStaffActive(user, actor, c.req.valid('param').id, true)
    return c.json({ staff })
  },
)
