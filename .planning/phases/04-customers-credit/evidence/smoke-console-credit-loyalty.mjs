import { createHmac } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

// Phase 4 console walkthrough: exercises the real UI against the freshly
// verified database and keeps the screenshots as phase evidence. Run after
// evidence/walkthrough-phase4.mjs (which restores the demo passwords).

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

async function chooseOption(page, label, optionName) {
  await clickUntil(
    page,
    () => page.getByLabel(label, { exact: true }),
    () => page.getByRole('option', { name: optionName }),
    `the ${label} select`,
  )
  await page.getByRole('option', { name: optionName }).click()
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

const stamp = String(Date.now()).slice(-4)
const customerName = `Console Walkthrough ${stamp}`
const phone = `024 559 ${stamp}`

// Manager API session for fixture setup (the customer itself is created in the UI).
const login = await fetch(`${API}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: 'manager@gikautos.local', password: 'demo-password-1234' }),
})
if (!login.ok) throw new Error(`fixture login failed: ${login.status}`)
const cookies = login.headers
  .getSetCookie()
  .map((row) => row.split(';')[0])
  .join('; ')
const send = (path, init = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookies },
  })

const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(20_000)

const dialog = () => page.getByRole('dialog')
async function shot(name) {
  await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true })
}

console.log(`Phase 4 console walkthrough — ${customerName}\n`)

try {
  // -- sign in as the branch manager --
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await robustFill(page, '#email', 'manager@gikautos.local')
  await robustFill(page, '#password', 'demo-password-1234')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), { timeout: 25_000 })
  check('manager signs in', true)

  // -- create the customer through the dialog --
  await page.goto(`${BASE}/customers`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  await clickUntil(
    page,
    () => page.getByRole('button', { name: 'New customer' }),
    () => dialog(),
    'the New customer button',
  )
  await dialog().getByText('New customer').first().waitFor()
  await robustFill(page, '#customer-name', customerName)
  await robustFill(page, '#customer-phone', phone)
  await shot('01-customer-create-dialog')
  await dialog().getByRole('button', { name: 'Create customer' }).click()
  await page.getByText(`Customer ${customerName} created`).first().waitFor({ timeout: 20_000 })
  await page.getByRole('link', { name: customerName }).waitFor()
  check('customer created through the console', true)
  await shot('02-customer-created')

  // -- phone-suffix search finds them --
  const search = page.getByLabel('Search customers by phone or name')
  await search.fill(stamp)
  await page.getByRole('link', { name: customerName }).waitFor()
  check(
    'phone-suffix search finds the customer',
    (await page.getByRole('link', { name: customerName }).count()) === 1,
  )
  await shot('03-search-phone-suffix')

  // -- fixture the credit ledger + one loyalty earn through the API --
  const found = await (await send(`/api/customers?q=${stamp}`)).json()
  const customerId = found.customers.find((row) => row.name === customerName)?.id
  await send(`/api/credit/profiles/${customerId}`, {
    method: 'PUT',
    body: JSON.stringify({ limitMinor: 50_000, paymentTermDays: 14 }),
  })
  await send('/api/credit/entries', {
    method: 'POST',
    body: JSON.stringify({ customerId, kind: 'CHARGE', amountMinor: 12_000, reasonCode: 'SALE' }),
  })
  await send('/api/loyalty/entries', {
    method: 'POST',
    body: JSON.stringify({ customerId, kind: 'EARN', netPaidMinor: 20_000 }),
  })

  // -- credit panel + settings dialog --
  await page.goto(`${BASE}/customers/${customerId}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('heading', { name: customerName }).waitFor()
  await clickUntil(
    page,
    () => page.getByRole('tab', { name: 'Credit' }),
    () => page.getByText('owed by the customer'),
    'the Credit tab',
  )
  check(
    'credit panel shows the seeded balance',
    await page.getByText('GHS 120.00').first().isVisible(),
  )
  await shot('04-credit-panel')
  await clickUntil(
    page,
    () => page.getByRole('button', { name: 'Credit settings' }),
    () => dialog(),
    'the Credit settings button',
  )
  check('credit limit is prefilled', (await page.inputValue('#credit-limit')) === '500.00')
  check('payment terms are prefilled', (await page.inputValue('#credit-term-days')) === '14')
  await shot('05-credit-settings-dialog')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // -- repayment toast carries the REP receipt --
  await clickUntil(
    page,
    () => page.getByRole('button', { name: 'Record repayment' }),
    () => dialog(),
    'the Record repayment button',
  )
  await robustFill(page, '#repayment-amount', '50')
  await dialog().getByRole('button', { name: 'Record repayment' }).click()
  await page.getByText(/Repayment recorded — receipt REP-\d+/).waitFor()
  await page.getByText('GHS 70.00').first().waitFor()
  check('repayment toast carries the REP number and drops the balance', true)
  await shot('06-repayment-toast')

  // -- over-limit charge: 409, override revealed, posted with a reason --
  await clickUntil(
    page,
    () => page.getByRole('button', { name: 'New entry' }),
    () => page.getByText('New credit entry'),
    'the New entry button',
  )
  await robustFill(page, '#entry-amount', '460')
  await dialog().getByLabel('Reason', { exact: true }).click()
  await page.getByRole('option', { name: 'Other', exact: true }).click()
  await dialog().getByRole('button', { name: 'Post entry' }).click()
  await page.getByText(/exceeds the credit limit/).waitFor()
  check('over-limit 409 is surfaced', true)
  check('override section is revealed', await page.getByText('Over the credit limit').isVisible())
  await shot('07-over-limit-409')
  await dialog().getByLabel('Override reason').click()
  await page.getByRole('option', { name: 'Urgent need' }).click()
  await robustFill(page, '#override-note', 'Walkthrough stock delivery')
  await dialog().getByRole('button', { name: 'Post entry' }).click()
  await page.getByText(/Charge recorded/).waitFor()
  await page.getByText('GHS 530.00').first().waitFor()
  check('override posts the charge — balance GHS 530.00', true)
  await shot('08-override-posted')

  // -- statement + print view --
  await clickUntil(
    page,
    () => page.getByRole('link', { name: 'Statement' }),
    () => page.getByText('Customer credit statement'),
    'the Statement link',
  )
  check(
    'statement shows the customer and branch',
    await page.getByText(customerName).first().isVisible(),
  )
  check('closing balance is GHS 530.00', await page.getByText('GHS 530.00').first().isVisible())
  check(
    'three ledger entries print',
    (await page.locator('table').first().locator('tbody tr').count()) === 3,
  )
  check(
    'repayment reference prints',
    /REP-\d{5}/.test(await page.locator('table').first().innerText()),
  )
  check(
    'aging summary lists both outstanding charges',
    (await page.getByText('Current (not yet due)').count()) === 2,
  )
  await shot('09-statement')
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(400)
  check(
    'sidebar is hidden in print',
    !(await page.getByRole('link', { name: 'Dashboard' }).isVisible()),
  )
  check(
    'statement itself still prints',
    await page.getByText('Customer credit statement').isVisible(),
  )
  await shot('10-statement-print')
  await page.emulateMedia({ media: 'screen' })

  // -- aging buckets --
  await page.goto(`${BASE}/customers/aging`)
  await page.waitForLoadState('networkidle')
  const agingRow = page.locator('tbody tr', { hasText: customerName })
  await agingRow.waitFor()
  check(
    'aging lists the customer in the Current bucket',
    (await agingRow.locator('td').nth(1).innerText()).includes('GHS 530.00'),
  )
  check(
    'aging total agrees',
    (await agingRow.locator('td').nth(6).innerText()).includes('GHS 530.00'),
  )
  await shot('11-aging-buckets')

  // -- loyalty adjustment + history --
  await page.goto(`${BASE}/customers/${customerId}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('heading', { name: customerName }).waitFor()
  await clickUntil(
    page,
    () => page.getByRole('tab', { name: 'Loyalty' }),
    () => page.getByText('200 points', { exact: true }),
    'the Loyalty tab',
  )
  await page.getByRole('button', { name: 'Adjust points' }).click()
  await page.getByText('Adjust loyalty points').waitFor()
  await chooseOption(page, 'Kind', 'Adjust')
  await robustFill(page, '#loyalty-points', '25')
  await chooseOption(page, 'Reason', 'Goodwill')
  await robustFill(page, '#loyalty-note', 'Walkthrough goodwill')
  await shot('12-loyalty-adjust-dialog')
  await page.getByRole('button', { name: 'Post entry' }).click()
  await page.getByText('Adjustment recorded — +25 points').waitFor()
  await page.getByText('225 points', { exact: true }).waitFor()
  check('adjustment posts and raises the balance to 225', true)
  const historyRows = page.locator('table').nth(1).locator('tbody tr')
  check(
    'history lists both entries',
    (await historyRows.count()) === 2,
    `rows=${await historyRows.count()}`,
  )
  const historyText = (await historyRows.allInnerTexts()).join('\n')
  check(
    'history shows the earn and the goodwill adjustment',
    historyText.includes('+200') && historyText.includes('+25') && historyText.includes('Goodwill'),
  )
  await shot('13-loyalty-history')

  // -- liability report as admin --
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const adminPage = await adminContext.newPage()
  adminPage.setDefaultTimeout(20_000)
  await adminPage.goto(`${BASE}/login`)
  await adminPage.waitForLoadState('networkidle')
  await robustFill(adminPage, '#email', envValue('ADMIN_EMAIL'))
  await robustFill(adminPage, '#password', envValue('ADMIN_PASSWORD'))
  await adminPage.getByRole('button', { name: 'Sign in' }).click()
  await adminPage.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), {
    timeout: 25_000,
  })
  if (new URL(adminPage.url()).pathname.startsWith('/two-factor')) {
    const { secret } = JSON.parse(readFileSync(TOTP_FILE, 'utf8'))
    await robustFill(adminPage, '#code', totpCode(secret))
    await adminPage.getByRole('button', { name: 'Verify' }).click()
    await adminPage.waitForURL((url) => new URL(url).pathname === '/', { timeout: 25_000 })
  }
  check('admin signs in with TOTP', true)

  await adminPage.goto(`${BASE}/loyalty`)
  await adminPage.waitForLoadState('networkidle')
  await adminPage.getByText('Outstanding points', { exact: true }).waitFor()
  await adminPage.getByText('Branch activity', { exact: true }).waitFor()
  check('liability page renders the headline and activity', true)
  await adminPage.getByText('Liability', { exact: true }).waitFor()
  const outstandingText = await adminPage
    .getByText('Outstanding points', { exact: true })
    .locator('..')
    .innerText()
  const points = Number.parseInt(
    outstandingText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /^[\d,]+$/.test(line))
      ?.replace(/,/g, '') ?? '',
    10,
  )
  const liabilityText = await adminPage
    .getByText('Liability', { exact: true })
    .locator('..')
    .innerText()
  const ghsShown = (liabilityText.match(/GHS [\d,]+\.\d{2}/) ?? [])[0] ?? ''
  const ghsMinor = Math.round(Number.parseFloat(ghsShown.replace(/[^\d.]/g, '')) * 100)
  check(
    'liability headline reconciles points to the 100-point rate',
    Number.isFinite(points) && ghsMinor === points,
    `${points} points vs ${ghsShown}`,
  )
  check(
    'negative balances section renders',
    await adminPage.getByText('Negative balances', { exact: true }).isVisible(),
  )
  await adminPage.screenshot({ path: `${SHOTS}14-liability-report.png`, fullPage: true })

  // -- settings: Loyalty and Credit groups --
  await adminPage.goto(`${BASE}/settings`)
  await adminPage.waitForLoadState('networkidle')
  await adminPage.getByText('Points earned per GHS 1', { exact: true }).waitFor()
  check('loyalty settings group renders', true)
  check(
    'credit settings group renders',
    await adminPage.getByText('Repayment receipt prefix', { exact: true }).isVisible(),
  )
  check(
    'next repayment number is shown',
    await adminPage.getByText('Next repayment number', { exact: true }).isVisible(),
  )
  await adminPage.screenshot({ path: `${SHOTS}15-settings-loyalty-credit.png`, fullPage: true })

  await adminContext.close()
} catch (error) {
  failed += 1
  console.log(`  FAIL  unexpected error — ${error.message}`)
  await shot('99-failure')
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
