import { db } from '@gikautos/db'
import { setting } from '@gikautos/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { env } from '../../config/env.ts'
import type { DbExecutor } from './audit.service.ts'
import { isUniqueViolation } from './db-errors.ts'

export const SETTING_DEFINITIONS = {
  'staff.idPrefix': {
    schema: z
      .string()
      .trim()
      .min(1)
      .max(8)
      .regex(/^[A-Za-z0-9]+$/),
    defaultValue: env.STAFF_ID_PREFIX,
    branchScoped: false,
  },
  'staff.idSequence': {
    schema: z.number().int().positive(),
    defaultValue: env.STAFF_ID_START,
    branchScoped: false,
  },
  'receipt.header': {
    schema: z.string().trim().min(1).max(200),
    defaultValue: 'Thank you for shopping at GikAutos',
    branchScoped: true,
  },
  'loyalty.earnPointsPerCedi': {
    schema: z.number().positive(),
    defaultValue: 1,
    branchScoped: false,
  },
  'loyalty.pointsPerCedi': {
    schema: z.number().positive(),
    defaultValue: 100,
    branchScoped: false,
  },
  'loyalty.expiryMonths': {
    schema: z.number().int().positive(),
    defaultValue: 12,
    branchScoped: false,
  },
} as const

export type SettingKey = keyof typeof SETTING_DEFINITIONS

export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>

export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, value)
}

interface SettingRowValue {
  value: unknown
}

async function readRow(
  executor: DbExecutor,
  key: string,
  branchId: string | null,
): Promise<SettingRowValue | null> {
  const rows = await executor
    .select({ value: setting.value })
    .from(setting)
    .where(
      and(
        eq(setting.key, key),
        branchId === null ? isNull(setting.branchId) : eq(setting.branchId, branchId),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

/**
 * Reads a typed setting with a default fallback. Branch-scoped keys fall back
 * from the branch value to the global value and finally to the default.
 */
export async function getSettingValue<K extends SettingKey>(
  key: K,
  options: { branchId?: string | null | undefined } = {},
  executor: DbExecutor = db,
): Promise<SettingValue<K>> {
  const definition = SETTING_DEFINITIONS[key]
  const branchId = definition.branchScoped ? (options.branchId ?? null) : null

  if (branchId) {
    const branchRow = await readRow(executor, key, branchId)
    const parsedBranch = definition.schema.safeParse(branchRow?.value)
    if (parsedBranch.success) return parsedBranch.data as SettingValue<K>
  }

  const globalRow = await readRow(executor, key, null)
  const parsedGlobal = definition.schema.safeParse(globalRow?.value)
  if (parsedGlobal.success) return parsedGlobal.data as SettingValue<K>

  return definition.defaultValue as SettingValue<K>
}

/**
 * Atomically allocates the next staff identifier (e.g. GA-0001). The sequence
 * row is locked for update; gaps are acceptable because identifiers are never
 * reused.
 */
export async function allocateStaffId(executor: DbExecutor): Promise<string> {
  const prefix = await getSettingValue('staff.idPrefix', {}, executor)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await executor
      .select({ id: setting.id, value: setting.value })
      .from(setting)
      .where(and(eq(setting.key, 'staff.idSequence'), isNull(setting.branchId)))
      .limit(1)
      .for('update')

    const row = rows[0]
    if (!row) {
      try {
        await executor.insert(setting).values({
          key: 'staff.idSequence',
          value: SETTING_DEFINITIONS['staff.idSequence'].defaultValue,
        })
        continue
      } catch (error) {
        if (isUniqueViolation(error)) continue
        throw error
      }
    }

    const parsed = SETTING_DEFINITIONS['staff.idSequence'].schema.safeParse(row.value)
    const next = parsed.success ? parsed.data : SETTING_DEFINITIONS['staff.idSequence'].defaultValue

    await executor
      .update(setting)
      .set({ value: next + 1 })
      .where(eq(setting.id, row.id))
    return `${prefix}-${String(next).padStart(4, '0')}`
  }

  throw new Error('Could not allocate a staff identifier')
}
