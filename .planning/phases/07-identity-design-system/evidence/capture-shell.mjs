// Runtime proof for Phase 7 Plan 06: both clients sit on the new design system.
// The admin half runs here; the POS chrome is proven by the packaged-shell smoke
// and the Plan 07 walkthrough (it needs an enrolled terminal and a shift).
//
// Run with the API and the admin dev server up:
//   bun run dev:api & bun run dev:admin
//   node .planning/phases/07-identity-design-system/evidence/capture-shell.mjs
import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const base = process.env.ADMIN_URL ?? 'http://localhost:3000'
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

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(20_000)

async function shot(name) {
  await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true })
  console.log(`  shot ${name}.png`)
}

console.log('Phase 7 Plan 06 shell capture\n')

try {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await robustFill(page, '#email', envValue('ADMIN_EMAIL'))
  await robustFill(page, '#password', envValue('ADMIN_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), { timeout: 25_000 })

  if (new URL(page.url()).pathname.startsWith('/two-factor')) {
    const { secret } = JSON.parse(fs.readFileSync(totpFile, 'utf8'))
    await robustFill(page, '#code', totpCode(secret))
    await page.getByRole('button', { name: 'Verify' }).click()
    await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 25_000 })
  }

  await page.waitForLoadState('networkidle')
  check(new URL(page.url()).pathname === '/', 'admin signs in with password + TOTP')
  await page.locator('[data-slot="sidebar-group-label"]').first().waitFor({ timeout: 20_000 })

  // ---- sidebar ----
  const groupLabels = await page
    .locator('[data-slot="sidebar-group-label"]')
    .allTextContents()
  check(
    ['Overview', 'Operations', 'Organisation', 'System'].every((label) =>
      groupLabels.map((value) => value.trim()).includes(label),
    ),
    'sidebar renders the four groups',
    groupLabels.join(', '),
  )

  const active = page.locator('[data-slot="sidebar"] a[aria-current="page"]').first()
  check((await active.count()) === 1, 'exactly one nav item is current')
  check((await active.getAttribute('data-active')) === 'true', 'active item carries data-active')

  const rail = await active.evaluate((element) => {
    const style = getComputedStyle(element, '::before')
    return {
      width: style.width,
      background: style.backgroundColor,
      opacity: style.opacity,
      position: style.position,
    }
  })
  check(
    rail.width === '2px' && rail.background === 'rgb(242, 106, 27)' && rail.opacity === '1',
    'active item draws the 2px brand rail',
    JSON.stringify(rail),
  )

  const accentCount = await page
    .locator('[data-slot="sidebar"] .bg-brand')
    .count()
  check(accentCount === 0, 'no solid brand block competes with the rail', String(accentCount))

  // ---- topbar ----
  const topbar = await page.locator('header').first().evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, height: style.height, position: style.position }
  })
  check(
    topbar.background === 'rgb(27, 31, 35)' && topbar.height === '52px' && topbar.position === 'sticky',
    'topbar is the charcoal fascia at the token height',
    JSON.stringify(topbar),
  )

  // ---- skip link and focus ring ----
  await page.evaluate(() => document.body.focus())
  await page.keyboard.press('Tab')
  const firstFocus = await page.evaluate(() => {
    const element = document.activeElement
    return {
      text: element?.textContent?.trim() ?? '',
      href: element?.getAttribute('href') ?? '',
    }
  })
  check(
    firstFocus.text === 'Skip to main content' && firstFocus.href === '#main',
    'first Tab reaches the skip link',
    JSON.stringify(firstFocus),
  )

  const ring = await page.evaluate(() => {
    const button = document.querySelector('header button[aria-label="Theme"]')
    if (!button) return null
    const style = getComputedStyle(button)
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
  })
  check(ring !== null, 'theme toggle is rendered on the fascia')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const focusedRing = await page.evaluate(() => {
    const element = document.activeElement
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      tag: element.tagName,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    }
  })
  check(
    focusedRing?.outlineStyle === 'solid' && focusedRing?.outlineWidth === '2px',
    'focused control draws a solid 2px outline',
    JSON.stringify(focusedRing),
  )
  await page.keyboard.press('Escape')

  // ---- print ----
  await page.emulateMedia({ media: 'print' })
  const printState = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-slot="sidebar"]')
    const header = document.querySelector('header')
    return {
      sidebar: sidebar ? getComputedStyle(sidebar).display : 'missing',
      header: header ? getComputedStyle(header).display : 'missing',
    }
  })
  await page.emulateMedia({ media: 'screen' })
  check(
    printState.sidebar === 'none' && printState.header === 'none',
    'print hides the rail and the fascia',
    JSON.stringify(printState),
  )

  // ---- light ----
  await page.evaluate(() => window.localStorage.setItem('sceptre:theme', 'light'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await shot('plan06-admin-light')

  // ---- dark ----
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await page.waitForTimeout(300)
  const darkState = await page.evaluate(() => ({
    cls: document.documentElement.className,
    scheme: document.documentElement.style.colorScheme,
    stored: window.localStorage.getItem('sceptre:theme'),
    canvas: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(),
  }))
  check(
    darkState.cls.includes('dark') && darkState.scheme === 'dark' && darkState.stored === 'dark',
    'theme toggle switches to dark and persists',
    JSON.stringify(darkState),
  )
  check(darkState.canvas === '#1b1f23', 'dark canvas comes from the shared token file', darkState.canvas)
  await shot('plan06-admin-dark')

  // No flash: the pre-hydration script must set the class before React paints.
  await page.reload({ waitUntil: 'domcontentloaded' })
  const preHydration = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  check(preHydration, 'reload applies dark before hydration (no light flash)')

  // ---- mobile drawer ----
  await page.setViewportSize({ width: 375, height: 800 })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByRole('dialog').waitFor({ timeout: 10_000 })
  check(true, 'mobile menu opens the drawer')
  await shot('plan06-admin-mobile-drawer')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check((await page.getByRole('dialog').count()) === 0, 'Escape closes the drawer')
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
