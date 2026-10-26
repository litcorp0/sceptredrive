import { type DbExecutor, db } from '@sceptre/db'
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

/**
 * Who may write a key. The default reproduces the behaviour every existing key
 * already had: a global setting is admin-only, a branch setting is writable by
 * the branch manager. Only a key that says so can be branch-overridable and
 * admin-only (the procurement threshold).
 */
function writableByOf(definition: (typeof SETTING_DEFINITIONS)[SettingKey]): 'admin' | 'manager' {
  return 'writableBy' in definition
    ? definition.writableBy
    : definition.branchScoped
      ? 'manager'
      : 'admin'
}

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
      return {
        key,
        value: parsed.data,
        branchScoped: definition.branchScoped,
        writableBy: writableByOf(definition),
        source: 'branch',
      }
    }
  }

  const globalRow = await readSettingRow(key, null, executor)
  const parsedGlobal = definition.schema.safeParse(globalRow?.value)
  if (parsedGlobal.success) {
    return {
      key,
      value: parsedGlobal.data,
      branchScoped: definition.branchScoped,
      writableBy: writableByOf(definition),
      source: 'global',
    }
  }

  return {
    key,
    value: definition.defaultValue,
    branchScoped: definition.branchScoped,
    writableBy: writableByOf(definition),
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

/**
 * The resolved value plus where it came from. An audit entry that says "approved
 * automatically" should name the threshold it used and whether that was the
 * branch's own value or the company default.
 */
export async function getResolvedSetting<K extends SettingKey>(
  key: K,
  options: { branchId?: string | null } = {},
  executor: DbExecutor = db,
): Promise<{ value: SettingValue<K>; source: 'branch' | 'global' | 'default' }> {
  const resolved = await resolveSetting(key, options.branchId ?? null, executor)
  return { value: resolved.value as SettingValue<K>, source: resolved.source }
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

  // Default preserves the behaviour every existing key already had: a global
  // setting is admin-only, a branch setting is writable by the branch manager.
  // Only a key that says so explicitly can be branch-overridable and admin-only,
  // which is what the procurement threshold needs (P11-D2).
  if (writableByOf(definition) === 'admin' && !isAdmin) {
    throw new ForbiddenError('Only an admin can change this setting')
  }

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

  // Never let an administrator make TOTP mandatory while their own account has
  // no authenticator: the console would immediately lock them out of Settings
  // and there would be no way back without the CLI break-glass script.
  if (key === 'auth.requireTwoFactor' && parsed.data === true && user.twoFactorEnabled !== true) {
    throw new ForbiddenError(
      'Set up two-factor authentication on your own account before requiring it for administrators',
    )
  }

  // The ABC thresholds are cumulative score shares, so B at or below A would
  // make every product class C. One key's schema cannot see the other value, so
  // the pair is checked here, before anything is written (P12-D29).
  if (key === 'inventory.abcAThresholdBp' || key === 'inventory.abcBThresholdBp') {
    const nextA =
      key === 'inventory.abcAThresholdBp'
        ? (parsed.data as number)
        : await getSettingValue('inventory.abcAThresholdBp', {})
    const nextB =
      key === 'inventory.abcBThresholdBp'
        ? (parsed.data as number)
        : await getSettingValue('inventory.abcBThresholdBp', {})
    if (nextA >= nextB) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'inventory.abcAThresholdBp must be less than inventory.abcBThresholdBp',
      )
    }
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
      writableBy: writableByOf(definition),
      source: targetBranchId ? ('branch' as const) : ('global' as const),
    }
  })
}

/**
 * Settings keys backed by an atomic counter (FOR UPDATE row lock, gaps are
 * acceptable because identifiers are never reused).
 */
export type SequenceKey =
  | 'staff.idSequence'
  | 'catalog.skuSequence'
  | 'inventory.receiptSequence'
  | 'inventory.transferSequence'
  | 'inventory.countSequence'
  | 'credit.repaymentSequence'
  | 'supplier.codeSequence'
  | 'payable.invoiceSequence'
  | 'payable.paymentSequence'

const SEQUENCE_FORMATS: Record<
  SequenceKey,
  {
    prefixKey:
      | 'staff.idPrefix'
      | 'catalog.skuPrefix'
      | 'inventory.receiptPrefix'
      | 'inventory.transferPrefix'
      | 'inventory.countPrefix'
      | 'credit.repaymentPrefix'
      | 'supplier.codePrefix'
      | 'payable.invoicePrefix'
      | 'payable.paymentPrefix'
    pad: number
    label: string
  }
> = {
  'staff.idSequence': { prefixKey: 'staff.idPrefix', pad: 4, label: 'staff identifier' },
  'catalog.skuSequence': { prefixKey: 'catalog.skuPrefix', pad: 5, label: 'SKU' },
  'inventory.receiptSequence': {
    prefixKey: 'inventory.receiptPrefix',
    pad: 5,
    label: 'goods receipt number',
  },
  'inventory.transferSequence': {
    prefixKey: 'inventory.transferPrefix',
    pad: 5,
    label: 'transfer number',
  },
  'inventory.countSequence': {
    prefixKey: 'inventory.countPrefix',
    pad: 5,
    label: 'count number',
  },
  'credit.repaymentSequence': {
    prefixKey: 'credit.repaymentPrefix',
    pad: 5,
    label: 'repayment receipt number',
  },
  'supplier.codeSequence': {
    prefixKey: 'supplier.codePrefix',
    pad: 5,
    label: 'supplier code',
  },
  'payable.invoiceSequence': {
    prefixKey: 'payable.invoicePrefix',
    pad: 5,
    label: 'supplier invoice number',
  },
  'payable.paymentSequence': {
    prefixKey: 'payable.paymentPrefix',
    pad: 5,
    label: 'supplier payment number',
  },
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

/**
 * Keeps a sequence in step when one of its formatted values was used outside
 * the allocator (e.g. a suggested SKU saved explicitly). Bumps the counter
 * past the value when it matches the sequence's prefix; otherwise no-op.
 */
export async function advanceSequencePast(
  key: SequenceKey,
  formattedValue: string,
  executor: DbExecutor = db,
): Promise<void> {
  const format = SEQUENCE_FORMATS[key]
  const prefix = await getSettingValue(format.prefixKey, {}, executor)
  const expectedPrefix = `${prefix}-`
  if (!formattedValue.startsWith(expectedPrefix)) return

  const digits = formattedValue.slice(expectedPrefix.length)
  if (!/^\d+$/.test(digits)) return
  const used = Number.parseInt(digits, 10)
  if (!Number.isSafeInteger(used)) return

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await findSequenceRowForUpdate(key, executor)
    if (!row) {
      try {
        await insertSequenceRow(key, used + 1, executor)
        return
      } catch (error) {
        if (isUniqueViolation(error)) continue
        throw error
      }
    }

    const parsed = SETTING_DEFINITIONS[key].schema.safeParse(row.value)
    const current = parsed.success ? parsed.data : SETTING_DEFINITIONS[key].defaultValue
    if (current > used) return

    await bumpSequenceRow(row.id, used + 1, executor)
    return
  }
}
