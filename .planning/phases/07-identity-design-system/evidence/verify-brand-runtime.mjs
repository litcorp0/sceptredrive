// Runtime proof for Phase 7 Plan 03: the admin console really renders the shared
// tokens and self-hosted typefaces, with no font request leaving the machine.
//
// Run with the dev server up:  bun run dev:admin  (port 3000)
//   node .planning/phases/07-identity-design-system/evidence/verify-brand-runtime.mjs
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const base = process.env.ADMIN_URL ?? 'http://localhost:3000'
const evidenceDir = path.resolve(import.meta.dirname, 'shots')
fs.mkdirSync(evidenceDir, { recursive: true })

const failures = []
let checks = 0
function check(condition, label, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures.push(detail ? `${label} (${detail})` : label)
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const offOrigin = []
page.on('request', (request) => {
  const url = new URL(request.url())
  if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol.startsWith('http')) {
    offOrigin.push(request.url())
  }
})

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })

const styles = await page.evaluate(() => {
  const pick = (element) => (element ? getComputedStyle(element) : null)
  const role = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return {
    body: pick(document.body)?.fontFamily ?? '',
    heading: pick(document.querySelector('h1, h2'))?.fontFamily ?? '',
    headingText: document.querySelector('h1, h2')?.textContent?.trim() ?? '',
    brand: role('--brand'),
    canvas: role('--canvas'),
    topbar: role('--topbar'),
    bodyBackground: pick(document.body)?.backgroundColor ?? '',
    bodyColour: pick(document.body)?.color ?? '',
    loadedFonts: Array.from(document.fonts).map((face) => `${face.family}:${face.status}`),
  }
})

check(styles.body.includes('Inter Variable'), 'body renders in Inter Variable', styles.body)
check(
  styles.heading.includes('Space Grotesk Variable'),
  'headings render in Space Grotesk Variable',
  `${styles.headingText} → ${styles.heading}`,
)
check(
  styles.loadedFonts.some(
    (entry) =>
      entry.startsWith('"JetBrains Mono Variable"') || entry.startsWith('JetBrains Mono Variable'),
  ),
  'JetBrains Mono is loaded for figures',
  styles.loadedFonts.join(', '),
)
check(styles.brand === '#f26a1b', '--brand comes from the shared token file', styles.brand)
check(styles.canvas === '#f6f6f4', '--canvas comes from the shared token file', styles.canvas)
check(styles.topbar === '#1b1f23', '--topbar comes from the shared token file', styles.topbar)
check(
  styles.bodyBackground === 'rgb(246, 246, 244)',
  'the canvas paints the warm off-white',
  styles.bodyBackground,
)
check(styles.bodyColour === 'rgb(27, 31, 35)', 'body text is ink', styles.bodyColour)
check(offOrigin.length === 0, 'no request leaves localhost', offOrigin.join(', '))

// Dark mode: the same tokens must flip without a second definition site.
await page.evaluate(() => document.documentElement.classList.add('dark'))
const dark = await page.evaluate(() => {
  const pick = (element) => (element ? getComputedStyle(element) : null)
  const role = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return {
    canvas: role('--canvas'),
    ink: role('--ink'),
    brand: role('--brand'),
    bodyBackground: pick(document.body)?.backgroundColor ?? '',
  }
})
check(dark.canvas === '#1b1f23', 'dark canvas token', dark.canvas)
check(dark.ink === '#f6f6f4', 'dark ink token', dark.ink)
check(dark.brand === '#f26a1b', 'brand is unchanged in dark mode', dark.brand)

await page.evaluate(() => document.documentElement.classList.remove('dark'))
await page.screenshot({
  path: path.join(evidenceDir, 'plan03-admin-login-light.png'),
  fullPage: false,
})
await page.evaluate(() => document.documentElement.classList.add('dark'))
await page.screenshot({
  path: path.join(evidenceDir, 'plan03-admin-login-dark.png'),
  fullPage: false,
})

await browser.close()

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error(`Failures:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`)
  process.exit(1)
}
