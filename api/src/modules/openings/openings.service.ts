import { type DbExecutor, db } from '@sceptre/db'
import {
  OPENING_MAX_ROWS,
  openingLineValueMinor,
  openingTotals,
  parseMoneyToMinor,
  parseQuantity,
} from '@sceptre/shared'
import { assertBranchAccess, resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { listBrandRows, listCategoryRows, listUomRows } from '../catalog/catalog.repository.ts'
import * as catalogService from '../catalog/catalog.service.ts'
import type { BrandRow, CategoryRow, UomRow } from '../catalog/catalog.types.ts'
import * as inventoryRepository from '../inventory/inventory.repository.ts'
import * as inventoryService from '../inventory/inventory.service.ts'
import type { MovementInput } from '../inventory/inventory.types.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'
import { allocateDocumentNumber } from '../platform/sequences.service.ts'
import {
  findBarcodeOwner,
  findProductById,
  findProductBySku,
  findProductNameConflict,
} from '../products/products.repository.ts'
import * as productsService from '../products/products.service.ts'
import type { ProductRow } from '../products/products.types.ts'
import {
  countOpenings,
  deleteOpeningRow,
  findOpeningById,
  findOpeningByIdempotencyKey,
  insertOpening,
  insertOpeningLines,
  lockOpeningForUpdate,
  selectOpeningBase,
  selectOpeningLevels,
  selectOpeningLineRows,
  selectOpeningLines,
  selectOpeningPage,
  updateOpeningLineProduct,
  updateOpeningRow,
} from './openings.repository.ts'
import type {
  OpeningCreateInput,
  OpeningDetail,
  OpeningLineInput,
  OpeningListQuery,
  OpeningListResponse,
  OpeningPostInput,
  OpeningPreview,
  OpeningPreviewRow,
  OpeningTaxCategory,
} from './openings.types.ts'

/**
 * A go-live opening document (Phase 19).
 *
 * The file is a **count**: each row says what the shelf holds. Posting computes the
 * delta against the branch projection at that moment, creates any new products the
 * admin approved through the same file, and appends one `OPENING` movement per
 * positive delta. A negative delta is refused because a shelf lower than the system
 * is shrinkage, which belongs in a count or a write-off, not in an opening.
 */

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

interface CatalogIndex {
  categoryById: Map<string, CategoryRow>
  categoryIdsByName: Map<string, string[]>
  categoryIdsByPath: Map<string, string[]>
  brandById: Map<string, BrandRow>
  brandIdsByName: Map<string, string[]>
  uomById: Map<string, UomRow>
  uomIdsByCode: Map<string, string[]>
  uomIdsByName: Map<string, string[]>
}

function addToIndex(map: Map<string, string[]>, key: string, id: string): void {
  const existing = map.get(key)
  if (existing) {
    if (!existing.includes(id)) existing.push(id)
  } else {
    map.set(key, [id])
  }
}

function categoryPath(
  row: CategoryRow,
  byId: Map<string, CategoryRow>,
  seen: Set<string> = new Set(),
): string {
  if (!row.parentId || seen.has(row.id)) return normalize(row.name)
  const parent = byId.get(row.parentId)
  if (!parent) return normalize(row.name)
  seen.add(row.id)
  return `${categoryPath(parent, byId, seen)} / ${normalize(row.name)}`
}

/**
 * The same path as an operator reads it: original names, `Lubricants / Engine Oil`.
 *
 * The preview shows this instead of the leaf name, so a file that says
 * `Lubricants > Engine Oil` visibly resolved to the right branch of the tree rather than
 * to some other "Engine Oil" elsewhere.
 */
export function displayCategoryPath(
  row: CategoryRow,
  byId: Map<string, CategoryRow>,
  seen: Set<string> = new Set(),
): string {
  if (!row.parentId || seen.has(row.id)) return row.name
  const parent = byId.get(row.parentId)
  if (!parent) return row.name
  seen.add(row.id)
  return `${displayCategoryPath(parent, byId, seen)} / ${row.name}`
}

async function loadCatalogIndex(): Promise<CatalogIndex> {
  const [categories, brands, units] = await Promise.all([
    listCategoryRows({ includeArchived: true }),
    listBrandRows({ includeArchived: true }),
    listUomRows({ includeArchived: true }),
  ])

  const categoryById = new Map(categories.map((row) => [row.id, row]))
  const categoryIdsByName = new Map<string, string[]>()
  const categoryIdsByPath = new Map<string, string[]>()
  for (const row of categories) {
    addToIndex(categoryIdsByName, normalize(row.name), row.id)
    addToIndex(categoryIdsByPath, categoryPath(row, categoryById), row.id)
  }

  const brandById = new Map(brands.map((row) => [row.id, row]))
  const brandIdsByName = new Map<string, string[]>()
  for (const row of brands) addToIndex(brandIdsByName, normalize(row.name), row.id)

  const uomById = new Map(units.map((row) => [row.id, row]))
  const uomIdsByCode = new Map<string, string[]>()
  const uomIdsByName = new Map<string, string[]>()
  for (const row of units) {
    addToIndex(uomIdsByCode, normalize(row.code), row.id)
    addToIndex(uomIdsByName, normalize(row.name), row.id)
  }

  return {
    categoryById,
    categoryIdsByName,
    categoryIdsByPath,
    brandById,
    brandIdsByName,
    uomById,
    uomIdsByCode,
    uomIdsByName,
  }
}

function oneId(ids: string[] | undefined): string | null {
  if (!ids || ids.length !== 1) return null
  return ids[0] ?? null
}

/**
 * A category cell, flat or as a path.
 *
 * `Lubricants > Engine Oil` and `Lubricants / Engine Oil` both work: `>` is the convention
 * every spreadsheet importer uses (WooCommerce documents it, Import WP defaults to it), and
 * `/` is what this column accepted first, so neither existing files nor the habit break.
 * Matching is on the **whole path**, so a child name that appears under two parents resolves
 * only when the parent is given.
 */
function resolveCategory(index: CatalogIndex, raw: string): CategoryRow | null {
  const parts = raw
    .split(/[/>]/)
    .map((part) => normalize(part))
    .filter(Boolean)
  const path = parts.join(' / ')
  const byPath = oneId(index.categoryIdsByPath.get(path))
  if (byPath) return index.categoryById.get(byPath) ?? null
  const byName = oneId(index.categoryIdsByName.get(normalize(raw)))
  if (byName) return index.categoryById.get(byName) ?? null
  return null
}

function resolveUnit(index: CatalogIndex, raw: string): UomRow | null {
  const byCode = oneId(index.uomIdsByCode.get(normalize(raw)))
  if (byCode) return index.uomById.get(byCode) ?? null
  const byName = oneId(index.uomIdsByName.get(normalize(raw)))
  if (byName) return index.uomById.get(byName) ?? null
  return null
}

function resolveBrand(index: CatalogIndex, raw: string | undefined): BrandRow | null {
  if (!raw || raw.trim() === '') return null
  const byName = oneId(index.brandIdsByName.get(normalize(raw)))
  return byName ? (index.brandById.get(byName) ?? null) : null
}

interface ResolvedRow {
  raw: OpeningLineInput
  lineNo: number
  name: string
  categoryId: string | null
  categoryLabel: string
  /** Segments of a category the import will create, when allowed (P20-D21). */
  pendingCategoryPath: string[] | null
  uomId: string | null
  unitLabel: string
  brandId: string | null
  brandLabel: string | null
  barcode: string | null
  priceMinor: number | null
  taxCategory: OpeningTaxCategory
  costMinor: number
  quantity: number
  product: ProductRow | null
  isNew: boolean
  warnings: string[]
  errors: string[]
}

function rowErrorMessage(lineNo: number, message: string): string {
  return `Row ${lineNo}: ${message}`
}

async function resolveRows(
  branchId: string,
  rows: readonly OpeningLineInput[],
  options: { createMissingCategories: boolean } = { createMissingCategories: false },
): Promise<{ resolved: ResolvedRow[]; levels: Map<string, { quantityOnHand: number }> }> {
  const index = await loadCatalogIndex()
  const resolved: ResolvedRow[] = []

  for (const [offset, raw] of rows.entries()) {
    const lineNo = raw.lineNo ?? offset + 1
    const warnings: string[] = []
    const errors: string[] = []
    const name = raw.name.trim()

    const category = resolveCategory(index, raw.category)
    const unit = resolveUnit(index, raw.unit)
    const brand = resolveBrand(index, raw.brand)

    const priceMinor = parseMoneyToMinor(raw.price)
    const parsedCost = parseMoneyToMinor(raw.cost)
    const quantity = parseQuantity(raw.quantity)

    if (priceMinor === null && raw.price.trim() !== '') {
      errors.push(rowErrorMessage(lineNo, 'price is not a valid GHS amount'))
    }
    if (parsedCost === null && raw.cost.trim() !== '') {
      errors.push(rowErrorMessage(lineNo, 'cost is not a valid GHS amount'))
    }
    if (quantity === null) {
      errors.push(rowErrorMessage(lineNo, 'quantity must be a whole number'))
    }
    const costMinor = parsedCost ?? 0
    const safeQuantity = quantity ?? 0

    if (safeQuantity > 0 && parsedCost === null) {
      errors.push(rowErrorMessage(lineNo, 'cost is required when the shelf holds stock'))
    }

    let product: ProductRow | null = null
    let matchedBy: 'sku' | 'barcode' | 'name' | null = null

    if (raw.sku && raw.sku.trim() !== '') {
      product = await findProductBySku(raw.sku)
      if (!product) {
        errors.push(
          rowErrorMessage(
            lineNo,
            `no product has SKU "${raw.sku.trim()}"; leave SKU blank to create a new product`,
          ),
        )
      } else {
        matchedBy = 'sku'
      }
    }

    if (raw.barcode && raw.barcode.trim() !== '') {
      const owner = await findBarcodeOwner(raw.barcode.trim())
      if (owner) {
        if (product && product.id !== owner.productId) {
          errors.push(rowErrorMessage(lineNo, 'the SKU and barcode point at different products'))
        } else if (!product) {
          product = await findProductById(owner.productId)
          matchedBy = 'barcode'
        }
      }
    }

    if (!product && !raw.sku && category) {
      const conflict = await findProductNameConflict(name, category.id)
      if (conflict) {
        product = await findProductById(conflict.id)
        matchedBy = 'name'
      }
    }

    if (product && !product.isActive) {
      errors.push(rowErrorMessage(lineNo, `product "${product.name}" is archived`))
    }

    if (product) {
      const productCategory = index.categoryById.get(product.categoryId)
      const productUnit = index.uomById.get(product.uomId)
      if (!category) {
        warnings.push('The row category is unknown; the matched product category is used.')
      } else if (!category.isActive) {
        warnings.push('The row category is archived; the matched product category is used.')
      } else if (category.id !== product.categoryId) {
        warnings.push(`Matched by ${matchedBy ?? 'name'}; the row's category was ignored.`)
      }
      if (!unit) {
        warnings.push('The row unit is unknown; the matched product unit is used.')
      } else if (!unit.isActive) {
        warnings.push('The row unit is archived; the matched product unit is used.')
      }
      if (raw.brand && raw.brand.trim() !== '' && !brand) {
        warnings.push('The row brand is unknown; the matched product brand is used.')
      }
      if (priceMinor !== null && priceMinor !== product.basePriceMinor) {
        warnings.push(
          `Existing price ${formatMinor(product.basePriceMinor)} is not changed by this document.`,
        )
      }
      const unitCostMinor = costMinor
      if (safeQuantity > 0 && unitCostMinor === 0) {
        warnings.push('No cost: this line will be posted uncosted.')
      }
      resolved.push({
        raw,
        lineNo,
        name,
        categoryId: product.categoryId,
        categoryLabel: productCategory
          ? displayCategoryPath(productCategory, index.categoryById)
          : '—',
        pendingCategoryPath: null,
        uomId: product.uomId,
        unitLabel: productUnit?.code ?? '—',
        brandId: product.brandId,
        brandLabel: product.brandId ? (index.brandById.get(product.brandId)?.name ?? null) : null,
        barcode: raw.barcode?.trim() || null,
        priceMinor: product.basePriceMinor,
        taxCategory: product.taxCategory,
        costMinor,
        quantity: safeQuantity,
        product,
        isNew: false,
        warnings,
        errors,
      })
      continue
    }

    // A row that will become a new product may build its category tree, but only when the
    // operator asked for it in the preview (P20-D21). An existing product uses its own
    // category, so nothing is created on its behalf.
    let pendingCategoryPath: string[] | null = null
    if (!category) {
      const segments = raw.category
        .split(/[/>]/)
        .map((part) => part.trim())
        .filter(Boolean)
      if (!product && options.createMissingCategories && segments.length > 0) {
        if (segments.length > 2) {
          errors.push(rowErrorMessage(lineNo, 'categories can only be two levels deep'))
        } else {
          pendingCategoryPath = segments
          warnings.push(`Will create the category ${segments.join(' / ')}`)
        }
      } else {
        errors.push(
          rowErrorMessage(
            lineNo,
            `unknown category "${raw.category.trim()}" — create it first under Catalog → Categories, using "Parent > Child" for a nested one`,
          ),
        )
      }
    } else if (!category.isActive) {
      errors.push(rowErrorMessage(lineNo, `category "${raw.category}" is archived`))
    }
    if (!unit) {
      errors.push(rowErrorMessage(lineNo, `unknown unit "${raw.unit}"`))
    } else if (!unit.isActive) {
      errors.push(rowErrorMessage(lineNo, `unit "${raw.unit}" is archived`))
    }
    if (raw.brand && raw.brand.trim() !== '' && !brand) {
      errors.push(rowErrorMessage(lineNo, `unknown brand "${raw.brand}"`))
    }

    if (safeQuantity >= 0 && (priceMinor === null || priceMinor <= 0)) {
      errors.push(rowErrorMessage(lineNo, 'price is required for a new product'))
    }
    if (safeQuantity > 0 && costMinor === 0) {
      warnings.push('No cost: this line will be posted uncosted.')
    }

    resolved.push({
      raw,
      lineNo,
      name,
      categoryId: category?.id ?? null,
      categoryLabel: category
        ? displayCategoryPath(category, index.categoryById)
        : (pendingCategoryPath?.join(' / ') ?? raw.category),
      pendingCategoryPath,
      uomId: unit?.id ?? null,
      unitLabel: unit?.code ?? raw.unit,
      brandId: brand?.id ?? null,
      brandLabel: brand?.name ?? null,
      barcode: raw.barcode?.trim() || null,
      priceMinor,
      taxCategory: raw.taxCategory ?? 'STANDARD',
      costMinor,
      quantity: safeQuantity,
      product: null,
      isNew: true,
      warnings,
      errors,
    })
  }

  // One product may appear once. Existing rows are keyed by id; new rows by barcode,
  // or by category + normalised name when there is no barcode.
  const seen = new Set<string>()
  for (const row of resolved) {
    const key = row.product
      ? `id:${row.product.id}`
      : `new:${row.barcode ?? `${row.categoryId ?? '?'}|${normalize(row.name)}`}`
    if (seen.has(key)) {
      row.errors.push(rowErrorMessage(row.lineNo, 'the same product appears twice in the file'))
    } else {
      seen.add(key)
    }
  }

  const productIds = resolved.flatMap((row) => (row.product ? [row.product.id] : []))
  const levels = await selectOpeningLevels(branchId, productIds)
  return { resolved, levels }
}

function toPreviewRow(
  row: ResolvedRow,
  levels: Map<string, { quantityOnHand: number }>,
): OpeningPreviewRow {
  const onHand = row.product ? (levels.get(row.product.id)?.quantityOnHand ?? 0) : 0
  const delta = row.quantity - onHand
  if (delta < 0) {
    row.errors.push(
      rowErrorMessage(
        row.lineNo,
        `the shelf count is lower than the system's ${onHand}; use a stock count or write-off instead`,
      ),
    )
  }
  if (row.product && onHand > 0 && delta > 0) {
    row.warnings.push(
      `The system already holds ${onHand}; the extra units will blend at the stated cost.`,
    )
  }

  return {
    lineNo: row.lineNo,
    status: row.isNew ? 'NEW' : 'EXISTING',
    productId: row.product?.id ?? null,
    sku: row.product?.sku ?? null,
    name: row.name,
    category: row.categoryLabel,
    categoryId: row.categoryId,
    createsCategory: row.pendingCategoryPath,
    unit: row.unitLabel,
    uomId: row.uomId,
    brand: row.brandLabel,
    brandId: row.brandId,
    barcode: row.barcode,
    priceMinor: row.priceMinor,
    taxCategory: row.taxCategory,
    costMinor: row.costMinor,
    quantity: row.quantity,
    onHand,
    delta,
    countedValueMinor: openingLineValueMinor(row.quantity, row.costMinor),
    deltaValueMinor: openingLineValueMinor(Math.max(delta, 0), row.costMinor),
    warnings: row.warnings,
    errors: row.errors,
  }
}

function formatMinor(value: number): string {
  return `GH₵ ${(value / 100).toFixed(2)}`
}

export async function previewOpening(
  user: SessionUser,
  input: { branchId: string; rows: OpeningLineInput[]; createMissingCategories?: boolean },
): Promise<OpeningPreview> {
  const branch = await branchesService.getBranch(user, input.branchId)
  if (!branch.isActive) throw new ConflictError('The branch is inactive')
  if (input.rows.length > OPENING_MAX_ROWS) {
    throw new ValidationError(`A file can have at most ${OPENING_MAX_ROWS} rows`)
  }

  const { resolved, levels } = await resolveRows(branch.id, input.rows, {
    createMissingCategories: input.createMissingCategories === true,
  })
  const rows = resolved.map((row) => toPreviewRow(row, levels))
  const totals = openingTotals(
    rows.map((row) => ({
      quantity: row.quantity,
      unitCostMinor: row.costMinor,
    })),
  )

  return {
    branchId: branch.id,
    rows,
    lineCount: totals.lineCount,
    totalUnits: totals.totalUnits,
    countedValueMinor: totals.countedValueMinor,
    deltaValueMinor: rows.reduce((sum, row) => sum + row.deltaValueMinor, 0),
    newProductCount: rows.filter((row) => row.status === 'NEW').length,
    uncostedLineCount: totals.uncostedLineCount,
    // One entry per path, in the order the rows mention them: the operator reads the list
    // before saving, so a typo is visible as a category about to be born.
    categoriesToCreate: [
      ...new Map(
        rows
          .filter((row) => row.createsCategory !== null)
          .map((row) => [(row.createsCategory ?? []).join(' / '), row.createsCategory ?? []]),
      ).values(),
    ],
    canPost: rows.length > 0 && rows.every((row) => row.errors.length === 0),
  }
}

function rowErrors(preview: OpeningPreview): { line: number; message: string }[] {
  return preview.rows.flatMap((row) => row.errors.map((message) => ({ line: row.lineNo, message })))
}

export async function createOpening(
  user: SessionUser,
  actor: AuditActor,
  input: OpeningCreateInput,
): Promise<OpeningDetail> {
  const branch = await branchesService.getBranch(user, input.branchId)
  if (!branch.isActive) throw new ConflictError('The branch is inactive')

  if (input.idempotencyKey) {
    const existing = await findOpeningByIdempotencyKey(branch.id, input.idempotencyKey)
    if (existing) return loadOpeningDetail(existing.id, user)
  }

  const preview = await previewOpening(user, {
    branchId: branch.id,
    rows: input.rows,
    createMissingCategories: input.createMissingCategories === true,
  })
  if (!preview.canPost) {
    throw new AppError(
      400,
      'OPENING_ROWS_INVALID',
      'The file has errors; fix them before saving the draft',
      { rows: rowErrors(preview) },
    )
  }

  try {
    const openingId = await db.transaction(async (tx) => {
      const { number } = await allocateDocumentNumber('stock_opening', branch.id, tx)
      const created = await insertOpening(
        {
          number,
          branchId: branch.id,
          status: 'DRAFT',
          countedAt: input.countedAt ?? new Date(),
          note: input.note ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          lineCount: preview.lineCount,
          newProductCount: preview.newProductCount,
          totalUnits: preview.totalUnits,
          countedValueMinor: preview.countedValueMinor,
          postedValueMinor: 0,
          uncostedLineCount: preview.uncostedLineCount,
          createdBy: actorLabel(actor),
        },
        tx,
      )
      if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create the opening draft')

      // The tree is built inside the same transaction as the document (P20-D21): a failed
      // save leaves no orphan categories behind, and a re-run starts from the same state.
      const createdCategoryIds = new Map<string, string>()
      for (const path of preview.categoriesToCreate) {
        const created = await catalogService.ensureCategoryPath(actor, path, tx)
        createdCategoryIds.set(path.join(' / '), created.id)
      }

      await insertOpeningLines(
        preview.rows.map((row) => ({
          openingId: created.id,
          lineNo: row.lineNo,
          productId: row.productId,
          isNew: row.status === 'NEW',
          sku: row.sku,
          name: row.name,
          categoryId: row.categoryId
            ? row.categoryId
            : row.createsCategory
              ? (createdCategoryIds.get(row.createsCategory.join(' / ')) ?? null)
              : null,
          uomId: row.uomId,
          brandId: row.brandId,
          barcode: row.barcode,
          basePriceMinor: row.priceMinor,
          taxCategory: row.status === 'NEW' ? (row.taxCategory ?? 'STANDARD') : null,
          quantity: row.quantity,
          unitCostMinor: row.costMinor,
          onHandAtDraft: row.onHand,
          deltaAtDraft: row.delta,
          warning: row.warnings.length > 0 ? row.warnings.join(' ') : null,
          movementId: null,
        })),
        tx,
      )

      await writeAudit(
        {
          ...actor,
          action: 'stock_opening.created',
          entity: 'stock_opening',
          entityId: created.id,
          branchId: branch.id,
          after: {
            number,
            lineCount: preview.lineCount,
            newProductCount: preview.newProductCount,
            countedValueMinor: preview.countedValueMinor,
            uncostedLineCount: preview.uncostedLineCount,
          },
        },
        tx,
      )

      return created.id
    })

    return loadOpeningDetail(openingId, user)
  } catch (error) {
    if (input.idempotencyKey && isUniqueViolation(error)) {
      const existing = await findOpeningByIdempotencyKey(branch.id, input.idempotencyKey)
      if (existing) return loadOpeningDetail(existing.id, user)
    }
    throw error
  }
}

export async function listOpenings(
  user: SessionUser,
  query: OpeningListQuery,
): Promise<OpeningListResponse> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters = {
    branchId,
    status: query.status,
    limit: query.limit,
    offset: query.offset,
  }
  const [openings, total] = await Promise.all([selectOpeningPage(filters), countOpenings(filters)])
  return { openings, total, branchId }
}

async function loadOpeningDetail(id: string, user: SessionUser): Promise<OpeningDetail> {
  const base = await selectOpeningBase(id)
  if (!base) throw new NotFoundError('Opening stock not found')
  assertBranchAccess(user, base.branchId)
  const lines = await selectOpeningLines(id)
  return { opening: base, lines }
}

export async function getOpening(user: SessionUser, id: string): Promise<OpeningDetail> {
  const opening = await findOpeningById(id)
  if (!opening) throw new NotFoundError('Opening stock not found')
  assertBranchAccess(user, opening.branchId)
  return loadOpeningDetail(id, user)
}

export async function deleteOpening(
  user: SessionUser,
  actor: AuditActor,
  id: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const opening = await lockOpeningForUpdate(id, tx)
    if (!opening) throw new NotFoundError('Opening stock not found')
    assertBranchAccess(user, opening.branchId)
    if (opening.status !== 'DRAFT') {
      throw new ConflictError('A posted opening cannot be deleted; correct it with a stock count')
    }

    await deleteOpeningRow(id, tx)
    await writeAudit(
      {
        ...actor,
        action: 'stock_opening.deleted',
        entity: 'stock_opening',
        entityId: id,
        branchId: opening.branchId,
        before: { number: opening.number, status: opening.status },
      },
      tx,
    )
  })
}

/**
 * Posts a draft. Admin-only: the draft is the manager's count, the post is the
 * admin's signature on its value (D3, D15). A retry of an already-posted document
 * returns it unchanged, so a double-click cannot double the stock.
 */
export async function postOpening(
  user: SessionUser,
  actor: AuditActor,
  id: string,
  input: OpeningPostInput,
): Promise<OpeningDetail> {
  if (roleOf(user) !== 'ADMIN') {
    throw new ForbiddenError('Only an admin can post an opening stock document')
  }

  await db.transaction(async (tx) => {
    const opening = await lockOpeningForUpdate(id, tx)
    if (!opening) throw new NotFoundError('Opening stock not found')
    assertBranchAccess(user, opening.branchId)
    if (opening.status === 'POSTED') return

    const lines = await selectOpeningLineRows(id, tx)
    if (lines.length === 0) throw new ConflictError('This opening has no lines to post')

    const uncosted = lines.filter((line) => line.quantity > 0 && line.unitCostMinor === 0)
    if (uncosted.length > 0 && !input.acknowledgeUncosted) {
      throw new ConflictError(
        `${uncosted.length} line(s) have no cost. Confirm the uncosted posting or enter a cost first.`,
      )
    }

    const lineProducts = new Map<string, ProductRow>()
    for (const line of lines) {
      if (line.productId) {
        const existing = await findProductById(line.productId, tx)
        if (!existing) throw new ConflictError(`Row ${line.lineNo}: product not found`)
        lineProducts.set(line.id, existing)
        continue
      }
      if (!line.categoryId || !line.uomId || line.basePriceMinor === null) {
        throw new ConflictError(
          `Row ${line.lineNo} is missing the category, unit or price needed to create its product`,
        )
      }
      const created = await productsService.createProduct(
        actor,
        {
          name: line.name,
          categoryId: line.categoryId,
          uomId: line.uomId,
          brandId: line.brandId ?? undefined,
          basePriceMinor: line.basePriceMinor,
          taxCategory: line.taxCategory ?? 'STANDARD',
          barcodes: line.barcode ? [line.barcode] : undefined,
        },
        { executor: tx },
      )
      lineProducts.set(line.id, created)
      await updateOpeningLineProduct(
        line.id,
        { productId: created.id, sku: created.sku, movementId: null },
        tx,
      )
    }

    // Ensure every product has a locked level row before reading the on-hand the
    // delta is computed from. A sale cannot slip between this read and the write.
    // Lock in product-id order, the same order `postMovements` uses, so two
    // concurrent posts cannot deadlock.
    const levelByProduct = new Map<string, number>()
    const productIdsToLock = [
      ...new Set(
        lines
          .map((line) => lineProducts.get(line.id)?.id)
          .filter((id): id is string => Boolean(id)),
      ),
    ].sort()
    for (const productId of productIdsToLock) {
      const level = await inventoryRepository.lockOrCreateLevel(productId, opening.branchId, tx)
      levelByProduct.set(productId, level?.quantityOnHand ?? 0)
    }

    const movements: MovementInput[] = []
    const deltaByLine = new Map<string, number>()
    for (const line of lines) {
      const product = lineProducts.get(line.id)
      if (!product) throw new ConflictError(`Row ${line.lineNo} has no product to post`)
      const onHand = levelByProduct.get(product.id) ?? 0
      const delta = line.quantity - onHand
      deltaByLine.set(line.id, delta)
      if (delta < 0) {
        throw new ConflictError(
          `Row ${line.lineNo}: the shelf count ${line.quantity} is lower than the system's ${onHand}. Use a stock count or write-off.`,
        )
      }
      if (delta === 0) continue
      movements.push({
        productId: product.id,
        branchId: opening.branchId,
        type: 'OPENING',
        quantityDelta: delta,
        unitCostMinor: line.unitCostMinor,
        referenceType: 'OPENING',
        referenceId: opening.id,
        referenceNumber: opening.number,
        note: 'Opening stock',
        productName: product.name,
      })
    }

    const posted =
      movements.length > 0
        ? await inventoryService.postMovements(actor, movements, { executor: tx })
        : null
    const postedMovements = posted?.movements ?? []
    const movementByProduct = new Map(postedMovements.map((row) => [row.productId, row.id]))

    let postedValueMinor = 0
    for (const line of lines) {
      const product = lineProducts.get(line.id)
      if (!product) continue
      const delta = deltaByLine.get(line.id) ?? 0
      if (delta > 0) postedValueMinor += delta * line.unitCostMinor
      await updateOpeningLineProduct(
        line.id,
        {
          productId: product.id,
          sku: product.sku,
          movementId: movementByProduct.get(product.id) ?? null,
          onHandAtDraft: levelByProduct.get(product.id) ?? 0,
          deltaAtDraft: delta,
        },
        tx,
      )
    }

    const updated = await updateOpeningRow(
      id,
      {
        status: 'POSTED',
        postedAt: new Date(),
        postedBy: actorLabel(actor),
        lineCount: lines.length,
        newProductCount: lines.filter((line) => line.isNew).length,
        totalUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
        countedValueMinor: lines.reduce((sum, line) => sum + line.quantity * line.unitCostMinor, 0),
        postedValueMinor,
        uncostedLineCount: uncosted.length,
      },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to post the opening stock')

    await writeAudit(
      {
        ...actor,
        action: 'stock_opening.posted',
        entity: 'stock_opening',
        entityId: id,
        branchId: opening.branchId,
        before: { status: opening.status },
        after: {
          status: 'POSTED',
          lineCount: lines.length,
          movementCount: postedMovements.length,
          postedValueMinor,
          uncostedLineCount: uncosted.length,
        },
      },
      tx,
    )
  })

  return getOpening(user, id)
}

/** Reads the product a just-created line now points at, inside the post transaction. */

/**
 * The one-line opening written when a manager's `PRODUCT_CREATE` proposal carried
 * opening stock. It runs inside the approval transaction: the product, the opening
 * header/line and the movement commit or roll back together.
 */
export async function postSubmissionOpening(
  executor: DbExecutor,
  actor: AuditActor,
  input: {
    branchId: string
    approvalId: string
    product: ProductRow
    quantity: number
    unitCostMinor: number
  },
): Promise<{ openingId: string; movementId: string }> {
  const { number } = await allocateDocumentNumber('stock_opening', input.branchId, executor)
  const countedValueMinor = input.quantity * input.unitCostMinor
  const uncostedLineCount = input.quantity > 0 && input.unitCostMinor === 0 ? 1 : 0

  const opening = await insertOpening(
    {
      number,
      branchId: input.branchId,
      status: 'POSTED',
      countedAt: new Date(),
      note: 'Opening stock from an approved product proposal',
      idempotencyKey: `approval:${input.approvalId}`,
      lineCount: 1,
      newProductCount: 1,
      totalUnits: input.quantity,
      countedValueMinor,
      postedValueMinor: countedValueMinor,
      uncostedLineCount,
      createdBy: actorLabel(actor),
      postedBy: actorLabel(actor),
      postedAt: new Date(),
    },
    executor,
  )
  if (!opening) throw new AppError(500, 'INTERNAL', 'Failed to create the opening stock')

  await insertOpeningLines(
    [
      {
        openingId: opening.id,
        lineNo: 1,
        productId: input.product.id,
        isNew: true,
        sku: input.product.sku,
        name: input.product.name,
        categoryId: input.product.categoryId,
        uomId: input.product.uomId,
        brandId: input.product.brandId,
        barcode: null,
        basePriceMinor: input.product.basePriceMinor,
        taxCategory: input.product.taxCategory,
        quantity: input.quantity,
        unitCostMinor: input.unitCostMinor,
        onHandAtDraft: 0,
        deltaAtDraft: input.quantity,
        warning: uncostedLineCount > 0 ? 'No cost: this line was posted uncosted.' : null,
      },
    ],
    executor,
  )

  const posted = await inventoryService.postMovements(
    actor,
    [
      {
        productId: input.product.id,
        branchId: input.branchId,
        type: 'OPENING',
        quantityDelta: input.quantity,
        unitCostMinor: input.unitCostMinor,
        referenceType: 'OPENING',
        referenceId: opening.id,
        referenceNumber: number,
        note: 'Opening stock from an approved product proposal',
        productName: input.product.name,
      },
    ],
    { executor },
  )
  const movementId = posted.movements[0]?.id
  if (!movementId) throw new AppError(500, 'INTERNAL', 'Failed to post the opening movement')

  const lines = await selectOpeningLineRows(opening.id, executor)
  const lineId = lines[0]?.id
  if (lineId) {
    await updateOpeningLineProduct(
      lineId,
      { productId: input.product.id, sku: input.product.sku, movementId },
      executor,
    )
  }

  await writeAudit(
    {
      ...actor,
      action: 'stock_opening.posted',
      entity: 'stock_opening',
      entityId: opening.id,
      branchId: input.branchId,
      after: {
        status: 'POSTED',
        via: 'approval',
        approvalId: input.approvalId,
        quantity: input.quantity,
        unitCostMinor: input.unitCostMinor,
        movementId,
      },
    },
    executor,
  )

  return { openingId: opening.id, movementId }
}
