import { type DbExecutor, db } from '@sceptre/db'
import { resolveEffectivePrice } from '@sceptre/shared'
import { and, count, eq } from 'drizzle-orm'
import { branchScope, resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import * as approvalsService from '../approvals/approvals.service.ts'
import { registerDecisionHandler } from '../approvals/approvals.service.ts'
import {
  findBrandById,
  findCategoryById,
  findUomById,
  listChildCategoryIds,
} from '../catalog/catalog.repository.ts'
import * as inventoryService from '../inventory/inventory.service.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation, uniqueViolationConstraint } from '../platform/db-errors.ts'
import {
  advanceSequencePast,
  allocateFromSequence,
  peekSequenceValue,
} from '../platform/settings.service.ts'
import * as suppliersService from '../suppliers/suppliers.service.ts'
import {
  countProductRows,
  deleteBarcodeRow,
  deleteProductPriceRow,
  findBarcodeForProduct,
  findProductById,
  findProductPriceRow,
  insertBarcode,
  insertProduct,
  insertProductPriceRow,
  listBarcodesByProduct,
  listProductPriceRows,
  listProductRows,
  updateProductPriceRow,
  updateProductRow,
} from './products.repository.ts'
import { product } from './products.schema.ts'
import type {
  BarcodeRow,
  ProductCreateInput,
  ProductDetail,
  ProductListFilters,
  ProductListQuery,
  ProductListRow,
  ProductPriceRow,
  ProductRow,
  ProductSubmissionBody,
  ProductUpdateInput,
  ProductWithBarcodes,
} from './products.types.ts'
import { productSubmissionSchema } from './products.validation.ts'

async function validateCategoryRef(categoryId: string, executor: DbExecutor): Promise<string> {
  const category = await findCategoryById(categoryId, executor)
  if (!category) throw new NotFoundError('Category not found')
  if (!category.isActive) throw new ConflictError('The category is archived')
  return category.id
}

async function validateBrandRef(
  brandId: string | null | undefined,
  executor: DbExecutor,
): Promise<string | null> {
  if (!brandId) return null
  const brandRow = await findBrandById(brandId, executor)
  if (!brandRow) throw new NotFoundError('Brand not found')
  if (!brandRow.isActive) throw new ConflictError('The brand is archived')
  return brandRow.id
}

async function validateUomRef(uomId: string, executor: DbExecutor): Promise<string> {
  const unit = await findUomById(uomId, executor)
  if (!unit) throw new NotFoundError('Unit not found')
  if (!unit.isActive) throw new ConflictError('The unit is archived')
  return unit.id
}

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

      const categoryId = await validateCategoryRef(input.categoryId, tx)
      const brandId = await validateBrandRef(input.brandId, tx)
      const uomId = await validateUomRef(input.uomId, tx)

      const created = await insertProduct(
        {
          sku,
          name: input.name,
          description: input.description ?? null,
          categoryId,
          brandId,
          uomId,
          costPriceMinor: input.costPriceMinor ?? 0,
          basePriceMinor: input.basePriceMinor,
          taxCategory: input.taxCategory ?? 'STANDARD',
          createdBy: actor.actorId,
        },
        tx,
      )
      if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create product')

      if (input.sku) {
        await advanceSequencePast('catalog.skuSequence', created.sku, tx)
      }

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

/** Full product detail with barcodes and the caller's visible price overrides. */
export async function getProductDetail(user: SessionUser, id: string): Promise<ProductDetail> {
  const found = await findProductById(id)
  if (!found) throw new NotFoundError('Product not found')

  const barcodes = await listBarcodesByProduct(id)
  const scope = branchScope(user)
  const overrides = await listProductPriceRows(id, scope)

  return { ...found, barcodes, overrides }
}

export async function updateProduct(
  actor: AuditActor,
  id: string,
  input: ProductUpdateInput,
): Promise<ProductRow> {
  try {
    return await db.transaction(async (tx) => {
      const existing = await findProductById(id, tx)
      if (!existing) throw new NotFoundError('Product not found')

      const patch: Partial<typeof product.$inferInsert> = {}

      if (input.sku !== undefined && input.sku !== existing.sku) patch.sku = input.sku
      if (input.name !== undefined && input.name !== existing.name) patch.name = input.name
      if (input.description !== undefined && input.description !== existing.description) {
        patch.description = input.description
      }
      if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
        patch.categoryId = await validateCategoryRef(input.categoryId, tx)
      }
      if (input.brandId !== undefined) {
        const targetBrandId = input.brandId ?? null
        if (targetBrandId !== existing.brandId) {
          patch.brandId = await validateBrandRef(targetBrandId, tx)
        }
      }
      if (input.uomId !== undefined && input.uomId !== existing.uomId) {
        patch.uomId = await validateUomRef(input.uomId, tx)
      }
      if (input.costPriceMinor !== undefined && input.costPriceMinor !== existing.costPriceMinor) {
        patch.costPriceMinor = input.costPriceMinor
      }
      if (input.basePriceMinor !== undefined && input.basePriceMinor !== existing.basePriceMinor) {
        patch.basePriceMinor = input.basePriceMinor
      }
      if (input.taxCategory !== undefined && input.taxCategory !== existing.taxCategory) {
        patch.taxCategory = input.taxCategory
      }

      if (Object.keys(patch).length === 0) return existing

      const updated = await updateProductRow(id, patch, tx)
      if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update product')

      if (patch.sku !== undefined) {
        await advanceSequencePast('catalog.skuSequence', updated.sku, tx)
      }

      await writeAudit(
        {
          ...actor,
          action: 'product.updated',
          entity: 'product',
          entityId: id,
          before: existing,
          after: updated,
        },
        tx,
      )
      return updated
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

export async function archiveProduct(actor: AuditActor, id: string): Promise<ProductRow> {
  return db.transaction(async (tx) => {
    const existing = await findProductById(id, tx)
    if (!existing) throw new NotFoundError('Product not found')
    if (!existing.isActive) return existing

    const onHand = await inventoryService.getOnHandTotal(id, tx)
    if (onHand !== 0) {
      throw new ConflictError('Cannot archive a product with stock on hand')
    }

    const updated = await updateProductRow(id, { isActive: false }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to archive product')

    await writeAudit(
      {
        ...actor,
        action: 'product.archived',
        entity: 'product',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false },
      },
      tx,
    )
    return updated
  })
}

export async function reactivateProduct(actor: AuditActor, id: string): Promise<ProductRow> {
  return db.transaction(async (tx) => {
    const existing = await findProductById(id, tx)
    if (!existing) throw new NotFoundError('Product not found')
    if (existing.isActive) return existing

    const updated = await updateProductRow(id, { isActive: true }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to reactivate product')

    await writeAudit(
      {
        ...actor,
        action: 'product.reactivated',
        entity: 'product',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true },
      },
      tx,
    )
    return updated
  })
}

export async function addProductBarcode(
  actor: AuditActor,
  productId: string,
  code: string,
): Promise<BarcodeRow> {
  return db.transaction(async (tx) => {
    const existing = await findProductById(productId, tx)
    if (!existing) throw new NotFoundError('Product not found')

    let created: BarcodeRow | null = null
    try {
      created = await insertBarcode({ productId, code, createdBy: actor.actorId }, tx)
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Barcode ${code} is already in use`)
      }
      throw error
    }
    if (!created) throw new AppError(500, 'INTERNAL', 'Failed to add barcode')

    await writeAudit(
      {
        ...actor,
        action: 'product.barcode.added',
        entity: 'product',
        entityId: productId,
        after: { code: created.code },
      },
      tx,
    )
    return created
  })
}

export async function removeProductBarcode(
  actor: AuditActor,
  productId: string,
  barcodeId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await findBarcodeForProduct(barcodeId, productId, tx)
    if (!existing) throw new NotFoundError('Barcode not found')

    await deleteBarcodeRow(barcodeId, tx)

    await writeAudit(
      {
        ...actor,
        action: 'product.barcode.removed',
        entity: 'product',
        entityId: productId,
        before: { code: existing.code },
      },
      tx,
    )
  })
}

export interface PriceOverrideInput {
  branchId: string
  priceMinor: number
}

/** Admin upserts any branch; managers only their own (checked via branch access). */
export async function setPriceOverride(
  user: SessionUser,
  actor: AuditActor,
  productId: string,
  input: PriceOverrideInput,
): Promise<ProductPriceRow> {
  const found = await findProductById(productId)
  if (!found) throw new NotFoundError('Product not found')

  const branchRow = await branchesService.getBranch(user, input.branchId)
  if (!branchRow.isActive) throw new ConflictError('The branch is inactive')

  return db.transaction(async (tx) => {
    const existing = await findProductPriceRow(productId, input.branchId, tx)

    let saved: ProductPriceRow | null
    if (existing) {
      saved = await updateProductPriceRow(
        existing.id,
        { priceMinor: input.priceMinor, updatedBy: actor.actorId },
        tx,
      )
    } else {
      saved = await insertProductPriceRow(
        {
          productId,
          branchId: input.branchId,
          priceMinor: input.priceMinor,
          updatedBy: actor.actorId,
        },
        tx,
      )
    }
    if (!saved) throw new AppError(500, 'INTERNAL', 'Failed to set price override')

    await writeAudit(
      {
        ...actor,
        action: 'product.price.override_set',
        entity: 'product',
        entityId: productId,
        before: existing ? { branchId: input.branchId, priceMinor: existing.priceMinor } : null,
        after: { branchId: input.branchId, priceMinor: saved.priceMinor },
      },
      tx,
    )
    return saved
  })
}

export async function removePriceOverride(
  user: SessionUser,
  actor: AuditActor,
  productId: string,
  branchId: string,
): Promise<void> {
  const found = await findProductById(productId)
  if (!found) throw new NotFoundError('Product not found')

  await branchesService.getBranch(user, branchId)

  await db.transaction(async (tx) => {
    const existing = await findProductPriceRow(productId, branchId, tx)
    if (!existing) throw new NotFoundError('Price override not found')

    await deleteProductPriceRow(existing.id, tx)

    await writeAudit(
      {
        ...actor,
        action: 'product.price.override_removed',
        entity: 'product',
        entityId: productId,
        before: { branchId, priceMinor: existing.priceMinor },
        after: null,
      },
      tx,
    )
  })
}

/** Base price plus the overrides the caller may see (managers: own branch). */
export async function getPriceOverrides(
  user: SessionUser,
  productId: string,
): Promise<{ basePriceMinor: number; overrides: ProductPriceRow[] }> {
  const found = await findProductById(productId)
  if (!found) throw new NotFoundError('Product not found')

  const scope = branchScope(user)
  const overrides = await listProductPriceRows(productId, scope)
  return { basePriceMinor: found.basePriceMinor, overrides }
}

/**
 * Lists products with branch-aware effective pricing. Managers are always
 * scoped to their own branch; admins may pass any branch id (or none).
 */
export async function listProducts(
  user: SessionUser,
  query: ProductListQuery,
): Promise<{ products: ProductListRow[]; total: number; branchId: string | null }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)

  let categoryIds: string[] | undefined
  if (query.categoryId) {
    const childIds = await listChildCategoryIds(query.categoryId)
    categoryIds = [query.categoryId, ...childIds]
  }

  const filters: ProductListFilters = {
    q: query.q,
    categoryIds,
    brandId: query.brandId,
    includeArchived: query.includeArchived,
    branchId,
    limit: query.limit,
    offset: query.offset,
  }

  const [rows, total] = await Promise.all([listProductRows(filters), countProductRows(filters)])

  const products = rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    brandId: row.brandId,
    brandName: row.brandName,
    uomId: row.uomId,
    uomCode: row.uomCode,
    uomName: row.uomName,
    taxCategory: row.taxCategory,
    isActive: row.isActive,
    basePriceMinor: row.basePriceMinor,
    effectivePriceMinor:
      branchId === null ? null : resolveEffectivePrice(row.basePriceMinor, row.overrideMinor),
    barcodeCount: row.barcodeCount,
    updatedAt: row.updatedAt,
  }))

  return { products, total, branchId }
}

/**
 * A manager's product proposal (MGR-02, P11-D7).
 *
 * Nothing is inserted: the proposal becomes a `PRODUCT_CREATE` approval, and the
 * product exists only if an admin approves it. An admin is sent to the ordinary
 * catalogue screen instead — submitting to themselves would need self-approval,
 * which is refused by construction (P11-D18).
 */
export async function submitProduct(
  user: SessionUser,
  actor: AuditActor,
  input: ProductSubmissionBody,
): Promise<{ approvalId: string; status: 'PENDING' }> {
  if (roleOf(user) === 'ADMIN') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Create the product directly in the catalogue; submission is for branch managers',
    )
  }

  const branchId = branchScope(user)
  if (!branchId) throw new ForbiddenError('Your account is not assigned to a branch')

  // Fail at submit, not at the decision: a proposal that names an archived
  // category is a mistake the manager can fix in a minute.
  await validateCategoryRef(input.categoryId, db)
  await validateUomRef(input.uomId, db)
  await validateBrandRef(input.brandId ?? null, db)
  if (input.supplierId) await suppliersService.requireSupplier(input.supplierId)

  const approval = await db.transaction(async (tx) =>
    approvalsService.requestApproval(
      actor,
      {
        type: 'PRODUCT_CREATE',
        branchId,
        amountMinor: input.proposedBasePriceMinor,
        payload: { ...input },
        note: input.note ?? null,
      },
      tx,
    ),
  )

  await writeAudit({
    ...actor,
    action: 'product.submitted',
    entity: 'approval',
    entityId: approval.id,
    branchId,
    after: { name: input.name, proposedBasePriceMinor: input.proposedBasePriceMinor },
  })

  return { approvalId: approval.id, status: 'PENDING' }
}

/**
 * Creates the product an approved `PRODUCT_CREATE` request described. Runs in the
 * decision's transaction, so an approval and its product commit or roll back
 * together. The cost is zero by design: a received cost is the only cost this
 * system trusts (P11-D13).
 */
async function createProductFromSubmission(
  executor: DbExecutor,
  actor: AuditActor,
  input: ProductSubmissionBody,
  approvalId: string,
): Promise<{ id: string; sku: string }> {
  const sku = await allocateFromSequence('catalog.skuSequence', executor)
  const categoryId = await validateCategoryRef(input.categoryId, executor)
  const brandId = await validateBrandRef(input.brandId ?? null, executor)
  const uomId = await validateUomRef(input.uomId, executor)

  const created = await insertProduct(
    {
      sku,
      name: input.name,
      description: input.description ?? null,
      categoryId,
      brandId,
      uomId,
      costPriceMinor: 0,
      basePriceMinor: input.proposedBasePriceMinor,
      taxCategory: 'STANDARD',
      createdBy: actor.actorId,
    },
    executor,
  )
  if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create the approved product')

  if (input.barcode) {
    try {
      await insertBarcode(
        { productId: created.id, code: input.barcode, createdBy: actor.actorId },
        executor,
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Barcode ${input.barcode} is already in use`)
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
      after: { ...created, via: 'approval', approvalId },
    },
    executor,
  )

  return { id: created.id, sku: created.sku }
}

registerDecisionHandler('PRODUCT_CREATE', async (tx, approval, actor, decision) => {
  if (decision === 'REJECTED') return undefined

  const parsed = productSubmissionSchema.safeParse(approval.payload)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ConflictError(
      `The proposal is no longer valid (${issue?.path.join('.') ?? 'payload'}: ${issue?.message ?? 'invalid'}); reject it with a reason instead`,
    )
  }

  const created = await createProductFromSubmission(tx, actor, parsed.data, approval.id)
  return { entityId: created.id }
})
