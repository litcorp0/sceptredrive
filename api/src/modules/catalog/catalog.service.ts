import { type DbExecutor, db } from '@sceptre/db'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'
import {
  countActiveProductsByBrand,
  countActiveProductsByCategory,
  countActiveProductsByUom,
} from '../products/products.service.ts'
import {
  countActiveCategoryChildren,
  countCategoryChildren,
  findBrandById,
  findBrandByNameInsensitive,
  findCategoryById,
  findCategoryByNameInsensitive,
  findUomByCode,
  findUomById,
  insertBrand,
  insertCategory,
  insertUom,
  listBrandRows,
  listCategoryRows,
  listUomRows,
  updateBrandRow,
  updateCategoryRow,
  updateUomRow,
} from './catalog.repository.ts'
import type {
  BrandCreateInput,
  BrandRow,
  BrandUpdateInput,
  CategoryCreateInput,
  CategoryRow,
  CategoryUpdateInput,
  CategoryWithChildren,
  UomCreateInput,
  UomRow,
  UomUpdateInput,
} from './catalog.types.ts'

function buildCategoryTree(rows: CategoryRow[]): CategoryWithChildren[] {
  const childrenByParent = new Map<string, CategoryRow[]>()
  for (const row of rows) {
    if (row.parentId === null) continue
    const list = childrenByParent.get(row.parentId)
    if (list) list.push(row)
    else childrenByParent.set(row.parentId, [row])
  }

  return rows
    .filter((row) => row.parentId === null)
    .map((parent) => ({ ...parent, children: childrenByParent.get(parent.id) ?? [] }))
}

export async function listCategories(filters: {
  includeArchived: boolean
}): Promise<CategoryWithChildren[]> {
  const rows = await listCategoryRows(filters)
  return buildCategoryTree(rows)
}

/**
 * Resolves a `Parent > Child` path, creating the levels that do not exist (P20-D21).
 *
 * Written for the opening-stock import, where a go-live file may name a category tree
 * nobody has built yet. It is deliberately conservative, because the constraints this
 * schema already enforces are easy to trip:
 *
 * - **Two levels only.** `createCategory` refuses a third, so this does too rather than
 *   half-building a tree.
 * - **Names are unique across the whole tree** (`category_name_unique` on `lower(name)`),
 *   so an existing `Engine Oil` is reused only when it sits under the parent the path
 *   names. Reparenting is never done silently: the caller gets a conflict instead.
 * - **Idempotent**, so a re-run of the same file creates nothing twice.
 */
export async function ensureCategoryPath(
  actor: AuditActor,
  segments: readonly string[],
  executor: DbExecutor = db,
): Promise<CategoryRow> {
  const names = segments.map((segment) => segment.trim()).filter(Boolean)
  if (names.length === 0) throw new ValidationError('A category path needs at least one name')
  if (names.length > 2) {
    throw new ValidationError('Categories can only be two levels deep')
  }

  let parentId: string | null = null
  let current: CategoryRow | null = null

  for (const [index, name] of names.entries()) {
    const existing = await findCategoryByNameInsensitive(name, executor)
    const isLast = index === names.length - 1

    if (existing) {
      if (isLast && existing.parentId !== parentId) {
        throw new ConflictError(
          `A category named "${name}" already exists under a different parent; rename one of them before importing`,
        )
      }
      current = existing
      parentId = existing.id
      continue
    }

    const created = await insertCategory({ name, parentId, createdBy: actor.actorId }, executor)
    if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create a category')
    current = created
    parentId = created.id
  }

  if (!current) throw new AppError(500, 'INTERNAL', 'Failed to resolve the category path')
  return current
}

export async function createCategory(
  actor: AuditActor,
  input: CategoryCreateInput,
): Promise<CategoryRow> {
  const duplicate = await findCategoryByNameInsensitive(input.name)
  if (duplicate) throw new ConflictError('A category with this name already exists')

  let parentId: string | null = null
  if (input.parentId) {
    const parent = await findCategoryById(input.parentId)
    if (!parent) throw new NotFoundError('Parent category not found')
    if (!parent.isActive) throw new ConflictError('The parent category is archived')
    if (parent.parentId !== null) {
      throw new ConflictError('Categories can only be two levels deep')
    }
    parentId = parent.id
  }

  try {
    return await db.transaction(async (tx) => {
      const created = await insertCategory(
        { name: input.name, parentId, createdBy: actor.actorId },
        tx,
      )
      if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create category')

      await writeAudit(
        {
          ...actor,
          action: 'category.created',
          entity: 'category',
          entityId: created.id,
          after: created,
        },
        tx,
      )
      return created
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('A category with this name already exists')
    }
    throw error
  }
}

export async function updateCategory(
  actor: AuditActor,
  id: string,
  input: CategoryUpdateInput,
): Promise<CategoryRow> {
  return db.transaction(async (tx) => {
    const existing = await findCategoryById(id, tx)
    if (!existing) throw new NotFoundError('Category not found')

    const patch: Partial<Pick<CategoryRow, 'name' | 'parentId'>> = {}

    if (input.name !== undefined && input.name !== existing.name) {
      const duplicate = await findCategoryByNameInsensitive(input.name, tx)
      if (duplicate && duplicate.id !== id) {
        throw new ConflictError('A category with this name already exists')
      }
      patch.name = input.name
    }

    if (input.parentId !== undefined) {
      const targetParentId = input.parentId ?? null
      if (targetParentId !== existing.parentId) {
        if (targetParentId === id) {
          throw new ConflictError('A category cannot be its own parent')
        }
        if (targetParentId !== null) {
          const childCount = await countCategoryChildren(id, tx)
          if (childCount > 0) {
            throw new ConflictError('Re-parenting is blocked while the category has subcategories')
          }
          const parent = await findCategoryById(targetParentId, tx)
          if (!parent) throw new NotFoundError('Parent category not found')
          if (parent.parentId !== null) {
            throw new ConflictError('Categories can only be two levels deep')
          }
          if (!parent.isActive) throw new ConflictError('The parent category is archived')
        }
        patch.parentId = targetParentId
      }
    }

    if (Object.keys(patch).length === 0) return existing

    const updated = await updateCategoryRow(id, patch, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update category')

    await writeAudit(
      {
        ...actor,
        action: 'category.updated',
        entity: 'category',
        entityId: id,
        before: existing,
        after: updated,
      },
      tx,
    )
    return updated
  })
}

export async function archiveCategory(actor: AuditActor, id: string): Promise<CategoryRow> {
  return db.transaction(async (tx) => {
    const existing = await findCategoryById(id, tx)
    if (!existing) throw new NotFoundError('Category not found')
    if (!existing.isActive) return existing

    if ((await countActiveCategoryChildren(id, tx)) > 0) {
      throw new ConflictError('This category has active subcategories')
    }
    if ((await countActiveProductsByCategory(id, tx)) > 0) {
      throw new ConflictError('This category is used by active products')
    }

    const updated = await updateCategoryRow(id, { isActive: false }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to archive category')

    await writeAudit(
      {
        ...actor,
        action: 'category.archived',
        entity: 'category',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false },
      },
      tx,
    )
    return updated
  })
}

export async function reactivateCategory(actor: AuditActor, id: string): Promise<CategoryRow> {
  return db.transaction(async (tx) => {
    const existing = await findCategoryById(id, tx)
    if (!existing) throw new NotFoundError('Category not found')
    if (existing.isActive) return existing

    if (existing.parentId) {
      const parent = await findCategoryById(existing.parentId, tx)
      if (parent && !parent.isActive) {
        throw new ConflictError('Reactivate the parent category first')
      }
    }

    const updated = await updateCategoryRow(id, { isActive: true }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to reactivate category')

    await writeAudit(
      {
        ...actor,
        action: 'category.reactivated',
        entity: 'category',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true },
      },
      tx,
    )
    return updated
  })
}

export async function listBrands(filters: { includeArchived: boolean }): Promise<BrandRow[]> {
  return listBrandRows(filters)
}

export async function createBrand(actor: AuditActor, input: BrandCreateInput): Promise<BrandRow> {
  const duplicate = await findBrandByNameInsensitive(input.name)
  if (duplicate) throw new ConflictError('A brand with this name already exists')

  try {
    return await db.transaction(async (tx) => {
      const created = await insertBrand({ name: input.name, createdBy: actor.actorId }, tx)
      if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create brand')

      await writeAudit(
        {
          ...actor,
          action: 'brand.created',
          entity: 'brand',
          entityId: created.id,
          after: created,
        },
        tx,
      )
      return created
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('A brand with this name already exists')
    }
    throw error
  }
}

export async function updateBrand(
  actor: AuditActor,
  id: string,
  input: BrandUpdateInput,
): Promise<BrandRow> {
  return db.transaction(async (tx) => {
    const existing = await findBrandById(id, tx)
    if (!existing) throw new NotFoundError('Brand not found')
    if (input.name === existing.name) return existing

    const duplicate = await findBrandByNameInsensitive(input.name, tx)
    if (duplicate && duplicate.id !== id) {
      throw new ConflictError('A brand with this name already exists')
    }

    const updated = await updateBrandRow(id, { name: input.name }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update brand')

    await writeAudit(
      {
        ...actor,
        action: 'brand.updated',
        entity: 'brand',
        entityId: id,
        before: existing,
        after: updated,
      },
      tx,
    )
    return updated
  })
}

export async function archiveBrand(actor: AuditActor, id: string): Promise<BrandRow> {
  return db.transaction(async (tx) => {
    const existing = await findBrandById(id, tx)
    if (!existing) throw new NotFoundError('Brand not found')
    if (!existing.isActive) return existing

    if ((await countActiveProductsByBrand(id, tx)) > 0) {
      throw new ConflictError('This brand is used by active products')
    }

    const updated = await updateBrandRow(id, { isActive: false }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to archive brand')

    await writeAudit(
      {
        ...actor,
        action: 'brand.archived',
        entity: 'brand',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false },
      },
      tx,
    )
    return updated
  })
}

export async function reactivateBrand(actor: AuditActor, id: string): Promise<BrandRow> {
  return db.transaction(async (tx) => {
    const existing = await findBrandById(id, tx)
    if (!existing) throw new NotFoundError('Brand not found')
    if (existing.isActive) return existing

    const updated = await updateBrandRow(id, { isActive: true }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to reactivate brand')

    await writeAudit(
      {
        ...actor,
        action: 'brand.reactivated',
        entity: 'brand',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true },
      },
      tx,
    )
    return updated
  })
}

export async function listUoms(filters: { includeArchived: boolean }): Promise<UomRow[]> {
  return listUomRows(filters)
}

export async function createUom(actor: AuditActor, input: UomCreateInput): Promise<UomRow> {
  const duplicate = await findUomByCode(input.code)
  if (duplicate) throw new ConflictError('A unit with this code already exists')

  try {
    return await db.transaction(async (tx) => {
      const created = await insertUom(
        { code: input.code, name: input.name, createdBy: actor.actorId },
        tx,
      )
      if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create unit')

      await writeAudit(
        {
          ...actor,
          action: 'uom.created',
          entity: 'uom',
          entityId: created.id,
          after: created,
        },
        tx,
      )
      return created
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('A unit with this code already exists')
    }
    throw error
  }
}

/** Renames a unit. The code is immutable after creation. */
export async function updateUom(
  actor: AuditActor,
  id: string,
  input: UomUpdateInput,
): Promise<UomRow> {
  return db.transaction(async (tx) => {
    const existing = await findUomById(id, tx)
    if (!existing) throw new NotFoundError('Unit not found')
    if (input.name === existing.name) return existing

    const updated = await updateUomRow(id, { name: input.name }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update unit')

    await writeAudit(
      {
        ...actor,
        action: 'uom.updated',
        entity: 'uom',
        entityId: id,
        before: existing,
        after: updated,
      },
      tx,
    )
    return updated
  })
}

export async function archiveUom(actor: AuditActor, id: string): Promise<UomRow> {
  return db.transaction(async (tx) => {
    const existing = await findUomById(id, tx)
    if (!existing) throw new NotFoundError('Unit not found')
    if (!existing.isActive) return existing

    if ((await countActiveProductsByUom(id, tx)) > 0) {
      throw new ConflictError('This unit is used by active products')
    }

    const updated = await updateUomRow(id, { isActive: false }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to archive unit')

    await writeAudit(
      {
        ...actor,
        action: 'uom.archived',
        entity: 'uom',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false },
      },
      tx,
    )
    return updated
  })
}

export async function reactivateUom(actor: AuditActor, id: string): Promise<UomRow> {
  return db.transaction(async (tx) => {
    const existing = await findUomById(id, tx)
    if (!existing) throw new NotFoundError('Unit not found')
    if (existing.isActive) return existing

    const updated = await updateUomRow(id, { isActive: true }, tx)
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to reactivate unit')

    await writeAudit(
      {
        ...actor,
        action: 'uom.reactivated',
        entity: 'uom',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true },
      },
      tx,
    )
    return updated
  })
}
