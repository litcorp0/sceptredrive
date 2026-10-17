import type { Context } from 'hono'
import { currentUser } from '../../http/authorize.ts'
import { AppError } from '../../http/errors.ts'
import type { AppEnv } from '../../http/factory.ts'
import { actorFromContext } from '../platform/audit.service.ts'
import * as staffService from './staff.service.ts'
import type {
  ChangePasswordBody,
  StaffCreateBody,
  StaffListQuery,
  StaffUpdateBody,
} from './staff.types.ts'

export async function listStaff(c: Context<AppEnv>, query: StaffListQuery) {
  const user = currentUser(c)
  const result = await staffService.listStaff(user, {
    role: query.role,
    branchId: query.branchId,
    includeInactive: query.includeInactive,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
  })
  return c.json(result)
}

export async function createStaff(c: Context<AppEnv>, body: StaffCreateBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await staffService.createStaff(user, actor, body)
  return c.json(result, 201)
}

export async function getStaff(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const staff = await staffService.getStaff(user, id)
  return c.json({ staff })
}

export async function updateStaff(c: Context<AppEnv>, id: string, body: StaffUpdateBody) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const staff = await staffService.updateStaff(user, actor, id, body)
  return c.json({ staff })
}

export async function resetStaffPassword(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await staffService.resetStaffPassword(user, actor, id)
  return c.json(result)
}

export async function deactivateStaff(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const staff = await staffService.setStaffActive(user, actor, id, false)
  return c.json({ staff })
}

export async function reactivateStaff(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const staff = await staffService.setStaffActive(user, actor, id, true)
  return c.json({ staff })
}

export async function changeOwnPassword(c: Context<AppEnv>, body: ChangePasswordBody) {
  const user = currentUser(c)
  const session = c.get('session')
  if (!session) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required')
  const actor = actorFromContext(c)
  await staffService.changeOwnPassword(user, session, actor, body)
  return c.json({ ok: true })
}
