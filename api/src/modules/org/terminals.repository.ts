import { type DbExecutor, db } from '@gikautos/db'
import { and, asc, eq, type SQL } from 'drizzle-orm'
import { device, terminal } from './terminals.schema.ts'
import type { DeviceRow, TerminalRow } from './terminals.types.ts'

export async function listTerminalRows(
  options: { branchId?: string | null | undefined; includeInactive: boolean },
  executor: DbExecutor = db,
): Promise<TerminalRow[]> {
  const filters: SQL[] = []
  if (options.branchId) filters.push(eq(terminal.branchId, options.branchId))
  if (!options.includeInactive) filters.push(eq(terminal.isActive, true))

  return executor
    .select()
    .from(terminal)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(terminal.code))
}

export async function findTerminalById(
  id: string,
  executor: DbExecutor = db,
): Promise<TerminalRow | null> {
  const rows = await executor.select().from(terminal).where(eq(terminal.id, id)).limit(1)
  return rows[0] ?? null
}

export async function selectTerminalCodes(
  branchId: string,
  executor: DbExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ code: terminal.code })
    .from(terminal)
    .where(eq(terminal.branchId, branchId))
  return rows.map((row) => row.code)
}

export async function insertTerminal(
  values: typeof terminal.$inferInsert,
  executor: DbExecutor = db,
): Promise<TerminalRow | null> {
  const rows = await executor.insert(terminal).values(values).returning()
  return rows[0] ?? null
}

export async function updateTerminalRow(
  id: string,
  patch: Partial<typeof terminal.$inferInsert>,
  executor: DbExecutor = db,
): Promise<TerminalRow | null> {
  const rows = await executor.update(terminal).set(patch).where(eq(terminal.id, id)).returning()
  return rows[0] ?? null
}

export async function listDeviceRows(
  terminalId: string,
  executor: DbExecutor = db,
): Promise<DeviceRow[]> {
  return executor
    .select()
    .from(device)
    .where(eq(device.terminalId, terminalId))
    .orderBy(asc(device.enrolledAt))
}

export async function findDeviceById(
  id: string,
  executor: DbExecutor = db,
): Promise<DeviceRow | null> {
  const rows = await executor.select().from(device).where(eq(device.id, id)).limit(1)
  return rows[0] ?? null
}

export async function insertDevice(
  values: typeof device.$inferInsert,
  executor: DbExecutor = db,
): Promise<DeviceRow | null> {
  const rows = await executor.insert(device).values(values).returning()
  return rows[0] ?? null
}

/** Only ACTIVE devices authenticate; a revoked token must never resolve. */
export async function findActiveDeviceByTokenHash(
  tokenHash: string,
  executor: DbExecutor = db,
): Promise<DeviceRow | null> {
  const rows = await executor
    .select()
    .from(device)
    .where(and(eq(device.tokenHash, tokenHash), eq(device.status, 'ACTIVE')))
    .limit(1)
  return rows[0] ?? null
}

/** Throttled by the caller: `last_seen_at` is metadata, not an audit trail. */
export async function touchDeviceLastSeen(
  id: string,
  seenAt: Date,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(device).set({ lastSeenAt: seenAt }).where(eq(device.id, id))
}

export async function updateDeviceRow(
  id: string,
  patch: Partial<typeof device.$inferInsert>,
  executor: DbExecutor = db,
): Promise<DeviceRow | null> {
  const rows = await executor.update(device).set(patch).where(eq(device.id, id)).returning()
  return rows[0] ?? null
}
