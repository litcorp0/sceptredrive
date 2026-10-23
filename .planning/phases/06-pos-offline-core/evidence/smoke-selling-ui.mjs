#!/usr/bin/env node
/**
 * Plan 06 packaged-app smoke — selling UI guards.
 *
 * Proves the packaged POS (a) mounts the selling app shell without errors,
 * (b) sends an unauthenticated terminal to the sign-in screen from every
 * selling route, and (c) still enforces the CSP with no exceptions.
 *
 * The data-path E2E (enrolled device → shift → cart → tender → upload) needs
 * the API and the PowerSync service, and stays the Plan 09 gate.
 *
 * Usage: bun run build:pos && node .planning/phases/06-pos-offline-core/evidence/smoke-selling-ui.mjs
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
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gikautos-sell-smoke-'))
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
  await page.waitForTimeout(2_000)

  check('the packaged app opens a window', Boolean(page))

  // Each selling route must bounce an unauthenticated terminal to sign-in.
  for (const [route, label] of [
    ['#pos', 'selling'],
    ['#pos/tender', 'tender'],
    ['#pos/settings', 'settings'],
    ['#pos/sales', 'sales'],
    ['#pos/sync', 'sync'],
    ['#pos/receipt/55555555-5555-7555-8555-555555555555', 'receipt'],
  ]) {
    await page.evaluate((hash) => {
      window.location.hash = hash
    }, route)
    await page.waitForTimeout(1_500)
    const hash = await page.evaluate(() => window.location.hash)
    const body = await page.locator('body').innerText()
    check(
      `the ${label} route redirects to sign-in without a staff session`,
      hash === '#login' &&
        /enrol this terminal|who is signing in|authorize this terminal/i.test(body),
      `${hash} · ${body.slice(0, 90)}`,
    )
  }

  await page.screenshot({ path: path.join(shots, '10-selling-guard.png'), fullPage: true })

  // The shell's own screen still works (no regression from the router change).
  await page.evaluate(() => {
    window.location.hash = ''
  })
  await page.waitForTimeout(1_500)
  const shellBody = await page.locator('body').innerText()
  check(
    'the diagnostics shell still renders',
    /Desktop shell ready|Desktop bridge unavailable/i.test(shellBody),
    shellBody.slice(0, 90),
  )

  check('no page errors while navigating', pageErrors.length === 0, pageErrors.join(' | '))
  check('no CSP violations', cspViolations.length === 0, cspViolations.join(' | '))

  const nodeInRenderer = await page.evaluate(
    () => typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
  )
  check('the renderer still has no Node globals', nodeInRenderer === false)
} finally {
  await browser?.close().catch(() => undefined)
  child.kill('SIGTERM')
  fs.rmSync(userDataDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
