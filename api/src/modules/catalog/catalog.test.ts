import { db } from '@gikautos/db'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
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
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { product } from '../products/products.schema.ts'
import { brand as brandTable, category as categoryTable, uom } from './catalog.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[catalog.test] database unavailable; integration tests skipped')

interface CategoryRecord {
  id: string
  name: string
  parentId: string | null
  isActive: boolean
}

interface CategoryTreeRecord extends CategoryRecord {
  children: CategoryRecord[]
}

interface BrandRecord {
  id: string
  name: string
  isActive: boolean
}

interface UomRecord {
  id: string
  code: string
  name: string
  isActive: boolean
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('catalog API', () => {
  const createdCategoryIds: string[] = []
  const createdBrandIds: string[] = []
  const createdProductIds: string[] = []
  const createdUomIds: string[] = []
  const createdUserIds: string[] = []
  let createdBranchId = ''
  let adminCookie = ''
  let managerCookie = ''
  let adminId = ''
  const suffix = uniqueSuffix()
  let fixtureCounter = 0

  beforeAll(async () => {
    const branchRows = await db
      .insert(branch)
      .values({
        code: `CT${randomToken(3)}`,
        name: 'Catalog Test Branch',
        type: 'RETAIL',
        city: 'Accra',
        createdBy: 'test',
      })
      .returning({ id: branch.id })
    if (!branchRows[0]) throw new Error('Could not create test branch')
    createdBranchId = branchRows[0].id

    const admin = await createTestUser({ role: 'ADMIN' })
    adminId = admin.id
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: createdBranchId,
      name: 'Catalog Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)
  })

  afterAll(async () => {
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdCategoryIds.length > 0) {
      await db
        .delete(categoryTable)
        .where(
          and(isNotNull(categoryTable.parentId), inArray(categoryTable.id, createdCategoryIds)),
        )
      await db.delete(categoryTable).where(inArray(categoryTable.id, createdCategoryIds))
    }
    if (createdBrandIds.length > 0) {
      await db.delete(brandTable).where(inArray(brandTable.id, createdBrandIds))
    }
    if (createdUomIds.length > 0) {
      await db.delete(uom).where(inArray(uom.id, createdUomIds))
    }
    if (createdBranchId) {
      await db.delete(branch).where(eq(branch.id, createdBranchId))
    }
  })

  async function createCategoryViaApi(payload: Record<string, unknown>): Promise<Response> {
    const response = await app.request('/api/categories', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify(payload),
    })
    if (response.status === 201) {
      const body = (await response.clone().json()) as { category: CategoryRecord }
      createdCategoryIds.push(body.category.id)
    }
    return response
  }

  async function createBrandViaApi(name: string): Promise<Response> {
    const response = await app.request('/api/brands', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ name }),
    })
    if (response.status === 201) {
      const body = (await response.clone().json()) as { brand: BrandRecord }
      createdBrandIds.push(body.brand.id)
    }
    return response
  }

  async function createUomViaApi(code: string, name: string): Promise<Response> {
    const response = await app.request('/api/uoms', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ code, name }),
    })
    if (response.status === 201) {
      const body = (await response.clone().json()) as { uom: UomRecord }
      createdUomIds.push(body.uom.id)
    }
    return response
  }

  async function insertTestProduct(options: {
    categoryId: string
    uomId: string
    brandId?: string | null
  }): Promise<string> {
    fixtureCounter += 1
    const rows = await db
      .insert(product)
      .values({
        sku: `TST-${suffix}-F${fixtureCounter}`,
        name: `Fixture product ${fixtureCounter}`,
        categoryId: options.categoryId,
        brandId: options.brandId ?? null,
        uomId: options.uomId,
        costPriceMinor: 500,
        basePriceMinor: 1_000,
        createdBy: 'test',
      })
      .returning({ id: product.id })
    if (!rows[0]) throw new Error('Could not create fixture product')
    createdProductIds.push(rows[0].id)
    return rows[0].id
  }

  it('rejects unauthenticated access', async () => {
    const response = await app.request('/api/categories')
    expect(response.status).toBe(401)
  })

  describe('category API', () => {
    it('lets an admin create a category and audits it', async () => {
      const response = await createCategoryViaApi({ name: `Engine ${suffix}` })

      expect(response.status).toBe(201)
      const body = await readJson<{ category: CategoryRecord }>(response)
      expect(body.category.name).toBe(`Engine ${suffix}`)
      expect(body.category.parentId).toBeNull()
      expect(body.category.isActive).toBe(true)

      const auditRows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'category'), eq(auditLog.entityId, body.category.id)))
      expect(
        auditRows.some((row) => row.action === 'category.created' && row.actorId === adminId),
      ).toBe(true)
    })

    it('rejects a duplicate name case-insensitively with 409', async () => {
      await createCategoryViaApi({ name: `Brakes ${suffix}` })
      const response = await createCategoryViaApi({ name: `brakes ${suffix}` })

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: { code: 'CONFLICT' } })
    })

    it('creates a child under a top-level category', async () => {
      const parentResponse = await createCategoryViaApi({ name: `Fluids ${suffix}` })
      const parent = (await readJson<{ category: CategoryRecord }>(parentResponse)).category

      const response = await createCategoryViaApi({
        name: `Oil ${suffix}`,
        parentId: parent.id,
      })

      expect(response.status).toBe(201)
      const body = await readJson<{ category: CategoryRecord }>(response)
      expect(body.category.parentId).toBe(parent.id)
    })

    it('rejects a third level with 409', async () => {
      const parentResponse = await createCategoryViaApi({ name: `Electrical ${suffix}` })
      const parent = (await readJson<{ category: CategoryRecord }>(parentResponse)).category

      const childResponse = await createCategoryViaApi({
        name: `Batteries ${suffix}`,
        parentId: parent.id,
      })
      const child = (await readJson<{ category: CategoryRecord }>(childResponse)).category

      const response = await createCategoryViaApi({
        name: `Lithium ${suffix}`,
        parentId: child.id,
      })

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: { message: expect.stringContaining('two levels') },
      })
    })

    it('rejects a child under an unknown parent with 404', async () => {
      const response = await createCategoryViaApi({
        name: `Ghost Child ${suffix}`,
        parentId: '00000000-0000-4000-8000-000000000000',
      })

      expect(response.status).toBe(404)
    })

    it('lets managers read but not create', async () => {
      const listResponse = await app.request('/api/categories', {
        headers: authedHeaders(managerCookie),
      })
      expect(listResponse.status).toBe(200)
      const list = await readJson<{ categories: CategoryTreeRecord[] }>(listResponse)
      expect(Array.isArray(list.categories)).toBe(true)

      const createResponse = await app.request('/api/categories', {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ name: `Manager Category ${suffix}` }),
      })
      expect(createResponse.status).toBe(403)
    })

    it('returns a two-level tree ordered by name', async () => {
      const parentResponse = await createCategoryViaApi({ name: `Tree ${suffix}` })
      const parent = (await readJson<{ category: CategoryRecord }>(parentResponse)).category

      await createCategoryViaApi({ name: `Tree Child B ${suffix}`, parentId: parent.id })
      await createCategoryViaApi({ name: `Tree Child A ${suffix}`, parentId: parent.id })

      const response = await app.request('/api/categories', {
        headers: authedHeaders(adminCookie),
      })
      const body = await readJson<{ categories: CategoryTreeRecord[] }>(response)

      const node = body.categories.find((item) => item.id === parent.id)
      expect(node).toBeDefined()
      expect(node?.children.map((child) => child.name)).toEqual([
        `Tree Child A ${suffix}`,
        `Tree Child B ${suffix}`,
      ])
    })

    it('renames a category and audits the change', async () => {
      const created = await createCategoryViaApi({ name: `Rename ${suffix}` })
      const category = (await readJson<{ category: CategoryRecord }>(created)).category

      const response = await app.request(`/api/categories/${category.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ name: `Renamed ${suffix}` }),
      })

      expect(response.status).toBe(200)
      const body = await readJson<{ category: CategoryRecord }>(response)
      expect(body.category.name).toBe(`Renamed ${suffix}`)

      const auditRows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'category'), eq(auditLog.entityId, category.id)))
      expect(auditRows.some((row) => row.action === 'category.updated')).toBe(true)
    })

    it('rejects renaming to an existing name with 409', async () => {
      const first = await createCategoryViaApi({ name: `Clash A ${suffix}` })
      const firstCategory = (await readJson<{ category: CategoryRecord }>(first)).category
      await createCategoryViaApi({ name: `Clash B ${suffix}` })

      const response = await app.request(`/api/categories/${firstCategory.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ name: `Clash B ${suffix}` }),
      })

      expect(response.status).toBe(409)
    })

    it('re-parents a child category to another parent', async () => {
      const parentOne = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Parent One ${suffix}` }),
        )
      ).category
      const parentTwo = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Parent Two ${suffix}` }),
        )
      ).category
      const child = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Mover ${suffix}`, parentId: parentOne.id }),
        )
      ).category

      const response = await app.request(`/api/categories/${child.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ parentId: parentTwo.id }),
      })

      expect(response.status).toBe(200)
      const body = await readJson<{ category: CategoryRecord }>(response)
      expect(body.category.parentId).toBe(parentTwo.id)
    })

    it('blocks re-parenting a category that has children with 409', async () => {
      const parent = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Stable Parent ${suffix}` }),
        )
      ).category
      await createCategoryViaApi({ name: `Stable Child ${suffix}`, parentId: parent.id })
      const otherParent = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Other Parent ${suffix}` }),
        )
      ).category

      const response = await app.request(`/api/categories/${parent.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ parentId: otherParent.id }),
      })

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: { message: expect.stringContaining('subcategories') },
      })
    })

    it('blocks re-parenting under a category that is itself a child with 409', async () => {
      const parent = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Deep Parent ${suffix}` }),
        )
      ).category
      const child = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Deep Child ${suffix}`, parentId: parent.id }),
        )
      ).category
      const mover = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Deep Mover ${suffix}` }),
        )
      ).category

      const response = await app.request(`/api/categories/${mover.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ parentId: child.id }),
      })

      expect(response.status).toBe(409)
    })

    it('blocks making a category its own parent with 409', async () => {
      const parent = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Self Parent ${suffix}` }),
        )
      ).category

      const response = await app.request(`/api/categories/${parent.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ parentId: parent.id }),
      })

      expect(response.status).toBe(409)
    })

    it('blocks archiving a category with active subcategories', async () => {
      const parent = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Busy Parent ${suffix}` }),
        )
      ).category
      await createCategoryViaApi({ name: `Active Child ${suffix}`, parentId: parent.id })

      const response = await app.request(`/api/categories/${parent.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: { message: expect.stringContaining('subcategories') },
      })
    })

    it('blocks archiving a category used by active products', async () => {
      const category = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Product Bound ${suffix}` }),
        )
      ).category

      const uomRows = await db
        .insert(uom)
        .values({ code: suffix, name: `Unit ${suffix}`, createdBy: 'test' })
        .returning({ id: uom.id })
      if (!uomRows[0]) throw new Error('Could not create test uom')
      createdUomIds.push(uomRows[0].id)

      const productRows = await db
        .insert(product)
        .values({
          sku: `TST-${suffix}-01`,
          name: 'Guard product',
          categoryId: category.id,
          uomId: uomRows[0].id,
          costPriceMinor: 500,
          basePriceMinor: 1_000,
          createdBy: 'test',
        })
        .returning({ id: product.id })
      if (!productRows[0]) throw new Error('Could not create test product')
      createdProductIds.push(productRows[0].id)

      const blocked = await app.request(`/api/categories/${category.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(blocked.status).toBe(409)
      expect(await blocked.json()).toMatchObject({
        error: { message: expect.stringContaining('active products') },
      })

      await db.update(product).set({ isActive: false }).where(eq(product.id, productRows[0].id))

      const allowed = await app.request(`/api/categories/${category.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(allowed.status).toBe(200)
    })

    it('archives and reactivates a category with audit rows', async () => {
      const category = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Lifecycle ${suffix}` }),
        )
      ).category

      const archiveResponse = await app.request(`/api/categories/${category.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(archiveResponse.status).toBe(200)
      expect(
        (await readJson<{ category: CategoryRecord }>(archiveResponse)).category.isActive,
      ).toBe(false)

      const reactivateResponse = await app.request(`/api/categories/${category.id}/reactivate`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(reactivateResponse.status).toBe(200)
      expect(
        (await readJson<{ category: CategoryRecord }>(reactivateResponse)).category.isActive,
      ).toBe(true)

      const auditRows = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'category'), eq(auditLog.entityId, category.id)))
      const actions = auditRows.map((row) => row.action)
      expect(actions).toContain('category.archived')
      expect(actions).toContain('category.reactivated')
    })

    it('blocks reactivating a child while its parent is archived', async () => {
      const parent = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Dormant Parent ${suffix}` }),
        )
      ).category
      const child = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Dormant Child ${suffix}`, parentId: parent.id }),
        )
      ).category

      await app.request(`/api/categories/${child.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      const parentArchive = await app.request(`/api/categories/${parent.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(parentArchive.status).toBe(200)

      const blocked = await app.request(`/api/categories/${child.id}/reactivate`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(blocked.status).toBe(409)

      await app.request(`/api/categories/${parent.id}/reactivate`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      const allowed = await app.request(`/api/categories/${child.id}/reactivate`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(allowed.status).toBe(200)
    })

    it('rejects creating a child under an archived parent', async () => {
      const parent = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Retired Parent ${suffix}` }),
        )
      ).category
      await app.request(`/api/categories/${parent.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })

      const response = await createCategoryViaApi({
        name: `Late Child ${suffix}`,
        parentId: parent.id,
      })
      expect(response.status).toBe(409)
    })

    it('hides archived categories unless includeArchived is set', async () => {
      const category = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Hidden ${suffix}` }),
        )
      ).category
      await app.request(`/api/categories/${category.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })

      const defaultResponse = await app.request('/api/categories', {
        headers: authedHeaders(adminCookie),
      })
      const defaultBody = await readJson<{ categories: CategoryTreeRecord[] }>(defaultResponse)
      expect(defaultBody.categories.some((item) => item.id === category.id)).toBe(false)

      const allResponse = await app.request('/api/categories?includeArchived=true', {
        headers: authedHeaders(adminCookie),
      })
      const allBody = await readJson<{ categories: CategoryTreeRecord[] }>(allResponse)
      expect(allBody.categories.some((item) => item.id === category.id)).toBe(true)
    })
  })

  describe('brand API', () => {
    it('lets an admin create a brand and audits it', async () => {
      const response = await createBrandViaApi(`Bosch ${suffix}`)

      expect(response.status).toBe(201)
      const body = await readJson<{ brand: BrandRecord }>(response)
      expect(body.brand.name).toBe(`Bosch ${suffix}`)
      expect(body.brand.isActive).toBe(true)

      const auditRows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'brand'), eq(auditLog.entityId, body.brand.id)))
      expect(
        auditRows.some((row) => row.action === 'brand.created' && row.actorId === adminId),
      ).toBe(true)
    })

    it('rejects a duplicate brand name case-insensitively with 409', async () => {
      await createBrandViaApi(`Denso ${suffix}`)
      const response = await createBrandViaApi(`denso ${suffix}`)

      expect(response.status).toBe(409)
    })

    it('lets managers list brands but not create them', async () => {
      const listResponse = await app.request('/api/brands', {
        headers: authedHeaders(managerCookie),
      })
      expect(listResponse.status).toBe(200)
      const list = await readJson<{ brands: BrandRecord[] }>(listResponse)
      expect(Array.isArray(list.brands)).toBe(true)

      const createResponse = await app.request('/api/brands', {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ name: `Manager Brand ${suffix}` }),
      })
      expect(createResponse.status).toBe(403)
    })

    it('renames a brand and blocks collisions', async () => {
      const first = (
        await readJson<{ brand: BrandRecord }>(await createBrandViaApi(`NGK ${suffix}`))
      ).brand
      await createBrandViaApi(`Febi ${suffix}`)

      const rename = await app.request(`/api/brands/${first.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ name: `NGK Renamed ${suffix}` }),
      })
      expect(rename.status).toBe(200)
      expect((await readJson<{ brand: BrandRecord }>(rename)).brand.name).toBe(
        `NGK Renamed ${suffix}`,
      )

      const collision = await app.request(`/api/brands/${first.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ name: `Febi ${suffix}` }),
      })
      expect(collision.status).toBe(409)
    })

    it('blocks archiving a brand used by active products', async () => {
      const brand = (
        await readJson<{ brand: BrandRecord }>(await createBrandViaApi(`Guard Brand ${suffix}`))
      ).brand
      const category = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Guard Brand Category ${suffix}` }),
        )
      ).category
      const uomRow = (
        await readJson<{ uom: UomRecord }>(
          await createUomViaApi(`G${suffix.slice(0, 7)}`, `Guard unit ${suffix}`),
        )
      ).uom
      const productId = await insertTestProduct({
        categoryId: category.id,
        uomId: uomRow.id,
        brandId: brand.id,
      })

      const blocked = await app.request(`/api/brands/${brand.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(blocked.status).toBe(409)
      expect(await blocked.json()).toMatchObject({
        error: { message: expect.stringContaining('active products') },
      })

      await db.update(product).set({ isActive: false }).where(eq(product.id, productId))

      const allowed = await app.request(`/api/brands/${brand.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(allowed.status).toBe(200)
    })

    it('archives and reactivates a brand with audit rows and hides it by default', async () => {
      const brand = (
        await readJson<{ brand: BrandRecord }>(await createBrandViaApi(`Lifecycle Brand ${suffix}`))
      ).brand

      const archiveResponse = await app.request(`/api/brands/${brand.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(archiveResponse.status).toBe(200)

      const defaultList = await app.request('/api/brands', {
        headers: authedHeaders(adminCookie),
      })
      const defaultBody = await readJson<{ brands: BrandRecord[] }>(defaultList)
      expect(defaultBody.brands.some((item) => item.id === brand.id)).toBe(false)

      const allList = await app.request('/api/brands?includeArchived=true', {
        headers: authedHeaders(adminCookie),
      })
      const allBody = await readJson<{ brands: BrandRecord[] }>(allList)
      expect(allBody.brands.some((item) => item.id === brand.id)).toBe(true)

      const reactivateResponse = await app.request(`/api/brands/${brand.id}/reactivate`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(reactivateResponse.status).toBe(200)
      expect((await readJson<{ brand: BrandRecord }>(reactivateResponse)).brand.isActive).toBe(true)

      const auditRows = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'brand'), eq(auditLog.entityId, brand.id)))
      const actions = auditRows.map((row) => row.action)
      expect(actions).toContain('brand.archived')
      expect(actions).toContain('brand.reactivated')
    })
  })

  describe('unit API', () => {
    it('creates a unit with an uppercase-normalized code and audits it', async () => {
      const code = `N${suffix.slice(0, 7)}`
      const response = await createUomViaApi(code.toLowerCase(), `Normalized ${suffix}`)

      expect(response.status).toBe(201)
      const body = await readJson<{ uom: UomRecord }>(response)
      expect(body.uom.code).toBe(code.toUpperCase())

      const auditRows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'uom'), eq(auditLog.entityId, body.uom.id)))
      expect(auditRows.some((row) => row.action === 'uom.created' && row.actorId === adminId)).toBe(
        true,
      )
    })

    it('rejects a duplicate unit code with 409', async () => {
      const code = `D${suffix.slice(0, 7)}`
      await createUomViaApi(code, `Duplicate ${suffix}`)
      const response = await createUomViaApi(code, `Duplicate two ${suffix}`)

      expect(response.status).toBe(409)
    })

    it('keeps the code immutable and renames only the name', async () => {
      const uom = (
        await readJson<{ uom: UomRecord }>(
          await createUomViaApi(`I${suffix.slice(0, 7)}`, `Immutable ${suffix}`),
        )
      ).uom

      const codeChange = await app.request(`/api/uoms/${uom.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ code: 'NEWCODE' }),
      })
      expect(codeChange.status).toBe(400)

      const rename = await app.request(`/api/uoms/${uom.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ name: `Renamed ${suffix}` }),
      })
      expect(rename.status).toBe(200)
      const body = await readJson<{ uom: UomRecord }>(rename)
      expect(body.uom.name).toBe(`Renamed ${suffix}`)
      expect(body.uom.code).toBe(`I${suffix.slice(0, 7).toUpperCase()}`)
    })

    it('lets managers list units but not create them', async () => {
      const listResponse = await app.request('/api/uoms', {
        headers: authedHeaders(managerCookie),
      })
      expect(listResponse.status).toBe(200)

      const createResponse = await app.request('/api/uoms', {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ code: 'MNG1', name: 'Manager unit' }),
      })
      expect(createResponse.status).toBe(403)
    })

    it('blocks archiving a unit used by active products', async () => {
      const uom = (
        await readJson<{ uom: UomRecord }>(
          await createUomViaApi(`A${suffix.slice(0, 7)}`, `Archived unit ${suffix}`),
        )
      ).uom
      const category = (
        await readJson<{ category: CategoryRecord }>(
          await createCategoryViaApi({ name: `Unit Guard Category ${suffix}` }),
        )
      ).category
      const productId = await insertTestProduct({ categoryId: category.id, uomId: uom.id })

      const blocked = await app.request(`/api/uoms/${uom.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(blocked.status).toBe(409)
      expect(await blocked.json()).toMatchObject({
        error: { message: expect.stringContaining('active products') },
      })

      await db.update(product).set({ isActive: false }).where(eq(product.id, productId))

      const allowed = await app.request(`/api/uoms/${uom.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(allowed.status).toBe(200)
    })

    it('reactivates an archived unit', async () => {
      const uom = (
        await readJson<{ uom: UomRecord }>(
          await createUomViaApi(`R${suffix.slice(0, 7)}`, `Revive unit ${suffix}`),
        )
      ).uom

      await app.request(`/api/uoms/${uom.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      const response = await app.request(`/api/uoms/${uom.id}/reactivate`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })

      expect(response.status).toBe(200)
      expect((await readJson<{ uom: UomRecord }>(response)).uom.isActive).toBe(true)
    })
  })
})
