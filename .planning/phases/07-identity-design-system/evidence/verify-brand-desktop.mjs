// Desktop half of the Phase 7 Plan 03 runtime proof.
//
// Launches the unpackaged production build (the same `app://` renderer the packaged
// app ships) and asserts the shared tokens, self-hosted fonts, and the charcoal topbar
// token reach the POS renderer. Requires `bun run build:pos` output in `desktop/.vite`.
//
//   node .planning/phases/07-identity-design-system/evidence/verify-brand-desktop.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const desktopDir = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'desktop')
const evidenceDir = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(evidenceDir, { recursive: true })

function electronBinary() {
  const pathFile = path.join(desktopDir, 'node_modules', 'electron', 'path.txt')
  const relative = fs.readFileSync(pathFile, 'utf8').trim()
  return path.join(desktopDir, 'node_modules', 'electron', 'dist', relative)
}

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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-drive-brand-'))
const app = await electron.launch({
  executablePath: electronBinary(),
  args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
  cwd: desktopDir,
  timeout: 60_000,
})

const remote = []
const page = await app.firstWindow()
page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    remote.push(request.url())
  }
})

await page.getByTestId('shell-ready').waitFor({ timeout: 30_000 })

const styles = await page.evaluate(() => {
  const pick = (element) => (element ? getComputedStyle(element) : null)
  const role = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  // Production CSS is minified (#fff, .625rem); normalise before comparing.
  const hex = (value) => {
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value)
    return short
      ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
      : value.toLowerCase()
  }
  const rem = (value) => Number.parseFloat(value)
  return {
    body: pick(document.body)?.fontFamily ?? '',
    bodyBackground: pick(document.body)?.backgroundColor ?? '',
    brand: hex(role('--brand')),
    canvas: hex(role('--canvas')),
    surface: hex(role('--surface')),
    topbar: hex(role('--topbar')),
    chart1: hex(role('--chart-1')),
    radius: rem(role('--radius')),
    fonts: Array.from(document.fonts).map((face) => `${face.family}:${face.status}`),
    heading: pick(document.querySelector('h1, h2, h3'))?.fontFamily ?? '',
  }
})

check(styles.body.includes('Inter Variable'), 'POS body renders in Inter Variable', styles.body)
check(
  styles.heading.includes('Space Grotesk Variable'),
  'POS headings render in Space Grotesk Variable',
  styles.heading,
)
check(
  styles.fonts.some(
    (entry) => entry.includes('JetBrains Mono Variable') && entry.endsWith(':loaded'),
  ),
  'JetBrains Mono is loaded in the POS',
  styles.fonts.join(', '),
)
check(styles.brand === '#f26a1b', '--brand arrives from @sceptre/brand', styles.brand)
check(styles.topbar === '#1b1f23', 'the charcoal topbar token is available', styles.topbar)
check(
  styles.canvas === '#f6f6f4' && styles.surface === '#ffffff',
  'canvas and surface tokens',
  `${styles.canvas} / ${styles.surface}`,
)
check(styles.chart1 === '#f26a1b', 'chart ramp starts on brand', styles.chart1)
check(styles.radius === 0.625, 'radius token is 0.625rem', String(styles.radius))
check(
  styles.bodyBackground === 'rgb(246, 246, 244)',
  'the POS paints the warm canvas',
  styles.bodyBackground,
)
check(remote.length === 0, 'no request leaves the machine', remote.join(', '))

await page.screenshot({ path: path.join(evidenceDir, 'plan03-pos-shell.png') })

await app.close()
fs.rmSync(userDataDir, { recursive: true, force: true })

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error(`Failures:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`)
  process.exit(1)
}
