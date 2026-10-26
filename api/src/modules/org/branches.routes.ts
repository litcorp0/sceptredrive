import { requirePermission } from '../../http/authorize.ts'
import { factory } from '../../http/factory.ts'
import { requireSession } from '../../http/session.ts'
import * as branchesController from './branches.controller.ts'
import {
  validateBranchCreate,
  validateBranchIdParam,
  validateBranchListQuery,
  validateBranchUpdate,
  validateSuggestCodeQuery,
} from './branches.validation.ts'

export const branchesRoutes = factory.createApp()

branchesRoutes.get(
  '/api/branches',
  requireSession,
  requirePermission('branch.read'),
  validateBranchListQuery,
  (c) => branchesController.listBranches(c, c.req.valid('query')),
)

branchesRoutes.post(
  '/api/branches',
  requireSession,
  requirePermission('branch.create'),
  validateBranchCreate,
  (c) => branchesController.createBranch(c, c.req.valid('json')),
)

branchesRoutes.get(
  '/api/branches/suggest-code',
  requireSession,
  requirePermission('branch.read'),
  validateSuggestCodeQuery,
  (c) => branchesController.suggestCode(c, c.req.valid('query')),
)

// Registered before `/api/branches/:id`, or the uuid validator swallows it.
branchesRoutes.get(
  '/api/branches/directory',
  requireSession,
  requirePermission('branch.read'),
  (c) => branchesController.listBranchDirectory(c),
)

branchesRoutes.get(
  '/api/branches/:id',
  requireSession,
  requirePermission('branch.read'),
  validateBranchIdParam,
  (c) => branchesController.getBranch(c, c.req.valid('param').id),
)

branchesRoutes.patch(
  '/api/branches/:id',
  requireSession,
  requirePermission('branch.update'),
  validateBranchIdParam,
  validateBranchUpdate,
  (c) => branchesController.updateBranch(c, c.req.valid('param').id, c.req.valid('json')),
)

branchesRoutes.post(
  '/api/branches/:id/deactivate',
  requireSession,
  requirePermission('branch.deactivate'),
  validateBranchIdParam,
  (c) => branchesController.deactivateBranch(c, c.req.valid('param').id),
)
