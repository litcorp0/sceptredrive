#!/usr/bin/env node
/**
 * P10-D15 — prove the local schema migration on a database that already has sales.
 *
 * Runs the *production* renderer path (built bundles, `app://sceptre-drive` origin,
 * the SDK's own worker, the OPFS VFS, ChaCha20 at rest) in the unpackaged Electron
 * binary, and drives the `#dev/sync` diagnostics page's proof button.
 *
 * Two real opens of one real SQLite file happen inside the renderer: the first
 * writes a day's trading with the previous schema, the second reopens the same
 * file with the schema this build ships. This script only asserts the report —
 * there is no mock anywhere in the path.
 *
 * Usage (from the repository root, after `bun run build:pos`):
 *   bun run --filter desktop test:schema-migration
 *
 * Why this is not a vitest case: the installed `@powersync/web` needs a browser
 * (worker + OPFS or IndexedDB) and the SDK itself is mocked in the vitest suite,
 * which is exactly what P10-D15 forbids for this proof.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const desktopDir = path.resolve(import.meta.dirname, '..', '..')
const builtRenderer = path.join(desktopDir, '.vite', 'renderer', 'main_window', 'index.html')
const builtMain = path.join(desktopDir, '.vite', 'build', 'main.cjs')

const EXPECTED_COUNTS = {
  shift: 1,
  sale: 2,
  sale_line: 2,
  sale_tender: 2,
  cash_movement: 1,
  outbox: 3,
}

const failures = []
let checks = 0

function check(condition, label, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
    return true
  }
  failures.push(detail ? `${label} (${detail})` : label)
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  return false
}

function electronBinary() {
  const relative = fs.readFileSync(
    path.join(desktopDir, 'node_modules', 'electron', 'path.txt'),
    'utf8',
  )
  return path.join(desktopDir, 'node_modules', 'electron', 'dist', relative.trim())
}

function assertBuildPresent() {
  if (!fs.existsSync(builtMain) || !fs.existsSync(builtRenderer)) {
    console.error('Missing .vite build output. Run `bun run build:pos` first.')
    process.exit(2)
  }
}

async function openDiagnostics(page) {
  await page.waitForFunction(() => document.readyState === 'complete', undefined, {
    timeout: 30_000,
  })
  await page.evaluate(() => {
    if (window.location.hash !== '#dev/sync') window.location.hash = '#dev/sync'
  })
  await page.getByTestId('run-schema-migration').waitFor({ timeout: 45_000 })
}

async function runProof(page) {
  await page.getByTestId('run-schema-migration').click()
  // The proof writes a day of trading twice, so give the worker room; a failure
  // still resolves to a report (`FAIL`), never a hang, because each step times out.
  await page
    .getByTestId('schema-migration-ok')
    .filter({ hasText: /OK|FAIL/ })
    .waitFor({ timeout: 180_000 })
  const raw = await page.getByTestId('schema-migration-report').textContent()
  return JSON.parse(raw)
}

async function main() {
  console.log('\nUnpackaged production build (app:// origin)')
  // A unique profile per launch: the single-instance lock, the keychain key, and
  // the database files stay away from the developer's real terminal profile.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-drive-schema-migration-'))
  const cspViolations = []
  const pageErrors = []

  const app = await electron.launch({
    executablePath: electronBinary(),
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
    cwd: desktopDir,
    timeout: 60_000,
  })

  try {
    const page = await app.firstWindow()
    page.on('console', (message) => {
      if (/content security policy/i.test(message.text())) cspViolations.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await openDiagnostics(page)
    check(page.url().startsWith('app://sceptre-drive/'), 'renderer loads from app://', page.url())

    const report = await runProof(page)
    console.log(JSON.stringify(report, null, 2))

    for (const step of report.steps) {
      if (!step.ok) check(false, `step "${step.name}"`, step.detail)
    }
    check(report.ok, 'the migration proof passes', `${report.steps.length} steps`)
    check(
      report.steps.length >= 8,
      'the proof ran every phase',
      `${report.steps.length} steps, ${report.durationMs} ms`,
    )

    for (const [table, total] of Object.entries(EXPECTED_COUNTS)) {
      check(
        report.counts?.[table] === total,
        `${table} rows survive the migration`,
        `${report.counts?.[table] ?? 'missing'}/${total}`,
      )
    }

    for (const index of ['sale_shift', 'sale_occurred', 'sale_terminal_occurred']) {
      check(
        Array.isArray(report.indexes) && report.indexes.includes(index),
        `index ${index} exists after the migration`,
        (report.indexes ?? []).join(', '),
      )
    }

    const plan = Array.isArray(report.queryPlan) ? report.queryPlan.join(' | ') : ''
    check(
      plan.includes('sale_terminal_occurred'),
      'the home day-window query plans through sale_terminal_occurred',
      plan || 'no plan rows',
    )

    check(cspViolations.length === 0, 'no CSP violations', cspViolations.join(' | '))
    check(pageErrors.length === 0, 'no renderer errors', pageErrors.join(' | '))
  } finally {
    await app.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

assertBuildPresent()
await main()

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
