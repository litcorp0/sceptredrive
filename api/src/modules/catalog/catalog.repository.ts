import { type DbExecutor, db } from '@gikautos/db'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { category } from './catalog.schema.ts'
import type { CategoryRow } from './catalog.types.ts'

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
