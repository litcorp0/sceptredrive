#!/usr/bin/env node
/**
 * Token gate — fails the build when the design system stops being one system.
 *
 * The phase goal is "one token source, one typography set, one primitive library, one date
 * formatter". A screenshot cannot prove that; this script can. It asserts five things:
 *
 *   1. Both clients import `@sceptre/brand/tokens.css` (and neither re-implements it).
 *   2. No app file under `admin/src` or `desktop/src/renderer` carries a brand hex value.
 *   3. `packages/brand/src/tokens.css` defines every required custom property, and every
 *      colour that must change between light and dark is redefined in `.dark`.
 *   4. The palette's contrast pairs clear WCAG 2.2 AA — computed here with the
 *      relative-luminance formula, never a hard-coded ratio. The rejected pairing
 *      (white on brand) is asserted to *stay* rejected, so nobody "improves" the design
 *      into a failure.
 *   5. `date-fns` resolves to exactly one version in the workspace lockfile.
 *
 *   bun run tokens:check
 *
 * Only tracked files are scanned, for the same reason as `check-brand.mjs`: build output,
 * `node_modules`, and local artefacts are not sources.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const TOKENS_FILE = 'packages/brand/src/tokens.css'
const APPS = ['admin', 'desktop']

/** App stylesheets must consume the package, and nothing else may define the system. */
const APP_STYLESHEETS = {
  admin: 'admin/src/styles.css',
  desktop: 'desktop/src/renderer/index.css',
}

/** Directories that must contain no brand colour literal. */
const APP_SOURCE_DIRS = ['admin/src/', 'desktop/src/renderer/']

/** Case-insensitive brand literals. `1b1f23` is the ink; `f26a1b` is the brand orange. */
const BRAND_HEXES = ['#f26a1b', '#1b1f23', 'f26a1b', '1b1f23']

/**
 * shadcn surface map. `--background` … `--ring` in the order the registry expects.
 * These may be `var()` references — that is the point of the mapping.
 */
const REQUIRED_ROOT = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
]

/** Named brand + chrome tokens the design contract in 00-CONTEXT D7 fixes by value. */
const REQUIRED_BRAND = [
  'brand',
  'brand-fg',
  'brand-ink',
  'ink',
  'canvas',
  'surface',
  'muted-ink',
  'line',
  'line-strong',
  'topbar',
]

const REQUIRED_CHART = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7']

const REQUIRED_SIDEBAR = [
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
]

const REQUIRED_LAYOUT = ['layout-sidebar-width', 'layout-topbar-height', 'layout-content-max']

/**
 * Tokens `.dark` must redefine. Every entry is a token whose light value is a literal
 * colour: inheriting one would paint dark mode with a light-mode value. `var()` aliases
 * (`--background`, `--card`, `--primary`, …) deliberately inherit and are not listed.
 */
const REQUIRED_DARK = [
  'ink',
  'brand',
  'brand-fg',
  'brand-ink',
  'brand-tint',
  'canvas',
  'surface',
  'muted-ink',
  'line',
  'line-strong',
  'topbar',
  'topbar-foreground',
  'topbar-muted',
  'secondary',
  'muted',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'ok',
  'warn',
  'danger',
  'info',
  ...REQUIRED_CHART,
  'sidebar',
  'sidebar-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
]

/**
 * Contrast contract. Colours are **resolved from the token file** (`{ token }`) or given as a
 * literal (`{ hex }`), so this measures what ships rather than a copy of it — lightening
 * `--muted-ink` must break the gate, not just editing this list.
 *
 * `min` is a floor; `max` is a ceiling used to pin a pairing that must stay rejected.
 */
const CONTRAST_PAIRS = [
  {
    label: 'primary button label: brand-fg on brand (AA normal text)',
    fg: { token: 'brand-fg' },
    bg: { token: 'brand' },
    min: 4.5,
  },
  {
    label: 'rejected pairing: white on brand stays below AA normal text',
    fg: { hex: '#FFFFFF' },
    bg: { token: 'brand' },
    max: 4.5,
  },
  {
    label: 'muted text: muted-ink on canvas',
    fg: { token: 'muted-ink' },
    bg: { token: 'canvas' },
    min: 4.5,
  },
  {
    label: 'body text: ink on canvas (AAA)',
    fg: { token: 'ink' },
    bg: { token: 'canvas' },
    min: 7,
  },
  {
    label: 'brand as text: brand-ink on surface',
    fg: { token: 'brand-ink' },
    bg: { token: 'surface' },
    min: 4.5,
  },
  {
    label: 'dark body text: ink on surface (AAA)',
    fg: { token: 'ink', mode: 'dark' },
    bg: { token: 'surface', mode: 'dark' },
    min: 7,
  },
  {
    label: 'dark muted text: muted-ink on surface',
    fg: { token: 'muted-ink', mode: 'dark' },
    bg: { token: 'surface', mode: 'dark' },
    min: 4.5,
  },
  {
    label: 'dark brand as text: brand-ink on surface',
    fg: { token: 'brand-ink', mode: 'dark' },
    bg: { token: 'surface', mode: 'dark' },
    min: 4.5,
  },
  // Added by Plan 07: the interaction boundaries this phase introduced. WCAG 2.2 SC 1.4.11
  // requires 3:1 for the border of an operable control, which is what `--input` maps to.
  {
    label: 'light input boundary: line-strong on surface (SC 1.4.11)',
    fg: { token: 'line-strong' },
    bg: { token: 'surface' },
    min: 3,
  },
  {
    label: 'light input boundary: line-strong on canvas (SC 1.4.11)',
    fg: { token: 'line-strong' },
    bg: { token: 'canvas' },
    min: 3,
  },
  {
    label: 'dark input boundary: line-strong on surface (SC 1.4.11)',
    fg: { token: 'line-strong', mode: 'dark' },
    bg: { token: 'surface', mode: 'dark' },
    min: 3,
  },
]

// Added by Phase 9: every chart series must be distinguishable from the panel it is drawn
// on (WCAG 2.2 SC 1.4.11 non-text contrast). Provided as a source-level assertion because a
// palette retune is exactly when this is forgotten; it is measured, not copied.
for (const mode of ['light', 'dark']) {
  for (const token of REQUIRED_CHART) {
    CONTRAST_PAIRS.push({
      label: `${mode} chart series: ${token} on surface (SC 1.4.11)`,
      fg: { token, mode },
      bg: { token: 'surface', mode },
      min: 3,
    })
  }
}

const failures = []

function fail(message) {
  failures.push(message)
}

function relative(file) {
  return new URL(`../${file}`, import.meta.url).pathname
}

// ---------------------------------------------------------------- file scanning

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  return output.split('\0').filter(Boolean)
}

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0)
}

// ---------------------------------------------------------------- CSS parsing

/**
 * Extract a rule block by selector, brace-matched, so a nested `@media` inside `.dark`
 * cannot silently truncate the reading.
 */
function block(source, selector) {
  const start = source.search(new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{`))
  if (start === -1) return null
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  return null
}

/** `--name: value;` declarations, ignoring comments. */
function declarations(css) {
  const map = new Map()
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of withoutComments.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1], match[2].trim())
  }
  return map
}

/** Follow `var(--x)` chains to a literal. Returns null when the chain does not terminate. */
function resolveToken(map, name, seen = new Set()) {
  if (seen.has(name)) return null
  seen.add(name)
  const value = map.get(name)
  if (value === undefined) return null
  const reference = value.match(/^var\(\s*--([\w-]+)\s*\)$/)
  if (reference) return resolveToken(map, reference[1], seen)
  return value
}

function parseHex(value) {
  const hex = value.trim().replace(/^#/, '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((character) => character + character)
          .join('')
      : hex
  if (!/^[\da-f]{6}$/i.test(full)) return null
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

function sameColour(a, b) {
  const left = parseHex(a)
  const right = parseHex(b)
  if (!left || !right) return false
  return left.r === right.r && left.g === right.g && left.b === right.b
}

// ---------------------------------------------------------------- WCAG maths

/** sRGB channel linearisation per WCAG 2.2 “relative luminance”. */
function linearise(channel) {
  const scaled = channel / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const colour = parseHex(hex)
  if (!colour) return null
  return 0.2126 * linearise(colour.r) + 0.7152 * linearise(colour.g) + 0.0722 * linearise(colour.b)
}

function contrastRatio(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  if (a === null || b === null) return null
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

// ---------------------------------------------------------------- checks

let tokens

try {
  tokens = readFileSync(relative(TOKENS_FILE), 'utf8')
} catch {
  console.error(`tokens check FAILED — cannot read ${TOKENS_FILE}`)
  process.exit(1)
}

// 1. Both clients import the shared token file.
for (const app of APPS) {
  const file = APP_STYLESHEETS[app]
  let css
  try {
    css = readFileSync(relative(file), 'utf8')
  } catch {
    fail(`${file} is missing`)
    continue
  }
  if (!/@import\s+["']@sceptre\/brand\/tokens\.css["']/.test(css)) {
    fail(`${file} does not import "@sceptre/brand/tokens.css"`)
  }
  if (/--(?:brand|ink|canvas|surface|topbar|chart-[1-7])\s*:/.test(css)) {
    fail(`${file} declares a brand/layout token; those belong in ${TOKENS_FILE}`)
  }
}

// 2. No brand hex anywhere in app source.
let scanned = 0
for (const file of trackedFiles()) {
  if (!APP_SOURCE_DIRS.some((prefix) => file.startsWith(prefix))) continue
  const buffer = readFileSync(relative(file))
  if (isBinary(buffer)) continue
  scanned += 1
  const lines = buffer.toString('utf8').split('\n')
  for (const [index, line] of lines.entries()) {
    const lowered = line.toLowerCase()
    const hit = BRAND_HEXES.find((hex) => lowered.includes(hex))
    if (hit) fail(`${file}:${index + 1} carries the brand literal "${hit}"`)
  }
}

// 3. Required custom properties, in the right blocks.
const rootBlock = block(tokens, ':root')
const darkBlock = block(tokens, '.dark')

if (rootBlock === null) {
  fail(`${TOKENS_FILE} has no :root block`)
} else {
  const root = declarations(rootBlock)
  const required = [
    ...REQUIRED_ROOT,
    ...REQUIRED_BRAND,
    ...REQUIRED_CHART,
    ...REQUIRED_SIDEBAR,
    ...REQUIRED_LAYOUT,
  ]
  for (const name of required) {
    if (!root.has(name)) fail(`:root in ${TOKENS_FILE} is missing --${name}`)
  }
  if (!root.has('radius')) fail(`:root in ${TOKENS_FILE} is missing --radius`)
}

if (darkBlock === null) {
  fail(`${TOKENS_FILE} has no .dark block`)
} else {
  const dark = declarations(darkBlock)
  for (const name of REQUIRED_DARK) {
    if (!dark.has(name)) {
      fail(`.dark in ${TOKENS_FILE} is missing --${name} (a light-mode value would leak)`)
    }
  }
}

/**
 * The primary button is charcoal on orange, never white on orange, and an operable input's
 * border is the strong line. These are *relationships* between tokens, so they hold even if
 * the palette is retuned; the measured ratios below supply the numeric bound.
 */
function checkRelationships(mode, map) {
  const brand = resolveToken(map, 'brand')
  const primary = resolveToken(map, 'primary')
  const brandForeground = resolveToken(map, 'brand-fg')
  const primaryForeground = resolveToken(map, 'primary-foreground')
  const input = resolveToken(map, 'input')
  const lineStrong = resolveToken(map, 'line-strong')
  const where = mode === 'dark' ? '.dark' : ':root'

  if (!brand || !parseHex(brand)) {
    fail(`${where} --brand must be a literal colour, got ${brand ?? '(unresolved)'}`)
  }
  if (!primary || !brand || !sameColour(primary, brand)) {
    fail(`${where} --primary must resolve to --brand, got ${primary ?? '(unresolved)'}`)
  }
  if (!brandForeground || !parseHex(brandForeground)) {
    fail(`${where} --brand-fg must be a literal colour, got ${brandForeground ?? '(unresolved)'}`)
  }
  if (!primaryForeground || !brandForeground || !sameColour(primaryForeground, brandForeground)) {
    fail(
      `${where} --primary-foreground must resolve to --brand-fg, got ${
        primaryForeground ?? '(unresolved)'
      } — white on orange is only 3.06:1`,
    )
  }
  if (!input || !lineStrong || !sameColour(input, lineStrong)) {
    fail(
      `${where} --input must resolve to --line-strong (an operable boundary needs 3:1), got ${
        input ?? '(unresolved)'
      }`,
    )
  }
}

/**
 * Contrast, measured against the shipped token values. A token pair that resolves to a
 * non-literal (a gradient, a colour function) is skipped with a warning rather than guessed.
 */
function checkContrast(maps) {
  const measured = []
  for (const pair of CONTRAST_PAIRS) {
    const mode = pair.bg.mode ?? pair.fg.mode ?? 'light'
    const map = maps[mode]
    const foreground = resolveColour(map, pair.fg)
    const background = resolveColour(map, pair.bg)
    if (foreground === null || background === null) {
      fail(`contrast pair "${pair.label}" does not resolve to two literal colours`)
      continue
    }
    const ratio = contrastRatio(foreground, background)
    if (ratio === null) {
      fail(`contrast pair "${pair.label}" uses an unparseable colour`)
      continue
    }
    const rounded = Math.round(ratio * 100) / 100
    measured.push({
      label: pair.label,
      ratio: rounded,
      min: pair.min,
      max: pair.max,
      foreground,
      background,
      mode,
    })
    if (pair.min !== undefined && ratio < pair.min) {
      fail(`contrast ${rounded}:1 is under ${pair.min}:1 — ${pair.label}`)
    }
    if (pair.max !== undefined && ratio >= pair.max) {
      fail(`contrast ${rounded}:1 reached ${pair.max}:1 — ${pair.label}`)
    }
  }
  return measured
}

function resolveColour(map, reference) {
  const value = reference.token ? resolveToken(map, reference.token) : reference.hex
  if (!value) return null
  const colour = parseHex(value)
  return colour ? value : null
}

/**
 * Cascade scopes. `:root` is the light palette; `.dark` is the same map with its overrides
 * applied, exactly as the browser resolves it — so an alias like `--primary-foreground:
 * var(--brand-fg)` measures the dark value in dark mode.
 */
function mergedMap(base, override) {
  const merged = new Map(base)
  for (const [name, value] of override) merged.set(name, value)
  return merged
}

const rootDeclarations = rootBlock === null ? new Map() : declarations(rootBlock)
const darkDeclarations = darkBlock === null ? new Map() : declarations(darkBlock)
const maps = {
  light: rootDeclarations,
  dark: mergedMap(rootDeclarations, darkDeclarations),
}

if (rootBlock !== null) checkRelationships('light', maps.light)
if (darkBlock !== null) checkRelationships('dark', maps.dark)

// 4. Contrast, measured from the token file.
const measured = checkContrast(maps)

// 5. One date-fns.
let resolved = []
try {
  const raw = readFileSync(relative('bun.lock'), 'utf8')
  // Bun's text lockfile is JSON with trailing commas.
  const lock = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1'))
  const packages = lock.packages ?? {}
  const versions = new Set()
  for (const [key, entry] of Object.entries(packages)) {
    const spec = Array.isArray(entry) ? entry[0] : undefined
    if (typeof spec !== 'string') continue
    const parsed = spec.match(/^(@?[^@]+(?:@[^@]+)?)@(.+)$/)
    if (!parsed) continue
    const name = parsed[1]
    if (name === 'date-fns') versions.add(spec)
    else if (key.includes('/') && key.split('/').pop() === 'date-fns') versions.add(spec)
  }
  resolved = [...versions]
} catch (error) {
  fail(`cannot read bun.lock: ${error instanceof Error ? error.message : String(error)}`)
}
if (resolved.length > 1) {
  fail(`date-fns resolves to ${resolved.length} versions (${resolved.join(', ')}); one only`)
}
if (resolved.length === 0) {
  fail('date-fns is not present in bun.lock')
}

// ---------------------------------------------------------------- report

if (failures.length > 0) {
  console.error(`tokens check FAILED — ${failures.length} problem(s):\n`)
  for (const message of failures) console.error(`  - ${message}`)
  console.error('\nFix the token source, not the call site.')
  process.exit(1)
}

console.log('token check OK')
console.log(`  token source: ${TOKENS_FILE} (both clients import it)`)
console.log(`  app sources scanned: ${scanned} tracked files, no brand literal`)
console.log(
  `  tokens: ${REQUIRED_ROOT.length + REQUIRED_BRAND.length + REQUIRED_CHART.length} required in :root, ${REQUIRED_DARK.length} redefined in .dark`,
)
console.log(`  date-fns: ${resolved.join(', ')}`)
console.log('  contrast (WCAG 2.2 relative luminance, measured from the token file):')
for (const entry of measured) {
  const bound =
    entry.min !== undefined ? `min ${entry.min}:1` : `max ${entry.max}:1 (must stay rejected)`
  console.log(
    `    ${String(entry.ratio).padStart(6)}:1  ${bound.padEnd(30)} ${entry.label} [${entry.mode} ${entry.foreground} on ${entry.background}]`,
  )
}
