import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as catalogService from './catalog.service.ts'
import type {
  BrandCreateInput,
  BrandUpdateInput,
  CatalogListQuery,
  CategoryCreateInput,
  CategoryUpdateInput,
  UomCreateInput,
  UomUpdateInput,
} from './catalog.types.ts'

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

export async function listBrands(c: Context<AppEnv>, query: CatalogListQuery) {
  const brands = await catalogService.listBrands({ includeArchived: query.includeArchived })
  return c.json({ brands })
}

export async function createBrand(c: Context<AppEnv>, input: BrandCreateInput) {
  const actor = actorFromContext(c)
  const brand = await catalogService.createBrand(actor, input)
  return c.json({ brand }, 201)
}

export async function updateBrand(c: Context<AppEnv>, id: string, input: BrandUpdateInput) {
  const actor = actorFromContext(c)
  const brand = await catalogService.updateBrand(actor, id, input)
  return c.json({ brand })
}

export async function archiveBrand(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const brand = await catalogService.archiveBrand(actor, id)
  return c.json({ brand })
}

export async function reactivateBrand(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const brand = await catalogService.reactivateBrand(actor, id)
  return c.json({ brand })
}

export async function listUoms(c: Context<AppEnv>, query: CatalogListQuery) {
  const uoms = await catalogService.listUoms({ includeArchived: query.includeArchived })
  return c.json({ uoms })
}

export async function createUom(c: Context<AppEnv>, input: UomCreateInput) {
  const actor = actorFromContext(c)
  const uom = await catalogService.createUom(actor, input)
  return c.json({ uom }, 201)
}

export async function updateUom(c: Context<AppEnv>, id: string, input: UomUpdateInput) {
  const actor = actorFromContext(c)
  const uom = await catalogService.updateUom(actor, id, input)
  return c.json({ uom })
}

export async function archiveUom(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const uom = await catalogService.archiveUom(actor, id)
  return c.json({ uom })
}

export async function reactivateUom(c: Context<AppEnv>, id: string) {
  const actor = actorFromContext(c)
  const uom = await catalogService.reactivateUom(actor, id)
  return c.json({ uom })
}
