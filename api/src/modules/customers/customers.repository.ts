import { type DbExecutor, db } from '@gikautos/db'
import { and, asc, count, eq, ilike, isNull, or, type SQL, sql } from 'drizzle-orm'
import { creditProfile } from '../credit/credit.schema.ts'
import { loyaltyAccount } from '../loyalty/loyalty.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { customer } from './customers.schema.ts'
import type {
  CustomerCreditProfileRow,
  CustomerListRow,
  CustomerRow,
  CustomerSearchFilters,
  CustomerStatus,
} from './customers.types.ts'

const customerListSelection = {
  id: customer.id,
  name: customer.name,
  phone: customer.phone,
  email: customer.email,
  address: customer.address,
  status: customer.status,
  anonymizedAt: customer.anonymizedAt,
  createdBranchId: customer.createdBranchId,
  createdBranchCode: branch.code,
  createdBranchName: branch.name,
  createdAt: customer.createdAt,
  updatedAt: customer.updatedAt,
}

export async function insertCustomer(
  values: typeof customer.$inferInsert,
  executor: DbExecutor = db,
): Promise<CustomerRow | null> {
  const rows = await executor.insert(customer).values(values).returning()
  return rows[0] ?? null
}

/** Every customer gets a global loyalty account at creation (D22 bootstrap). */
export async function insertLoyaltyAccount(
  customerId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .insert(loyaltyAccount)
    .values({ customerId })
    .onConflictDoNothing({ target: loyaltyAccount.customerId })
}

export async function findCustomerById(
  id: string,
  executor: DbExecutor = db,
): Promise<CustomerRow | null> {
  const rows = await executor.select().from(customer).where(eq(customer.id, id)).limit(1)
  return rows[0] ?? null
}

export async function findCustomerByPhone(
  phone: string,
  executor: DbExecutor = db,
): Promise<CustomerRow | null> {
  const rows = await executor
    .select()
    .from(customer)
    .where(and(eq(customer.phone, phone), isNull(customer.anonymizedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function updateCustomerRow(
  id: string,
  patch: Partial<typeof customer.$inferInsert>,
  executor: DbExecutor = db,
): Promise<CustomerRow | null> {
  const rows = await executor.update(customer).set(patch).where(eq(customer.id, id)).returning()
  return rows[0] ?? null
}

export async function setCustomerStatus(
  id: string,
  status: CustomerStatus,
  executor: DbExecutor = db,
): Promise<CustomerRow | null> {
  const rows = await executor
    .update(customer)
    .set({ status })
    .where(eq(customer.id, id))
    .returning()
  return rows[0] ?? null
}

/**
 * Scrubs all PII in place (Ghana DPA erasure) and marks the row anonymized.
 * Ledger rows keep referencing the id; the partial unique phone index lets
 * the released number be registered again.
 */
export async function anonymizeCustomerRow(
  id: string,
  executor: DbExecutor = db,
): Promise<CustomerRow | null> {
  const rows = await executor
    .update(customer)
    .set({
      name: 'Anonymized customer',
      phone: null,
      email: null,
      address: null,
      anonymizedAt: new Date(),
    })
    .where(eq(customer.id, id))
    .returning()
  return rows[0] ?? null
}

export async function findCustomerListRowById(id: string): Promise<CustomerListRow | null> {
  const rows = await db
    .select(customerListSelection)
    .from(customer)
    .innerJoin(branch, eq(branch.id, customer.createdBranchId))
    .where(eq(customer.id, id))
    .limit(1)
  return rows[0] ?? null
}

function buildSearchCondition(filters: CustomerSearchFilters): SQL | undefined {
  const conditions: SQL[] = [isNull(customer.anonymizedAt)]
  if (!filters.includeArchived) conditions.push(eq(customer.status, 'ACTIVE'))
  if (filters.branchId) conditions.push(eq(customer.createdBranchId, filters.branchId))

  const matches: SQL[] = []
  if (filters.nameLike) matches.push(ilike(customer.name, `%${filters.nameLike}%`))
  if (filters.phoneExact) matches.push(eq(customer.phone, filters.phoneExact))
  if (filters.phoneDigits) {
    matches.push(
      sql`right(${customer.phone}, ${filters.phoneDigits.length}) = ${filters.phoneDigits}`,
    )
  }

  const matchClause = matches.length > 0 ? or(...matches) : undefined
  if (matchClause) conditions.push(matchClause)

  return and(...conditions)
}

export async function searchCustomerRows(
  filters: CustomerSearchFilters,
): Promise<CustomerListRow[]> {
  return db
    .select(customerListSelection)
    .from(customer)
    .innerJoin(branch, eq(branch.id, customer.createdBranchId))
    .where(buildSearchCondition(filters))
    .orderBy(asc(customer.name), asc(customer.id))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countCustomerRows(filters: CustomerSearchFilters): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(customer)
    .where(buildSearchCondition(filters))
  return rows[0]?.total ?? 0
}

/** Reads the branch credit projections for a customer; `null` means every branch. */
export async function listCreditProfilesForCustomer(
  customerId: string,
  branchId: string | null = null,
): Promise<CustomerCreditProfileRow[]> {
  const conditions: SQL[] = [eq(creditProfile.customerId, customerId)]
  if (branchId) conditions.push(eq(creditProfile.branchId, branchId))

  return db
    .select({
      id: creditProfile.id,
      branchId: creditProfile.branchId,
      branchCode: branch.code,
      branchName: branch.name,
      limitMinor: creditProfile.limitMinor,
      hold: creditProfile.hold,
      paymentTermDays: creditProfile.paymentTermDays,
      balanceMinor: creditProfile.balanceMinor,
    })
    .from(creditProfile)
    .innerJoin(branch, eq(branch.id, creditProfile.branchId))
    .where(and(...conditions))
    .orderBy(asc(branch.code))
}

export async function findLoyaltyAccount(
  customerId: string,
  executor: DbExecutor = db,
): Promise<{ id: string; balancePoints: number } | null> {
  const rows = await executor
    .select({ id: loyaltyAccount.id, balancePoints: loyaltyAccount.balancePoints })
    .from(loyaltyAccount)
    .where(eq(loyaltyAccount.customerId, customerId))
    .limit(1)
  return rows[0] ?? null
}
