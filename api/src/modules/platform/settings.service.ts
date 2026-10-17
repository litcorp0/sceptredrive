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
 * Atomically allocates the next staff identifier (e.g. GA-0001). The sequence
 * row is locked for update; gaps are acceptable because identifiers are never
 * reused.
 */
export async function allocateStaffId(executor: DbExecutor): Promise<string> {
  const prefix = await getSettingValue('staff.idPrefix', {}, executor)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await findSequenceRowForUpdate(executor)
    if (!row) {
      try {
        await insertSequenceRow(SETTING_DEFINITIONS['staff.idSequence'].defaultValue, executor)
        continue
      } catch (error) {
        if (isUniqueViolation(error)) continue
        throw error
      }
    }

    const parsed = SETTING_DEFINITIONS['staff.idSequence'].schema.safeParse(row.value)
    const next = parsed.success ? parsed.data : SETTING_DEFINITIONS['staff.idSequence'].defaultValue

    await bumpSequenceRow(row.id, next + 1, executor)
    return `${prefix}-${String(next).padStart(4, '0')}`
  }

  throw new AppError(500, 'INTERNAL', 'Could not allocate a staff identifier')
}
