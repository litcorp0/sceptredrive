import { createHmac } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

// Phase 5 console walkthrough: exercises the real UI against the freshly seeded
// database that evidence/walkthrough-payables.mjs just verified (which resets
// the demo passwords). Screenshots land next to this file.

const BASE = 'http://localhost:3000'
const API = 'http://localhost:4000'
const SHOTS = process.env.SHOTS_DIR ?? new URL('./', import.meta.url).pathname
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

async function robustFill(page, selector, value) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.fill(selector, value)
    if ((await page.inputValue(selector)) === value) return
    await page.waitForTimeout(250)
  }
  throw new Error(`could not fill ${selector}`)
}

async function clickUntil(_page, target, expectation, label) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await target().click()
    try {
      await expectation().first().waitFor({ state: 'visible', timeout: 1500 })
      return
    } catch {
      // hydration swallowed the click — retry
    }
  }
  throw new Error(`clicking ${label} did not reveal the expected content`)
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
const totpSecret = JSON.parse(readFileSync(TOTP_FILE, 'utf8')).secret

const stamp = String(Date.now()).slice(-5)
const supplierName = `Console Supplier ${stamp}`
const supplierPhone = `024 555 ${stamp.slice(-4)}`
const invalidPhone = '000000'
const receiptInvoiceNumber = `WD-UI-${stamp}`

function isoDay(offset = 0) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

const browser = await chromium.launch({ channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(20_000)
const dialog = () => page.getByRole('dialog')

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true })
}

async function adminSignIn(targetPage) {
  await targetPage.goto(`${BASE}/login`)
  await targetPage.waitForLoadState('networkidle')
  await robustFill(targetPage, '#email', envValue('ADMIN_EMAIL'))
  await robustFill(targetPage, '#password', envValue('ADMIN_PASSWORD'))
  await targetPage.getByRole('button', { name: 'Sign in' }).click()
  await targetPage.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), {
    timeout: 25_000,
  })
  if (new URL(targetPage.url()).pathname.startsWith('/two-factor')) {
    await robustFill(targetPage, '#code', totpCode(totpSecret))
    await targetPage.getByRole('button', { name: 'Verify' }).click()
    await targetPage.waitForURL((url) => new URL(url).pathname === '/', { timeout: 25_000 })
  }
}

/** Cookie-authenticated API helper for fixture reads (same admin session). */
let apiCookie = ''
async function apiSignIn() {
  const jar = new Map()
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: envValue('ADMIN_EMAIL'),
      password: envValue('ADMIN_PASSWORD'),
    }),
  })
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(';')[0]
    const index = pair.indexOf('=')
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
  }
  const verify = await fetch(`${API}/api/auth/two-factor/verify-totp`, {
    method: 'POST',
    headers: {
      origin: BASE,
      'content-type': 'application/json',
      cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: JSON.stringify({ code: totpCode(totpSecret) }),
  })
  for (const raw of verify.headers.getSetCookie()) {
    const pair = raw.split(';')[0]
    const index = pair.indexOf('=')
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
  }
  apiCookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}
const apiGet = async (path) =>
  (await fetch(`${API}${path}`, { headers: { origin: BASE, cookie: apiCookie } })).json()
const apiPost = async (path, body) =>
  (
    await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { origin: BASE, cookie: apiCookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json()

console.log(`Phase 5 console walkthrough — ${supplierName}\n`)

try {
  // ------------------------------------------------------------ admin sign-in
  await adminSignIn(page)
  await apiSignIn()
  const branchResponse = await apiGet('/api/branches')
  const spxBranch = branchResponse.branches?.find((branch) => branch.code === 'ACC-SPX')
  await page.evaluate((id) => {
    window.localStorage.setItem('gikautos.admin.branchId', id)
  }, spxBranch.id)
  await page.reload()
  await page.waitForLoadState('networkidle')
  check('admin signs in with password + TOTP', true)
  await shot('01-admin-dashboard')

  // ------------------------------------------------------ supplier create/edit
  await page.goto(`${BASE}/suppliers`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await clickUntil(
    page,
    () => page.getByRole('button', { name: 'New supplier' }),
    () => dialog(),
    'the New supplier button',
  )
  await robustFill(page, '#supplier-name', supplierName)
  await robustFill(page, '#supplier-contact', 'Kofi Console')
  await robustFill(page, '#supplier-phone', invalidPhone)
  await dialog().getByRole('button', { name: 'Create supplier' }).click()
  await dialog().getByText(/valid Ghana phone/i).waitFor({ timeout: 15_000 })
  check('invalid phone renders the server message inline', true)
  await robustFill(page, '#supplier-phone', supplierPhone)
  await robustFill(page, '#supplier-email', `console-${stamp}@example.com`)
  await robustFill(page, '#supplier-terms', '7')
  await shot('02-supplier-create-invalid-phone')
  await dialog().getByRole('button', { name: 'Create supplier' }).click()
  await page.getByText(`Supplier ${supplierName} created`).first().waitFor({ timeout: 20_000 })
  check('supplier created through the console', true)

  const search = page.getByLabel('Search suppliers by name or code')
  await robustFill(page, 'input[aria-label="Search suppliers by name or code"]', supplierName)
  await page.getByRole('link', { name: supplierName }).waitFor({ timeout: 15_000 })
  check('search finds the new supplier', true)
  await page.getByRole('link', { name: supplierName }).click()
  await page.waitForURL(/\/suppliers\/[0-9a-f-]{36}$/, { timeout: 20_000 })
  const supplierId = page.url().split('/').at(-1)
  await page.getByText('Payment details').first().waitFor()
  await shot('03-supplier-detail')

  // Bank detail
  await clickUntil(
    page,
    () => page.getByRole('button', { name: 'Add detail' }),
    () => dialog(),
    'Add detail',
  )
  await robustFill(page, '#payment-detail-label', 'Console bank')
  await robustFill(page, '#payment-detail-account-name', `${supplierName} Ltd`)
  await robustFill(page, '#payment-detail-account-number', '7770001234')
  await robustFill(page, '#payment-detail-bank', 'GCB Bank')
  await robustFill(page, '#payment-detail-bank-code', 'GCB')
  await dialog().getByRole('button', { name: 'Add detail' }).click()
  await page.getByText('Payment detail added').first().waitFor({ timeout: 15_000 })
  check('bank payment detail added', true)

  // MoMo detail (method switch inside the dialog)
  await clickUntil(
    page,
    () => page.getByRole('button', { name: 'Add detail' }),
    () => dialog(),
    'Add detail (MoMo)',
  )
  await clickUntil(
    page,
    () => dialog().getByLabel('Method', { exact: true }),
    () => page.getByRole('option', { name: 'Mobile money' }),
    'the method select',
  )
  await page.getByRole('option', { name: 'Mobile money' }).click()
  await robustFill(page, '#payment-detail-label', 'Console MoMo')
  await robustFill(page, '#payment-detail-phone', supplierPhone.replace(/\s/g, ''))
  await dialog().getByRole('button', { name: 'Add detail' }).click()
  await page.getByText('Payment detail added').first().waitFor({ timeout: 15_000 })
  check('MoMo payment detail added', true)

  // Switch the default to MoMo and assert the badge moves.
  const momoRow = page.getByRole('row').filter({ hasText: 'Console MoMo' })
  await momoRow.getByRole('button', { name: 'Make default' }).click()
  await page.getByText('Payment detail updated').first().waitFor({ timeout: 15_000 })
  await momoRow.getByText('Default', { exact: true }).waitFor({ timeout: 15_000 })
  const bankRow = page.getByRole('row').filter({ hasText: 'Console bank' })
  check(
    'default badge moves to the MoMo detail',
    (await momoRow.getByText('Default', { exact: true }).count()) === 1 &&
      (await bankRow.getByText('Default', { exact: true }).count()) === 0,
  )
  await shot('04-supplier-payment-details')

  // Product mapping with last cost.
  await clickUntil(
    page,
    () => page.getByRole('button', { name: 'Add product' }),
    () => dialog(),
    'Add product',
  )
  await robustFill(page, 'input[aria-label="Search products"]', 'GIK-00001')
  await page
    .getByRole('button', { name: /GIK-00001/ })
    .first()
    .waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: /GIK-00001/ }).first().click()
  await robustFill(page, '#supplier-product-sku', `UI-${stamp}`)
  await robustFill(page, '#supplier-product-lead', '9')
  await dialog().getByRole('button', { name: 'Add product' }).click()
  await page.getByText('Supplied product added').first().waitFor({ timeout: 15_000 })
  await page.waitForTimeout(500)
  const productRow = page.getByRole('row').filter({ hasText: 'GIK-00001' })
  check(
    'mapping renders the catalog product and last cost',
    (await productRow.count()) === 1 && (await productRow.getByText(/GHS/).count()) >= 1,
  )
  await shot('05-supplier-products')

  // -------------------------------------------- receipt → invoice (console)
  await page.goto(`${BASE}/inventory/receipts`)
  await page.waitForLoadState('networkidle')
  await clickUntil(
    page,
    () => page.getByRole('button', { name: 'Receive stock' }),
    () => dialog(),
    'Receive stock',
  )
  await robustFill(page, 'input[aria-label="Search suppliers"]', supplierName)
  await dialog()
    .getByRole('button', { name: new RegExp(supplierName) })
    .first()
    .waitFor({ timeout: 15_000 })
  await dialog().getByRole('button', { name: new RegExp(supplierName) }).first().click()
  await robustFill(page, 'input[aria-label="Search products"]', 'GIK-00001')
  await page.getByRole('button', { name: /GIK-00001/ }).first().click()
  await robustFill(page, 'input[aria-label="Quantity for line 1"]', '2')
  await robustFill(page, 'input[aria-label="Unit cost for line 1"]', '50.00')
  await robustFill(page, '#receipt-invoice', receiptInvoiceNumber)
  await shot('06-receive-stock')
  await dialog().getByRole('button', { name: 'Receive stock' }).click()
  await page.getByText(/Received stock as GRN-/).first().waitFor({ timeout: 20_000 })
  check('receipt recorded through the console', true)

  const receipts = await apiGet(`/api/inventory/receipts?limit=10`)
  const receipt = receipts.receipts?.find(
    (row) => row.supplierName === supplierName && row.supplierInvoiceNumber === receiptInvoiceNumber,
  )
  check('receipt carries the linked supplier', Boolean(receipt?.supplierId))
  await page.goto(`${BASE}/inventory/receipts/${receipt.id}`)
  await page.waitForLoadState('networkidle')
  await page.getByText(receipt.number).first().waitFor()
  await shot('07-receipt-detail')

  await page.getByRole('link', { name: 'Record supplier invoice' }).click()
  await page.waitForURL(/\/suppliers\/invoices\/new\?receiptId=/, { timeout: 20_000 })
  await page.getByText(`From receipt ${receipt.number}`).waitFor()
  await robustFill(page, '#invoice-supplier-number', `UI-INV-${stamp}`)
  await robustFill(page, '#invoice-date', isoDay(-10))
  await robustFill(page, '#invoice-due', isoDay(-1))
  check(
    'receipt total prefilled into the invoice form',
    (await page.getByText('GHS 100.00').count()) >= 1,
  )
  const vatRowText = await page.getByText('VAT 15%', { exact: true }).locator('..').innerText()
  check('derived tax split is non-zero', !vatRowText.includes('GHS 0.00'), vatRowText)
  await shot('08-invoice-form-from-receipt')
  await page.getByRole('button', { name: 'Record invoice' }).click()
  await page.waitForURL(/\/suppliers\/invoices\/[0-9a-f-]{36}$/, { timeout: 20_000 })
  const invoiceId = page.url().split('/').at(-1)
  await page.getByText('Goods receipt').first().waitFor()
  await page.getByText('No payments allocated yet.').waitFor()
  check('invoice detail links the receipt and starts unallocated', true)
  await shot('09-invoice-detail')

  // ------------------------------------------- partial payment with remainder
  await page.getByRole('button', { name: 'Record payment' }).click()
  await dialog().getByText('Record supplier payment').waitFor()
  await robustFill(page, '#payment-amount', '60.00')
  const invoiceNumber = (await page.locator('h2.font-mono').first().innerText()).trim()
  await robustFill(page, `input[aria-label="Allocate to ${invoiceNumber}"]`, '40.00')
  await dialog().getByText('GHS 20.00').first().waitFor()
  check('allocation editor shows the on-account remainder', true)
  await shot('10-payment-dialog')
  await dialog().getByRole('button', { name: 'Record payment' }).click()
  await page.getByText(/Payment PAY-/).first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(800)
  check(
    'invoice flips to PARTIAL with allocations history',
    (await page.getByText('Partial').count()) >= 1 &&
      (await page.getByText('Apply').count()) >= 1,
  )
  await shot('11-invoice-partial')

  // --------------------------------------------------------- void the payment
  const payments = await apiGet(`/api/payables/payments?supplierId=${supplierId}&pageSize=5`)
  const payment = payments.payments?.[0]
  check('payment appears in the list', Boolean(payment?.id))
  await page.goto(`${BASE}/suppliers/payments/${payment.id}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Void payment' }).click()
  await dialog().getByText('Releases to write').waitFor()
  await shot('12-void-payment-dialog')
  await dialog().getByRole('button', { name: 'Void payment' }).click()
  await page.getByText(/Payment PAY-.* voided/).first().waitFor({ timeout: 20_000 })
  await page.getByText(/Voided/).first().waitFor()
  check('payment voided from its detail screen', true)

  await page.goto(`${BASE}/suppliers/invoices/${invoiceId}`)
  await page.waitForLoadState('networkidle')
  await page.getByText('Open').first().waitFor()
  check(
    'invoice returns to OPEN after the release',
    (await page.getByText('Release').count()) >= 1,
  )
  await shot('13-invoice-after-void')

  // ---------------------------------------------------------- aging as-of past
  await page.goto(`${BASE}/suppliers/aging`)
  await page.waitForLoadState('networkidle')
  await robustFill(page, '#payables-aging-asof', isoDay())
  await page.waitForTimeout(800)
  const agingRow = page.getByRole('row').filter({ hasText: supplierName })
  check(
    'aging lists the supplier with an overdue bucket',
    (await agingRow.count()) === 1 && (await agingRow.getByText(/GHS/).count()) >= 1,
  )
  const overdueCard = page.getByText('Overdue').first()
  check('overdue summary card is present', (await overdueCard.count()) === 1)
  await shot('14-aging')

  // ------------------------------------------------------------ archive guard
  await page.goto(`${BASE}/suppliers/${supplierId}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Archive' }).click()
  await dialog().getByRole('button', { name: 'Archive supplier' }).click()
  await dialog().getByText(/still owed/).waitFor({ timeout: 15_000 })
  check('archive guard explains the outstanding balance', true)
  await shot('15-archive-guard')
  await dialog().getByRole('button', { name: 'Cancel' }).click()

  // Settle the invoice, then archive for real.
  const invoiceDetail = await apiGet(`/api/payables/invoices/${invoiceId}`)
  await apiPost('/api/payables/payments', {
    supplierId,
    branchId: spxBranch.id,
    method: 'CASH',
    amountMinor: invoiceDetail.invoice.outstandingMinor,
    paidAt: new Date().toISOString(),
    allocations: [
      { invoiceId, amountMinor: invoiceDetail.invoice.outstandingMinor },
    ],
  })
  await page.reload()
  await page.getByRole('button', { name: 'Archive' }).click()
  await dialog().getByRole('button', { name: 'Archive supplier' }).click()
  await page.getByText(`Supplier ${supplierName} archived`).first().waitFor({ timeout: 20_000 })
  await page.getByText('Archived').first().waitFor()
  check('supplier archives once settled', true)
  await shot('16-supplier-archived')

  // ------------------------------------------------------------- settings view
  await page.goto(`${BASE}/settings`)
  await page.waitForLoadState('networkidle')
  await page.getByText('Suppliers & Payables').first().waitFor()
  check(
    'settings show the Suppliers & Payables group',
    (await page.getByText('Supplier code prefix').count()) === 1 &&
      (await page.getByText('Purchase invoice prefix').count()) === 1 &&
      (await page.getByText('Supplier payment prefix').count()) === 1,
  )
  await shot('17-settings-group')

  // ------------------------------------------------------------ manager view
  const managerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const managerPage = await managerContext.newPage()
  managerPage.setDefaultTimeout(20_000)
  await managerPage.goto(`${BASE}/login`)
  await managerPage.waitForLoadState('networkidle')
  await robustFill(managerPage, '#email', 'manager@gikautos.local')
  await robustFill(managerPage, '#password', 'demo-password-1234')
  await managerPage.getByRole('button', { name: 'Sign in' }).click()
  await managerPage.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), {
    timeout: 25_000,
  })
  if (new URL(managerPage.url()).pathname.startsWith('/change-password')) {
    await robustFill(managerPage, '#current-password', 'demo-password-1234')
    await robustFill(managerPage, '#new-password', 'manager-console-2026')
    await managerPage.getByRole('button', { name: /Change password|Save/ }).click()
    await managerPage.waitForURL((url) => !new URL(url).pathname.startsWith('/change-password'), {
      timeout: 20_000,
    })
  }
  await managerPage.goto(`${BASE}/suppliers`)
  await managerPage.waitForLoadState('networkidle')
  await managerPage.waitForTimeout(600)
  check(
    'manager sees suppliers without the create control',
    (await managerPage.getByRole('link', { name: 'Suppliers' }).count()) >= 1 &&
      (await managerPage.getByRole('button', { name: 'New supplier' }).count()) === 0,
  )
  await managerPage.goto(`${BASE}/settings`)
  await managerPage.waitForLoadState('networkidle')
  await managerPage.getByText('Suppliers & Payables').first().waitFor()
  const prefixRow = managerPage.locator('form').filter({ hasText: 'Supplier code prefix' })
  check(
    'manager sees the group but cannot edit global values',
    (await prefixRow.count()) === 1 &&
      (await prefixRow.getByRole('button', { name: 'Save' }).isDisabled()),
  )
  await managerPage.screenshot({ path: `${SHOTS}18-manager-settings.png`, fullPage: true })
  await managerContext.close()
} catch (error) {
  failed += 1
  console.error(`\nWALKTHROUGH ERROR: ${error.stack ?? error}`)
  await page.screenshot({ path: `${SHOTS}99-error.png`, fullPage: true }).catch(() => {})
} finally {
  await browser.close()
}

console.log(`\n${passed}/${passed + failed} checks passed`)
if (failed > 0) process.exit(1)
