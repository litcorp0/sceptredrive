import { db } from '@sceptre/db'
import { createUserWithCredential, findUserByEmail } from './helpers.ts'

export type SeedAdminResult = 'created' | 'skipped'

/** Optional overrides for the CLI; the environment is the default source. */
export interface SeedAdminInput {
  email?: string | undefined
  password?: string | undefined
  name?: string | undefined
}

const DEFAULT_ADMIN_NAME = 'Sceptre Drive Admin'

/**
 * Idempotently creates the bootstrap admin from ADMIN_EMAIL / ADMIN_PASSWORD.
 * The admin has no branch. Two-factor authentication is not part of the product.
 *
 * `input` exists for the `seed:admin` CLI, which can add another administrator
 * without editing `.env`. The password is never logged.
 */
export async function seedAdmin(input: SeedAdminInput = {}): Promise<SeedAdminResult> {
  const email = (input.email ?? process.env.ADMIN_EMAIL)?.trim().toLowerCase()
  if (!email) {
    throw new Error('ADMIN_EMAIL is required to seed the admin account')
  }

  const existing = await findUserByEmail(email)
  if (existing) return 'skipped'

  const password = input.password ?? process.env.ADMIN_PASSWORD
  if (!password || password.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters to seed the admin account')
  }

  const name = input.name?.trim() || DEFAULT_ADMIN_NAME

  await db.transaction(async (tx) => {
    await createUserWithCredential(tx, {
      email,
      name,
      password,
      role: 'ADMIN',
      branchId: null,
      mustChangePassword: false,
    })
  })

  return 'created'
}
