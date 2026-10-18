import { randomUUID } from 'node:crypto'
import { db } from '@gikautos/db'
import { hash, type Options } from '@node-rs/argon2'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { brand, category, uom } from '../modules/catalog/catalog.schema.ts'
import { account, user } from '../modules/identity/staff.schema.ts'
import { branch } from '../modules/org/branches.schema.ts'
import { terminal } from '../modules/org/terminals.schema.ts'
import { setting } from '../modules/platform/settings.schema.ts'
import { barcode, product, productPrice } from '../modules/products/products.schema.ts'

type SeedRole = 'ADMIN' | 'MANAGER' | 'CASHIER'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const ARGON2ID = 2

/** Must stay in step with the API's Argon2 parameters. */
export const argon2Options: Options = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
  algorithm: ARGON2ID,
}

export function hashSeedPassword(password: string): Promise<string> {
  return hash(password, argon2Options)
}

export async function findUserByEmail(email: string) {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1)
  return rows[0] ?? null
}

export interface SeedUserInput {
  email: string
  name: string
  password: string
  role: SeedRole
  branchId?: string | null
  phone?: string | null
  mustChangePassword: boolean
}

export async function createUserWithCredential(
  tx: Tx,
  input: SeedUserInput,
): Promise<{ id: string; staffId: string }> {
  const staffId = await allocateStaffId(tx)
  const userId = randomUUID()
  const passwordHash = await hashSeedPassword(input.password)

  await tx.insert(user).values({
    id: userId,
    email: input.email.toLowerCase(),
    name: input.name,
    emailVerified: false,
    role: input.role,
    branchId: input.branchId ?? null,
    staffId,
    phone: input.phone ?? null,
    isActive: true,
    mustChangePassword: input.mustChangePassword,
  })

  await tx.insert(account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: passwordHash,
  })

  return { id: userId, staffId }
}

export async function allocateStaffId(tx: Tx): Promise<string> {
  const prefix = process.env.STAFF_ID_PREFIX?.trim() || 'GA'
  const start = Number.parseInt(process.env.STAFF_ID_START ?? '1', 10) || 1

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await tx
      .select({ id: setting.id, value: setting.value })
      .from(setting)
      .where(and(eq(setting.key, 'staff.idSequence'), isNull(setting.branchId)))
      .limit(1)
      .for('update')

    const row = rows[0]
    if (!row) {
      try {
        await tx.insert(setting).values({ key: 'staff.idSequence', value: start })
        continue
      } catch {
        continue
      }
    }

    const current = typeof row.value === 'number' && row.value > 0 ? row.value : start
    await tx
      .update(setting)
      .set({ value: current + 1 })
      .where(eq(setting.id, row.id))
    return `${prefix}-${String(current).padStart(4, '0')}`
  }

  throw new Error('Could not allocate a staff identifier')
}

export async function ensureSetting(key: string, value: unknown): Promise<boolean> {
  const existing = await db
    .select({ id: setting.id })
    .from(setting)
    .where(and(eq(setting.key, key), isNull(setting.branchId)))
    .limit(1)
  if (existing[0]) return false

  await db.insert(setting).values({ key, value, updatedBy: 'seed' }).onConflictDoNothing()
  return true
}

export async function ensureBranch(input: {
  code: string
  name: string
  type: 'RETAIL' | 'WAREHOUSE'
  city: string
  area?: string
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: branch.id })
    .from(branch)
    .where(eq(branch.code, input.code))
    .limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(branch)
    .values({
      code: input.code,
      name: input.name,
      type: input.type,
      city: input.city,
      area: input.area ?? null,
      createdBy: 'seed',
    })
    .onConflictDoNothing()
    .returning({ id: branch.id })

  if (rows[0]) return { id: rows[0].id, created: true }

  const raced = await db
    .select({ id: branch.id })
    .from(branch)
    .where(eq(branch.code, input.code))
    .limit(1)
  if (!raced[0]) throw new Error(`Could not create branch ${input.code}`)
  return { id: raced[0].id, created: false }
}

export async function ensureTerminal(input: {
  branchId: string
  code: string
  name: string
}): Promise<boolean> {
  const existing = await db
    .select({ id: terminal.id })
    .from(terminal)
    .where(eq(terminal.code, input.code))
    .limit(1)
  if (existing[0]) return false

  await db
    .insert(terminal)
    .values({
      branchId: input.branchId,
      code: input.code,
      name: input.name,
      createdBy: 'seed',
    })
    .onConflictDoNothing()
  return true
}

export async function ensureUom(input: {
  code: string
  name: string
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: uom.id })
    .from(uom)
    .where(eq(uom.code, input.code))
    .limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(uom)
    .values({ code: input.code, name: input.name, createdBy: 'seed' })
    .onConflictDoNothing()
    .returning({ id: uom.id })
  if (rows[0]) return { id: rows[0].id, created: true }

  const raced = await db.select({ id: uom.id }).from(uom).where(eq(uom.code, input.code)).limit(1)
  if (!raced[0]) throw new Error(`Could not create unit ${input.code}`)
  return { id: raced[0].id, created: false }
}

export async function ensureBrand(input: {
  name: string
}): Promise<{ id: string; created: boolean }> {
  const nameFilter = sql`lower(${brand.name}) = ${input.name.toLowerCase()}`
  const existing = await db.select({ id: brand.id }).from(brand).where(nameFilter).limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(brand)
    .values({ name: input.name, createdBy: 'seed' })
    .onConflictDoNothing()
    .returning({ id: brand.id })
  if (rows[0]) return { id: rows[0].id, created: true }

  const raced = await db.select({ id: brand.id }).from(brand).where(nameFilter).limit(1)
  if (!raced[0]) throw new Error(`Could not create brand ${input.name}`)
  return { id: raced[0].id, created: false }
}

export async function ensureCategory(input: {
  name: string
  parentId?: string | null
}): Promise<{ id: string; created: boolean }> {
  const nameFilter = sql`lower(${category.name}) = ${input.name.toLowerCase()}`
  const existing = await db.select({ id: category.id }).from(category).where(nameFilter).limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(category)
    .values({ name: input.name, parentId: input.parentId ?? null, createdBy: 'seed' })
    .onConflictDoNothing()
    .returning({ id: category.id })
  if (rows[0]) return { id: rows[0].id, created: true }

  const raced = await db.select({ id: category.id }).from(category).where(nameFilter).limit(1)
  if (!raced[0]) throw new Error(`Could not create category ${input.name}`)
  return { id: raced[0].id, created: false }
}

export async function ensureProduct(input: {
  sku: string
  name: string
  description?: string
  categoryId: string
  brandId?: string | null
  uomId: string
  costPriceMinor: number
  basePriceMinor: number
  taxCategory?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'
  barcodes?: readonly string[]
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: product.id })
    .from(product)
    .where(eq(product.sku, input.sku))
    .limit(1)
  if (existing[0]) return { id: existing[0].id, created: false }

  const rows = await db
    .insert(product)
    .values({
      sku: input.sku,
      name: input.name,
      description: input.description ?? null,
      categoryId: input.categoryId,
      brandId: input.brandId ?? null,
      uomId: input.uomId,
      costPriceMinor: input.costPriceMinor,
      basePriceMinor: input.basePriceMinor,
      taxCategory: input.taxCategory ?? 'STANDARD',
      createdBy: 'seed',
    })
    .onConflictDoNothing()
    .returning({ id: product.id })

  const createdId = rows[0]?.id
  if (!createdId) {
    const raced = await db
      .select({ id: product.id })
      .from(product)
      .where(eq(product.sku, input.sku))
      .limit(1)
    if (!raced[0]) throw new Error(`Could not create product ${input.sku}`)
    return { id: raced[0].id, created: false }
  }

  if (input.barcodes && input.barcodes.length > 0) {
    await db
      .insert(barcode)
      .values(input.barcodes.map((code) => ({ productId: createdId, code, createdBy: 'seed' })))
      .onConflictDoNothing()
  }

  return { id: createdId, created: true }
}

export async function ensureProductPrice(input: {
  productId: string
  branchId: string
  priceMinor: number
}): Promise<boolean> {
  const existing = await db
    .select({ id: productPrice.id })
    .from(productPrice)
    .where(
      and(eq(productPrice.productId, input.productId), eq(productPrice.branchId, input.branchId)),
    )
    .limit(1)
  if (existing[0]) return false

  await db
    .insert(productPrice)
    .values({
      productId: input.productId,
      branchId: input.branchId,
      priceMinor: input.priceMinor,
      updatedBy: 'seed',
    })
    .onConflictDoNothing()
  return true
}

export async function ensureSequenceAtLeast(key: string, value: number): Promise<boolean> {
  const rows = await db
    .select({ id: setting.id, value: setting.value })
    .from(setting)
    .where(and(eq(setting.key, key), isNull(setting.branchId)))
    .limit(1)
  const row = rows[0]

  if (!row) {
    await db.insert(setting).values({ key, value, updatedBy: 'seed' }).onConflictDoNothing()
    return true
  }

  const current = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : 0
  if (current >= value) return false

  await db.update(setting).set({ value, updatedBy: 'seed' }).where(eq(setting.id, row.id))
  return true
}
