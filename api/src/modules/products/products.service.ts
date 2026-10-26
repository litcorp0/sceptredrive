import { type DbExecutor, type DbTransaction, db } from '@sceptre/db'
import { priceBandBounds, resolveEffectivePrice, withinPriceBand } from '@sceptre/shared'
import { and, count, eq } from 'drizzle-orm'
import { branchScope, resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import * as approvalsService from '../approvals/approvals.service.ts'
import {
  registerDecisionHandler,
  registerSubjectLoader,
  requestApproval,
} from '../approvals/approvals.service.ts'
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
  getResolvedSetting,
  peekSequenceValue,
} from '../platform/settings.service.ts'
import * as suppliersService from '../suppliers/suppliers.service.ts'
import {
  countProductRows,
  deleteBarcodeRow,
  deleteProductPriceRow,
  findBarcodeForProduct,
  findPriceContext,
  findProductById,
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
  PriceChangeKind,
  PriceChangePayload,
  PriceChangeSubject,
  PriceContext,
  PriceWriteResult,
  ProductCreateInput,
  ProductDetail,
  ProductListFilters,
  ProductListQuery,
  ProductListRow,
  ProductPriceList,
  ProductRow,
  ProductSubmissionBody,
  ProductUpdateInput,
  ProductWithBarcodes,
} from './products.types.ts'
import { priceChangePayloadSchema, productSubmissionSchema } from './products.validation.ts'

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
          // Derived from the latest receipt and never typed (P11-D13).
          costPriceMinor: 0,
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

/** The band is global and admin-only (P12-D18): read here, never trusted from a client. */
async function managerBandPercent(executor: DbExecutor): Promise<number> {
  const resolved = await getResolvedSetting('pricing.managerBandPercent', {}, executor)
  return resolved.value
}

/**
 * Writes the override and its audit. Only reachable once the band — or the admin
 * exemption — has allowed the change, so it never decides anything itself.
 */
async function applyPriceChange(
  tx: DbTransaction,
  actor: AuditActor,
  productId: string,
  branchId: string,
  context: PriceContext,
  proposedMinor: number,
  kind: PriceChangeKind,
): Promise<PriceWriteResult> {
  const before = { branchId, priceMinor: context.overrideMinor }

  if (kind === 'REMOVE') {
    if (!context.overrideRowId) throw new NotFoundError('Price override not found')
    await deleteProductPriceRow(context.overrideRowId, tx)

    await writeAudit(
      {
        ...actor,
        action: 'product.price.override_removed',
        entity: 'product',
        entityId: productId,
        branchId,
        before,
        after: { branchId, priceMinor: proposedMinor, removed: true, via: 'BAND' },
      },
      tx,
    )
    return { status: 'APPLIED', priceMinor: proposedMinor }
  }

  const saved = context.overrideRowId
    ? await updateProductPriceRow(
        context.overrideRowId,
        { priceMinor: proposedMinor, updatedBy: actor.actorId },
        tx,
      )
    : await insertProductPriceRow(
        { productId, branchId, priceMinor: proposedMinor, updatedBy: actor.actorId },
        tx,
      )
  if (!saved) throw new AppError(500, 'INTERNAL', 'Failed to set price override')

  await writeAudit(
    {
      ...actor,
      action: 'product.price.override_set',
      entity: 'product',
      entityId: productId,
      branchId,
      before,
      after: { branchId, priceMinor: saved.priceMinor, via: 'BAND' },
    },
    tx,
  )
  return { status: 'APPLIED', priceMinor: saved.priceMinor }
}

/**
 * Maps a unique violation raised while writing a price to the honest 409.
 *
 * Two managers can target the same product and branch at once. The band check
 * then sees no row, both transactions try to insert, and PostgreSQL lets exactly
 * one win: the loser hits `product_price_product_branch_unique`. That is a race,
 * not a server fault — the caller re-reads and retries. A second *request* for the
 * same product is different: `approval_open_entity_unique` says a decision is
 * already queued, and retrying would only duplicate it.
 *
 * Extracted so the mapping is unit-testable without claiming a deterministic race
 * test that the database cannot promise.
 */
export function priceWriteConflict(error: unknown): ConflictError | null {
  if (!isUniqueViolation(error)) return null

  const constraint = uniqueViolationConstraint(error) ?? ''
  if (constraint.includes('approval_open_entity_unique')) {
    return new ConflictError('A price change for this product is already waiting for a decision')
  }
  if (constraint.includes('product_price_product_branch_unique')) {
    return new ConflictError(
      'The price changed while this request was being saved. Retry the change.',
    )
  }
  return null
}

/**
 * One decision shared by setting and removing an override (P12-D19).
 *
 * An admin may move a price anywhere: the band is a manager rule (P12-D18). A
 * manager may move it inside the band, measured against the price the branch
 * actually charges. Outside the band nothing is written to `product_price` — the
 * change becomes a `PRICE_CHANGE` request that an admin decides, which is what
 * makes "the price nobody approved never goes live" true rather than aspirational.
 *
 * A second request for the same product hits `approval_open_entity_unique` and is
 * a 409: two pending prices for one product is a decision nobody can make.
 */
async function writeOrRequestPriceChange(
  user: SessionUser,
  actor: AuditActor,
  productId: string,
  branchId: string,
  proposedMinor: number,
  kind: PriceChangeKind,
): Promise<PriceWriteResult> {
  const branchRow = await branchesService.getBranch(user, branchId)
  if (!branchRow.isActive) throw new ConflictError('The branch is inactive')

  try {
    return await db.transaction(async (tx) => {
      const context = await findPriceContext(productId, branchId, tx)
      if (!context || !context.isActive) throw new NotFoundError('Product not found')
      if (kind === 'REMOVE' && !context.overrideRowId) {
        throw new NotFoundError('Price override not found')
      }

      const currentMinor = resolveEffectivePrice(context.basePriceMinor, context.overrideMinor)

      // The band is a manager rule: an admin writes the price the branch asked for.
      if (roleOf(user) === 'ADMIN') {
        return applyPriceChange(tx, actor, productId, branchId, context, proposedMinor, kind)
      }

      const bandPercent = await managerBandPercent(tx)
      if (withinPriceBand(currentMinor, proposedMinor, bandPercent)) {
        return applyPriceChange(tx, actor, productId, branchId, context, proposedMinor, kind)
      }

      const approval = await requestApproval(
        actor,
        {
          type: 'PRICE_CHANGE',
          entityId: productId,
          branchId,
          amountMinor: proposedMinor,
          payload: {
            productId,
            branchId,
            currentPriceMinor: currentMinor,
            proposedPriceMinor: proposedMinor,
            bandPercent,
            kind,
          },
          deciderRole: 'ADMIN',
          deciderBranchId: null,
        },
        tx,
      )

      await writeAudit(
        {
          ...actor,
          action: 'product.price.change_requested',
          entity: 'product',
          entityId: productId,
          branchId,
          after: {
            branchId,
            kind,
            currentPriceMinor: currentMinor,
            proposedPriceMinor: proposedMinor,
            bandPercent,
            approvalId: approval.id,
          },
        },
        tx,
      )

      return { status: 'PENDING_APPROVAL', approvalId: approval.id }
    })
  } catch (error) {
    const conflict = priceWriteConflict(error)
    if (conflict) throw conflict
    throw error
  }
}

/** Sets one branch's price: applied, or queued as a `PRICE_CHANGE` (P12-D19). */
export async function setPriceOverride(
  user: SessionUser,
  actor: AuditActor,
  productId: string,
  input: PriceOverrideInput,
): Promise<PriceWriteResult> {
  return writeOrRequestPriceChange(user, actor, productId, input.branchId, input.priceMinor, 'SET')
}

/**
 * Removing an override is a change to the base price, so it is band-checked the
 * same way (P12-D19): otherwise deleting the row is how a manager escapes the band.
 */
export async function removePriceOverride(
  user: SessionUser,
  actor: AuditActor,
  productId: string,
  branchId: string,
): Promise<PriceWriteResult> {
  const found = await findProductById(productId)
  if (!found) throw new NotFoundError('Product not found')

  return writeOrRequestPriceChange(user, actor, productId, branchId, found.basePriceMinor, 'REMOVE')
}

/**
 * Base price plus the overrides the caller may see (managers: own branch), each
 * with the band a manager may move it within.
 *
 * The band travels with the rows because the console must warn before a request is
 * sent and must not re-derive a server rule (P12-D18).
 */
export async function getPriceOverrides(
  user: SessionUser,
  productId: string,
): Promise<ProductPriceList> {
  const found = await findProductById(productId)
  if (!found) throw new NotFoundError('Product not found')

  const scope = branchScope(user)
  const [overrides, resolvedBand] = await Promise.all([
    listProductPriceRows(productId, scope),
    getResolvedSetting('pricing.managerBandPercent'),
  ])
  const managerBandPercent = resolvedBand.value

  return {
    basePriceMinor: found.basePriceMinor,
    managerBandPercent,
    overrides: overrides.map((row) => ({
      ...row,
      bounds: priceBandBounds(
        resolveEffectivePrice(found.basePriceMinor, row.priceMinor),
        managerBandPercent,
      ),
    })),
  }
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

/**
 * Plan 03's half of the subject registry: the proposal has no row yet, so the
 * payload the manager submitted is the subject the admin decides on.
 */
registerSubjectLoader('PRODUCT_CREATE', async (approval) => ({
  kind: 'product',
  proposal: approval.payload,
}))

/**
 * A `PRICE_CHANGE` row we cannot read is a programming error, not a user error:
 * the 500 tells the admin to reject it with a reason rather than guess a price.
 */
function parsePriceChangePayload(payload: unknown): PriceChangePayload {
  const parsed = priceChangePayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new AppError(500, 'INTERNAL', 'The price change request is malformed')
  }
  return parsed.data
}

/**
 * The decision side of P12-D19/P12-D20, registered by this module at load.
 *
 * `REJECTED` returns before reading anything: there is nothing to undo, because a
 * request never wrote to `product_price` in the first place. `APPROVED` re-reads the
 * effective price and refuses a stale request with a 409, which rolls the decision
 * back and leaves the approval `PENDING` for the admin to reject. Applying the
 * `currentPriceMinor` the admin saw is the only safe write; applying a price that
 * has since moved is how a price nobody approved goes live.
 *
 * Runs inside `decideApproval`'s transaction, before the status change, so the price
 * row and the approval commit or roll back together — "applies exactly once" is
 * this check plus that one transaction.
 */
registerDecisionHandler('PRICE_CHANGE', async (tx, approval, actor, decision) => {
  const payload = parsePriceChangePayload(approval.payload)

  if (approval.entityId !== null && approval.entityId !== payload.productId) {
    throw new AppError(500, 'INTERNAL', 'The price change request points at another product')
  }

  if (decision === 'REJECTED') return undefined

  const context = await findPriceContext(payload.productId, payload.branchId, tx)
  if (!context) throw new NotFoundError('Product not found')

  const currentMinor = resolveEffectivePrice(context.basePriceMinor, context.overrideMinor)
  if (currentMinor !== payload.currentPriceMinor) {
    throw new ConflictError(
      'The price changed while this request was waiting. Reject it and raise a new one.',
    )
  }

  if (payload.kind === 'REMOVE') {
    if (!context.overrideRowId) {
      throw new ConflictError(
        'The price override this request would remove is already gone. Reject it and raise a new one.',
      )
    }
    await deleteProductPriceRow(context.overrideRowId, tx)
  } else if (context.overrideRowId) {
    const updated = await updateProductPriceRow(
      context.overrideRowId,
      { priceMinor: payload.proposedPriceMinor, updatedBy: actor.actorId },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to apply the approved price change')
  } else {
    const inserted = await insertProductPriceRow(
      {
        productId: payload.productId,
        branchId: payload.branchId,
        priceMinor: payload.proposedPriceMinor,
        updatedBy: actor.actorId,
      },
      tx,
    )
    if (!inserted) throw new AppError(500, 'INTERNAL', 'Failed to apply the approved price change')
  }

  await writeAudit(
    {
      ...actor,
      action:
        payload.kind === 'REMOVE' ? 'product.price.override_removed' : 'product.price.override_set',
      entity: 'product',
      entityId: payload.productId,
      branchId: payload.branchId,
      before: { branchId: payload.branchId, priceMinor: payload.currentPriceMinor },
      after: {
        branchId: payload.branchId,
        priceMinor: payload.proposedPriceMinor,
        ...(payload.kind === 'REMOVE' ? { removed: true } : {}),
        via: 'approval',
        approvalId: approval.id,
      },
    },
    tx,
  )

  return undefined
})

/**
 * The approver's view of a price request: the product, both prices, and the band
 * the request was judged against (with its bounds) so the console shows
 * inside/outside without re-deriving a server rule.
 *
 * `bandPercent` comes from the stored payload rather than today's setting: widening
 * the band tomorrow must not rewrite the reason today's request exists.
 */
registerSubjectLoader('PRICE_CHANGE', async (approval) => {
  const payload = parsePriceChangePayload(approval.payload)

  const found = await findProductById(payload.productId)
  if (!found) throw new NotFoundError('Product not found')

  const subject: PriceChangeSubject = {
    kind: 'price_change',
    productId: payload.productId,
    branchId: payload.branchId,
    currentPriceMinor: payload.currentPriceMinor,
    proposedPriceMinor: payload.proposedPriceMinor,
    productName: found.name,
    sku: found.sku,
    bandPercent: payload.bandPercent,
    bounds: priceBandBounds(payload.currentPriceMinor, payload.bandPercent),
  }
  return subject
})
