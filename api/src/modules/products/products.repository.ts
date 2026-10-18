import { type DbExecutor, db } from '@gikautos/db'
import { asc, eq } from 'drizzle-orm'
import { barcode, product } from './products.schema.ts'
import type { BarcodeRow, ProductRow } from './products.types.ts'

export async function insertProduct(
  values: typeof product.$inferInsert,
  executor: DbExecutor = db,
): Promise<ProductRow | null> {
  const rows = await executor.insert(product).values(values).returning()
  return rows[0] ?? null
}

export async function findProductById(
  id: string,
  executor: DbExecutor = db,
): Promise<ProductRow | null> {
  const rows = await executor.select().from(product).where(eq(product.id, id)).limit(1)
  return rows[0] ?? null
}

export async function insertBarcode(
  values: typeof barcode.$inferInsert,
  executor: DbExecutor = db,
): Promise<BarcodeRow | null> {
  const rows = await executor.insert(barcode).values(values).returning()
  return rows[0] ?? null
}

export async function listBarcodesByProduct(
  productId: string,
  executor: DbExecutor = db,
): Promise<BarcodeRow[]> {
  return executor
    .select()
    .from(barcode)
    .where(eq(barcode.productId, productId))
    .orderBy(asc(barcode.createdAt))
}
