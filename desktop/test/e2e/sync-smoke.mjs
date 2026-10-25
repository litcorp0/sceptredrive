#!/usr/bin/env node
/**
 * End-to-end sync smoke for the POS (Phase 6, Plan 03).
 *
 * Drives the real renderer against a running API and PowerSync service:
 *
 *   1. enrol a device through the API (the code is seeded straight into Postgres)
 *   2. hand the device token to the app through the preload keychain bridge
 *   3. open `#dev/sync` and wait for the first full sync
 *   4. compare every synced table against the server's own counts
 *   5. disconnect and prove the data is still readable offline, then reconnect
 *   6. prove the local database file is encrypted (no `SQLite format 3` header)
 *
 * Requires: API on :4000 (pointed at the Docker Postgres), PowerSync on :8080,
 * and a built renderer (`bun run package:pos`).
 *
 *   DATABASE_URL=... BETTER_AUTH_SECRET=... bun run --filter desktop test:sync
 */
import { execFileSync } from 'node:child_process'
import { createHmac, randomInt } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const desktopDir = path.resolve(import.meta.dirname, '..', '..')
const apiUrl = process.env.API_BASE_URL ?? 'http://localhost:4000'
const databaseUrl = process.env.DATABASE_URL
const secret = process.env.BETTER_AUTH_SECRET
const builtMain = path.join(desktopDir, '.vite', 'build', 'main.cjs')

if (!databaseUrl || !secret) {
  console.error('DATABASE_URL and BETTER_AUTH_SECRET are required')
  process.exit(2)
}
if (!fs.existsSync(builtMain)) {
  console.error('Missing .vite build output. Run `bun run package:pos` first.')
  process.exit(2)
}

const failures = []
let checks = 0

function check(condition, label, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}${detail !== undefined ? ` — ${detail}` : ''}`)
    return true
  }
  failures.push(detail !== undefined ? `${label} (${detail})` : label)
  console.log(`  FAIL ${label}${detail !== undefined ? ` — ${detail}` : ''}`)
  return false
}

function psql(sql) {
  return execFileSync('psql', [databaseUrl, '-tAc', sql], { encoding: 'utf8' }).trim()
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function code() {
  let value = ''
  for (let index = 0; index < 8; index += 1) value += ALPHABET[randomInt(ALPHABET.length)]
  return value
}

function hashEnrollment(value) {
  return createHmac('sha256', secret).update(value.toUpperCase()).digest('hex')
}

function electronBinary() {
  const relative = fs.readFileSync(
    path.join(desktopDir, 'node_modules', 'electron', 'path.txt'),
    'utf8',
  )
  return path.join(desktopDir, 'node_modules', 'electron', 'dist', relative.trim())
}

// --- server-side fixtures ----------------------------------------------------

const terminal = psql(`
  SELECT t.id || '|' || b.id || '|' || t.code
    FROM terminal t JOIN branch b ON b.id = t.branch_id
   WHERE t.is_active AND b.type = 'RETAIL'
   ORDER BY t.code LIMIT 1
`)
if (!terminal) {
  console.error('No active retail terminal. Run `bun run db:seed -- --demo` against the Docker DB.')
  process.exit(2)
}
const [terminalId, branchId, terminalCode] = terminal.split('|')
console.log(`\nTerminal ${terminalCode} (branch ${branchId.slice(0, 8)}…)`)

const enrollmentCode = code()
psql(`
  INSERT INTO terminal_enrollment (terminal_id, code_hash, expires_at)
  VALUES ('${terminalId}', '${hashEnrollment(enrollmentCode)}', now() + interval '10 minutes')
`)

const redeemResponse = await fetch(`${apiUrl}/api/enrollments/redeem`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: enrollmentCode, fingerprint: 'sync-smoke' }),
})
if (redeemResponse.status !== 201) {
  console.error(`redeem failed: ${redeemResponse.status} ${await redeemResponse.text()}`)
  process.exit(2)
}
const enrolled = await redeemResponse.json()
console.log(`Enrolled device ${enrolled.deviceId}`)

// Expected counts straight from the server, so the assertions track the seed.
const expected = {
  product: Number(psql('SELECT count(*) FROM product WHERE is_active = true')),
  barcode: Number(psql('SELECT count(*) FROM barcode')),
  product_price: Number(psql(`SELECT count(*) FROM product_price WHERE branch_id = '${branchId}'`)),
  stock_level: Number(psql(`SELECT count(*) FROM stock_level WHERE branch_id = '${branchId}'`)),
  customer: Number(
    psql(`SELECT count(*) FROM customer WHERE status = 'ACTIVE' AND anonymized_at IS NULL`),
  ),
  credit_profile: Number(
    psql(`SELECT count(*) FROM credit_profile WHERE branch_id = '${branchId}'`),
  ),
  loyalty_account: Number(psql('SELECT count(*) FROM loyalty_account')),
  loyalty_lot: Number(psql('SELECT count(*) FROM loyalty_lot WHERE remaining_points > 0')),
}

// --- drive the app ----------------------------------------------------------

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-drive-sync-smoke-'))
const app = await electron.launch({
  executablePath: electronBinary(),
  args: ['.', '--no-sandbox', `--user-data-dir=${userDataDir}`],
  cwd: desktopDir,
  timeout: 60_000,
})

const consoleErrors = []
const page = await app.firstWindow()
page.on('pageerror', (error) => consoleErrors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  // A first install now opens sign-in (Phase 10 Plan 08); the shell is on `#diagnostics`.
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => {
    window.location.hash = '#diagnostics'
  })
  await page.getByTestId('shell-ready').waitFor({ timeout: 30_000 })

  const stored = await page.evaluate(
    async (token) => (await window.sceptreDrive.secure.set('deviceToken', token)).ok,
    enrolled.deviceToken,
  )
  check(stored === true, 'device token stored through the preload bridge')

  await page.evaluate(() => {
    window.location.hash = '#dev/sync'
  })

  await page.getByTestId('synced-tables').waitFor({ timeout: 45_000 })

  // Wait for the first full sync: online and every expected row present.
  const deadline = Date.now() + 120_000
  let counts = {}
  while (Date.now() < deadline) {
    counts = await page.evaluate(() => {
      const result = {}
      for (const node of document.querySelectorAll('[data-count]')) {
        const key = node.parentElement?.getAttribute('data-testid')?.replace('count-', '')
        if (key) result[key.replace(/-/g, '_')] = Number(node.getAttribute('data-count'))
      }
      return result
    })
    const complete = Object.entries(expected).every(([table, value]) => counts[table] >= value)
    if (complete) break
    await page.waitForTimeout(500)
  }

  for (const [table, value] of Object.entries(expected)) {
    check(
      counts[table] === value,
      `${table} syncs the server count`,
      `app=${counts[table]} server=${value}`,
    )
  }

  await page
    .getByTestId('sync-has-synced')
    .filter({ hasText: 'hasSynced=true' })
    .waitFor({ timeout: 60_000 })
  check(true, 'the SDK reports a completed sync')

  const configRows = await page.evaluate(async () => Boolean(window.sceptreDrive))
  check(configRows, 'preload bridge still available after sync')

  await page.getByTestId('config-terminal').filter({ hasText: terminalCode }).waitFor({
    timeout: 30_000,
  })
  check(true, 'the local config records the terminal')

  // --- offline: disconnect and read again -----------------------------------
  await page.getByTestId('go-offline').click()
  await page.getByTestId('sync-online').filter({ hasText: 'offline' }).waitFor({ timeout: 30_000 })

  const offlineCounts = await page.evaluate(() => {
    const result = {}
    for (const node of document.querySelectorAll('[data-count]')) {
      const key = node.parentElement?.getAttribute('data-testid')?.replace('count-', '')
      if (key) result[key.replace(/-/g, '_')] = Number(node.getAttribute('data-count'))
    }
    return result
  })
  // The counts only change when the component re-queries; reload the hash view to
  // prove the data is read from disk, not from memory.
  await page.evaluate(() => {
    window.location.hash = '#pos'
  })
  await page.getByTestId('pos-shell').waitFor({ timeout: 15_000 })
  await page.evaluate(() => {
    window.location.hash = '#dev/sync'
  })
  await page.getByTestId('synced-tables').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1000)

  const reloadedCounts = await page.evaluate(() => {
    const result = {}
    for (const node of document.querySelectorAll('[data-count]')) {
      const key = node.parentElement?.getAttribute('data-testid')?.replace('count-', '')
      if (key) result[key.replace(/-/g, '_')] = Number(node.getAttribute('data-count'))
    }
    return result
  })
  check(
    JSON.stringify(offlineCounts) === JSON.stringify(reloadedCounts),
    'synced data is still readable while offline',
  )

  // --- reconnect -------------------------------------------------------------
  await page.getByTestId('reconnect').click()
  await page.getByTestId('sync-online').filter({ hasText: 'online' }).waitFor({ timeout: 60_000 })
  check(true, 'reconnects after going offline')

  // --- encryption at rest ----------------------------------------------------
  // Only the OPFS root matters: Chromium keeps its own plaintext SQLite files
  // (cache, DIPS, trust tokens) in the profile, and those are not POS data.
  const opfsRoot = path.join(userDataDir, 'File System')
  const dataFiles = []
  const walk = (dir, depth = 0) => {
    if (depth > 6 || !fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else {
        try {
          if (fs.statSync(full).size > 50_000) dataFiles.push(full)
        } catch {
          // Unreadable file: ignore.
        }
      }
    }
  }
  walk(opfsRoot)

  check(
    dataFiles.length > 0,
    'the local database file exists in the profile',
    `${dataFiles.length} file(s)`,
  )

  const plaintext = dataFiles.filter((file) => {
    const header = fs.readFileSync(file).subarray(0, 15).toString('utf8')
    return header === 'SQLite format 3'
  })
  check(
    plaintext.length === 0,
    'the local database is encrypted (no SQLite header)',
    plaintext.join(', '),
  )

  if (dataFiles[0]) {
    const header = fs.readFileSync(dataFiles[0]).subarray(0, 16)
    check(
      !header.toString('utf8').startsWith('SQLite format 3'),
      'the database header is ciphertext',
      header.toString('hex'),
    )
  }

  check(
    consoleErrors.length === 0,
    'no renderer errors during sync',
    consoleErrors.slice(0, 3).join(' | '),
  )
} finally {
  await app.close().catch(() => {})
  fs.rmSync(userDataDir, { recursive: true, force: true })
  // Clean up the device so re-runs start from a clean slate.
  psql(`DELETE FROM device WHERE id = '${enrolled.deviceId}'`)
}

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
