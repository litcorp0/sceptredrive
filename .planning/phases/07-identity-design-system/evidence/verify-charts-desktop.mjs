// Phase 7 Plan 04 — the POS chart gallery, measured inside the real Electron renderer.
//
// Requires `bun run --filter desktop build` (the unpackaged production build):
//   node .planning/phases/07-identity-design-system/evidence/verify-charts-desktop.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const desktopDir = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'desktop')
const evidenceDir = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(evidenceDir, { recursive: true })

const WIDTHS = [320, 768, 1024, 1440]

/**
 * Reduced motion is measured, not string-compared: the global policy caps durations at
 * `0.01ms`, which the browser serialises as `1e-05s`, not `0s`. Anything at or under this
 * ceiling is not a perceptible entrance animation; anything above it is.
 */
const REDUCED_MOTION_CEILING_MS = 1
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

function electronBinary() {
  const pathFile = path.join(desktopDir, 'node_modules', 'electron', 'path.txt')
  return path.join(
    desktopDir,
    'node_modules',
    'electron',
    'dist',
    fs.readFileSync(pathFile, 'utf8').trim(),
  )
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-drive-charts-'))
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

await page.evaluate(() => {
  window.location.hash = '#dev/charts'
})
await page.waitForSelector('[data-slot="chart"]', { timeout: 30_000 })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)

async function geometry() {
  return page.evaluate(() => {
    const charts = Array.from(document.querySelectorAll('[data-slot="chart"]'))
    return {
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      heights: charts.map((chart) => Math.round(chart.getBoundingClientRect().height)),
      count: charts.length,
    }
  })
}

for (const width of WIDTHS) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.setContentSize(size.width, 900)
    },
    { width },
  )

  for (const theme of ['light', 'dark']) {
    for (const motion of ['no-preference', 'reduce']) {
      await page.emulateMedia({ reducedMotion: motion })
      await page.evaluate((next) => {
        document.documentElement.classList.toggle('dark', next === 'dark')
      }, theme)
      await page.waitForTimeout(350)

      const geo = await geometry()
      const tag = `${width}px ${theme} ${motion}`
      check(geo.count === 4, `${tag}: four chart containers`, String(geo.count))
      check(
        geo.scrollWidth <= geo.viewport + 1,
        `${tag}: no horizontal scroll`,
        `${geo.scrollWidth} > ${geo.viewport}`,
      )
      check(
        geo.heights.every((height) => height >= 80),
        `${tag}: no zero-height chart`,
        geo.heights.join(', '),
      )
      if (motion === 'reduce') {
        const animating = await page.evaluate(
          (ceiling) =>
            Array.from(document.querySelectorAll('[data-slot="chart"] *')).filter((node) => {
              const style = getComputedStyle(node)
              const ms = (value) =>
                value.trim().endsWith('ms')
                  ? Number(value.trim().slice(0, -2))
                  : Number(value.trim().slice(0, -1)) * 1000
              const animation = ms(style.animationDuration)
              const transition = ms(style.transitionDuration)
              return (style.animationName !== 'none' && animation > ceiling) || transition > ceiling
            }).length,
          REDUCED_MOTION_CEILING_MS,
        )
        check(animating === 0, `${tag}: no entrance animation`, String(animating))
      }

      await page.screenshot({
        path: path.join(evidenceDir, `plan04-pos-${width}-${theme}-${motion}.png`),
      })
    }
  }
}

await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 900)
})
await page.emulateMedia({ reducedMotion: 'no-preference' })
await page.evaluate(() => document.documentElement.classList.remove('dark'))
await page.waitForTimeout(300)

const ramp = await page.evaluate(() => {
  const area = document.querySelector('[data-slot="chart"] .recharts-area-area')
  return area ? getComputedStyle(area).fill : ''
})
check(ramp === 'rgb(242, 106, 27)', 'first series takes the brand orange', ramp)

const surface = page.locator('[data-slot="chart"]').first().locator('.recharts-wrapper')
const box = await surface.boundingBox()
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(250)
}
const hoverText = await page.evaluate(() => {
  const wrapper = document.querySelector('[data-slot="chart"] .recharts-tooltip-wrapper')
  return wrapper ? (wrapper.textContent ?? '').trim() : ''
})
check(hoverText.length > 0, 'tooltip opens on hover', hoverText.slice(0, 40))

const focusable = page.locator('[data-slot="chart"] [tabindex="0"]').first()
await focusable.focus()
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(250)
const focusText = await page.evaluate(() => {
  const wrapper = document.querySelector('[data-slot="chart"] .recharts-tooltip-wrapper')
  return wrapper ? (wrapper.textContent ?? '').trim() : ''
})
check(focusText.length > 0, 'tooltip opens on keyboard focus', focusText.slice(0, 40))

check(remote.length === 0, 'no request leaves the machine', remote.join(', '))

await app.close()
fs.rmSync(userDataDir, { recursive: true, force: true })

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error(`Failures:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`)
  process.exit(1)
}
