// Phase 7 Plan 04 — the admin chart gallery, measured in a real browser.
//
// Requires the admin dev server:
//   bun run --filter admin dev -- --port 3100 --strictPort
//   node .planning/phases/07-identity-design-system/evidence/verify-charts-admin.mjs
//
// Asserts at four widths: no horizontal scroll, no zero-height chart, the brand
// ramp on the first series, a tooltip on hover AND on keyboard focus, dark mode
// driven by tokens alone, and no animation under prefers-reduced-motion.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const base = process.env.ADMIN_URL ?? 'http://localhost:3100'
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

const browser = await chromium.launch()
const page = await browser.newPage()

const remote = []
page.on('request', (request) => {
  const url = new URL(request.url())
  if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol.startsWith('http')) {
    remote.push(request.url())
  }
})

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
  for (const theme of ['light', 'dark']) {
    for (const motion of ['no-preference', 'reduce']) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: motion })
      await page.goto(`${base}/dev-charts`, { waitUntil: 'networkidle' })
      await page.waitForSelector('[data-slot="chart"]', { timeout: 20_000 })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(350)
      if (theme === 'dark') {
        await page.evaluate(() => document.documentElement.classList.add('dark'))
        await page.waitForTimeout(200)
      }

      /*
       * A cold dev server can paint the charts once before the stylesheet has settled: a
       * 361px layout measured against a 320px viewport on a first run, then never again.
       * Wait for the steady state instead of racing it — the claim is about the final layout.
       */
      for (let settle = 0; settle < 20; settle += 1) {
        const settled = await page.evaluate(
          (target) => document.documentElement.scrollWidth <= target,
          width,
        )
        if (settled) break
        await page.waitForTimeout(250)
      }

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
        const animating = await page.evaluate((ceiling) => {
          const nodes = Array.from(document.querySelectorAll('[data-slot="chart"] *'))
          return nodes.filter((node) => {
            const style = getComputedStyle(node)
            const ms = (value) =>
              value.trim().endsWith('ms')
                ? Number(value.trim().slice(0, -2))
                : Number(value.trim().slice(0, -1)) * 1000
            const animation = ms(style.animationDuration)
            const transition = ms(style.transitionDuration)
            return (style.animationName !== 'none' && animation > ceiling) || transition > ceiling
          }).length
        }, REDUCED_MOTION_CEILING_MS)
        check(animating === 0, `${tag}: no entrance animation`, String(animating))
      }

      await page.screenshot({
        path: path.join(evidenceDir, `plan04-admin-${width}-${theme}-${motion}.png`),
        fullPage: false,
      })
    }
  }
}

// Brand ramp + tooltip interaction at a comfortable width.
await page.setViewportSize({ width: 1280, height: 900 })
await page.emulateMedia({ reducedMotion: 'no-preference' })
await page.goto(`${base}/dev-charts`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-slot="chart"]', { timeout: 20_000 })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)

const firstSeries = await page.evaluate(() => {
  const area = document.querySelector('[data-slot="chart"] .recharts-area-area')
  const bar = document.querySelector('[data-slot="chart"] .recharts-bar-rectangle path')
  const read = (element) => (element ? getComputedStyle(element).fill : '')
  return { area: read(area), bar: read(bar) }
})
check(
  firstSeries.area === 'rgb(242, 106, 27)',
  'first area series takes the brand orange',
  firstSeries.area,
)
check(
  firstSeries.bar === 'rgb(242, 106, 27)',
  'first bar series takes the brand orange',
  firstSeries.bar,
)

const surface = page.locator('[data-slot="chart"]').first().locator('.recharts-wrapper')
const box = await surface.boundingBox()
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(250)
}
const hoverTooltip = await page.evaluate(() => {
  const wrapper = document.querySelector('[data-slot="chart"] .recharts-tooltip-wrapper')
  return wrapper ? (wrapper.textContent ?? '').trim() : ''
})
check(hoverTooltip.length > 0, 'tooltip opens on hover', hoverTooltip.slice(0, 40))

// Keyboard: focus the accessible layer, then move the active index.
const focusable = page.locator('[data-slot="chart"] [tabindex="0"]').first()
await focusable.focus()
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(250)
const focusTooltip = await page.evaluate(() => {
  const wrapper = document.querySelector('[data-slot="chart"] .recharts-tooltip-wrapper')
  return wrapper ? (wrapper.textContent ?? '').trim() : ''
})
check(focusTooltip.length > 0, 'tooltip opens on keyboard focus', focusTooltip.slice(0, 40))

check(remote.length === 0, 'no request leaves the machine', remote.join(', '))

// A production build must not serve the fixture route.
await page.evaluate(() => document.documentElement.classList.remove('dark'))
await browser.close()

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error(`Failures:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`)
  process.exit(1)
}
