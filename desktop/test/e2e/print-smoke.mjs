#!/usr/bin/env node
/**
 * Plan 07 verification — receipt + drawer through the packaged app (Task 5).
 *
 * Launches the packaged POS with the fake ESC/POS adapter, prints the sample
 * receipt through the real renderer → preload → main IPC path, and asserts the
 * files the adapter wrote:
 *
 * - the text receipt is 42 columns and contains every money field;
 * - the binary starts with `ESC @`, carries the drawer kick, and ends with cut;
 * - the drawer log has exactly the cash kicks;
 * - a simulated failure leaves the UI in a retryable state and the retry works;
 * - a reprint is marked.
 *
 * The enrolled-device sale → print walkthrough still needs the API + PowerSync
 * and remains the Plan 09 gate; this script proves the hardware-facing half.
 *
 * Usage: bun run build:pos && node test/e2e/print-smoke.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const desktopDir = path.resolve(import.meta.dirname, '..', '..')
const repo = path.resolve(desktopDir, '..')
const binary = path.join(desktopDir, 'out', 'GikAutos POS-linux-x64', 'GikAutos POS')
const receiptsDir = path.join(
  repo,
  '.planning',
  'phases',
  '06-pos-offline-core',
  'evidence',
  'receipts',
)
const shotsDir = path.join(repo, '.planning', 'phases', '06-pos-offline-core', 'evidence', 'shots')
const receiptNumber = 'DEV-20261023-0001'

let checks = 0
let failures = 0
function check(label, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close()
      if (typeof address === 'string' || address === null) reject(new Error('no port'))
      else resolve(address.port)
    })
  })
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`CDP did not become ready on ${port}`)
}

function textReceipt() {
  return fs.readFileSync(path.join(receiptsDir, `${receiptNumber}.txt`), 'utf8')
}

if (!fs.existsSync(binary)) {
  console.error(`Missing packaged binary: ${binary}\nRun \`bun run build:pos\` first.`)
  process.exit(2)
}

fs.rmSync(receiptsDir, { recursive: true, force: true })
fs.mkdirSync(receiptsDir, { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const port = await freePort()
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gikautos-print-smoke-'))
const child = spawn(
  binary,
  [
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
  ],
  {
    stdio: 'ignore',
    env: {
      ...process.env,
      POS_PRINTER_DRIVER: 'fake',
      POS_DIAGNOSTICS: '1',
      RECEIPTS_DIR: receiptsDir,
    },
  },
)

let browser
const cspViolations = []
const pageErrors = []

try {
  await waitForCdp(port, 40_000)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 })
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 20_000 }))

  page.on('console', (message) => {
    const text = message.text()
    if (/content security policy/i.test(text)) cspViolations.push(text)
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1_500)

  await page.evaluate(() => {
    window.location.hash = '#dev/print'
  })
  await page.waitForTimeout(1_500)

  check(
    'the printer diagnostics route renders',
    await page.locator('[data-testid="dev-print"]').isVisible(),
  )
  check(
    'the 42-column preview is on screen',
    (await page.locator('[data-testid="dev-print-preview"]').innerText()).includes(receiptNumber),
  )

  await page.locator('[data-testid="dev-print"]').click()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="dev-print-status"]')?.getAttribute('data-ok') ===
      'true',
    undefined,
    { timeout: 15_000 },
  )
  await page.waitForTimeout(500)

  const text = textReceipt()
  const lines = text.trimEnd().split('\n')
  check(
    'the text receipt is 42 columns or narrower',
    lines.every((line) => line.length <= 42),
    `widest=${Math.max(...lines.map((line) => line.length))}`,
  )
  check('the receipt number is printed', text.includes(receiptNumber))
  check('the total is printed as GHS (not a float)', text.includes('GHS 145.00'))
  check('VAT is printed', text.includes('VAT 15%'))
  check('NHIL is printed', text.includes('NHIL 2.5%'))
  check('GETFund is printed', text.includes('GETFund 2.5%'))
  check('cash and change are printed', text.includes('Change') && text.includes('GHS 55.00'))
  check('the long product name wrapped inside 42 columns', text.includes('Brake Pad Set'))
  check('the footer is printed', text.includes('Thank you for choosing GikAutos'))

  const binaryBytes = fs.readFileSync(path.join(receiptsDir, `${receiptNumber}.escpos.bin`))
  check('the ESC/POS stream starts with ESC @', binaryBytes[0] === 0x1b && binaryBytes[1] === 0x40)
  check(
    'the ESC/POS stream carries the drawer kick (ESC p 0 50 250)',
    binaryBytes.includes(Buffer.from([0x1b, 0x70, 0x00, 0x32, 0xfa])),
  )
  check(
    'the ESC/POS stream ends with a full cut',
    binaryBytes.subarray(-3).equals(Buffer.from([0x1d, 0x56, 0x00])),
  )

  const drawerLog = fs.readFileSync(path.join(receiptsDir, 'drawer.log'), 'utf8')
  check('the drawer log records the cash kick', drawerLog.includes(`${receiptNumber} pin=2`))

  // Simulated failure: the fake adapter fails once, the UI reports it, retry works.
  fs.writeFileSync(path.join(receiptsDir, '.fail-next'), '')
  await page.locator('[data-testid="dev-print"]').click()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="dev-print-status"]')?.getAttribute('data-ok') ===
      'false',
    undefined,
    { timeout: 15_000 },
  )
  const failureText = await page.locator('[data-testid="dev-print-status"]').innerText()
  check(
    'a printer failure is reported as a retryable state',
    /PRINTER_FAILED/.test(failureText),
    failureText,
  )
  check(
    'the failed attempt wrote no drawer kick',
    fs.readFileSync(path.join(receiptsDir, 'drawer.log'), 'utf8').trim().split('\n').length === 1,
  )

  await page.locator('[data-testid="dev-print"]').click()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="dev-print-status"]')?.getAttribute('data-ok') ===
      'true',
    undefined,
    { timeout: 15_000 },
  )
  check(
    'retrying after the failure succeeds',
    fs.readFileSync(path.join(receiptsDir, 'drawer.log'), 'utf8').trim().split('\n').length === 2,
  )

  // Reprint marker.
  await page.locator('[data-testid="dev-print-reprint-toggle"]').check()
  await page.locator('[data-testid="dev-print"]').click()
  await page.waitForTimeout(1_000)
  check('a reprint is marked on the receipt', textReceipt().includes('*** REPRINT ***'))

  check('no CSP violations occurred', cspViolations.length === 0, cspViolations[0] ?? '')
  check('no renderer errors occurred', pageErrors.length === 0, pageErrors[0] ?? '')

  await page.screenshot({
    path: path.join(shotsDir, 'plan07-print-diagnostics.png'),
    fullPage: true,
  })
} catch (error) {
  failures += 1
  console.error(`  FAIL  run crashed — ${error instanceof Error ? error.message : String(error)}`)
} finally {
  if (browser) await browser.close().catch(() => {})
  child.kill('SIGTERM')
  fs.rmSync(userDataDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
