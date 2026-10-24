#!/usr/bin/env node
/**
 * Post-phase security fix verification: backup codes at sign-in.
 *
 * Better Auth backup codes are mixed-case and case-sensitive. The console used
 * to uppercase operator input, so a code containing a lowercase letter was
 * rejected. This script creates a throwaway admin, enables TOTP, signs in with
 * a backup code typed exactly as issued (mixed case), and lands on the
 * dashboard. The throwaway account is deleted afterwards.
 *
 *   node .planning/phases/06-pos-offline-core/evidence/verify-two-factor-backup.mjs
 */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { chromium } from 'playwright'

const repo = path.resolve(import.meta.dirname, '..', '..', '..', '..')
const BASE = process.env.CONSOLE_URL ?? 'http://localhost:3000'
const API = process.env.API_BASE_URL ?? 'http://localhost:4000'
const ORIGIN = 'http://localhost:3000'
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://gikautos:gikautos@localhost:5432/gikautos_dev'
const shots = path.join(repo, '.planning', 'phases', '06-pos-offline-core', 'evidence', 'shots')
const STAMP = Date.now().toString(36)
const NEW_PASSWORD = 'two-factor-smoke-2026'

let passed = 0
let failed = 0
const failures = []
function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    failures.push(label)
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function envValue(key) {
  const env = readFileSync(path.join(repo, '.env'), 'utf8')
  return (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]
}

function cookiesOf(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

async function api(pathname, { method = 'GET', cookie, body } = {}) {
  const headers = { origin: ORIGIN }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }
  return { response, body: parsed }
}

function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char)
    if (value === -1) continue
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

function totpCode(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30)
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buffer.writeUInt32BE(counter % 2 ** 32, 4)
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) %
    1_000_000
  return String(code).padStart(6, '0')
}

const db = new Client({ connectionString: DATABASE_URL })
await db.connect()
const email = `2fa-smoke-${STAMP}@gikautos.test`
let createdUserId = null
const browser = await chromium.launch({ channel: 'chromium' })

try {
  console.log('Backup-code sign-in\n')

  // Admin session over HTTP.
  const adminSignIn = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: envValue('ADMIN_EMAIL'),
      password: envValue('ADMIN_PASSWORD'),
    }),
  })
  const adminCookie = cookiesOf(adminSignIn)
  check('the operator admin signs in', adminSignIn.status === 200)

  const created = await api('/api/staff', {
    method: 'POST',
    cookie: adminCookie,
    body: { email, name: `2FA Smoke ${STAMP}`, role: 'ADMIN' },
  })
  createdUserId = created.body?.staff?.id ?? null
  const temporaryPassword = created.body?.temporaryPassword
  check('a throwaway admin is created', created.response.status === 201 && Boolean(createdUserId))

  // Clear the forced password change, then enable TOTP over the API.
  const userSignIn = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: temporaryPassword }),
  })
  const userCookie = cookiesOf(userSignIn)
  const changed = await api('/api/me/password', {
    method: 'POST',
    cookie: userCookie,
    body: { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD },
  })
  check('the throwaway admin clears the forced password change', changed.response.status === 200)

  const enabled = await api('/api/auth/two-factor/enable', {
    method: 'POST',
    cookie: userCookie,
    body: { password: NEW_PASSWORD },
  })
  const backupCodes = enabled.body?.backupCodes ?? []
  const totpUri = enabled.body?.totpURI ?? ''
  check('two-factor enables and issues ten backup codes', backupCodes.length === 10)

  const secret = new URL(totpUri).searchParams.get('secret') ?? ''
  const verified = await api('/api/auth/two-factor/verify-totp', {
    method: 'POST',
    cookie: userCookie,
    body: { code: totpCode(secret) },
  })
  check('the authenticator code finishes enrolment', verified.response.status === 200)

  // Browser sign-in with a mixed-case backup code typed exactly as issued.
  const backupCode = backupCodes[0]
  check(
    'the issued code is mixed case (the case the old console destroyed)',
    backupCode !== backupCode.toUpperCase(),
    backupCode,
  )

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1_000)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForFunction(() => window.location.pathname.startsWith('/two-factor'), null, {
    timeout: 30_000,
  })
  check('sign-in asks for the second factor', true)

  await page.getByRole('button', { name: 'Use a backup code instead' }).click()
  const input = page.locator('#code')
  await input.fill(backupCode)
  check('the backup code is not uppercased in the form', (await input.inputValue()) === backupCode)
  await page.screenshot({ path: `${shots}/14-backup-code.png`, fullPage: true })

  await page.getByRole('button', { name: 'Verify' }).click()
  await page.waitForFunction(() => window.location.pathname === '/', null, { timeout: 30_000 })
  check('the backup code signs the admin in', true)
  await page.screenshot({ path: `${shots}/15-backup-code-success.png`, fullPage: true })
} catch (error) {
  failed += 1
  failures.push(`unhandled: ${error.message}`)
  console.error('\nUNHANDLED ERROR', error)
} finally {
  await browser.close().catch(() => {})
  if (createdUserId) {
    await db.query(`DELETE FROM "user" WHERE id = $1`, [createdUserId]).catch(() => {})
  }
  await db.end()
}

console.log(`\n${passed}/${passed + failed} checks passed`)
if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
