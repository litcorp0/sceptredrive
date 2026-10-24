import { db } from '@sceptre/db'
import { createUserWithCredential, findUserByEmail } from './helpers.ts'

export type SeedAdminResult = 'created' | 'skipped'

/**
 * Idempotently creates the bootstrap admin from ADMIN_EMAIL / ADMIN_PASSWORD.
 * The admin has no branch and no TOTP secret: the console forces TOTP setup on
 * the first login.
 */
export async function seedAdmin(): Promise<SeedAdminResult> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!email) {
    throw new Error('ADMIN_EMAIL is required to seed the admin account')
  }

  const existing = await findUserByEmail(email)
  if (existing) return 'skipped'

  const password = process.env.ADMIN_PASSWORD
  if (!password || password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters to seed the admin account')
  }

  await db.transaction(async (tx) => {
    await createUserWithCredential(tx, {
      email,
      name: 'GikAutos Admin',
      password,
      role: 'ADMIN',
      branchId: null,
      mustChangePassword: false,
    })
  })

  return 'created'
}
