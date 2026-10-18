import { db } from '@gikautos/db'
import { normalizeGhanaPhone } from '@gikautos/shared'
import { resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { getBranch } from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import {
  countCustomerRows,
  findCustomerById,
  findCustomerByPhone,
  findCustomerListRowById,
  findLoyaltyAccount,
  insertCustomer,
  insertLoyaltyAccount,
  listCreditProfilesForCustomer,
  searchCustomerRows,
  updateCustomerRow,
} from './customers.repository.ts'
import type {
  CustomerCreateBody,
  CustomerDetail,
  CustomerListQuery,
  CustomerListRow,
  CustomerSearchFilters,
  CustomerSearchResult,
  CustomerUpdateBody,
} from './customers.types.ts'

const INVALID_PHONE = 'Enter a valid Ghana phone number (e.g. 024 123 4567)'

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function buildSearchFilters(
  query: CustomerListQuery,
  branchId: string | null,
): CustomerSearchFilters {
  const q = query.q ?? null
  let phoneExact: string | null = null
  let phoneDigits: string | null = null

  if (q) {
    phoneExact = normalizeGhanaPhone(q)
    let digits = q.replace(/\D/g, '')
    if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1)
    if (digits.length >= 4) phoneDigits = digits
  }

  return {
    nameLike: q ? escapeLikePattern(q) : null,
    phoneExact,
    phoneDigits,
    branchId,
    includeArchived: query.includeArchived,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  }
}

/** Creates a customer at a branch together with their loyalty account. */
export async function createCustomer(
  actor: AuditActor,
  user: SessionUser,
  input: CustomerCreateBody,
): Promise<CustomerListRow> {
  const phone = normalizeGhanaPhone(input.phone)
  if (!phone) throw new ValidationError(INVALID_PHONE)

  const existing = await findCustomerByPhone(phone)
  if (existing) {
    throw new ConflictError(
      `A customer with this phone already exists: ${existing.name} (${existing.id})`,
    )
  }

  const createdBranchId = resolveBranchFilter(user, input.branchId ?? null)
  if (!createdBranchId) {
    throw new ValidationError('branchId is required when an admin creates a customer')
  }
  await getBranch(user, createdBranchId)

  const created = await db.transaction(async (tx) => {
    const row = await insertCustomer(
      {
        name: input.name,
        phone,
        email: input.email ?? null,
        address: input.address ?? null,
        createdBranchId,
        createdBy: actorLabel(actor) ?? actor.actorId,
      },
      tx,
    )
    if (!row) throw new AppError(500, 'INTERNAL', 'Failed to create customer')

    await insertLoyaltyAccount(row.id, tx)
    await writeAudit(
      {
        ...actor,
        action: 'customer.created',
        entity: 'customer',
        entityId: row.id,
        branchId: createdBranchId,
        after: { name: row.name, phone: row.phone },
      },
      tx,
    )
    return row
  })

  const listRow = await findCustomerListRowById(created.id)
  if (!listRow) throw new AppError(500, 'INTERNAL', 'Failed to load the created customer')
  return listRow
}

/** Updates identity fields; phone re-normalization and uniqueness are enforced. */
export async function updateCustomer(
  actor: AuditActor,
  id: string,
  input: CustomerUpdateBody,
): Promise<CustomerListRow> {
  const existing = await findCustomerById(id)
  if (!existing) throw new NotFoundError('Customer not found')
  if (existing.anonymizedAt) throw new ConflictError('Anonymized customers cannot be edited')

  let phone = existing.phone
  if (input.phone !== undefined) {
    phone = normalizeGhanaPhone(input.phone)
    if (!phone) throw new ValidationError(INVALID_PHONE)

    const clash = await findCustomerByPhone(phone)
    if (clash && clash.id !== id) {
      throw new ConflictError(
        `A customer with this phone already exists: ${clash.name} (${clash.id})`,
      )
    }
  }

  const patch: Partial<typeof existing> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.phone !== undefined) patch.phone = phone
  if (input.email !== undefined) patch.email = input.email ?? null
  if (input.address !== undefined) patch.address = input.address ?? null

  await db.transaction(async (tx) => {
    const row = await updateCustomerRow(id, patch, tx)
    if (!row) throw new AppError(500, 'INTERNAL', 'Failed to update customer')

    await writeAudit(
      {
        ...actor,
        action: 'customer.updated',
        entity: 'customer',
        entityId: id,
        branchId: row.createdBranchId,
        before: { name: existing.name, phone: existing.phone },
        after: { name: row.name, phone: row.phone },
      },
      tx,
    )
  })

  const listRow = await findCustomerListRowById(id)
  if (!listRow) throw new AppError(500, 'INTERNAL', 'Failed to load the updated customer')
  return listRow
}

/**
 * Customer detail: identity plus branch credit projections scoped to the
 * caller (managers see their own branch only) and the global loyalty balance.
 */
export async function getCustomer(user: SessionUser, id: string): Promise<CustomerDetail> {
  const row = await findCustomerListRowById(id)
  if (!row) throw new NotFoundError('Customer not found')

  const branchId = resolveBranchFilter(user)
  const [creditProfiles, loyalty] = await Promise.all([
    listCreditProfilesForCustomer(id, branchId),
    findLoyaltyAccount(id),
  ])

  return {
    customer: row,
    creditProfiles,
    loyalty: loyalty ? { accountId: loyalty.id, balancePoints: loyalty.balancePoints } : null,
  }
}

/**
 * Searches all customers by name fragment and/or phone suffix. Anonymized
 * rows never appear; archived rows only for admins who ask for them.
 */
export async function searchCustomers(
  user: SessionUser,
  query: CustomerListQuery,
): Promise<CustomerSearchResult> {
  const isAdmin = roleOf(user) === 'ADMIN'
  if (!isAdmin && (query.includeArchived || query.branchId)) {
    throw new ForbiddenError('Only admins can filter by branch or include archived customers')
  }

  const filters = buildSearchFilters(query, isAdmin ? (query.branchId ?? null) : null)
  const [customers, total] = await Promise.all([
    searchCustomerRows(filters),
    countCustomerRows(filters),
  ])

  return { customers, total, page: query.page, pageSize: query.pageSize }
}
