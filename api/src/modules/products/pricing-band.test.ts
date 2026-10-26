import { db } from '@sceptre/db'
import { priceBandBounds, withinPriceBand } from '@sceptre/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
  uniqueSuffix,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { approval } from '../approvals/approvals.schema.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { product, productPrice } from './products.schema.ts'
import { priceWriteConflict } from './products.service.ts'

/**
 * Plan 06: a manager may move a price 10%, and not 11%.
 *
 * The band is measured against the price the branch actually charges, exactly 10%
 * is inside and one pesewa beyond is not, and a price that moves further becomes a
 * request that applies once or refuses a stale approval (P12-D18 … P12-D20).
 */

const available = await databaseAvailable()
if (!available) console.warn('[pricing-band.test] database unavailable; integration tests skipped')

interface PriceResult {
  status: 'APPLIED' | 'PENDING_APPROVAL'
  priceMinor?: number
  approvalId?: string
}

interface ApprovalRecord {
  id: string
  type: string
  entityId: string | null
  branchId: string
  status: string
  requestedBy: string
  deciderRole: string
  deciderBranchId: string | null
  amountMinor: number | null
  payload: Record<string, unknown>
}

interface CreatedProduct {
  id: string
  sku: string
  name: string
  basePriceMinor: number
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe('priceBandBounds', () => {
  it('is the inclusive window withinPriceBand accepts', () => {
    expect(priceBandBounds(10_000, 10)).toEqual({ minMinor: 9_000, maxMinor: 11_000 })
    expect(withinPriceBand(10_000, 11_000, 10)).toBe(true)
    expect(withinPriceBand(10_000, 11_001, 10)).toBe(false)
    expect(withinPriceBand(10_000, 9_000, 10)).toBe(true)
    expect(withinPriceBand(10_000, 8_999, 10)).toBe(false)
  })
})

/**
 * The race itself is not driven: two concurrent transactions produce exactly one
 * `product_price_product_branch_unique` violation, but the database will not
 * promise which side loses or when. The mapping is what made the loser a 500, so
 * the mapping is what this proves.
 */
describe('priceWriteConflict', () => {
  function uniqueViolation(constraint: string) {
    return { code: '23505', constraint }
  }

  it('maps a concurrent branch-price write to a retryable 409', () => {
    const conflict = priceWriteConflict(uniqueViolation('product_price_product_branch_unique'))
    expect(conflict?.statusCode).toBe(409)
    expect(conflict?.message).toMatch(/price changed/i)
    expect(conflict?.message).toMatch(/retry/i)
  })

  it('keeps the existing 409 for a duplicate pending request', () => {
    const conflict = priceWriteConflict(uniqueViolation('approval_open_entity_unique'))
    expect(conflict?.statusCode).toBe(409)
    expect(conflict?.message).toBe(
      'A price change for this product is already waiting for a decision',
    )
  })

  it('reads a wrapped constraint and leaves other errors alone', () => {
    expect(
      priceWriteConflict({
        code: '23505',
        cause: { constraint: 'product_price_product_branch_unique' },
      })?.statusCode,
    ).toBe(409)
    expect(priceWriteConflict(uniqueViolation('some_other_unique'))).toBeNull()
    expect(priceWriteConflict({ code: '23503' })).toBeNull()
    expect(priceWriteConflict(new Error('boom'))).toBeNull()
  })
})

describe.skipIf(!available)('price band and price-change requests', () => {
  const createdProductIds: string[] = []
  const createdUserIds: string[] = []
  const createdBranchIds: string[] = []
  const suffix = uniqueSuffix()

  let adminCookie = ''
  let managerCookie = ''
  let managerBranchId = ''
  let otherBranchId = ''
  let categoryId = ''
  let uomId = ''

  async function createProduct(basePriceMinor: number): Promise<CreatedProduct> {
    const response = await app.request('/api/products', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        name: `Band ${suffix} ${randomToken(5)}`,
        categoryId,
        uomId,
        basePriceMinor,
      }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ product: CreatedProduct }>(response)
    createdProductIds.push(body.product.id)
    return body.product
  }

  async function setPrice(
    cookie: string,
    productId: string,
    branchId: string,
    priceMinor: number,
  ): Promise<Response> {
    return app.request(`/api/products/${productId}/prices`, {
      method: 'PUT',
      headers: authedHeaders(cookie),
      body: JSON.stringify({ branchId, priceMinor }),
    })
  }

  async function removePrice(
    cookie: string,
    productId: string,
    branchId: string,
  ): Promise<Response> {
    return app.request(`/api/products/${productId}/prices/${branchId}`, {
      method: 'DELETE',
      headers: authedHeaders(cookie),
    })
  }

  async function approvalRowsFor(productId: string): Promise<ApprovalRecord[]> {
    return (await db
      .select()
      .from(approval)
      .where(and(eq(approval.type, 'PRICE_CHANGE'), eq(approval.entityId, productId)))
      .orderBy(approval.requestedAt)) as unknown as ApprovalRecord[]
  }

  async function pendingApprovalFor(productId: string): Promise<ApprovalRecord> {
    const rows = await approvalRowsFor(productId)
    const pending = rows.filter((row) => row.status === 'PENDING')
    expect(pending).toHaveLength(1)
    const found = pending[0]
    if (!found) throw new Error('expected one pending price change')
    return found
  }

  async function decidePriceChange(
    cookie: string,
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
    reasonCode?: string,
  ): Promise<Response> {
    return app.request(`/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify(reasonCode ? { decision, reasonCode } : { decision }),
    })
  }

  async function overrideRow(
    productId: string,
    branchId: string,
  ): Promise<{ priceMinor: number } | null> {
    const rows = await db
      .select({ priceMinor: productPrice.priceMinor })
      .from(productPrice)
      .where(and(eq(productPrice.productId, productId), eq(productPrice.branchId, branchId)))
    return rows[0] ?? null
  }

  async function auditActions(productId: string) {
    return db
      .select({ action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'product'), eq(auditLog.entityId, productId)))
  }

  beforeAll(async () => {
    const branchRows = await db
      .insert(branch)
      .values([
        {
          code: `PB${randomToken(3)}A`,
          name: 'Price Band Branch',
          type: 'RETAIL',
          city: 'Accra',
          createdBy: 'test',
        },
        {
          code: `PB${randomToken(3)}B`,
          name: 'Price Band Other Branch',
          type: 'RETAIL',
          city: 'Kumasi',
          createdBy: 'test',
        },
      ])
      .returning({ id: branch.id })
    if (!branchRows[0] || !branchRows[1]) throw new Error('Could not create test branches')
    managerBranchId = branchRows[0].id
    otherBranchId = branchRows[1].id
    createdBranchIds.push(managerBranchId, otherBranchId)

    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: managerBranchId,
      name: 'Price Band Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const categoryRows = await db
      .insert(category)
      .values({ name: `Price Band Category ${suffix}`, createdBy: 'test' })
      .returning({ id: category.id })
    categoryId = categoryRows[0]?.id ?? ''

    const uomRows = await db
      .insert(uom)
      .values({ code: `PB${suffix.slice(0, 7)}`, name: `Price Band Unit ${suffix}` })
      .returning({ id: uom.id })
    uomId = uomRows[0]?.id ?? ''
  })

  afterAll(async () => {
    await db.delete(approval).where(inArray(approval.branchId, createdBranchIds))
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('measures the band against the branch price, not the base price', async () => {
    const created = await createProduct(10_000)
    const adminSet = await setPrice(adminCookie, created.id, managerBranchId, 8_000)
    expect(await readJson<PriceResult>(adminSet)).toMatchObject({ status: 'APPLIED' })

    // 9 000 is exactly 10% below the base but 12.5% above the 8 000 the branch
    // charges, so the request path is the only honest answer.
    const fromBranchPrice = await setPrice(managerCookie, created.id, managerBranchId, 9_000)
    expect(await readJson<PriceResult>(fromBranchPrice)).toMatchObject({
      status: 'PENDING_APPROVAL',
    })
    expect((await pendingApprovalFor(created.id)).payload).toMatchObject({
      currentPriceMinor: 8_000,
      proposedPriceMinor: 9_000,
    })
    expect((await overrideRow(created.id, managerBranchId))?.priceMinor).toBe(8_000)
  })

  it('applies exactly 10% and requests 10.01%', async () => {
    const inside = await createProduct(10_000)
    const applied = await setPrice(managerCookie, inside.id, managerBranchId, 11_000)
    expect(applied.status).toBe(200)
    expect(await readJson<PriceResult>(applied)).toEqual({
      status: 'APPLIED',
      priceMinor: 11_000,
    })
    expect((await overrideRow(inside.id, managerBranchId))?.priceMinor).toBe(11_000)
    expect(await approvalRowsFor(inside.id)).toHaveLength(0)

    const outside = await createProduct(10_000)
    const requested = await setPrice(managerCookie, outside.id, managerBranchId, 11_001)
    expect(requested.status).toBe(200)
    const result = await readJson<PriceResult>(requested)
    expect(result.status).toBe('PENDING_APPROVAL')
    expect(result.approvalId).toEqual(expect.any(String))
    // Nothing is written to product_price on the request path (P12-D19).
    expect(await overrideRow(outside.id, managerBranchId)).toBeNull()

    const pending = await pendingApprovalFor(outside.id)
    expect(pending.amountMinor).toBe(11_001)
    expect(pending.deciderRole).toBe('ADMIN')
    expect(pending.deciderBranchId).toBeNull()
    expect(pending.payload).toMatchObject({
      currentPriceMinor: 10_000,
      proposedPriceMinor: 11_001,
      bandPercent: 10,
      kind: 'SET',
    })

    const actions = await auditActions(outside.id)
    expect(actions.map((row) => row.action)).toContain('product.price.change_requested')
  })

  it('treats the band as symmetric: 10% below applies, 10.01% below requests', async () => {
    const inside = await createProduct(10_000)
    const applied = await setPrice(managerCookie, inside.id, managerBranchId, 9_000)
    expect(await readJson<PriceResult>(applied)).toEqual({ status: 'APPLIED', priceMinor: 9_000 })

    const outside = await createProduct(10_000)
    const requested = await setPrice(managerCookie, outside.id, managerBranchId, 8_999)
    expect(await readJson<PriceResult>(requested)).toMatchObject({ status: 'PENDING_APPROVAL' })
    expect(await overrideRow(outside.id, managerBranchId)).toBeNull()
    expect((await pendingApprovalFor(outside.id)).payload).toMatchObject({
      currentPriceMinor: 10_000,
      proposedPriceMinor: 8_999,
    })
  })

  it('requests any change away from a zero price', async () => {
    const free = await createProduct(0)
    const response = await setPrice(managerCookie, free.id, managerBranchId, 1)
    expect(await readJson<PriceResult>(response)).toMatchObject({ status: 'PENDING_APPROVAL' })
    expect((await pendingApprovalFor(free.id)).payload).toMatchObject({
      currentPriceMinor: 0,
      proposedPriceMinor: 1,
    })
  })

  it('lets an admin move a price outside the band with no request', async () => {
    const created = await createProduct(10_000)
    const response = await setPrice(adminCookie, created.id, managerBranchId, 20_000)
    expect(await readJson<PriceResult>(response)).toEqual({
      status: 'APPLIED',
      priceMinor: 20_000,
    })
    expect((await overrideRow(created.id, managerBranchId))?.priceMinor).toBe(20_000)
    expect(await approvalRowsFor(created.id)).toHaveLength(0)

    const audit = await auditActions(created.id)
    const set = audit.find((row) => row.action === 'product.price.override_set')
    expect((set?.after as { via?: string } | undefined)?.via).toBe('BAND')
  })

  it('applies an approved change once and refuses the second decision', async () => {
    const created = await createProduct(10_000)
    const requested = await setPrice(managerCookie, created.id, managerBranchId, 12_000)
    expect(await readJson<PriceResult>(requested)).toMatchObject({ status: 'PENDING_APPROVAL' })
    const pending = await pendingApprovalFor(created.id)

    // The manager who raised it cannot decide it: the request names an admin.
    const selfDecision = await decidePriceChange(managerCookie, pending.id, 'APPROVED')
    expect(selfDecision.status).toBe(403)

    const approved = await decidePriceChange(adminCookie, pending.id, 'APPROVED')
    expect(approved.status).toBe(200)
    expect((await readJson<{ approval: { status: string } }>(approved)).approval.status).toBe(
      'APPROVED',
    )

    expect((await overrideRow(created.id, managerBranchId))?.priceMinor).toBe(12_000)

    const audit = await auditActions(created.id)
    const applied = audit.find((row) => row.action === 'product.price.override_set')
    expect(applied?.after).toMatchObject({
      priceMinor: 12_000,
      via: 'approval',
      approvalId: pending.id,
    })

    const again = await decidePriceChange(adminCookie, pending.id, 'APPROVED')
    expect(again.status).toBe(409)
  })

  it('refuses an approval whose price moved underneath it and leaves it pending', async () => {
    const created = await createProduct(10_000)
    const requested = await setPrice(managerCookie, created.id, managerBranchId, 11_001)
    expect(await readJson<PriceResult>(requested)).toMatchObject({ status: 'PENDING_APPROVAL' })
    const pending = await pendingApprovalFor(created.id)

    const baseChange = await app.request(`/api/products/${created.id}`, {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ basePriceMinor: 12_000 }),
    })
    expect(baseChange.status).toBe(200)

    const stale = await decidePriceChange(adminCookie, pending.id, 'APPROVED')
    expect(stale.status).toBe(409)
    expect(await readJson<{ error: { message: string } }>(stale)).toMatchObject({
      error: {
        message: expect.stringContaining('The price changed while this request was waiting'),
      },
    })

    // Rolled back: the price row is untouched and the request is still waiting.
    expect(await overrideRow(created.id, managerBranchId)).toBeNull()
    expect((await approvalRowsFor(created.id))[0]?.status).toBe('PENDING')
  })

  it('leaves the price untouched when the request is rejected', async () => {
    const created = await createProduct(10_000)
    await setPrice(managerCookie, created.id, managerBranchId, 15_000)
    const pending = await pendingApprovalFor(created.id)

    const rejected = await decidePriceChange(adminCookie, pending.id, 'REJECTED', 'PRICE_TOO_HIGH')
    expect(rejected.status).toBe(200)
    expect(await overrideRow(created.id, managerBranchId)).toBeNull()
    expect((await approvalRowsFor(created.id))[0]?.status).toBe('REJECTED')

    // The unique index only holds pending rows: the manager may raise the same
    // change again against the same current price.
    const again = await setPrice(managerCookie, created.id, managerBranchId, 15_000)
    expect(await readJson<PriceResult>(again)).toMatchObject({ status: 'PENDING_APPROVAL' })
  })

  it('band-checks removing an override and applies the small one directly', async () => {
    const big = await createProduct(10_000)
    const bigSet = await setPrice(adminCookie, big.id, managerBranchId, 12_000)
    expect(await readJson<PriceResult>(bigSet)).toMatchObject({ status: 'APPLIED' })

    // Removing a 20% markup is itself a 16.7% move down: a request, not a delete.
    const bigRemove = await removePrice(managerCookie, big.id, managerBranchId)
    expect(bigRemove.status).toBe(200)
    const bigResult = await readJson<PriceResult>(bigRemove)
    expect(bigResult).toMatchObject({ status: 'PENDING_APPROVAL' })
    expect((await overrideRow(big.id, managerBranchId))?.priceMinor).toBe(12_000)

    const bigPending = await pendingApprovalFor(big.id)
    expect(bigPending.payload).toMatchObject({
      kind: 'REMOVE',
      currentPriceMinor: 12_000,
      proposedPriceMinor: 10_000,
    })
    expect(bigPending.amountMinor).toBe(10_000)

    const approved = await decidePriceChange(adminCookie, bigPending.id, 'APPROVED')
    expect(approved.status).toBe(200)
    expect(await overrideRow(big.id, managerBranchId)).toBeNull()

    const small = await createProduct(10_000)
    await setPrice(adminCookie, small.id, managerBranchId, 10_500)
    const smallRemove = await removePrice(managerCookie, small.id, managerBranchId)
    expect(await readJson<PriceResult>(smallRemove)).toEqual({
      status: 'APPLIED',
      priceMinor: 10_000,
    })
    expect(await overrideRow(small.id, managerBranchId)).toBeNull()

    const audit = await auditActions(small.id)
    const removed = audit.find((row) => row.action === 'product.price.override_removed')
    expect((removed?.after as { via?: string } | undefined)?.via).toBe('BAND')
  })

  it('refuses a second pending request for the same product with 409', async () => {
    const created = await createProduct(10_000)
    await setPrice(managerCookie, created.id, managerBranchId, 12_000)

    const second = await setPrice(managerCookie, created.id, managerBranchId, 13_000)
    expect(second.status).toBe(409)
    expect(await readJson<{ error: { message: string } }>(second)).toMatchObject({
      error: {
        message: 'A price change for this product is already waiting for a decision',
      },
    })
    expect(await approvalRowsFor(created.id)).toHaveLength(1)
    expect(await overrideRow(created.id, managerBranchId)).toBeNull()
  })

  it('serves the band with the price rows so the console never re-derives it', async () => {
    const created = await createProduct(10_000)
    await setPrice(adminCookie, created.id, managerBranchId, 9_000)

    const response = await app.request(`/api/products/${created.id}/prices`, {
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(200)
    const body = await readJson<{
      basePriceMinor: number
      managerBandPercent: number
      overrides: {
        branchId: string
        priceMinor: number
        bounds: { minMinor: number; maxMinor: number }
      }[]
    }>(response)

    expect(body.basePriceMinor).toBe(10_000)
    expect(body.managerBandPercent).toBe(10)
    expect(body.overrides).toHaveLength(1)
    expect(body.overrides[0]).toMatchObject({
      branchId: managerBranchId,
      priceMinor: 9_000,
      bounds: priceBandBounds(9_000, 10),
    })

    const managerView = await app.request(`/api/products/${created.id}/prices`, {
      headers: authedHeaders(managerCookie),
    })
    expect(managerView.status).toBe(200)
    const managerBody = await readJson<{ managerBandPercent: number; overrides: unknown[] }>(
      managerView,
    )
    expect(managerBody.managerBandPercent).toBe(10)
    expect(managerBody.overrides).toHaveLength(1)
  })

  it('renders the price change subject with product, band, and bounds', async () => {
    const created = await createProduct(10_000)
    await setPrice(managerCookie, created.id, managerBranchId, 12_000)
    const pending = await pendingApprovalFor(created.id)

    const response = await app.request(`/api/approvals/${pending.id}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(200)
    const body = await readJson<{ subject: Record<string, unknown> }>(response)

    expect(body.subject).toMatchObject({
      kind: 'price_change',
      productId: created.id,
      branchId: managerBranchId,
      currentPriceMinor: 10_000,
      proposedPriceMinor: 12_000,
      productName: created.name,
      sku: created.sku,
      bandPercent: 10,
      bounds: priceBandBounds(10_000, 10),
    })
  })

  it('keeps a manager inside their own branch and 403s a foreign one', async () => {
    const created = await createProduct(10_000)

    const foreignSet = await setPrice(managerCookie, created.id, otherBranchId, 10_500)
    expect(foreignSet.status).toBe(403)

    await setPrice(adminCookie, created.id, otherBranchId, 10_500)
    const foreignRemove = await removePrice(managerCookie, created.id, otherBranchId)
    expect(foreignRemove.status).toBe(403)

    // The admin may still write both branches.
    const adminOther = await setPrice(adminCookie, created.id, otherBranchId, 10_750)
    expect(await readJson<PriceResult>(adminOther)).toEqual({
      status: 'APPLIED',
      priceMinor: 10_750,
    })
  })
})
