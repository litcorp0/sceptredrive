import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as approvalsService from './approvals.service.ts'
import type { ApprovalDecisionBody, ApprovalListQuery } from './approvals.types.ts'

export async function listApprovals(
  c: Context<AppEnv>,
  query: {
    type?: ApprovalListQuery['type']
    status?: ApprovalListQuery['status']
    branchId?: string
    limit: number
    offset: number
  },
) {
  const user = currentUser(c)
  const result = await approvalsService.listApprovals(user, query)
  return c.json(result)
}

export async function getApproval(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const detail = await approvalsService.getApproval(user, actor, id)
  return c.json(detail)
}

export async function decideApproval(c: Context<AppEnv>, id: string, input: ApprovalDecisionBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const detail = await approvalsService.decideApproval(user, actor, id, input)
  return c.json(detail)
}

export async function withdrawApproval(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const approval = await approvalsService.withdrawApproval(user, actor, id)
  return c.json({ approval })
}
