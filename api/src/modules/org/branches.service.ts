import { db } from '@gikautos/db'
import { branch } from '@gikautos/db/schema'
import {
  type BranchCodeSuggestion,
  type BranchType,
  normalizeBranchCode,
  suggestBranchCode,
} from '@gikautos/shared'
import { and, asc, eq, type SQL } from 'drizzle-orm'
import { assertBranchAccess, branchScope, roleOf } from '../../http/authorize.ts'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { type AuditActor, writeAudit } from '../platform/audit.service.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'

export interface BranchCreateInput {
  code: string
  name: string
  type: BranchType
  city: string
  area?: string | undefined
  address?: string | undefined
  phone?: string | undefined
}

export interface BranchUpdateInput {
  name?: string | undefined
  city?: string | undefined
  area?: string | undefined
  address?: string | undefined
  phone?: string | undefined
}

const MANAGER_UPDATE_FIELDS = new Set(['name', 'address', 'phone'])

export async function listBranches(
  user: SessionUser,
  options: { includeInactive: boolean },
): Promise<(typeof branch.$inferSelect)[]> {
  const scope = branchScope(user)
  const filters: SQL[] = []
  if (scope) filters.push(eq(branch.id, scope))
  if (!options.includeInactive) filters.push(eq(branch.isActive, true))

  return db
    .select()
    .from(branch)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(branch.code))
}

export async function getBranch(
  user: SessionUser,
  id: string,
): Promise<typeof branch.$inferSelect> {
  const rows = await db.select().from(branch).where(eq(branch.id, id)).limit(1)
  const found = rows[0]
  if (!found) throw new NotFoundError('Branch not found')
  assertBranchAccess(user, found.id)
  return found
}

export async function createBranch(
  actor: AuditActor,
  input: BranchCreateInput,
): Promise<typeof branch.$inferSelect> {
  const code = normalizeBranchCode(input.code)
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .insert(branch)
        .values({
          code,
          name: input.name,
          type: input.type,
          city: input.city,
          area: input.area ?? null,
          address: input.address ?? null,
          phone: input.phone ?? null,
          createdBy: actor.actorId,
        })
        .returning()
      const created = rows[0]
      if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create branch')

      await writeAudit(
        {
          ...actor,
          action: 'branch.created',
          entity: 'branch',
          entityId: created.id,
          after: created,
          branchId: created.id,
        },
        tx,
      )
      return created
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('A branch with this code already exists')
    }
    throw error
  }
}

export async function updateBranch(
  user: SessionUser,
  actor: AuditActor,
  id: string,
  input: BranchUpdateInput,
): Promise<typeof branch.$inferSelect> {
  const isManager = roleOf(user) !== 'ADMIN'
  if (isManager) {
    assertBranchAccess(user, id)
    const disallowed = Object.keys(input).filter((key) => !MANAGER_UPDATE_FIELDS.has(key))
    if (disallowed.length > 0) {
      throw new ForbiddenError(`Managers cannot change: ${disallowed.join(', ')}`)
    }
  }

  return db.transaction(async (tx) => {
    const existingRows = await tx.select().from(branch).where(eq(branch.id, id)).limit(1)
    const existing = existingRows[0]
    if (!existing) throw new NotFoundError('Branch not found')

    const rows = await tx
      .update(branch)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.area !== undefined ? { area: input.area } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      })
      .where(eq(branch.id, id))
      .returning()
    const updated = rows[0]
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update branch')

    await writeAudit(
      {
        ...actor,
        action: 'branch.updated',
        entity: 'branch',
        entityId: id,
        before: existing,
        after: updated,
        branchId: id,
      },
      tx,
    )
    return updated
  })
}

export async function deactivateBranch(
  actor: AuditActor,
  id: string,
): Promise<typeof branch.$inferSelect> {
  return db.transaction(async (tx) => {
    const existingRows = await tx.select().from(branch).where(eq(branch.id, id)).limit(1)
    const existing = existingRows[0]
    if (!existing) throw new NotFoundError('Branch not found')
    if (!existing.isActive) return existing

    const rows = await tx
      .update(branch)
      .set({ isActive: false })
      .where(eq(branch.id, id))
      .returning()
    const updated = rows[0]
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to deactivate branch')

    await writeAudit(
      {
        ...actor,
        action: 'branch.deactivated',
        entity: 'branch',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false },
        branchId: id,
      },
      tx,
    )
    return updated
  })
}

export interface SuggestCodeInput {
  city: string
  area?: string | undefined
  type: BranchType
}

export async function suggestCode(input: SuggestCodeInput): Promise<BranchCodeSuggestion> {
  const rows = await db.select({ code: branch.code }).from(branch)
  return suggestBranchCode({
    city: input.city,
    area: input.area,
    type: input.type,
    existingCodes: rows.map((row) => row.code),
  })
}
