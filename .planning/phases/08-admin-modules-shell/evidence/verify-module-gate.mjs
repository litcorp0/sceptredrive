#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
/**
 * Phase 8 Plan 01, Task 5 — prove `bun run modules:check` can fail.
 *
 * A gate that has never been seen to fail is a comment. This script mutates the tree eleven ways
 * (and the gate's own configuration three ways), asserts the gate rejects each, then restores
 * every file byte-for-byte and asserts the gate is green again.
 *
 * The shape probes use `analytics` — the module Phase 8 deliberately defers to Phase 9 — so no
 * temporary module has to be invented and no legitimate module is disturbed.
 *
 * Usage: node .planning/phases/08-admin-modules-shell/evidence/verify-module-gate.mjs
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..')
const ADMIN = path.join(ROOT, 'admin', 'src')
const MODULES = path.join(ADMIN, 'modules')
const ROUTES = path.join(ADMIN, 'routes', '_authenticated')
const GATE = path.join(ROOT, 'scripts', 'check-modules.mjs')
const PROBE_MODULE = path.join(MODULES, 'analytics')
const PROBE_ROUTE = path.join(ROUTES, 'gate-probe.tsx')

let checks = 0
const failures = []

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

function hash(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** Run the gate; return exit code and combined output. */
function runGate(strict = false) {
  try {
    const out = execFileSync('node', [GATE, ...(strict ? ['--strict'] : [])], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

/** Snapshot a path (file or tree) so it can be restored exactly. */
function snapshot(target) {
  if (!fs.existsSync(target)) return { target, existed: false }
  const stat = fs.statSync(target)
  if (stat.isDirectory()) {
    return {
      target,
      existed: true,
      dir: true,
      files: fs.readdirSync(target, { recursive: true }).map((rel) => {
        const full = path.join(target, rel)
        return fs.statSync(full).isDirectory()
          ? { rel, dir: true }
          : { rel, data: fs.readFileSync(full), mode: fs.statSync(full).mode }
      }),
    }
  }
  return { target, existed: true, data: fs.readFileSync(target), mode: stat.mode }
}

function restore(snap) {
  if (!snap.existed) {
    fs.rmSync(snap.target, { recursive: true, force: true })
    return
  }
  if (snap.dir) {
    fs.rmSync(snap.target, { recursive: true, force: true })
    fs.mkdirSync(snap.target, { recursive: true })
    for (const entry of snap.files) {
      const full = path.join(snap.target, entry.rel)
      if (entry.dir) fs.mkdirSync(full, { recursive: true })
      else {
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, entry.data)
        fs.chmodSync(full, entry.mode)
      }
    }
    return
  }
  fs.writeFileSync(snap.target, snap.data)
  fs.chmodSync(snap.target, snap.mode)
}

// ---------------------------------------------------------------- baseline
console.log('\n-- baseline --')
const gateSource = fs.readFileSync(GATE, 'utf8')
const gateHash = hash(GATE)

const clean = runGate()
check(clean.code === 0, 'the gate passes on the unmodified tree', `exit ${clean.code}`)
const strictBaseline = runGate(true)
check(
  strictBaseline.code !== 0 || !strictBaseline.out.includes('In progress'),
  'strict mode is allowed to fail while Phase 8 is mid-flight (it is the CI target)',
)

if (failures.length > 0) {
  console.error('\nBaseline is not green — fix the tree before running the mutation proof.')
  process.exit(1)
}

// ---------------------------------------------------------------- mutations
console.log('\n-- mutations --')

// 1. A thin route that renders markup.
{
  const snap = snapshot(PROBE_ROUTE)
  fs.mkdirSync(path.dirname(PROBE_ROUTE), { recursive: true })
  fs.writeFileSync(
    PROBE_ROUTE,
    `import { createFileRoute } from "@tanstack/react-router"\nimport { AnalyticsPage } from "#/modules/analytics"\n\nexport const Route = createFileRoute("/_authenticated/gate-probe")({\n\tcomponent: () => <div>not a page</div>,\n})\n`,
  )
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('renders <div>'),
    'mutation 1: a route rendering markup is rejected',
  )
  restore(snap)
}

// 2. A thin route over the line budget.
{
  const snap = snapshot(PROBE_ROUTE)
  const padding = Array.from({ length: 30 }, (_, i) => `// padding ${i}`).join('\n')
  fs.writeFileSync(
    PROBE_ROUTE,
    `import { createFileRoute } from "@tanstack/react-router"\nimport { AnalyticsPage } from "#/modules/analytics"\n${padding}\n\nexport const Route = createFileRoute("/_authenticated/gate-probe")({\n\tcomponent: AnalyticsPage,\n})\n`,
  )
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('must be at most'),
    'mutation 2: a route over the line budget is rejected',
  )
  restore(snap)
}

// 3. A module without a barrel.
{
  const snap = snapshot(PROBE_MODULE)
  fs.rmSync(PROBE_MODULE, { recursive: true, force: true })
  fs.mkdirSync(path.join(PROBE_MODULE, 'pages'), { recursive: true })
  fs.writeFileSync(path.join(PROBE_MODULE, 'pages', 'x.tsx'), 'export const X = 1\n')
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('missing index.ts'),
    'mutation 3: a module without index.ts is rejected',
  )
  restore(snap)
}

// 4. A folder that is not one of the seven.
{
  const snap = snapshot(PROBE_MODULE)
  fs.rmSync(PROBE_MODULE, { recursive: true, force: true })
  fs.mkdirSync(path.join(PROBE_MODULE, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(PROBE_MODULE, 'index.ts'), 'export {}\n')
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('is not one of the seven module folders'),
    'mutation 4: a stray folder inside a module is rejected',
  )
  restore(snap)
}

// 5. A deep import into a module from outside.
{
  const probe = path.join(ADMIN, 'gate-probe-consumer.ts')
  const snap = snapshot(probe)
  fs.writeFileSync(
    probe,
    'import { y } from "#/modules/analytics/components/y"\nexport const use = y\n',
  )
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('deep import into modules/analytics'),
    'mutation 5: a deep cross-module import is rejected',
  )
  restore(snap)
}

// 6. A module importing itself through the alias.
{
  const snap = snapshot(PROBE_MODULE)
  fs.rmSync(PROBE_MODULE, { recursive: true, force: true })
  fs.mkdirSync(path.join(PROBE_MODULE, 'components'), { recursive: true })
  fs.writeFileSync(path.join(PROBE_MODULE, 'components', 'y.tsx'), 'export const Y = 1\n')
  fs.writeFileSync(path.join(PROBE_MODULE, 'index.ts'), 'export { Y } from "./components/y"\n')
  fs.writeFileSync(
    path.join(PROBE_MODULE, 'pages.tsx'),
    'import { Y } from "#/modules/analytics/components/y"\nexport const P = Y\n',
  )
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('imports its own module by alias'),
    'mutation 6: a module deep-importing itself by alias is rejected',
  )
  restore(snap)
}

// 7. A file at the module root that is not the barrel.
{
  const snap = snapshot(PROBE_MODULE)
  fs.rmSync(PROBE_MODULE, { recursive: true, force: true })
  fs.mkdirSync(PROBE_MODULE, { recursive: true })
  fs.writeFileSync(path.join(PROBE_MODULE, 'index.ts'), 'export {}\n')
  fs.writeFileSync(path.join(PROBE_MODULE, 'helpers.ts'), 'export const H = 1\n')
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('only index.ts may sit at the module root'),
    'mutation 7: a non-barrel file at the module root is rejected',
  )
  restore(snap)
}

// 8. A pending module marked migrated while absent (patches the gate's own list).
{
  const mutated = gateSource.replace(
    /const PENDING_MODULES = \[[\s\S]*?\]/,
    'const PENDING_MODULES = []',
  )
  fs.writeFileSync(GATE, mutated)
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('is no longer pending but'),
    'mutation 8: claiming a module is migrated before it exists is rejected',
  )
  fs.writeFileSync(GATE, gateSource)
}

// 9. A legacy component import for a domain that has already migrated.
{
  // Derived, not hard-coded, so the mutation stays valid through the whole phase. Candidates are
  // the folders the gate maps to exactly one module; that module is claimed as migrated below, so
  // the only violation left is the legacy import itself.
  const pendingAt = gateSource.indexOf('const PENDING_MODULES')
  const pendingBlock = gateSource.slice(pendingAt)
  const isPending = (name) => new RegExp(`\\n\\s+['"]${name}['"],`).test(pendingBlock)
  const candidates = ['inventory', 'payables', 'suppliers']
  const target = candidates.find(isPending) ?? candidates[0]

  const moduleSnap = snapshot(path.join(MODULES, target))
  fs.mkdirSync(path.join(MODULES, target), { recursive: true })
  fs.writeFileSync(path.join(MODULES, target, 'index.ts'), 'export const ProbePage = () => null\n')

  let mutated = gateSource
  if (isPending(target)) {
    const entry = new RegExp(`\\n\\s+['"]${target}['"],`)
    mutated = gateSource.slice(0, pendingAt) + pendingBlock.replace(entry, '')
    if (mutated === gateSource) throw new Error('mutation 9 could not claim a module as migrated')
  }
  fs.writeFileSync(GATE, mutated)

  // Create the legacy folder whether or not it still exists, so the import resolves and the only
  // violation is the import statement.
  const legacyFolder = path.join(ADMIN, 'components', target)
  const folderSnap = snapshot(legacyFolder)
  fs.mkdirSync(legacyFolder, { recursive: true })
  fs.writeFileSync(path.join(legacyFolder, 'probe-legacy.tsx'), 'export const ProbeLegacy = 1\n')

  const probe = path.join(ADMIN, 'gate-probe-legacy.ts')
  const snap = snapshot(probe)
  fs.writeFileSync(
    probe,
    `import { ProbeLegacy } from "#/components/${target}/probe-legacy"\nexport const use = ProbeLegacy\n`,
  )
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('that domain has migrated'),
    'mutation 9: a legacy component import after migration is rejected',
  )
  restore(snap)
  restore(folderSnap)
  restore(moduleSnap)
  fs.writeFileSync(GATE, gateSource)
}

// 10. A duplicated entry in the pending list.
{
  const at = gateSource.indexOf('const PENDING_MODULES')
  const block = gateSource.slice(at)
  const first = /\n(\s+)['"]([a-z]+)['"],/.exec(block)
  if (!first) throw new Error('mutation 10 could not read the pending list')
  const mutated =
    gateSource.slice(0, at) + block.replace(first[0], `${first[0]}\n${first[1]}'${first[2]}',`)
  if (mutated === gateSource) throw new Error('mutation 10 could not duplicate an entry')
  fs.writeFileSync(GATE, mutated)
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('contains a duplicate'),
    'mutation 10: a duplicated pending entry is rejected',
  )
  fs.writeFileSync(GATE, gateSource)
}

// 11. A route importing two barrels.
{
  const snap = snapshot(PROBE_ROUTE)
  fs.writeFileSync(
    PROBE_ROUTE,
    `import { createFileRoute } from "@tanstack/react-router"\nimport { AnalyticsPage } from "#/modules/analytics"\nimport { AuditPage } from "#/modules/audit"\n\nexport const Route = createFileRoute("/_authenticated/gate-probe")({\n\tcomponent: AnalyticsPage,\n})\n`,
  )
  const r = runGate()
  check(
    r.code !== 0 && r.out.includes('expected 1 "#/modules/<name>" imports, found 2'),
    'mutation 11: a route importing two barrels is rejected',
  )
  restore(snap)
}

// 12. Strict mode rejects remaining progress (the CI guarantee).
{
  const snap = snapshot(PROBE_ROUTE)
  fs.writeFileSync(
    PROBE_ROUTE,
    `import { createFileRoute } from "@tanstack/react-router"\nimport { AnalyticsPage } from "#/modules/analytics"\n\nexport const Route = createFileRoute("/_authenticated/gate-probe")({\n\tcomponent: AnalyticsPage,\n})\n`,
  )
  const r = runGate(true)
  const strictFails =
    r.code !== 0 && (r.out.includes('Strict mode:') || r.out.includes('is no longer pending'))
  check(strictFails, 'mutation 12: strict mode rejects a tree with Phase 8 targets remaining')
  restore(snap)
}

// ---------------------------------------------------------------- restoration
console.log('\n-- restoration --')
check(hash(GATE) === gateHash, "the gate's own source is byte-identical to before the run")

// A `vite dev` server may regenerate routeTree.gen.ts when a probe route appears, so assert the
// file is unchanged *relative to git*, allowing a moment for the watcher to settle.
function routeTreeDirty() {
  return execFileSync('git', ['status', '--porcelain', '--', 'admin/src/routeTree.gen.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim()
}

let routeTreeAfter = routeTreeDirty()
for (let attempt = 0; attempt < 20 && routeTreeAfter !== ''; attempt += 1) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  routeTreeAfter = routeTreeDirty()
}
check(routeTreeAfter === '', 'routeTree.gen.ts is unchanged relative to git', routeTreeAfter)
check(!fs.existsSync(PROBE_ROUTE), 'the probe route is gone')
check(!fs.existsSync(path.join(ADMIN, 'gate-probe-consumer.ts')), 'the probe consumer is gone')
check(!fs.existsSync(path.join(ADMIN, 'gate-probe-legacy.ts')), 'the legacy probe is gone')

const final = runGate()
check(final.code === 0, 'the gate passes again on the restored tree', `exit ${final.code}`)

// ---------------------------------------------------------------- result
console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
