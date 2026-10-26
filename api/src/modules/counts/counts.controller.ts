import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as countsService from './counts.service.ts'
import type {
  AbcListQuery,
  AbcManualInput,
  CountAccuracyQuery,
  CountCreateInput,
  CountLinesUpdateInput,
  CountListQuery,
  CountScheduleCreateInput,
  CountScheduleListQuery,
  CountScheduleUpdateInput,
} from './counts.types.ts'

export async function listCounts(c: Context<AppEnv>, query: CountListQuery) {
  const user = currentUser(c)
  const result = await countsService.listCounts(user, query)
  return c.json(result)
}

export async function createCount(c: Context<AppEnv>, input: CountCreateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const count = await countsService.createCount(user, actor, input)
  return c.json({ count }, 201)
}

export async function getCount(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const count = await countsService.getCount(user, id)
  return c.json({ count })
}

export async function updateCountLines(
  c: Context<AppEnv>,
  id: string,
  input: CountLinesUpdateInput,
) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const count = await countsService.updateCountLines(user, actor, id, input)
  return c.json({ count })
}

export async function postCount(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const count = await countsService.postCount(user, actor, id)
  return c.json({ count })
}

export async function cancelCount(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  await countsService.cancelCount(user, actor, id)
  return c.json({ ok: true })
}

// --- Schedules ---------------------------------------------------------------

export async function listCountSchedules(c: Context<AppEnv>, query: CountScheduleListQuery) {
  const user = currentUser(c)
  const result = await countsService.listCountSchedules(user, query)
  return c.json(result)
}

export async function createCountSchedule(c: Context<AppEnv>, input: CountScheduleCreateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const schedule = await countsService.createCountSchedule(user, actor, input)
  return c.json({ schedule }, 201)
}

export async function updateCountSchedule(
  c: Context<AppEnv>,
  id: string,
  input: CountScheduleUpdateInput,
) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const schedule = await countsService.updateCountSchedule(user, actor, id, input)
  return c.json({ schedule })
}

// --- ABC classes and accuracy ------------------------------------------------

export async function listAbcClasses(c: Context<AppEnv>, query: AbcListQuery) {
  const user = currentUser(c)
  const result = await countsService.listAbcClasses(user, query)
  return c.json(result)
}

export async function setAbcClassManually(
  c: Context<AppEnv>,
  productId: string,
  input: AbcManualInput,
) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  await countsService.setAbcClassManually(user, actor, productId, input)
  return c.json({ ok: true })
}

export async function recomputeAbcClasses(c: Context<AppEnv>, branchId: string | undefined) {
  const user = currentUser(c)
  // Reuses the service's own admin check through the same call path as the job.
  const result = branchId
    ? await countsService.recomputeAbcClassesForUser(user, branchId)
    : await countsService.recomputeAllAbcClassesForUser(user)
  return c.json(result)
}

export async function getCountAccuracy(c: Context<AppEnv>, query: CountAccuracyQuery) {
  const user = currentUser(c)
  const accuracy = await countsService.getCountAccuracy(user, query)
  return c.json(accuracy)
}
