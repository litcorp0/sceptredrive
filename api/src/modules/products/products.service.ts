import { type DbExecutor, db } from '@gikautos/db'
import { and, count, eq } from 'drizzle-orm'
import { product } from './products.schema.ts'

/**
 * Counts active products that reference a category. Used by the catalog
 * service as an archive guard (service-to-service, no module cycle).
 */
export async function countActiveProductsByCategory(
  categoryId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(product)
    .where(and(eq(product.categoryId, categoryId), eq(product.isActive, true)))
  return rows[0]?.total ?? 0
}
