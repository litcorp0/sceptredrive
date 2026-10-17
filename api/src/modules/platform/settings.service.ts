import { db } from '@gikautos/db'
import { branch, setting } from '@gikautos/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { env } from '../../config/env.ts'
import { resolveBranchFilter, roleOf } from '../../http/authorize.ts'
import { AppError, ForbiddenError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { type AuditActor, type DbExecutor, writeAudit } from './audit.service.ts'
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

export interface ResolvedSetting {
  key: SettingKey
  value: unknown
  branchScoped: boolean
  source: 'branch' | 'global' | 'default'
}

async function resolveSetting<K extends SettingKey>(
  key: K,
  branchId: string | null,
  executor: DbExecutor,
): Promise<ResolvedSetting> {
  const definition = SETTING_DEFINITIONS[key]
  const scopeBranch = definition.branchScoped ? branchId : null

  if (scopeBranch) {
    const branchRow = await readRow(executor, key, scopeBranch)
    const parsed = definition.schema.safeParse(branchRow?.value)
    if (parsed.success) {
      return { key, value: parsed.data, branchScoped: definition.branchScoped, source: 'branch' }
    }
  }

  const globalRow = await readRow(executor, key, null)
  const parsedGlobal = definition.schema.safeParse(globalRow?.value)
  if (parsedGlobal.success) {
    return {
      key,
      value: parsedGlobal.data,
      branchScoped: definition.branchScoped,
      source: 'global',
    }
  }

  return {
    key,
    value: definition.defaultValue,
    branchScoped: definition.branchScoped,
    source: 'default',
  }
}

export async function listSettings(
  user: SessionUser,
  requestedBranchId?: string | null,
): Promise<{ settings: ResolvedSetting[]; branchId: string | null }> {
  const branchId = resolveBranchFilter(user, requestedBranchId ?? null)
  const keys = Object.keys(SETTING_DEFINITIONS) as SettingKey[]
  const settings = await Promise.all(keys.map((key) => resolveSetting(key, branchId, db)))
  return { settings, branchId }
}

export interface UpdateSettingInput {
  key: string
  value: unknown
  branchId?: string | null | undefined
}

export async function updateSetting(
  user: SessionUser,
  actor: AuditActor,
  input: UpdateSettingInput,
): Promise<ResolvedSetting> {
  if (!isSettingKey(input.key)) {
    throw new AppError(400, 'VALIDATION_ERROR', `Unknown setting: ${input.key}`)
  }
  const key = input.key
  const definition = SETTING_DEFINITIONS[key]
  const isAdmin = roleOf(user) === 'ADMIN'

  let targetBranchId: string | null
  if (definition.branchScoped) {
    targetBranchId = isAdmin ? (input.branchId ?? null) : (user.branchId ?? null)
    if (!isAdmin && input.branchId && input.branchId !== user.branchId) {
      throw new ForbiddenError('You can only change settings for your own branch')
    }
    if (!isAdmin && !targetBranchId) {
      throw new ForbiddenError('Your account is not assigned to a branch')
    }
  } else {
    if (!isAdmin) throw new ForbiddenError('Only admins can change global settings')
    targetBranchId = null
  }

  if (targetBranchId) {
    const branchRows = await db
      .select({ id: branch.id })
      .from(branch)
      .where(eq(branch.id, targetBranchId))
      .limit(1)
    if (!branchRows[0]) throw new NotFoundError('Branch not found')
  }

  const parsed = definition.schema.safeParse(input.value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(400, 'VALIDATION_ERROR', issue?.message ?? 'Invalid setting value')
  }

  return db.transaction(async (tx) => {
    const existingRows = await tx
      .select({ id: setting.id, value: setting.value })
      .from(setting)
      .where(
        and(
          eq(setting.key, key),
          targetBranchId === null ? isNull(setting.branchId) : eq(setting.branchId, targetBranchId),
        ),
      )
      .limit(1)
      .for('update')
    const existing = existingRows[0]

    if (existing) {
      await tx
        .update(setting)
        .set({ value: parsed.data, updatedBy: actor.actorId })
        .where(eq(setting.id, existing.id))
    } else {
      await tx.insert(setting).values({
        key,
        value: parsed.data,
        branchId: targetBranchId,
        updatedBy: actor.actorId,
      })
    }

    await writeAudit(
      {
        ...actor,
        action: 'setting.updated',
        entity: 'setting',
        entityId: key,
        before: existing ? { value: existing.value } : null,
        after: { value: parsed.data, branchId: targetBranchId },
        branchId: targetBranchId,
      },
      tx,
    )

    return {
      key,
      value: parsed.data,
      branchScoped: definition.branchScoped,
      source: targetBranchId ? ('branch' as const) : ('global' as const),
    }
  })
}
