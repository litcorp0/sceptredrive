import { type DbExecutor, db } from '@sceptre/db'
import { isRole } from '@sceptre/shared'
import { and, desc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { creditProfile } from '../credit/credit.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { terminal } from '../org/terminals.schema.ts'
import { setting } from '../platform/settings.schema.ts'
import { product, productPrice } from '../products/products.schema.ts'
import {
  cashMovement,
  posStaffBinding,
  type ShiftReviewStatus,
  sale,
  saleLine,
  saleTender,
  shift,
  syncConflict,
} from './pos.schema.ts'
import type { DeviceStaffRecord, ShiftCashTotals } from './pos.types.ts'

/** Signs in a staff member by staff code, email, or both (whichever was supplied). */
export async function findStaffForAuthorization(
  identity: { staffCode?: string | undefined; email?: string | undefined },
  executor: DbExecutor = db,
): Promise<DeviceStaffRecord | null> {
  const conditions = []
  if (identity.staffCode) conditions.push(eq(userTable.staffId, identity.staffCode))
  if (identity.email) conditions.push(eq(userTable.email, identity.email.toLowerCase()))
  if (conditions.length === 0) return null

  const rows = await executor
    .select({
      userId: userTable.id,
      staffId: userTable.staffId,
      name: userTable.name,
      role: userTable.role,
      branchId: userTable.branchId,
      isActive: userTable.isActive,
      pinHash: userTable.pinHash,
      pinVersion: userTable.pinVersion,
      pinMustChange: userTable.pinMustChange,
    })
    .from(userTable)
    .where(and(...conditions))
    .limit(1)

  const row = rows[0]
  if (!row || !row.staffId || !isRole(row.role)) return null
  return { ...row, staffId: row.staffId, role: row.role }
}

/** Resolves a binding from its hashed token, joined to the owning staff member. */
export async function findBindingByTokenHash(
  tokenHash: string,
  executor: DbExecutor = db,
): Promise<{
  binding: typeof posStaffBinding.$inferSelect
  staff: DeviceStaffRecord
} | null> {
  const rows = await executor
    .select({
      binding: posStaffBinding,
      userId: userTable.id,
      staffId: userTable.staffId,
      name: userTable.name,
      role: userTable.role,
      branchId: userTable.branchId,
      isActive: userTable.isActive,
      pinHash: userTable.pinHash,
      pinVersion: userTable.pinVersion,
      pinMustChange: userTable.pinMustChange,
    })
    .from(posStaffBinding)
    .innerJoin(userTable, eq(posStaffBinding.staffUserId, userTable.id))
    .where(eq(posStaffBinding.bindingTokenHash, tokenHash))
    .limit(1)

  const row = rows[0]
  if (!row || !row.staffId || !isRole(row.role)) return null

  return {
    binding: row.binding,
    staff: {
      userId: row.userId,
      staffId: row.staffId,
      name: row.name,
      role: row.role,
      branchId: row.branchId,
      isActive: row.isActive,
      pinHash: row.pinHash,
      pinVersion: row.pinVersion,
      pinMustChange: row.pinMustChange,
    },
  }
}

export async function findActiveBinding(
  deviceId: string,
  staffUserId: string,
  executor: DbExecutor = db,
): Promise<typeof posStaffBinding.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(posStaffBinding)
    .where(
      and(
        eq(posStaffBinding.deviceId, deviceId),
        eq(posStaffBinding.staffUserId, staffUserId),
        isNull(posStaffBinding.revokedAt),
        gt(posStaffBinding.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function insertBinding(
  values: typeof posStaffBinding.$inferInsert,
  executor: DbExecutor = db,
): Promise<typeof posStaffBinding.$inferSelect> {
  const rows = await executor.insert(posStaffBinding).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to create the staff binding')
  return row
}

export async function revokeStaffBindings(
  staffUserId: string,
  revokedBy: string | null,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .update(posStaffBinding)
    .set({ revokedAt: new Date(), revokedBy })
    .where(and(eq(posStaffBinding.staffUserId, staffUserId), isNull(posStaffBinding.revokedAt)))
    .returning({ id: posStaffBinding.id })
  return rows.length
}

export async function revokeBinding(
  bindingId: string,
  revokedBy: string | null,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(posStaffBinding)
    .set({ revokedAt: new Date(), revokedBy })
    .where(eq(posStaffBinding.id, bindingId))
}

export async function touchBinding(bindingId: string, executor: DbExecutor = db): Promise<void> {
  await executor
    .update(posStaffBinding)
    .set({ lastUsedAt: new Date() })
    .where(eq(posStaffBinding.id, bindingId))
}

export async function updateStaffPinHash(
  userId: string,
  pinHash: string,
  executor: DbExecutor = db,
): Promise<number | null> {
  const rows = await executor
    .update(userTable)
    .set({
      pinHash,
      pinVersion: sql`${userTable.pinVersion} + 1`,
      pinMustChange: false,
    })
    .where(eq(userTable.id, userId))
    .returning({ pinVersion: userTable.pinVersion })
  return rows[0]?.pinVersion ?? null
}

/** Finds a staff member by id for the change-PIN path. */
export async function findStaffById(
  userId: string,
  executor: DbExecutor = db,
): Promise<DeviceStaffRecord | null> {
  const rows = await executor
    .select({
      userId: userTable.id,
      staffId: userTable.staffId,
      name: userTable.name,
      role: userTable.role,
      branchId: userTable.branchId,
      isActive: userTable.isActive,
      pinHash: userTable.pinHash,
      pinVersion: userTable.pinVersion,
      pinMustChange: userTable.pinMustChange,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)

  const row = rows[0]
  if (!row || !row.staffId || !isRole(row.role)) return null
  return { ...row, staffId: row.staffId, role: row.role }
}

// --- Shifts -----------------------------------------------------------------

/** Locks the terminal row so two devices cannot open shifts concurrently. */
export async function lockTerminal(
  terminalId: string,
  executor: DbExecutor = db,
): Promise<{ id: string; branchId: string; isActive: boolean } | null> {
  const rows = await executor
    .select({ id: terminal.id, branchId: terminal.branchId, isActive: terminal.isActive })
    .from(terminal)
    .where(eq(terminal.id, terminalId))
    .for('update')
  return rows[0] ?? null
}

export async function findOpenShiftByTerminal(
  terminalId: string,
  executor: DbExecutor = db,
): Promise<typeof shift.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(shift)
    .where(and(eq(shift.terminalId, terminalId), eq(shift.status, 'OPEN')))
    .limit(1)
  return rows[0] ?? null
}

export async function findShiftByIdForUpdate(
  shiftId: string,
  executor: DbExecutor = db,
): Promise<typeof shift.$inferSelect | null> {
  const rows = await executor.select().from(shift).where(eq(shift.id, shiftId)).for('update')
  return rows[0] ?? null
}

export async function insertShift(
  values: typeof shift.$inferInsert,
  executor: DbExecutor = db,
): Promise<typeof shift.$inferSelect> {
  const rows = await executor.insert(shift).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to insert the shift')
  return row
}

export async function insertCashMovement(
  values: typeof cashMovement.$inferInsert,
  executor: DbExecutor = db,
): Promise<typeof cashMovement.$inferSelect> {
  const rows = await executor.insert(cashMovement).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to insert the cash movement')
  return row
}

/**
 * Recomputes a shift's expected cash from the applied facts: cash tenders,
 * change, and cash in/out. Sales not yet uploaded simply do not exist here.
 */
export async function selectShiftCashTotals(
  shiftId: string,
  openingFloatMinor: number,
  executor: DbExecutor = db,
): Promise<ShiftCashTotals> {
  const rows = await executor.execute<{
    cash_tenders: string
    change_total: string
    cash_in: string
    cash_out: string
  }>(sql`
    SELECT
      COALESCE((
        SELECT SUM(st.amount_minor)
        FROM sale_tender st
        JOIN sale s ON s.id = st.sale_id
        WHERE s.shift_id = ${shiftId} AND st.method = 'CASH'
      ), 0)::text AS cash_tenders,
      COALESCE((SELECT SUM(s.change_minor) FROM sale s WHERE s.shift_id = ${shiftId}), 0)::text AS change_total,
      COALESCE((
        SELECT SUM(cm.amount_minor) FROM cash_movement cm
        WHERE cm.shift_id = ${shiftId} AND cm.type = 'CASH_IN'
      ), 0)::text AS cash_in,
      COALESCE((
        SELECT SUM(cm.amount_minor) FROM cash_movement cm
        WHERE cm.shift_id = ${shiftId} AND cm.type = 'CASH_OUT'
      ), 0)::text AS cash_out
  `)
  const row = rows.rows[0]
  return {
    openingFloatMinor,
    cashTendersMinor: Number(row?.cash_tenders ?? 0),
    changeMinor: Number(row?.change_total ?? 0),
    cashInMinor: Number(row?.cash_in ?? 0),
    cashOutMinor: Number(row?.cash_out ?? 0),
  }
}

export async function updateShiftClose(
  shiftId: string,
  patch: Partial<typeof shift.$inferInsert>,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(shift).set(patch).where(eq(shift.id, shiftId))
}

/**
 * The review columns and nothing else. The patch type *is* the allow-list
 * (P12-D25): `counted_cash_minor`, `server_expected_cash_minor` and
 * `variance_minor` are not representable, so a review can never restate the
 * drawer's figures.
 */
export interface ShiftReviewPatch {
  reviewStatus?: ShiftReviewStatus
  reviewedBy?: string | null
  reviewedAt?: Date | null
  reviewNote?: string | null
}

const SHIFT_REVIEW_COLUMNS = new Set(['reviewStatus', 'reviewedBy', 'reviewedAt', 'reviewNote'])

/**
 * The only writer of the review columns. The runtime guard repeats the type's
 * promise for a caller that has cast its way around it: a money column is a
 * programming error, refused before the update runs.
 */
export async function updateShiftReview(
  shiftId: string,
  patch: ShiftReviewPatch,
  executor: DbExecutor = db,
): Promise<void> {
  const columns = Object.keys(patch)
  for (const column of columns) {
    if (!SHIFT_REVIEW_COLUMNS.has(column)) {
      throw new Error(`updateShiftReview refuses a non-review column: ${column}`)
    }
  }
  if (columns.length === 0) return

  const rows = await executor
    .update(shift)
    .set(patch)
    .where(eq(shift.id, shiftId))
    .returning({ id: shift.id })
  if (rows.length === 0) throw new Error('Failed to update the shift review')
}

/** A shift with the terminal name a reviewer needs; one join, indexed read. */
export interface ShiftWithTerminal {
  shift: typeof shift.$inferSelect
  terminalName: string
}

export async function findShiftWithTerminal(
  shiftId: string,
  executor: DbExecutor = db,
): Promise<ShiftWithTerminal | null> {
  const rows = await executor
    .select({ shift, terminalName: terminal.name })
    .from(shift)
    .innerJoin(terminal, eq(shift.terminalId, terminal.id))
    .where(eq(shift.id, shiftId))
    .limit(1)
  return rows[0] ?? null
}

/** The terminal's display name, for the review payload written at close. */
export async function findTerminalName(
  terminalId: string,
  executor: DbExecutor = db,
): Promise<string | null> {
  const rows = await executor
    .select({ name: terminal.name })
    .from(terminal)
    .where(eq(terminal.id, terminalId))
    .limit(1)
  return rows[0]?.name ?? null
}

/** How many sales the shift recorded, for the review payload (`sale_shift_idx`). */
export async function countShiftSales(shiftId: string, executor: DbExecutor = db): Promise<number> {
  const rows = await executor
    .select({ value: sql<number>`count(*)::int` })
    .from(sale)
    .where(eq(sale.shiftId, shiftId))
  return rows[0]?.value ?? 0
}

export async function insertConflict(
  values: typeof syncConflict.$inferInsert,
  executor: DbExecutor = db,
): Promise<typeof syncConflict.$inferSelect> {
  const rows = await executor.insert(syncConflict).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to insert the sync conflict')
  return row
}

// --- Sales -----------------------------------------------------------------

/** Products and their branch price override in one query. */
export async function selectProductsForSale(
  productIds: readonly string[],
  branchId: string,
  executor: DbExecutor = db,
): Promise<Array<{ product: typeof product.$inferSelect; overrideMinor: number | null }>> {
  if (productIds.length === 0) return []
  return executor
    .select({ product, overrideMinor: productPrice.priceMinor })
    .from(product)
    .leftJoin(
      productPrice,
      and(eq(productPrice.productId, product.id), eq(productPrice.branchId, branchId)),
    )
    .where(inArray(product.id, [...productIds]))
}

export async function insertSale(
  values: typeof sale.$inferInsert,
  executor: DbExecutor = db,
): Promise<typeof sale.$inferSelect> {
  const rows = await executor.insert(sale).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to insert the sale')
  return row
}

export async function insertSaleLines(
  values: Array<typeof saleLine.$inferInsert>,
  executor: DbExecutor = db,
): Promise<void> {
  if (values.length === 0) return
  await executor.insert(saleLine).values(values)
}

export async function insertSaleTenders(
  values: Array<typeof saleTender.$inferInsert>,
  executor: DbExecutor = db,
): Promise<void> {
  if (values.length === 0) return
  await executor.insert(saleTender).values(values)
}

export async function updateSaleConflictCount(
  saleId: string,
  conflictCount: number,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(sale).set({ conflictCount }).where(eq(sale.id, saleId))
}

export async function findCreditProfileRow(
  customerId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<typeof creditProfile.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(creditProfile)
    .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)))
    .limit(1)
  return rows[0] ?? null
}

/** A binding by id, for revalidating an offline manager approval (D22). */
export async function findBindingById(
  bindingId: string,
  executor: DbExecutor = db,
): Promise<typeof posStaffBinding.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(posStaffBinding)
    .where(eq(posStaffBinding.id, bindingId))
    .limit(1)
  return rows[0] ?? null
}

export interface ConflictReadRow {
  id: string
  type: string
  severity: string
  status: string
  details: unknown
  createdAt: Date
  saleReceiptNumber: string | null
  shiftNumber: string | null
}

/** Newest-first conflicts for one terminal, optionally after a timestamp. */
export async function selectConflictsForTerminal(
  terminalId: string,
  since: Date | null,
  limit: number,
  executor: DbExecutor = db,
): Promise<ConflictReadRow[]> {
  const rows = await executor
    .select({
      id: syncConflict.id,
      type: syncConflict.type,
      severity: syncConflict.severity,
      status: syncConflict.status,
      details: syncConflict.details,
      createdAt: syncConflict.createdAt,
      saleReceiptNumber: sale.receiptNumber,
      shiftNumber: shift.number,
    })
    .from(syncConflict)
    .leftJoin(sale, eq(sale.id, syncConflict.saleId))
    .leftJoin(shift, eq(shift.id, syncConflict.shiftId))
    .where(
      since
        ? and(eq(syncConflict.terminalId, terminalId), gt(syncConflict.createdAt, since))
        : eq(syncConflict.terminalId, terminalId),
    )
    .orderBy(desc(syncConflict.createdAt))
    .limit(limit)
  return rows
}

export async function countOpenConflicts(
  terminalId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ value: sql<number>`count(*)::int` })
    .from(syncConflict)
    .where(and(eq(syncConflict.terminalId, terminalId), eq(syncConflict.status, 'OPEN')))
  return rows[0]?.value ?? 0
}

export async function selectSettingsVersion(executor: DbExecutor = db): Promise<string | null> {
  const rows = await executor
    .select({ value: sql<string | null>`max(${setting.updatedAt})::text` })
    .from(setting)
  return rows[0]?.value ?? null
}

export async function selectLastSaleAt(
  terminalId: string,
  executor: DbExecutor = db,
): Promise<Date | null> {
  const rows = await executor
    .select({ occurredAt: sale.occurredAt })
    .from(sale)
    .where(eq(sale.terminalId, terminalId))
    .orderBy(desc(sale.occurredAt))
    .limit(1)
  return rows[0]?.occurredAt ?? null
}

export async function findSaleByReceiptNumber(
  receiptNumber: string,
  executor: DbExecutor = db,
): Promise<{ id: string } | null> {
  const rows = await executor
    .select({ id: sale.id })
    .from(sale)
    .where(eq(sale.receiptNumber, receiptNumber))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Ex-tax base sold per product for one branch in a half-open window.
 *
 * `base_minor` is the ex-tax base the POS pricing engine computes; `net_minor`
 * still carries the tax in inclusive mode and would inflate an ABC score by the
 * 20% VAT/NHIL/GETFund it already added. This is the same column Phase 9 uses
 * for revenue and gross profit, so the ABC ranking and the reports agree.
 */
export async function selectSoldValueByProduct(
  branchId: string,
  from: Date,
  toExclusive: Date,
  executor: DbExecutor = db,
): Promise<Map<string, number>> {
  const rows = await executor
    .select({
      productId: saleLine.productId,
      soldMinor: sql<number>`coalesce(sum(${saleLine.baseMinor}), 0)`.mapWith(Number),
    })
    .from(saleLine)
    .innerJoin(sale, eq(sale.id, saleLine.saleId))
    .where(
      and(
        eq(sale.branchId, branchId),
        gte(sale.occurredAt, from),
        lt(sale.occurredAt, toExclusive),
      ),
    )
    .groupBy(saleLine.productId)

  return new Map(rows.map((row) => [row.productId, row.soldMinor]))
}
