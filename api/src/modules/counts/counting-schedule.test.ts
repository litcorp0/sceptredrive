import { randomUUID } from 'node:crypto'
import { db } from '@sceptre/db'
import { accraIsoDay, advanceDueDate } from '@sceptre/shared'
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
import { brand, category, uom } from '../catalog/catalog.schema.ts'
import { stockLevel, stockMovement } from '../inventory/inventory.schema.ts'
import * as inventoryService from '../inventory/inventory.service.ts'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { sale, saleLine, shift, syncConflict } from '../pos/pos.schema.ts'
import * as posService from '../pos/pos.service.ts'
import { product } from '../products/products.schema.ts'
import { countSchedule, stockAbcClass, stockCount, stockCountLine } from './counts.schema.ts'
import * as countsService from './counts.service.ts'

const available = await databaseAvailable()
if (!available) console.warn('[counting-schedule.test] database unavailable; tests skipped')

const actor: AuditActor = {
  actorId: 'count-plan-09',
  actorStaffId: 'GA-COUNT09',
  ip: null,
  userAgent: null,
  requestId: null,
}

interface ProductFixture {
  id: string
  sku: string
  name: string
}

interface CountLineResponse {
  productId: string
  snapshotQty: number
  countedQty: number | null
  variance: number | null
}

interface CountResponse {
  id: string
  number: string
  status: string
  branchId: string
  countType: string
  scope: string | null
  scopeKey: string | null
  dueAt: string | null
  scheduleId: string | null
  triggerReason: string | null
  triggerProductId: string | null
  lineCount: number
  countedCount: number
  lines: CountLineResponse[]
}

interface ScheduleResponse {
  id: string
  branchId: string
  scope: string
  scopeKey: string
  frequency: string
  nextDueAt: string
  assignedTo: string | null
  isActive: boolean
}

interface ScheduledCountRow {
  id: string
  status: string
  countType: string
  scopeKey: string | null
  dueAt: string | null
}

interface AccuracyResponse {
  accuracyBp: number | null
  countedLines: number
  matchedLines: number
  countsPosted: number
  countsOnTime: number
  varianceValueMinor: number
  branchId: string | null
}

interface AbcRowResponse {
  productId: string
  class: string
  valueMinor: number
  soldMinor: number
  score: number
  isManual: boolean
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function today(): string {
  return accraIsoDay()
}

describe.skipIf(!available)('cycle counts — schedules, ABC, triggers, accuracy', () => {
  const suffix = uniqueSuffix()
  const createdBranchIds: string[] = []
  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []
  const createdBrandIds: string[] = []
  const createdUomIds: string[] = []
  const createdUserIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdDeviceIds: string[] = []

  let adminCookie = ''
  let managerACookie = ''
  let managerBCookie = ''
  let managerAId = ''
  let branchAId = ''
  let branchBId = ''
  let uomId = ''
  let defaultCategoryId = ''

  async function createBranch(label: string): Promise<string> {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `CY${randomToken(2)}-${label}`,
        name: `Cycle Branch ${label}`,
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ branch: { id: string } }>(response)
    createdBranchIds.push(body.branch.id)
    return body.branch.id
  }

  async function createProduct(input: {
    label: string
    categoryId?: string | null
    brandId?: string | null
    costPriceMinor?: number
  }): Promise<ProductFixture> {
    const rows = await db
      .insert(product)
      .values({
        sku: `CY-${suffix}-${input.label}`.toUpperCase(),
        name: `Cycle Product ${input.label} ${suffix}`,
        categoryId: input.categoryId ?? defaultCategoryId,
        brandId: input.brandId ?? null,
        uomId,
        costPriceMinor: input.costPriceMinor ?? 100,
        basePriceMinor: (input.costPriceMinor ?? 100) * 2,
      })
      .returning({ id: product.id, sku: product.sku, name: product.name })
    const row = rows[0]
    if (!row) throw new Error('failed to create product fixture')
    createdProductIds.push(row.id)
    return row
  }

  async function stock(productId: string, branchId: string, quantity: number, cost = 100) {
    await inventoryService.postMovements(actor, [
      {
        productId,
        branchId,
        type: 'RECEIPT',
        quantityDelta: quantity,
        unitCostMinor: cost,
        referenceType: 'RECEIPT',
      },
    ])
  }

  async function createSchedule(
    cookie: string,
    body: Record<string, unknown>,
  ): Promise<ScheduleResponse> {
    const response = await app.request('/api/count-schedules', {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(201)
    const payload = await readJson<{ schedule: ScheduleResponse }>(response)
    return payload.schedule
  }

  async function runScheduleWorker(): Promise<{
    created: number
    skipped: number
    failures: number
  }> {
    return countsService.runDueCountSchedules()
  }

  async function countsForSchedule(scheduleId: string): Promise<ScheduledCountRow[]> {
    return db
      .select({
        id: stockCount.id,
        status: stockCount.status,
        countType: stockCount.countType,
        scopeKey: stockCount.scopeKey,
        dueAt: stockCount.dueAt,
      })
      .from(stockCount)
      .where(eq(stockCount.scheduleId, scheduleId))
  }

  async function createCount(cookie: string, branchId: string): Promise<CountResponse> {
    const response = await app.request('/api/counts', {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify({ branchId }),
    })
    expect(response.status).toBe(201)
    const payload = await readJson<{ count: CountResponse }>(response)
    return payload.count
  }

  async function setCounted(
    cookie: string,
    countId: string,
    lines: { productId: string; countedQty: number | null }[],
  ): Promise<Response> {
    return app.request(`/api/counts/${countId}/lines`, {
      method: 'PATCH',
      headers: authedHeaders(cookie),
      body: JSON.stringify({ lines }),
    })
  }

  async function postCount(cookie: string, countId: string): Promise<CountResponse> {
    const response = await app.request(`/api/counts/${countId}/post`, {
      method: 'POST',
      headers: authedHeaders(cookie),
    })
    expect(response.status).toBe(200)
    const payload = await readJson<{ count: CountResponse }>(response)
    return payload.count
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    branchAId = await createBranch('A')
    branchBId = await createBranch('B')

    const managerA = await createTestUser({
      role: 'MANAGER',
      branchId: branchAId,
      name: 'Cycle Manager A',
    })
    managerAId = managerA.id
    createdUserIds.push(managerA.id)
    managerACookie = await signIn(managerA.email)

    const managerB = await createTestUser({
      role: 'MANAGER',
      branchId: branchBId,
      name: 'Cycle Manager B',
    })
    createdUserIds.push(managerB.id)
    managerBCookie = await signIn(managerB.email)

    const units = await db
      .insert(uom)
      .values({ code: `U${suffix}`.toUpperCase(), name: `Cycle Unit ${suffix}` })
      .returning({ id: uom.id })
    uomId = units[0]?.id ?? ''
    if (uomId) createdUomIds.push(uomId)

    const categoryRows = await db
      .insert(category)
      .values([{ name: `Cycle Default Category ${suffix}` }])
      .returning({ id: category.id })
    defaultCategoryId = categoryRows[0]?.id ?? ''
    if (defaultCategoryId) createdCategoryIds.push(defaultCategoryId)
  })

  afterAll(async () => {
    if (createdBranchIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.branchId, createdBranchIds))

      const branchCounts = await db
        .select({ id: stockCount.id })
        .from(stockCount)
        .where(inArray(stockCount.branchId, createdBranchIds))
      const countIds = branchCounts.map((row) => row.id)
      if (countIds.length > 0) {
        await db.delete(stockCountLine).where(inArray(stockCountLine.countId, countIds))
        await db.delete(stockCount).where(inArray(stockCount.id, countIds))
      }
      await db.delete(countSchedule).where(inArray(countSchedule.branchId, createdBranchIds))
      await db.delete(stockAbcClass).where(inArray(stockAbcClass.branchId, createdBranchIds))
      await db.delete(stockMovement).where(inArray(stockMovement.branchId, createdBranchIds))
      await db.delete(stockLevel).where(inArray(stockLevel.branchId, createdBranchIds))

      if (createdBranchIds.length > 0) {
        const shifts = await db
          .select({ id: shift.id })
          .from(shift)
          .where(inArray(shift.branchId, createdBranchIds))
        const shiftIds = shifts.map((row) => row.id)
        if (shiftIds.length > 0) {
          await db.delete(sale).where(inArray(sale.shiftId, shiftIds))
          await db.delete(shift).where(inArray(shift.id, shiftIds))
        }
      }
      if (createdDeviceIds.length > 0) {
        await db.delete(device).where(inArray(device.id, createdDeviceIds))
      }
      if (createdTerminalIds.length > 0) {
        await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
      }
    }

    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdCategoryIds.length > 0) {
      await db.delete(category).where(inArray(category.id, createdCategoryIds))
    }
    if (createdBrandIds.length > 0) {
      await db.delete(brand).where(inArray(brand.id, createdBrandIds))
    }
    if (createdUomIds.length > 0) {
      await db.delete(uom).where(inArray(uom.id, createdUomIds))
    }
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  // --- Schedules -------------------------------------------------------------

  it('creates a rotation schedule a period out and rejects a second one for the scope', async () => {
    const schedule = await createSchedule(managerACookie, {
      scope: 'ROTATION',
      frequency: 'MONTHLY',
    })
    expect(schedule.branchId).toBe(branchAId)
    expect(schedule.scopeKey).toBe('ROTATION')
    expect(schedule.isActive).toBe(true)
    expect(schedule.nextDueAt).toBe(advanceDueDate(today(), 'MONTHLY'))

    const duplicate = await app.request('/api/count-schedules', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ scope: 'ROTATION', frequency: 'WEEKLY' }),
    })
    expect(duplicate.status).toBe(409)

    const deactivate = await app.request(`/api/count-schedules/${schedule.id}`, {
      method: 'PATCH',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ isActive: false }),
    })
    expect(deactivate.status).toBe(200)
    const deactivated = await readJson<{ schedule: ScheduleResponse }>(deactivate)
    expect(deactivated.schedule.isActive).toBe(false)
  })

  it('derives each scope key server-side and refuses a half-configured schedule', async () => {
    const categories = await db
      .insert(category)
      .values([{ name: `Scope Category ${suffix}` }])
      .returning({ id: category.id })
    const categoryId = categories[0]?.id ?? ''
    createdCategoryIds.push(categoryId)

    const brands = await db
      .insert(brand)
      .values([{ name: `Scope Brand ${suffix}` }])
      .returning({ id: brand.id })
    const brandId = brands[0]?.id ?? ''
    createdBrandIds.push(brandId)

    const rotationBranch = await createBranch('S')

    const categorySchedule = await createSchedule(adminCookie, {
      branchId: rotationBranch,
      scope: 'CATEGORY',
      categoryId,
      frequency: 'QUARTERLY',
      firstDueAt: today(),
      assignedTo: 'GA-SCOPE',
    })
    expect(categorySchedule.scopeKey).toBe(`category:${categoryId}`)

    const brandSchedule = await createSchedule(adminCookie, {
      branchId: rotationBranch,
      scope: 'BRAND',
      brandId,
      frequency: 'BIANNUAL',
    })
    expect(brandSchedule.scopeKey).toBe(`brand:${brandId}`)

    const abcSchedule = await createSchedule(adminCookie, {
      branchId: rotationBranch,
      scope: 'ABC_CLASS',
      abcClass: 'A',
      frequency: 'WEEKLY',
    })
    expect(abcSchedule.scopeKey).toBe('ABC:A')

    const halfConfigured = await app.request('/api/count-schedules', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        branchId: rotationBranch,
        scope: 'ROTATION',
        frequency: 'WEEKLY',
        categoryId,
      }),
    })
    expect(halfConfigured.status).toBe(400)

    const missingTarget = await app.request('/api/count-schedules', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: rotationBranch, scope: 'CATEGORY', frequency: 'WEEKLY' }),
    })
    expect(missingTarget.status).toBe(400)

    const list = await app.request(`/api/count-schedules?branchId=${rotationBranch}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(list.status).toBe(200)
    const listed = await readJson<{ schedules: ScheduleResponse[]; total: number }>(list)
    expect(listed.total).toBe(3)
    expect(listed.schedules.every((row) => row.branchId === rotationBranch)).toBe(true)
  })

  it('refuses a schedule for another branch', async () => {
    const foreign = await app.request('/api/count-schedules', {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ branchId: branchAId, scope: 'ROTATION', frequency: 'WEEKLY' }),
    })
    expect(foreign.status).toBe(403)

    const foreignList = await app.request(`/api/count-schedules?branchId=${branchAId}`, {
      headers: authedHeaders(managerBCookie),
    })
    expect(foreignList.status).toBe(403)
  })

  // --- Scope resolution ------------------------------------------------------

  it('resolves all four scopes to hand-counted product sets', async () => {
    const branchId = await createBranch('R')
    const categories = await db
      .insert(category)
      .values([{ name: `Parent ${suffix}` }, { name: `Other ${suffix}` }])
      .returning({ id: category.id })
    const parentId = categories[0]?.id ?? ''
    const otherId = categories[1]?.id ?? ''
    createdCategoryIds.push(parentId, otherId)

    const childRows = await db
      .insert(category)
      .values([{ name: `Child ${suffix}`, parentId }])
      .returning({ id: category.id })
    const childId = childRows[0]?.id ?? ''
    createdCategoryIds.push(childId)

    const brandRows = await db
      .insert(brand)
      .values([{ name: `Brand One ${suffix}` }, { name: `Brand Two ${suffix}` }])
      .returning({ id: brand.id })
    const brandOneId = brandRows[0]?.id ?? ''
    const brandTwoId = brandRows[1]?.id ?? ''
    createdBrandIds.push(brandOneId, brandTwoId)

    const p1 = await createProduct({ label: 'R1', categoryId: parentId, brandId: brandOneId })
    const p2 = await createProduct({ label: 'R2', categoryId: childId, brandId: brandOneId })
    const p3 = await createProduct({ label: 'R3', categoryId: otherId, brandId: brandTwoId })
    const p4 = await createProduct({ label: 'R4', categoryId: otherId, brandId: brandTwoId })

    await stock(p1.id, branchId, 5)
    await stock(p2.id, branchId, 2)
    await stock(p4.id, branchId, 1)

    await db.insert(stockAbcClass).values([
      { productId: p1.id, branchId, class: 'A', score: 500 },
      { productId: p4.id, branchId, class: 'C', score: 100 },
    ])

    const categoryProducts = await countsService.resolveScopeProducts(
      branchId,
      'CATEGORY',
      `category:${parentId}`,
    )
    expect(categoryProducts.sort()).toEqual([p1.id, p2.id].sort())

    const brandOne = await countsService.resolveScopeProducts(
      branchId,
      'BRAND',
      `brand:${brandOneId}`,
    )
    expect(brandOne.sort()).toEqual([p1.id, p2.id].sort())

    // A never-stocked product is still in a brand's catalogue scope.
    const brandTwo = await countsService.resolveScopeProducts(
      branchId,
      'BRAND',
      `brand:${brandTwoId}`,
    )
    expect(brandTwo.sort()).toEqual([p3.id, p4.id].sort())

    const abcA = await countsService.resolveScopeProducts(branchId, 'ABC_CLASS', 'ABC:A')
    expect(abcA).toEqual([p1.id])
    const abcC = await countsService.resolveScopeProducts(branchId, 'ABC_CLASS', 'ABC:C')
    expect(abcC).toEqual([p4.id])
  })

  it('rotates the least-recently-counted parts, never-counted first and branch-scoped', async () => {
    const branchId = await createBranch('O')
    const otherBranchId = await createBranch('X')

    const r1 = await createProduct({ label: 'O1' })
    const r2 = await createProduct({ label: 'O2' })
    const r3 = await createProduct({ label: 'O3' })
    for (const fixture of [r1, r2, r3]) await stock(fixture.id, branchId, 1)

    // Prior posted counts: r1 in January, r2 in June. r3 was never counted.
    const countRows = await db
      .insert(stockCount)
      .values([
        {
          number: `ROT-${suffix}-1`,
          branchId,
          status: 'POSTED',
          postedAt: new Date('2026-01-15T12:00:00.000Z'),
        },
        {
          number: `ROT-${suffix}-2`,
          branchId,
          status: 'POSTED',
          postedAt: new Date('2026-06-15T12:00:00.000Z'),
        },
      ])
      .returning({ id: stockCount.id })
    const firstCountId = countRows[0]?.id ?? ''
    const secondCountId = countRows[1]?.id ?? ''
    await db.insert(stockCountLine).values([
      { countId: firstCountId, productId: r1.id, snapshotQty: 1, countedQty: 1 },
      { countId: secondCountId, productId: r2.id, snapshotQty: 1, countedQty: 1 },
    ])

    // Another branch counting r1 yesterday must not reset this branch's rotation.
    const otherCount = await db
      .insert(stockCount)
      .values({
        number: `ROT-${suffix}-X`,
        branchId: otherBranchId,
        status: 'POSTED',
        postedAt: new Date(),
      })
      .returning({ id: stockCount.id })
    await db
      .insert(stockCountLine)
      .values([
        { countId: otherCount[0]?.id ?? '', productId: r1.id, snapshotQty: 1, countedQty: 1 },
      ])

    const weekly = await countsService.resolveScopeProducts(
      branchId,
      'ROTATION',
      'ROTATION',
      db,
      'WEEKLY',
    )
    expect(weekly).toEqual([r3.id])

    const biannual = await countsService.resolveScopeProducts(
      branchId,
      'ROTATION',
      'ROTATION',
      db,
      'BIANNUAL',
    )
    expect(biannual).toEqual([r3.id, r1.id])
  })

  // --- Scheduled counts ------------------------------------------------------

  it('creates one count on a double worker run and advances the due date once', async () => {
    const branchId = await createBranch('D')
    const fixture = await createProduct({ label: 'D1' })
    await stock(fixture.id, branchId, 4)

    const schedule = await createSchedule(adminCookie, {
      branchId,
      scope: 'ROTATION',
      frequency: 'MONTHLY',
      firstDueAt: today(),
    })

    const firstRun = await runScheduleWorker()
    expect(firstRun.created).toBeGreaterThanOrEqual(1)

    const afterFirst = await db
      .select()
      .from(countSchedule)
      .where(eq(countSchedule.id, schedule.id))
    expect(afterFirst[0]?.nextDueAt).toBe(advanceDueDate(today(), 'MONTHLY'))

    const firstCounts = await countsForSchedule(schedule.id)
    expect(firstCounts).toHaveLength(1)
    expect(firstCounts[0]?.countType).toBe('SCHEDULED')
    expect(firstCounts[0]?.scopeKey).toBe('ROTATION')
    expect(firstCounts[0]?.dueAt).toBe(today())

    const secondRun = await runScheduleWorker()
    expect(secondRun.created).toBe(0)
    expect(await countsForSchedule(schedule.id)).toHaveLength(1)

    const afterSecond = await db
      .select()
      .from(countSchedule)
      .where(eq(countSchedule.id, schedule.id))
    expect(afterSecond[0]?.nextDueAt).toBe(advanceDueDate(today(), 'MONTHLY'))
  })

  it('clamps a month-end advance through the worker (31 Jan → 28 Feb)', async () => {
    const branchId = await createBranch('M')
    const fixture = await createProduct({ label: 'M1' })
    await stock(fixture.id, branchId, 2)

    const schedule = await createSchedule(adminCookie, {
      branchId,
      scope: 'ROTATION',
      frequency: 'MONTHLY',
      firstDueAt: '2026-01-31',
    })

    await runScheduleWorker()
    const counts = await countsForSchedule(schedule.id)
    expect(counts).toHaveLength(1)
    expect(counts[0]?.dueAt).toBe('2026-01-31')

    const advanced = await db.select().from(countSchedule).where(eq(countSchedule.id, schedule.id))
    expect(advanced[0]?.nextDueAt).toBe('2026-02-28')

    // A period with an open count is skipped and not advanced, so the worker
    // running again cannot roll it forward over a count nobody posted.
    await runScheduleWorker()
    const stillWaiting = await db
      .select()
      .from(countSchedule)
      .where(eq(countSchedule.id, schedule.id))
    expect(stillWaiting[0]?.nextDueAt).toBe('2026-02-28')
    expect(await countsForSchedule(schedule.id)).toHaveLength(1)
  })

  it('counts a never-stocked part at zero and creates its level row when posted', async () => {
    const branchId = await createBranch('N')
    const categories = await db
      .insert(category)
      .values([{ name: `Phantom Category ${suffix}` }])
      .returning({ id: category.id })
    const categoryId = categories[0]?.id ?? ''
    createdCategoryIds.push(categoryId)
    const phantom = await createProduct({ label: 'N1', categoryId })

    const schedule = await createSchedule(adminCookie, {
      branchId,
      scope: 'CATEGORY',
      categoryId,
      frequency: 'WEEKLY',
      firstDueAt: today(),
    })
    await runScheduleWorker()

    const counts = await countsForSchedule(schedule.id)
    expect(counts).toHaveLength(1)
    const countId = counts[0]?.id ?? ''
    const detail = await app.request(`/api/counts/${countId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(detail.status).toBe(200)
    const detailBody = await readJson<{ count: CountResponse }>(detail)
    const line = detailBody.count.lines.find((row) => row.productId === phantom.id)
    expect(line?.snapshotQty).toBe(0)

    const update = await setCounted(adminCookie, countId, [
      { productId: phantom.id, countedQty: 3 },
    ])
    expect(update.status).toBe(200)
    await postCount(adminCookie, countId)

    const levelRows = await db
      .select({ quantityOnHand: stockLevel.quantityOnHand })
      .from(stockLevel)
      .where(and(eq(stockLevel.productId, phantom.id), eq(stockLevel.branchId, branchId)))
    expect(levelRows[0]?.quantityOnHand).toBe(3)
    expect(await inventoryService.reconcileBranch(branchId)).toEqual([])
  })

  // --- Trigger counts --------------------------------------------------------

  it('raises a variance trigger only above the tolerance and only once while open', async () => {
    const branchId = await createBranch('V')
    const fixture = await createProduct({ label: 'V1', costPriceMinor: 1_000 })
    await stock(fixture.id, branchId, 100, 1_000)

    async function setTolerance(value: number) {
      const response = await app.request('/api/settings', {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({
          key: 'inventory.countVarianceToleranceMinor',
          value,
          branchId,
        }),
      })
      expect(response.status).toBe(200)
    }

    await setTolerance(2_000)
    const equal = await createCount(adminCookie, branchId)
    await setCounted(adminCookie, equal.id, [{ productId: fixture.id, countedQty: 98 }])
    await postCount(adminCookie, equal.id)

    const equalTriggers = await db
      .select()
      .from(stockCount)
      .where(and(eq(stockCount.branchId, branchId), eq(stockCount.triggerReason, 'VARIANCE')))
    // 2 units × 1 000 = exactly the tolerance: no trigger.
    expect(equalTriggers).toHaveLength(0)

    await setTolerance(1_999)
    const over = await createCount(adminCookie, branchId)
    await setCounted(adminCookie, over.id, [{ productId: fixture.id, countedQty: 96 }])
    await postCount(adminCookie, over.id)

    const overTriggers = await db
      .select()
      .from(stockCount)
      .where(and(eq(stockCount.branchId, branchId), eq(stockCount.triggerReason, 'VARIANCE')))
    expect(overTriggers).toHaveLength(1)
    expect(overTriggers[0]?.triggerProductId).toBe(fixture.id)
    expect(overTriggers[0]?.countType).toBe('TRIGGER')
    expect(overTriggers[0]?.triggerSourceId).toBe(over.id)
    expect(overTriggers[0]?.dueAt).toBe(advanceDueDate(today(), 'WEEKLY'))

    // Second over-tolerance variance for the same product: the partial unique
    // has an open trigger, so nothing new is raised and the post still succeeds.
    const repeat = await createCount(adminCookie, branchId)
    await setCounted(adminCookie, repeat.id, [{ productId: fixture.id, countedQty: 94 }])
    const repeated = await postCount(adminCookie, repeat.id)
    expect(repeated.status).toBe('POSTED')

    const afterRepeat = await db
      .select()
      .from(stockCount)
      .where(and(eq(stockCount.branchId, branchId), eq(stockCount.triggerReason, 'VARIANCE')))
    expect(afterRepeat).toHaveLength(1)
  })

  it('raises an oversell trigger at the second conflict, once, and not at one', async () => {
    const branchId = await createBranch('OV')
    const conflictProduct = await createProduct({ label: 'OS1' })
    const onceProduct = await createProduct({ label: 'OS2' })

    const terminalRows = await db
      .insert(terminal)
      .values({ branchId, code: `T${randomToken(3)}-OV`, name: `Cycle Terminal ${suffix}` })
      .returning({ id: terminal.id })
    const terminalId = terminalRows[0]?.id ?? ''
    createdTerminalIds.push(terminalId)

    const deviceRows = await db
      .insert(device)
      .values({ terminalId, fingerprint: `fp-${suffix}-ov`, tokenHash: `th-${suffix}-ov` })
      .returning({ id: device.id })
    const deviceId = deviceRows[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    async function addOversell(productId: string) {
      await db.insert(syncConflict).values({
        branchId,
        terminalId,
        deviceId,
        type: 'STOCK_OVERSELL',
        severity: 'HIGH',
        status: 'OPEN',
        details: { productId, requested: 2, available: 0 },
      })
    }

    await addOversell(conflictProduct.id)
    await addOversell(onceProduct.id)
    await countsService.scanOversellTriggers()

    const afterOne = await db
      .select()
      .from(stockCount)
      .where(and(eq(stockCount.branchId, branchId), eq(stockCount.triggerReason, 'OVERSELL')))
    expect(afterOne).toHaveLength(0)

    await addOversell(conflictProduct.id)
    await countsService.scanOversellTriggers()

    const afterTwo = await db
      .select()
      .from(stockCount)
      .where(and(eq(stockCount.branchId, branchId), eq(stockCount.triggerReason, 'OVERSELL')))
    expect(afterTwo).toHaveLength(1)
    expect(afterTwo[0]?.triggerProductId).toBe(conflictProduct.id)
    expect(afterTwo[0]?.countType).toBe('TRIGGER')

    // A third scan sees the same two conflicts but the open trigger blocks a
    // duplicate.
    await countsService.scanOversellTriggers()
    const afterThree = await db
      .select()
      .from(stockCount)
      .where(and(eq(stockCount.branchId, branchId), eq(stockCount.triggerReason, 'OVERSELL')))
    expect(afterThree).toHaveLength(1)
  })

  // --- ABC classes -----------------------------------------------------------

  it('derives A/B/C from 70/25/5 shares and honours a manual class until cleared', async () => {
    const branchId = await createBranch('ABC')
    const a = await createProduct({ label: 'A1' })
    const b = await createProduct({ label: 'B1' })
    const c = await createProduct({ label: 'C1' })

    // The ranking universe is the branch's level rows; value is zero so the
    // 90-day sold base decides the shares.
    await db.insert(stockLevel).values([
      { productId: a.id, branchId, quantityOnHand: 0, avgCostMinor: 0 },
      { productId: b.id, branchId, quantityOnHand: 0, avgCostMinor: 0 },
      { productId: c.id, branchId, quantityOnHand: 0, avgCostMinor: 0 },
    ])

    const terminalRows = await db
      .insert(terminal)
      .values({ branchId, code: `T${randomToken(3)}-AB`, name: `ABC Terminal ${suffix}` })
      .returning({ id: terminal.id })
    const terminalId = terminalRows[0]?.id ?? ''
    createdTerminalIds.push(terminalId)
    const deviceRows = await db
      .insert(device)
      .values({ terminalId, fingerprint: `fp-${suffix}-ab`, tokenHash: `th-${suffix}-ab` })
      .returning({ id: device.id })
    const deviceId = deviceRows[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    const shiftRows = await db
      .insert(shift)
      .values({
        number: `SH-${suffix}-AB`,
        branchId,
        terminalId,
        deviceId,
        cashierUserId: managerAId,
        cashierStaffId: 'GA-ABC',
        openedAt: new Date(),
      })
      .returning({ id: shift.id })
    const shiftId = shiftRows[0]?.id ?? ''

    const saleRows = await db
      .insert(sale)
      .values({
        receiptNumber: `RCP-${suffix}-AB`,
        branchId,
        terminalId,
        deviceId,
        shiftId,
        clientTransactionId: randomUUID(),
        cashierUserId: managerAId,
        cashierStaffId: 'GA-ABC',
        occurredAt: new Date(),
        subtotalMinor: 10_000,
        totalMinor: 10_000,
        tenderTotalMinor: 10_000,
        taxMode: 'INCLUSIVE',
      })
      .returning({ id: sale.id })
    const saleId = saleRows[0]?.id ?? ''

    await db.insert(saleLine).values(
      [
        { fixture: a, quantity: 7, unitPriceMinor: 1_000, baseMinor: 7_000 },
        { fixture: b, quantity: 5, unitPriceMinor: 500, baseMinor: 2_500 },
        { fixture: c, quantity: 1, unitPriceMinor: 500, baseMinor: 500 },
      ].map((line, index) => ({
        saleId,
        productId: line.fixture.id,
        lineNumber: index + 1,
        sku: line.fixture.sku,
        name: line.fixture.name,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        expectedUnitPriceMinor: line.unitPriceMinor,
        netMinor: line.baseMinor,
        taxableMinor: line.baseMinor,
        baseMinor: line.baseMinor,
        vatMinor: 0,
        nhilMinor: 0,
        getfundMinor: 0,
        taxTotalMinor: 0,
        totalMinor: line.baseMinor,
        taxCategory: 'STANDARD',
        unitCostMinor: 0,
        priceSource: 'CATALOG',
      })),
    )

    const sold = await posService.sumSoldValueByProduct(
      branchId,
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
    )
    expect(sold.get(a.id)).toBe(7_000)
    expect(sold.get(b.id)).toBe(2_500)
    expect(sold.get(c.id)).toBe(500)

    const recompute = await app.request('/api/counts/abc/recompute', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId }),
    })
    expect(recompute.status).toBe(200)
    const recomputed = await readJson<{ updated: number; skipped: number }>(recompute)
    expect(recomputed.updated).toBe(3)
    expect(recomputed.skipped).toBe(0)

    const list = await app.request(`/api/counts/abc?branchId=${branchId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(list.status).toBe(200)
    const listed = await readJson<{ classes: AbcRowResponse[] }>(list)
    const byProduct = new Map(listed.classes.map((row) => [row.productId, row]))
    expect(byProduct.get(a.id)?.class).toBe('A')
    expect(byProduct.get(b.id)?.class).toBe('B')
    expect(byProduct.get(c.id)?.class).toBe('C')
    expect(byProduct.get(a.id)?.soldMinor).toBe(7_000)

    const manual = await app.request(`/api/counts/abc/${c.id}`, {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId, abcClass: 'A', manual: true }),
    })
    expect(manual.status).toBe(200)

    const again = await app.request('/api/counts/abc/recompute', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId }),
    })
    expect(again.status).toBe(200)
    expect(await readJson<{ skipped: number }>(again)).toMatchObject({ skipped: 1 })

    const manualSurvived = await app.request(`/api/counts/abc?branchId=${branchId}`, {
      headers: authedHeaders(adminCookie),
    })
    const survivedBody = await readJson<{ classes: AbcRowResponse[] }>(manualSurvived)
    const survived = survivedBody.classes.find((row) => row.productId === c.id)
    expect(survived?.class).toBe('A')
    expect(survived?.isManual).toBe(true)

    const clear = await app.request(`/api/counts/abc/${c.id}`, {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId, abcClass: 'A', manual: false }),
    })
    expect(clear.status).toBe(200)
    await app.request('/api/counts/abc/recompute', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId }),
    })

    const derivedAgain = await app.request(`/api/counts/abc?branchId=${branchId}`, {
      headers: authedHeaders(adminCookie),
    })
    const derivedBody = await readJson<{ classes: AbcRowResponse[] }>(derivedAgain)
    const derived = derivedBody.classes.find((row) => row.productId === c.id)
    expect(derived?.class).toBe('C')
    expect(derived?.isManual).toBe(false)
  })

  it('keeps ABC edits admin-only even though managers hold inventory.threshold', async () => {
    const recompute = await app.request('/api/counts/abc/recompute', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({}),
    })
    expect(recompute.status).toBe(403)

    const patch = await app.request(`/api/counts/abc/${createdProductIds[0]}`, {
      method: 'PATCH',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ branchId: branchAId, abcClass: 'A', manual: true }),
    })
    expect(patch.status).toBe(403)
  })

  // --- Accuracy --------------------------------------------------------------

  it('counts a scheduled count posted on its due day as on time', async () => {
    const branchId = await createBranch('ONT')
    const fixture = await createProduct({ label: 'ONT1' })
    await stock(fixture.id, branchId, 5)

    const schedule = await createSchedule(adminCookie, {
      branchId,
      scope: 'ROTATION',
      frequency: 'WEEKLY',
      firstDueAt: today(),
    })
    await runScheduleWorker()
    const scheduled = await countsForSchedule(schedule.id)
    expect(scheduled).toHaveLength(1)
    const countId = scheduled[0]?.id ?? ''
    await setCounted(adminCookie, countId, [{ productId: fixture.id, countedQty: 5 }])
    await postCount(adminCookie, countId)

    const from = today()
    const response = await app.request(
      `/api/counts/accuracy?branchId=${branchId}&from=${from}&to=${from}`,
      { headers: authedHeaders(adminCookie) },
    )
    const accuracy = await readJson<AccuracyResponse>(response)
    expect(accuracy.countsPosted).toBe(1)
    expect(accuracy.countsOnTime).toBe(1)
    expect(accuracy.countedLines).toBe(1)
    expect(accuracy.matchedLines).toBe(1)
    expect(accuracy.accuracyBp).toBe(10_000)
  })

  it('reports accuracy in basis points and reconciles the variance value to the ledger', async () => {
    const branchId = await createBranch('ACC')
    const fixtures: ProductFixture[] = []
    for (let index = 0; index < 10; index += 1) {
      const fixture = await createProduct({ label: `AC${index}`, costPriceMinor: 500 })
      await stock(fixture.id, branchId, 10, 500)
      fixtures.push(fixture)
    }

    const count = await createCount(adminCookie, branchId)
    expect(count.lineCount).toBe(10)
    const variances = [-1, -2, -3]
    await setCounted(
      adminCookie,
      count.id,
      fixtures.map((fixture, index) => ({
        productId: fixture.id,
        countedQty: index < 7 ? 10 : 10 + (variances[index - 7] ?? 0),
      })),
    )
    await postCount(adminCookie, count.id)

    const from = today()
    const response = await app.request(
      `/api/counts/accuracy?branchId=${branchId}&from=${from}&to=${from}`,
      { headers: authedHeaders(adminCookie) },
    )
    expect(response.status).toBe(200)
    const accuracy = await readJson<AccuracyResponse>(response)
    expect(accuracy.accuracyBp).toBe(7_000)
    expect(accuracy.countedLines).toBe(10)
    expect(accuracy.matchedLines).toBe(7)
    expect(accuracy.countsPosted).toBe(1)
    // A manual count has no due date, so it is never "on time".
    expect(accuracy.countsOnTime).toBe(0)
    expect(accuracy.varianceValueMinor).toBe((1 + 2 + 3) * 500)

    const ledgerRows = await db
      .select({
        quantityDelta: stockMovement.quantityDelta,
        unitCostMinor: stockMovement.unitCostMinor,
      })
      .from(stockMovement)
      .where(and(eq(stockMovement.referenceType, 'COUNT'), eq(stockMovement.referenceId, count.id)))
    expect(ledgerRows).toHaveLength(3)
    const ledgerValue = ledgerRows.reduce(
      (sum, row) => sum + Math.abs(row.quantityDelta) * row.unitCostMinor,
      0,
    )
    expect(accuracy.varianceValueMinor).toBe(ledgerValue)
  })

  it('returns null — never zero — for a window with nothing counted', async () => {
    const branchId = await createBranch('EMP')
    const from = today()
    const response = await app.request(
      `/api/counts/accuracy?branchId=${branchId}&from=${from}&to=${from}`,
      { headers: authedHeaders(adminCookie) },
    )
    expect(response.status).toBe(200)
    const accuracy = await readJson<AccuracyResponse>(response)
    expect(accuracy.accuracyBp).toBeNull()
    expect(accuracy.countedLines).toBe(0)
    expect(accuracy.matchedLines).toBe(0)
    expect(accuracy.countsPosted).toBe(0)
  })

  it('returns the same accuracy from the analytics inventory read model', async () => {
    const branchId = await createBranch('PAR')
    const fixtures: ProductFixture[] = []
    for (let index = 0; index < 10; index += 1) {
      const fixture = await createProduct({ label: `PA${index}`, costPriceMinor: 250 })
      await stock(fixture.id, branchId, 4, 250)
      fixtures.push(fixture)
    }

    const count = await createCount(adminCookie, branchId)
    await setCounted(
      adminCookie,
      count.id,
      fixtures.map((fixture, index) => ({
        productId: fixture.id,
        countedQty: index < 7 ? 4 : 3,
      })),
    )
    await postCount(adminCookie, count.id)

    const from = today()
    const countsResponse = await app.request(
      `/api/counts/accuracy?branchId=${branchId}&from=${from}&to=${from}`,
      { headers: authedHeaders(adminCookie) },
    )
    const countsAccuracy = await readJson<AccuracyResponse>(countsResponse)

    const analyticsResponse = await app.request(
      `/api/analytics/inventory?branchId=${branchId}&from=${from}&to=${from}`,
      { headers: authedHeaders(adminCookie) },
    )
    expect(analyticsResponse.status).toBe(200)
    const analyticsBody = await readJson<{ countAccuracy: AccuracyResponse }>(analyticsResponse)
    expect(analyticsBody.countAccuracy).toMatchObject({
      accuracyBp: countsAccuracy.accuracyBp,
      countedLines: countsAccuracy.countedLines,
      matchedLines: countsAccuracy.matchedLines,
      countsPosted: countsAccuracy.countsPosted,
      countsOnTime: countsAccuracy.countsOnTime,
      varianceValueMinor: countsAccuracy.varianceValueMinor,
    })
  })

  it('refuses another branch manager the accuracy read', async () => {
    const from = today()
    const response = await app.request(
      `/api/counts/accuracy?branchId=${branchAId}&from=${from}&to=${from}`,
      { headers: authedHeaders(managerBCookie) },
    )
    expect(response.status).toBe(403)
  })
})
