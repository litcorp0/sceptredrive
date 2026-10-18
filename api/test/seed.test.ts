import { db } from '@gikautos/db'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../src/app.ts'
import { brand, category, uom } from '../src/modules/catalog/catalog.schema.ts'
import { user as userTable } from '../src/modules/identity/staff.schema.ts'
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockReceiptLine,
  stockThreshold,
} from '../src/modules/inventory/inventory.schema.ts'
import { branch } from '../src/modules/org/branches.schema.ts'
import { terminal } from '../src/modules/org/terminals.schema.ts'
import { setting } from '../src/modules/platform/settings.schema.ts'
import { barcode, product, productPrice } from '../src/modules/products/products.schema.ts'
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
  'catalog.skuPrefix',
  'catalog.skuSequence',
  'pricing.taxMode',
  'inventory.receiptPrefix',
  'inventory.receiptSequence',
  'inventory.transferPrefix',
  'inventory.countPrefix',
]
const DEMO_SKUS = DEMO_PRODUCTS.map((item) => item.sku)
const DEMO_CATEGORY_NAMES = DEMO_CATEGORIES.flatMap((parent) => [parent.name, ...parent.children])
const DEMO_UOM_CODES = DEMO_UNITS.map((unit) => unit.code)

describe.skipIf(!available)('database seeds', () => {
  afterAll(async () => {
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
    await db
      .delete(category)
      .where(and(isNotNull(category.parentId), inArray(category.name, DEMO_CATEGORY_NAMES)))
    await db.delete(category).where(inArray(category.name, DEMO_CATEGORY_NAMES))
    await db.delete(brand).where(inArray(brand.name, [...DEMO_BRANDS]))
    await db.delete(uom).where(inArray(uom.code, DEMO_UOM_CODES))
    await db.delete(userTable).where(inArray(userTable.email, SEEDED_EMAILS))
    await db.delete(terminal).where(inArray(terminal.code, ['ACC-SPX-T01', 'ACC-WH1-T01']))
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
  })

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
  })
})
