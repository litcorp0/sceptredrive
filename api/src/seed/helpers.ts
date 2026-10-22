import { randomUUID } from 'node:crypto'
import { db } from '@gikautos/db'
import { averageCostAfterReceipt, taxBreakdown } from '@gikautos/shared'
import { hash, type Options } from '@node-rs/argon2'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { brand, category, uom } from '../modules/catalog/catalog.schema.ts'
import { creditLedgerEntry, creditProfile } from '../modules/credit/credit.schema.ts'
import { customer } from '../modules/customers/customers.schema.ts'
import { account, user } from '../modules/identity/staff.schema.ts'
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockReceiptLine,
  stockThreshold,
} from '../modules/inventory/inventory.schema.ts'
import {
  loyaltyAccount,
  loyaltyLedgerEntry,
  loyaltyLot,
} from '../modules/loyalty/loyalty.schema.ts'
import { branch } from '../modules/org/branches.schema.ts'
import { terminal } from '../modules/org/terminals.schema.ts'
import {
  supplierInvoice,
  supplierInvoiceLine,
  supplierPayment,
  supplierPaymentAllocation,
} from '../modules/payables/payables.schema.ts'
import { setting } from '../modules/platform/settings.schema.ts'
import { barcode, product, productPrice } from '../modules/products/products.schema.ts'
import {
  supplier,
  supplierPaymentDetail,
  supplierProduct,
} from '../modules/suppliers/suppliers.schema.ts'

type SeedRole = 'ADMIN' | 'MANAGER' | 'CASHIER'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const ARGON2ID = 2

/** Must stay in step with the API's Argon2 parameters. */
export const argon2Options: Options = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
  algorithm: ARGON2ID,
}

export function hashSeedPassword(password: string): Promise<string> {
  return hash(password, argon2Options)
}

export async function findUserByEmail(email: string) {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1)
  return rows[0] ?? null
}

export interface SeedUserInput {
  email: string
  name: string
  password: string
  role: SeedRole
  branchId?: string | null
  phone?: string | null
  mustChangePassword: boolean
}

export async function createUserWithCredential(
  tx: Tx,
  input: SeedUserInput,
): Promise<{ id: string; staffId: string }> {
  const staffId = await allocateStaffId(tx)
  const userId = randomUUID()
  const passwordHash = await hashSeedPassword(input.password)

  await tx.insert(user).values({
    id: userId,
    email: input.email.toLowerCase(),
    name: input.name,
    emailVerified: false,
    role: input.role,
    branchId: input.branchId ?? null,
    staffId,
    phone: input.phone ?? null,
    isActive: true,
    mustChangePassword: input.mustChangePassword,
  })

  await tx.insert(account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: passwordHash,
  })

  return { id: userId, staffId }
}

export async function allocateStaffId(tx: Tx): Promise<string> {
  const prefix = process.env.STAFF_ID_PREFIX?.trim() || 'GA'
  const start = Number.parseInt(process.env.STAFF_ID_START ?? '1', 10) || 1

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await tx
      .select({ id: setting.id, value: setting.value })
      .from(setting)
      .where(and(eq(setting.key, 'staff.idSequence'), isNull(setting.branchId)))
      .limit(1)
      .for('update')

    const row = rows[0]
    if (!row) {
      try {
        await tx.insert(setting).values({ key: 'staff.idSequence', value: start })
        continue
      } catch {
        continue
      }
    }

    const current = typeof row.value === 'number' && row.value > 0 ? row.value : start
    await tx
      .update(setting)
      .set({ value: current + 1 })
      .where(eq(setting.id, row.id))
    return `${prefix}-${String(current).padStart(4, '0')}`
  }

  throw new Error('Could not allocate a staff identifier')
}

export async function ensureSetting(key: string, value: unknown): Promise<boolean> {
  const existing = await db
    .select({ id: setting.id })
    .from(setting)
    .where(and(eq(setting.key, key), isNull(setting.branchId)))
    .limit(1)
  if (existing[0]) return false

  await db.insert(setting).values({ key, value, updatedBy: 'seed' }).onConflictDoNothing()
  return true
}

export async function ensureBranch(input: {
  code: string
  name: string
  type: 'RETAIL' | 'WAREHOUSE'
  city: string
  area?: string
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: branch.id })
    .from(branch)
    .where(eq(branch.code, input.code))
    .limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(branch)
    .values({
      code: input.code,
      name: input.name,
      type: input.type,
      city: input.city,
      area: input.area ?? null,
      createdBy: 'seed',
    })
    .onConflictDoNothing()
    .returning({ id: branch.id })

  if (rows[0]) return { id: rows[0].id, created: true }

  const raced = await db
    .select({ id: branch.id })
    .from(branch)
    .where(eq(branch.code, input.code))
    .limit(1)
  if (!raced[0]) throw new Error(`Could not create branch ${input.code}`)
  return { id: raced[0].id, created: false }
}

export async function ensureTerminal(input: {
  branchId: string
  code: string
  name: string
}): Promise<boolean> {
  const existing = await db
    .select({ id: terminal.id })
    .from(terminal)
    .where(eq(terminal.code, input.code))
    .limit(1)
  if (existing[0]) return false

  await db
    .insert(terminal)
    .values({
      branchId: input.branchId,
      code: input.code,
      name: input.name,
      createdBy: 'seed',
    })
    .onConflictDoNothing()
  return true
}

export async function ensureUom(input: {
  code: string
  name: string
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: uom.id })
    .from(uom)
    .where(eq(uom.code, input.code))
    .limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(uom)
    .values({ code: input.code, name: input.name, createdBy: 'seed' })
    .onConflictDoNothing()
    .returning({ id: uom.id })
  if (rows[0]) return { id: rows[0].id, created: true }

  const raced = await db.select({ id: uom.id }).from(uom).where(eq(uom.code, input.code)).limit(1)
  if (!raced[0]) throw new Error(`Could not create unit ${input.code}`)
  return { id: raced[0].id, created: false }
}

export async function ensureBrand(input: {
  name: string
}): Promise<{ id: string; created: boolean }> {
  const nameFilter = sql`lower(${brand.name}) = ${input.name.toLowerCase()}`
  const existing = await db.select({ id: brand.id }).from(brand).where(nameFilter).limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(brand)
    .values({ name: input.name, createdBy: 'seed' })
    .onConflictDoNothing()
    .returning({ id: brand.id })
  if (rows[0]) return { id: rows[0].id, created: true }

  const raced = await db.select({ id: brand.id }).from(brand).where(nameFilter).limit(1)
  if (!raced[0]) throw new Error(`Could not create brand ${input.name}`)
  return { id: raced[0].id, created: false }
}

export async function ensureCategory(input: {
  name: string
  parentId?: string | null
}): Promise<{ id: string; created: boolean }> {
  const nameFilter = sql`lower(${category.name}) = ${input.name.toLowerCase()}`
  const existing = await db.select({ id: category.id }).from(category).where(nameFilter).limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(category)
    .values({ name: input.name, parentId: input.parentId ?? null, createdBy: 'seed' })
    .onConflictDoNothing()
    .returning({ id: category.id })
  if (rows[0]) return { id: rows[0].id, created: true }

  const raced = await db.select({ id: category.id }).from(category).where(nameFilter).limit(1)
  if (!raced[0]) throw new Error(`Could not create category ${input.name}`)
  return { id: raced[0].id, created: false }
}

export async function ensureProduct(input: {
  sku: string
  name: string
  description?: string
  categoryId: string
  brandId?: string | null
  uomId: string
  costPriceMinor: number
  basePriceMinor: number
  taxCategory?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'
  barcodes?: readonly string[]
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: product.id })
    .from(product)
    .where(eq(product.sku, input.sku))
    .limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(product)
    .values({
      sku: input.sku,
      name: input.name,
      description: input.description ?? null,
      categoryId: input.categoryId,
      brandId: input.brandId ?? null,
      uomId: input.uomId,
      costPriceMinor: input.costPriceMinor,
      basePriceMinor: input.basePriceMinor,
      taxCategory: input.taxCategory ?? 'STANDARD',
      createdBy: 'seed',
    })
    .onConflictDoNothing()
    .returning({ id: product.id })

  const createdId = rows[0]?.id
  if (!createdId) {
    const raced = await db
      .select({ id: product.id })
      .from(product)
      .where(eq(product.sku, input.sku))
      .limit(1)
    if (!raced[0]) throw new Error(`Could not create product ${input.sku}`)
    return { id: raced[0].id, created: false }
  }

  if (input.barcodes && input.barcodes.length > 0) {
    await db
      .insert(barcode)
      .values(input.barcodes.map((code) => ({ productId: createdId, code, createdBy: 'seed' })))
      .onConflictDoNothing()
  }

  return { id: createdId, created: true }
}

export async function ensureProductPrice(input: {
  productId: string
  branchId: string
  priceMinor: number
}): Promise<boolean> {
  const existing = await db
    .select({ id: productPrice.id })
    .from(productPrice)
    .where(
      and(eq(productPrice.productId, input.productId), eq(productPrice.branchId, input.branchId)),
    )
    .limit(1)
  if (existing[0]) return false

  await db
    .insert(productPrice)
    .values({
      productId: input.productId,
      branchId: input.branchId,
      priceMinor: input.priceMinor,
      updatedBy: 'seed',
    })
    .onConflictDoNothing()
  return true
}

export async function ensureSupplier(input: {
  code: string
  name: string
  contactName?: string
  phone?: string
  email?: string
  address?: string
  tin?: string
  vatNumber?: string
  paymentTermDays?: number
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: supplier.id })
    .from(supplier)
    .where(eq(supplier.code, input.code))
    .limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(supplier)
    .values({
      code: input.code,
      name: input.name,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      tin: input.tin ?? null,
      vatNumber: input.vatNumber ?? null,
      paymentTermDays: input.paymentTermDays ?? 0,
      createdBy: 'seed',
    })
    .onConflictDoNothing()
    .returning({ id: supplier.id })

  if (rows[0]) return { id: rows[0].id, created: true }

  const raced = await db
    .select({ id: supplier.id })
    .from(supplier)
    .where(eq(supplier.code, input.code))
    .limit(1)
  if (!raced[0]) throw new Error(`Could not create supplier ${input.code}`)
  return { id: raced[0].id, created: false }
}

export async function ensureSupplierPaymentDetail(input: {
  supplierId: string
  method: 'BANK' | 'MOMO'
  accountName: string
  accountNumber: string
  bankName?: string
  bankCode?: string
  momoNetwork?: 'MTN' | 'VOD' | 'ATL'
  phone?: string
  isDefault?: boolean
}): Promise<boolean> {
  const existing = await db
    .select({ id: supplierPaymentDetail.id })
    .from(supplierPaymentDetail)
    .where(
      and(
        eq(supplierPaymentDetail.supplierId, input.supplierId),
        eq(supplierPaymentDetail.method, input.method),
        eq(supplierPaymentDetail.accountNumber, input.accountNumber),
      ),
    )
    .limit(1)
  if (existing[0]) return false

  const rows = await db
    .insert(supplierPaymentDetail)
    .values({
      supplierId: input.supplierId,
      method: input.method,
      accountName: input.accountName,
      accountNumber: input.accountNumber,
      bankName: input.bankName ?? null,
      bankCode: input.bankCode ?? null,
      momoNetwork: input.momoNetwork ?? null,
      phone: input.phone ?? null,
      isDefault: input.isDefault ?? false,
      createdBy: 'seed',
    })
    .onConflictDoNothing()
    .returning({ id: supplierPaymentDetail.id })
  return Boolean(rows[0])
}

export async function ensureSupplierProduct(input: {
  supplierId: string
  productId: string
  supplierSku: string
  leadTimeDays?: number
  lastCostMinor?: number
  isPreferred?: boolean
}): Promise<boolean> {
  const existing = await db
    .select({ id: supplierProduct.id })
    .from(supplierProduct)
    .where(
      and(
        eq(supplierProduct.supplierId, input.supplierId),
        eq(supplierProduct.productId, input.productId),
      ),
    )
    .limit(1)
  if (existing[0]) return false

  const rows = await db
    .insert(supplierProduct)
    .values({
      supplierId: input.supplierId,
      productId: input.productId,
      supplierSku: input.supplierSku,
      leadTimeDays: input.leadTimeDays ?? null,
      lastCostMinor: input.lastCostMinor ?? 0,
      lastCostAt: input.lastCostMinor === undefined ? null : new Date(),
      isPreferred: input.isPreferred ?? false,
      createdBy: 'seed',
    })
    .onConflictDoNothing()
    .returning({ id: supplierProduct.id })
  return Boolean(rows[0])
}

export async function findStockReceiptId(number: string): Promise<string | null> {
  const rows = await db
    .select({ id: stockReceipt.id })
    .from(stockReceipt)
    .where(eq(stockReceipt.number, number))
    .limit(1)
  return rows[0]?.id ?? null
}

/**
 * Backfills the supplier link on receipts that carry a matching free-text
 * supplier name and no link yet. Idempotent; returns the number of rows linked.
 */
export async function linkReceiptSuppliers(map: Record<string, string>): Promise<number> {
  let linked = 0
  for (const [supplierName, supplierId] of Object.entries(map)) {
    const rows = await db
      .update(stockReceipt)
      .set({ supplierId })
      .where(and(eq(stockReceipt.supplierName, supplierName), isNull(stockReceipt.supplierId)))
      .returning({ id: stockReceipt.id })
    linked += rows.length
  }
  return linked
}

/**
 * Seeds an immutable opening-stock receipt (document + lines + movements +
 * level projection) in one transaction, mirroring the production posting rules.
 * Idempotent by receipt number; returns false when the receipt already exists.
 */
export async function ensureStockReceipt(input: {
  number: string
  branchId: string
  lines: readonly { productId: string; quantity: number; unitCostMinor: number }[]
  supplierId?: string
  supplierName?: string
  supplierInvoiceNumber?: string
  note?: string
  createdAt?: Date
}): Promise<boolean> {
  const existing = await db
    .select({ id: stockReceipt.id })
    .from(stockReceipt)
    .where(eq(stockReceipt.number, input.number))
    .limit(1)
  if (existing[0]) return false

  const createdAt = input.createdAt ?? new Date()

  return db.transaction(async (tx) => {
    const receiptRows = await tx
      .insert(stockReceipt)
      .values({
        number: input.number,
        branchId: input.branchId,
        supplierId: input.supplierId ?? null,
        supplierName: input.supplierName ?? null,
        supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
        note: input.note ?? null,
        createdBy: 'seed',
        createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: stockReceipt.id })

    const receipt = receiptRows[0]
    if (!receipt) return false

    const lines = [...input.lines].sort((a, b) => a.productId.localeCompare(b.productId))
    for (const line of lines) {
      await tx
        .insert(stockLevel)
        .values({ productId: line.productId, branchId: input.branchId })
        .onConflictDoNothing()

      const levelRows = await tx
        .select()
        .from(stockLevel)
        .where(
          and(eq(stockLevel.productId, line.productId), eq(stockLevel.branchId, input.branchId)),
        )
        .limit(1)
        .for('update')
      const level = levelRows[0]
      if (!level) throw new Error(`Could not lock stock level for ${line.productId}`)

      const avgCostMinor = averageCostAfterReceipt(
        level.avgCostMinor,
        level.quantityOnHand,
        line.unitCostMinor,
        line.quantity,
      )

      await tx
        .update(stockLevel)
        .set({
          quantityOnHand: level.quantityOnHand + line.quantity,
          avgCostMinor,
        })
        .where(eq(stockLevel.id, level.id))

      const movementRows = await tx
        .insert(stockMovement)
        .values({
          productId: line.productId,
          branchId: input.branchId,
          type: 'RECEIPT',
          quantityDelta: line.quantity,
          unitCostMinor: line.unitCostMinor,
          referenceType: 'RECEIPT',
          referenceId: receipt.id,
          referenceNumber: input.number,
          createdBy: 'seed',
          createdAt,
        })
        .returning({ id: stockMovement.id })
      const movement = movementRows[0]
      if (!movement) throw new Error('Could not insert stock movement')

      await tx.insert(stockReceiptLine).values({
        receiptId: receipt.id,
        productId: line.productId,
        quantity: line.quantity,
        unitCostMinor: line.unitCostMinor,
        movementId: movement.id,
      })
    }

    return true
  })
}

export async function ensureStockThreshold(input: {
  productId: string
  branchId: string
  threshold: number
}): Promise<boolean> {
  const existing = await db
    .select({ id: stockThreshold.id })
    .from(stockThreshold)
    .where(
      and(
        eq(stockThreshold.productId, input.productId),
        eq(stockThreshold.branchId, input.branchId),
      ),
    )
    .limit(1)
  if (existing[0]) return false

  await db
    .insert(stockThreshold)
    .values({
      productId: input.productId,
      branchId: input.branchId,
      threshold: input.threshold,
      updatedBy: 'seed',
    })
    .onConflictDoNothing()
  return true
}

/**
 * Seeds a supplier invoice with its lines, mirroring the production posting
 * rules. Line unit costs are tax-inclusive; when `tax` is `DERIVED` the split
 * is derived from the line sum with the shared Ghana engine, so
 * `subtotal + vat + nhil + getfund` equals the recorded line total exactly.
 * Idempotent by invoice number; returns the invoice id and total either way.
 */
export async function ensureSupplierInvoice(input: {
  number: string
  supplierId: string
  branchId: string
  supplierInvoiceNumber: string
  invoiceDate: string
  dueDate: string
  receiptId?: string | null
  lines: readonly {
    productId?: string | null
    description?: string | null
    quantity: number
    unitCostMinor: number
  }[]
  tax: 'DERIVED' | 'NONE'
  note?: string
}): Promise<{ id: string; totalMinor: number; created: boolean }> {
  const existing = await db
    .select({ id: supplierInvoice.id, totalMinor: supplierInvoice.totalMinor })
    .from(supplierInvoice)
    .where(eq(supplierInvoice.number, input.number))
    .limit(1)
  if (existing[0]) return { ...existing[0], created: false }

  const linesTotal = input.lines.reduce((sum, line) => sum + line.quantity * line.unitCostMinor, 0)
  let subtotalMinor = linesTotal
  let vatMinor = 0
  let nhilMinor = 0
  let getfundMinor = 0
  let totalMinor = linesTotal

  if (input.tax === 'DERIVED') {
    const breakdown = taxBreakdown(linesTotal, 'STANDARD', 'INCLUSIVE')
    subtotalMinor = breakdown.baseMinor
    vatMinor = breakdown.vatMinor
    nhilMinor = breakdown.nhilMinor
    getfundMinor = breakdown.getfundMinor
    totalMinor = breakdown.totalMinor
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(supplierInvoice)
      .values({
        number: input.number,
        supplierId: input.supplierId,
        branchId: input.branchId,
        supplierInvoiceNumber: input.supplierInvoiceNumber,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        receiptId: input.receiptId ?? null,
        subtotalMinor,
        vatMinor,
        nhilMinor,
        getfundMinor,
        totalMinor,
        note: input.note ?? null,
        createdBy: 'seed',
      })
      .onConflictDoNothing()
      .returning({ id: supplierInvoice.id })

    const header = rows[0]
    if (!header) {
      const raced = await tx
        .select({ id: supplierInvoice.id, totalMinor: supplierInvoice.totalMinor })
        .from(supplierInvoice)
        .where(eq(supplierInvoice.number, input.number))
        .limit(1)
      if (!raced[0]) throw new Error(`Could not create supplier invoice ${input.number}`)
      return { ...raced[0], created: false }
    }

    await tx.insert(supplierInvoiceLine).values(
      input.lines.map((line) => ({
        invoiceId: header.id,
        productId: line.productId ?? null,
        description: line.description ?? null,
        quantity: line.quantity,
        unitCostMinor: line.unitCostMinor,
        lineTotalMinor: line.quantity * line.unitCostMinor,
      })),
    )

    return { id: header.id, totalMinor, created: true }
  })
}

async function recomputeInvoicePaid(tx: Tx, invoiceId: string): Promise<void> {
  const sums = await tx
    .select({
      paid: sql<number>`coalesce(sum(${supplierPaymentAllocation.amountMinor}), 0)`.mapWith(Number),
    })
    .from(supplierPaymentAllocation)
    .where(eq(supplierPaymentAllocation.invoiceId, invoiceId))
  const paid = sums[0]?.paid ?? 0

  const rows = await tx
    .select({ totalMinor: supplierInvoice.totalMinor, status: supplierInvoice.status })
    .from(supplierInvoice)
    .where(eq(supplierInvoice.id, invoiceId))
    .limit(1)
  const invoice = rows[0]
  if (!invoice || invoice.status === 'VOID') return

  const status =
    paid <= 0
      ? ('OPEN' as const)
      : paid >= invoice.totalMinor
        ? ('PAID' as const)
        : ('PARTIAL' as const)
  await tx
    .update(supplierInvoice)
    .set({ amountPaidMinor: paid, status })
    .where(eq(supplierInvoice.id, invoiceId))
}

/**
 * Seeds a supplier payment with its APPLY allocations and refreshes each
 * touched invoice's paid projection. Idempotent by payment number.
 */
export async function ensureSupplierPayment(input: {
  number: string
  supplierId: string
  branchId: string
  method: 'CASH' | 'BANK' | 'MOMO'
  amountMinor: number
  paidAt: Date
  reference?: string
  allocations: readonly { invoiceId: string; amountMinor: number }[]
}): Promise<boolean> {
  const existing = await db
    .select({ id: supplierPayment.id })
    .from(supplierPayment)
    .where(eq(supplierPayment.number, input.number))
    .limit(1)
  if (existing[0]) return false

  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(supplierPayment)
      .values({
        number: input.number,
        supplierId: input.supplierId,
        branchId: input.branchId,
        method: input.method,
        amountMinor: input.amountMinor,
        paidAt: input.paidAt,
        reference: input.reference ?? null,
        createdBy: 'seed',
      })
      .onConflictDoNothing()
      .returning({ id: supplierPayment.id })

    const payment = rows[0]
    if (!payment) return false

    for (const allocation of input.allocations) {
      await tx.insert(supplierPaymentAllocation).values({
        paymentId: payment.id,
        invoiceId: allocation.invoiceId,
        kind: 'APPLY',
        amountMinor: allocation.amountMinor,
        createdBy: 'seed',
      })
      await recomputeInvoicePaid(tx, allocation.invoiceId)
    }

    return true
  })
}

export async function ensureSequenceAtLeast(key: string, value: number): Promise<boolean> {
  const rows = await db
    .select({ id: setting.id, value: setting.value })
    .from(setting)
    .where(and(eq(setting.key, key), isNull(setting.branchId)))
    .limit(1)
  const row = rows[0]

  if (!row) {
    await db.insert(setting).values({ key, value, updatedBy: 'seed' }).onConflictDoNothing()
    return true
  }

  const current = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : 0
  if (current >= value) return false

  await db.update(setting).set({ value, updatedBy: 'seed' }).where(eq(setting.id, row.id))
  return true
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}

/** Allocates the next `REP-…` repayment number through the settings sequence. */
async function allocateRepaymentNumber(tx: Tx): Promise<string> {
  const prefixRows = await tx
    .select({ value: setting.value })
    .from(setting)
    .where(and(eq(setting.key, 'credit.repaymentPrefix'), isNull(setting.branchId)))
    .limit(1)
  const prefix =
    typeof prefixRows[0]?.value === 'string' && prefixRows[0].value.length > 0
      ? prefixRows[0].value
      : 'REP'

  const rows = await tx
    .select({ id: setting.id, value: setting.value })
    .from(setting)
    .where(and(eq(setting.key, 'credit.repaymentSequence'), isNull(setting.branchId)))
    .limit(1)
    .for('update')

  const row = rows[0]
  if (!row) {
    await tx
      .insert(setting)
      .values({ key: 'credit.repaymentSequence', value: 2, updatedBy: 'seed' })
      .onConflictDoNothing()
    return `${prefix}-00001`
  }

  const current = typeof row.value === 'number' && row.value > 0 ? row.value : 1
  await tx
    .update(setting)
    .set({ value: current + 1 })
    .where(eq(setting.id, row.id))
  return `${prefix}-${String(current).padStart(5, '0')}`
}

/**
 * Seeds a global customer plus their loyalty account in one transaction.
 * Idempotent by phone (E.164); returns false when the customer already exists.
 */
export async function ensureCustomer(input: {
  name: string
  phone: string
  email?: string
  address?: string
  createdBranchId: string
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.phone, input.phone))
    .limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(customer)
      .values({
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        address: input.address ?? null,
        createdBranchId: input.createdBranchId,
        createdBy: 'seed',
      })
      .onConflictDoNothing()
      .returning({ id: customer.id })

    const row = rows[0]
    if (!row) {
      const raced = await tx
        .select({ id: customer.id })
        .from(customer)
        .where(eq(customer.phone, input.phone))
        .limit(1)
      if (!raced[0]) throw new Error(`Could not create customer ${input.phone}`)
      return { id: raced[0].id, created: false }
    }

    await tx.insert(loyaltyAccount).values({ customerId: row.id }).onConflictDoNothing()
    return { id: row.id, created: true }
  })
}

/**
 * Seeds a branch credit profile with an opening CHARGE and an optional CASH
 * REPAYMENT (sequenced `REP-…`), reconciling the balance projection exactly
 * like the production posting rules. Idempotent by customer+branch profile.
 */
export async function ensureCreditOpening(input: {
  customerId: string
  branchId: string
  limitMinor: number
  chargeMinor: number
  repaymentMinor?: number
  chargeDate?: Date
  repaymentDate?: Date
}): Promise<boolean> {
  const existing = await db
    .select({ id: creditProfile.id })
    .from(creditProfile)
    .where(
      and(
        eq(creditProfile.customerId, input.customerId),
        eq(creditProfile.branchId, input.branchId),
      ),
    )
    .limit(1)
  if (existing[0]) return false

  const repaymentMinor = input.repaymentMinor ?? 0
  const chargeDate = input.chargeDate ?? new Date()
  const repaymentDate = input.repaymentDate ?? new Date()

  return db.transaction(async (tx) => {
    const profileRows = await tx
      .insert(creditProfile)
      .values({
        customerId: input.customerId,
        branchId: input.branchId,
        limitMinor: input.limitMinor,
        createdBy: 'seed',
      })
      .onConflictDoNothing()
      .returning({ id: creditProfile.id })

    const profile = profileRows[0]
    if (!profile) return false

    await tx.insert(creditLedgerEntry).values({
      customerId: input.customerId,
      branchId: input.branchId,
      kind: 'CHARGE',
      amountMinor: input.chargeMinor,
      reasonCode: 'OPENING_BALANCE',
      note: 'Opening balance — migrated from previous books',
      referenceNumber: 'OPENING',
      occurredAt: chargeDate,
      createdBy: 'seed',
    })

    if (repaymentMinor > 0) {
      const number = await allocateRepaymentNumber(tx)
      await tx.insert(creditLedgerEntry).values({
        customerId: input.customerId,
        branchId: input.branchId,
        kind: 'REPAYMENT',
        amountMinor: -repaymentMinor,
        method: 'CASH',
        note: 'Opening repayment',
        referenceNumber: number,
        occurredAt: repaymentDate,
        createdBy: 'seed',
      })
    }

    await tx
      .update(creditProfile)
      .set({ balanceMinor: input.chargeMinor - repaymentMinor })
      .where(eq(creditProfile.id, profile.id))

    return true
  })
}

/**
 * Seeds an EARN entry with its lot (expiry months from the earn date) and
 * updates the balance projection. Idempotent by idempotency key.
 */
export async function ensureLoyaltyEarn(input: {
  customerId: string
  branchId: string
  points: number
  idempotencyKey: string
  occurredAt?: Date
  expiryMonths?: number
}): Promise<boolean> {
  const accountRows = await db
    .select({ id: loyaltyAccount.id })
    .from(loyaltyAccount)
    .where(eq(loyaltyAccount.customerId, input.customerId))
    .limit(1)
  const account = accountRows[0]
  if (!account) throw new Error(`Customer ${input.customerId} has no loyalty account`)

  const occurredAt = input.occurredAt ?? new Date()
  const expiresAt = addMonths(occurredAt, input.expiryMonths ?? 12)

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: loyaltyLedgerEntry.id })
      .from(loyaltyLedgerEntry)
      .where(
        and(
          eq(loyaltyLedgerEntry.accountId, account.id),
          eq(loyaltyLedgerEntry.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1)
    if (existing[0]) return false

    const entryRows = await tx
      .insert(loyaltyLedgerEntry)
      .values({
        accountId: account.id,
        customerId: input.customerId,
        branchId: input.branchId,
        kind: 'EARN',
        pointsDelta: input.points,
        reasonCode: 'GOODWILL',
        note: 'Demo welcome points',
        idempotencyKey: input.idempotencyKey,
        createdBy: 'seed',
        occurredAt,
      })
      .returning({ id: loyaltyLedgerEntry.id })

    const entry = entryRows[0]
    if (!entry) return false

    await tx.insert(loyaltyLot).values({
      accountId: account.id,
      earnEntryId: entry.id,
      points: input.points,
      remainingPoints: input.points,
      expiresAt,
    })

    await tx
      .update(loyaltyAccount)
      .set({ balancePoints: sql`${loyaltyAccount.balancePoints} + ${input.points}` })
      .where(eq(loyaltyAccount.id, account.id))

    return true
  })
}
