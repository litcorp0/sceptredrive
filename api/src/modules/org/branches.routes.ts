import { BRANCH_TYPES, isValidBranchCode } from '@gikautos/shared'
import { z } from 'zod'
import { currentUser, requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'
import { actorFromContext } from '../platform/audit.service.ts'
import {
  createBranch,
  deactivateBranch,
  getBranch,
  listBranches,
  suggestCode,
  updateBranch,
} from './branches.service.ts'

const idParamSchema = z.object({ id: z.uuid() })

const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .refine(isValidBranchCode, { message: 'Invalid branch code format' })

const branchCreateSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(2).max(120),
    type: z.enum(BRANCH_TYPES),
    city: z.string().trim().min(1).max(80),
    area: z.string().trim().min(1).max(80).optional(),
    address: z.string().trim().min(1).max(240).optional(),
    phone: z.string().trim().min(3).max(32).optional(),
  })
  .strict()

const branchUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    area: z.string().trim().min(1).max(80).optional(),
    address: z.string().trim().min(1).max(240).optional(),
    phone: z.string().trim().min(3).max(32).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })

const listQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
})

const suggestQuerySchema = z.object({
  city: z.string().trim().min(1).max(80),
  area: z.string().trim().min(1).max(80).optional(),
  type: z.enum(BRANCH_TYPES),
})

export const branchesRoutes = factory.createApp()

branchesRoutes.get(
  '/api/branches',
  requireSession,
  requirePermission('branch.read'),
  validateQuery(listQuerySchema),
  async (c) => {
    const user = currentUser(c)
    const { includeInactive } = c.req.valid('query')
    const branches = await listBranches(user, { includeInactive })
    return c.json({ branches })
  },
)

branchesRoutes.post(
  '/api/branches',
  requireSession,
  requirePermission('branch.create'),
  validateJson(branchCreateSchema),
  async (c) => {
    const actor = actorFromContext(c)
    const created = await createBranch(actor, c.req.valid('json'))
    return c.json({ branch: created }, 201)
  },
)

branchesRoutes.get(
  '/api/branches/suggest-code',
  requireSession,
  requirePermission('branch.read'),
  validateQuery(suggestQuerySchema),
  async (c) => {
    const suggestion = await suggestCode(c.req.valid('query'))
    return c.json(suggestion)
  },
)

branchesRoutes.get(
  '/api/branches/:id',
  requireSession,
  requirePermission('branch.read'),
  validateParam(idParamSchema),
  async (c) => {
    const user = currentUser(c)
    const found = await getBranch(user, c.req.valid('param').id)
    return c.json({ branch: found })
  },
)

branchesRoutes.patch(
  '/api/branches/:id',
  requireSession,
  requirePermission('branch.update'),
  validateParam(idParamSchema),
  validateJson(branchUpdateSchema),
  async (c) => {
    const user = currentUser(c)
    const actor = actorFromContext(c)
    const updated = await updateBranch(user, actor, c.req.valid('param').id, c.req.valid('json'))
    return c.json({ branch: updated })
  },
)

branchesRoutes.post(
  '/api/branches/:id/deactivate',
  requireSession,
  requirePermission('branch.deactivate'),
  validateParam(idParamSchema),
  async (c) => {
    const actor = actorFromContext(c)
    const deactivated = await deactivateBranch(actor, c.req.valid('param').id)
    return c.json({ branch: deactivated })
  },
)
