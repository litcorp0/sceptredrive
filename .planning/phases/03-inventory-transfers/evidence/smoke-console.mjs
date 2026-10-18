import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const SECRET_FILE = '/tmp/opencode/admin-totp.json'
const SHOTS = process.env.SHOTS_DIR ?? new URL('./', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const env = readFileSync('/home/litcorp/Projects/Fullstack/gikautos/.env', 'utf8')
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]
const ADMIN_EMAIL = envValue('ADMIN_EMAIL')
const ADMIN_PASSWORD = envValue('ADMIN_PASSWORD')

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

async function robustFill(page, selector, value) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.fill(selector, value)
    if ((await page.inputValue(selector)) === value) return
    await page.waitForTimeout(250)
  }
  throw new Error(`could not fill ${selector}`)
}

const browser = await chromium.launch({ channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 940 } })
const page = await context.newPage()
page.setDefaultTimeout(20_000)

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true })
}

async function loginAsAdmin() {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await robustFill(page, '#email', ADMIN_EMAIL)
  await robustFill(page, '#password', ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), { timeout: 20_000 })

  if (!new URL(page.url()).pathname.startsWith('/two-factor')) return

  await page.waitForFunction(
    () =>
      document.querySelector('#current-password') !== null ||
      document.querySelector('#code') !== null,
  )
  const setupMode = (await page.locator('#current-password').count()) > 0
  if (setupMode) {
    await page.fill('#current-password', ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Continue' }).click()
    const secretEl = page.locator('details p.font-mono').first()
    await secretEl.waitFor({ state: 'attached' })
    const secret = ((await secretEl.textContent()) ?? '').trim()
    writeFileSync(SECRET_FILE, JSON.stringify({ secret }))
    await page.getByRole('button', { name: "I've saved my backup codes" }).click()
    await page.fill('#code', totpCode(secret))
    await page.getByRole('button', { name: 'Verify' }).click()
  } else {
    if (!existsSync(SECRET_FILE)) throw new Error('TOTP enabled but no stored secret')
    const { secret } = JSON.parse(readFileSync(SECRET_FILE, 'utf8'))
    await page.fill('#code', totpCode(secret))
    await page.getByRole('button', { name: 'Verify' }).click()
  }
  await page.waitForURL((url) => new URL(url).pathname === '/')
}

async function pickProduct(scope, name) {
  await scope.getByPlaceholder('Search products by name or SKU…').click()
  await scope.getByPlaceholder('Search products by name or SKU…').fill(name)
  await page
    .getByRole('button', { name: new RegExp(name) })
    .first()
    .click()
  await scope.getByRole('button', { name: 'Change' }).waitFor()
}

console.log('== Phase 3 console smoke (stock screens) ==\n')

try {
  await loginAsAdmin()

  await page.getByRole('combobox', { name: 'Active branch' }).click()
  await page.getByRole('option', { name: /ACC-SPX/ }).click()

  await page.getByRole('link', { name: 'Inventory' }).click()
  await page.waitForURL('**/inventory/stock')
  await page.getByRole('heading', { name: 'Inventory' }).waitFor()

  await page.getByText('Bosch Oil Filter').first().waitFor()
  const rowCount = await page.locator('table tbody tr').count()
  check('stock table renders demo products', rowCount >= 12, `rows=${rowCount}`)
  await shot('06-stock-list')

  await page.getByLabel('Low stock only').click()
  await page.getByText('Febi Rear Brake Pads').first().waitFor()
  const lowText = await page.locator('table tbody').innerText()
  check('low-stock filter shows seeded low product', lowText.includes('Febi Rear Brake Pads'))
  check('low product is badged Low', lowText.includes('Low'))
  await shot('06-low-stock')

  await page.getByRole('link', { name: 'View' }).first().click()
  await page.waitForURL('**/inventory/stock/**')
  await page.getByRole('heading', { name: 'Movement history' }).waitFor()
  await page.getByText('Receipt').first().waitFor()
  const history = await page.locator('table tbody').innerText()
  check('movement history shows a GRN reference', /GRN-\d{5}/.test(history))
  await shot('06-stock-detail')

  await page.goBack()
  await page.waitForURL('**/inventory/stock')

  // Leave the low filter off whatever the history restore did, then narrow to one product.
  const lowSwitch = page.getByLabel('Low stock only')
  if ((await lowSwitch.getAttribute('aria-checked')) === 'true') await lowSwitch.click()
  await page.getByLabel('Search stock').fill('Bosch Oil Filter')
  const boschRow = page.locator('table tbody tr').filter({ hasText: 'Bosch Oil Filter' })
  await boschRow.waitFor()
  const onHand = async () => Number.parseInt(await boschRow.locator('td').nth(3).innerText(), 10)
  const waitForOnHand = async (expected) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((await onHand()) === expected) return true
      await page.waitForTimeout(250)
    }
    return false
  }
  const before = await onHand()

  // -- receive: submit a real receipt (GRN toast, on-hand up by 2) --
  await page.getByRole('button', { name: 'Receive stock' }).click()
  const receiveDialog = page.getByRole('dialog')
  await receiveDialog.getByText('Receive stock').first().waitFor()
  check('receive dialog opens', (await page.getByRole('dialog').count()) === 1)

  await pickProduct(receiveDialog, 'Bosch Oil Filter')
  await receiveDialog.getByLabel('Quantity for line 1').fill('2')
  await receiveDialog.getByLabel('Unit cost for line 1').fill('46.00')
  await shot('06-receive-dialog')
  await receiveDialog.getByRole('button', { name: 'Receive stock' }).click()

  await page
    .getByText(/Received stock as GRN-\d{5}/)
    .first()
    .waitFor()
  const grnText = await page
    .getByText(/Received stock as GRN-\d{5}/)
    .first()
    .innerText()
  const grn = grnText.match(/GRN-\d{5}/)?.[0] ?? ''
  check('receive posts with a GRN toast', /^GRN-\d{5}$/.test(grn), grnText)
  await shot('06-receive-submitted')
  check('receive increases on-hand by 2', await waitForOnHand(before + 2), `before=${before}`)

  // -- adjust: submit a damage adjustment (toast, on-hand down by 1) --
  await page.getByRole('button', { name: 'Adjust' }).click()
  const adjustDialog = page.getByRole('dialog')
  await adjustDialog.getByText('Adjust stock').waitFor()
  check('adjust dialog opens', (await page.getByRole('dialog').count()) === 1)

  await pickProduct(adjustDialog, 'Bosch Oil Filter')
  await adjustDialog.locator('#adjust-quantity').fill('1')
  await adjustDialog.locator('#adjust-reason').click()
  await page.getByRole('option', { name: 'Damage' }).click()
  await shot('06-adjust-dialog')
  await adjustDialog.getByRole('button', { name: 'Post adjustment' }).click()

  await page.getByText('Stock adjusted', { exact: true }).first().waitFor()
  check('adjustment posts with a toast', true)
  await shot('06-adjust-submitted')
  check('adjustment decreases on-hand by 1', await waitForOnHand(before + 1), `before=${before}`)

  // -- detail: the new movements are in history; set threshold at on-hand → Low --
  await boschRow.getByRole('link', { name: 'View' }).click()
  await page.waitForURL('**/inventory/stock/**')
  await page.getByRole('heading', { name: 'Movement history' }).waitFor()
  const boschHistory = await page.locator('table tbody').innerText()
  check('Bosch history shows the new receipt', boschHistory.includes(grn), grn)
  check('Bosch history shows the adjustment', boschHistory.includes('Adjustment'))

  const thresholdValue = before + 1
  await page.getByRole('button', { name: /(Set|Edit) threshold/ }).click()
  await page.getByRole('dialog').getByText('Low-stock threshold').waitFor()
  await robustFill(page, '#threshold-value', String(thresholdValue))
  await page.getByRole('dialog').getByRole('button', { name: 'Save threshold' }).click()
  await page.getByText('Low-stock threshold saved').first().waitFor()
  check('threshold saved from the console', true)
  await page.getByText('Low', { exact: true }).first().waitFor()
  await shot('06-threshold-saved')

  // -- low-stock filter reflects the saved threshold --
  await page.getByRole('link', { name: 'Back to stock' }).click()
  await page.waitForURL('**/inventory/stock')
  await page.getByLabel('Low stock only').click()
  const lowRow = page.locator('table tbody tr').filter({ hasText: 'Bosch Oil Filter' })
  await lowRow.waitFor()
  const thresholdCell = Number.parseInt(await lowRow.locator('td').nth(6).innerText(), 10)
  check(
    'low-stock filter shows the thresholded product',
    (await lowRow.locator('td').nth(7).innerText()).includes('Low'),
  )
  check(
    'threshold column shows the saved value',
    thresholdCell === thresholdValue,
    `cell=${thresholdCell}`,
  )
  await shot('06-low-stock-updated')
} catch (error) {
  failed += 1
  console.log(`  FAIL  unexpected error — ${error.message}`)
  await shot('06-failure')
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
