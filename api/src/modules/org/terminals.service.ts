import { db } from '@gikautos/db'
import { branch, device, terminal } from '@gikautos/db/schema'
import { and, asc, eq, type SQL } from 'drizzle-orm'
import { assertBranchAccess, branchScope } from '../../http/authorize.ts'
import { AppError, ConflictError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { type AuditActor, writeAudit } from '../platform/audit.service.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'

export interface TerminalCreateInput {
  branchId: string
  name: string
}

export interface TerminalUpdateInput {
  name?: string | undefined
  isActive?: boolean | undefined
}

const MAX_CODE_ATTEMPTS = 5

async function loadBranch(branchId: string): Promise<typeof branch.$inferSelect> {
  const rows = await db.select().from(branch).where(eq(branch.id, branchId)).limit(1)
  const found = rows[0]
  if (!found) throw new NotFoundError('Branch not found')
  return found
}

async function loadTerminal(id: string): Promise<typeof terminal.$inferSelect> {
  const rows = await db.select().from(terminal).where(eq(terminal.id, id)).limit(1)
  const found = rows[0]
  if (!found) throw new NotFoundError('Terminal not found')
  return found
}

export function assertTerminalAccess(
  user: SessionUser,
  terminalRecord: typeof terminal.$inferSelect,
): void {
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
  options: { branchId?: string | undefined; includeInactive: boolean },
): Promise<(typeof terminal.$inferSelect)[]> {
  const scope = branchScope(user)
  let branchFilter = scope
  if (branchFilter === null && options.branchId) {
    branchFilter = options.branchId
  }

  const filters: SQL[] = []
  if (branchFilter) filters.push(eq(terminal.branchId, branchFilter))
  if (!options.includeInactive) filters.push(eq(terminal.isActive, true))

  return db
    .select()
    .from(terminal)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(terminal.code))
}

export async function getTerminal(
  user: SessionUser,
  id: string,
): Promise<typeof terminal.$inferSelect> {
  const found = await loadTerminal(id)
  assertTerminalAccess(user, found)
  return found
}

export async function createTerminal(
  user: SessionUser,
  actor: AuditActor,
  input: TerminalCreateInput,
): Promise<typeof terminal.$inferSelect> {
  assertBranchAccess(user, input.branchId)
  const parent = await loadBranch(input.branchId)
  if (!parent.isActive) throw new ConflictError('Cannot add terminals to a deactivated branch')

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const existing = await tx
          .select({ code: terminal.code })
          .from(terminal)
          .where(eq(terminal.branchId, input.branchId))
        const code = nextCodeFrom(
          existing.map((row) => row.code),
          parent.code,
        )

        const rows = await tx
          .insert(terminal)
          .values({
            branchId: input.branchId,
            code,
            name: input.name,
            createdBy: actor.actorId,
          })
          .returning()
        const created = rows[0]
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
): Promise<typeof terminal.$inferSelect> {
  return db.transaction(async (tx) => {
    const existingRows = await tx.select().from(terminal).where(eq(terminal.id, id)).limit(1)
    const existing = existingRows[0]
    if (!existing) throw new NotFoundError('Terminal not found')
    assertTerminalAccess(user, existing)

    const rows = await tx
      .update(terminal)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .where(eq(terminal.id, id))
      .returning()
    const updated = rows[0]
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

export async function listDevices(
  user: SessionUser,
  terminalId: string,
): Promise<(typeof device.$inferSelect)[]> {
  const terminalRecord = await loadTerminal(terminalId)
  assertTerminalAccess(user, terminalRecord)

  return db
    .select()
    .from(device)
    .where(eq(device.terminalId, terminalId))
    .orderBy(asc(device.enrolledAt))
}

export async function revokeDevice(
  user: SessionUser,
  actor: AuditActor,
  deviceId: string,
): Promise<typeof device.$inferSelect> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(device).where(eq(device.id, deviceId)).limit(1)
    const found = rows[0]
    if (!found) throw new NotFoundError('Device not found')

    const terminalRows = await tx
      .select()
      .from(terminal)
      .where(eq(terminal.id, found.terminalId))
      .limit(1)
    const parent = terminalRows[0]
    if (!parent) throw new NotFoundError('Terminal not found')
    assertTerminalAccess(user, parent)
    if (found.status === 'REVOKED') return found

    const updatedRows = await tx
      .update(device)
      .set({ status: 'REVOKED', revokedAt: new Date(), revokedBy: actor.actorId })
      .where(eq(device.id, deviceId))
      .returning()
    const updated = updatedRows[0]
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
