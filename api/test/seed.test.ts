import { db } from '@gikautos/db'
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../src/app.ts'
import { brand, category, uom } from '../src/modules/catalog/catalog.schema.ts'
import { creditLedgerEntry, creditProfile } from '../src/modules/credit/credit.schema.ts'
import { customer } from '../src/modules/customers/customers.schema.ts'
import { user as userTable } from '../src/modules/identity/staff.schema.ts'
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockReceiptLine,
  stockThreshold,
} from '../src/modules/inventory/inventory.schema.ts'
import {
  loyaltyAccount,
  loyaltyLedgerEntry,
  loyaltyLot,
  loyaltyLotConsumption,
} from '../src/modules/loyalty/loyalty.schema.ts'
import { branch } from '../src/modules/org/branches.schema.ts'
import { terminal } from '../src/modules/org/terminals.schema.ts'
import {
  supplierInvoice,
  supplierInvoiceLine,
  supplierPayment,
  supplierPaymentAllocation,
} from '../src/modules/payables/payables.schema.ts'
import { setting } from '../src/modules/platform/settings.schema.ts'
import { barcode, product, productPrice } from '../src/modules/products/products.schema.ts'
import {
  supplier,
  supplierPaymentDetail,
  supplierProduct,
} from '../src/modules/suppliers/suppliers.schema.ts'
import { DEMO_BRANDS, DEMO_CATEGORIES, DEMO_PRODUCTS, DEMO_UNITS } from '../src/seed/demo.ts'
import { seedAdmin, seedDemo } from '../src/seed/index.ts'
import { databaseAvailable, signIn } from './integration.ts'

const available = await databaseAvailable()
if (!available) console.warn('[seed.test] database unavailable; integration tests skipped')

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@gikautos.test'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'test-admin-password-123'
const DEMO_MANAGER_EMAIL = 'manager@gikautos.local'
const DEMO_CASHIER_EMAIL = 'cashier@gikautos.local'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1234'
const SEEDED_EMAILS = [ADMIN_EMAIL, DEMO_MANAGER_EMAIL, DEMO_CASHIER_EMAIL]
const DEMO_SETTING_KEYS = [
  'staff.idPrefix',
  'receipt.header',
  'loyalty.earnPointsPerCedi',
  'loyalty.pointsPerCedi',
  'loyalty.expiryMonths',
  'loyalty.minimumRedeemPoints',
  'credit.repaymentPrefix',
  'credit.repaymentSequence',
  'catalog.skuPrefix',
  'catalog.skuSequence',
  'pricing.taxMode',
  'inventory.receiptPrefix',
  'inventory.receiptSequence',
  'inventory.transferPrefix',
  'inventory.countPrefix',
  'supplier.codeSequence',
  'payable.invoiceSequence',
  'payable.paymentSequence',
]
const DEMO_PHONES = ['+233241000001', '+233241000002', '+233241000003']
const DEMO_SKUS = DEMO_PRODUCTS.map((item) => item.sku)
const DEMO_CATEGORY_NAMES = DEMO_CATEGORIES.flatMap((parent) => [parent.name, ...parent.children])
const DEMO_UOM_CODES = DEMO_UNITS.map((unit) => unit.code)

describe.skipIf(!available)('database seeds', () => {
  afterAll(async () => {
    const demoSupplierRows = await db
      .select({ id: supplier.id })
      .from(supplier)
      .where(inArray(supplier.code, ['SUP-00001', 'SUP-00002']))
    const demoSupplierIds = demoSupplierRows.map((row) => row.id)

    if (demoSupplierIds.length > 0) {
      const demoInvoices = await db
        .select({ id: supplierInvoice.id })
        .from(supplierInvoice)
        .where(inArray(supplierInvoice.supplierId, demoSupplierIds))
      const demoPayments = await db
        .select({ id: supplierPayment.id })
        .from(supplierPayment)
        .where(inArray(supplierPayment.supplierId, demoSupplierIds))
      const invoiceIds = demoInvoices.map((row) => row.id)
      const paymentIds = demoPayments.map((row) => row.id)

      if (invoiceIds.length > 0 || paymentIds.length > 0) {
        await db
          .delete(supplierPaymentAllocation)
          .where(
            or(
              inArray(supplierPaymentAllocation.invoiceId, invoiceIds),
              inArray(supplierPaymentAllocation.paymentId, paymentIds),
            ),
          )
      }
      if (invoiceIds.length > 0) {
        await db
          .delete(supplierInvoiceLine)
          .where(inArray(supplierInvoiceLine.invoiceId, invoiceIds))
        await db.delete(supplierInvoice).where(inArray(supplierInvoice.id, invoiceIds))
      }
      if (paymentIds.length > 0) {
        await db.delete(supplierPayment).where(inArray(supplierPayment.id, paymentIds))
      }
      await db
        .delete(supplierPaymentDetail)
        .where(inArray(supplierPaymentDetail.supplierId, demoSupplierIds))
      await db.delete(supplierProduct).where(inArray(supplierProduct.supplierId, demoSupplierIds))
    }

    const demoProducts = await db
      .select({ id: product.id })
      .from(product)
      .where(inArray(product.sku, DEMO_SKUS))
    const productIds = demoProducts.map((row) => row.id)
    const demoBranches = await db
      .select({ id: branch.id })
      .from(branch)
      .where(inArray(branch.code, ['ACC-SPX', 'ACC-WH1']))
    const demoBranchIds = demoBranches.map((row) => row.id)
    const demoReceipts =
      demoBranchIds.length > 0
        ? await db
            .select({ id: stockReceipt.id })
            .from(stockReceipt)
            .where(inArray(stockReceipt.branchId, demoBranchIds))
        : []
    const receiptIds = demoReceipts.map((row) => row.id)
    if (receiptIds.length > 0) {
      await db.delete(stockReceiptLine).where(inArray(stockReceiptLine.receiptId, receiptIds))
    }
    if (productIds.length > 0) {
      await db.delete(stockMovement).where(inArray(stockMovement.productId, productIds))
      await db.delete(stockLevel).where(inArray(stockLevel.productId, productIds))
      await db.delete(stockThreshold).where(inArray(stockThreshold.productId, productIds))
      await db.delete(productPrice).where(inArray(productPrice.productId, productIds))
      await db.delete(barcode).where(inArray(barcode.productId, productIds))
      await db.delete(product).where(inArray(product.id, productIds))
    }
    if (receiptIds.length > 0) {
      await db.delete(stockReceipt).where(inArray(stockReceipt.id, receiptIds))
    }
    if (demoSupplierIds.length > 0) {
      await db.delete(supplier).where(inArray(supplier.id, demoSupplierIds))
    }
    await db
      .delete(category)
      .where(and(isNotNull(category.parentId), inArray(category.name, DEMO_CATEGORY_NAMES)))
    await db.delete(category).where(inArray(category.name, DEMO_CATEGORY_NAMES))
    await db.delete(brand).where(inArray(brand.name, [...DEMO_BRANDS]))
    await db.delete(uom).where(inArray(uom.code, DEMO_UOM_CODES))
    await db.delete(userTable).where(inArray(userTable.email, SEEDED_EMAILS))
    await db.delete(terminal).where(inArray(terminal.code, ['ACC-SPX-T01', 'ACC-WH1-T01']))

    const demoCustomers = await db
      .select({ id: customer.id })
      .from(customer)
      .where(inArray(customer.phone, DEMO_PHONES))
    const demoCustomerIds = demoCustomers.map((row) => row.id)
    if (demoCustomerIds.length > 0) {
      const accounts = await db
        .select({ id: loyaltyAccount.id })
        .from(loyaltyAccount)
        .where(inArray(loyaltyAccount.customerId, demoCustomerIds))
      const accountIds = accounts.map((row) => row.id)
      if (accountIds.length > 0) {
        const lots = await db
          .select({ id: loyaltyLot.id })
          .from(loyaltyLot)
          .where(inArray(loyaltyLot.accountId, accountIds))
        const entries = await db
          .select({ id: loyaltyLedgerEntry.id })
          .from(loyaltyLedgerEntry)
          .where(inArray(loyaltyLedgerEntry.accountId, accountIds))
        const lotIds = lots.map((row) => row.id)
        const entryIds = entries.map((row) => row.id)
        if (lotIds.length > 0 || entryIds.length > 0) {
          await db
            .delete(loyaltyLotConsumption)
            .where(
              or(
                inArray(loyaltyLotConsumption.lotId, lotIds),
                inArray(loyaltyLotConsumption.entryId, entryIds),
              ),
            )
        }
        if (lotIds.length > 0) {
          await db.delete(loyaltyLot).where(inArray(loyaltyLot.id, lotIds))
        }
        if (entryIds.length > 0) {
          await db.delete(loyaltyLedgerEntry).where(inArray(loyaltyLedgerEntry.id, entryIds))
        }
        await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.id, accountIds))
      }
      await db
        .delete(creditLedgerEntry)
        .where(inArray(creditLedgerEntry.customerId, demoCustomerIds))
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, demoCustomerIds))
      await db.delete(customer).where(inArray(customer.id, demoCustomerIds))
    }

    await db.delete(branch).where(inArray(branch.code, ['ACC-SPX', 'ACC-WH1']))
    await db.delete(setting).where(inArray(setting.key, DEMO_SETTING_KEYS))
  })

  it('creates the admin idempotently and the admin can sign in', async () => {
    const first = await seedAdmin()
    expect(first).toBe('created')

    const second = await seedAdmin()
    expect(second).toBe('skipped')

    const cookie = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD)
    expect(cookie.length).toBeGreaterThan(0)

    const sessionResponse = await app.request('/api/auth/get-session', {
      headers: { cookie },
    })
    const session = (await sessionResponse.json()) as { user?: { role?: string } } | null
    expect(session?.user?.role).toBe('ADMIN')
  }, 30_000)

  it('creates demo users, branches, terminals, and catalog idempotently', async () => {
    const first = await seedDemo()
    expect(first.created.length).toBeGreaterThan(0)

    const second = await seedDemo()
    expect(second.created).toEqual([])

    const managerRows = await db
      .select({ role: userTable.role, branchId: userTable.branchId })
      .from(userTable)
      .where(eq(userTable.email, DEMO_MANAGER_EMAIL))
    expect(managerRows[0]?.role).toBe('MANAGER')

    const branchRows = await db
      .select({ id: branch.id })
      .from(branch)
      .where(eq(branch.code, 'ACC-SPX'))
    expect(branchRows[0]?.id).toBe(managerRows[0]?.branchId)

    const cashierRows = await db
      .select({ role: userTable.role, mustChangePassword: userTable.mustChangePassword })
      .from(userTable)
      .where(eq(userTable.email, DEMO_CASHIER_EMAIL))
    expect(cashierRows[0]?.role).toBe('CASHIER')
    expect(cashierRows[0]?.mustChangePassword).toBe(true)

    const terminalRows = await db
      .select({ id: terminal.id, code: terminal.code })
      .from(terminal)
      .where(inArray(terminal.code, ['ACC-SPX-T01', 'ACC-WH1-T01']))
    expect(terminalRows).toHaveLength(1)
    expect(terminalRows[0]?.code).toBe('ACC-SPX-T01')

    const productRows = await db
      .select({ id: product.id })
      .from(product)
      .where(inArray(product.sku, DEMO_SKUS))
    expect(productRows).toHaveLength(DEMO_PRODUCTS.length)

    const productIds = productRows.map((row) => row.id)
    const barcodeRows = await db
      .select({ id: barcode.id })
      .from(barcode)
      .where(inArray(barcode.productId, productIds))
    expect(barcodeRows).toHaveLength(
      DEMO_PRODUCTS.reduce((sum, item) => sum + item.barcodes.length, 0),
    )

    const overrideRows = await db
      .select({ id: productPrice.id })
      .from(productPrice)
      .where(inArray(productPrice.productId, productIds))
    expect(overrideRows).toHaveLength(1)

    const managerCookie = await signIn(DEMO_MANAGER_EMAIL, DEMO_PASSWORD)
    expect(managerCookie.length).toBeGreaterThan(0)
  }, 30_000)

  it('seeds demo customers with reconciled credit and loyalty balances', async () => {
    const customerRows = await db
      .select({ id: customer.id, phone: customer.phone })
      .from(customer)
      .where(inArray(customer.phone, DEMO_PHONES))
    expect(customerRows).toHaveLength(3)

    const credit = customerRows.find((row) => row.phone === '+233241000001')
    const loyalty = customerRows.find((row) => row.phone === '+233241000002')
    if (!credit || !loyalty) throw new Error('demo customers were not seeded')

    const profiles = await db
      .select({
        limitMinor: creditProfile.limitMinor,
        balanceMinor: creditProfile.balanceMinor,
      })
      .from(creditProfile)
      .where(eq(creditProfile.customerId, credit.id))
    expect(profiles[0]?.limitMinor).toBe(50_000)
    expect(profiles[0]?.balanceMinor).toBe(6_000)

    const creditEntries = await db
      .select({
        amountMinor: creditLedgerEntry.amountMinor,
        referenceNumber: creditLedgerEntry.referenceNumber,
      })
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.customerId, credit.id))
    const ledgerSum = creditEntries.reduce((sum, row) => sum + row.amountMinor, 0)
    expect(ledgerSum).toBe(profiles[0]?.balanceMinor)
    // Seeded on a fresh database the repayment is REP-00001; in any case it
    // must carry a sequenced receipt number.
    expect(creditEntries.some((row) => /^REP-\d{5}$/.test(row.referenceNumber ?? ''))).toBe(true)

    const accounts = await db
      .select({ id: loyaltyAccount.id, balancePoints: loyaltyAccount.balancePoints })
      .from(loyaltyAccount)
      .where(eq(loyaltyAccount.customerId, loyalty.id))
    const account = accounts[0]
    if (!account) throw new Error('demo loyalty account was not seeded')
    expect(account.balancePoints).toBe(250)

    const lots = await db
      .select({ points: loyaltyLot.points, remainingPoints: loyaltyLot.remainingPoints })
      .from(loyaltyLot)
      .where(eq(loyaltyLot.accountId, account.id))
    expect(lots).toHaveLength(1)
    expect(lots[0]?.points).toBe(250)
    expect(lots[0]?.remainingPoints).toBe(account.balancePoints)
  })

  it('seeds demo suppliers with a reconciled payables story', async () => {
    const supplierRows = await db
      .select({ id: supplier.id, code: supplier.code })
      .from(supplier)
      .where(inArray(supplier.code, ['SUP-00001', 'SUP-00002']))
    expect(supplierRows).toHaveLength(2)

    const accraParts = supplierRows.find((row) => row.code === 'SUP-00001')
    if (!accraParts) throw new Error('demo supplier SUP-00001 was not seeded')

    const details = await db
      .select({ method: supplierPaymentDetail.method, isDefault: supplierPaymentDetail.isDefault })
      .from(supplierPaymentDetail)
      .where(eq(supplierPaymentDetail.supplierId, accraParts.id))
    expect(details.some((row) => row.method === 'BANK')).toBe(true)
    expect(details.filter((row) => row.isDefault)).toHaveLength(1)

    const receipts = await db
      .select({ supplierId: stockReceipt.supplierId })
      .from(stockReceipt)
      .where(inArray(stockReceipt.number, ['GRN-00001', 'GRN-00002']))
    expect(receipts.length).toBeGreaterThan(0)
    expect(receipts.every((row) => row.supplierId !== null)).toBe(true)

    const invoices = await db
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        subtotalMinor: supplierInvoice.subtotalMinor,
        vatMinor: supplierInvoice.vatMinor,
        nhilMinor: supplierInvoice.nhilMinor,
        getfundMinor: supplierInvoice.getfundMinor,
        totalMinor: supplierInvoice.totalMinor,
        amountPaidMinor: supplierInvoice.amountPaidMinor,
        status: supplierInvoice.status,
        receiptId: supplierInvoice.receiptId,
      })
      .from(supplierInvoice)
      .where(eq(supplierInvoice.supplierId, accraParts.id))
    const receiptInvoice = invoices.find((row) => row.number === 'SINV-00001')
    if (!receiptInvoice) throw new Error('demo invoice SINV-00001 was not seeded')
    if (!receiptInvoice.receiptId) throw new Error('SINV-00001 is not linked to a receipt')

    expect(
      receiptInvoice.subtotalMinor +
        receiptInvoice.vatMinor +
        receiptInvoice.nhilMinor +
        receiptInvoice.getfundMinor,
    ).toBe(receiptInvoice.totalMinor)

    const receiptTotals = await db
      .select({
        total:
          sql<number>`coalesce(sum(${stockReceiptLine.quantity} * ${stockReceiptLine.unitCostMinor}), 0)`.mapWith(
            Number,
          ),
      })
      .from(stockReceiptLine)
      .where(eq(stockReceiptLine.receiptId, receiptInvoice.receiptId))
    expect(receiptInvoice.totalMinor).toBe(receiptTotals[0]?.total ?? -1)

    expect(receiptInvoice.status).toBe('PARTIAL')

    const allocations = await db
      .select({
        total: sql<number>`coalesce(sum(${supplierPaymentAllocation.amountMinor}), 0)`.mapWith(
          Number,
        ),
      })
      .from(supplierPaymentAllocation)
      .where(eq(supplierPaymentAllocation.invoiceId, receiptInvoice.id))
    expect(receiptInvoice.amountPaidMinor).toBe(allocations[0]?.total ?? 0)
  })
})
