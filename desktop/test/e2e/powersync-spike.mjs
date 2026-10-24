#!/usr/bin/env node
/**
 * PowerSync Web SDK spike — the Phase 6 gate.
 *
 * Proves the SDK runs inside the sandboxed Electron renderer served from
 * `app://sceptre-drive`, twice:
 *
 *   1. unpackaged production build: both candidate VFS backends, driven through
 *      the real `#spike` UI;
 *   2. packaged binary with a fixed user-data directory: run, quit, relaunch,
 *      run again — the persisted counter proves the SQLite file survives a
 *      restart under the app's own profile.
 *
 * Fails the gate when neither VFS works. The OPFS result is always recorded,
 * because the production VFS choice depends on it.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium, _electron as electron } from 'playwright'

const desktopDir = path.resolve(import.meta.dirname, '..', '..')
const packagedBinary = path.join(
  desktopDir,
  'out',
  'Sceptre Drive POS-linux-x64',
  'Sceptre Drive POS',
)

const reports = { default: null, opfscopysync: null, packagedRun1: null, packagedRun2: null }
let userDataDir = null
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

/** An ephemeral port, so a zombie instance from an earlier run is never reused. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'string' || address === null) {
        server.close()
        reject(new Error('could not reserve a port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
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
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`CDP endpoint on :${port} did not come up within ${timeoutMs}ms`)
}

async function openSpikeRoute(page) {
  // Chromium may restore the previous view (including its hash); force the spike
  // route either way.
  await page.waitForFunction(() => document.readyState === 'complete', undefined, {
    timeout: 30_000,
  })
  await page.evaluate(() => {
    if (window.location.hash !== '#spike') {
      window.location.hash = '#spike'
    }
  })
  await page.getByRole('button', { name: /Run spike \(default VFS\)/ }).waitFor({ timeout: 30_000 })
}

async function runSpikeFromUi(page, vfs) {
  const label = vfs === 'default' ? /Run spike \(default VFS\)/ : /Run spike \(OPFSCoopSync VFS\)/
  await page.getByRole('button', { name: label }).click()
  await page
    .getByTestId('spike-ok')
    .filter({ hasText: /OK|FAIL/ })
    .waitFor({ timeout: 120_000 })
  const raw = await page.getByTestId('spike-report').textContent()
  return JSON.parse(raw)
}

async function checkUnpackaged() {
  console.log('\nUnpackaged production build (app:// origin)')
  // A unique profile per launch keeps the single-instance lock (and the local
  // database) away from the developer's real terminal profile.
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-drive-spike-'))
  const app = await electron.launch({
    executablePath: electronBinary(),
    args: ['.', '--no-sandbox', `--user-data-dir=${userDataDir}`],
    cwd: desktopDir,
    timeout: 60_000,
  })

  const cspViolations = []
  const consoleErrors = []
  const page = await app.firstWindow()
  page.on('console', (message) => {
    const text = message.text()
    if (/content security policy/i.test(text)) cspViolations.push(text)
    else if (message.type() === 'error') consoleErrors.push(text)
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await openSpikeRoute(page)

  const defaultReport = await runSpikeFromUi(page, 'default')
  reports.default = defaultReport
  check(defaultReport.ok, 'default VFS spike passes', describe(defaultReport))
  for (const step of defaultReport.steps) {
    if (!step.ok) check(false, `default VFS step "${step.name}"`, step.detail)
  }
  check(
    defaultReport.persistRuns === 1,
    'first run of a fresh database',
    `run #${defaultReport.persistRuns}`,
  )

  const opfsReport = await runSpikeFromUi(page, 'opfscopysync')
  reports.opfscopysync = opfsReport
  console.log(
    `  info OPCFS/FSCoopSync VFS: ${opfsReport.ok ? 'works' : 'does not work'} (${describe(opfsReport)})`,
  )

  check(
    defaultReport.ok || opfsReport.ok,
    'at least one VFS works inside the app:// renderer',
    `default=${defaultReport.ok} opfs=${opfsReport.ok}`,
  )
  check(cspViolations.length === 0, 'no CSP violations during the spike', cspViolations.join(' | '))
  check(
    consoleErrors.length === 0,
    'no renderer errors during the spike',
    consoleErrors.join(' | '),
  )

  await page.screenshot({
    path: path.join(
      desktopDir,
      '..',
      '.planning',
      'phases',
      '06-pos-offline-core',
      'evidence',
      'powersync-spike.png',
    ),
  })
  await app.close()
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true })
}

function describe(report) {
  if (!report) return 'no report'
  const failed = report.steps.filter((step) => !step.ok)
  if (failed.length === 0) return `${report.durationMs} ms`
  return failed.map((step) => `${step.name}: ${step.detail}`).join('; ')
}

/** Processes still holding a profile directory (used to wait for a clean exit). */
function processesUsing(userDataDir) {
  try {
    return execSync(`ps -eo pid,args | grep -F '${userDataDir}' | grep -v grep || true`, {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Stops a packaged app *and* its renderer/GPU children.
 *
 * A leftover child keeps the SQLite file locked, which makes the next launch
 * fail to open the database — exactly the kind of flake this gate must not hide.
 */
async function stopPackaged(instance, userDataDir) {
  try {
    process.kill(-instance.child.pid, 'SIGTERM')
  } catch {
    instance.child.kill('SIGTERM')
  }
  await new Promise((resolve) => instance.child.once('exit', resolve))
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && processesUsing(userDataDir).length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  try {
    process.kill(-instance.child.pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

async function launchPackaged(userDataDir, port) {
  const child = spawn(
    packagedBinary,
    [
      '--no-sandbox',
      '--disable-gpu',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
    ],
    // Own process group so the whole Electron tree can be stopped.
    { stdio: 'ignore', detached: true },
  )
  await waitForCdp(port, 30_000)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 })
  const page = await waitForAppPage(browser)
  page.on('pageerror', (error) => console.log('  [pageerror]', error.message))
  page.on('console', (message) => {
    console.log('  [console]', message.type(), message.text().slice(0, 300))
  })
  return { child, browser, page }
}

/** CDP attaches before the window exists; wait for the `app://` document. */
async function waitForAppPage(browser, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) => candidate.url().startsWith('app://'))
      if (page) return page
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('the packaged app never loaded an app:// page')
}

async function checkPackagedRestart() {
  if (!fs.existsSync(packagedBinary)) {
    console.log('\nPackaged binary not found — skipping restart persistence check.')
    return
  }

  console.log('\nPackaged binary, fixed profile (restart persistence)')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-drive-spike-e2e-'))

  try {
    const first = await launchPackaged(userDataDir, await freePort())
    await openSpikeRoute(first.page)
    const firstReport = await runSpikeFromUi(first.page, 'default')
    check(firstReport.ok, 'packaged spike passes', describe(firstReport))
    reports.packagedRun1 = firstReport
    const firstRuns = firstReport.persistRuns
    await first.browser.close()
    await stopPackaged(first, userDataDir)

    const second = await launchPackaged(userDataDir, await freePort())
    await openSpikeRoute(second.page)
    const secondReport = await runSpikeFromUi(second.page, 'default')
    reports.packagedRun2 = secondReport
    check(secondReport.ok, 'packaged spike passes after restart', describe(secondReport))
    check(
      secondReport.persistRuns === firstRuns + 1,
      'SQLite data survives an app restart',
      `run #${firstRuns} -> run #${secondReport.persistRuns}`,
    )
    await second.browser.close()
    await stopPackaged(second, userDataDir)
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

await checkUnpackaged()
await checkPackagedRestart()

fs.writeFileSync(
  path.join(
    desktopDir,
    '..',
    '.planning',
    'phases',
    '06-pos-offline-core',
    'evidence',
    'powersync-spike-report.json',
  ),
  `${JSON.stringify(reports, null, 2)}\n`,
)

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
