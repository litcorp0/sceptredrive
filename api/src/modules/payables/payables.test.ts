import { db } from '@sceptre/db'
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
import * as suppliersRepository from '../suppliers/suppliers.repository.ts'
import { supplier, supplierPaymentDetail, supplierProduct } from '../suppliers/suppliers.schema.ts'
import * as suppliersService from '../suppliers/suppliers.service.ts'
import type { SupplierRow } from '../suppliers/suppliers.types.ts'
import {
  supplierInvoice,
  supplierInvoiceLine,
  supplierPayment,
  supplierPaymentAllocation,
} from './payables.schema.ts'
import * as payablesService from './payables.service.ts'
import type {
  InvoiceCreateBody,
  InvoiceListQuery,
  PaymentCreateBody,
  PaymentListQuery,
} from './payables.types.ts'

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

  async function createPayment(user: SessionUser, body: PaymentCreateBody) {
    const result = await payablesService.createPayment(user, actor, body)
    paymentIds.push(result.payment.payment.id)
    return result
  }

  function paymentBody(
    overrides: Partial<PaymentCreateBody> & { supplierId: string; amountMinor: number },
  ): PaymentCreateBody {
    return {
      method: 'CASH',
      paidAt: new Date().toISOString(),
      ...overrides,
    }
  }

  function listQuery(overrides: Partial<InvoiceListQuery> = {}): InvoiceListQuery {
    return { limit: 100, offset: 0, overdue: false, variance: false, ...overrides }
  }

  function paymentListQuery(overrides: Partial<PaymentListQuery> = {}): PaymentListQuery {
    return { limit: 100, offset: 0, ...overrides }
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
      await db
        .delete(supplierPaymentDetail)
        .where(inArray(supplierPaymentDetail.supplierId, supplierIds))
      await db.delete(supplier).where(inArray(supplier.id, supplierIds))
    }
    const auditIds = [...invoiceIds, ...receiptIds, ...paymentIds, ...supplierIds]
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

    const payment = await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        amountMinor: 6_000,
        allocations: [{ invoiceId: detail.invoice.id, amountMinor: 6_000 }],
      }),
    )
    expect(payment.payment.payment.id).toBeTruthy()

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

  it('records payments: full settlement, partial, multi-invoice, and on-account remainder', async () => {
    const supplier = await createSupplier()
    const makeInvoice = (label: string, amountMinor: number) =>
      createInvoice(managerA, {
        supplierId: supplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `${label}-${suffix}`,
        invoiceDate: isoToday(),
        lines: [{ description: label, quantity: 1, unitCostMinor: amountMinor }],
      })

    const full = await makeInvoice('PAY-FULL', 12_000)
    const partial = await makeInvoice('PAY-PART', 20_000)
    const multi = await makeInvoice('PAY-MULTI', 30_000)
    const multiTwo = await makeInvoice('PAY-MULTI2', 10_000)

    const fullPayment = await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        amountMinor: 12_000,
        allocations: [{ invoiceId: full.invoice.invoice.id, amountMinor: 12_000 }],
      }),
    )
    expect(fullPayment.replayed).toBe(false)
    expect(fullPayment.payment.payment.number).toMatch(/^PAY-\d{5}$/)
    expect(fullPayment.payment.allocatedMinor).toBe(12_000)
    expect(fullPayment.payment.unallocatedMinor).toBe(0)
    expect(fullPayment.payment.allocations).toHaveLength(1)
    expect(fullPayment.payment.allocations[0]).toMatchObject({
      invoiceId: full.invoice.invoice.id,
      invoiceNumber: full.invoice.invoice.number,
      kind: 'APPLY',
      amountMinor: 12_000,
    })

    const fullAfter = await payablesService.getInvoice(managerA, full.invoice.invoice.id)
    expect(fullAfter.invoice.status).toBe('PAID')
    expect(fullAfter.invoice.amountPaidMinor).toBe(12_000)
    expect(fullAfter.invoice.outstandingMinor).toBe(0)

    const partialPayment = await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        amountMinor: 8_000,
        allocations: [{ invoiceId: partial.invoice.invoice.id, amountMinor: 5_000 }],
      }),
    )
    expect(partialPayment.payment.allocatedMinor).toBe(5_000)
    expect(partialPayment.payment.unallocatedMinor).toBe(3_000)

    const partialAfter = await payablesService.getInvoice(managerA, partial.invoice.invoice.id)
    expect(partialAfter.invoice.status).toBe('PARTIAL')
    expect(partialAfter.invoice.amountPaidMinor).toBe(5_000)
    expect(partialAfter.invoice.outstandingMinor).toBe(15_000)

    const multiPayment = await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        method: 'BANK',
        amountMinor: 40_000,
        allocations: [
          { invoiceId: multi.invoice.invoice.id, amountMinor: 30_000 },
          { invoiceId: multiTwo.invoice.invoice.id, amountMinor: 10_000 },
        ],
      }),
    )
    expect(multiPayment.payment.allocations).toHaveLength(2)
    const multiAfter = await payablesService.getInvoice(managerA, multi.invoice.invoice.id)
    expect(multiAfter.invoice.status).toBe('PAID')
    const multiTwoAfter = await payablesService.getInvoice(managerA, multiTwo.invoice.invoice.id)
    expect(multiTwoAfter.invoice.status).toBe('PAID')

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, fullPayment.payment.payment.id))
    expect(audits.map((row) => row.action)).toContain('supplier_payment.created')
  })

  it('guards payment allocations: outstanding, supplier, VOID, duplicates, branch, and details', async () => {
    const supplier = await createSupplier()
    const otherSupplier = await createSupplier()

    const invoice = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `GUARD-A-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Guard A', quantity: 1, unitCostMinor: 9_000 }],
    })
    const second = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `GUARD-B-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Guard B', quantity: 1, unitCostMinor: 5_000 }],
    })
    const otherInvoice = await createInvoice(managerA, {
      supplierId: otherSupplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `GUARD-C-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Guard C', quantity: 1, unitCostMinor: 5_000 }],
    })
    const voidTarget = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `GUARD-D-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Guard D', quantity: 1, unitCostMinor: 4_000 }],
    })
    await payablesService.voidInvoice(managerA, actor, voidTarget.invoice.invoice.id, 'ERROR')

    const over = await captureError(() =>
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 10_000,
          allocations: [{ invoiceId: invoice.invoice.invoice.id, amountMinor: 9_001 }],
        }),
      ),
    )
    expect(over).toBeInstanceOf(ConflictError)
    expect((over as ConflictError).details).toMatchObject({
      invoiceId: invoice.invoice.invoice.id,
      outstandingMinor: 9_000,
    })

    const wrongSupplier = await captureError(() =>
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 1_000,
          allocations: [{ invoiceId: otherInvoice.invoice.invoice.id, amountMinor: 1_000 }],
        }),
      ),
    )
    expect(wrongSupplier).toBeInstanceOf(ConflictError)

    const voided = await captureError(() =>
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 1_000,
          allocations: [{ invoiceId: voidTarget.invoice.invoice.id, amountMinor: 1_000 }],
        }),
      ),
    )
    expect(voided).toBeInstanceOf(ConflictError)

    const duplicate = await captureError(() =>
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 1_000,
          allocations: [
            { invoiceId: invoice.invoice.invoice.id, amountMinor: 500 },
            { invoiceId: invoice.invoice.invoice.id, amountMinor: 500 },
          ],
        }),
      ),
    )
    expect(duplicate).toBeInstanceOf(ValidationError)

    const exceeds = await captureError(() =>
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 1_000,
          allocations: [
            { invoiceId: invoice.invoice.invoice.id, amountMinor: 600 },
            { invoiceId: second.invoice.invoice.id, amountMinor: 600 },
          ],
        }),
      ),
    )
    expect(exceeds).toBeInstanceOf(ValidationError)

    const branchBInvoice = await createInvoice(managerB, {
      supplierId: supplier.id,
      supplierInvoiceNumber: `GUARD-E-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Guard E', quantity: 1, unitCostMinor: 2_000 }],
    })
    const crossBranch = await captureError(() =>
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 1_000,
          allocations: [{ invoiceId: branchBInvoice.invoice.invoice.id, amountMinor: 1_000 }],
        }),
      ),
    )
    expect(crossBranch).toBeInstanceOf(ForbiddenError)

    const otherDetail = await suppliersService.addPaymentDetail(actor, otherSupplier.id, {
      method: 'MOMO',
      momoNetwork: 'MTN',
      phone: '+233241000055',
    })
    const wrongDetail = await captureError(() =>
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 1_000,
          paymentDetailId: otherDetail.id,
        }),
      ),
    )
    expect(wrongDetail).toBeInstanceOf(ConflictError)

    const detail = await suppliersService.addPaymentDetail(actor, supplier.id, {
      method: 'MOMO',
      momoNetwork: 'MTN',
      phone: '+233241000066',
    })
    await db
      .update(supplierPaymentDetail)
      .set({ isActive: false })
      .where(eq(supplierPaymentDetail.id, detail.id))
    const inactiveDetail = await captureError(() =>
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 1_000,
          paymentDetailId: detail.id,
        }),
      ),
    )
    expect(inactiveDetail).toBeInstanceOf(ConflictError)

    const future = await captureError(() =>
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 1_000,
          paidAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        }),
      ),
    )
    expect(future).toBeInstanceOf(ValidationError)
  })

  it('replays idempotent payments and never over-allocates under a parallel race', async () => {
    const supplier = await createSupplier()
    const invoice = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `RACE-PAY-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Race pay', quantity: 1, unitCostMinor: 10_000 }],
    })

    const key = `pay-key-${suffix}`
    const body = paymentBody({
      supplierId: supplier.id,
      branchId: branchAId,
      amountMinor: 10_000,
      allocations: [{ invoiceId: invoice.invoice.invoice.id, amountMinor: 10_000 }],
      idempotencyKey: key,
    })
    const first = await createPayment(managerA, body)
    const replay = await payablesService.createPayment(managerA, actor, body)
    expect(replay.replayed).toBe(true)
    expect(replay.payment.payment.id).toBe(first.payment.payment.id)

    const race = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `RACE-PAR-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Race parallel', quantity: 1, unitCostMinor: 6_000 }],
    })
    const results = await Promise.allSettled([
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 6_000,
          allocations: [{ invoiceId: race.invoice.invoice.id, amountMinor: 6_000 }],
        }),
      ),
      payablesService.createPayment(
        managerA,
        actor,
        paymentBody({
          supplierId: supplier.id,
          branchId: branchAId,
          amountMinor: 6_000,
          allocations: [{ invoiceId: race.invoice.invoice.id, amountMinor: 6_000 }],
        }),
      ),
    ])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError)
    for (const result of fulfilled) {
      if (result.status === 'fulfilled') paymentIds.push(result.value.payment.payment.id)
    }

    const after = await payablesService.getInvoice(managerA, race.invoice.invoice.id)
    expect(after.invoice.amountPaidMinor).toBe(6_000)
    expect(after.invoice.status).toBe('PAID')
  })

  it('voids payments with release rows, flips invoice status, and blocks re-voiding', async () => {
    const supplier = await createSupplier()
    const settled = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `VOIDPAY-A-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Settled', quantity: 1, unitCostMinor: 10_000 }],
    })
    const partial = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `VOIDPAY-B-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Partial', quantity: 1, unitCostMinor: 12_000 }],
    })

    const fullPayment = await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        amountMinor: 10_000,
        allocations: [{ invoiceId: settled.invoice.invoice.id, amountMinor: 10_000 }],
      }),
    )
    expect(
      (await payablesService.getInvoice(managerA, settled.invoice.invoice.id)).invoice.status,
    ).toBe('PAID')

    const partialPayment = await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        amountMinor: 7_000,
        allocations: [{ invoiceId: partial.invoice.invoice.id, amountMinor: 3_000 }],
      }),
    )
    expect(
      (await payablesService.getInvoice(managerA, partial.invoice.invoice.id)).invoice.status,
    ).toBe('PARTIAL')
    // outstanding 9,000 − on-account 4,000
    expect(await suppliersRepository.sumSupplierOwed(supplier.id)).toBe(5_000)

    const voidedPartial = await payablesService.voidPayment(
      managerA,
      actor,
      partialPayment.payment.payment.id,
      'RETURNED',
    )
    expect(voidedPartial.payment.status).toBe('VOID')
    expect(voidedPartial.payment.voidReason).toBe('RETURNED')
    expect(voidedPartial.allocatedMinor).toBe(0)
    expect(voidedPartial.unallocatedMinor).toBe(7_000)

    const partialAfter = await payablesService.getInvoice(managerA, partial.invoice.invoice.id)
    expect(partialAfter.invoice.status).toBe('OPEN')
    expect(partialAfter.invoice.amountPaidMinor).toBe(0)

    const releaseRows = voidedPartial.allocations.filter((row) => row.kind === 'RELEASE')
    expect(releaseRows).toHaveLength(1)
    expect(releaseRows[0]?.amountMinor).toBe(-3_000)
    expect(releaseRows[0]?.reversesAllocationId).toBe(partialPayment.payment.allocations[0]?.id)
    expect(releaseRows[0]?.invoiceNumber).toBe(partial.invoice.invoice.number)
    const signed = voidedPartial.allocations.reduce((sum, row) => sum + row.amountMinor, 0)
    expect(signed).toBe(0)
    expect(await suppliersRepository.sumSupplierOwed(supplier.id)).toBe(12_000)

    const reVoid = await captureError(() =>
      payablesService.voidPayment(managerA, actor, partialPayment.payment.payment.id, 'ERROR'),
    )
    expect(reVoid).toBeInstanceOf(ConflictError)

    const voidedFull = await payablesService.voidPayment(
      managerA,
      actor,
      fullPayment.payment.payment.id,
      'BANK_REVERSAL',
    )
    expect(voidedFull.payment.status).toBe('VOID')
    const settledAfter = await payablesService.getInvoice(managerA, settled.invoice.invoice.id)
    expect(settledAfter.invoice.status).toBe('OPEN')
    expect(settledAfter.invoice.amountPaidMinor).toBe(0)
    expect(await suppliersRepository.sumSupplierOwed(supplier.id)).toBe(22_000)

    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, partialPayment.payment.payment.id))
    expect(audits.map((row) => row.action)).toContain('supplier_payment.voided')
  })

  it('reads and lists payments with branch scoping, filters, and totals', async () => {
    const supplier = await createSupplier()
    const invoice = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `PAYLIST-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Paylist', quantity: 1, unitCostMinor: 8_000 }],
    })
    const cash = await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        amountMinor: 5_000,
        allocations: [{ invoiceId: invoice.invoice.invoice.id, amountMinor: 5_000 }],
      }),
    )
    const bank = await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        method: 'BANK',
        amountMinor: 2_000,
        reference: 'TRF-123',
        paidAt: `${isoDaysAgo(3)}T09:00:00.000Z`,
      }),
    )

    const detail = await payablesService.getPayment(managerA, cash.payment.payment.id)
    expect(detail.payment.number).toBe(cash.payment.payment.number)
    expect(detail.supplier.id).toBe(supplier.id)
    expect(detail.allocatedMinor).toBe(5_000)
    expect(detail.unallocatedMinor).toBe(0)
    expect(detail.allocations[0]?.invoiceNumber).toBe(invoice.invoice.invoice.number)
    expect(detail.allocations[0]?.supplierInvoiceNumber).toBe(`PAYLIST-${suffix}`)

    const managerList = await payablesService.listPayments(managerA, paymentListQuery())
    expect(managerList.branchId).toBe(branchAId)
    expect(managerList.payments.every((row) => row.branchId === branchAId)).toBe(true)
    const listed = managerList.payments.find((row) => row.id === cash.payment.payment.id)
    expect(listed?.allocatedMinor).toBe(5_000)
    expect(listed?.unallocatedMinor).toBe(0)
    const listedBank = managerList.payments.find((row) => row.id === bank.payment.payment.id)
    expect(listedBank?.allocatedMinor).toBe(0)
    expect(listedBank?.unallocatedMinor).toBe(2_000)

    const bankOnly = await payablesService.listPayments(
      managerA,
      paymentListQuery({ method: 'BANK' }),
    )
    expect(bankOnly.payments.some((row) => row.id === bank.payment.payment.id)).toBe(true)
    expect(bankOnly.payments.every((row) => row.method === 'BANK')).toBe(true)

    const recent = await payablesService.listPayments(
      managerA,
      paymentListQuery({ from: isoDaysAgo(1), to: isoToday() }),
    )
    const recentIds = recent.payments.map((row) => row.id)
    expect(recentIds).toContain(cash.payment.payment.id)
    expect(recentIds).not.toContain(bank.payment.payment.id)

    const supplierB = await createSupplier()
    const branchBPayment = await createPayment(
      managerB,
      paymentBody({ supplierId: supplierB.id, amountMinor: 1_500 }),
    )
    const adminList = await payablesService.listPayments(
      admin,
      paymentListQuery({ supplierId: supplierB.id }),
    )
    expect(adminList.branchId).toBeNull()
    expect(adminList.payments.map((row) => row.id)).toContain(branchBPayment.payment.payment.id)
    expect(adminList.total).toBeGreaterThanOrEqual(1)

    const crossBranchRead = await captureError(() =>
      payablesService.getPayment(managerA, branchBPayment.payment.payment.id),
    )
    expect(crossBranchRead).toBeInstanceOf(ForbiddenError)

    const crossBranchVoid = await captureError(() =>
      payablesService.voidPayment(managerA, actor, branchBPayment.payment.payment.id, 'ERROR'),
    )
    expect(crossBranchVoid).toBeInstanceOf(ForbiddenError)

    const page = await payablesService.listPayments(
      managerA,
      paymentListQuery({ limit: 1, offset: 0 }),
    )
    expect(page.payments).toHaveLength(1)
    expect(page.total).toBeGreaterThanOrEqual(2)
  })

  it('buckets payables aging by days past due with on-account kept separate', async () => {
    const supplier = await createSupplier()
    const asOf = '2026-10-01'
    const makeAgedInvoice = (label: string, dueOffset: number, amountMinor: number) =>
      createInvoice(managerA, {
        supplierId: supplier.id,
        branchId: branchAId,
        supplierInvoiceNumber: `${label}-${suffix}`,
        invoiceDate: addDaysToIsoDate(asOf, -120),
        dueDate: addDaysToIsoDate(asOf, dueOffset),
        lines: [{ description: label, quantity: 1, unitCostMinor: amountMinor }],
      })

    await makeAgedInvoice('AGE-CUR', 0, 1_000)
    await makeAgedInvoice('AGE-1-30', -1, 1_100)
    await makeAgedInvoice('AGE-31-60', -31, 1_200)
    await makeAgedInvoice('AGE-61-90', -61, 1_300)
    await makeAgedInvoice('AGE-OVER90', -91, 1_400)
    const settled = await makeAgedInvoice('AGE-PAID', -10, 2_000)
    await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        amountMinor: 2_000,
        allocations: [{ invoiceId: settled.invoice.invoice.id, amountMinor: 2_000 }],
      }),
    )
    await createPayment(
      managerA,
      paymentBody({ supplierId: supplier.id, branchId: branchAId, amountMinor: 5_000 }),
    )

    const aging = await payablesService.getAging(admin, { asOf, branchId: branchAId })
    const row = aging.suppliers.find((supplierRow) => supplierRow.supplierId === supplier.id)
    expect(row).toBeDefined()
    expect(row?.buckets).toEqual({
      current: 1_000,
      days1To30: 1_100,
      days31To60: 1_200,
      days61To90: 1_300,
      over90: 1_400,
    })
    expect(row?.totalOutstandingMinor).toBe(6_000)
    expect(row?.onAccountMinor).toBe(5_000)
    expect(row?.invoices).toHaveLength(5)
    expect(
      row?.invoices.find((invoiceRow) => invoiceRow.number === settled.invoice.invoice.number),
    ).toBeUndefined()
    expect(
      row?.invoices.find((invoiceRow) => invoiceRow.supplierInvoiceNumber === `AGE-1-30-${suffix}`)
        ?.daysPastDue,
    ).toBe(1)

    // Pure helper boundaries mirror the credit aging style.
    expect(payablesService.bucketPayableDaysPastDue(0)).toBe('current')
    expect(payablesService.bucketPayableDaysPastDue(1)).toBe('days1To30')
    expect(payablesService.bucketPayableDaysPastDue(30)).toBe('days1To30')
    expect(payablesService.bucketPayableDaysPastDue(31)).toBe('days31To60')
    expect(payablesService.bucketPayableDaysPastDue(60)).toBe('days31To60')
    expect(payablesService.bucketPayableDaysPastDue(61)).toBe('days61To90')
    expect(payablesService.bucketPayableDaysPastDue(90)).toBe('days61To90')
    expect(payablesService.bucketPayableDaysPastDue(91)).toBe('over90')

    // Totals are exactly the sum of the supplier rows.
    for (const key of ['current', 'days1To30', 'days31To60', 'days61To90', 'over90'] as const) {
      expect(aging.totals[key]).toBe(
        aging.suppliers.reduce((sum, supplierRow) => sum + supplierRow.buckets[key], 0),
      )
    }
    expect(aging.totalOnAccountMinor).toBe(
      aging.suppliers.reduce((sum, supplierRow) => sum + supplierRow.onAccountMinor, 0),
    )
    expect(aging.branchId).toBe(branchAId)

    // Managers are fixed to their branch; the supplier filter narrows to one row.
    const managerAging = await payablesService.getAging(managerA, { asOf })
    expect(managerAging.branchId).toBe(branchAId)
    expect(
      managerAging.suppliers.some((supplierRow) => supplierRow.supplierId === supplier.id),
    ).toBe(true)
    const filtered = await payablesService.getAging(admin, {
      asOf,
      branchId: branchAId,
      supplierId: supplier.id,
    })
    expect(filtered.suppliers.map((supplierRow) => supplierRow.supplierId)).toEqual([supplier.id])
  })

  it('summarizes supplier balances with on-account, overdue, and void awareness', async () => {
    const supplier = await createSupplier()
    const overdueInvoice = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `BAL-OVER-${suffix}`,
      invoiceDate: isoDaysAgo(10),
      dueDate: isoDaysAgo(5),
      lines: [{ description: 'Overdue', quantity: 1, unitCostMinor: 10_000 }],
    })
    await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `BAL-CUR-${suffix}`,
      invoiceDate: isoToday(),
      dueDate: addDaysToIsoDate(isoToday(), 5),
      lines: [{ description: 'Current', quantity: 1, unitCostMinor: 20_000 }],
    })

    const payment = await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        amountMinor: 8_000,
        allocations: [{ invoiceId: overdueInvoice.invoice.invoice.id, amountMinor: 5_000 }],
      }),
    )

    let result = await payablesService.listSupplierBalances(managerA, {})
    let row = result.balances.find((balance) => balance.supplierId === supplier.id)
    expect(result.branchId).toBe(branchAId)
    expect(row).toMatchObject({
      supplierId: supplier.id,
      supplierCode: supplier.code,
      branchId: branchAId,
      invoiceOutstandingMinor: 25_000,
      onAccountMinor: 3_000,
      owedMinor: 22_000,
      overdueMinor: 5_000,
      invoiceCount: 2,
    })

    await payablesService.voidPayment(managerA, actor, payment.payment.payment.id, 'BANK_REVERSAL')
    result = await payablesService.listSupplierBalances(managerA, {})
    row = result.balances.find((balance) => balance.supplierId === supplier.id)
    expect(row).toMatchObject({
      invoiceOutstandingMinor: 30_000,
      onAccountMinor: 0,
      owedMinor: 30_000,
      overdueMinor: 10_000,
      invoiceCount: 2,
    })

    // Admins may filter by branch; this supplier has no activity in branch B.
    const branchB = await payablesService.listSupplierBalances(admin, { branchId: branchBId })
    expect(branchB.branchId).toBe(branchBId)
    expect(branchB.balances.some((balance) => balance.supplierId === supplier.id)).toBe(false)
    const allBranches = await payablesService.listSupplierBalances(admin, {})
    expect(allBranches.branchId).toBeNull()
    expect(
      allBranches.balances.find((balance) => balance.supplierId === supplier.id)?.owedMinor,
    ).toBe(30_000)
  })

  it('reconciles invoice allocations and supplier balances, and detects drift', async () => {
    const supplier = await createSupplier()
    const invoiceA = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `REC-A-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Rec A', quantity: 1, unitCostMinor: 10_000 }],
    })
    const invoiceB = await createInvoice(managerA, {
      supplierId: supplier.id,
      branchId: branchAId,
      supplierInvoiceNumber: `REC-B-${suffix}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Rec B', quantity: 1, unitCostMinor: 7_500 }],
    })
    await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        amountMinor: 12_000,
        allocations: [
          { invoiceId: invoiceA.invoice.invoice.id, amountMinor: 6_000 },
          { invoiceId: invoiceB.invoice.invoice.id, amountMinor: 4_000 },
        ],
      }),
    )
    const duplicate = await createPayment(
      managerA,
      paymentBody({
        supplierId: supplier.id,
        branchId: branchAId,
        amountMinor: 3_000,
        allocations: [{ invoiceId: invoiceB.invoice.invoice.id, amountMinor: 3_000 }],
      }),
    )
    await payablesService.voidPayment(managerA, actor, duplicate.payment.payment.id, 'DUPLICATE')

    const result = await payablesService.reconcilePayables()
    expect(result.invoicesChecked).toBeGreaterThanOrEqual(2)
    expect(result.suppliersChecked).toBeGreaterThanOrEqual(1)

    // Falsifying a row directly is caught; the transaction rolls back.
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(supplierInvoice)
          .set({ amountPaidMinor: 1 })
          .where(eq(supplierInvoice.id, invoiceA.invoice.invoice.id))
        await payablesService.reconcilePayables(tx)
      }),
    ).rejects.toMatchObject({ code: 'PAYABLES_DRIFT' })
  })
})
