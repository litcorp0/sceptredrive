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
 * The rule engine lives in `scripts/lib/module-rules.mjs` so the desktop POS uses the same shape
 * and boundary rules (Phase 10). This file owns the admin's configuration, its TanStack route
 * rule, and its two admin-only progress targets.
 *
 * Usage:
 *   bun run modules:check           # report progress, fail on hard violations
 *   bun run modules:check:strict    # also fail while any progress target remains (CI)
 */
import fs from 'node:fs'
import path from 'node:path'
import { jsxTags, lineCount, read, runModuleCheck, specifiers } from './lib/module-rules.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const ADMIN_SRC = path.join(ROOT, 'admin', 'src')
const ROUTES = path.join(ADMIN_SRC, 'routes')
const MODULES = path.join(ADMIN_SRC, 'modules')
const API_FILE = path.join(ADMIN_SRC, 'lib', 'api.ts')

const STRICT = process.argv.includes('--strict')

/** The fourteen modules this phase migrates (D1's fifteen minus `analytics`). */
const REQUIRED_MODULES = [
  'analytics',
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
const DEFERRED_MODULES = {}

/**
 * Names still to migrate. Each plan deletes its own entry; `--strict` fails while any remain.
 * Keep this list free of duplicates and a subset of REQUIRED_MODULES — the gate checks that too.
 */
const PENDING_MODULES = []

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
  '_authenticated/route.tsx':
    'the authenticated shell layout: it mounts the branch provider and the app shell, which are global infrastructure rather than a domain page',
}

const MAX_ROUTE_LINES = 25

/** Actual folders under `components/` — a root-level component file (e.g. theme-provider) is not one. */
const componentFolders = new Set(
  fs.existsSync(path.join(ADMIN_SRC, 'components'))
    ? fs
        .readdirSync(path.join(ADMIN_SRC, 'components'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [],
)

/**
 * A TanStack route is thin when it declares exactly one `createFileRoute`, imports exactly one
 * module barrel, and renders nothing but its page component. A pure redirect and a bare
 * `<Outlet />` pass-through are complete without a barrel because they render nothing of their own.
 */
function adminRouteRule(source, file, { maxRouteLines, forbiddenTokens, alias }) {
  const hard = []
  const progress = []
  const rel = path.relative(ROOT, file)
  const lines = lineCount(source)
  const barrel = new RegExp(`from\\s+["']${alias}modules/`).test(source)

  if (!source.includes('createFileRoute(')) {
    hard.push(`${rel}: not a route — no createFileRoute( call`)
    return { hard, progress }
  }

  const passThrough = /component:\s*\(\)\s*=>\s*<Outlet\s*\/>/.test(source)
  const redirectOnly = !source.includes('component:') && source.includes('redirect(')

  if (passThrough || redirectOnly) {
    if (lines > maxRouteLines) {
      hard.push(
        `${rel}: ${lines} lines — a ${passThrough ? 'pass-through' : 'redirect'} route must be at most ${maxRouteLines}`,
      )
    }
    for (const token of forbiddenTokens) {
      if (source.includes(token))
        hard.push(`${rel}: contains "${token}" — that belongs to a module page`)
    }
    return { hard, progress }
  }

  // "Migrated" is decided by the body, not by the presence of an import. A page can start
  // consuming a module barrel while its own body still belongs to a later plan (the customer
  // detail route does exactly that), and that must read as outstanding work rather than a
  // violation.
  if (lines > maxRouteLines) {
    progress.push(`route not migrated: ${rel} (${lines} lines)`)
    return { hard, progress }
  }

  if (!barrel) {
    progress.push(`route not migrated: ${rel} (${lines} lines, no module import)`)
    return { hard, progress }
  }
  const barrelCount = [...source.matchAll(new RegExp(`from\\s+["']${alias}modules/`, 'g'))].length
  if (barrelCount !== 1) {
    hard.push(`${rel}: expected 1 "${alias}modules/<name>" imports, found ${barrelCount}`)
  }
  for (const token of forbiddenTokens) {
    if (source.includes(token))
      hard.push(`${rel}: contains "${token}" — that belongs to a module page`)
  }
  for (const tag of jsxTags(source)) {
    const page =
      /^[A-Z][\w]*$/.test(tag) &&
      (tag.endsWith('Page') || tag.endsWith('Layout') || tag === 'Outlet')
    if (!page) hard.push(`${rel}: renders <${tag}> — a route may only render its page component`)
  }
  return { hard, progress }
}

/**
 * Legacy domain component folders. A root-level file such as theme-provider is infrastructure.
 * The folder only counts as legacy while some module that owns it is still pending.
 */
function adminImportRule(spec, { migrated }) {
  const legacy = /^#\/components\/([^/]+)(?:\/|$)/.exec(spec)
  if (!legacy || GLOBAL_COMPONENTS.has(legacy[1]) || !componentFolders.has(legacy[1])) return null
  const owners = COMPONENT_FOLDERS[legacy[1]]
  if (!owners) {
    return {
      severity: 'hard',
      message: `imports "${spec}", which is neither global nor a Phase 8 domain`,
    }
  }
  if (owners.every((owner) => migrated.includes(owner))) {
    return {
      severity: 'hard',
      message: `imports "${spec}" — that domain has migrated; use #/modules/${owners[0]}`,
    }
  }
  return { severity: 'progress', message: `legacy component import → ${spec}` }
}

runModuleCheck({
  label: 'modules:check',
  root: ROOT,
  srcDir: ADMIN_SRC,
  modulesDir: MODULES,
  modulesDisplay: 'admin/src/modules',
  routesDir: ROUTES,
  requiredModules: REQUIRED_MODULES,
  pendingModules: PENDING_MODULES,
  deferredModules: DEFERRED_MODULES,
  alias: '#/',
  routeExemptions: ROUTE_EXEMPTIONS,
  maxRouteLines: MAX_ROUTE_LINES,
  routeRule: adminRouteRule,
  importRule: adminImportRule,
  contextNote: "Phase 8's context (D1)",
  strict: STRICT,
  extraChecks: ({ srcFiles }) => {
    const hard = []
    const progress = []

    const apiTypesImporters = srcFiles.filter((file) =>
      specifiers(read(file), '#/').some((spec) => spec === '#/lib/api-types'),
    )

    if (apiTypesImporters.length > 0) {
      progress.push(`#/lib/api-types still imported by ${apiTypesImporters.length} files`)
    }

    if (fs.existsSync(API_FILE)) {
      const groups = [...read(API_FILE).matchAll(/^\t([a-zA-Z]+):\s*\{\s*$/gm)].map((m) => m[1])
      if (groups.length > 0) {
        progress.push(`lib/api.ts still owns ${groups.length} domain groups: ${groups.join(', ')}`)
      }
    }

    return { hard, progress }
  },
})
