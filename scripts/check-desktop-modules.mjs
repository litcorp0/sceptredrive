#!/usr/bin/env node
/**
 * The desktop counterpart of `modules:check`: every counter screen lives in a module, and every
 * hash route resolves to a module page.
 *
 * The shape and boundary rules are shared with the admin through `scripts/lib/module-rules.mjs`.
 * What differs is the router: the POS has no TanStack Router — `lib/router.ts` parses
 * `window.location.hash` and `routes/_pos/app.tsx` keeps the guard ladder — so a thin route here
 * is a file that is short, imports one module barrel, and renders nothing of its own.
 *
 * Progress and strict behave exactly as in the admin gate: the fourteen modules start pending and
 * each plan deletes its own entry. `--strict` fails while any remain, which is why CI runs this
 * one only from Plan 05, when the list is empty. A gate that is red for eight plans teaches
 * everyone to ignore it.
 *
 * Usage:
 *   bun run modules:check:pos
 *   bun run modules:check:pos:strict
 */
import path from 'node:path'
import { jsxTags, lineCount, runModuleCheck } from './lib/module-rules.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const RENDERER = path.join(ROOT, 'desktop', 'src', 'renderer')
const ROUTES = path.join(RENDERER, 'routes')
const MODULES = path.join(RENDERER, 'modules')

const STRICT = process.argv.includes('--strict')

/** D1's fourteen POS domains. `home` arrives in Plan 04/05; the rest in Plan 02. */
const REQUIRED_MODULES = [
  'auth',
  'cart',
  'catalog',
  'credit',
  'customers',
  'home',
  'loyalty',
  'receipt',
  'sales',
  'sell',
  'settings',
  'shift',
  'sync',
  'tender',
]

/** Names still to migrate. Each plan deletes its own entry. */
const PENDING_MODULES = ['home']

/** Route files that legitimately keep their body. */
const ROUTE_EXEMPTIONS = {
  '_pos/app.tsx': 'the POS shell: the five route guards are behaviour, not markup',
  '_pos/dev-charts.tsx': 'Phase 7 chart gallery, retired in Plan 05',
  '_pos/dev-sync.tsx': 'sync diagnostics, not a counter screen',
  '_pos/dev-print.tsx': 'printer diagnostics, gated behind POS_DIAGNOSTICS',
}

const MAX_ROUTE_LINES = 25

/**
 * A desktop route is thin when it is short, imports exactly one module barrel, and renders
 * nothing but its page component. The POS's routes are hash entries, so there is no
 * `createFileRoute` call to look for.
 */
function desktopRouteRule(source, file, { maxRouteLines, forbiddenTokens, alias }) {
  const hard = []
  const progress = []
  const rel = path.relative(ROOT, file)
  const lines = lineCount(source)
  const barrel = new RegExp(`from\\s+["']${alias}modules/`).test(source)

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
    const page = /^[A-Z][\w]*$/.test(tag) && (tag.endsWith('Page') || tag === 'Outlet')
    if (!page) hard.push(`${rel}: renders <${tag}> — a route may only render its page component`)
  }

  return { hard, progress }
}

runModuleCheck({
  label: 'modules:check:pos',
  root: ROOT,
  srcDir: RENDERER,
  modulesDir: MODULES,
  modulesDisplay: 'desktop/src/renderer/modules',
  routesDir: ROUTES,
  requiredModules: REQUIRED_MODULES,
  pendingModules: PENDING_MODULES,
  alias: '@/',
  routeExemptions: ROUTE_EXEMPTIONS,
  maxRouteLines: MAX_ROUTE_LINES,
  routeRule: desktopRouteRule,
  contextNote: "Phase 10's context (D1)",
  strict: STRICT,
})
