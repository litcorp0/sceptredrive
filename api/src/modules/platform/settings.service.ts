import { type DbExecutor, db } from '@gikautos/db'
import { resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { AppError, ForbiddenError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from './audit.service.ts'
import type { AuditActor } from './audit.types.ts'
import { isUniqueViolation } from './db-errors.ts'
import {
  bumpSequenceRow,
  findSequenceRowForUpdate,
  findSettingRowForUpdate,
  insertSequenceRow,
  insertSettingRow,
  readSettingRow,
  updateSettingRowValue,
} from './settings.repository.ts'
import type { ResolvedSetting, UpdateSettingInput } from './settings.types.ts'
import {
  isSettingKey,
  SETTING_DEFINITIONS,
  type SettingKey,
  type SettingValue,
} from './settings.validation.ts'

async function resolveSetting<K extends SettingKey>(
  key: K,
  branchId: string | null,
  executor: DbExecutor,
): Promise<ResolvedSetting> {
  const definition = SETTING_DEFINITIONS[key]
  const scopeBranch = definition.branchScoped ? branchId : null

  if (scopeBranch) {
    const branchRow = await readSettingRow(key, scopeBranch, executor)
    const parsed = definition.schema.safeParse(branchRow?.value)
    if (parsed.success) {
      return { key, value: parsed.data, branchScoped: definition.branchScoped, source: 'branch' }
    }
  }

  const globalRow = await readSettingRow(key, null, executor)
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

/**
 * Reads a typed setting with a default fallback. Branch-scoped keys fall back
 * from the branch value to the global value and finally to the default.
 */
export async function getSettingValue<K extends SettingKey>(
  key: K,
  options: { branchId?: string | null | undefined } = {},
  executor: DbExecutor = db,
): Promise<SettingValue<K>> {
  const resolved = await resolveSetting(key, options.branchId ?? null, executor)
  return resolved.value as SettingValue<K>
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
    await branchesService.getBranch(user, targetBranchId)
  }

  const parsed = definition.schema.safeParse(input.value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(400, 'VALIDATION_ERROR', issue?.message ?? 'Invalid setting value')
  }

  return db.transaction(async (tx) => {
    const existing = await findSettingRowForUpdate(key, targetBranchId, tx)

    if (existing) {
      await updateSettingRowValue(existing.id, parsed.data, actor.actorId, tx)
    } else {
      await insertSettingRow(
        {
          key,
          value: parsed.data,
          branchId: targetBranchId,
          updatedBy: actor.actorId,
        },
        tx,
      )
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

/**
 * Settings keys backed by an atomic counter (FOR UPDATE row lock, gaps are
 * acceptable because identifiers are never reused).
 */
export type SequenceKey = 'staff.idSequence' | 'catalog.skuSequence'

const SEQUENCE_FORMATS: Record<
  SequenceKey,
  { prefixKey: 'staff.idPrefix' | 'catalog.skuPrefix'; pad: number; label: string }
> = {
  'staff.idSequence': { prefixKey: 'staff.idPrefix', pad: 4, label: 'staff identifier' },
  'catalog.skuSequence': { prefixKey: 'catalog.skuPrefix', pad: 5, label: 'SKU' },
}

/**
 * Atomically allocates the next formatted value from a settings sequence,
 * e.g. `GA-0001` for staff or `GIK-00001` for SKUs. The sequence row is
 * locked for update; retries cover the insert race on first use.
 */
export async function allocateFromSequence(
  key: SequenceKey,
  executor: DbExecutor,
): Promise<string> {
  const format = SEQUENCE_FORMATS[key]
  const prefix = await getSettingValue(format.prefixKey, {}, executor)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await findSequenceRowForUpdate(key, executor)
    if (!row) {
      try {
        await insertSequenceRow(key, SETTING_DEFINITIONS[key].defaultValue, executor)
        continue
      } catch (error) {
        if (isUniqueViolation(error)) continue
        throw error
      }
    }

    const parsed = SETTING_DEFINITIONS[key].schema.safeParse(row.value)
    const next = parsed.success ? parsed.data : SETTING_DEFINITIONS[key].defaultValue

    await bumpSequenceRow(row.id, next + 1, executor)
    return `${prefix}-${String(next).padStart(format.pad, '0')}`
  }

  throw new AppError(500, 'INTERNAL', `Could not allocate a ${format.label}`)
}

/**
 * Atomically allocates the next staff identifier (e.g. GA-0001). Gaps are
 * acceptable because identifiers are never reused.
 */
export async function allocateStaffId(executor: DbExecutor): Promise<string> {
  return allocateFromSequence('staff.idSequence', executor)
}

/**
 * Formats the next value of a sequence without consuming it (a peek for
 * pre-filling forms; creation always allocates atomically).
 */
export async function peekSequenceValue(
  key: SequenceKey,
  executor: DbExecutor = db,
): Promise<string> {
  const format = SEQUENCE_FORMATS[key]
  const prefix = await getSettingValue(format.prefixKey, {}, executor)
  const next = await getSettingValue(key, {}, executor)
  return `${prefix}-${String(next).padStart(format.pad, '0')}`
}
