import { type DbExecutor, db } from '@gikautos/db'
import { and, eq, isNull } from 'drizzle-orm'
import { setting } from './settings.schema.ts'

function identityFilter(key: string, branchId: string | null) {
  return branchId === null
    ? and(eq(setting.key, key), isNull(setting.branchId))
    : and(eq(setting.key, key), eq(setting.branchId, branchId))
}

export async function readSettingRow(
  key: string,
  branchId: string | null,
  executor: DbExecutor = db,
): Promise<{ value: unknown } | null> {
  const rows = await executor
    .select({ value: setting.value })
    .from(setting)
    .where(identityFilter(key, branchId))
    .limit(1)
  return rows[0] ?? null
}

export async function findSettingRowForUpdate(
  key: string,
  branchId: string | null,
  executor: DbExecutor = db,
): Promise<{ id: string; value: unknown } | null> {
  const rows = await executor
    .select({ id: setting.id, value: setting.value })
    .from(setting)
    .where(identityFilter(key, branchId))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function insertSettingRow(
  values: typeof setting.$inferInsert,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.insert(setting).values(values)
}

export async function updateSettingRowValue(
  id: string,
  value: unknown,
  updatedBy: string | null,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(setting).set({ value, updatedBy }).where(eq(setting.id, id))
}

export async function findSequenceRowForUpdate(
  executor: DbExecutor = db,
): Promise<{ id: string; value: unknown } | null> {
  const rows = await executor
    .select({ id: setting.id, value: setting.value })
    .from(setting)
    .where(and(eq(setting.key, 'staff.idSequence'), isNull(setting.branchId)))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function insertSequenceRow(start: number, executor: DbExecutor = db): Promise<void> {
  await executor
    .insert(setting)
    .values({ key: 'staff.idSequence', value: start, updatedBy: 'system' })
}

export async function bumpSequenceRow(
  id: string,
  next: number,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(setting).set({ value: next }).where(eq(setting.id, id))
}
