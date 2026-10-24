import { checkDb, db } from '@sceptre/db'
import type { Role } from '@sceptre/shared'
import { eq } from 'drizzle-orm'
import { app } from '../src/app.ts'
import { auth } from '../src/auth/auth.ts'
import { user as userTable } from '../src/modules/identity/staff.schema.ts'

export const TEST_PASSWORD = 'test-password-1234'
export const TEST_ORIGIN = 'http://localhost:3000'

export async function databaseAvailable(): Promise<boolean> {
  try {
    await checkDb()
    return true
  } catch {
    return false
  }
}

let counter = 0

export function uniqueSuffix(): string {
  counter += 1
  return `${Date.now().toString(36)}${counter}`.toLowerCase().slice(-8)
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Random uppercase token safe for branch and terminal codes. */
export function randomToken(length = 3): string {
  let token = ''
  for (let index = 0; index < length; index += 1) {
    token += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return token
}

export interface TestUserOptions {
  role?: Role
  branchId?: string | null
  email?: string
  name?: string
}

export async function createTestUser(
  options: TestUserOptions = {},
): Promise<{ id: string; email: string }> {
  const email = options.email ?? `test-${uniqueSuffix()}@sceptre.test`
  const result = await auth.api.signUpEmail({
    body: { email, password: TEST_PASSWORD, name: options.name ?? 'Test User' },
  })
  const id = result.user.id

  await db
    .update(userTable)
    .set({ role: options.role ?? 'ADMIN', branchId: options.branchId ?? null })
    .where(eq(userTable.id, id))

  return { id, email }
}

export async function signIn(email: string, password = TEST_PASSWORD): Promise<string> {
  const response = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: TEST_ORIGIN },
    body: JSON.stringify({ email, password }),
  })

  if (response.status !== 200) {
    throw new Error(`sign-in failed (${response.status}): ${await response.text()}`)
  }

  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

export function authedHeaders(cookie: string): Record<string, string> {
  return { cookie, 'content-type': 'application/json', origin: TEST_ORIGIN }
}

export async function deleteTestUser(id: string): Promise<void> {
  await db.delete(userTable).where(eq(userTable.id, id))
}
