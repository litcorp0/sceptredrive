import { type DbExecutor, db } from '@sceptre/db'
import { eq } from 'drizzle-orm'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'

export interface DeviceSessionRow {
  device: typeof device.$inferSelect
  terminal: typeof terminal.$inferSelect
  branch: typeof branch.$inferSelect
}

const sessionSelection = {
  device: device,
  terminal: terminal,
  branch: branch,
}

function joinSession(executor: DbExecutor) {
  return executor
    .select(sessionSelection)
    .from(device)
    .innerJoin(terminal, eq(device.terminalId, terminal.id))
    .innerJoin(branch, eq(terminal.branchId, branch.id))
}

/** Resolves an enrolled terminal from its hashed device token. */
export async function findSessionByTokenHash(
  tokenHash: string,
  executor: DbExecutor = db,
): Promise<DeviceSessionRow | null> {
  const rows = await joinSession(executor).where(eq(device.tokenHash, tokenHash)).limit(1)
  return rows[0] ?? null
}

/**
 * Resolves an enrolled terminal from a verified device JWT. Used on every
 * device-authenticated request, so it must stay a single indexed lookup.
 */
export async function findSessionByDeviceId(
  deviceId: string,
  executor: DbExecutor = db,
): Promise<DeviceSessionRow | null> {
  const rows = await joinSession(executor).where(eq(device.id, deviceId)).limit(1)
  return rows[0] ?? null
}
