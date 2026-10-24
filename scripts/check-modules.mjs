#!/usr/bin/env node
/**
 * The machine version of Phase 8's goal: every admin screen lives in a module and the route file
 * only routes.
 *
 * Two kinds of check:
 *
 *   Hard   — a rule that is already true wherever it applies. A module that exists must have the
 *            right shape; nothing may reach into a module's internals; a route that already
 *            imports a barrel must be thin. These fail the run in every mode.
 *
 *   Progress — a number Phase 8 is driving to zero: unmigrated modules, routes that still hold
 *            markup, files still importing `#/lib/api-types`, the `api` object's remaining domain
 *            groups. These are reported always and fail only under `--strict`, which is what CI
 *            runs. Without that split the gate would be red for the whole phase and a real
 *            regression would hide in the noise.
 *
 * Usage:
 *   bun run modules:check           # report progress, fail on hard violations
 *   bun run modules:check:strict    # also fail while any progress target remains (CI)
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const ADMIN_SRC = path.join(ROOT, 'admin', 'src')
const ROUTES = path.join(ADMIN_SRC, 'routes')
const MODULES = path.join(ADMIN_SRC, 'modules')
const API_FILE = path.join(ADMIN_SRC, 'lib', 'api.ts')

const STRICT = process.argv.includes('--strict')

/** The fourteen modules this phase migrates (D1's fifteen minus `analytics`). */
const REQUIRED_MODULES = [
  'auth',
  'audit',
  'branches',
  'catalog',
  'credit',
  'customers',
  'dashboard',
  'inventory',
  'loyalty',
  'payables',
  'settings',
  'staff',
  'suppliers',
  'terminals',
]

/**
 * Modules that exist as a name but are filled by a later phase. A deferred module, if the
 * directory exists at all, must be an empty barrel.
 */
const DEFERRED_MODULES = { analytics: 9 }

/**
 * Names still to migrate. Each plan deletes its own entry; `--strict` fails while any remain.
 * Keep this list free of duplicates and a subset of REQUIRED_MODULES — the gate checks that too.
 */
const PENDING_MODULES = []

/** Folders a module may contain, plus its barrel. */
const ALLOWED_ENTRIES = new Set([
  'api',
  'components',
  'hooks',
  'pages',
  'types',
  'ui',
  'utils',
  'index.ts',
])

/** Folders that stay global, so importing them is not a cross-module import. */
const GLOBAL_COMPONENTS = new Set(['ui', 'common', 'layout'])

/**
 * A legacy `components/<folder>/` import is allowed only while the module that owns it is still
 * pending. `components/customers/` held customer, credit and loyalty files before Phase 8, so it
 * maps to three modules.
 */
const COMPONENT_FOLDERS = {
  auth: ['auth'],
  catalog: ['catalog'],
  customers: ['customers', 'credit', 'loyalty'],
  inventory: ['inventory'],
  payables: ['payables'],
  staff: ['staff'],
  suppliers: ['suppliers'],
}

/** Route files that legitimately keep their body. */
const ROUTE_EXEMPTIONS = {
  '__root.tsx': 'root shell: providers, error boundary and devtools',
  'dev-charts.tsx': 'Phase 7 chart gallery, deleted in Phase 9',
  '_authenticated/route.tsx':
    'the authenticated shell layout: it mounts the branch provider and the app shell, which are global infrastructure rather than a domain page',
}

const MAX_ROUTE_LINES = 25

/** A route body must contain none of these — they all belong to a module page. */
const FORBIDDEN_TOKENS = [
  'useQuery(',
  'useMutation(',
  'useQueryClient(',
  'apiRequest(',
  'api.',
  'toast.',
  'fetch(',
]

const hard = []
const progress = []

function rel(file) {
  return path.relative(ROOT, file)
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

/** Every `from "#/..."` / `import("#/...")` specifier in a file. */
function specifiers(source) {
  const found = []
  const re = /(?:from\s+|import\(\s*)["'](#\/[^"']+)["']/g
  for (let m = re.exec(source); m !== null; m = re.exec(source)) found.push(m[1])
  return found
}

/** JSX element names in a file, lower-case ones included. */
function jsxTags(source) {
  const tags = new Set()
  const re = /<\/?([A-Za-z][\w.]*)/g
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    // Ignore generics and comparisons: only count a tag when it closes or is self-closing.
    const rest = source.slice(m.index, m.index + 200)
    if (/^<\/?[A-Za-z][\w.]*(\s[^<>]*)?\/?>/.test(rest)) tags.add(m[1])
  }
  return [...tags]
}

// ---------------------------------------------------------------- consistency of the lists

for (const name of PENDING_MODULES) {
  if (!REQUIRED_MODULES.includes(name))
    hard.push(`PENDING_MODULES names "${name}", which is not in REQUIRED_MODULES`)
}
if (new Set(PENDING_MODULES).size !== PENDING_MODULES.length)
  hard.push('PENDING_MODULES contains a duplicate')
for (const name of Object.keys(DEFERRED_MODULES)) {
  if (REQUIRED_MODULES.includes(name)) hard.push(`"${name}" is both required and deferred`)
}

const migrated = REQUIRED_MODULES.filter((name) => !PENDING_MODULES.includes(name))

// A pending module is outstanding work in its own right, so strict mode cannot go green while the
// list is non-empty even if no route or import happens to be violating.
for (const name of PENDING_MODULES) progress.push(`module not migrated: ${name}`)

// ---------------------------------------------------------------- modules: shape and boundaries

const moduleDirs = fs.existsSync(MODULES)
  ? fs
      .readdirSync(MODULES, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  : []

for (const name of moduleDirs) {
  if (!REQUIRED_MODULES.includes(name) && !(name in DEFERRED_MODULES)) {
    hard.push(`admin/src/modules/${name}: not a module named by Phase 8's context (D1)`)
    continue
  }
  const dir = path.join(MODULES, name)
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const isFolder = entry.isDirectory()
    if (isFolder && !ALLOWED_ENTRIES.has(entry.name)) {
      hard.push(
        `admin/src/modules/${name}/${entry.name}: "${entry.name}" is not one of the seven module folders`,
      )
    }
    if (!isFolder && entry.name !== 'index.ts') {
      hard.push(`admin/src/modules/${name}/${entry.name}: only index.ts may sit at the module root`)
    }
  }
  if (!fs.existsSync(path.join(dir, 'index.ts'))) {
    hard.push(`admin/src/modules/${name}: missing index.ts (the barrel is the only entry point)`)
  }
}

for (const name of REQUIRED_MODULES) {
  if (migrated.includes(name) && !moduleDirs.includes(name)) {
    hard.push(`"${name}" is no longer pending but admin/src/modules/${name} does not exist`)
  }
}

const adminFiles = walk(ADMIN_SRC)

/** Actual folders under `components/` — a root-level component file (e.g. theme-provider) is not one. */
const componentFolders = new Set(
  fs.existsSync(path.join(ADMIN_SRC, 'components'))
    ? fs
        .readdirSync(path.join(ADMIN_SRC, 'components'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [],
)

for (const file of adminFiles) {
  if (!/\.(ts|tsx)$/.test(file)) continue
  const source = read(file)
  const specs = specifiers(source)
  const owner = path.relative(MODULES, file).split(path.sep)[0]
  const inModule = file.startsWith(MODULES + path.sep)

  for (const spec of specs) {
    // A module may not deep-import itself through the alias — relative imports are the rule.
    if (inModule && spec.startsWith(`#/modules/${owner}/`)) {
      hard.push(`${rel(file)}: imports its own module by alias ("${spec}"); use a relative import`)
    }
    // Deep imports into any module from anywhere.
    const deep = /^#\/modules\/([^/]+)\/(.+)$/.exec(spec)
    if (deep) {
      hard.push(
        `${rel(file)}: deep import into modules/${deep[1]} ("${spec}"); import "#/modules/${deep[1]}" instead`,
      )
    }
    // Legacy domain component folders. A root-level file such as theme-provider is infrastructure.
    const legacy = /^#\/components\/([^/]+)(?:\/|$)/.exec(spec)
    if (legacy && !GLOBAL_COMPONENTS.has(legacy[1]) && componentFolders.has(legacy[1])) {
      const owners = COMPONENT_FOLDERS[legacy[1]]
      if (!owners) {
        hard.push(
          `${rel(file)}: imports "#/components/${legacy[1]}", which is neither global nor a Phase 8 domain`,
        )
      } else if (owners.every((owner) => migrated.includes(owner))) {
        hard.push(
          `${rel(file)}: imports "${spec}" — that domain has migrated; use #/modules/${owners[0]}`,
        )
      } else {
        progress.push(`legacy component import ${rel(file)} → ${spec}`)
      }
    }
  }
}

// ---------------------------------------------------------------- routes

const routeFiles = walk(ROUTES).filter((file) => file.endsWith('.tsx'))

for (const file of routeFiles) {
  const key = path.relative(ROUTES, file).split(path.sep).join('/')
  if (key in ROUTE_EXEMPTIONS) continue

  const source = read(file)
  const lines = source.split('\n').length - (source.endsWith('\n') ? 1 : 0)
  const barrel = /from\s+["']#\/modules\//.test(source)

  if (!source.includes('createFileRoute(')) {
    hard.push(`${rel(file)}: not a route — no createFileRoute( call`)
    continue
  }

  // Two shapes are legitimately complete without importing a barrel, because they render nothing
  // of their own: a pure redirect (`beforeLoad` throws and there is no component) and a bare
  // `<Outlet />` pass-through for a parent segment.
  const passThrough = /component:\s*\(\)\s*=>\s*<Outlet\s*\/>/.test(source)
  const redirectOnly = !source.includes('component:') && source.includes('redirect(')

  if (passThrough || redirectOnly) {
    if (lines > MAX_ROUTE_LINES) {
      hard.push(
        `${rel(file)}: ${lines} lines — a ${passThrough ? 'pass-through' : 'redirect'} route must be at most ${MAX_ROUTE_LINES}`,
      )
    }
    for (const token of FORBIDDEN_TOKENS) {
      if (source.includes(token))
        hard.push(`${rel(file)}: contains "${token}" — that belongs to a module page`)
    }
    continue
  }

  // "Migrated" is decided by the body, not by the presence of an import. A page can start
  // consuming a module barrel while its own body still belongs to a later plan (the customer
  // detail route does exactly that), and that must read as outstanding work rather than a
  // violation.
  if (lines > MAX_ROUTE_LINES) {
    progress.push(`route not migrated: ${rel(file)} (${lines} lines)`)
    continue
  }

  if (!barrel) {
    progress.push(`route not migrated: ${rel(file)} (${lines} lines, no module import)`)
    continue
  }
  const barrelCount = [...source.matchAll(/from\s+["']#\/modules\//g)].length
  if (barrelCount !== 1) {
    hard.push(`${rel(file)}: expected 1 "#/modules/<name>" imports, found ${barrelCount}`)
  }
  for (const token of FORBIDDEN_TOKENS) {
    if (source.includes(token))
      hard.push(`${rel(file)}: contains "${token}" — that belongs to a module page`)
  }
  for (const tag of jsxTags(source)) {
    const page =
      /^[A-Z][\w]*$/.test(tag) &&
      (tag.endsWith('Page') || tag.endsWith('Layout') || tag === 'Outlet')
    if (!page)
      hard.push(`${rel(file)}: renders <${tag}> — a route may only render its page component`)
  }
}

// ---------------------------------------------------------------- progress targets

const apiTypesImporters = adminFiles
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .filter((file) => specifiers(read(file)).some((spec) => spec === '#/lib/api-types'))

if (apiTypesImporters.length > 0) {
  progress.push(`#/lib/api-types still imported by ${apiTypesImporters.length} files`)
}

let apiGroups = []
if (fs.existsSync(API_FILE)) {
  apiGroups = [...read(API_FILE).matchAll(/^\t([a-zA-Z]+):\s*\{\s*$/gm)].map((m) => m[1])
  if (apiGroups.length > 0) {
    progress.push(
      `lib/api.ts still owns ${apiGroups.length} domain groups: ${apiGroups.join(', ')}`,
    )
  }
}

// ---------------------------------------------------------------- report

const pad = (value, width) => String(value).padEnd(width)

console.log('\nModules')
console.log(`  ${pad('module', 12)}${pad('folders', 10)}status`)
for (const name of REQUIRED_MODULES) {
  const dir = path.join(MODULES, name)
  const exists = fs.existsSync(dir)
  const folders = exists
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : []
  const status = migrated.includes(name) ? 'migrated' : 'pending'
  console.log(`  ${pad(name, 12)}${pad(folders.length || '—', 10)}${status}`)
}
for (const [name, phase] of Object.entries(DEFERRED_MODULES)) {
  console.log(`  ${pad(name, 12)}${pad('—', 10)}deferred to Phase ${phase}`)
}

if (progress.length > 0) {
  console.log(`\nIn progress (${progress.length})`)
  for (const line of progress) console.log(`  · ${line}`)
}

if (hard.length > 0) {
  console.error(`\nViolations (${hard.length})`)
  for (const line of hard) console.error(`  ✗ ${line}`)
  console.error('\nmodules:check failed.')
  process.exit(1)
}

if (STRICT && progress.length > 0) {
  console.error(`\nStrict mode: ${progress.length} Phase 8 target(s) remain.`)
  process.exit(1)
}

console.log(
  `\nmodules:check OK — ${migrated.length}/${REQUIRED_MODULES.length} modules migrated` +
    (STRICT ? '' : ', progress reported above (strict fails on it)'),
)
