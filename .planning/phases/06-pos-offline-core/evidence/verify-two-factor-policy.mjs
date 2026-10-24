#!/usr/bin/env node
/**
 * Post-phase security fix verification: the "require two-factor" toggle.
 *
 *  1. an unenrolled admin sees the Security switch Off in Settings;
 *  2. turning it On is refused server-side (and explained) because that admin
 *     has no authenticator — the safeguard against locking everyone out;
 *  3. with the setting forced on in the database (simulating an enrolled admin
 *     enabling it), a fresh sign-in is redirected to forced TOTP setup;
 *  4. turning it off again lets the same account straight into the console.
 *
 * The setting is restored to Off in a finally block. Run with the API on :4000
 * and the console on :3000:
 *
 *   node .planning/phases/06-pos-offline-core/evidence/verify-two-factor-policy.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { chromium } from 'playwright'

const repo = path.resolve(import.meta.dirname, '..', '..', '..', '..')
const BASE = process.env.CONSOLE_URL ?? 'http://localhost:3000'
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://gikautos:gikautos@localhost:5432/gikautos_dev'
const shots = path.join(repo, '.planning', 'phases', '06-pos-offline-core', 'evidence', 'shots')
const SHOTS = process.env.SHOTS_DIR ?? `${shots}/`

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

const db = new Client({ connectionString: DATABASE_URL })
await db.connect()

async function setPolicy(value) {
  // The global uniqueness is a partial index (`branch_id is null`), so replace
  // rather than relying on ON CONFLICT inference.
  await db.query(`DELETE FROM setting WHERE key = 'auth.requireTwoFactor' AND branch_id IS NULL`)
  if (value === null) return
  await db.query(
    `INSERT INTO setting (key, value, branch_id) VALUES ('auth.requireTwoFactor', $1::jsonb, NULL)`,
    [JSON.stringify(value)],
  )
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`)
  // Wait for hydration: typing into the SSR markup before React attaches the
  // submit handler leaves the click a no-op.
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1_000)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // TanStack Router navigates client-side, so there is no load event to await.
  await page
    .waitForFunction(() => !window.location.pathname.startsWith('/login'), null, {
      timeout: 30_000,
    })
    .catch(async (error) => {
      const alert = await page
        .getByRole('alert')
        .textContent()
        .catch(() => null)
      throw new Error(`${error.message}${alert ? ` — page says: ${alert}` : ''}`)
    })
}

const browser = await chromium.launch({ channel: 'chromium' })
try {
  console.log('Two-factor requirement toggle\n')
  await setPolicy(null)

  const adminEmail = envValue('ADMIN_EMAIL')
  const adminPassword = envValue('ADMIN_PASSWORD')

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)

  await signIn(page, adminEmail, adminPassword)
  check('an admin signs in with the password only', new URL(page.url()).pathname === '/')

  await page.goto(`${BASE}/settings`)
  await page.waitForLoadState('networkidle')
  const toggle = page.getByRole('switch', { name: 'Require two-factor authentication' })
  await toggle.waitFor({ timeout: 20_000 })
  check('the Security toggle is present', (await toggle.count()) === 1)
  check('it starts off', (await toggle.getAttribute('data-state')) === 'unchecked')
  await page.screenshot({ path: `${SHOTS}11-security-toggle-off.png`, fullPage: true })

  await toggle.click()
  const errorText = await page
    .getByText(/Set up two-factor authentication on your own account/i)
    .first()
    .textContent({ timeout: 15_000 })
    .catch(() => null)
  check(
    'enabling it without 2FA is refused with a clear message',
    Boolean(errorText),
    errorText ?? '',
  )
  check(
    'the switch stays off after the refusal',
    (await toggle.getAttribute('data-state')) === 'unchecked',
  )
  await page.screenshot({ path: `${SHOTS}12-security-toggle-refused.png`, fullPage: true })

  // Simulate an enrolled admin enabling it (the API test covers that path).
  await setPolicy(true)
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const freshPage = await fresh.newPage()
  freshPage.setDefaultTimeout(20_000)
  await signIn(freshPage, adminEmail, adminPassword)
  const guardUrl = new URL(freshPage.url())
  check(
    'a fresh sign-in is forced to TOTP setup while the policy is on',
    guardUrl.pathname === '/two-factor' && guardUrl.searchParams.get('setup') === '1',
    freshPage.url(),
  )
  check(
    'forced setup offers no "not now" escape',
    (await freshPage.getByRole('link', { name: /Not now/i }).count()) === 0,
  )
  await freshPage.screenshot({ path: `${SHOTS}13-forced-2fa.png`, fullPage: true })

  await setPolicy(null)
  const fresh2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const fresh2Page = await fresh2.newPage()
  fresh2Page.setDefaultTimeout(20_000)
  await signIn(fresh2Page, adminEmail, adminPassword)
  check(
    'turning the policy off returns the account to the console',
    new URL(fresh2Page.url()).pathname === '/',
    fresh2Page.url(),
  )

  const response = await fetch('http://localhost:4000/api/auth/policy')
  check(
    'the public policy endpoint reports off',
    (await response.json()).requireTwoFactor === false,
  )
} catch (error) {
  failed += 1
  failures.push(`unhandled: ${error.message}`)
  console.error('\nUNHANDLED ERROR', error)
} finally {
  await setPolicy(null).catch(() => {})
  await browser.close().catch(() => {})
  await db.end()
}

console.log(`\n${passed}/${passed + failed} checks passed`)
if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
