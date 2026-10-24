import { type DbExecutor, db } from '@sceptre/db'
import { and, eq, ne } from 'drizzle-orm'
import { session } from '../modules/identity/staff.schema.ts'

/**
 * Revokes sessions directly in the database. Used for password resets,
 * deactivation, and password changes. The signed cookie cache can keep a
 * revoked session usable for up to its 5-minute max age.
 */
export async function revokeUserSessions(
  userId: string,
  options: { exceptToken?: string | undefined } = {},
  executor: DbExecutor = db,
): Promise<void> {
  const filters = [eq(session.userId, userId)]
  if (options.exceptToken) filters.push(ne(session.token, options.exceptToken))
  await executor.delete(session).where(and(...filters))
}
