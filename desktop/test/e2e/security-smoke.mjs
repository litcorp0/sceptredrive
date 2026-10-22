#!/usr/bin/env node
/**
 * Security smoke test for the POS shell.
 *
 * Runs the *production* renderer path (built bundles, `app://gikautos` origin)
 * inside the unpackaged Electron binary, then repeats the origin checks against
 * the packaged binary to prove the fuses are applied.
 *
 * Usage (from the repository root, after `bun run package:pos`):
 *   bun run --filter desktop test:e2e
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium, _electron as electron } from 'playwright'

const desktopDir = path.resolve(import.meta.dirname, '..', '..')
const builtMain = path.join(desktopDir, '.vite', 'build', 'main.cjs')
const builtRenderer = path.join(desktopDir, '.vite', 'renderer', 'main_window', 'index.html')
const packagedBinary = path.join(desktopDir, 'out', 'GikAutos POS-linux-x64', 'GikAutos POS')

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

function electronBinary() {
  const pathFile = path.join(desktopDir, 'node_modules', 'electron', 'path.txt')
  const relative = fs.readFileSync(pathFile, 'utf8').trim()
  return path.join(desktopDir, 'node_modules', 'electron', 'dist', relative)
}

function assertBuildPresent() {
  if (!fs.existsSync(builtMain) || !fs.existsSync(builtRenderer)) {
    console.error('Missing .vite build output. Run `bun run build:pos` first.')
    process.exit(2)
  }
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

async function checkProductionRenderer() {
  console.log('\nUnpackaged production build (app:// origin)')
  // A unique profile per launch keeps the single-instance lock and the keychain
  // probe away from the developer's real terminal profile.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gikautos-pos-smoke-'))
  const app = await electron.launch({
    executablePath: electronBinary(),
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
    cwd: desktopDir,
    timeout: 60_000,
  })

  const cspViolations = []
  const page = await app.firstWindow()
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) {
      cspViolations.push(message.text())
    }
  })
  page.on('pageerror', (error) => cspViolations.push(`pageerror: ${error.message}`))

  await page.getByTestId('shell-ready').waitFor({ timeout: 30_000 })

  check(page.url().startsWith('app://gikautos/'), 'renderer loads from app://', page.url())
  check(!page.url().startsWith('file://'), 'renderer never uses file://', page.url())

  const isolation = await page.evaluate(() => ({
    require: typeof globalThis.require,
    process: typeof globalThis.process,
    module: typeof globalThis.module,
    ipcRenderer: typeof globalThis.ipcRenderer,
  }))
  check(isolation.require === 'undefined', 'window.require is undefined')
  check(isolation.process === 'undefined', 'window.process is undefined')
  check(isolation.module === 'undefined', 'window.module is undefined')
  check(isolation.ipcRenderer === 'undefined', 'ipcRenderer is not exposed')

  const headerPolicy = await page.evaluate(async () => {
    const response = await fetch(window.location.href)
    return response.headers.get('content-security-policy')
  })
  check(Boolean(headerPolicy), 'protocol handler sends a CSP header')
  check(
    Boolean(headerPolicy?.includes("'wasm-unsafe-eval'")),
    'CSP allows WASM compilation for SQLite',
    headerPolicy ?? 'missing',
  )
  check(
    Boolean(headerPolicy?.includes('worker-src')),
    'CSP allows worker loading',
    headerPolicy ?? 'missing',
  )
  check(
    Boolean(headerPolicy?.includes('https://*.powersync.journeyapps.com')),
    'CSP allows the PowerSync Cloud origin',
  )
  check(Boolean(headerPolicy?.includes("object-src 'none'")), 'CSP blocks plugins')

  const metaPolicy = await page.evaluate(
    () =>
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? null,
  )
  check(Boolean(metaPolicy), 'index.html carries a CSP meta fallback')
  // The browser enforces the intersection of every policy, so the meta fallback
  // must (at least) cover the same origins the header allows.
  check(
    Boolean(metaPolicy?.includes('https://*.gikautos.com')) &&
      Boolean(metaPolicy?.includes('https://*.powersync.journeyapps.com')),
    'meta fallback covers every origin the CSP allowlist accepts',
    metaPolicy ?? 'missing',
  )
  if (headerPolicy && metaPolicy) {
    const headerDirectives = new Set(
      headerPolicy.split(';').map((part) => part.trim().split(' ')[0]),
    )
    const metaDirectives = new Set(metaPolicy.split(';').map((part) => part.trim().split(' ')[0]))
    check(
      [...metaDirectives].every((name) => headerDirectives.has(name)),
      'meta and header declare the same directives',
    )
  }

  const popup = await page.evaluate(() => {
    const opened = window.open('https://example.com/')
    return { openedIsNull: opened === null }
  })
  check(popup.openedIsNull, 'window.open is denied')
  check(app.windows().length === 1, 'no extra window was created')

  check(cspViolations.length === 0, 'no CSP violations in the console', cspViolations.join(' | '))

  await checkDesktopBridge(page)

  // Last: a blocked navigation leaves Chromium waiting on a navigation that
  // never completes, which would stall later locators.
  const navigationBlocked = await page
    .evaluate(async () => {
      try {
        window.location.href = 'https://example.com/'
      } catch {
        // Navigation is cancelled; the document stays put.
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
      return window.location.href
    })
    .catch(() => 'navigation destroyed the page')
  check(
    navigationBlocked.startsWith('app://gikautos/'),
    'navigation to a remote origin is blocked',
    navigationBlocked,
  )

  await app.close()
}

async function checkDesktopBridge(page) {
  console.log('\nPreload bridge and keychain')

  const shape = await page.evaluate(() => ({
    root: Object.keys(globalThis.gikautos ?? {}).sort(),
    app: Object.keys(globalThis.gikautos?.app ?? {}).sort(),
    secure: Object.keys(globalThis.gikautos?.secure ?? {}).sort(),
    hasInvoke: 'invoke' in (globalThis.gikautos ?? {}),
  }))
  check(
    shape.root.join(',') === 'app,secure',
    'bridge exposes only app and secure',
    shape.root.join(','),
  )
  check(
    shape.app.join(',') === 'getInfo',
    'bridge app surface is app.getInfo only',
    shape.app.join(','),
  )
  check(
    shape.secure.join(',') === 'delete,get,set',
    'bridge secure surface is get/set/delete only',
    shape.secure.join(','),
  )
  check(!shape.hasInvoke, 'no generic invoke() on the bridge')

  const info = await page.evaluate(async () => {
    const result = await globalThis.gikautos?.app.getInfo()
    return result?.ok ? result.data : null
  })
  check(Boolean(info), 'app.getInfo() returns typed data')
  if (!info) return

  check(info.electron.startsWith('45.'), 'app info reports Electron 45', info.electron)
  check(info.platform === 'linux', 'app info reports the platform', info.platform)
  check(typeof info.userDataPath === 'string', 'app info exposes the user data path')
  check(
    ['os', 'basic', 'unavailable'].includes(info.secureStorage.level),
    'app info reports the secure storage level',
    info.secureStorage.level,
  )

  if (!info.secureStorage.available) {
    check(
      await page.evaluate(async () => {
        const result = await globalThis.gikautos?.secure.set('keychainSelfTest', 'x')
        return result?.ok === false && result.error.code === 'KEYCHAIN_UNAVAILABLE'
      }),
      'unavailable keychain fails closed with KEYCHAIN_UNAVAILABLE',
    )
    return
  }

  await page.getByRole('button', { name: 'Run keychain self-test' }).click()
  await page.getByTestId('keychain-status').filter({ hasText: 'PASS' }).waitFor({ timeout: 15_000 })
  check(true, 'keychain round-trip via IPC reports PASS')

  const secretsPath = path.join(info.userDataPath, 'secrets.json')
  const raw = fs.readFileSync(secretsPath, 'utf8')
  check(!raw.includes('probe-'), 'secrets.json holds ciphertext, not the plaintext probe')
  check((fs.statSync(secretsPath).mode & 0o777) === 0o600, 'secrets.json is mode 0600')
  check(
    await page.evaluate(() => Boolean(globalThis.gikautos)),
    'preload bridge survives a keychain write',
  )

  await page.getByRole('button', { name: 'Clear keychain probe' }).click()
  await page
    .getByTestId('keychain-status')
    .filter({ hasText: 'CLEARED' })
    .waitFor({ timeout: 15_000 })
  check(true, 'keychain probe can be removed')
}

async function checkPackagedBinary() {
  if (!fs.existsSync(packagedBinary)) {
    console.log('\nPackaged binary not found — skipping fuse checks (run `bun run package:pos`).')
    return
  }

  console.log('\nPackaged binary (fuses applied)')

  // EnableNodeCliInspectArguments is fused off, so the Node inspector must not
  // come up even when the flag is passed.
  const inspectOutput = await new Promise((resolve) => {
    const child = spawn(packagedBinary, ['--no-sandbox', '--disable-gpu', '--inspect=9339'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    setTimeout(() => {
      child.kill('SIGTERM')
      resolve(output)
    }, 6_000)
  })
  check(
    !/Debugger listening on/.test(inspectOutput),
    'fuse blocks --inspect (no Node debugger)',
    inspectOutput.slice(0, 200),
  )

  // The app itself still runs: drive it over CDP (Playwright's Electron
  // launcher needs the Node inspector, which the fuses remove on purpose).
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gikautos-pos-e2e-'))
  const port = await freePort()
  const child = spawn(
    packagedBinary,
    [
      '--no-sandbox',
      '--disable-gpu',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
    ],
    { stdio: 'ignore' },
  )

  try {
    await waitForCdp(port, 30_000)
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 })
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 20_000 }))
    await page.getByTestId('shell-ready').waitFor({ timeout: 30_000 })
    check(page.url().startsWith('app://gikautos/'), 'packaged app loads from app://', page.url())

    const isolated = await page.evaluate(() => typeof globalThis.require === 'undefined')
    check(isolated, 'packaged renderer has no Node access')
    await browser.close()
  } finally {
    child.kill('SIGTERM')
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

assertBuildPresent()
await checkProductionRenderer()
await checkPackagedBinary()

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
