import { type DbExecutor, db } from '@gikautos/db'
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm'
import {
  supplierInvoice,
  supplierPayment,
  supplierPaymentAllocation,
} from '../payables/payables.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier, supplierPaymentDetail, supplierProduct } from './suppliers.schema.ts'
import type {
  SupplierListRow,
  SupplierPaymentDetailRow,
  SupplierProductRow,
  SupplierProductView,
  SupplierSearchFilters,
  SupplierStatus,
} from './suppliers.types.ts'

const supplierListSelection = {
  id: supplier.id,
  code: supplier.code,
  name: supplier.name,
  contactName: supplier.contactName,
  phone: supplier.phone,
  email: supplier.email,
  paymentTermDays: supplier.paymentTermDays,
  status: supplier.status,
  createdAt: supplier.createdAt,
  updatedAt: supplier.updatedAt,
}

export async function insertSupplier(
  values: typeof supplier.$inferInsert,
  executor: DbExecutor = db,
): Promise<typeof supplier.$inferSelect | null> {
  const rows = await executor.insert(supplier).values(values).returning()
  return rows[0] ?? null
}

export async function findSupplierById(
  id: string,
  executor: DbExecutor = db,
): Promise<typeof supplier.$inferSelect | null> {
  const rows = await executor.select().from(supplier).where(eq(supplier.id, id)).limit(1)
  return rows[0] ?? null
}

export async function findSupplierByIdForUpdate(
  id: string,
  executor: DbExecutor = db,
): Promise<typeof supplier.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(supplier)
    .where(eq(supplier.id, id))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function findSupplierByCode(
  code: string,
  executor: DbExecutor = db,
): Promise<typeof supplier.$inferSelect | null> {
  const rows = await executor.select().from(supplier).where(eq(supplier.code, code)).limit(1)
  return rows[0] ?? null
}

export async function updateSupplierRow(
  id: string,
  patch: Partial<typeof supplier.$inferInsert>,
  executor: DbExecutor = db,
): Promise<typeof supplier.$inferSelect | null> {
  const rows = await executor.update(supplier).set(patch).where(eq(supplier.id, id)).returning()
  return rows[0] ?? null
}

export async function setSupplierStatus(
  id: string,
  status: SupplierStatus,
  executor: DbExecutor = db,
): Promise<typeof supplier.$inferSelect | null> {
  const rows = await executor
    .update(supplier)
    .set({ status })
    .where(eq(supplier.id, id))
    .returning()
  return rows[0] ?? null
}

function buildSupplierCondition(filters: SupplierSearchFilters): SQL | undefined {
  const conditions: SQL[] = []
  if (!filters.includeArchived) conditions.push(eq(supplier.status, 'ACTIVE'))

  if (filters.q) {
    const pattern = `%${filters.q}%`
    conditions.push(or(ilike(supplier.name, pattern), ilike(supplier.code, `${filters.q}%`)) as SQL)
  }

  return and(...conditions)
}

export async function selectSupplierPage(
  filters: SupplierSearchFilters,
): Promise<SupplierListRow[]> {
  return db
    .select(supplierListSelection)
    .from(supplier)
    .where(buildSupplierCondition(filters))
    .orderBy(asc(supplier.name), asc(supplier.id))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countSuppliers(filters: SupplierSearchFilters): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(supplier)
    .where(buildSupplierCondition(filters))
  return rows[0]?.total ?? 0
}

export async function insertPaymentDetail(
  values: typeof supplierPaymentDetail.$inferInsert,
  executor: DbExecutor = db,
): Promise<SupplierPaymentDetailRow | null> {
  const rows = await executor.insert(supplierPaymentDetail).values(values).returning()
  return rows[0] ?? null
}

export async function findPaymentDetailById(
  id: string,
  executor: DbExecutor = db,
): Promise<SupplierPaymentDetailRow | null> {
  const rows = await executor
    .select()
    .from(supplierPaymentDetail)
    .where(eq(supplierPaymentDetail.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function findPaymentDetailByAccount(
  supplierId: string,
  method: 'BANK' | 'MOMO',
  accountNumber: string,
  executor: DbExecutor = db,
): Promise<SupplierPaymentDetailRow | null> {
  const rows = await executor
    .select()
    .from(supplierPaymentDetail)
    .where(
      and(
        eq(supplierPaymentDetail.supplierId, supplierId),
        eq(supplierPaymentDetail.method, method),
        eq(supplierPaymentDetail.accountNumber, accountNumber),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function listPaymentDetailsBySupplier(
  supplierId: string,
  executor: DbExecutor = db,
): Promise<SupplierPaymentDetailRow[]> {
  return executor
    .select()
    .from(supplierPaymentDetail)
    .where(eq(supplierPaymentDetail.supplierId, supplierId))
    .orderBy(desc(supplierPaymentDetail.isDefault), asc(supplierPaymentDetail.createdAt))
}

export async function updatePaymentDetailRow(
  id: string,
  patch: Partial<typeof supplierPaymentDetail.$inferInsert>,
  executor: DbExecutor = db,
): Promise<SupplierPaymentDetailRow | null> {
  const rows = await executor
    .update(supplierPaymentDetail)
    .set(patch)
    .where(eq(supplierPaymentDetail.id, id))
    .returning()
  return rows[0] ?? null
}

/** Clears every default flag for a supplier so a new default can be set. */
export async function clearDefaultPaymentDetails(
  supplierId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(supplierPaymentDetail)
    .set({ isDefault: false })
    .where(
      and(
        eq(supplierPaymentDetail.supplierId, supplierId),
        eq(supplierPaymentDetail.isDefault, true),
      ),
    )
}

export async function insertSupplierProduct(
  values: typeof supplierProduct.$inferInsert,
  executor: DbExecutor = db,
): Promise<SupplierProductRow | null> {
  const rows = await executor.insert(supplierProduct).values(values).returning()
  return rows[0] ?? null
}

export async function findSupplierProductById(
  id: string,
  executor: DbExecutor = db,
): Promise<SupplierProductRow | null> {
  const rows = await executor
    .select()
    .from(supplierProduct)
    .where(eq(supplierProduct.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function findSupplierProduct(
  supplierId: string,
  productId: string,
  executor: DbExecutor = db,
): Promise<SupplierProductRow | null> {
  const rows = await executor
    .select()
    .from(supplierProduct)
    .where(
      and(eq(supplierProduct.supplierId, supplierId), eq(supplierProduct.productId, productId)),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function listSupplierProductsBySupplier(
  supplierId: string,
  executor: DbExecutor = db,
): Promise<SupplierProductView[]> {
  return executor
    .select({
      id: supplierProduct.id,
      supplierId: supplierProduct.supplierId,
      productId: supplierProduct.productId,
      productSku: product.sku,
      productName: product.name,
      supplierSku: supplierProduct.supplierSku,
      leadTimeDays: supplierProduct.leadTimeDays,
      lastCostMinor: supplierProduct.lastCostMinor,
      lastCostAt: supplierProduct.lastCostAt,
      isPreferred: supplierProduct.isPreferred,
      createdAt: supplierProduct.createdAt,
      updatedAt: supplierProduct.updatedAt,
    })
    .from(supplierProduct)
    .innerJoin(product, eq(product.id, supplierProduct.productId))
    .where(eq(supplierProduct.supplierId, supplierId))
    .orderBy(asc(product.name), asc(supplierProduct.id))
}

export async function updateSupplierProductRow(
  id: string,
  patch: Partial<typeof supplierProduct.$inferInsert>,
  executor: DbExecutor = db,
): Promise<SupplierProductRow | null> {
  const rows = await executor
    .update(supplierProduct)
    .set(patch)
    .where(eq(supplierProduct.id, id))
    .returning()
  return rows[0] ?? null
}

export async function deleteSupplierProductRow(
  id: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.delete(supplierProduct).where(eq(supplierProduct.id, id))
}

/** Ensures at most one preferred supplier per product (partial unique backs it). */
export async function clearPreferredSupplierProduct(
  productId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(supplierProduct)
    .set({ isPreferred: false })
    .where(and(eq(supplierProduct.productId, productId), eq(supplierProduct.isPreferred, true)))
}

/** Refreshes last-cost projections for mapped products after invoice recording. */
export async function updateLastCost(
  supplierId: string,
  productIds: readonly string[],
  costByProduct: ReadonlyMap<string, number>,
  occurredAt: Date,
  executor: DbExecutor = db,
): Promise<void> {
  if (productIds.length === 0) return
  const rows = await executor
    .select({ id: supplierProduct.id, productId: supplierProduct.productId })
    .from(supplierProduct)
    .where(
      and(
        eq(supplierProduct.supplierId, supplierId),
        inArray(supplierProduct.productId, [...productIds]),
      ),
    )

  for (const row of rows) {
    const cost = costByProduct.get(row.productId)
    if (cost === undefined) continue
    await executor
      .update(supplierProduct)
      .set({ lastCostMinor: cost, lastCostAt: occurredAt })
      .where(eq(supplierProduct.id, row.id))
  }
}

/**
 * The D9 owed figure for a supplier: invoice outstanding minus unallocated
 * payment remainders (on account), VOID documents excluded. Reads the payables
 * tables directly (schema-level seam) so suppliers stays free of a payables
 * service dependency.
 */
export async function sumSupplierOwed(
  supplierId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const outstandingRows = await executor
    .select({
      total:
        sql<number>`coalesce(sum(${supplierInvoice.totalMinor} - ${supplierInvoice.amountPaidMinor}), 0)`.mapWith(
          Number,
        ),
    })
    .from(supplierInvoice)
    .where(
      and(eq(supplierInvoice.supplierId, supplierId), sql`${supplierInvoice.status} <> 'VOID'`),
    )

  const paymentRows = await executor
    .select({
      total: sql<number>`coalesce(sum(${supplierPayment.amountMinor}), 0)`.mapWith(Number),
    })
    .from(supplierPayment)
    .where(and(eq(supplierPayment.supplierId, supplierId), eq(supplierPayment.status, 'COMPLETED')))

  const allocationRows = await executor
    .select({
      total: sql<number>`coalesce(sum(${supplierPaymentAllocation.amountMinor}), 0)`.mapWith(
        Number,
      ),
    })
    .from(supplierPaymentAllocation)
    .innerJoin(supplierPayment, eq(supplierPayment.id, supplierPaymentAllocation.paymentId))
    .where(and(eq(supplierPayment.supplierId, supplierId), eq(supplierPayment.status, 'COMPLETED')))

  const outstanding = outstandingRows[0]?.total ?? 0
  const onAccount = (paymentRows[0]?.total ?? 0) - (allocationRows[0]?.total ?? 0)
  return outstanding - onAccount
}
