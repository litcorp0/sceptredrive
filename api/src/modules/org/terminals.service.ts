import { db } from '@gikautos/db'
import { assertBranchAccess, branchScope } from '../../auth/scope.ts'
import { AppError, ConflictError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'
import {
  findDeviceById,
  findTerminalById,
  insertTerminal,
  listDeviceRows,
  listTerminalRows,
  selectTerminalCodes,
  updateDeviceRow,
  updateTerminalRow,
} from './terminals.repository.ts'
import type {
  DeviceRow,
  TerminalCreateInput,
  TerminalListFilters,
  TerminalRow,
  TerminalUpdateInput,
} from './terminals.types.ts'

const MAX_CODE_ATTEMPTS = 5

function assertTerminalAccess(user: SessionUser, terminalRecord: TerminalRow): void {
  assertBranchAccess(user, terminalRecord.branchId)
}

function nextCodeFrom(existingCodes: string[], branchCode: string): string {
  const prefix = `${branchCode}-T`
  let max = 0
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue
    const numeric = Number.parseInt(code.slice(prefix.length), 10)
    if (Number.isFinite(numeric) && numeric > max) max = numeric
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`
}

export async function listTerminals(
  user: SessionUser,
  filters: TerminalListFilters,
): Promise<TerminalRow[]> {
  const scope = branchScope(user)
  const branchId = scope ?? filters.branchId
  return listTerminalRows({ branchId, includeInactive: filters.includeInactive })
}

export async function getTerminal(user: SessionUser, id: string): Promise<TerminalRow> {
  const found = await findTerminalById(id)
  if (!found) throw new NotFoundError('Terminal not found')
  assertTerminalAccess(user, found)
  return found
}

export async function createTerminal(
  user: SessionUser,
  actor: AuditActor,
  input: TerminalCreateInput,
): Promise<TerminalRow> {
  const parent = await branchesService.getBranch(user, input.branchId)
  if (!parent.isActive) throw new ConflictError('Cannot add terminals to a deactivated branch')
  if (parent.type === 'WAREHOUSE') {
    throw new ConflictError('Warehouses cannot host POS terminals')
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const existingCodes = await selectTerminalCodes(input.branchId, tx)
        const code = nextCodeFrom(existingCodes, parent.code)

        const created = await insertTerminal(
          {
            branchId: input.branchId,
            code,
            name: input.name,
            createdBy: actor.actorId,
          },
          tx,
        )
        if (!created) throw new AppError(500, 'INTERNAL', 'Failed to create terminal')

        await writeAudit(
          {
            ...actor,
            action: 'terminal.created',
            entity: 'terminal',
            entityId: created.id,
            after: created,
            branchId: created.branchId,
            terminalId: created.id,
          },
          tx,
        )
        return created
      })
    } catch (error) {
      if (isUniqueViolation(error) && attempt < MAX_CODE_ATTEMPTS - 1) continue
      if (isUniqueViolation(error)) {
        throw new ConflictError('Could not allocate a terminal code, please retry')
      }
      throw error
    }
  }
  throw new ConflictError('Could not allocate a terminal code, please retry')
}

export async function updateTerminal(
  user: SessionUser,
  actor: AuditActor,
  id: string,
  input: TerminalUpdateInput,
): Promise<TerminalRow> {
  return db.transaction(async (tx) => {
    const existing = await findTerminalById(id, tx)
    if (!existing) throw new NotFoundError('Terminal not found')
    assertTerminalAccess(user, existing)

    const updated = await updateTerminalRow(
      id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to update terminal')

    await writeAudit(
      {
        ...actor,
        action: 'terminal.updated',
        entity: 'terminal',
        entityId: id,
        before: { name: existing.name, isActive: existing.isActive },
        after: { name: updated.name, isActive: updated.isActive },
        branchId: updated.branchId,
        terminalId: id,
      },
      tx,
    )
    return updated
  })
}

export async function listDevices(user: SessionUser, terminalId: string): Promise<DeviceRow[]> {
  const terminalRecord = await getTerminal(user, terminalId)
  return listDeviceRows(terminalRecord.id)
}

export async function revokeDevice(
  user: SessionUser,
  actor: AuditActor,
  deviceId: string,
): Promise<DeviceRow> {
  return db.transaction(async (tx) => {
    const found = await findDeviceById(deviceId, tx)
    if (!found) throw new NotFoundError('Device not found')

    const parent = await findTerminalById(found.terminalId, tx)
    if (!parent) throw new NotFoundError('Terminal not found')
    assertTerminalAccess(user, parent)
    if (found.status === 'REVOKED') return found

    const updated = await updateDeviceRow(
      deviceId,
      { status: 'REVOKED', revokedAt: new Date(), revokedBy: actor.actorId },
      tx,
    )
    if (!updated) throw new AppError(500, 'INTERNAL', 'Failed to revoke device')

    await writeAudit(
      {
        ...actor,
        action: 'device.revoked',
        entity: 'device',
        entityId: deviceId,
        before: { status: 'ACTIVE' },
        after: { status: 'REVOKED' },
        branchId: parent.branchId,
        terminalId: parent.id,
      },
      tx,
    )
    return updated
  })
}
