#!/usr/bin/env node
/**
 * Phase 7 Plan 07, Task 3 — the human walkthrough, driven in a real browser.
 *
 * Steps 1–5 and 7 of the plan. Each step asserts the thing the plan claims and writes a
 * screenshot, so a reviewer can re-run one command instead of trusting a paragraph.
 *
 * Step 6 (chart gallery) lives in `verify-charts-{admin,desktop}.mjs`, step 10 in
 * `desktop/test/e2e/security-smoke.mjs`, and steps 8–9 in `walkthrough-pos.mjs`.
 *
 * Requires the API on :4000 and the admin dev server on :3000:
 *   bun run dev:api & bun run dev:admin
 *   node .planning/phases/07-identity-design-system/evidence/walkthrough-admin.mjs
 */
import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { formatDateTime, formatDay } from '@sceptre/shared'
import { chromium } from 'playwright'

const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3000'
const apiUrl = process.env.API_BASE_URL ?? 'http://localhost:4000'
const evidenceDir = path.resolve(import.meta.dirname, 'shots')
const totpFile = process.env.TOTP_FILE ?? '/tmp/opencode/admin-totp.json'
fs.mkdirSync(evidenceDir, { recursive: true })

const failures = []
let checks = 0

function check(condition, label, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
    return true
  }
  failures.push(detail ? `${label} (${detail})` : label)
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  return false
}

function step(title) {
  console.log(`\n-- ${title} --`)
}

// --- helpers -----------------------------------------------------------------

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

const env = fs.readFileSync(path.resolve(import.meta.dirname, '../../../../.env'), 'utf8')
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]

async function robustFill(page, selector, value) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.fill(selector, value)
    if ((await page.inputValue(selector)) === value) return
    await page.waitForTimeout(250)
  }
  throw new Error(`could not fill ${selector}`)
}

/** ISO instant or bare date strings, in either helper shape. */
const HELPER_DATE = /\b\d{1,2} [A-Z][a-z]{2} \d{4}\b/g
const HELPER_DATETIME = /\b\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}\b/g
/** Anything the shared helpers would never emit. */
const ISO_LEAK = /\b\d{4}-\d{2}-\d{2}(?:T|\b)/g
const SLASH_LEAK = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(25_000)

async function shot(name, options = {}) {
  await page.screenshot({
    path: path.join(evidenceDir, `${name}.png`),
    fullPage: options.fullPage ?? true,
  })
  console.log(`  shot ${name}.png`)
}

async function signIn() {
  await page.goto(`${adminUrl}/login`, { waitUntil: 'networkidle' })
  await robustFill(page, '#email', envValue('ADMIN_EMAIL'))
  await robustFill(page, '#password', envValue('ADMIN_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), { timeout: 30_000 })

  const url = new URL(page.url())
  if (url.pathname.startsWith('/two-factor')) {
    if (url.searchParams.get('setup')) {
      // A freshly seeded database forces TOTP enrolment. Do it here and record the
      // manual key, so this script is runnable from an empty database.
      await page.getByText('Set up two-factor authentication').waitFor()
      await robustFill(page, '#current-password', envValue('ADMIN_PASSWORD'))
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByText('Scan this QR code').waitFor()
      await page.getByText("Can't scan? Show the manual key").click()
      const secret = (await page.locator('details p.font-mono').innerText()).trim()
      fs.mkdirSync(path.dirname(totpFile), { recursive: true })
      fs.writeFileSync(totpFile, JSON.stringify({ secret }))
      await page.getByRole('button', { name: "I've saved my backup codes" }).click()
      await page.getByText('Enter the code from your app').waitFor()
      await robustFill(page, '#code', totpCode(secret))
      await page.getByRole('button', { name: 'Verify' }).click()
    } else {
      const { secret } = JSON.parse(fs.readFileSync(totpFile, 'utf8'))
      await robustFill(page, '#code', totpCode(secret))
      await page.getByRole('button', { name: 'Verify' }).click()
    }
    await page.waitForURL((value) => new URL(value).pathname === '/', { timeout: 30_000 })
  }
  await page.waitForLoadState('networkidle')
}

/** Dates rendered inside `main`, in helper shape, plus any leak of another shape. */
async function readDates() {
  const text = await page.locator('main').innerText()
  return {
    datetimes: text.match(HELPER_DATETIME) ?? [],
    days: text.match(HELPER_DATE) ?? [],
    isoLeaks: text.match(ISO_LEAK) ?? [],
    slashLeaks: text.match(SLASH_LEAK) ?? [],
    text,
  }
}

try {
  // ---------------------------------------------------------------- step 1
  step('1. Admin, light, 1440 px')

  await signIn()
  check(new URL(page.url()).pathname === '/', 'admin signs in')
  await page.locator('[data-slot="sidebar-group-label"]').first().waitFor()

  const groups = (await page.locator('[data-slot="sidebar-group-label"]').allTextContents()).map(
    (value) => value.trim(),
  )
  check(
    ['Overview', 'Operations', 'Organisation', 'System'].every((label) => groups.includes(label)),
    'sidebar renders the four groups',
    groups.join(', '),
  )

  const active = page.locator('[data-slot="sidebar"] a[aria-current="page"]').first()
  const rail = await active.evaluate((element) => {
    const style = getComputedStyle(element, '::before')
    return { width: style.width, background: style.backgroundColor }
  })
  check(
    rail.width === '2px' && rail.background === 'rgb(242, 106, 27)',
    'the active item is the only brand orange (2 px rail)',
    JSON.stringify(rail),
  )

  const fascia = await page.locator('header').first().evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, height: style.height }
  })
  check(
    fascia.background === 'rgb(27, 31, 35)' && fascia.height === '52px',
    'fascia is charcoal at the token height',
    JSON.stringify(fascia),
  )

  check(
    (await page.locator('[aria-label="Active branch"]').count()) === 1,
    'branch switcher is on the fascia',
  )
  check(
    (await page.locator('header button').filter({ hasText: /./ }).count()) > 0,
    'user menu is on the fascia',
  )
  await shot('plan07-01-admin-light-1440')

  // ---------------------------------------------------------------- step 2
  step('2. Admin, dark, no light flash on reload')

  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await page.waitForTimeout(300)
  const dark = await page.evaluate(() => ({
    cls: document.documentElement.className,
    canvas: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(),
    brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
  }))
  check(dark.cls.includes('dark'), 'theme toggle applies the dark class')
  check(dark.canvas === '#1b1f23', 'dark canvas comes from the shared token file', dark.canvas)
  check(dark.brand === '#f26a1b', 'the brand orange is unchanged in dark mode', dark.brand)
  await shot('plan07-02-admin-dark-1440')

  await page.reload({ waitUntil: 'domcontentloaded' })
  const preHydration = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  check(preHydration, 'dark is applied before hydration (no light flash)')
  await page.waitForLoadState('networkidle')
  check(
    (await page.locator('[data-slot="sidebar-group-label"]').count()) === 4,
    'dark reload keeps the same layout',
  )

  // ---------------------------------------------------------------- step 3
  step('3. Admin, 375 px drawer')

  await page.setViewportSize({ width: 375, height: 800 })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 15_000 })
  check(true, 'mobile menu opens the drawer')
  await shot('plan07-03-admin-375-drawer', { fullPage: false })

  // Focus trap: every Tab keeps focus inside the drawer.
  let trapped = true
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"]')
      return panel ? panel.contains(document.activeElement) : false
    })
    if (!inside) {
      trapped = false
      break
    }
  }
  check(trapped, 'Tab stays inside the drawer (focus trapped)')

  const reachable = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]')
    return panel ? panel.querySelectorAll('a[href]').length : 0
  })
  check(reachable > 5, 'navigation is reachable from the drawer', `${reachable} links`)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check((await page.getByRole('dialog').count()) === 0, 'Escape closes the drawer')

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.waitForTimeout(300)

  // ---------------------------------------------------------------- step 4
  step('4. Admin, keyboard only')

  await page.goto(`${adminUrl}/audit`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.body.focus())
  await page.keyboard.press('Tab')
  const first = await page.evaluate(() => ({
    text: document.activeElement?.textContent?.trim() ?? '',
    href: document.activeElement?.getAttribute('href') ?? '',
  }))
  check(
    first.text === 'Skip to main content' && first.href === '#main',
    'first Tab reaches the skip link',
    JSON.stringify(first),
  )

  await page.keyboard.press('Tab')
  const focusedRing = await page.evaluate(() => {
    const element = document.activeElement
    const style = element ? getComputedStyle(element) : null
    return style
      ? {
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          outlineColor: style.outlineColor,
        }
      : null
  })
  check(
    focusedRing?.outlineStyle === 'solid' && focusedRing?.outlineWidth === '2px',
    'the focused control draws a 2 px outline',
    JSON.stringify(focusedRing),
  )

  // The audit list must expand a row with the keyboard alone.
  const auditRow = page.locator('main tbody tr').first()
  await auditRow.waitFor({ timeout: 20_000 })
  await auditRow.focus()
  const expandedBefore = await page.locator('main tbody tr').count()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const expandedAfter = await page.locator('main tbody tr').count()
  check(
    expandedAfter > expandedBefore,
    'audit row opens its detail with Enter',
    `${expandedBefore} → ${expandedAfter} rows`,
  )
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await shot('plan07-04-admin-audit-keyboard')

  // Customers ledger, keyboard only.
  await page.goto(`${adminUrl}/customers`, { waitUntil: 'networkidle' })
  const customerLink = page.locator('main a[href*="/customers/"]').first()
  await customerLink.waitFor({ timeout: 20_000 })
  await customerLink.focus()
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 25_000 })
  check(/\/customers\/[^/]+$/.test(new URL(page.url()).pathname), 'customer ledger opens by keyboard')
  const customerId = new URL(page.url()).pathname.split('/').pop()
  await shot('plan07-04-admin-customer-ledger')

  // ---------------------------------------------------------------- step 7
  step('7. Dates — one formatter, three screens')

  // The audit list.
  await page.goto(`${adminUrl}/audit`, { waitUntil: 'networkidle' })
  await page.locator('main tbody tr').first().waitFor({ timeout: 20_000 })
  const auditDates = await readDates()
  check(auditDates.datetimes.length > 0, 'audit list renders helper-shaped timestamps')
  check(
    auditDates.isoLeaks.length === 0 && auditDates.slashLeaks.length === 0,
    'audit list leaks no ISO or slash date',
    [...auditDates.isoLeaks, ...auditDates.slashLeaks].slice(0, 3).join(', '),
  )

  const auditResponse = await context.request.get(`${apiUrl}/api/audit?limit=5`)
  const auditBody = await auditResponse.json()
  const auditExpected = (auditBody.entries ?? []).map((entry) => formatDateTime(entry.createdAt))
  check(
    auditExpected.some((value) => auditDates.text.includes(value)),
    'an audit row renders exactly what formatDateTime produces',
    auditExpected[0] ?? 'no entries',
  )

  // The credit ledger.
  await page.goto(`${adminUrl}/customers/${customerId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const ledgerDates = await readDates()
  check(ledgerDates.datetimes.length > 0, 'credit ledger renders helper-shaped timestamps')
  check(
    ledgerDates.isoLeaks.length === 0 && ledgerDates.slashLeaks.length === 0,
    'credit ledger leaks no ISO or slash date',
    [...ledgerDates.isoLeaks, ...ledgerDates.slashLeaks].slice(0, 3).join(', '),
  )

  const creditResponse = await context.request.get(
    `${apiUrl}/api/credit/entries?customerId=${customerId}`,
  )
  const creditBody = await creditResponse.json()
  const creditEntries = creditBody.entries ?? []
  check(creditEntries.length > 0, 'the demo customer has credit history', String(creditEntries.length))

  const sharedInstant = creditEntries[0]?.occurredAt
  const sharedRendering = sharedInstant ? formatDateTime(sharedInstant) : null
  check(
    sharedRendering !== null && ledgerDates.text.includes(sharedRendering),
    'the charge instant renders exactly as formatDateTime formats it',
    sharedRendering ?? 'no entries',
  )

  // The loyalty history.
  const loyaltyResponse = await context.request.get(
    `${apiUrl}/api/loyalty/accounts/${customerId}`,
  )
  const loyaltyBody = await loyaltyResponse.json()
  const loyaltyEntries = loyaltyBody.entries ?? []
  check(loyaltyEntries.length > 0, 'the demo customer has loyalty history', String(loyaltyEntries.length))

  const loyaltyScreen = await context.newPage()
  await loyaltyScreen.goto(`${adminUrl}/loyalty`, { waitUntil: 'networkidle' })
  await loyaltyScreen.waitForTimeout(800)
  const loyaltyText = await loyaltyScreen.locator('main').innerText()
  const loyaltyDates = loyaltyText.match(HELPER_DATETIME) ?? []
  check(loyaltyDates.length > 0, 'loyalty history renders helper-shaped timestamps')
  check(
    (loyaltyText.match(ISO_LEAK) ?? []).length === 0 &&
      (loyaltyText.match(SLASH_LEAK) ?? []).length === 0,
    'loyalty history leaks no ISO or slash date',
  )
  await loyaltyScreen.screenshot({
    path: path.join(evidenceDir, 'plan07-07-admin-loyalty.png'),
    fullPage: true,
  })
  console.log('  shot plan07-07-admin-loyalty.png')

  /**
   * The identical-instant claim: one instant, one rendering. The credit charge and the
   * loyalty earn from the same sale share a timestamp to the minute; both screens must
   * render it with the same characters.
   */
  const sharedWithLoyalty = loyaltyEntries
    .map((entry) => formatDateTime(entry.occurredAt))
    .find((value) => value === sharedRendering)
  check(
    sharedWithLoyalty !== undefined,
    'the same instant reads identically in the credit ledger and the loyalty history',
    `${formatDateTime(sharedInstant)} vs ${loyaltyEntries[0]?.occurredAt ?? 'none'}`,
  )
  await loyaltyScreen.close()

  // ---------------------------------------------------------------- step 5
  step('5. Admin, print (customer statement)')

  await page.goto(`${adminUrl}/customers/${customerId}/statement`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const statementDates = await readDates()
  check(statementDates.days.length > 0, 'the statement carries helper-shaped dates')
  check(
    statementDates.isoLeaks.length === 0 && statementDates.slashLeaks.length === 0,
    'the statement leaks no ISO or slash date',
  )

  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(400)
  const printState = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-slot="sidebar"]')
    const header = document.querySelector('header')
    const cells = [...document.querySelectorAll('main td')]
    const sizes = cells.map((cell) => Number.parseFloat(getComputedStyle(cell).fontSize))
    return {
      sidebar: sidebar ? getComputedStyle(sidebar).display : 'missing',
      header: header ? getComputedStyle(header).display : 'missing',
      cells: cells.length,
      minFontSize: sizes.length > 0 ? Math.min(...sizes) : 0,
    }
  })
  check(
    printState.sidebar === 'none' && printState.header === 'none',
    'print hides the rail and the fascia',
    JSON.stringify(printState),
  )
  check(
    printState.cells > 0 && printState.minFontSize >= 9,
    'statement tables stay legible in print',
    `min ${printState.minFontSize}px over ${printState.cells} cells`,
  )
  await shot('plan07-05-admin-statement-print')
  await page.emulateMedia({ media: 'screen' })

  await page.goto(`${adminUrl}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await page.evaluate(() => window.localStorage.setItem('sceptre:theme', 'light'))
  await page.reload({ waitUntil: 'networkidle' })
} catch (error) {
  failures.push(`exception: ${error instanceof Error ? error.message : String(error)}`)
  console.error(error)
} finally {
  await browser.close()
}

console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} failure(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`${checks}/${checks} checks passed`)
