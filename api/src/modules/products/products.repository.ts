import { type DbExecutor, db } from '@gikautos/db'
import { and, asc, desc, eq } from 'drizzle-orm'
import { barcode, product, productPrice } from './products.schema.ts'
import type { BarcodeRow, ProductPriceRow, ProductRow } from './products.types.ts'

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

export async function updateProductRow(
  id: string,
  patch: Partial<typeof product.$inferInsert>,
  executor: DbExecutor = db,
): Promise<ProductRow | null> {
  const rows = await executor.update(product).set(patch).where(eq(product.id, id)).returning()
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

export async function findBarcodeForProduct(
  barcodeId: string,
  productId: string,
  executor: DbExecutor = db,
): Promise<BarcodeRow | null> {
  const rows = await executor
    .select()
    .from(barcode)
    .where(and(eq(barcode.id, barcodeId), eq(barcode.productId, productId)))
    .limit(1)
  return rows[0] ?? null
}

export async function deleteBarcodeRow(
  barcodeId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.delete(barcode).where(eq(barcode.id, barcodeId))
}

/**
 * Lists price overrides for a product. A branch id scopes the result to one
 * branch (managers); null returns every override (admins).
 */
export async function listProductPriceRows(
  productId: string,
  branchId: string | null = null,
  executor: DbExecutor = db,
): Promise<ProductPriceRow[]> {
  const filters = [eq(productPrice.productId, productId)]
  if (branchId) filters.push(eq(productPrice.branchId, branchId))
  return executor
    .select()
    .from(productPrice)
    .where(and(...filters))
    .orderBy(desc(productPrice.updatedAt))
}

export async function findProductPriceRow(
  productId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<ProductPriceRow | null> {
  const rows = await executor
    .select()
    .from(productPrice)
    .where(and(eq(productPrice.productId, productId), eq(productPrice.branchId, branchId)))
    .limit(1)
  return rows[0] ?? null
}

export async function insertProductPriceRow(
  values: typeof productPrice.$inferInsert,
  executor: DbExecutor = db,
): Promise<ProductPriceRow | null> {
  const rows = await executor.insert(productPrice).values(values).returning()
  return rows[0] ?? null
}

export async function updateProductPriceRow(
  id: string,
  patch: Partial<typeof productPrice.$inferInsert>,
  executor: DbExecutor = db,
): Promise<ProductPriceRow | null> {
  const rows = await executor
    .update(productPrice)
    .set(patch)
    .where(eq(productPrice.id, id))
    .returning()
  return rows[0] ?? null
}

export async function deleteProductPriceRow(id: string, executor: DbExecutor = db): Promise<void> {
  await executor.delete(productPrice).where(eq(productPrice.id, id))
}
