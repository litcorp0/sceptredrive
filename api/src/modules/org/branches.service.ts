import { db } from '@sceptre/db'
import { normalizeBranchCode, suggestBranchCode } from '@sceptre/shared'
import { assertBranchAccess, branchScope, hasPermission, roleOf } from '../../auth/scope.ts'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'
import {
  findBranchById,
  insertBranch,
  listActiveBranchDirectoryRows,
  listActiveRetailBranchContacts,
  listBranchRows,
  selectBranchCodes,
  updateBranchRow,
} from './branches.repository.ts'
import type {
  BranchCreateInput,
  BranchDirectoryResult,
  BranchListFilters,
  BranchRow,
  BranchUpdateInput,
  PublicBranchContact,
  SuggestCodeInput,
  SuggestCodeResult,
} from './branches.types.ts'

const MANAGER_UPDATE_FIELDS = new Set(['name', 'address', 'phone'])
const MAX_CODE_ATTEMPTS = 5

export async function listBranches(
  user: SessionUser,
  filters: BranchListFilters,
): Promise<BranchRow[]> {
  const scope = branchScope(user)
  return listBranchRows({ branchId: scope, includeInactive: filters.includeInactive })
}

/**
 * Unscoped by design: `/api/branches` stays branch-scoped for the console's
 * branch switcher, but a manager requesting a transfer must be able to name a
 * source branch. Only active branches are listed, so a deactivated branch can
 * never be a transfer source.
 */
export async function listBranchDirectory(user: SessionUser): Promise<BranchDirectoryResult> {
  if (!hasPermission(user, 'branch.read')) {
    throw new ForbiddenError('You cannot read the branch directory')
  }

  return { branches: await listActiveBranchDirectoryRows() }
}

/**
 * The public website's branch list. No session by design: this is marketing
 * data, already public once the site is live. The caller (the site module)
 * resolves the branch-scoped hours/map settings before projecting the id away.
 */
export async function listPublicBranchContacts(): Promise<PublicBranchContact[]> {
  return listActiveRetailBranchContacts()
}

export async function getBranch(user: SessionUser, id: string): Promise<BranchRow> {
  const found = await findBranchById(id)
  if (!found) throw new NotFoundError('Branch not found')
  assertBranchAccess(user, found.id)
  return found
}

export async function createBranch(
  actor: AuditActor,
  input: BranchCreateInput,
): Promise<BranchRow> {
  const explicitCode = input.code ? normalizeBranchCode(input.code) : null
  // An explicit code is a caller decision, so a duplicate is a 409. A generated
  // code can lose a race with another create, so it reads the codes again.
  const attempts = explicitCode ? 1 : MAX_CODE_ATTEMPTS

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const code =
          explicitCode ??
          suggestBranchCode({
            city: input.city,
            area: input.area,
            type: input.type,
            existingCodes: await selectBranchCodes(tx),
          }).code

        const created = await insertBranch(
          {
            code,
            name: input.name,
            type: input.type,
            city: input.city,
            area: input.area ?? null,
            address: input.address ?? null,
            phone: input.phone ?? null,
            createdBy: actor.actorId,
          },
          tx,
        )
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
      if (!isUniqueViolation(error)) throw error
      if (explicitCode || attempt === attempts - 1) {
        throw new ConflictError(
          explicitCode
            ? 'A branch with this code already exists'
            : 'Could not allocate a branch code, please retry',
        )
      }
    }
  }

  throw new ConflictError('Could not allocate a branch code, please retry')
}

export async function updateBranch(
  user: SessionUser,
  actor: AuditActor,
  id: string,
  input: BranchUpdateInput,
): Promise<BranchRow> {
  const isManager = roleOf(user) !== 'ADMIN'
  if (isManager) {
    assertBranchAccess(user, id)
    const disallowed = Object.keys(input).filter((key) => !MANAGER_UPDATE_FIELDS.has(key))
    if (disallowed.length > 0) {
      throw new ForbiddenError(`Managers cannot change: ${disallowed.join(', ')}`)
    }
  }

  return db.transaction(async (tx) => {
    const existing = await findBranchById(id, tx)
    if (!existing) throw new NotFoundError('Branch not found')

    const updated = await updateBranchRow(
      id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.area !== undefined ? { area: input.area } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      },
      tx,
    )
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

export async function deactivateBranch(actor: AuditActor, id: string): Promise<BranchRow> {
  return db.transaction(async (tx) => {
    const existing = await findBranchById(id, tx)
    if (!existing) throw new NotFoundError('Branch not found')
    if (!existing.isActive) return existing

    const updated = await updateBranchRow(id, { isActive: false }, tx)
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

export async function suggestCode(input: SuggestCodeInput): Promise<SuggestCodeResult> {
  const existingCodes = await selectBranchCodes()
  return suggestBranchCode({
    city: input.city,
    area: input.area,
    type: input.type,
    existingCodes,
  })
}
