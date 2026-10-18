import { db } from '@gikautos/db'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
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
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { setting } from '../platform/settings.schema.ts'
import { product } from './products.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[products.test] database unavailable; integration tests skipped')

interface CategoryRecord {
  id: string
  name: string
  parentId: string | null
  isActive: boolean
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

interface BarcodeRecord {
  id: string
  code: string
}

interface ProductRecord {
  id: string
  sku: string
  name: string
  description: string | null
  categoryId: string
  brandId: string | null
  uomId: string
  costPriceMinor: number
  basePriceMinor: number
  taxCategory: string
  isActive: boolean
  barcodes?: BarcodeRecord[]
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('products API', () => {
  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []
  const createdBrandIds: string[] = []
  const createdUomIds: string[] = []
  const createdUserIds: string[] = []
  const createdBranchIds: string[] = []
  let adminCookie = ''
  let managerCookie = ''
  let adminId = ''
  let managerBranchId = ''
  let otherBranchId = ''
  let activeCategoryId = ''
  let childCategoryId = ''
  let archivedCategoryId = ''
  let activeBrandId = ''
  let archivedBrandId = ''
  let activeUomId = ''
  let archivedUomId = ''
  const suffix = uniqueSuffix()
  const sequenceStart = 100_000 + Math.floor(Math.random() * 800_000)

  async function createCategoryViaApi(name: string, parentId?: string): Promise<CategoryRecord> {
    const response = await app.request('/api/categories', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify(parentId ? { name, parentId } : { name }),
    })
    if (response.status !== 201) {
      throw new Error(`category create failed (${response.status}): ${await response.text()}`)
    }
    const body = await readJson<{ category: CategoryRecord }>(response)
    createdCategoryIds.push(body.category.id)
    return body.category
  }

  async function archiveCategoryViaApi(id: string): Promise<void> {
    const response = await app.request(`/api/categories/${id}/archive`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    if (response.status !== 200) {
      throw new Error(`category archive failed (${response.status}): ${await response.text()}`)
    }
  }

  async function createBrandViaApi(name: string): Promise<BrandRecord> {
    const response = await app.request('/api/brands', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ name }),
    })
    if (response.status !== 201) {
      throw new Error(`brand create failed (${response.status}): ${await response.text()}`)
    }
    const body = await readJson<{ brand: BrandRecord }>(response)
    createdBrandIds.push(body.brand.id)
    return body.brand
  }

  async function archiveBrandViaApi(id: string): Promise<void> {
    const response = await app.request(`/api/brands/${id}/archive`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    if (response.status !== 200) {
      throw new Error(`brand archive failed (${response.status}): ${await response.text()}`)
    }
  }

  async function createUomViaApi(code: string, name: string): Promise<UomRecord> {
    const response = await app.request('/api/uoms', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ code, name }),
    })
    if (response.status !== 201) {
      throw new Error(`uom create failed (${response.status}): ${await response.text()}`)
    }
    const body = await readJson<{ uom: UomRecord }>(response)
    createdUomIds.push(body.uom.id)
    return body.uom
  }

  async function archiveUomViaApi(id: string): Promise<void> {
    const response = await app.request(`/api/uoms/${id}/archive`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    if (response.status !== 200) {
      throw new Error(`uom archive failed (${response.status}): ${await response.text()}`)
    }
  }

  async function createProductViaApi(payload: Record<string, unknown>): Promise<Response> {
    const response = await app.request('/api/products', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify(payload),
    })
    if (response.status === 201) {
      const body = (await response.clone().json()) as { product: ProductRecord }
      createdProductIds.push(body.product.id)
    }
    return response
  }

  function productPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: `Product ${suffix} ${Math.random().toString(36).slice(2, 7)}`,
      categoryId: activeCategoryId,
      brandId: activeBrandId,
      uomId: activeUomId,
      costPriceMinor: 5_000,
      basePriceMinor: 10_000,
      ...overrides,
    }
  }

  beforeAll(async () => {
    const branchRows = await db
      .insert(branch)
      .values([
        {
          code: `PT${randomToken(3)}A`,
          name: 'Products Test Branch',
          type: 'RETAIL',
          city: 'Accra',
          createdBy: 'test',
        },
        {
          code: `PT${randomToken(3)}B`,
          name: 'Products Other Branch',
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
    adminId = admin.id
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: managerBranchId,
      name: 'Products Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const sequenceSetting = and(eq(setting.key, 'catalog.skuSequence'), isNull(setting.branchId))
    await db
      .insert(setting)
      .values({ key: 'catalog.skuSequence', value: sequenceStart, updatedBy: 'test' })
      .onConflictDoNothing()
    await db.update(setting).set({ value: sequenceStart }).where(sequenceSetting)

    const activeCategory = await createCategoryViaApi(`Products Category ${suffix}`)
    activeCategoryId = activeCategory.id
    const childCategory = await createCategoryViaApi(`Products Child ${suffix}`, activeCategory.id)
    childCategoryId = childCategory.id
    const archivedCategory = await createCategoryViaApi(`Products Archived ${suffix}`)
    archivedCategoryId = archivedCategory.id
    await archiveCategoryViaApi(archivedCategory.id)

    const activeBrand = await createBrandViaApi(`Products Brand ${suffix}`)
    activeBrandId = activeBrand.id
    const archivedBrand = await createBrandViaApi(`Products Brand Old ${suffix}`)
    archivedBrandId = archivedBrand.id
    await archiveBrandViaApi(archivedBrand.id)

    const activeUom = await createUomViaApi(`P${suffix.slice(0, 7)}`, `Products Unit ${suffix}`)
    activeUomId = activeUom.id
    const archivedUom = await createUomViaApi(
      `Q${suffix.slice(0, 7)}`,
      `Products Unit Old ${suffix}`,
    )
    archivedUomId = archivedUom.id
    await archiveUomViaApi(archivedUom.id)
  })

  afterAll(async () => {
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdCategoryIds.length > 0) {
      await db
        .delete(category)
        .where(and(isNotNull(category.parentId), inArray(category.id, createdCategoryIds)))
      await db.delete(category).where(inArray(category.id, createdCategoryIds))
    }
    if (createdBrandIds.length > 0) {
      await db.delete(brand).where(inArray(brand.id, createdBrandIds))
    }
    if (createdUomIds.length > 0) {
      await db.delete(uom).where(inArray(uom.id, createdUomIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  describe('create', () => {
    it('rejects unauthenticated requests', async () => {
      const response = await app.request('/api/products', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(productPayload()),
      })
      expect(response.status).toBe(401)
    })

    it('lets an admin suggest a SKU without consuming it', async () => {
      const first = await app.request('/api/products/suggest-sku', {
        headers: authedHeaders(adminCookie),
      })
      expect(first.status).toBe(200)
      const firstBody = await readJson<{ sku: string }>(first)
      expect(firstBody.sku).toMatch(/^GIK-\d+$/)

      const second = await app.request('/api/products/suggest-sku', {
        headers: authedHeaders(adminCookie),
      })
      const secondBody = await readJson<{ sku: string }>(second)
      expect(secondBody.sku).toBe(firstBody.sku)

      const createResponse = await createProductViaApi(productPayload())
      expect(createResponse.status).toBe(201)
      const created = (await readJson<{ product: ProductRecord }>(createResponse)).product
      expect(created.sku).toBe(firstBody.sku)
    })

    it('lets managers not suggest or create', async () => {
      const suggest = await app.request('/api/products/suggest-sku', {
        headers: authedHeaders(managerCookie),
      })
      expect(suggest.status).toBe(403)

      const create = await app.request('/api/products', {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify(productPayload()),
      })
      expect(create.status).toBe(403)
    })

    it('creates a product with an explicit SKU, barcodes, and an audit snapshot', async () => {
      const sku = `WGT-${suffix}-01`
      const barcodeOne = `BC${suffix}-A01`
      const barcodeTwo = `BC${suffix}-A02`

      const response = await createProductViaApi(
        productPayload({
          sku: sku.toLowerCase(),
          name: `Widget ${suffix}`,
          description: 'A widget',
          barcodes: [barcodeOne, barcodeTwo, barcodeOne],
        }),
      )

      expect(response.status).toBe(201)
      const body = await readJson<{ product: ProductRecord }>(response)
      expect(body.product.sku).toBe(sku.toUpperCase())
      expect(body.product.barcodes?.map((item) => item.code)).toEqual([barcodeOne, barcodeTwo])

      const auditRows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'product'), eq(auditLog.entityId, body.product.id)))
      const createdRow = auditRows.find((row) => row.action === 'product.created')
      expect(createdRow?.actorId).toBe(adminId)
      const after = createdRow?.after as
        | { barcodes?: string[]; basePriceMinor?: number; costPriceMinor?: number }
        | undefined
      expect(after?.barcodes).toEqual([barcodeOne, barcodeTwo])
      expect(after?.basePriceMinor).toBe(10_000)
      expect(after?.costPriceMinor).toBe(5_000)
    })

    it('rejects a duplicate SKU with 409', async () => {
      const sku = `DUP-${suffix}-01`
      await createProductViaApi(productPayload({ sku }))
      const response = await createProductViaApi(productPayload({ sku }))

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: { message: expect.stringContaining('SKU') },
      })
    })

    it('rejects a duplicate barcode with 409 and names the code', async () => {
      const code = `BC${suffix}-DUP`
      await createProductViaApi(productPayload({ barcodes: [code] }))
      const response = await createProductViaApi(productPayload({ barcodes: [code] }))

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: { message: expect.stringContaining(code) },
      })
    })

    it('rejects archived references with 409', async () => {
      const archivedCategoryResponse = await createProductViaApi(
        productPayload({ categoryId: archivedCategoryId }),
      )
      expect(archivedCategoryResponse.status).toBe(409)
      expect(await archivedCategoryResponse.json()).toMatchObject({
        error: { message: expect.stringContaining('category is archived') },
      })

      const archivedBrandResponse = await createProductViaApi(
        productPayload({ brandId: archivedBrandId }),
      )
      expect(archivedBrandResponse.status).toBe(409)

      const archivedUomResponse = await createProductViaApi(
        productPayload({ uomId: archivedUomId }),
      )
      expect(archivedUomResponse.status).toBe(409)
    })

    it('rejects unknown references with 404', async () => {
      const response = await createProductViaApi(
        productPayload({ categoryId: '00000000-0000-4000-8000-000000000000' }),
      )
      expect(response.status).toBe(404)
    })

    it('rejects invalid payloads with 400', async () => {
      const negativePrice = await createProductViaApi(productPayload({ basePriceMinor: -1 }))
      expect(negativePrice.status).toBe(400)

      const badBarcode = await createProductViaApi(productPayload({ barcodes: ['ab'] }))
      expect(badBarcode.status).toBe(400)

      const shortName = await createProductViaApi(productPayload({ name: 'x' }))
      expect(shortName.status).toBe(400)
    })

    it('creates a product in a child category', async () => {
      const response = await createProductViaApi(productPayload({ categoryId: childCategoryId }))
      expect(response.status).toBe(201)
      const body = await readJson<{ product: ProductRecord }>(response)
      expect(body.product.categoryId).toBe(childCategoryId)
    })
  })
})
