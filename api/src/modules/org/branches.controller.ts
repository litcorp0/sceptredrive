import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as branchesService from './branches.service.ts'
import type {
  BranchCreateInput,
  BranchListQuery,
  BranchUpdateInput,
  SuggestCodeQuery,
} from './branches.types.ts'

export async function listBranches(c: Context<AppEnv>, query: BranchListQuery) {
  const user = currentUser(c)
  const branches = await branchesService.listBranches(user, {
    includeInactive: query.includeInactive,
  })
  return c.json({ branches })
}

export async function createBranch(c: Context<AppEnv>, input: BranchCreateInput) {
  const actor = actorFromContext(c)
  const branch = await branchesService.createBranch(actor, input)
  return c.json({ branch }, 201)
}

export async function getBranch(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const branch = await branchesService.getBranch(user, id)
  return c.json({ branch })
}

export async function updateBranch(c: Context<AppEnv>, id: string, input: BranchUpdateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const branch = await branchesService.updateBranch(user, actor, id, input)
  return c.json({ branch })
}

export async function deactivateBranch(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const branch = await branchesService.deactivateBranch(actor, id)
  return c.json({ branch })
}

export async function suggestCode(c: Context<AppEnv>, query: SuggestCodeQuery) {
  const suggestion = await branchesService.suggestCode(query)
  return c.json(suggestion)
}
