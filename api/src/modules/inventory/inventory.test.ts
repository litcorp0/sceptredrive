import { readFile } from 'node:fs/promises'
import { db } from '@sceptre/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { databaseAvailable, uniqueSuffix } from '../../../test/integration.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { branch } from '../org/branches.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { product } from '../products/products.schema.ts'
import * as productsService from '../products/products.service.ts'
import { findLevel } from './inventory.repository.ts'
import { stockLevel, stockMovement } from './inventory.schema.ts'
import * as inventory from './inventory.service.ts'

const available = await databaseAvailable()
if (!available) console.warn('[inventory.test] database unavailable; integration tests skipped')

const actor: AuditActor = {
  actorId: 'test-actor',
  actorStaffId: 'GA-TEST',
  ip: null,
  userAgent: null,
  requestId: null,
}

function first<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new Error('Fixture insert failed')
  return row
}

describe.skipIf(!available)('inventory ledger service', () => {
  const suffix = uniqueSuffix()
  const productIds: string[] = []
  let branchAId = ''
  let branchBId = ''
  let categoryId = ''
  let uomId = ''
  let productCounter = 0

  async function makeProduct(label: string): Promise<string> {
    productCounter += 1
    const rows = await db
      .insert(product)
      .values({
        sku: `INV-${suffix}-${productCounter}`,
        name: `Inventory ${label} ${suffix}`,
        categoryId,
        uomId,
        costPriceMinor: 0,
        basePriceMinor: 10_000,
      })
      .returning({ id: product.id })
    const id = first(rows).id
    productIds.push(id)
    return id
  }

  function receipt(
    productId: string,
    quantity: number,
    unitCostMinor: number,
    branchId = branchAId,
  ) {
    return inventory.postMovements(actor, [
      {
        productId,
        branchId,
        type: 'RECEIPT',
        quantityDelta: quantity,
        unitCostMinor,
        referenceType: 'RECEIPT',
        productName: 'test product',
      },
    ])
  }

  function outbound(productId: string, quantity: number, branchId = branchAId) {
    return inventory.postMovements(actor, [
      {
        productId,
        branchId,
        type: 'TRANSFER_OUT',
        quantityDelta: -quantity,
        referenceType: 'TRANSFER',
        productName: 'test product',
      },
    ])
  }

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values([
        { code: `INV-${suffix}-A`, name: `Inventory A ${suffix}`, type: 'RETAIL', city: 'Accra' },
        { code: `INV-${suffix}-B`, name: `Inventory B ${suffix}`, type: 'RETAIL', city: 'Accra' },
      ])
      .returning({ id: branch.id })
    branchAId = branches[0]?.id ?? ''
    branchBId = branches[1]?.id ?? ''

    const units = await db
      .insert(uom)
      .values({ code: `U${suffix}`.toUpperCase(), name: `Unit ${suffix}` })
      .returning({ id: uom.id })
    uomId = first(units).id

    const categories = await db
      .insert(category)
      .values({ name: `Inventory Cat ${suffix}` })
      .returning({ id: category.id })
    categoryId = first(categories).id
  })

  afterAll(async () => {
    if (productIds.length > 0) {
      await db.delete(stockMovement).where(inArray(stockMovement.productId, productIds))
      await db.delete(stockLevel).where(inArray(stockLevel.productId, productIds))
      await db.delete(product).where(inArray(product.id, productIds))
    }
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    const branchIds = [branchAId, branchBId].filter(Boolean)
    if (branchIds.length > 0) await db.delete(branch).where(inArray(branch.id, branchIds))
  })

  it('blends receipts with weighted average cost and keeps the invariant', async () => {
    const productId = await makeProduct('blend')

    await receipt(productId, 10, 4_500)
    await receipt(productId, 10, 5_500)

    const level = await findLevel(productId, branchAId)
    expect(level?.quantityOnHand).toBe(20)
    expect(level?.avgCostMinor).toBe(5_000)

    const movements = await db
      .select()
      .from(stockMovement)
      .where(eq(stockMovement.productId, productId))
    expect(movements).toHaveLength(2)
    expect(movements.map((row) => row.unitCostMinor).sort((a, b) => a - b)).toEqual([4_500, 5_500])

    const adjustment = await inventory.postMovements(actor, [
      {
        productId,
        branchId: branchAId,
        type: 'ADJUSTMENT',
        quantityDelta: -5,
        referenceType: 'ADJUSTMENT',
        reasonCode: 'DAMAGE',
        productName: 'test product',
      },
    ])
    expect(adjustment.movements[0]?.unitCostMinor).toBe(5_000)

    const after = await findLevel(productId, branchAId)
    expect(after?.quantityOnHand).toBe(15)
    expect(after?.avgCostMinor).toBe(5_000)

    expect(await inventory.reconcileBranch(branchAId)).toEqual([])
  })

  it('adopts the incoming cost when on hand is zero', async () => {
    const productId = await makeProduct('reset')

    await receipt(productId, 10, 5_000)
    await outbound(productId, 10)

    const empty = await findLevel(productId, branchAId)
    expect(empty?.quantityOnHand).toBe(0)
    expect(empty?.avgCostMinor).toBe(5_000)

    await receipt(productId, 5, 7_000)
    const restocked = await findLevel(productId, branchAId)
    expect(restocked?.quantityOnHand).toBe(5)
    expect(restocked?.avgCostMinor).toBe(7_000)
  })

  it('blocks negative stock and writes nothing when it refuses', async () => {
    const productId = await makeProduct('guard')

    await expect(outbound(productId, 1)).rejects.toMatchObject({ statusCode: 409 })

    const movements = await db
      .select()
      .from(stockMovement)
      .where(eq(stockMovement.productId, productId))
    expect(movements).toHaveLength(0)

    const level = await findLevel(productId, branchAId)
    expect(level?.quantityOnHand ?? 0).toBe(0)
  })

  it('rolls back the whole batch when one line fails', async () => {
    const goodProductId = await makeProduct('atomic-good')
    const emptyProductId = await makeProduct('atomic-empty')
    await receipt(goodProductId, 5, 1_000)

    await expect(
      inventory.postMovements(actor, [
        {
          productId: goodProductId,
          branchId: branchAId,
          type: 'TRANSFER_OUT',
          quantityDelta: -1,
          referenceType: 'TRANSFER',
        },
        {
          productId: emptyProductId,
          branchId: branchAId,
          type: 'TRANSFER_OUT',
          quantityDelta: -1,
          referenceType: 'TRANSFER',
        },
      ]),
    ).rejects.toMatchObject({ statusCode: 409 })

    const level = await findLevel(goodProductId, branchAId)
    expect(level?.quantityOnHand).toBe(5)
    const moves = await db
      .select()
      .from(stockMovement)
      .where(eq(stockMovement.productId, goodProductId))
    expect(moves.filter((row) => row.type === 'TRANSFER_OUT')).toHaveLength(0)
  })

  it('rejects duplicate products, zero deltas, and missing costs', async () => {
    const productId = await makeProduct('invalid')

    await expect(
      inventory.postMovements(actor, [
        {
          productId,
          branchId: branchAId,
          type: 'RECEIPT',
          quantityDelta: 1,
          unitCostMinor: 100,
          referenceType: 'RECEIPT',
        },
        {
          productId,
          branchId: branchAId,
          type: 'RECEIPT',
          quantityDelta: 1,
          unitCostMinor: 100,
          referenceType: 'RECEIPT',
        },
      ]),
    ).rejects.toMatchObject({ statusCode: 400 })

    await expect(
      inventory.postMovements(actor, [
        {
          productId,
          branchId: branchAId,
          type: 'ADJUSTMENT',
          quantityDelta: 0,
          referenceType: 'ADJUSTMENT',
          reasonCode: 'FOUND',
        },
      ]),
    ).rejects.toMatchObject({ statusCode: 400 })

    await expect(
      inventory.postMovements(actor, [
        {
          productId,
          branchId: branchAId,
          type: 'RECEIPT',
          quantityDelta: 1,
          referenceType: 'RECEIPT',
        },
      ]),
    ).rejects.toMatchObject({ statusCode: 400 })

    await expect(
      inventory.postMovements(actor, [
        {
          productId,
          branchId: branchAId,
          type: 'ADJUSTMENT',
          quantityDelta: 1,
          referenceType: 'ADJUSTMENT',
        },
      ]),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('serializes concurrent writers so the last unit sells once', async () => {
    const productId = await makeProduct('race')
    await receipt(productId, 1, 2_000)

    const results = await Promise.allSettled([outbound(productId, 1), outbound(productId, 1)])
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const level = await findLevel(productId, branchAId)
    expect(level?.quantityOnHand).toBe(0)

    const moves = await db
      .select()
      .from(stockMovement)
      .where(and(eq(stockMovement.productId, productId), eq(stockMovement.type, 'TRANSFER_OUT')))
    expect(moves).toHaveLength(1)
    expect(await inventory.reconcileBranch(branchAId)).toEqual([])
  })

  it('sums on-hand across branches from the ledger', async () => {
    const productId = await makeProduct('total')
    await receipt(productId, 3, 1_000, branchAId)
    await receipt(productId, 4, 1_000, branchBId)

    expect(await inventory.getOnHandTotal(productId)).toBe(7)
    expect((await findLevel(productId, branchAId))?.quantityOnHand).toBe(3)
    expect((await findLevel(productId, branchBId))?.quantityOnHand).toBe(4)
  })

  it('blocks archiving a product while stock remains', async () => {
    const productId = await makeProduct('archive')
    await receipt(productId, 2, 500)

    await expect(productsService.archiveProduct(actor, productId)).rejects.toMatchObject({
      statusCode: 409,
    })

    await outbound(productId, 2)
    const archived = await productsService.archiveProduct(actor, productId)
    expect(archived.isActive).toBe(false)

    await productsService.reactivateProduct(actor, productId)
  })

  it('has no movement update or delete path in the repository', async () => {
    const source = await readFile(new URL('./inventory.repository.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/update\(stockMovement\)|delete\(stockMovement\)/)
  })
})
