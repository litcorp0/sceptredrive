import { db } from '@sceptre/db'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { databaseAvailable } from '../../../test/integration.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { stockLevel } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { selectAttention, selectStockTotals } from './analytics.repository.ts'

const available = await databaseAvailable()

/**
 * 18-01/18-02: stock counts start from the catalogue, not from the level rows.
 *
 * The bug: a product with no `stock_level` row was invisible, so the inventory tab
 * reported `out_of_stock: 0` while the shelf was empty, and a low-stock count of 0
 * because no `stock_threshold` row existed either.
 */
describe.skipIf(!available)('stock counts', () => {
  let branchId = ''
  let categoryId = ''
  let uomId = ''
  let stockedId = ''
  let neverStockedId = ''

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values({
        code: `STK${Date.now().toString(36).toUpperCase()}`,
        name: 'Stock counts branch',
        type: 'RETAIL',
        city: 'Accra',
        createdBy: 'test',
      })
      .returning({ id: branch.id })
    branchId = branches[0]?.id ?? ''

    const categories = await db
      .insert(category)
      .values({ name: `Stock counts ${Date.now()}` })
      .returning({ id: category.id })
    categoryId = categories[0]?.id ?? ''

    const units = await db
      .insert(uom)
      .values({ code: `SU${Date.now().toString(36).slice(-5)}`, name: 'Piece' })
      .returning({ id: uom.id })
    uomId = units[0]?.id ?? ''

    const products = await db
      .insert(product)
      .values([
        {
          sku: `STK-${Date.now()}-A`,
          name: 'Stocked at two',
          categoryId,
          uomId,
          basePriceMinor: 5_000,
        },
        {
          sku: `STK-${Date.now()}-B`,
          name: 'Never stocked',
          categoryId,
          uomId,
          basePriceMinor: 5_000,
        },
      ])
      .returning({ id: product.id })
    stockedId = products[0]?.id ?? ''
    neverStockedId = products[1]?.id ?? ''

    await db.insert(stockLevel).values({
      productId: stockedId,
      branchId,
      quantityOnHand: 2,
      avgCostMinor: 1_000,
    })
  })

  afterAll(async () => {
    if (branchId) await db.delete(stockLevel).where(eq(stockLevel.branchId, branchId))
    const ids = [stockedId, neverStockedId].filter(Boolean)
    if (ids.length > 0) await db.delete(product).where(inArray(product.id, ids))
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    if (branchId) await db.delete(branch).where(eq(branch.id, branchId))
  })

  it('counts never-stocked products as out of stock, and low stock by the default five', async () => {
    const totals = await selectStockTotals(db, branchId)

    expect(totals.distinctProducts).toBe(2)
    expect(totals.unitsOnHand).toBe(2)
    // Two on hand is inside the default 5, so it is low — and not out of stock.
    expect(totals.lowStockCount).toBe(1)
    // The never-stocked product is the out-of-stock one.
    expect(totals.outOfStockCount).toBe(1)
    expect(totals.stockValueMinor).toBe(2_000)
  })

  it('reports the same two figures through the attention counts', async () => {
    const attention = await selectAttention(db, branchId)
    expect(attention.lowStockCount).toBe(1)
    expect(attention.outOfStockCount).toBe(1)
  })
})
