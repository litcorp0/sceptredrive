import { createHmac } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

// Plan 04 console smoke: admin sets a temporary POS PIN from Staff, the badge
// flips to Temporary, and no PIN material reaches the network payloads.

const BASE = 'http://localhost:3000'
const API = 'http://localhost:4000'
const SHOTS = process.env.SHOTS_DIR ?? new URL('./shots/', import.meta.url).pathname
const TOTP_FILE = '/tmp/opencode/admin-totp.json'
mkdirSync(SHOTS, { recursive: true })

let passed = 0
let failed = 0
function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
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
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
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

const env = readFileSync('/home/litcorp/Projects/Fullstack/gikautos/.env', 'utf8')
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\n]*)`, 'm')) ?? [])[1]

const browser = await chromium.launch({ channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(20_000)
const dialog = () => page.getByRole('dialog')

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true })
}

async function robustFill(selector, value) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.fill(selector, value)
    if ((await page.inputValue(selector)) === value) return
    await page.waitForTimeout(250)
  }
  throw new Error(`could not fill ${selector}`)
}

/** Reads a TOTP secret from the setup page and stores it for later runs. */
async function bootstrapTotp() {
  await robustFill('#current-password', envValue('ADMIN_PASSWORD'))
  await page.getByRole('button', { name: 'Continue' }).click()
  const secret = (
    await page.locator('details p.font-mono').first().textContent({ timeout: 20_000 })
  )?.trim()
  if (!secret) throw new Error('TOTP setup did not render the manual key')
  writeFileSync(TOTP_FILE, JSON.stringify({ secret }), { mode: 0o600 })
  await page.getByRole('button', { name: "I've saved my backup codes" }).click()
  await robustFill('#code', totpCode(secret))
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 25_000 })
  return secret
}

console.log('Plan 04 console PIN smoke\n')

const networkBodies = []
page.on('response', async (response) => {
  if (!response.url().includes('/api/staff')) return
  try {
    networkBodies.push({ url: response.url(), body: await response.text() })
  } catch {
    // body already consumed
  }
})

try {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await robustFill('#email', envValue('ADMIN_EMAIL'))
  await robustFill('#password', envValue('ADMIN_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), {
    timeout: 25_000,
  })

  let secret = null
  try {
    secret = JSON.parse(readFileSync(TOTP_FILE, 'utf8')).secret
  } catch {
    secret = null
  }

  if (new URL(page.url()).pathname.startsWith('/two-factor')) {
    if (new URL(page.url()).searchParams.get('setup') === '1') {
      secret = await bootstrapTotp()
    } else {
      await robustFill('#code', totpCode(secret))
      await page.getByRole('button', { name: 'Verify' }).click()
      await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 25_000 })
    }
  }
  check('admin signs in with password + TOTP', new URL(page.url()).pathname === '/')
  await shot('01-admin-dashboard')

  await page.goto(`${BASE}/staff`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)

  const cashierRow = page.getByRole('row').filter({ hasText: 'Demo Cashier' }).first()
  await cashierRow.waitFor({ timeout: 20_000 })
  check('staff list renders the cashier with a PIN column', true)

  await cashierRow.getByRole('button', { name: /Actions for Demo Cashier/ }).click()
  await page.getByRole('menuitem', { name: 'Set PIN' }).click()
  await dialog().waitFor()

  // The client rejects a trivial PIN before any request.
  await robustFill('#pin-new', '1234')
  await robustFill('#pin-confirm', '1234')
  await dialog().getByRole('button', { name: 'Set PIN' }).click()
  await dialog()
    .getByText(/not a repeated digit or a straight sequence/i)
    .waitFor({ timeout: 10_000 })
  check('trivial PINs are rejected in the dialog', true)
  await shot('02-pin-dialog-trivial')

  await robustFill('#pin-new', '2468')
  await robustFill('#pin-confirm', '2468')
  await dialog().getByRole('button', { name: 'Set PIN' }).click()
  await page
    .getByText(/Temporary PIN set \(version \d+\)/i)
    .first()
    .waitFor({ timeout: 20_000 })
  check('admin sets a temporary PIN', true)

  await cashierRow.getByText('Temporary', { exact: true }).waitFor({ timeout: 20_000 })
  check('the PIN badge flips to Temporary', true)
  await shot('03-staff-pin-badge')

  const leaked = networkBodies.filter(({ body }) => /pinHash|pin_hash|\$argon2/i.test(body))
  check('no PIN hash appears in network payloads', leaked.length === 0)

  // The status endpoint agrees, and never returns the hash.
  const cookies = await context.cookies(API)
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  const staffList = await (
    await fetch(`${API}/api/staff?search=Demo%20Cashier`, {
      headers: { origin: BASE, cookie: cookieHeader },
    })
  ).json()
  const cashier = staffList.staff?.find((row) => row.email === 'cashier@gikautos.local')
  check('the list carries PIN metadata for the badge', Boolean(cashier?.pinMustChange))

  const status = await (
    await fetch(`${API}/api/staff/${cashier.id}/pin-status`, {
      headers: { origin: BASE, cookie: cookieHeader },
    })
  ).json()
  check(
    'pin-status reports hasPin + a bumped version without a hash',
    status.hasPin === true && status.pinVersion === cashier.pinVersion && !('pinHash' in status),
  )
} catch (error) {
  failed += 1
  console.log(`  FAIL  smoke aborted — ${error instanceof Error ? error.message : error}`)
  await shot('99-failure').catch(() => undefined)
} finally {
  await browser.close()
}

console.log(`\n${passed}/${passed + failed} checks passed`)
process.exit(failed === 0 ? 0 : 1)
