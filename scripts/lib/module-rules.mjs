/**
 * The module-architecture rules, shared by every client that has domain modules.
 *
 * Phase 8 wrote these rules for the admin console. Phase 10 needed the same rules for the desktop
 * POS, and two copies of a gate drift — so the parts that are genuinely the same concept live
 * here, and each client supplies the parts that are genuinely its own:
 *
 *   shared   list consistency, module shape, the barrel rule, deep-import detection,
 *            the report, and the exit codes;
 *   caller   which modules are required/pending/deferred, what a thin route looks like in that
 *            router, and any client-specific progress target.
 *
 * `scripts/check-modules.mjs` (admin) and `scripts/check-desktop-modules.mjs` (POS) are the two
 * callers. Neither may relax a rule by config: the shape rules are not optional.
 *
 * The Phase 8 mutation proof (`phases/08-admin-modules-shell/evidence/verify-module-gate.mjs`)
 * rewrites the *caller's* `REQUIRED_MODULES` and `PENDING_MODULES` literals and asserts specific
 * message text, so both callers keep those literals at their top level and every message string
 * below is load-bearing.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Folders a module may contain, plus its barrel. */
export const DEFAULT_ALLOWED_ENTRIES = new Set([
  'api',
  'components',
  'hooks',
  'pages',
  'types',
  'ui',
  'utils',
  'index.ts',
])

/** A route body must contain none of these — they all belong to a module page. */
export const DEFAULT_FORBIDDEN_TOKENS = [
  'useQuery(',
  'useMutation(',
  'useQueryClient(',
  'apiRequest(',
  'api.',
  'toast.',
  'fetch(',
]

// ---------------------------------------------------------------- file helpers

export function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

export function read(file) {
  return fs.readFileSync(file, 'utf8')
}

/** Every `from "<alias>..."` / `import("<alias>...")` specifier in a file. */
export function specifiers(source, alias) {
  const found = []
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:from\\s+|import\\(\\s*)["'](${escaped}[^"']+)["']`, 'g')
  for (let m = re.exec(source); m !== null; m = re.exec(source)) found.push(m[1])
  return found
}

/** JSX element names in a file, lower-case ones included. */
export function jsxTags(source) {
  const tags = new Set()
  const re = /<\/?([A-Za-z][\w.]*)/g
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    // Ignore generics and comparisons: only count a tag when it closes or is self-closing.
    const rest = source.slice(m.index, m.index + 200)
    if (/^<\/?[A-Za-z][\w.]*(\s[^<>]*)?\/?>/.test(rest)) tags.add(m[1])
  }
  return [...tags]
}

export function lineCount(source) {
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0)
}

// ---------------------------------------------------------------- the checker

/**
 * Run one client's module gate.
 *
 * Returns `{ hard, progress }` and exits the process on failure, so a caller can be a few lines.
 * `strict` turns remaining progress into a failure — that is what CI runs once a phase is over.
 */
export function runModuleCheck(config) {
  const {
    label = 'modules:check',
    root,
    srcDir,
    modulesDir,
    modulesDisplay,
    routesDir,
    requiredModules,
    pendingModules,
    deferredModules = {},
    allowedEntries = DEFAULT_ALLOWED_ENTRIES,
    alias,
    routeExemptions = {},
    maxRouteLines = 25,
    forbiddenTokens = DEFAULT_FORBIDDEN_TOKENS,
    contextNote = "the phase's context",
    /** `(source, file) => ({ hard, progress })` — required: thinness is router-specific. */
    routeRule,
    /** `(spec, context) => null | { severity: 'hard'|'progress', message }` — optional. */
    importRule,
    /** `(context) => ({ hard, progress })` — optional client-specific targets. */
    extraChecks,
    strict = false,
  } = config

  for (const required of [
    'root',
    'srcDir',
    'modulesDir',
    'modulesDisplay',
    'routesDir',
    'requiredModules',
    'pendingModules',
    'alias',
    'routeRule',
  ]) {
    if (!config[required]) throw new Error(`runModuleCheck: "${required}" is required`)
  }

  const rel = (file) => path.relative(root, file)
  const hard = []
  const progress = []

  // -------------------------------------------------------------- list consistency

  for (const name of pendingModules) {
    if (!requiredModules.includes(name))
      hard.push(`PENDING_MODULES names "${name}", which is not in REQUIRED_MODULES`)
  }
  if (new Set(pendingModules).size !== pendingModules.length)
    hard.push('PENDING_MODULES contains a duplicate')
  for (const name of Object.keys(deferredModules)) {
    if (requiredModules.includes(name)) hard.push(`"${name}" is both required and deferred`)
  }

  const migrated = requiredModules.filter((name) => !pendingModules.includes(name))

  // A pending module is outstanding work in its own right, so strict mode cannot go green while the
  // list is non-empty even if no route or import happens to be violating.
  for (const name of pendingModules) progress.push(`module not migrated: ${name}`)

  // -------------------------------------------------------------- module shape

  const moduleDirs = fs.existsSync(modulesDir)
    ? fs
        .readdirSync(modulesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : []

  for (const name of moduleDirs) {
    if (!requiredModules.includes(name) && !(name in deferredModules)) {
      hard.push(`${modulesDisplay}/${name}: not a module named by ${contextNote}`)
      continue
    }
    const dir = path.join(modulesDir, name)
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const isFolder = entry.isDirectory()
      if (isFolder && !allowedEntries.has(entry.name)) {
        hard.push(
          `${modulesDisplay}/${name}/${entry.name}: "${entry.name}" is not one of the seven module folders`,
        )
      }
      if (!isFolder && entry.name !== 'index.ts') {
        hard.push(
          `${modulesDisplay}/${name}/${entry.name}: only index.ts may sit at the module root`,
        )
      }
    }
    if (!fs.existsSync(path.join(dir, 'index.ts'))) {
      hard.push(`${modulesDisplay}/${name}: missing index.ts (the barrel is the only entry point)`)
    }
  }

  for (const name of requiredModules) {
    if (migrated.includes(name) && !moduleDirs.includes(name)) {
      hard.push(`"${name}" is no longer pending but ${modulesDisplay}/${name} does not exist`)
    }
  }

  // -------------------------------------------------------------- imports

  const srcFiles = walk(srcDir).filter((file) => /\.(ts|tsx)$/.test(file))

  for (const file of srcFiles) {
    const source = read(file)
    const specs = specifiers(source, alias)
    const inModule = file.startsWith(modulesDir + path.sep)
    const owner = inModule ? path.relative(modulesDir, file).split(path.sep)[0] : null

    for (const spec of specs) {
      // A module may not deep-import itself through the alias — relative imports are the rule.
      if (inModule && spec.startsWith(`${alias}modules/${owner}/`)) {
        hard.push(
          `${rel(file)}: imports its own module by alias ("${spec}"); use a relative import`,
        )
      }
      // Deep imports into any module from anywhere.
      const deep = new RegExp(
        `^${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}modules/([^/]+)/(.+)$`,
      ).exec(spec)
      if (deep) {
        hard.push(
          `${rel(file)}: deep import into modules/${deep[1]} ("${spec}"); import "${alias}modules/${deep[1]}" instead`,
        )
      }
      if (importRule) {
        const verdict = importRule(spec, { file, inModule, owner, migrated, srcDir, modulesDir })
        if (verdict?.severity === 'hard') hard.push(verdict.message)
        if (verdict?.severity === 'progress') progress.push(verdict.message)
      }
    }
  }

  // -------------------------------------------------------------- routes

  const routeFiles = walk(routesDir).filter((file) => file.endsWith('.tsx'))

  for (const file of routeFiles) {
    const key = path.relative(routesDir, file).split(path.sep).join('/')
    if (key in routeExemptions) continue
    const verdict = routeRule(read(file), file, { key, maxRouteLines, forbiddenTokens, alias })
    if (verdict) {
      for (const line of verdict.hard ?? []) hard.push(line)
      for (const line of verdict.progress ?? []) progress.push(line)
    }
  }

  // -------------------------------------------------------------- client-specific targets

  if (extraChecks) {
    const extra = extraChecks({
      hard: [...hard],
      progress: [...progress],
      requiredModules,
      pendingModules,
      migrated,
      srcDir,
      modulesDir,
      routesDir,
      srcFiles,
      rel,
      alias,
    })
    if (extra) {
      for (const line of extra.hard ?? []) hard.push(line)
      for (const line of extra.progress ?? []) progress.push(line)
    }
  }

  // -------------------------------------------------------------- report

  const pad = (value, width) => String(value).padEnd(width)

  console.log('\nModules')
  console.log(`  ${pad('module', 12)}${pad('folders', 10)}status`)
  for (const name of requiredModules) {
    const dir = path.join(modulesDir, name)
    const exists = fs.existsSync(dir)
    const folders = exists
      ? fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : []
    const status = migrated.includes(name) ? 'migrated' : 'pending'
    console.log(`  ${pad(name, 12)}${pad(folders.length || '—', 10)}${status}`)
  }
  for (const [name, phase] of Object.entries(deferredModules)) {
    console.log(`  ${pad(name, 12)}${pad('—', 10)}deferred to Phase ${phase}`)
  }

  if (progress.length > 0) {
    console.log(`\nIn progress (${progress.length})`)
    for (const line of progress) console.log(`  · ${line}`)
  }

  if (hard.length > 0) {
    console.error(`\nViolations (${hard.length})`)
    for (const line of hard) console.error(`  ✗ ${line}`)
    console.error(`\n${label} failed.`)
    process.exit(1)
  }

  if (strict && progress.length > 0) {
    console.error(`\nStrict mode: ${progress.length} target(s) remain.`)
    process.exit(1)
  }

  console.log(
    `\n${label} OK — ${migrated.length}/${requiredModules.length} modules migrated` +
      (strict || progress.length === 0 ? '' : ', progress reported above (strict fails on it)'),
  )

  return { hard, progress, migrated }
}
