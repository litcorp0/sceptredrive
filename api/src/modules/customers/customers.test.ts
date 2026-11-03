import { db } from '@sceptre/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  signIn,
  uniqueSuffix,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { ConflictError, ForbiddenError, ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { creditLedgerEntry, creditProfile } from '../credit/credit.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { loyaltyAccount, loyaltyLedgerEntry } from '../loyalty/loyalty.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { customer } from './customers.schema.ts'
import * as customersService from './customers.service.ts'
import type { CustomerCreateBody, CustomerListQuery, CustomerListRow } from './customers.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[customers.test] database unavailable; integration tests skipped')

const actor: AuditActor = {
  actorId: 'test-actor',
  actorStaffId: 'SD-TEST',
  ip: null,
  userAgent: null,
  requestId: null,
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
    return null
  } catch (error) {
    return error
  }
}

describe.skipIf(!available)('customers service', () => {
  const suffix = uniqueSuffix()
  const branchIds: string[] = []
  const customerIds: string[] = []
  let branchAId = ''
  let branchBId = ''
  let managerUser: SessionUser
  let adminUser: SessionUser
  let phoneCounter = 0

  function makeUser(overrides: Partial<SessionUser>): SessionUser {
    return {
      id: `user-${suffix}`,
      email: `user-${suffix}@sceptre.test`,
      name: 'Fixture User',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: 'MANAGER',
      branchId: null,
      staffId: null,
      phone: null,
      isActive: true,
      mustChangePassword: false,
      image: null,
      ...overrides,
    } as SessionUser
  }

  function nextPhone(prefix: '024' | '027' | '028' | '054' | '059'): string {
    phoneCounter += 1
    return `${prefix}123${String(1000 + phoneCounter).slice(-4)}`
  }

  async function createCustomer(
    user: SessionUser,
    input: CustomerCreateBody,
  ): Promise<CustomerListRow> {
    const created = await customersService.createCustomer(actor, user, input)
    customerIds.push(created.id)
    return created
  }

  function searchQuery(overrides: Partial<CustomerListQuery> = {}): CustomerListQuery {
    return { page: 1, pageSize: 20, includeArchived: false, ...overrides }
  }

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values([
        { code: `CUS-${suffix}-A`, name: `Customers A ${suffix}`, type: 'RETAIL', city: 'Accra' },
        { code: `CUS-${suffix}-B`, name: `Customers B ${suffix}`, type: 'RETAIL', city: 'Kumasi' },
      ])
      .returning({ id: branch.id })
    branchAId = branches[0]?.id ?? ''
    branchBId = branches[1]?.id ?? ''
    branchIds.push(branchAId, branchBId)

    managerUser = makeUser({ role: 'MANAGER', branchId: branchAId })
    adminUser = makeUser({ role: 'ADMIN', branchId: null })
  })

  afterAll(async () => {
    if (customerIds.length > 0) {
      const accounts = await db
        .select({ id: loyaltyAccount.id })
        .from(loyaltyAccount)
        .where(inArray(loyaltyAccount.customerId, customerIds))
      const accountIds = accounts.map((row) => row.id)
      if (accountIds.length > 0) {
        await db.delete(loyaltyLedgerEntry).where(inArray(loyaltyLedgerEntry.accountId, accountIds))
        await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.id, accountIds))
      }
      await db.delete(creditLedgerEntry).where(inArray(creditLedgerEntry.customerId, customerIds))
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, customerIds))
      await db.delete(customer).where(inArray(customer.id, customerIds))
      await db.delete(auditLog).where(inArray(auditLog.entityId, customerIds))
    }
    if (branchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, branchIds))
    }
  })

  it('creates a customer with a normalized phone, loyalty account, and audit trail', async () => {
    const created = await createCustomer(managerUser, {
      name: `Akosua ${suffix}`,
      phone: '0241234567',
    })

    expect(created.phone).toBe('+233241234567')
    expect(created.status).toBe('ACTIVE')
    expect(created.createdBranchId).toBe(branchAId)
    expect(created.createdBranchCode).toBe(`CUS-${suffix}-A`)

    const accounts = await db
      .select({ balancePoints: loyaltyAccount.balancePoints })
      .from(loyaltyAccount)
      .where(eq(loyaltyAccount.customerId, created.id))
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.balancePoints).toBe(0)

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, created.id))
    expect(audits.map((row) => row.action)).toContain('customer.created')
  })

  it('rejects invalid phone numbers with a 400', async () => {
    const error = await captureError(() =>
      customersService.createCustomer(actor, managerUser, {
        name: `Bad Phone ${suffix}`,
        phone: '12345',
      }),
    )
    expect(error).toBeInstanceOf(ValidationError)
  })

  it('rejects a duplicate phone with the existing customer id in the message', async () => {
    const phone = nextPhone('024')
    const first = await createCustomer(managerUser, { name: `First ${suffix}`, phone })

    const error = await captureError(() =>
      customersService.createCustomer(actor, managerUser, { name: `Second ${suffix}`, phone }),
    )
    expect(error).toBeInstanceOf(ConflictError)
    if (!(error instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(error.message).toContain(first.id)
  })

  it('requires admins to pick a creation branch', async () => {
    const missingBranch = await captureError(() =>
      customersService.createCustomer(actor, adminUser, {
        name: `Admin No Branch ${suffix}`,
        phone: nextPhone('027'),
      }),
    )
    expect(missingBranch).toBeInstanceOf(ValidationError)

    const created = await createCustomer(adminUser, {
      name: `Admin Branch B ${suffix}`,
      phone: nextPhone('027'),
      branchId: branchBId,
    })
    expect(created.createdBranchId).toBe(branchBId)
  })

  it('finds customers by phone suffix and by name fragment', async () => {
    const phone = nextPhone('054')
    const created = await createCustomer(managerUser, {
      name: `Searchable ${suffix}`,
      phone,
    })
    const last4 = phone.slice(-4)

    const bySuffix = await customersService.searchCustomers(managerUser, searchQuery({ q: last4 }))
    expect(bySuffix.customers.map((row) => row.id)).toContain(created.id)

    const byName = await customersService.searchCustomers(
      managerUser,
      searchQuery({ q: `Searchable ${suffix}` }),
    )
    expect(byName.customers.map((row) => row.id)).toContain(created.id)
    expect(byName.total).toBeGreaterThanOrEqual(1)
  })

  it('hides archived customers unless an admin asks for them', async () => {
    const created = await createCustomer(managerUser, {
      name: `Archived ${suffix}`,
      phone: nextPhone('059'),
    })
    await db.update(customer).set({ status: 'ARCHIVED' }).where(eq(customer.id, created.id))

    const defaults = await customersService.searchCustomers(
      managerUser,
      searchQuery({ q: `Archived ${suffix}` }),
    )
    expect(defaults.customers).toHaveLength(0)

    const adminView = await customersService.searchCustomers(
      adminUser,
      searchQuery({ q: `Archived ${suffix}`, includeArchived: true }),
    )
    expect(adminView.customers.map((row) => row.id)).toContain(created.id)

    const managerOverride = await captureError(() =>
      customersService.searchCustomers(managerUser, searchQuery({ includeArchived: true })),
    )
    expect(managerOverride).toBeInstanceOf(ForbiddenError)

    const managerBranchFilter = await captureError(() =>
      customersService.searchCustomers(managerUser, searchQuery({ branchId: branchAId })),
    )
    expect(managerBranchFilter).toBeInstanceOf(ForbiddenError)

    const adminBranchFilter = await customersService.searchCustomers(
      adminUser,
      searchQuery({ q: `Admin Branch B ${suffix}`, branchId: branchBId }),
    )
    expect(adminBranchFilter.customers.every((row) => row.createdBranchId === branchBId)).toBe(true)
  })

  it('updates a customer, re-checking phone uniqueness, and audits the change', async () => {
    const phoneA = nextPhone('028')
    const phoneB = nextPhone('028')
    const first = await createCustomer(managerUser, { name: `Updater A ${suffix}`, phone: phoneA })
    const second = await createCustomer(managerUser, { name: `Updater B ${suffix}`, phone: phoneB })

    const clash = await captureError(() =>
      customersService.updateCustomer(actor, second.id, { phone: phoneA }),
    )
    expect(clash).toBeInstanceOf(ConflictError)
    if (!(clash instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(clash.message).toContain(first.id)

    const updated = await customersService.updateCustomer(actor, second.id, {
      name: `Updated B ${suffix}`,
      email: `updated-${suffix}@example.com`,
    })
    expect(updated.name).toBe(`Updated B ${suffix}`)
    expect(updated.email).toBe(`updated-${suffix}@example.com`)

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, second.id))
    expect(audits.map((row) => row.action)).toContain('customer.updated')
  })

  it('returns credit profiles scoped to the caller plus the loyalty balance', async () => {
    const created = await createCustomer(managerUser, {
      name: `Detail ${suffix}`,
      phone: nextPhone('054'),
    })

    // Registration already opened branch A's profile at the branch default, so
    // this test moves it rather than inserting a second row.
    await db.insert(creditProfile).values({
      customerId: created.id,
      branchId: branchBId,
      limitMinor: 10_000,
      balanceMinor: 0,
      createdBy: 'test',
    })
    await db
      .update(creditProfile)
      .set({
        limitMinor: 50_000,
        paymentTermDays: 14,
        balanceMinor: 12_000,
        createdBy: 'test',
      })
      .where(and(eq(creditProfile.customerId, created.id), eq(creditProfile.branchId, branchAId)))
    await db
      .update(loyaltyAccount)
      .set({ balancePoints: 250 })
      .where(eq(loyaltyAccount.customerId, created.id))

    const asManager = await customersService.getCustomer(managerUser, created.id)
    expect(asManager.creditProfiles).toHaveLength(1)
    expect(asManager.creditProfiles[0]?.branchId).toBe(branchAId)
    expect(asManager.creditProfiles[0]?.balanceMinor).toBe(12_000)
    expect(asManager.creditProfiles[0]?.paymentTermDays).toBe(14)
    expect(asManager.loyalty?.balancePoints).toBe(250)

    const asAdmin = await customersService.getCustomer(adminUser, created.id)
    expect(asAdmin.creditProfiles).toHaveLength(2)
    expect(asAdmin.creditProfiles.map((row) => row.branchId)).toEqual([branchAId, branchBId])
  })

  it('archives and reactivates a customer with an audit trail', async () => {
    const created = await createCustomer(managerUser, {
      name: `Lifecycle ${suffix}`,
      phone: nextPhone('059'),
    })

    const archived = await customersService.archiveCustomer(actor, created.id, 'Moved away')
    expect(archived.status).toBe('ARCHIVED')

    // Re-archiving is a no-op and writes no second audit row.
    await customersService.archiveCustomer(actor, created.id)
    const archivedAudits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, created.id), eq(auditLog.action, 'customer.archived')))
    expect(archivedAudits).toHaveLength(1)

    const reactivated = await customersService.reactivateCustomer(actor, created.id)
    expect(reactivated.status).toBe('ACTIVE')

    const actions = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, created.id))
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining(['customer.archived', 'customer.reactivated']),
    )
  })

  it('anonymizes only after credit and loyalty balances are zero and releases the phone', async () => {
    const phone = nextPhone('028')
    const created = await createCustomer(managerUser, {
      name: `Erasure ${suffix}`,
      phone,
      email: `erasure-${suffix}@example.com`,
    })
    const normalizedPhone = created.phone
    if (!normalizedPhone) throw new Error('expected a normalized phone')

    // The profile exists from registration; the balance is what this test sets.
    await db
      .update(creditProfile)
      .set({ balanceMinor: 4_500, createdBy: 'test' })
      .where(and(eq(creditProfile.customerId, created.id), eq(creditProfile.branchId, branchAId)))
    await db.insert(creditLedgerEntry).values({
      customerId: created.id,
      branchId: branchAId,
      kind: 'CHARGE',
      amountMinor: 4_500,
      reasonCode: 'OPENING_BALANCE',
      occurredAt: new Date(),
      createdBy: 'test',
    })

    const creditBlock = await captureError(() =>
      customersService.anonymizeCustomer(actor, created.id),
    )
    expect(creditBlock).toBeInstanceOf(ConflictError)
    if (!(creditBlock instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(creditBlock.message).toContain(`CUS-${suffix}-A`)

    // Reconcile the branch credit to zero with a compensating entry.
    await db.insert(creditLedgerEntry).values({
      customerId: created.id,
      branchId: branchAId,
      kind: 'ADJUSTMENT',
      amountMinor: -4_500,
      reasonCode: 'CORRECTION',
      occurredAt: new Date(),
      createdBy: 'test',
    })
    await db
      .update(creditProfile)
      .set({ balanceMinor: 0 })
      .where(eq(creditProfile.customerId, created.id))

    const accountRows = await db
      .select({ id: loyaltyAccount.id })
      .from(loyaltyAccount)
      .where(eq(loyaltyAccount.customerId, created.id))
    const accountId = accountRows[0]?.id
    if (!accountId) throw new Error('loyalty account missing')

    await db
      .update(loyaltyAccount)
      .set({ balancePoints: 250 })
      .where(eq(loyaltyAccount.customerId, created.id))
    const loyaltyBlock = await captureError(() =>
      customersService.anonymizeCustomer(actor, created.id),
    )
    expect(loyaltyBlock).toBeInstanceOf(ConflictError)

    // Reconcile points to zero, then anonymize for real.
    await db.insert(loyaltyLedgerEntry).values({
      accountId,
      customerId: created.id,
      branchId: branchAId,
      kind: 'ADJUST',
      pointsDelta: -250,
      reasonCode: 'CORRECTION',
      occurredAt: new Date(),
      createdBy: 'test',
    })
    await db
      .update(loyaltyAccount)
      .set({ balancePoints: 0 })
      .where(eq(loyaltyAccount.customerId, created.id))

    const anonymized = await customersService.anonymizeCustomer(actor, created.id, 'DPA request')
    expect(anonymized.name).toBe('Anonymized customer')
    expect(anonymized.phone).toBeNull()
    expect(anonymized.email).toBeNull()
    expect(anonymized.anonymizedAt).not.toBeNull()

    // Ledger history stays intact and audited.
    const creditRows = await db
      .select({ id: creditLedgerEntry.id })
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.customerId, created.id))
    expect(creditRows).toHaveLength(2)
    const pointsRows = await db
      .select({ id: loyaltyLedgerEntry.id })
      .from(loyaltyLedgerEntry)
      .where(eq(loyaltyLedgerEntry.accountId, accountId))
    expect(pointsRows).toHaveLength(1)
    const actions = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, created.id))
    expect(actions.map((row) => row.action)).toContain('customer.anonymized')

    // Anonymized rows never appear in search.
    const search = await customersService.searchCustomers(
      managerUser,
      searchQuery({ q: 'Anonymized cust' }),
    )
    expect(search.customers.map((row) => row.id)).not.toContain(created.id)

    // The released phone can be registered by a new customer.
    const reborn = await createCustomer(managerUser, { name: `Reborn ${suffix}`, phone })
    expect(reborn.phone).toBe(normalizedPhone)
    expect(reborn.id).not.toBe(created.id)

    // Anonymized customers are no longer editable.
    const editBlock = await captureError(() =>
      customersService.updateCustomer(actor, created.id, { name: 'Nope' }),
    )
    expect(editBlock).toBeInstanceOf(ConflictError)
  })
})

describe.skipIf(!available)('customers HTTP surface', () => {
  const suffix = uniqueSuffix()
  const createdUserIds: string[] = []
  const createdCustomerIds: string[] = []
  let branchId = ''
  let adminCookie = ''
  let managerCookie = ''
  let cashierCookie = ''
  let phoneCounter = 0

  function nextPhone(prefix: '024' | '027' | '059'): string {
    phoneCounter += 1
    return `${prefix}321${String(2000 + phoneCounter).slice(-4)}`
  }

  async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T
  }

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values({
        code: `CUSHTTP-${suffix}`,
        name: `Customers HTTP ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      })
      .returning({ id: branch.id })
    branchId = branches[0]?.id ?? ''

    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const manager = await createTestUser({ role: 'MANAGER', branchId })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    createdUserIds.push(cashier.id)
    cashierCookie = await signIn(cashier.email)
  })

  afterAll(async () => {
    if (createdCustomerIds.length > 0) {
      const accounts = await db
        .select({ id: loyaltyAccount.id })
        .from(loyaltyAccount)
        .where(inArray(loyaltyAccount.customerId, createdCustomerIds))
      const accountIds = accounts.map((row) => row.id)
      if (accountIds.length > 0) {
        await db.delete(loyaltyLedgerEntry).where(inArray(loyaltyLedgerEntry.accountId, accountIds))
        await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.id, accountIds))
      }
      await db
        .delete(creditLedgerEntry)
        .where(inArray(creditLedgerEntry.customerId, createdCustomerIds))
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, createdCustomerIds))
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds))
      await db.delete(auditLog).where(inArray(auditLog.entityId, createdCustomerIds))
    }
    if (createdUserIds.length > 0) {
      await db.delete(userTable).where(inArray(userTable.id, createdUserIds))
    }
    if (branchId) {
      await db.delete(branch).where(eq(branch.id, branchId))
    }
  })

  it('requires a session', async () => {
    const response = await app.request('/api/customers')
    expect(response.status).toBe(401)
  })

  it('denies cashiers on customer endpoints', async () => {
    const list = await app.request('/api/customers', { headers: authedHeaders(cashierCookie) })
    expect(list.status).toBe(403)

    const create = await app.request('/api/customers', {
      method: 'POST',
      headers: authedHeaders(cashierCookie),
      body: JSON.stringify({ name: 'Cashier Customer', phone: '0241234567' }),
    })
    expect(create.status).toBe(403)
  })

  it('lets a manager create, search, read, and update', async () => {
    const phone = nextPhone('024')
    const create = await app.request('/api/customers', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ name: `HTTP Customer ${suffix}`, phone }),
    })
    expect(create.status).toBe(201)
    const created = (
      await readJson<{
        customer: { id: string; phone: string | null; createdBranchId: string }
      }>(create)
    ).customer
    createdCustomerIds.push(created.id)
    expect(created.phone).toBe(`+233${phone.slice(1)}`)
    expect(created.createdBranchId).toBe(branchId)

    const search = await app.request(`/api/customers?q=${phone.slice(-4)}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(search.status).toBe(200)
    const found = await readJson<{ customers: { id: string }[]; total: number }>(search)
    expect(found.customers.map((row) => row.id)).toContain(created.id)

    const detail = await app.request(`/api/customers/${created.id}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(detail.status).toBe(200)
    const detailBody = await readJson<{
      customer: { id: string }
      creditProfiles: unknown[]
      loyalty: { balancePoints: number } | null
    }>(detail)
    expect(detailBody.customer.id).toBe(created.id)
    expect(detailBody.loyalty?.balancePoints).toBe(0)

    const update = await app.request(`/api/customers/${created.id}`, {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ address: '12 Ring Road, Accra' }),
    })
    expect(update.status).toBe(200)
    const updated = await readJson<{ customer: { address: string | null } }>(update)
    expect(updated.customer.address).toBe('12 Ring Road, Accra')
  })

  it('reserves archive, reactivate, and anonymize for admins', async () => {
    const phone = nextPhone('027')
    const create = await app.request('/api/customers', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ name: `HTTP Lifecycle ${suffix}`, phone }),
    })
    expect(create.status).toBe(201)
    const created = (await readJson<{ customer: { id: string } }>(create)).customer
    createdCustomerIds.push(created.id)

    const managerArchive = await app.request(`/api/customers/${created.id}/archive`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({}),
    })
    expect(managerArchive.status).toBe(403)

    const managerAnonymize = await app.request(`/api/customers/${created.id}/anonymize`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({}),
    })
    expect(managerAnonymize.status).toBe(403)

    const adminArchive = await app.request(`/api/customers/${created.id}/archive`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ note: 'Duplicate record' }),
    })
    expect(adminArchive.status).toBe(200)
    expect((await readJson<{ customer: { status: string } }>(adminArchive)).customer.status).toBe(
      'ARCHIVED',
    )

    const hidden = await app.request(`/api/customers?q=${phone.slice(-4)}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(
      (await readJson<{ customers: { id: string }[] }>(hidden)).customers.map((row) => row.id),
    ).not.toContain(created.id)

    const visible = await app.request(`/api/customers?q=${phone.slice(-4)}&includeArchived=true`, {
      headers: authedHeaders(adminCookie),
    })
    expect(
      (await readJson<{ customers: { id: string }[] }>(visible)).customers.map((row) => row.id),
    ).toContain(created.id)

    const reactivate = await app.request(`/api/customers/${created.id}/reactivate`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(reactivate.status).toBe(200)
    expect((await readJson<{ customer: { status: string } }>(reactivate)).customer.status).toBe(
      'ACTIVE',
    )

    const anonymize = await app.request(`/api/customers/${created.id}/anonymize`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ note: 'DPA request' }),
    })
    expect(anonymize.status).toBe(200)
    const anonymized = (
      await readJson<{ customer: { phone: string | null; anonymizedAt: string | null } }>(anonymize)
    ).customer
    expect(anonymized.phone).toBeNull()
    expect(anonymized.anonymizedAt).not.toBeNull()

    const again = await app.request(`/api/customers/${created.id}/anonymize`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({}),
    })
    expect(again.status).toBe(409)
  })

  it('returns 404 for unknown ids', async () => {
    const response = await app.request(`/api/customers/${crypto.randomUUID()}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(404)
  })
})
