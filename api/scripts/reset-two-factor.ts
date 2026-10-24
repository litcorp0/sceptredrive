import { closeDb, db } from '@sceptre/db'
import { eq } from 'drizzle-orm'
import '../src/config/env.ts'
import { twoFactor, user } from '../src/modules/identity/staff.schema.ts'
import { auditLog } from '../src/modules/platform/audit.schema.ts'

/**
 * Break-glass: turn two-factor authentication off for one account.
 *
 * Use when an administrator has lost both the authenticator and the backup
 * codes, or to clear a half-finished setup. It removes the TOTP secret and the
 * backup codes, and sets `two_factor_enabled = false`; the next sign-in uses the
 * password only. Sessions are left alone.
 *
 *   DATABASE_URL=… bun run --filter api two-factor:reset -- --email admin@sceptre.local
 *
 * This prints no secret and is audited as `auth.two_factor.reset` with the CLI
 * as the actor. Run it deliberately — it weakens the account's security.
 */

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : null
}

async function main(): Promise<void> {
  const email = option('--email')?.trim().toLowerCase()
  if (!email) {
    console.error('Usage: bun run --filter api two-factor:reset -- --email <address>')
    process.exit(2)
  }

  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, email))
  const target = rows[0]
  if (!target) {
    console.error(`No user with email ${email}`)
    process.exit(1)
  }

  const removed = await db.delete(twoFactor).where(eq(twoFactor.userId, target.id)).returning({
    id: twoFactor.id,
  })
  await db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, target.id))
  await db.insert(auditLog).values({
    action: 'auth.two_factor.reset',
    entity: 'user',
    entityId: target.id,
    actorId: 'cli',
    after: { email: target.email, removedEnrollments: removed.length, method: 'cli' },
  })

  console.log(
    `Two-factor disabled for ${target.email}: removed ${removed.length} enrollment(s). Sign in with the password; re-enroll from the user menu.`,
  )
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
