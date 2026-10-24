import { type DbExecutor, db } from '@sceptre/db'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { brand, category, uom } from './catalog.schema.ts'
import type { BrandRow, CategoryRow, UomRow } from './catalog.types.ts'

export async function listCategoryRows(
  options: { includeArchived: boolean },
  executor: DbExecutor = db,
): Promise<CategoryRow[]> {
  return executor
    .select()
    .from(category)
    .where(options.includeArchived ? undefined : eq(category.isActive, true))
    .orderBy(asc(category.name))
}

export async function findCategoryById(
  id: string,
  executor: DbExecutor = db,
): Promise<CategoryRow | null> {
  const rows = await executor.select().from(category).where(eq(category.id, id)).limit(1)
  return rows[0] ?? null
}

export async function findCategoryByNameInsensitive(
  name: string,
  executor: DbExecutor = db,
): Promise<CategoryRow | null> {
  const rows = await executor
    .select()
    .from(category)
    .where(sql`lower(${category.name}) = ${name.toLowerCase()}`)
    .limit(1)
  return rows[0] ?? null
}

export async function countCategoryChildren(
  categoryId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(category)
    .where(eq(category.parentId, categoryId))
  return rows[0]?.total ?? 0
}

export async function countActiveCategoryChildren(
  categoryId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(category)
    .where(and(eq(category.parentId, categoryId), eq(category.isActive, true)))
  return rows[0]?.total ?? 0
}

export async function listChildCategoryIds(
  parentId: string,
  executor: DbExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ id: category.id })
    .from(category)
    .where(eq(category.parentId, parentId))
  return rows.map((row) => row.id)
}

export async function insertCategory(
  values: typeof category.$inferInsert,
  executor: DbExecutor = db,
): Promise<CategoryRow | null> {
  const rows = await executor.insert(category).values(values).returning()
  return rows[0] ?? null
}

export async function updateCategoryRow(
  id: string,
  patch: Partial<typeof category.$inferInsert>,
  executor: DbExecutor = db,
): Promise<CategoryRow | null> {
  const rows = await executor.update(category).set(patch).where(eq(category.id, id)).returning()
  return rows[0] ?? null
}

export async function listBrandRows(
  options: { includeArchived: boolean },
  executor: DbExecutor = db,
): Promise<BrandRow[]> {
  return executor
    .select()
    .from(brand)
    .where(options.includeArchived ? undefined : eq(brand.isActive, true))
    .orderBy(asc(brand.name))
}

export async function findBrandById(
  id: string,
  executor: DbExecutor = db,
): Promise<BrandRow | null> {
  const rows = await executor.select().from(brand).where(eq(brand.id, id)).limit(1)
  return rows[0] ?? null
}

export async function findBrandByNameInsensitive(
  name: string,
  executor: DbExecutor = db,
): Promise<BrandRow | null> {
  const rows = await executor
    .select()
    .from(brand)
    .where(sql`lower(${brand.name}) = ${name.toLowerCase()}`)
    .limit(1)
  return rows[0] ?? null
}

export async function insertBrand(
  values: typeof brand.$inferInsert,
  executor: DbExecutor = db,
): Promise<BrandRow | null> {
  const rows = await executor.insert(brand).values(values).returning()
  return rows[0] ?? null
}

export async function updateBrandRow(
  id: string,
  patch: Partial<typeof brand.$inferInsert>,
  executor: DbExecutor = db,
): Promise<BrandRow | null> {
  const rows = await executor.update(brand).set(patch).where(eq(brand.id, id)).returning()
  return rows[0] ?? null
}

export async function listUomRows(
  options: { includeArchived: boolean },
  executor: DbExecutor = db,
): Promise<UomRow[]> {
  return executor
    .select()
    .from(uom)
    .where(options.includeArchived ? undefined : eq(uom.isActive, true))
    .orderBy(asc(uom.code))
}

export async function findUomById(id: string, executor: DbExecutor = db): Promise<UomRow | null> {
  const rows = await executor.select().from(uom).where(eq(uom.id, id)).limit(1)
  return rows[0] ?? null
}

export async function findUomByCode(
  code: string,
  executor: DbExecutor = db,
): Promise<UomRow | null> {
  const rows = await executor.select().from(uom).where(eq(uom.code, code)).limit(1)
  return rows[0] ?? null
}

export async function insertUom(
  values: typeof uom.$inferInsert,
  executor: DbExecutor = db,
): Promise<UomRow | null> {
  const rows = await executor.insert(uom).values(values).returning()
  return rows[0] ?? null
}

export async function updateUomRow(
  id: string,
  patch: Partial<typeof uom.$inferInsert>,
  executor: DbExecutor = db,
): Promise<UomRow | null> {
  const rows = await executor.update(uom).set(patch).where(eq(uom.id, id)).returning()
  return rows[0] ?? null
}
