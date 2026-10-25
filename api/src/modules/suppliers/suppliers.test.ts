import { db } from '@sceptre/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  randomToken,
  signIn,
  uniqueSuffix,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { supplierInvoice, supplierPayment } from '../payables/payables.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import { product } from '../products/products.schema.ts'
import { supplier, supplierPaymentDetail, supplierProduct } from './suppliers.schema.ts'
import * as suppliersService from './suppliers.service.ts'
import type { SupplierListQuery, SupplierRow } from './suppliers.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[suppliers.test] database unavailable; integration tests skipped')

const actor: AuditActor = {
  actorId: 'test-actor',
  actorStaffId: 'GA-TEST',
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

describe.skipIf(!available)('suppliers module', () => {
  const suffix = uniqueSuffix()
  const branchIds: string[] = []
  const categoryIds: string[] = []
  const uomIds: string[] = []
  const productIds: string[] = []
  const supplierIds: string[] = []
  const detailIds: string[] = []
  const mappingIds: string[] = []
  const invoiceIds: string[] = []
  const paymentIds: string[] = []
  const httpUserIds: string[] = []
  let branchId = ''
  let productAId = ''
  let productBId = ''
  let productArchivedId = ''
  let managerUser: SessionUser
  let supplierCounter = 0

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
      twoFactorEnabled: false,
      image: null,
      ...overrides,
    } as SessionUser
  }

  function listQuery(overrides: Partial<SupplierListQuery> = {}): SupplierListQuery {
    return { page: 1, pageSize: 20, includeArchived: false, ...overrides }
  }

  async function createSupplier(
    overrides: { name?: string; phone?: string } = {},
  ): Promise<SupplierRow> {
    supplierCounter += 1
    const created = await suppliersService.createSupplier(actor, {
      name: overrides.name ?? `Supplier ${suffix} ${supplierCounter}`,
      phone: overrides.phone,
    })
    supplierIds.push(created.id)
    return created
  }

  beforeAll(async () => {
    // Skip the demo supplier codes (SUP-00001/2) that seed fixtures insert with
    // explicit values into the shared test database.
    await allocateFromSequence('supplier.codeSequence', db)
    await allocateFromSequence('supplier.codeSequence', db)

    const branches = await db
      .insert(branch)
      .values({
        code: `SUP-${randomToken()}${supplierCounter}`,
        name: `Suppliers ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      })
      .returning({ id: branch.id })
    branchId = branches[0]?.id ?? ''
    branchIds.push(branchId)

    const categories = await db
      .insert(category)
      .values({ name: `Supp-${suffix}`, createdBy: 'test' })
      .returning({ id: category.id })
    const categoryId = categories[0]?.id ?? ''
    categoryIds.push(categoryId)

    const units = await db
      .insert(uom)
      .values({ code: `U${randomToken()}`, name: `Supp Unit ${suffix}`, createdBy: 'test' })
      .returning({ id: uom.id })
    const uomId = units[0]?.id ?? ''
    uomIds.push(uomId)

    async function createProduct(sku: string, isActive: boolean): Promise<string> {
      const rows = await db
        .insert(product)
        .values({
          sku,
          name: `Supp Product ${sku}`,
          categoryId,
          uomId,
          costPriceMinor: 1_000,
          basePriceMinor: 2_000,
          isActive,
          createdBy: 'test',
        })
        .returning({ id: product.id })
      const id = rows[0]?.id ?? ''
      productIds.push(id)
      return id
    }

    productAId = await createProduct(`SUP-${suffix}-A`, true)
    productBId = await createProduct(`SUP-${suffix}-B`, true)
    productArchivedId = await createProduct(`SUP-${suffix}-C`, false)

    managerUser = makeUser({ role: 'MANAGER', branchId })
  })

  afterAll(async () => {
    if (httpUserIds.length > 0) {
      await db.delete(userTable).where(inArray(userTable.id, httpUserIds))
    }
    if (paymentIds.length > 0) {
      await db.delete(supplierPayment).where(inArray(supplierPayment.id, paymentIds))
    }
    if (invoiceIds.length > 0) {
      await db.delete(supplierInvoice).where(inArray(supplierInvoice.id, invoiceIds))
    }
    if (detailIds.length > 0) {
      await db.delete(supplierPaymentDetail).where(inArray(supplierPaymentDetail.id, detailIds))
    }
    if (mappingIds.length > 0) {
      await db.delete(supplierProduct).where(inArray(supplierProduct.id, mappingIds))
    }
    if (supplierIds.length > 0) {
      await db.delete(supplier).where(inArray(supplier.id, supplierIds))
    }
    const auditIds = [...supplierIds, ...detailIds, ...mappingIds]
    if (auditIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.entityId, auditIds))
    }
    if (productIds.length > 0) {
      await db.delete(product).where(inArray(product.id, productIds))
    }
    if (categoryIds.length > 0) {
      await db.delete(category).where(inArray(category.id, categoryIds))
    }
    if (uomIds.length > 0) {
      await db.delete(uom).where(inArray(uom.id, uomIds))
    }
    if (branchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, branchIds))
    }
  })

  it('creates a supplier with an allocated code, normalized phone, and audit trail', async () => {
    const created = await createSupplier({ phone: '0241234567' })

    expect(created.code).toMatch(/^SUP-\d{5}$/)
    expect(created.phone).toBe('+233241234567')
    expect(created.status).toBe('ACTIVE')
    expect(created.paymentTermDays).toBe(0)

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, created.id))
    expect(audits.map((row) => row.action)).toContain('supplier.created')
  })

  it('rejects invalid phone numbers with a validation error', async () => {
    const error = await captureError(() => createSupplier({ phone: '12345' }))
    expect(error).toBeInstanceOf(ValidationError)
  })

  it('searches by name fragment and code prefix, hiding archived rows from managers', async () => {
    const marker = `Searchable${suffix}`
    const created = await createSupplier({ name: `${marker} Parts` })

    const byName = await suppliersService.listSuppliers(managerUser, listQuery({ q: marker }))
    expect(byName.suppliers.map((row) => row.id)).toContain(created.id)

    const byCode = await suppliersService.listSuppliers(managerUser, listQuery({ q: created.code }))
    expect(byCode.suppliers.map((row) => row.id)).toContain(created.id)

    const forbidden = await captureError(() =>
      suppliersService.listSuppliers(managerUser, listQuery({ includeArchived: true })),
    )
    expect(forbidden).toBeInstanceOf(ForbiddenError)
  })

  it('updates supplier fields and audits the change', async () => {
    const created = await createSupplier()
    const updated = await suppliersService.updateSupplier(actor, created.id, {
      name: `Renamed ${suffix}`,
      paymentTermDays: 30,
      email: `ap-${suffix}@example.com`,
    })

    expect(updated.name).toBe(`Renamed ${suffix}`)
    expect(updated.paymentTermDays).toBe(30)

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, created.id))
    expect(audits.map((row) => row.action)).toContain('supplier.updated')
  })

  it('archives at zero owed, blocks new documents, and reactivates', async () => {
    const created = await createSupplier()

    const archived = await suppliersService.archiveSupplier(actor, created.id, 'no longer used')
    expect(archived.status).toBe('ARCHIVED')

    const blocked = await captureError(() => suppliersService.requireSupplier(created.id))
    expect(blocked).toBeInstanceOf(ConflictError)

    const reactivated = await suppliersService.reactivateSupplier(actor, created.id)
    expect(reactivated.status).toBe('ACTIVE')
    await suppliersService.requireSupplier(created.id)
  })

  it('blocks archiving while an invoice is outstanding, naming the amount', async () => {
    const created = await createSupplier()
    const invoices = await db
      .insert(supplierInvoice)
      .values({
        number: `SINV-${suffix}-OPEN`,
        supplierId: created.id,
        branchId,
        supplierInvoiceNumber: `EXT-${suffix}`,
        invoiceDate: '2026-10-01',
        dueDate: '2026-10-31',
        subtotalMinor: 9_000,
        vatMinor: 1_000,
        totalMinor: 10_000,
      })
      .returning({ id: supplierInvoice.id })
    if (invoices[0]) invoiceIds.push(invoices[0].id)

    const error = await captureError(() => suppliersService.archiveSupplier(actor, created.id))
    expect(error).toBeInstanceOf(ConflictError)
    if (!(error instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(error.message).toContain('GHS 100.00')
  })

  it('blocks archiving while an unallocated payment sits on account', async () => {
    const created = await createSupplier()
    const payments = await db
      .insert(supplierPayment)
      .values({
        number: `PAY-${suffix}-ACCT`,
        supplierId: created.id,
        branchId,
        method: 'BANK',
        amountMinor: 5_000,
        paidAt: new Date(),
      })
      .returning({ id: supplierPayment.id })
    if (payments[0]) paymentIds.push(payments[0].id)

    const error = await captureError(() => suppliersService.archiveSupplier(actor, created.id))
    expect(error).toBeInstanceOf(ConflictError)
    if (!(error instanceof ConflictError)) throw new Error('expected ConflictError')
    expect(error.message).toContain('held on account')
  })

  it('manages payment details with exactly one active default and masked auditing', async () => {
    const created = await createSupplier()

    const bank = await suppliersService.addPaymentDetail(actor, created.id, {
      method: 'BANK',
      accountName: 'Payment Desk',
      accountNumber: '1234987654321',
      bankName: 'GCB Bank',
      bankCode: 'GCB',
    })
    detailIds.push(bank.id)
    expect(bank.isDefault).toBe(true)
    expect(bank.accountNumber).toBe('1234987654321')

    const momo = await suppliersService.addPaymentDetail(actor, created.id, {
      method: 'MOMO',
      momoNetwork: 'MTN',
      phone: '0244123456',
      isDefault: true,
    })
    detailIds.push(momo.id)
    expect(momo.isDefault).toBe(true)
    expect(momo.accountNumber).toBe('+233244123456')

    const activeDefaults = await suppliersService.getSupplierDetail(created.id)
    expect(activeDefaults.paymentDetails.filter((row) => row.isDefault)).toHaveLength(1)
    expect(activeDefaults.paymentDetails.find((row) => row.id === bank.id)?.isDefault).toBe(false)

    const duplicate = await captureError(() =>
      suppliersService.addPaymentDetail(actor, created.id, {
        method: 'MOMO',
        momoNetwork: 'MTN',
        phone: '0244123456',
      }),
    )
    expect(duplicate).toBeInstanceOf(ConflictError)

    const misuse = await captureError(() =>
      suppliersService.updatePaymentDetail(actor, created.id, bank.id, { momoNetwork: 'MTN' }),
    )
    expect(misuse).toBeInstanceOf(ValidationError)

    // Deactivating the default clears the flag: no active default remains.
    const deactivated = await suppliersService.updatePaymentDetail(actor, created.id, momo.id, {
      isActive: false,
    })
    expect(deactivated.isActive).toBe(false)
    expect(deactivated.isDefault).toBe(false)

    // Re-activating a detail does not resurrect the default implicitly.
    await suppliersService.updatePaymentDetail(actor, created.id, momo.id, { isActive: true })
    const after = await suppliersService.getSupplierDetail(created.id)
    expect(after.paymentDetails.filter((row) => row.isDefault)).toHaveLength(0)

    // The default flips back atomically when asked.
    await suppliersService.updatePaymentDetail(actor, created.id, momo.id, { isDefault: true })
    const flipped = await suppliersService.getSupplierDetail(created.id)
    expect(flipped.paymentDetails.filter((row) => row.isDefault)).toHaveLength(1)

    const audits = await db
      .select({ before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .where(inArray(auditLog.entityId, [bank.id, momo.id]))
    expect(audits.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(audits)
    expect(serialized).not.toContain('1234987654321')
    expect(serialized).not.toContain('+233244123456')
    expect(serialized).toContain('•••• 4321')
  })

  it('links supplied products, enforces duplicates and preferred switching, and tracks last cost', async () => {
    const supplierA = await createSupplier()
    const supplierB = await createSupplier()

    const mappingA = await suppliersService.addSupplierProduct(actor, supplierA.id, {
      productId: productAId,
      supplierSku: 'A-100',
      leadTimeDays: 7,
      isPreferred: true,
    })
    mappingIds.push(mappingA.id)

    const duplicateA = await captureError(() =>
      suppliersService.addSupplierProduct(actor, supplierA.id, { productId: productAId }),
    )
    expect(duplicateA).toBeInstanceOf(ConflictError)

    const archivedProduct = await captureError(() =>
      suppliersService.addSupplierProduct(actor, supplierA.id, {
        productId: productArchivedId,
      }),
    )
    expect(archivedProduct).toBeInstanceOf(ConflictError)

    // A second supplier becomes preferred for the same product: the switch is atomic.
    const mappingB = await suppliersService.addSupplierProduct(actor, supplierB.id, {
      productId: productAId,
      supplierSku: 'B-100',
      isPreferred: true,
    })
    mappingIds.push(mappingB.id)

    const preferredRows = await db
      .select({ id: supplierProduct.id })
      .from(supplierProduct)
      .where(and(eq(supplierProduct.productId, productAId), eq(supplierProduct.isPreferred, true)))
    expect(preferredRows).toHaveLength(1)
    expect(preferredRows[0]?.id).toBe(mappingB.id)

    const updated = await suppliersService.updateSupplierProduct(actor, supplierB.id, mappingB.id, {
      supplierSku: 'B-100-R2',
      leadTimeDays: 14,
    })
    expect(updated.supplierSku).toBe('B-100-R2')
    expect(updated.leadTimeDays).toBe(14)

    // Last cost is refreshed only for mapped products.
    await suppliersService.recordInvoiceCosts(
      supplierA.id,
      [
        { productId: productAId, unitCostMinor: 1_250 },
        { productId: productBId, unitCostMinor: 9_999 },
      ],
      new Date('2026-10-05T00:00:00.000Z'),
    )

    const refreshed = await suppliersService.getSupplierDetail(supplierA.id)
    const refreshedA = refreshed.products.find((row) => row.id === mappingA.id)
    expect(refreshedA?.lastCostMinor).toBe(1_250)
    expect(refreshedA?.lastCostAt).not.toBeNull()

    const unmapped = await db
      .select({ lastCostMinor: supplierProduct.lastCostMinor })
      .from(supplierProduct)
      .where(
        and(
          eq(supplierProduct.supplierId, supplierA.id),
          eq(supplierProduct.productId, productBId),
        ),
      )
    expect(unmapped).toHaveLength(0)

    // Removal is audited and leaves the supplier clean.
    await suppliersService.removeSupplierProduct(actor, supplierB.id, mappingB.id)
    const remaining = await suppliersService.getSupplierDetail(supplierB.id)
    expect(remaining.products).toHaveLength(0)

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, mappingB.id))
    expect(audits.map((row) => row.action)).toContain('supplier_product.deleted')
  })

  it('returns 404 for unknown supplier ids across the service surface', async () => {
    const missing = '00000000-0000-0000-0000-000000000000'
    expect(await captureError(() => suppliersService.getSupplierDetail(missing))).toBeInstanceOf(
      NotFoundError,
    )
    expect(
      await captureError(() => suppliersService.updateSupplier(actor, missing, { name: 'X' })),
    ).toBeInstanceOf(NotFoundError)
    expect(
      await captureError(() => suppliersService.archiveSupplier(actor, missing)),
    ).toBeInstanceOf(NotFoundError)
  })

  describe('HTTP surface', () => {
    let adminCookie = ''
    let managerCookie = ''
    let cashierCookie = ''
    let httpSupplierId = ''
    let httpDetailId = ''

    beforeAll(async () => {
      const admin = await createTestUser({ role: 'ADMIN' })
      const manager = await createTestUser({ role: 'MANAGER', branchId })
      const cashier = await createTestUser({ role: 'CASHIER', branchId })
      httpUserIds.push(admin.id, manager.id, cashier.id)
      adminCookie = await signIn(admin.email)
      managerCookie = await signIn(manager.email)
      cashierCookie = await signIn(cashier.email)
    })

    it('enforces the permission matrix', async () => {
      // Phase 11 (MGR-01): a manager may add a supplier they need to order from.
      // The rest of the matrix is unchanged — no listing of archived suppliers,
      // no editing the master, no archiving.
      const managerCreate = await app.request('/api/suppliers', {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ name: `Manager ${suffix}` }),
      })
      // Record before asserting: a failed expectation must not leak a supplier
      // whose sequence-allocated code then collides in every later run.
      const managerCreated = (await managerCreate.json()) as { supplier: { id: string } }
      if (managerCreated.supplier?.id) supplierIds.push(managerCreated.supplier.id)
      expect(managerCreate.status).toBe(201)

      const cashierList = await app.request('/api/suppliers', {
        headers: authedHeaders(cashierCookie),
      })
      expect(cashierList.status).toBe(403)

      const managerList = await app.request('/api/suppliers', {
        headers: authedHeaders(managerCookie),
      })
      expect(managerList.status).toBe(200)
    })

    it('creates, reads, updates, and archives through HTTP as an admin', async () => {
      const create = await app.request('/api/suppliers', {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ name: `HTTP Supplier ${suffix}`, paymentTermDays: 14 }),
      })
      expect(create.status).toBe(201)
      const createBody = (await create.json()) as { supplier: { id: string; code: string } }
      httpSupplierId = createBody.supplier.id
      supplierIds.push(httpSupplierId)
      expect(createBody.supplier.code).toMatch(/^SUP-\d{5}$/)

      const detail = await app.request(`/api/suppliers/${httpSupplierId}`, {
        headers: authedHeaders(managerCookie),
      })
      expect(detail.status).toBe(200)

      const update = await app.request(`/api/suppliers/${httpSupplierId}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ notes: 'Preferred at the counter' }),
      })
      expect(update.status).toBe(200)

      const managerUpdate = await app.request(`/api/suppliers/${httpSupplierId}`, {
        method: 'PATCH',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ notes: 'Nope' }),
      })
      expect(managerUpdate.status).toBe(403)

      const managerArchive = await app.request(`/api/suppliers/${httpSupplierId}/archive`, {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({}),
      })
      expect(managerArchive.status).toBe(403)

      const archive = await app.request(`/api/suppliers/${httpSupplierId}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ note: 'Clean close' }),
      })
      expect(archive.status).toBe(200)

      const reactivate = await app.request(`/api/suppliers/${httpSupplierId}/reactivate`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(reactivate.status).toBe(200)
    })

    it('validates bodies and params', async () => {
      const invalidBody = await app.request('/api/suppliers', {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({}),
      })
      expect(invalidBody.status).toBe(400)

      const invalidId = await app.request('/api/suppliers/not-a-uuid', {
        headers: authedHeaders(adminCookie),
      })
      expect(invalidId.status).toBe(400)

      const missing = await app.request('/api/suppliers/00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ name: 'X' }),
      })
      expect(missing.status).toBe(404)

      const foreignField = await app.request(`/api/suppliers/${httpSupplierId}/payment-details`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({
          method: 'BANK',
          accountName: 'Desk',
          accountNumber: '555444333',
          bankName: 'GCB Bank',
          momoNetwork: 'MTN',
        }),
      })
      expect(foreignField.status).toBe(400)
    })

    it('saves payment details with masked list exposure and duplicate guards', async () => {
      const created = await app.request(`/api/suppliers/${httpSupplierId}/payment-details`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({
          method: 'BANK',
          accountName: 'Desk',
          accountNumber: '998877665544',
          bankName: 'GCB Bank',
        }),
      })
      expect(created.status).toBe(201)
      const createdBody = (await created.json()) as {
        paymentDetail: { id: string; accountNumber: string; accountNumberMasked: string }
      }
      httpDetailId = createdBody.paymentDetail.id
      detailIds.push(httpDetailId)
      expect(createdBody.paymentDetail.accountNumber).toBe('998877665544')
      expect(createdBody.paymentDetail.accountNumberMasked).toBe('•••• 5544')

      const duplicate = await app.request(`/api/suppliers/${httpSupplierId}/payment-details`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({
          method: 'BANK',
          accountName: 'Desk',
          accountNumber: '998877665544',
          bankName: 'GCB Bank',
        }),
      })
      expect(duplicate.status).toBe(409)

      const detail = await app.request(
        `/api/suppliers/${httpSupplierId}/payment-details/${httpDetailId}`,
        {
          method: 'PATCH',
          headers: authedHeaders(adminCookie),
          body: JSON.stringify({ label: 'Main account' }),
        },
      )
      expect(detail.status).toBe(200)
    })

    it('links products through HTTP with duplicate and unknown-product guards', async () => {
      const created = await app.request(`/api/suppliers/${httpSupplierId}/products`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ productId: productBId, supplierSku: 'HTTP-1' }),
      })
      expect(created.status).toBe(201)
      const createdBody = (await created.json()) as { mapping: { id: string } }
      mappingIds.push(createdBody.mapping.id)

      const duplicate = await app.request(`/api/suppliers/${httpSupplierId}/products`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ productId: productBId }),
      })
      expect(duplicate.status).toBe(409)

      const unknown = await app.request(`/api/suppliers/${httpSupplierId}/products`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ productId: '00000000-0000-0000-0000-000000000000' }),
      })
      expect(unknown.status).toBe(404)

      const removed = await app.request(
        `/api/suppliers/${httpSupplierId}/products/${createdBody.mapping.id}`,
        { method: 'DELETE', headers: authedHeaders(adminCookie) },
      )
      expect(removed.status).toBe(204)
    })
  })
})
