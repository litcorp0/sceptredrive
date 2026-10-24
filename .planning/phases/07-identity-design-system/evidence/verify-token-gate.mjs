// Proves `bun run tokens:check` actually gates — a gate that cannot fail is decoration.
//
// Each case mutates one tracked file, runs the gate, asserts a non-zero exit and that the
// message names the real problem, then restores the file byte-for-byte. The working tree is
// verified clean afterwards, so a crashed run cannot leave a mutation behind.
//
//   node .planning/phases/07-identity-design-system/evidence/verify-token-gate.mjs
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../../../..')
const tokensFile = path.join(root, 'packages/brand/src/tokens.css')
const adminCss = path.join(root, 'admin/src/styles.css')
const lockFile = path.join(root, 'bun.lock')

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

function runGate() {
  const result = spawnSync('node', ['scripts/check-tokens.mjs'], {
    cwd: root,
    encoding: 'utf8',
  })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

/** Mutate, run, assert, restore — in that order, with the restore in `finally`. */
function caseRun({ name, file, mutate, expect }) {
  const original = readFileSync(file, 'utf8')
  try {
    const next = mutate(original)
    if (next === original) throw new Error('mutation did not change the file')
    writeFileSync(file, next)
    const { status, output } = runGate()
    const firstFailure = output
      .split('\n')
      .find((line) => line.trim().startsWith('- '))
      ?.trim()
    check(status !== 0, `${name} → gate fails`, `exit ${status}`)
    check(
      output.toLowerCase().includes(expect.toLowerCase()),
      `${name} → message names the cause`,
      firstFailure ?? output.split('\n')[0],
    )
    console.log(`        ${firstFailure ?? ''}`)
  } finally {
    writeFileSync(file, original)
  }
}

console.log('Phase 7 Plan 07 — token gate mutation proof\n')

// Baseline: the real tree passes, so every failure below is caused by the mutation.
const baseline = runGate()
check(baseline.status === 0, 'unmutated tree passes the gate', `exit ${baseline.status}`)

// 1. Rule 1 — the client stops importing the shared token file.
caseRun({
  name: 'remove @sceptre/brand import from admin',
  file: adminCss,
  expect: 'does not import',
  mutate: (css) => css.replace('@import "@sceptre/brand/tokens.css";\n', ''),
})

// 2. Rule 2 — a brand literal reappears in app source.
caseRun({
  name: 'hard-code the brand orange in admin CSS',
  file: adminCss,
  expect: 'brand literal',
  mutate: (css) => `${css}\n.brand-swatch {\n\tcolor: #f26a1b;\n}\n`,
})

// 2b. Rule 2 — the ink, in shorthand hex form, in a component.
caseRun({
  name: 'hard-code the ink in the desktop renderer',
  file: path.join(root, 'desktop/src/renderer/index.css'),
  expect: 'brand literal',
  mutate: (css) => `${css}\n.aside-ink {\n  color: #1b1f23;\n}\n`,
})

// 3. Rule 3 — a required token disappears from :root.
caseRun({
  name: 'delete --muted-ink from :root',
  file: tokensFile,
  expect: 'missing --muted-ink',
  mutate: (css) => css.replace('  --muted-ink: #5c6470;\n', ''),
})

// 3b. Rule 3 — a dark-mode colour stops being redefined, so a light value leaks.
caseRun({
  name: 'delete --chart-3 from .dark',
  file: tokensFile,
  expect: 'missing --chart-3',
  mutate: (css) => css.replace('  --chart-3: #9aa3ae;\n', ''),
})

// 3c. Rule 3 — a layout token disappears.
caseRun({
  name: 'delete --layout-topbar-height',
  file: tokensFile,
  expect: 'missing --layout-topbar-height',
  mutate: (css) => css.replace('  --layout-topbar-height: 3.25rem;\n', ''),
})

// 4. Rule 4 — the primary button label becomes white on orange.
caseRun({
  name: 'swap --primary-foreground to white',
  file: tokensFile,
  expect: 'white on orange',
  mutate: (css) =>
    css.replace('  --primary-foreground: var(--brand-fg);', '  --primary-foreground: #ffffff;'),
})

// 4b. Rule 4 — a measured text pair drops below AA.
caseRun({
  name: 'lighten --muted-ink until muted text fails 4.5:1',
  file: tokensFile,
  expect: 'is under 4.5:1',
  mutate: (css) => css.replace('  --muted-ink: #5c6470;', '  --muted-ink: #8a939f;'),
})

// 4c. Rule 4 — the interaction boundary drops below the 3:1 non-text bar.
caseRun({
  name: 'lighten --line-strong below the 3:1 boundary bar',
  file: tokensFile,
  expect: 'is under 3:1',
  mutate: (css) => css.replace('  --line-strong: #7c8794;', '  --line-strong: #c9cdd3;'),
})

// 5. Rule 5 — a second date-fns version enters the lockfile.
caseRun({
  name: 'pin a second date-fns version in bun.lock',
  file: lockFile,
  expect: 'date-fns resolves to 2 versions',
  mutate: (lock) =>
    lock.replace(
      '    "date-fns": ["date-fns@4.4.0"',
      '    "date-fns@3.6.0": ["date-fns@3.6.0", "", {}, "sha512-duplicate"],\n    "date-fns": ["date-fns@4.4.0"',
    ),
})

// The tree must be exactly as it was.
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((line) => /(?:tokens\.css|styles\.css|index\.css|bun\.lock)$/.test(line.trim()))
check(dirty.length === 0, 'every mutation was restored', dirty.join(' | '))

console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} failure(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`${checks}/${checks} checks passed — the gate fails for every reason it claims`)
