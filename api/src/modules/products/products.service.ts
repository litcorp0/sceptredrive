import { type DbExecutor, db } from '@gikautos/db'
import { and, count, eq } from 'drizzle-orm'
import { AppError, ConflictError, NotFoundError } from '../../http/errors.ts'
import { findBrandById, findCategoryById, findUomById } from '../catalog/catalog.repository.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation, uniqueViolationConstraint } from '../platform/db-errors.ts'
import { allocateFromSequence, peekSequenceValue } from '../platform/settings.service.ts'
import { insertBarcode, insertProduct } from './products.repository.ts'
import { product } from './products.schema.ts'
import type { BarcodeRow, ProductCreateInput, ProductWithBarcodes } from './products.types.ts'

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

/** Counts active products that reference a brand (catalog archive guard). */
export async function countActiveProductsByBrand(
  brandId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(product)
    .where(and(eq(product.brandId, brandId), eq(product.isActive, true)))
  return rows[0]?.total ?? 0
}

/** Counts active products that reference a unit of measure (catalog archive guard). */
export async function countActiveProductsByUom(
  uomId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(product)
    .where(and(eq(product.uomId, uomId), eq(product.isActive, true)))
  return rows[0]?.total ?? 0
}

function normalizeBarcodes(codes: readonly string[] | undefined): string[] {
  if (!codes) return []
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of codes) {
    const code = raw.trim()
    if (!code || seen.has(code)) continue
    seen.add(code)
    normalized.push(code)
  }
  return normalized
}

/** Peeks the next SKU without consuming the sequence. */
export async function suggestSku(): Promise<{ sku: string }> {
  return { sku: await peekSequenceValue('catalog.skuSequence') }
}

/**
 * Creates a product with optional barcodes in a single transaction. When no
 * SKU is supplied it is allocated atomically from `catalog.skuSequence`.
 */
export async function createProduct(
  actor: AuditActor,
  input: ProductCreateInput,
): Promise<ProductWithBarcodes> {
  try {
    return await db.transaction(async (tx) => {
      const sku = input.sku ?? (await allocateFromSequence('catalog.skuSequence', tx))

      const category = await findCategoryById(input.categoryId, tx)
      if (!category) throw new NotFoundError('Category not found')
      if (!category.isActive) throw new ConflictError('The category is archived')

      let brandId: string | null = null
      if (input.brandId) {
        const brandRow = await findBrandById(input.brandId, tx)
        if (!brandRow) throw new NotFoundError('Brand not found')
        if (!brandRow.isActive) throw new ConflictError('The brand is archived')
        brandId = brandRow.id
      }

      const unit = await findUomById(input.uomId, tx)
      if (!unit) throw new NotFoundError('Unit not found')
      if (!unit.isActive) throw new ConflictError('The unit is archived')

      const created = await insertProduct(
        {
          sku,
          name: input.name,
          description: input.description ?? null,
          categoryId: category.id,
          brandId,
          uomId: unit.id,
          costPriceMinor: input.costPriceMinor ?? 0,
          basePriceMinor: input.basePriceMinor,
          taxCategory: input.taxCategory ?? 'STANDARD',
          createdBy: actor.actorId,
        },
        tx,
      )
      if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create product')

      const barcodeRows: BarcodeRow[] = []
      for (const code of normalizeBarcodes(input.barcodes)) {
        try {
          const row = await insertBarcode(
            { productId: created.id, code, createdBy: actor.actorId },
            tx,
          )
          if (row) barcodeRows.push(row)
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConflictError(`Barcode ${code} is already in use`)
          }
          throw error
        }
      }

      await writeAudit(
        {
          ...actor,
          action: 'product.created',
          entity: 'product',
          entityId: created.id,
          after: { ...created, barcodes: barcodeRows.map((row) => row.code) },
        },
        tx,
      )

      return { ...created, barcodes: barcodeRows }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const constraint = uniqueViolationConstraint(error)
      if (constraint?.includes('sku')) {
        throw new ConflictError('A product with this SKU already exists')
      }
    }
    throw error
  }
}
