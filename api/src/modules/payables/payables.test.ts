import { db } from '@gikautos/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { databaseAvailable, randomToken, uniqueSuffix } from '../../../test/integration.ts'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockReceiptLine,
} from '../inventory/inventory.schema.ts'
import * as inventoryService from '../inventory/inventory.service.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import { product } from '../products/products.schema.ts'
import { supplier, supplierProduct } from '../suppliers/suppliers.schema.ts'
import * as suppliersService from '../suppliers/suppliers.service.ts'
import type { SupplierRow } from '../suppliers/suppliers.types.ts'
import * as payablesRepository from './payables.repository.ts'
import {
  supplierInvoice,
  supplierInvoiceLine,
  supplierPayment,
  supplierPaymentAllocation,
} from './payables.schema.ts'
import * as payablesService from './payables.service.ts'
import type { InvoiceCreateBody, InvoiceListQuery } from './payables.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[payables.test] database unavailable; integration tests skipped')

const actor: AuditActor = {
  actorId: 'test-actor',
  actorStaffId: 'GA-PAY',
  ip: null,
  userAgent: null,
  requestId: null,
}

function captureError(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(
    () => null,
    (error) => error,
  )
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

describe.skipIf(!available)('payables module', () => {
  const suffix = uniqueSuffix()
  const branchIds: string[] = []
  const categoryIds: string[] = []
  const uomIds: string[] = []
  const productIds: string[] = []
  const supplierIds: string[] = []
  const receiptIds: string[] = []
  const invoiceIds: string[] = []
  const paymentIds: string[] = []

  let branchAId = ''
  let branchBId = ''
  let productAId = ''
  let productBId = ''
  let productArchivedId = ''
  let managerA: SessionUser
  let managerB: SessionUser
  let admin: SessionUser
  let supplierCounter = 0

  function makeUser(overrides: Partial<SessionUser>): SessionUser {
    return {
      id: `user-${suffix}`,
      email: `user-${suffix}@gikautos.test`,
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

  async function createSupplier(
    overrides: { name?: string; paymentTermDays?: number } = {},
  ): Promise<SupplierRow> {
    supplierCounter += 1
    const created = await suppliersService.createSupplier(actor, {
      name: overrides.name ?? `Payable ${suffix} ${supplierCounter}`,
      paymentTermDays: overrides.paymentTermDays,
    })
    supplierIds.push(created.id)
    return created
  }

  async function createReceipt(input: {
    user: SessionUser
    branchId: string
    supplierId?: string
    supplierName?: string
    lines: { productId: string; quantity: number; unitCostMinor: number }[]
  }) {
    const receipt = await inventoryService.createReceipt(input.user, actor, {
      branchId: input.branchId,
      ...(input.supplierId ? { supplierId: input.supplierId } : {}),
      ...(input.supplierName ? { supplierName: input.supplierName } : {}),
      lines: input.lines,
    })
    receiptIds.push(receipt.id)
    return receipt
  }

  async function createInvoice(user: SessionUser, body: InvoiceCreateBody) {
    const result = await payablesService.createInvoice(user, actor, body)
    invoiceIds.push(result.invoice.invoice.id)
    return result
  }

  function listQuery(overrides: Partial<InvoiceListQuery> = {}): InvoiceListQuery {
    return { limit: 100, offset: 0, overdue: false, ...overrides }
  }

  beforeAll(async () => {
    // Skip the demo document numbers (SUP/GRN/SINV/PAY-00001/2) that seed
    // fixtures insert with explicit values into the shared test database.
    for (const key of [
      'supplier.codeSequence',
      'inventory.receiptSequence',
      'payable.invoiceSequence',
      'payable.paymentSequence',
    ] as const) {
      await allocateFromSequence(key, db)
      await allocateFromSequence(key, db)
    }

    const rows = await db
      .insert(branch)
      .values([
        {
          code: `PB-${randomToken()}A`,
          name: `Payables A ${suffix}`,
          type: 'RETAIL',
          city: 'Accra',
        },
        {
          code: `PB-${randomToken()}B`,
          name: `Payables B ${suffix}`,
          type: 'RETAIL',
          city: 'Kumasi',
        },
      ])
      .returning({ id: branch.id })
    branchAId = rows[0]?.id ?? ''
    branchBId = rows[1]?.id ?? ''
    branchIds.push(branchAId, branchBId)

    const categories = await db
      .insert(category)
      .values({ name: `Pay-${suffix}`, createdBy: 'test' })
      .returning({ id: category.id })
    const categoryId = categories[0]?.id ?? ''
    categoryIds.push(categoryId)

    const units = await db
      .insert(uom)
      .values({ code: `P${randomToken()}`, name: `Pay Unit ${suffix}`, createdBy: 'test' })
      .returning({ id: uom.id })
    const uomId = units[0]?.id ?? ''
    uomIds.push(uomId)

    async function createProduct(sku: string, isActive: boolean): Promise<string> {
      const created = await db
        .insert(product)
        .values({
          sku,
          name: `Pay Product ${sku}`,
          categoryId,
          uomId,
          costPriceMinor: 1_000,
          basePriceMinor: 2_000,
          isActive,
          createdBy: 'test',
        })
        .returning({ id: product.id })
      const id = created[0]?.id ?? ''
      productIds.push(id)
      return id
    }

    productAId = await createProduct(`PAY-${suffix}-A`, true)
    productBId = await createProduct(`PAY-${suffix}-B`, true)
    productArchivedId = await createProduct(`PAY-${suffix}-C`, false)

    managerA = makeUser({ role: 'MANAGER', branchId: branchAId })
    managerB = makeUser({ role: 'MANAGER', branchId: branchBId })
    admin = makeUser({ role: 'ADMIN', branchId: null })
  })

  afterAll(async () => {
    if (paymentIds.length > 0) {
      await db
        .delete(supplierPaymentAllocation)
        .where(inArray(supplierPaymentAllocation.paymentId, paymentIds))
      await db.delete(supplierPayment).where(inArray(supplierPayment.id, paymentIds))
    }
    if (invoiceIds.length > 0) {
      await db
        .delete(supplierPaymentAllocation)
        .where(inArray(supplierPaymentAllocation.invoiceId, invoiceIds))
      await db.delete(supplierInvoiceLine).where(inArray(supplierInvoiceLine.invoiceId, invoiceIds))
      await db.delete(supplierInvoice).where(inArray(supplierInvoice.id, invoiceIds))
    }
    if (receiptIds.length > 0) {
      await db.delete(stockReceiptLine).where(inArray(stockReceiptLine.receiptId, receiptIds))
      await db.delete(stockReceipt).where(inArray(stockReceipt.id, receiptIds))
    }
    if (productIds.length > 0) {
      await db.delete(stockMovement).where(inArray(stockMovement.productId, productIds))
      await db.delete(stockLevel).where(inArray(stockLevel.productId, productIds))
      await db.delete(supplierProduct).where(inArray(supplierProduct.productId, productIds))
    }
    if (supplierIds.length > 0) {
      await db.delete(supplier).where(inArray(supplier.id, supplierIds))
    }
    const auditIds = [...invoiceIds, ...receiptIds, ...supplierIds]
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

  it('records an invoice from a receipt whose tax split reconciles to the receipt total', async () => {
    const supplier = await createSupplier()
    const receipt = await createReceipt({
      user: managerA,
      branchId: branchAId,
      supplierId: supplier.id,
      lines: [
        { productId: productAId, quantity: 10, unitCostMinor: 1_000 },
        { productId: productBId, quantity: 5, unitCostMinor: 2_000 },
      ],
    })
    expect(receipt.totalCostMinor).toBe(20_000)

    // Mapped products learn their last cost from the invoice; unmapped stay alone.
    await suppliersService.addSupplierProduct(actor, supplier.id, { productId: productAId })

    const { invoice: detail, replayed } = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `APD-${suffix}-001`,
      invoiceDate: isoToday(),
      receiptId: receipt.id,
      copyFromReceipt: true,
    })

    expect(replayed).toBe(false)
    expect(detail.invoice.number).toMatch(/^SINV-\d{5}$/)
    expect(detail.invoice.status).toBe('OPEN')
    expect(detail.invoice.receiptId).toBe(receipt.id)
    expect(detail.invoice.totalMinor).toBe(receipt.totalCostMinor)
    expect(
      detail.invoice.subtotalMinor +
        detail.invoice.vatMinor +
        detail.invoice.nhilMinor +
        detail.invoice.getfundMinor,
    ).toBe(detail.invoice.totalMinor)
    expect(detail.invoice.dueDate).toBe(isoToday())
    expect(detail.invoice.outstandingMinor).toBe(detail.invoice.totalMinor)
    expect(detail.lines).toHaveLength(2)
    expect(detail.lines.map((line) => line.productId).sort()).toEqual(
      [productAId, productBId].sort(),
    )
    expect(detail.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0)).toBe(20_000)
    expect(detail.receipt).toEqual({
      id: receipt.id,
      number: receipt.number,
      branchId: branchAId,
    })
    expect(detail.supplier).toEqual({ id: supplier.id, code: supplier.code, name: supplier.name })
    expect(detail.allocations).toHaveLength(0)

    const receiptRows = await db
      .select({ supplierId: stockReceipt.supplierId, supplierName: stockReceipt.supplierName })
      .from(stockReceipt)
      .where(eq(stockReceipt.id, receipt.id))
    expect(receiptRows[0]?.supplierId).toBe(supplier.id)
    expect(receiptRows[0]?.supplierName).toBe(supplier.name)

    const costRows = await db
      .select({
        lastCostMinor: supplierProduct.lastCostMinor,
        lastCostAt: supplierProduct.lastCostAt,
      })
      .from(supplierProduct)
      .where(
        and(eq(supplierProduct.supplierId, supplier.id), eq(supplierProduct.productId, productAId)),
      )
    expect(costRows[0]?.lastCostMinor).toBe(1_000)
    expect(costRows[0]?.lastCostAt).not.toBeNull()

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, detail.invoice.id))
    expect(audits.map((row) => row.action)).toContain('supplier_invoice.created')
  })

  it('links a free-text receipt to the supplier master when invoiced from it', async () => {
    const supplier = await createSupplier()
    const vendorName = `Bare Vendor ${suffix}`
    const receipt = await createReceipt({
      user: managerA,
      branchId: branchAId,
      supplierName: vendorName,
      lines: [{ productId: productAId, quantity: 1, unitCostMinor: 5_000 }],
    })
    expect(receipt.supplierId).toBeNull()

    const { invoice: detail } = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `BAR-${suffix}`,
      invoiceDate: isoToday(),
      receiptId: receipt.id,
      copyFromReceipt: true,
    })

    expect(detail.invoice.totalMinor).toBe(5_000)
    expect(
      detail.invoice.subtotalMinor +
        detail.invoice.vatMinor +
        detail.invoice.nhilMinor +
        detail.invoice.getfundMinor,
    ).toBe(5_000)

    const receiptRows = await db
      .select({ supplierId: stockReceipt.supplierId, supplierName: stockReceipt.supplierName })
      .from(stockReceipt)
      .where(eq(stockReceipt.id, receipt.id))
    expect(receiptRows[0]?.supplierId).toBe(supplier.id)
    expect(receiptRows[0]?.supplierName).toBe(vendorName)
  })

  it('rejects double-invoicing a receipt and duplicate numbers with the existing id', async () => {
    const supplier = await createSupplier()
    const receiptA = await createReceipt({
      user: managerA,
      branchId: branchAId,
      supplierId: supplier.id,
      lines: [{ productId: productAId, quantity: 1, unitCostMinor: 1_000 }],
    })
    const receiptB = await createReceipt({
      user: managerA,
      branchId: branchAId,
      supplierId: supplier.id,
      lines: [{ productId: productAId, quantity: 2, unitCostMinor: 1_000 }],
    })

    const first = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `DUP-${suffix}`,
      invoiceDate: isoToday(),
      receiptId: receiptA.id,
      copyFromReceipt: true,
    })

    const doubleReceipt = await captureError(() =>
      payablesService.createInvoice(managerA, actor, {
        supplierId: supplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `DUP-${suffix}-B`,
        invoiceDate: isoToday(),
        receiptId: receiptA.id,
        copyFromReceipt: true,
      }),
    )
    expect(doubleReceipt).toBeInstanceOf(ConflictError)
    expect((doubleReceipt as ConflictError).details).toMatchObject({
      existingInvoiceId: first.invoice.invoice.id,
    })

    const duplicateNumber = await captureError(() =>
      payablesService.createInvoice(managerA, actor, {
        supplierId: supplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `DUP-${suffix}`,
        invoiceDate: isoToday(),
        receiptId: receiptB.id,
        copyFromReceipt: true,
      }),
    )
    expect(duplicateNumber).toBeInstanceOf(ConflictError)
    expect((duplicateNumber as ConflictError).details).toMatchObject({
      existingInvoiceId: first.invoice.invoice.id,
      number: first.invoice.invoice.number,
    })
  })

  it('records a standalone invoice with entered tax and defaults the due date from terms', async () => {
    const supplier = await createSupplier({ paymentTermDays: 14 })
    const { invoice: detail } = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `STD-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ productId: productAId, quantity: 3, unitCostMinor: 10_000 }],
      vatMinor: 4_500,
      nhilMinor: 750,
      getfundMinor: 750,
    })

    expect(detail.invoice.subtotalMinor).toBe(30_000)
    expect(detail.invoice.totalMinor).toBe(36_000)
    expect(detail.invoice.dueDate).toBe(addDaysToIsoDate(isoToday(), 14))
    expect(detail.lines[0]?.lineTotalMinor).toBe(30_000)
  })

  it('derives an INCLUSIVE split when tax fields are omitted and accepts service lines', async () => {
    const supplier = await createSupplier()
    const { invoice: detail } = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `SRV-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Freight to Kumasi', quantity: 1, unitCostMinor: 100_000 }],
    })

    expect(detail.invoice.totalMinor).toBe(100_000)
    expect(
      detail.invoice.subtotalMinor +
        detail.invoice.vatMinor +
        detail.invoice.nhilMinor +
        detail.invoice.getfundMinor,
    ).toBe(100_000)
    expect(detail.lines[0]?.productId).toBeNull()
    expect(detail.lines[0]?.description).toBe('Freight to Kumasi')
  })

  it('validates lines: archived products, duplicate products, and missing sources', async () => {
    const supplier = await createSupplier()

    const archived = await captureError(() =>
      payablesService.createInvoice(managerA, actor, {
        supplierId: supplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `BAD-${suffix}-1`,
        invoiceDate: isoToday(),
        lines: [{ productId: productArchivedId, quantity: 1, unitCostMinor: 100 }],
      }),
    )
    expect(archived).toBeInstanceOf(ConflictError)

    const duplicate = await captureError(() =>
      payablesService.createInvoice(managerA, actor, {
        supplierId: supplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `BAD-${suffix}-2`,
        invoiceDate: isoToday(),
        lines: [
          { productId: productAId, quantity: 1, unitCostMinor: 100 },
          { productId: productAId, quantity: 2, unitCostMinor: 100 },
        ],
      }),
    )
    expect(duplicate).toBeInstanceOf(ValidationError)

    const missing = await captureError(() =>
      payablesService.createInvoice(managerA, actor, {
        supplierId: supplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `BAD-${suffix}-3`,
        invoiceDate: isoToday(),
      }),
    )
    expect(missing).toBeInstanceOf(ValidationError)

    const badDue = await captureError(() =>
      payablesService.createInvoice(managerA, actor, {
        supplierId: supplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `BAD-${suffix}-4`,
        invoiceDate: isoToday(),
        dueDate: isoDaysAgo(1),
        lines: [{ description: 'x', quantity: 1, unitCostMinor: 100 }],
      }),
    )
    expect(badDue).toBeInstanceOf(ValidationError)
  })

  it('blocks archived suppliers, other branches for managers, and admins without a branch', async () => {
    const archivedSupplier = await createSupplier()
    await suppliersService.archiveSupplier(actor, archivedSupplier.id)
    const archived = await captureError(() =>
      payablesService.createInvoice(managerA, actor, {
        supplierId: archivedSupplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `ARC-${suffix}`,
        invoiceDate: isoToday(),
        lines: [{ description: 'x', quantity: 1, unitCostMinor: 100 }],
      }),
    )
    expect(archived).toBeInstanceOf(ConflictError)

    const supplier = await createSupplier()
    const crossBranch = await captureError(() =>
      payablesService.createInvoice(managerA, actor, {
        supplierId: supplier.id,
        branchId: branchBId,
        supplierInvoiceNumber: `XBR-${suffix}`,
        invoiceDate: isoToday(),
        lines: [{ description: 'x', quantity: 1, unitCostMinor: 100 }],
      }),
    )
    expect(crossBranch).toBeInstanceOf(ForbiddenError)

    const noBranch = await captureError(() =>
      payablesService.createInvoice(admin, actor, {
        supplierId: supplier.id,
        supplierInvoiceNumber: `NOB-${suffix}`,
        invoiceDate: isoToday(),
        lines: [{ description: 'x', quantity: 1, unitCostMinor: 100 }],
      }),
    )
    expect(noBranch).toBeInstanceOf(ValidationError)
  })

  it('is idempotent per branch and replays parallel same-key creates', async () => {
    const supplier = await createSupplier()
    const key = `key-${suffix}-1`
    const first = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `IDEM-${suffix}-A`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Service A', quantity: 1, unitCostMinor: 20_000 }],
      idempotencyKey: key,
    })

    const second = await payablesService.createInvoice(managerA, actor, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `IDEM-${suffix}-B`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Service B', quantity: 1, unitCostMinor: 30_000 }],
      idempotencyKey: key,
    })
    expect(second.replayed).toBe(true)
    expect(second.invoice.invoice.id).toBe(first.invoice.invoice.id)

    const raceKey = `key-${suffix}-2`
    const [left, right] = await Promise.all([
      payablesService.createInvoice(managerA, actor, {
        supplierId: supplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `RACE-${suffix}-A`,
        invoiceDate: isoToday(),
        lines: [{ description: 'Race A', quantity: 1, unitCostMinor: 1_000 }],
        idempotencyKey: raceKey,
      }),
      payablesService.createInvoice(managerA, actor, {
        supplierId: supplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `RACE-${suffix}-B`,
        invoiceDate: isoToday(),
        lines: [{ description: 'Race B', quantity: 1, unitCostMinor: 2_000 }],
        idempotencyKey: raceKey,
      }),
    ])
    expect(left.invoice.invoice.id).toBe(right.invoice.invoice.id)
    invoiceIds.push(left.invoice.invoice.id)

    const rows = await db
      .select({ id: supplierInvoice.id })
      .from(supplierInvoice)
      .where(
        and(eq(supplierInvoice.branchId, branchAId), eq(supplierInvoice.idempotencyKey, raceKey)),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(left.invoice.invoice.id)
  })

  it('voids untouched invoices, frees the number, and stays idempotent', async () => {
    const supplier = await createSupplier()
    const { invoice: detail } = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `VOID-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'To void', quantity: 1, unitCostMinor: 4_000 }],
    })

    const voided = await payablesService.voidInvoice(managerA, actor, detail.invoice.id, 'ERROR')
    expect(voided.status).toBe('VOID')
    expect(voided.voidReason).toBe('ERROR')

    const again = await payablesService.voidInvoice(managerA, actor, detail.invoice.id, 'ERROR')
    expect(again.status).toBe('VOID')

    const reuse = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `VOID-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Re-entry', quantity: 1, unitCostMinor: 4_000 }],
    })
    expect(reuse.invoice.invoice.id).not.toBe(detail.invoice.id)
    expect(reuse.invoice.invoice.number).not.toBe(detail.invoice.number)

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, detail.invoice.id))
    expect(audits.map((row) => row.action)).toContain('supplier_invoice.voided')
  })

  it('refuses to void invoices with payment allocations', async () => {
    const supplier = await createSupplier()
    const { invoice: detail } = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `ALLOC-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Allocated', quantity: 1, unitCostMinor: 6_000 }],
    })

    const payment = await payablesRepository.insertPayment({
      number: `PAY-${randomToken(6)}`,
      supplierId: supplier.id,
      branchId: branchAId,
      method: 'CASH',
      amountMinor: 6_000,
      paidAt: new Date(),
      createdBy: 'test',
    })
    if (!payment) throw new Error('payment fixture failed')
    paymentIds.push(payment.id)

    const allocation = await payablesRepository.insertAllocation({
      paymentId: payment.id,
      invoiceId: detail.invoice.id,
      kind: 'APPLY',
      amountMinor: 6_000,
    })
    if (!allocation) throw new Error('allocation fixture failed')

    const error = await captureError(() =>
      payablesService.voidInvoice(managerA, actor, detail.invoice.id, 'CANCELLED'),
    )
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({ netAllocatedMinor: 6_000 })
  })

  it('lists and reads invoices with branch scoping, filters, and overdue detection', async () => {
    const supplierB = await createSupplier()
    const branchBInvoice = await createInvoice(managerB, {
      supplierId: supplierB.id,
      supplierInvoiceNumber: `BRB-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Branch B service', quantity: 1, unitCostMinor: 2_500 }],
    })
    expect(branchBInvoice.invoice.invoice.branchId).toBe(branchBId)

    const adminList = await payablesService.listInvoices(admin, listQuery())
    expect(adminList.branchId).toBeNull()
    expect(adminList.invoices.some((row) => row.id === branchBInvoice.invoice.invoice.id)).toBe(
      true,
    )

    const managerAList = await payablesService.listInvoices(managerA, listQuery())
    expect(managerAList.branchId).toBe(branchAId)
    expect(managerAList.invoices.every((row) => row.branchId === branchAId)).toBe(true)
    expect(managerAList.invoices.some((row) => row.id === branchBInvoice.invoice.invoice.id)).toBe(
      false,
    )

    const filtered = await payablesService.listInvoices(
      managerB,
      listQuery({ supplierId: supplierB.id }),
    )
    expect(filtered.invoices.length).toBeGreaterThan(0)
    expect(filtered.invoices.every((row) => row.supplierId === supplierB.id)).toBe(true)

    const overdueSupplier = await createSupplier()
    const late = await createInvoice(managerA, {
      supplierId: overdueSupplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `LATE-${suffix}`,
      invoiceDate: isoDaysAgo(45),
      dueDate: isoDaysAgo(30),
      lines: [{ description: 'Late', quantity: 1, unitCostMinor: 1_000 }],
    })
    const current = await createInvoice(managerA, {
      supplierId: overdueSupplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `CURRENT-${suffix}`,
      invoiceDate: isoToday(),
      dueDate: addDaysToIsoDate(isoToday(), 10),
      lines: [{ description: 'Current', quantity: 1, unitCostMinor: 1_000 }],
    })

    const overdueList = await payablesService.listInvoices(
      managerA,
      listQuery({ overdue: true, supplierId: overdueSupplier.id }),
    )
    const overdueIds = overdueList.invoices.map((row) => row.id)
    expect(overdueIds).toContain(late.invoice.invoice.id)
    expect(overdueIds).not.toContain(current.invoice.invoice.id)

    const page = await payablesService.listInvoices(managerA, listQuery({ limit: 1, offset: 0 }))
    expect(page.invoices).toHaveLength(1)
    expect(page.total).toBeGreaterThanOrEqual(2)

    const detail = await payablesService.getInvoice(managerA, late.invoice.invoice.id)
    expect(detail.invoice.id).toBe(late.invoice.invoice.id)
    expect(detail.supplier.id).toBe(overdueSupplier.id)
    expect(detail.lines).toHaveLength(1)

    const crossBranch = await captureError(() =>
      payablesService.getInvoice(managerA, branchBInvoice.invoice.invoice.id),
    )
    expect(crossBranch).toBeInstanceOf(ForbiddenError)

    const missing = await captureError(() =>
      payablesService.getInvoice(managerA, '00000000-0000-0000-0000-000000000000'),
    )
    expect(missing).toBeInstanceOf(NotFoundError)
  })
})
