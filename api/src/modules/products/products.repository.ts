import { type DbExecutor, db } from '@sceptre/db'
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm'
import { brand, category, uom } from '../catalog/catalog.schema.ts'
import { barcode, product, productPrice } from './products.schema.ts'
import type {
  BarcodeRow,
  PriceContext,
  ProductListFilters,
  ProductListQueryRow,
  ProductPriceRow,
  ProductRow,
} from './products.types.ts'

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

export async function findProductBySku(
  sku: string,
  executor: DbExecutor = db,
): Promise<ProductRow | null> {
  const rows = await executor
    .select()
    .from(product)
    .where(eq(product.sku, sku.trim().toUpperCase()))
    .limit(1)
  return rows[0] ?? null
}

/**
 * The product that already owns this name inside this category (17-01).
 *
 * Comparison is in SQL on `lower(trim(name))` so two clients looking at the same
 * rows cannot disagree about what "the same name" means. An archived product
 * still counts: reactivating it is better than creating a twin beside it.
 */
export async function findProductNameConflict(
  name: string,
  categoryId: string,
  executor: DbExecutor = db,
  excludeProductId?: string,
): Promise<{ id: string; sku: string } | null> {
  const conditions = [
    sql`lower(trim(${product.name})) = lower(trim(${name}))`,
    eq(product.categoryId, categoryId),
  ]
  if (excludeProductId) conditions.push(sql`${product.id} <> ${excludeProductId}`)
  const rows = await executor
    .select({ id: product.id, sku: product.sku })
    .from(product)
    .where(and(...conditions))
    .limit(1)
  return rows[0] ?? null
}

/** The product that already owns this barcode, if any (17-01). */
export async function findBarcodeOwner(
  code: string,
  executor: DbExecutor = db,
): Promise<{ productId: string; sku: string } | null> {
  const rows = await executor
    .select({ productId: barcode.productId, sku: product.sku })
    .from(barcode)
    .innerJoin(product, eq(product.id, barcode.productId))
    .where(eq(barcode.code, code))
    .limit(1)
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

/**
 * Base price and the branch override in one row; null when the product is unknown.
 *
 * The band is measured against the price the branch actually charges (P12-D18), so
 * a decision needs both numbers from the same read: deriving the effective price
 * from two queries lets a concurrent base-price edit slip between them.
 */
export async function findPriceContext(
  productId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<PriceContext | null> {
  const rows = await executor
    .select({
      basePriceMinor: product.basePriceMinor,
      overrideMinor: productPrice.priceMinor,
      overrideRowId: productPrice.id,
      isActive: product.isActive,
    })
    .from(product)
    .leftJoin(
      productPrice,
      and(eq(productPrice.productId, product.id), eq(productPrice.branchId, branchId)),
    )
    .where(eq(product.id, productId))
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

function buildProductFilters(filters: ProductListFilters): SQL | undefined {
  const conditions: SQL[] = []

  if (!filters.includeArchived) conditions.push(eq(product.isActive, true))
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    conditions.push(inArray(product.categoryId, filters.categoryIds))
  }
  if (filters.brandId) conditions.push(eq(product.brandId, filters.brandId))

  // "Only what this branch carries" (P20-D22): a stock level here is the same membership
  // fact the stock list, the till and the branch column use. Without a branch there is
  // nothing to be a member of, so the filter is ignored rather than emptying the list.
  if (filters.carried && filters.branchId) {
    conditions.push(
      sql`exists (select 1 from stock_level sl where sl.product_id = ${product.id} and sl.branch_id = ${filters.branchId})`,
    )
  }

  if (filters.q) {
    const term = filters.q
    const escaped = term.replace(/[\\%_]/g, (match) => `\\${match}`)
    const matches = or(
      ilike(product.name, `%${escaped}%`),
      ilike(product.sku, `${escaped}%`),
      sql`exists (select 1 from ${barcode} where ${barcode.productId} = ${product.id} and ${barcode.code} = ${term})`,
    )
    if (matches) conditions.push(matches)
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}

export async function listProductRows(
  filters: ProductListFilters,
  executor: DbExecutor = db,
): Promise<ProductListQueryRow[]> {
  const overrideJoin = filters.branchId
    ? and(eq(productPrice.productId, product.id), eq(productPrice.branchId, filters.branchId))
    : sql`false`

  return executor
    .select({
      id: product.id,
      sku: product.sku,
      name: product.name,
      categoryId: product.categoryId,
      categoryName: category.name,
      brandId: product.brandId,
      brandName: brand.name,
      uomId: product.uomId,
      uomCode: uom.code,
      uomName: uom.name,
      taxCategory: product.taxCategory,
      isActive: product.isActive,
      basePriceMinor: product.basePriceMinor,
      overrideMinor: productPrice.priceMinor,
      barcodeCount: sql<number>`(select count(*)::int from ${barcode} where ${barcode.productId} = ${product.id})`,
      updatedAt: product.updatedAt,
    })
    .from(product)
    .innerJoin(category, eq(product.categoryId, category.id))
    .leftJoin(brand, eq(product.brandId, brand.id))
    .innerJoin(uom, eq(product.uomId, uom.id))
    .leftJoin(productPrice, overrideJoin)
    .where(buildProductFilters(filters))
    .orderBy(asc(product.name))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countProductRows(
  filters: ProductListFilters,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(product)
    .where(buildProductFilters(filters))
  return rows[0]?.total ?? 0
}
