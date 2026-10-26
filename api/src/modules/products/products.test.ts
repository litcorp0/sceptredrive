import { db } from '@sceptre/db'
import { resolveEffectivePrice } from '@sceptre/shared'
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
import { approval } from '../approvals/approvals.schema.ts'
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

  async function suggestSku(): Promise<string> {
    const response = await app.request('/api/products/suggest-sku', {
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(200)
    return ((await response.json()) as { sku: string }).sku
  }

  async function ensureSequence(value: number): Promise<void> {
    const sequenceFilter = and(eq(setting.key, 'catalog.skuSequence'), isNull(setting.branchId))
    await db
      .insert(setting)
      .values({ key: 'catalog.skuSequence', value, updatedBy: 'test' })
      .onConflictDoNothing()
    await db.update(setting).set({ value }).where(sequenceFilter)
  }

  function productPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: `Product ${suffix} ${Math.random().toString(36).slice(2, 7)}`,
      categoryId: activeCategoryId,
      brandId: activeBrandId,
      uomId: activeUomId,
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
      // Price-change requests reference the branch with RESTRICT, so the approvals
      // this suite raised go first.
      await db.delete(approval).where(inArray(approval.branchId, createdBranchIds))
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
      await ensureSequence(sequenceStart)

      const firstBody = { sku: await suggestSku() }
      expect(firstBody.sku).toMatch(/^GIK-\d+$/)

      const secondBody = { sku: await suggestSku() }
      expect(secondBody.sku).toBe(firstBody.sku)

      const createResponse = await createProductViaApi(productPayload({ sku: firstBody.sku }))
      expect(createResponse.status).toBe(201)
      const created = (await readJson<{ product: ProductRecord }>(createResponse)).product
      expect(created.sku).toBe(firstBody.sku)
    })

    it('advances the sequence past a suggested SKU that was saved explicitly', async () => {
      await ensureSequence(sequenceStart + 10_000)

      const firstSuggestion = await suggestSku()
      const explicit = await createProductViaApi(productPayload({ sku: firstSuggestion }))
      expect(explicit.status).toBe(201)

      const secondSuggestion = await suggestSku()
      const firstNumber = Number.parseInt(firstSuggestion.split('-')[1] ?? '0', 10)
      const secondNumber = Number.parseInt(secondSuggestion.split('-')[1] ?? '0', 10)
      expect(secondNumber).toBeGreaterThan(firstNumber)

      const autoResponse = await createProductViaApi(productPayload())
      expect(autoResponse.status).toBe(201)
      const auto = (await readJson<{ product: ProductRecord }>(autoResponse)).product
      expect(auto.sku).toBe(secondSuggestion)
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
      // Phase 11 (P11-D13): cost is derived from receipts, so a new product starts at zero.
      expect(after?.costPriceMinor).toBe(0)
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

  describe('update, archive, and barcodes', () => {
    async function createProductAndReturn(overrides: Record<string, unknown> = {}) {
      const response = await createProductViaApi(productPayload(overrides))
      expect(response.status).toBe(201)
      return (await readJson<{ product: ProductRecord }>(response)).product
    }

    it('updates a product with an audit diff', async () => {
      const created = await createProductAndReturn()

      const response = await app.request(`/api/products/${created.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({
          name: `Renamed ${suffix}`,
          basePriceMinor: 12_500,
          taxCategory: 'ZERO_RATED',
        }),
      })

      expect(response.status).toBe(200)
      const body = await readJson<{ product: ProductRecord }>(response)
      expect(body.product.name).toBe(`Renamed ${suffix}`)
      expect(body.product.basePriceMinor).toBe(12_500)
      expect(body.product.taxCategory).toBe('ZERO_RATED')

      const auditRows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'product'), eq(auditLog.entityId, created.id)))
      const updated = auditRows.find((row) => row.action === 'product.updated')
      expect((updated?.before as { name?: string } | undefined)?.name).toBe(created.name)
      expect((updated?.after as { name?: string } | undefined)?.name).toBe(`Renamed ${suffix}`)
    })

    it('changes the SKU and rejects a colliding SKU with 409', async () => {
      const first = await createProductAndReturn()
      const second = await createProductAndReturn()

      const change = await app.request(`/api/products/${first.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ sku: `MOVED-${suffix}-01` }),
      })
      expect(change.status).toBe(200)
      expect((await readJson<{ product: ProductRecord }>(change)).product.sku).toBe(
        `MOVED-${suffix.toUpperCase()}-01`,
      )

      const collision = await app.request(`/api/products/${first.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ sku: second.sku }),
      })
      expect(collision.status).toBe(409)
    })

    it('validates updated references and can clear the brand', async () => {
      const created = await createProductAndReturn()

      const archivedCategoryAttempt = await app.request(`/api/products/${created.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ categoryId: archivedCategoryId }),
      })
      expect(archivedCategoryAttempt.status).toBe(409)

      const unknownUomAttempt = await app.request(`/api/products/${created.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ uomId: '00000000-0000-4000-8000-000000000000' }),
      })
      expect(unknownUomAttempt.status).toBe(404)

      const clearBrand = await app.request(`/api/products/${created.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ brandId: null }),
      })
      expect(clearBrand.status).toBe(200)
      expect((await readJson<{ product: ProductRecord }>(clearBrand)).product.brandId).toBeNull()
    })

    it('edits a product that keeps an archived brand unchanged', async () => {
      const brand = await createBrandViaApi(`Retired Brand ${suffix}`)
      const created = await createProductAndReturn({ brandId: brand.id })

      const archiveProduct = await app.request(`/api/products/${created.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(archiveProduct.status).toBe(200)

      const archiveBrand = await app.request(`/api/brands/${brand.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(archiveBrand.status).toBe(200)

      const reactivateProduct = await app.request(`/api/products/${created.id}/reactivate`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(reactivateProduct.status).toBe(200)

      const response = await app.request(`/api/products/${created.id}`, {
        method: 'PATCH',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ name: `Kept brand ${suffix}`, brandId: brand.id }),
      })
      expect(response.status).toBe(200)
      expect((await readJson<{ product: ProductRecord }>(response)).product.brandId).toBe(brand.id)
    })

    it('forbids managers from updating products', async () => {
      const created = await createProductAndReturn()

      const response = await app.request(`/api/products/${created.id}`, {
        method: 'PATCH',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ name: 'Manager Edit' }),
      })
      expect(response.status).toBe(403)
    })

    it('archives and reactivates a product with audit rows', async () => {
      const created = await createProductAndReturn()

      const archive = await app.request(`/api/products/${created.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(archive.status).toBe(200)
      expect((await readJson<{ product: ProductRecord }>(archive)).product.isActive).toBe(false)

      const managerAttempt = await app.request(`/api/products/${created.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(managerCookie),
      })
      expect(managerAttempt.status).toBe(403)

      const reactivate = await app.request(`/api/products/${created.id}/reactivate`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(reactivate.status).toBe(200)
      expect((await readJson<{ product: ProductRecord }>(reactivate)).product.isActive).toBe(true)

      const auditRows = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'product'), eq(auditLog.entityId, created.id)))
      const actions = auditRows.map((row) => row.action)
      expect(actions).toContain('product.archived')
      expect(actions).toContain('product.reactivated')
    })

    it('returns product detail with barcodes and scopes overrides per role', async () => {
      const code = `DTL-${suffix}-01`
      const created = await createProductAndReturn({ barcodes: [code] })

      const response = await app.request(`/api/products/${created.id}`, {
        headers: authedHeaders(adminCookie),
      })
      expect(response.status).toBe(200)
      const body = await readJson<{ product: ProductRecord }>(response)
      expect(body.product.barcodes?.map((item) => item.code)).toEqual([code])
      expect(body.product.basePriceMinor).toBe(10_000)

      const managerResponse = await app.request(`/api/products/${created.id}`, {
        headers: authedHeaders(managerCookie),
      })
      expect(managerResponse.status).toBe(200)

      const missing = await app.request('/api/products/00000000-0000-4000-8000-000000000000', {
        headers: authedHeaders(adminCookie),
      })
      expect(missing.status).toBe(404)
    })

    it('adds and removes barcodes with conflict and scope checks', async () => {
      const created = await createProductAndReturn()
      const code = `ADD-${suffix}-01`

      const add = await app.request(`/api/products/${created.id}/barcodes`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ code }),
      })
      expect(add.status).toBe(201)
      const added = (await readJson<{ barcode: BarcodeRecord }>(add)).barcode
      expect(added.code).toBe(code)

      const duplicate = await app.request(`/api/products/${created.id}/barcodes`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ code }),
      })
      expect(duplicate.status).toBe(409)

      const missingProduct = await app.request(
        '/api/products/00000000-0000-4000-8000-000000000000/barcodes',
        {
          method: 'POST',
          headers: authedHeaders(adminCookie),
          body: JSON.stringify({ code: `ADD-${suffix}-02` }),
        },
      )
      expect(missingProduct.status).toBe(404)

      const other = await createProductAndReturn()
      const crossProduct = await app.request(`/api/products/${other.id}/barcodes/${added.id}`, {
        method: 'DELETE',
        headers: authedHeaders(adminCookie),
      })
      expect(crossProduct.status).toBe(404)

      const remove = await app.request(`/api/products/${created.id}/barcodes/${added.id}`, {
        method: 'DELETE',
        headers: authedHeaders(adminCookie),
      })
      expect(remove.status).toBe(200)

      const auditRows = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'product'), eq(auditLog.entityId, created.id)))
      const actions = auditRows.map((row) => row.action)
      expect(actions).toContain('product.barcode.added')
      expect(actions).toContain('product.barcode.removed')
    })
  })

  describe('price overrides', () => {
    async function createProductAndReturn() {
      const response = await createProductViaApi(productPayload())
      expect(response.status).toBe(201)
      return (await readJson<{ product: ProductRecord }>(response)).product
    }

    interface OverrideRecord {
      id: string
      productId: string
      branchId: string
      priceMinor: number
    }

    interface AppliedPrice {
      status: 'APPLIED' | 'PENDING_APPROVAL'
      priceMinor?: number
      approvalId?: string
    }

    it('lets admins set an override for any branch and upsert it later', async () => {
      const created = await createProductAndReturn()

      const first = await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ branchId: managerBranchId, priceMinor: 9_000 }),
      })
      expect(first.status).toBe(200)
      const firstBody = await readJson<AppliedPrice>(first)
      expect(firstBody.status).toBe('APPLIED')
      expect(firstBody.priceMinor).toBe(9_000)

      const second = await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ branchId: managerBranchId, priceMinor: 8_750 }),
      })
      expect(second.status).toBe(200)
      const secondBody = await readJson<AppliedPrice>(second)
      expect(secondBody.status).toBe('APPLIED')
      expect(secondBody.priceMinor).toBe(8_750)

      const otherBranch = await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ branchId: otherBranchId, priceMinor: 10_500 }),
      })
      expect(otherBranch.status).toBe(200)
    })

    it('lets managers set only their own branch override', async () => {
      const created = await createProductAndReturn()

      const own = await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ branchId: managerBranchId, priceMinor: 9_250 }),
      })
      expect(own.status).toBe(200)

      const foreign = await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ branchId: otherBranchId, priceMinor: 9_250 }),
      })
      expect(foreign.status).toBe(403)
    })

    it('rejects overrides on unknown or inactive branches and bad products', async () => {
      const created = await createProductAndReturn()

      const unknownBranch = await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({
          branchId: '00000000-0000-4000-8000-000000000000',
          priceMinor: 1_000,
        }),
      })
      expect(unknownBranch.status).toBe(404)

      const negativePrice = await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ branchId: managerBranchId, priceMinor: -5 }),
      })
      expect(negativePrice.status).toBe(400)

      const branchRows = await db
        .insert(branch)
        .values({
          code: `PT${randomToken(3)}C`,
          name: 'Inactive Branch',
          type: 'RETAIL',
          city: 'Tema',
          createdBy: 'test',
        })
        .returning({ id: branch.id })
      if (!branchRows[0]) throw new Error('Could not create inactive branch')
      createdBranchIds.push(branchRows[0].id)
      const deactivate = await app.request(`/api/branches/${branchRows[0].id}/deactivate`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })
      expect(deactivate.status).toBe(200)

      const inactiveBranch = await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ branchId: branchRows[0].id, priceMinor: 1_000 }),
      })
      expect(inactiveBranch.status).toBe(409)

      const unknownProduct = await app.request(
        '/api/products/00000000-0000-4000-8000-000000000000/prices',
        {
          method: 'PUT',
          headers: authedHeaders(adminCookie),
          body: JSON.stringify({ branchId: managerBranchId, priceMinor: 1_000 }),
        },
      )
      expect(unknownProduct.status).toBe(404)
    })

    it('scopes GET prices per role and audits set and remove', async () => {
      const created = await createProductAndReturn()
      await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ branchId: managerBranchId, priceMinor: 9_000 }),
      })
      await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ branchId: otherBranchId, priceMinor: 10_500 }),
      })

      const adminView = await app.request(`/api/products/${created.id}/prices`, {
        headers: authedHeaders(adminCookie),
      })
      expect(adminView.status).toBe(200)
      const adminBody = await readJson<{ basePriceMinor: number; overrides: OverrideRecord[] }>(
        adminView,
      )
      expect(adminBody.basePriceMinor).toBe(10_000)
      expect(adminBody.overrides).toHaveLength(2)

      const managerView = await app.request(`/api/products/${created.id}/prices`, {
        headers: authedHeaders(managerCookie),
      })
      const managerBody = await readJson<{ basePriceMinor: number; overrides: OverrideRecord[] }>(
        managerView,
      )
      expect(managerBody.overrides).toHaveLength(1)
      expect(managerBody.overrides[0]?.branchId).toBe(managerBranchId)

      // The branch price is 9 000 against a 10 000 base: deleting it is an 11.1%
      // move, so a manager's removal is a request like any other change (P12-D19).
      const remove = await app.request(`/api/products/${created.id}/prices/${managerBranchId}`, {
        method: 'DELETE',
        headers: authedHeaders(managerCookie),
      })
      expect(remove.status).toBe(200)
      const removeBody = await readJson<{ status: string; approvalId: string }>(remove)
      expect(removeBody.status).toBe('PENDING_APPROVAL')

      const approve = await app.request(`/api/approvals/${removeBody.approvalId}/decide`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ decision: 'APPROVED' }),
      })
      expect(approve.status).toBe(200)

      const removeAgain = await app.request(
        `/api/products/${created.id}/prices/${managerBranchId}`,
        { method: 'DELETE', headers: authedHeaders(managerCookie) },
      )
      expect(removeAgain.status).toBe(404)

      const removeForeign = await app.request(
        `/api/products/${created.id}/prices/${otherBranchId}`,
        { method: 'DELETE', headers: authedHeaders(managerCookie) },
      )
      expect(removeForeign.status).toBe(403)

      const auditRows = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'product'), eq(auditLog.entityId, created.id)))
      const actions = auditRows.map((row) => row.action)
      expect(actions).toContain('product.price.override_set')
      expect(actions).toContain('product.price.override_removed')
    })
  })

  describe('list and search', () => {
    interface ProductListItem {
      id: string
      sku: string
      name: string
      categoryName: string
      brandName: string | null
      uomCode: string
      basePriceMinor: number
      effectivePriceMinor: number | null
      barcodeCount: number
      isActive: boolean
      taxCategory: string
    }

    interface ProductListResponse {
      products: ProductListItem[]
      total: number
      branchId: string | null
    }

    async function createProductAndReturn(overrides: Record<string, unknown> = {}) {
      const response = await createProductViaApi(productPayload(overrides))
      expect(response.status).toBe(201)
      return (await readJson<{ product: ProductRecord }>(response)).product
    }

    async function listFor(query: Record<string, string>, cookie = adminCookie) {
      const params = new URLSearchParams(query)
      const response = await app.request(`/api/products?${params.toString()}`, {
        headers: authedHeaders(cookie),
      })
      expect(response.status).toBe(200)
      return readJson<ProductListResponse>(response)
    }

    it('finds a product by name substring, SKU prefix, and exact barcode', async () => {
      const token = `srch${suffix}`
      const created = await createProductAndReturn({
        name: `Filter ${token} one`,
        sku: `SRCH-${suffix}-N1`,
        barcodes: [`BRC${suffix}A1`],
      })

      const byName = await listFor({ q: token })
      expect(byName.products.map((item) => item.id)).toEqual([created.id])

      const bySkuPrefix = await listFor({ q: `SRCH-${suffix}` })
      expect(bySkuPrefix.products.map((item) => item.id)).toContain(created.id)
      expect(bySkuPrefix.products[0]?.id).toBe(created.id)

      const byBarcode = await listFor({ q: `BRC${suffix}A1` })
      expect(byBarcode.products.map((item) => item.id)).toEqual([created.id])

      const row = byName.products[0]
      expect(row?.sku).toBe(`SRCH-${suffix.toUpperCase()}-N1`)
      expect(row?.categoryName.startsWith('Products Category')).toBe(true)
      expect(row?.uomCode).toBe(`P${suffix.slice(0, 7).toUpperCase()}`)
      expect(row?.basePriceMinor).toBe(10_000)
      expect(row?.effectivePriceMinor).toBeNull()
      expect(row?.barcodeCount).toBe(1)
      expect(row?.isActive).toBe(true)
      expect(row?.taxCategory).toBe('STANDARD')
    })

    it('matches literal percent signs in search terms', async () => {
      const created = await createProductAndReturn({ name: `Rare % item ${suffix}` })
      const response = await listFor({ q: '% item' })
      expect(response.products.map((item) => item.id)).toContain(created.id)
      expect(response.products).toHaveLength(1)
    })

    it('filters by category including subcategories', async () => {
      const token = `catfil${suffix}`
      const inParent = await createProductAndReturn({ name: `Parent ${token}` })
      const inChild = await createProductAndReturn({
        name: `Child ${token}`,
        categoryId: childCategoryId,
      })

      const response = await listFor({ q: token, categoryId: activeCategoryId })
      expect(response.total).toBe(2)
      const ids = response.products.map((item) => item.id)
      expect(ids).toContain(inParent.id)
      expect(ids).toContain(inChild.id)
    })

    it('filters by brand', async () => {
      const token = `brfil${suffix}`
      const secondBrand = await createBrandViaApi(`Second Brand ${suffix}`)
      const withFirst = await createProductAndReturn({
        name: `First brand ${token}`,
        brandId: activeBrandId,
      })
      await createProductAndReturn({
        name: `Second brand ${token}`,
        brandId: secondBrand.id,
      })

      const response = await listFor({ q: token, brandId: activeBrandId })
      expect(response.total).toBe(1)
      expect(response.products[0]?.id).toBe(withFirst.id)
    })

    it('hides archived products unless includeArchived is requested', async () => {
      const token = `arch${suffix}`
      const created = await createProductAndReturn({ name: `Archived ${token}` })
      await app.request(`/api/products/${created.id}/archive`, {
        method: 'POST',
        headers: authedHeaders(adminCookie),
      })

      const hidden = await listFor({ q: token })
      expect(hidden.total).toBe(0)

      const shown = await listFor({ q: token, includeArchived: 'true' })
      expect(shown.total).toBe(1)
      expect(shown.products[0]?.isActive).toBe(false)
    })

    it('paginates with a stable total', async () => {
      const token = `page${suffix}`
      for (let index = 0; index < 3; index += 1) {
        await createProductAndReturn({ name: `Paged ${token} ${index}` })
      }

      const firstPage = await listFor({ q: token, limit: '2', offset: '0' })
      expect(firstPage.total).toBe(3)
      expect(firstPage.products).toHaveLength(2)

      const secondPage = await listFor({ q: token, limit: '2', offset: '2' })
      expect(secondPage.total).toBe(3)
      expect(secondPage.products).toHaveLength(1)
    })

    it('resolves branch-aware effective prices per role', async () => {
      const token = `price${suffix}`
      const created = await createProductAndReturn({
        name: `Priced ${token}`,
        basePriceMinor: 10_000,
      })
      const overrideResponse = await app.request(`/api/products/${created.id}/prices`, {
        method: 'PUT',
        headers: authedHeaders(adminCookie),
        body: JSON.stringify({ branchId: managerBranchId, priceMinor: 8_800 }),
      })
      expect(overrideResponse.status).toBe(200)

      const expected = resolveEffectivePrice(10_000, 8_800)

      const adminScoped = await listFor({ q: token, branchId: managerBranchId })
      expect(adminScoped.products[0]?.effectivePriceMinor).toBe(expected)
      expect(adminScoped.branchId).toBe(managerBranchId)

      const adminUnscoped = await listFor({ q: token })
      expect(adminUnscoped.products[0]?.effectivePriceMinor).toBeNull()
      expect(adminUnscoped.branchId).toBeNull()

      const managerScoped = await listFor({ q: token }, managerCookie)
      expect(managerScoped.products[0]?.effectivePriceMinor).toBe(expected)
      expect(managerScoped.branchId).toBe(managerBranchId)

      const managerForeign = await app.request(
        `/api/products?q=${token}&branchId=${otherBranchId}`,
        { headers: authedHeaders(managerCookie) },
      )
      expect(managerForeign.status).toBe(403)
    })

    it('falls back to the base price when a branch has no override', async () => {
      const token = `basep${suffix}`
      const created = await createProductAndReturn({
        name: `Base price ${token}`,
        basePriceMinor: 7_700,
      })

      const response = await listFor({ q: token, branchId: otherBranchId })
      expect(response.products[0]?.id).toBe(created.id)
      expect(response.products[0]?.effectivePriceMinor).toBe(7_700)
    })
  })
})
