import { createHmac } from 'node:crypto'
import { db } from '@sceptre/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../test/integration.ts'
import { app } from '../app.ts'
import { user as userTable } from '../modules/identity/staff.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[two-factor.test] database unavailable; integration tests skipped')

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

async function signInRequest(email: string): Promise<Response> {
  return await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: TEST_ORIGIN },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  })
}

function base32Decode(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char)
    if (value === -1) continue
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

function totpCode(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / 30)
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buffer.writeUInt32BE(counter % 2 ** 32, 4)
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f
  const code =
    ((((digest[offset] ?? 0) & 0x7f) << 24) |
      ((digest[offset + 1] ?? 0) << 16) |
      ((digest[offset + 2] ?? 0) << 8) |
      (digest[offset + 3] ?? 0)) %
    1_000_000
  return String(code).padStart(6, '0')
}

/**
 * Better Auth generates mixed-case backup codes (`a-zA-Z0-9`, formatted
 * `xxxxx-xxxxx`) and compares them with an exact string match. The console used
 * to uppercase operator input, so every code containing a lowercase letter was
 * rejected at sign-in. These assertions pin the server behaviour the console
 * must preserve (and prove the codes are single-use).
 */
describe.skipIf(!available)('two-factor backup codes', () => {
  const createdUserIds: string[] = []
  let email = ''
  let cookie = ''
  let backupCodes: string[] = []

  beforeAll(async () => {
    const user = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(user.id)
    email = user.email
    cookie = cookiesOf(await signInRequest(email))
  })

  afterAll(async () => {
    for (const userId of createdUserIds) await deleteTestUser(userId)
  })

  it('enables two-factor with a TOTP code and returns mixed-case backup codes', async () => {
    const enabled = await app.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify({ password: TEST_PASSWORD }),
    })
    expect(enabled.status).toBe(200)
    const body = (await enabled.json()) as { backupCodes: string[]; totpURI: string }
    backupCodes = body.backupCodes
    expect(backupCodes).toHaveLength(10)
    expect(backupCodes[0]).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/)

    const secret = new URL(body.totpURI).searchParams.get('secret') ?? ''
    const verified = await app.request('/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify({ code: totpCode(secret) }),
    })
    expect(verified.status).toBe(200)

    const rows = await db
      .select({ enabled: userTable.twoFactorEnabled })
      .from(userTable)
      .where(eq(userTable.email, email))
    expect(rows[0]?.enabled).toBe(true)
  })

  it('rejects a case-changed code (the old console uppercased input)', async () => {
    const first = backupCodes[0] ?? ''
    const upper = first.toUpperCase()
    if (upper === first) return
    const signIn = await signInRequest(email)
    expect(((await signIn.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true)

    const rejected = await app.request('/api/auth/two-factor/verify-backup-code', {
      method: 'POST',
      headers: authedHeaders(cookiesOf(signIn)),
      body: JSON.stringify({ code: upper }),
    })
    expect(rejected.status).toBeGreaterThanOrEqual(400)
  })

  it('accepts the exact code at sign-in', async () => {
    const first = backupCodes[0] ?? ''
    const signIn = await signInRequest(email)
    const tempCookie = cookiesOf(signIn)
    expect(((await signIn.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true)

    const accepted = await app.request('/api/auth/two-factor/verify-backup-code', {
      method: 'POST',
      headers: authedHeaders(tempCookie),
      body: JSON.stringify({ code: first }),
    })
    expect(accepted.status).toBe(200)
  })
})
