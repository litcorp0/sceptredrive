import { db } from '@sceptre/db'
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
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockReceiptLine,
} from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { documentSequence } from '../platform/sequences.schema.ts'
import { product } from '../products/products.schema.ts'
import { stockOpening, stockOpeningLine } from './openings.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[openings.api.test] database unavailable; integration tests skipped')

interface PreviewRow {
  lineNo: number
  status: 'NEW' | 'EXISTING'
  productId: string | null
  name: string
  quantity: number
  onHand: number
  delta: number
  costMinor: number
  countedValueMinor: number
  errors: string[]
  warnings: string[]
}

interface PreviewResponse {
  branchId: string
  rows: PreviewRow[]
  lineCount: number
  totalUnits: number
  countedValueMinor: number
  newProductCount: number
  uncostedLineCount: number
  canPost: boolean
}

interface OpeningDetailResponse {
  opening: {
    id: string
    number: string
    status: 'DRAFT' | 'POSTED'
    lineCount: number
    totalUnits: number
    countedValueMinor: number
    postedValueMinor: number
    uncostedLineCount: number
    newProductCount: number
    postedAt: string | null
  }
  lines: Array<{
    productId: string | null
    productSku: string | null
    name: string
    quantity: number
    unitCostMinor: number
    movementId: string | null
  }>
}

interface StockResponse {
  stock: { quantityOnHand: number; avgCostMinor: number }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('opening stock API', () => {
  const suffix = uniqueSuffix()
  const createdBranchIds: string[] = []
  const createdUserIds: string[] = []
  const createdProductIds: string[] = []
  let adminCookie = ''
  let managerCookie = ''
  let branchAId = ''
  let branchBId = ''
  let categoryId = ''
  let childCategoryId = ''
  let uomId = ''
  let stockedProductId = ''
  let emptyProductId = ''
  let stockedProductName = ''
  let emptyProductName = ''

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const branchA = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `OP${randomToken(2)}-A`,
        name: 'Opening API Branch A',
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(branchA.status).toBe(201)
    branchAId = (await readJson<{ branch: { id: string } }>(branchA)).branch.id
    createdBranchIds.push(branchAId)

    const branchB = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `OP${randomToken(2)}-B`,
        name: 'Opening API Branch B',
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(branchB.status).toBe(201)
    branchBId = (await readJson<{ branch: { id: string } }>(branchB)).branch.id
    createdBranchIds.push(branchBId)

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: branchAId,
      name: 'Opening API Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const units = await db
      .insert(uom)
      .values({ code: `O${suffix}`.toUpperCase(), name: `Opening Unit ${suffix}` })
      .returning({ id: uom.id })
    uomId = units[0]?.id ?? ''

    const categories = await db
      .insert(category)
      .values({ name: `Opening Cat ${suffix}` })
      .returning({ id: category.id })
    categoryId = categories[0]?.id ?? ''

    // A child, so a nested path has something real to resolve to (P20-D20).
    const children = await db
      .insert(category)
      .values({ name: `Opening Child ${suffix}`, parentId: categoryId })
      .returning({ id: category.id })
    childCategoryId = children[0]?.id ?? ''

    stockedProductName = `Stocked Part ${suffix}`
    emptyProductName = `Empty Part ${suffix}`
    const products = await db
      .insert(product)
      .values([
        {
          sku: `OP-${suffix}-1`,
          name: stockedProductName,
          categoryId,
          uomId,
          costPriceMinor: 1_000,
          basePriceMinor: 2_000,
        },
        {
          sku: `OP-${suffix}-2`,
          name: emptyProductName,
          categoryId,
          uomId,
          costPriceMinor: 0,
          basePriceMinor: 3_000,
        },
      ])
      .returning({ id: product.id })
    stockedProductId = products[0]?.id ?? ''
    emptyProductId = products[1]?.id ?? ''
    createdProductIds.push(stockedProductId, emptyProductId)

    // Five units at 1,000 give the first product an on-hand the negative-delta
    // case can be compared against.
    await app.request('/api/inventory/receipts', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        branchId: branchAId,
        lines: [{ productId: stockedProductId, quantity: 5, unitCostMinor: 1_000 }],
      }),
    })
  })

  afterAll(async () => {
    if (createdBranchIds.length > 0) {
      const openings = await db
        .select({ id: stockOpening.id })
        .from(stockOpening)
        .where(inArray(stockOpening.branchId, createdBranchIds))
      const openingIds = openings.map((row) => row.id)
      if (openingIds.length > 0) {
        await db.delete(stockOpeningLine).where(inArray(stockOpeningLine.openingId, openingIds))
        await db.delete(stockOpening).where(inArray(stockOpening.id, openingIds))
      }
      const receipts = await db
        .select({ id: stockReceipt.id })
        .from(stockReceipt)
        .where(inArray(stockReceipt.branchId, createdBranchIds))
      if (receipts.length > 0) {
        await db.delete(stockReceiptLine).where(
          inArray(
            stockReceiptLine.receiptId,
            receipts.map((row) => row.id),
          ),
        )
        await db.delete(stockReceipt).where(
          inArray(
            stockReceipt.id,
            receipts.map((row) => row.id),
          ),
        )
      }
      await db.delete(stockMovement).where(inArray(stockMovement.branchId, createdBranchIds))
      await db.delete(stockLevel).where(inArray(stockLevel.branchId, createdBranchIds))
      await db.delete(approval).where(inArray(approval.branchId, createdBranchIds))
    }
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (categoryId) {
      // Children first: the tree cascades by restrict, and the auto-create test adds one.
      await db.delete(category).where(eq(category.parentId, categoryId))
      await db.delete(category).where(eq(category.id, categoryId))
    }
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(documentSequence).where(inArray(documentSequence.branchId, createdBranchIds))
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  function cleanRow(overrides: Record<string, unknown> = {}) {
    return {
      name: stockedProductName,
      category: `Opening Cat ${suffix}`,
      unit: `O${suffix}`.toUpperCase(),
      price: '20.00',
      cost: '10.00',
      quantity: '12',
      ...overrides,
    }
  }

  it('previews new, existing, duplicate and invalid rows without writing anything', async () => {
    const response = await app.request('/api/openings/preview', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        rows: [
          cleanRow(),
          cleanRow({
            name: `Brand New Part ${suffix}`,
            barcode: `BC-${suffix}`,
            price: '45.00',
            cost: '30.00',
            quantity: '7',
          }),
          cleanRow({ name: stockedProductName, quantity: '1' }),
          cleanRow({ name: `Unknown ${suffix}`, category: `No Such Cat ${suffix}` }),
          cleanRow({ name: stockedProductName, quantity: '3' }),
        ],
      }),
    })
    expect(response.status).toBe(200)
    const body = await readJson<PreviewResponse>(response)
    expect(body.rows[0]?.status).toBe('EXISTING')
    expect(body.rows[0]?.onHand).toBe(5)
    expect(body.rows[0]?.delta).toBe(7)
    expect(body.rows[1]?.status).toBe('NEW')
    expect(body.rows[2]?.errors.join(' ')).toContain('appears twice')
    expect(body.rows[3]?.errors.join(' ')).toContain('unknown category')
    expect(body.rows[4]?.errors.join(' ')).toContain('lower than the system')
    expect(body.canPost).toBe(false)

    const rows = await db
      .select({ id: stockOpening.id })
      .from(stockOpening)
      .where(eq(stockOpening.branchId, branchAId))
    expect(rows).toHaveLength(0)
  })

  it('resolves a nested category written as a path (P20-D20)', async () => {
    const post = async (categoryCell: string) => {
      const response = await app.request('/api/openings/preview', {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({
          branchId: branchAId,
          rows: [cleanRow({ category: categoryCell, name: `Path ${suffix} ${categoryCell}` })],
        }),
      })
      expect(response.status).toBe(200)
      return readJson<{
        rows: { category: string; categoryId: string | null; errors: string[] }[]
      }>(response)
    }

    // `>` is the convention; `/` was the first syntax and still works.
    for (const cell of [
      `Opening Cat ${suffix} > Opening Child ${suffix}`,
      `Opening Cat ${suffix} / Opening Child ${suffix}`,
    ]) {
      const body = await post(cell)
      const row = body.rows[0]
      expect(row?.errors).toEqual([])
      expect(row?.categoryId).toBe(childCategoryId)
      // The preview shows the whole path, so the nesting is visible before saving.
      expect(row?.category).toBe(`Opening Cat ${suffix} / Opening Child ${suffix}`)
    }
  })

  it('names the path when a nested category does not exist', async () => {
    const response = await app.request('/api/openings/preview', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        rows: [cleanRow({ category: `Opening Cat ${suffix} > Missing ${suffix}` })],
      }),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ rows: { errors: string[] }[] }>(response)
    expect(body.rows[0]?.errors.join(' ')).toContain('Catalog → Categories')
  })

  it('offers to create the categories a file names, and says which (P20-D21)', async () => {
    const child = `Fresh Child ${suffix}`
    const path = `Opening Cat ${suffix} > ${child}`

    // Off (the default): refusing is the behaviour, and the row carries the error.
    const refused = await app.request('/api/openings/preview', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ branchId: branchAId, rows: [cleanRow({ category: path })] }),
    })
    const refusedBody = await readJson<{
      rows: { errors: string[] }[]
      categoriesToCreate: string[][]
    }>(refused)
    expect(refusedBody.rows[0]?.errors.join(' ')).toContain('unknown category')
    expect(refusedBody.categoriesToCreate).toEqual([])

    // On: no error, and the preview says exactly what would be created.
    const offered = await app.request('/api/openings/preview', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        createMissingCategories: true,
        rows: [cleanRow({ category: path })],
      }),
    })
    expect(offered.status).toBe(200)
    const offeredBody = await readJson<{
      rows: { errors: string[]; createsCategory: string[] | null }[]
      categoriesToCreate: string[][]
      canPost: boolean
    }>(offered)
    expect(offeredBody.rows[0]?.errors).toEqual([])
    expect(offeredBody.rows[0]?.createsCategory).toEqual([`Opening Cat ${suffix}`, child])
    expect(offeredBody.categoriesToCreate).toEqual([[`Opening Cat ${suffix}`, child]])
    expect(offeredBody.canPost).toBe(true)

    // Nothing exists until the draft is saved: a preview writes nothing.
    const before = await db.select().from(category).where(eq(category.name, child))
    expect(before).toHaveLength(0)
  })

  it('builds the missing category when the draft is saved', async () => {
    const child = `Saved Child ${suffix}`
    const response = await app.request('/api/openings', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        createMissingCategories: true,
        rows: [
          cleanRow({ name: `Fresh part ${suffix}`, category: `Opening Cat ${suffix} > ${child}` }),
        ],
      }),
    })

    expect(response.status).toBe(201)
    const detail = await readJson<{ opening: { id: string }; lines: { categoryId: string }[] }>(
      response,
    )

    const created = await db.select().from(category).where(eq(category.name, child))
    expect(created).toHaveLength(1)
    // Two levels: the child sits under the parent the file named.
    expect(created[0]?.parentId).toBe(categoryId)
    expect(detail.lines[0]?.categoryId).toBe(created[0]?.id)
  })

  it('refuses a path deeper than two levels', async () => {
    const response = await app.request('/api/openings/preview', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        createMissingCategories: true,
        rows: [cleanRow({ category: 'One > Two > Three' })],
      }),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ rows: { errors: string[] }[] }>(response)
    expect(body.rows[0]?.errors.join(' ')).toContain('two levels deep')
  })

  it('creates a draft, posts it once, and seeds the branch average', async () => {
    const idempotencyKey = `opening-${suffix}-1`
    const create = await app.request('/api/openings', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        idempotencyKey,
        note: 'Go-live count',
        rows: [
          cleanRow({ quantity: '12' }),
          cleanRow({
            name: `Brand New Part ${suffix}`,
            barcode: `BC-${suffix}`,
            price: '45.00',
            cost: '30.00',
            quantity: '7',
          }),
        ],
      }),
    })
    expect(create.status).toBe(201)
    const draft = await readJson<OpeningDetailResponse>(create)
    expect(draft.opening.status).toBe('DRAFT')
    expect(draft.opening.lineCount).toBe(2)
    expect(draft.opening.newProductCount).toBe(1)

    const replay = await app.request('/api/openings', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        idempotencyKey,
        rows: [cleanRow()],
      }),
    })
    expect(replay.status).toBe(201)
    expect((await readJson<OpeningDetailResponse>(replay)).opening.id).toBe(draft.opening.id)

    const managerPost = await app.request(`/api/openings/${draft.opening.id}/post`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({}),
    })
    expect(managerPost.status).toBe(403)

    const post = await app.request(`/api/openings/${draft.opening.id}/post`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({}),
    })
    expect(post.status).toBe(200)
    const posted = await readJson<OpeningDetailResponse>(post)
    expect(posted.opening.status).toBe('POSTED')
    expect(posted.opening.totalUnits).toBe(19)
    expect(posted.opening.countedValueMinor).toBe(12_000 + 21_000)
    expect(posted.opening.postedValueMinor).toBe(7_000 + 21_000)

    const newLine = posted.lines.find((line) => line.name === `Brand New Part ${suffix}`)
    expect(newLine?.productId).toBeTruthy()
    if (!newLine?.productId) throw new Error('The new product was not created')
    expect(newLine.productSku).toBeTruthy()
    expect(newLine.movementId).toBeTruthy()
    createdProductIds.push(newLine.productId)

    const stocked = await app.request(
      `/api/inventory/stock/${stockedProductId}?branchId=${branchAId}`,
      { headers: authedHeaders(adminCookie) },
    )
    const stockedBody = await readJson<StockResponse>(stocked)
    expect(stockedBody.stock.quantityOnHand).toBe(12)
    // (5 × 1,000 + 7 × 1,000) / 12 = 1,000; the second line is a new product.
    expect(stockedBody.stock.avgCostMinor).toBe(1_000)

    const newStock = await app.request(
      `/api/inventory/stock/${newLine?.productId}?branchId=${branchAId}`,
      { headers: authedHeaders(adminCookie) },
    )
    const newBody = await readJson<StockResponse>(newStock)
    expect(newBody.stock.quantityOnHand).toBe(7)
    expect(newBody.stock.avgCostMinor).toBe(3_000)

    const movements = await db
      .select({ id: stockMovement.id, type: stockMovement.type })
      .from(stockMovement)
      .where(
        and(
          eq(stockMovement.branchId, branchAId),
          inArray(stockMovement.productId, [stockedProductId, newLine?.productId as string]),
        ),
      )
    expect(movements.filter((row) => row.type === 'OPENING')).toHaveLength(2)

    const movementsBefore = movements.length
    const retry = await app.request(`/api/openings/${draft.opening.id}/post`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({}),
    })
    expect(retry.status).toBe(200)
    const movementsAfter = await db
      .select({ id: stockMovement.id })
      .from(stockMovement)
      .where(
        and(
          eq(stockMovement.branchId, branchAId),
          inArray(stockMovement.productId, [stockedProductId, newLine?.productId as string]),
        ),
      )
    expect(movementsAfter.length).toBe(movementsBefore)

    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, draft.opening.id))
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(['stock_opening.created', 'stock_opening.posted']),
    )
  })

  it('refuses a manager drafting at another branch and a posted delete', async () => {
    const preview = await app.request('/api/openings/preview', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ branchId: branchBId, rows: [cleanRow()] }),
    })
    expect(preview.status).toBe(403)

    const stock = await app.request(
      `/api/inventory/stock/${emptyProductId}?branchId=${branchAId}`,
      {
        headers: authedHeaders(managerCookie),
      },
    )
    expect(stock.status).toBe(200)
  })

  it('refuses a negative delta and a draft delete after posting', async () => {
    const preview = await app.request('/api/openings/preview', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        branchId: branchAId,
        rows: [cleanRow({ quantity: '2' })],
      }),
    })
    const body = await readJson<PreviewResponse>(preview)
    expect(body.canPost).toBe(false)
    expect(body.rows[0]?.errors.join(' ')).toContain('lower than the system')
  })

  it('requires an explicit acknowledgement for an uncosted line and deletes a draft', async () => {
    const create = await app.request('/api/openings', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        rows: [cleanRow({ cost: '0.00', quantity: '14' })],
      }),
    })
    expect(create.status).toBe(201)
    const draft = await readJson<OpeningDetailResponse>(create)
    expect(draft.opening.uncostedLineCount).toBe(1)

    const blocked = await app.request(`/api/openings/${draft.opening.id}/post`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({}),
    })
    expect(blocked.status).toBe(409)

    const deleted = await app.request(`/api/openings/${draft.opening.id}`, {
      method: 'DELETE',
      headers: authedHeaders(managerCookie),
    })
    expect(deleted.status).toBe(200)

    const gone = await app.request(`/api/openings/${draft.opening.id}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(gone.status).toBe(404)
  })

  it('stocks a product from an approved manager proposal', async () => {
    const proposalName = `Proposal Part ${suffix}`
    const submission = await app.request('/api/products/submissions', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        name: proposalName,
        categoryId,
        uomId,
        proposedBasePriceMinor: 5_000,
        openingQuantity: 4,
        openingUnitCostMinor: 2_500,
      }),
    })
    expect(submission.status).toBe(201)
    const { approvalId } = await readJson<{ approvalId: string }>(submission)

    const decide = await app.request(`/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(decide.status).toBe(200)

    const list = await app.request(`/api/products?q=${encodeURIComponent(proposalName)}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(list.status).toBe(200)
    const products = await readJson<{ products: Array<{ id: string; name: string }> }>(list)
    const created = products.products.find((row) => row.name === proposalName)
    expect(created).toBeTruthy()
    if (!created) throw new Error('The approved product was not listed')
    createdProductIds.push(created.id)

    const stock = await app.request(`/api/inventory/stock/${created?.id}?branchId=${branchAId}`, {
      headers: authedHeaders(adminCookie),
    })
    const stockBody = await readJson<StockResponse>(stock)
    expect(stockBody.stock.quantityOnHand).toBe(4)
    expect(stockBody.stock.avgCostMinor).toBe(2_500)

    const movements = await app.request(
      `/api/inventory/movements?productId=${created?.id}&branchId=${branchAId}&type=OPENING`,
      { headers: authedHeaders(adminCookie) },
    )
    const movementBody = await readJson<{ movements: Array<{ type: string }> }>(movements)
    expect(movementBody.movements).toHaveLength(1)
    expect(movementBody.movements[0]?.type).toBe('OPENING')
  })

  it('refuses a proposal that sends only one opening field', async () => {
    const response = await app.request('/api/products/submissions', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        name: `Half Proposal ${suffix}`,
        categoryId,
        uomId,
        proposedBasePriceMinor: 5_000,
        openingQuantity: 4,
      }),
    })
    expect(response.status).toBe(400)
  })
})
