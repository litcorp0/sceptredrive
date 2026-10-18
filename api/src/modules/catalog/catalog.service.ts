import { db } from '@gikautos/db'
import { AppError, ConflictError, NotFoundError } from '../../http/errors.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'
import { countActiveProductsByCategory } from '../products/products.service.ts'
import {
  countActiveCategoryChildren,
  countCategoryChildren,
  findCategoryById,
  findCategoryByNameInsensitive,
  insertCategory,
  listCategoryRows,
  updateCategoryRow,
} from './catalog.repository.ts'
import type {
  CategoryCreateInput,
  CategoryRow,
  CategoryUpdateInput,
  CategoryWithChildren,
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
