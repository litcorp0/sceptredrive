import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as catalogService from './catalog.service.ts'
import type { CatalogListQuery, CategoryCreateInput, CategoryUpdateInput } from './catalog.types.ts'

export async function listCategories(c: Context<AppEnv>, query: CatalogListQuery) {
  const categories = await catalogService.listCategories({
    includeArchived: query.includeArchived,
  })
  return c.json({ categories })
}

export async function createCategory(c: Context<AppEnv>, input: CategoryCreateInput) {
  const actor = actorFromContext(c)
  const category = await catalogService.createCategory(actor, input)
  return c.json({ category }, 201)
}

export async function updateCategory(c: Context<AppEnv>, id: string, input: CategoryUpdateInput) {
  const actor = actorFromContext(c)
  const category = await catalogService.updateCategory(actor, id, input)
  return c.json({ category })
}

export async function archiveCategory(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const category = await catalogService.archiveCategory(actor, id)
  return c.json({ category })
}

export async function reactivateCategory(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const category = await catalogService.reactivateCategory(actor, id)
  return c.json({ category })
}
