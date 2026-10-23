#!/usr/bin/env node
/**
 * Prepares `desktop/` for the Forge toolchain.
 *
 * Why this exists: this repo installs with Bun's hoisted linker (see the root
 * `bunfig.toml`), so shared dependencies live in the repository root
 * `node_modules`. Electron Forge resolves `electron` from the *project*
 * directory and packages that directory's `node_modules`, so the desktop
 * workspace needs its own entry.
 *
 * Bun 1.3's self-contained workspace support (`workspaces.selfContained` /
 * `installConfig.hoistingLimits`) is not available in the pinned Bun release,
 * so instead of copying ~250 MB of Electron binaries we link the package in.
 * Electron Forge and @electron/packager resolve the real path through the
 * symlink, and `packagerConfig.ignore` keeps it out of the packaged app.
 *
 * Runtime dependencies that must not be bundled by Vite (native modules) are
 * materialised as real copies here, because Forge does not follow symlinks when
 * it copies `node_modules` into the package. See `desktop/README.md`.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const desktopDir = path.resolve(import.meta.dirname, '..')
const desktopNodeModules = path.join(desktopDir, 'node_modules')
const require = createRequire(path.join(desktopDir, 'package.json'))
const manifest = JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8'))

/** Native/runtime modules that Vite must not bundle and Forge must copy. */
const NATIVE_RUNTIME_DEPENDENCIES = new Set(['@node-rs/argon2', '@maxxuxx/node-printer'])

function resolvePackageDir(name) {
  try {
    return path.dirname(require.resolve(`${name}/package.json`, { paths: [desktopDir] }))
  } catch {
    // Packages with a restrictive `exports` map (e.g. @maxxuxx/node-printer) do
    // not expose ./package.json. Resolve the entry point and walk up to the
    // package root instead.
    const entry = require.resolve(name, { paths: [desktopDir] })
    let directory = path.dirname(entry)
    while (directory !== path.dirname(directory)) {
      const manifestPath = path.join(directory, 'package.json')
      if (existsSync(manifestPath)) {
        const candidate = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (candidate.name === name) return directory
      }
      directory = path.dirname(directory)
    }
    throw new Error(`Could not resolve the package directory for ${name}`)
  }
}

function ensureLinked(name) {
  const target = path.join(desktopNodeModules, name)
  if (existsSync(target) || isDanglingLink(target)) return
  mkdirSync(path.dirname(target), { recursive: true })
  symlinkSync(path.relative(path.dirname(target), resolvePackageDir(name)), target, 'dir')
}

function isDanglingLink(target) {
  try {
    return lstatSync(target).isSymbolicLink() && !existsSync(target)
  } catch {
    return false
  }
}

function ensureCopied(name) {
  const target = path.join(desktopNodeModules, name)
  if (existsSync(target) && lstatSync(target).isDirectory()) {
    copiedPackages.add(name)
    return
  }
  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  mkdirSync(path.dirname(target), { recursive: true })
  cpSync(resolvePackageDir(name), target, { recursive: true, dereference: true })
  copiedPackages.add(name)
}

/**
 * Every runtime package materialised into `desktop/node_modules`. Forge reads
 * `node_modules/.runtime-packages.json` instead of a hand-maintained list, so
 * a new transitive dependency cannot be forgotten during packaging.
 */
const copiedPackages = new Set()

mkdirSync(desktopNodeModules, { recursive: true })
ensureLinked('electron')

/**
 * Copies a native dependency and its installed platform package (e.g.
 * `@node-rs/argon2-linux-x64-gnu`). The platform package is an optional
 * dependency resolved from the repository store, so it is not a direct
 * dependency of the workspace and would otherwise be missing from the package.
 */
function copyNativeClosure(name) {
  const packageDir = resolvePackageDir(name)
  const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
  const platformPackages = Object.keys(manifest.optionalDependencies ?? {}).filter((dependency) => {
    try {
      resolvePackageDir(dependency)
      return true
    } catch {
      return false
    }
  })

  for (const dependency of [name, ...platformPackages]) {
    ensureCopied(dependency)
  }
}

/**
 * Copies a runtime package and its production dependency closure. Externalised
 * modules (e.g. `@maxxuxx/node-printer` → `iconv-lite`) are `require`d from
 * `node_modules` at runtime, so every dependency must be a real copy in the
 * package. Forge's Vite plugin does not include `node_modules`, hence this.
 */
function copyRuntimeClosure(name, seen = new Set()) {
  if (seen.has(name)) return
  seen.add(name)

  ensureCopied(name)
  const packageDir = resolvePackageDir(name)
  const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    copyRuntimeClosure(dependency, seen)
  }
}

for (const name of Object.keys(manifest.dependencies ?? {})) {
  if (NATIVE_RUNTIME_DEPENDENCIES.has(name)) {
    copyNativeClosure(name)
  }
}

// Externalised runtime modules need their full dependency tree, not just the
// platform package (argon2 already handles that above).
if (manifest.dependencies?.['@maxxuxx/node-printer']) {
  copyRuntimeClosure('@maxxuxx/node-printer')
}

// Forge packages exactly these directories; see `packageAfterPrune`.
writeFileSync(
  path.join(desktopNodeModules, '.runtime-packages.json'),
  `${JSON.stringify({ packages: [...copiedPackages].sort() }, null, 2)}\n`,
  'utf8',
)
