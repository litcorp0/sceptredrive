#!/usr/bin/env node
/**
 * Plan 04 packaged-app smoke.
 *
 * Proves the packaged POS (a) renders the PIN login route, and (b) can hash and
 * verify a PIN through the main process, i.e. `@node-rs/argon2` is present in
 * the package's `app.asar.unpacked` and reachable over IPC.
 *
 * The packaged fuses block `--inspect`, so (like `security-smoke.mjs`) this
 * drives the app over the Chrome DevTools Protocol instead of `_electron`.
 *
 * The full enrolled-device flow (authorize → change PIN → relaunch offline →
 * shift close → upload) needs the API and PowerSync service and belongs to the
 * Plan 09 E2E gate.
 *
 * Usage: bun run build:pos && node .planning/phases/06-pos-offline-core/evidence/smoke-pin-ui.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const repo = path.resolve(import.meta.dirname, '..', '..', '..', '..')
const binary = path.join(repo, 'desktop', 'out', 'GikAutos POS-linux-x64', 'GikAutos POS')
const shots = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(shots, { recursive: true })

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

if (!fs.existsSync(binary)) {
  console.error(`Missing packaged binary: ${binary}\nRun \`bun run build:pos\` first.`)
  process.exit(2)
}

const port = await freePort()
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gikautos-pin-smoke-'))
const child = spawn(
  binary,
  [
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
  ],
  { stdio: 'ignore' },
)

let browser
try {
  await waitForCdp(port, 40_000)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 })
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 20_000 }))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1_500)

  check('the packaged app opens a window', Boolean(page))

  await page.evaluate(() => {
    window.location.hash = '#login'
  })
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: path.join(shots, '01-login-route.png'), fullPage: true })

  const body = await page.locator('body').innerText()
  check(
    'the login route renders (enrolment or PIN)',
    /enrol this terminal|who is signing in|authorize this terminal/i.test(body),
    body.slice(0, 120),
  )

  const pinRoundTrip = await page.evaluate(async () => {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16))
    const salt = btoa(String.fromCharCode(...saltBytes))
    const hashed = await window.gikautos.pin.hash('2468', salt)
    if (!hashed.ok) return { hashOk: false, verifier: null, ok: false, wrong: false }
    const ok = await window.gikautos.pin.verify(hashed.data, '2468', salt)
    const wrong = await window.gikautos.pin.verify(hashed.data, '2469', salt)
    return {
      hashOk: true,
      verifier: hashed.data,
      ok: ok.ok === true && ok.data === true,
      wrong: wrong.ok === true && wrong.data === false,
    }
  })

  check('PIN hashing runs in the packaged main process', pinRoundTrip.hashOk === true)
  check(
    'the packaged verifier matches the PIN only',
    pinRoundTrip.ok === true && pinRoundTrip.wrong === true,
  )
  check(
    'the verifier is Argon2id and never contains the PIN',
    typeof pinRoundTrip.verifier === 'string' &&
      pinRoundTrip.verifier.startsWith('$argon2id$') &&
      !pinRoundTrip.verifier.includes('2468'),
  )
} finally {
  await browser?.close().catch(() => undefined)
  child.kill('SIGTERM')
  fs.rmSync(userDataDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
