#!/usr/bin/env node
/**
 * Copy the brand asset masters into every app's public directory.
 *
 * The master lives in `packages/brand/assets`; the apps need real files under `public/` so
 * a favicon is a URL and a packaged Electron build has the image inside the asar. Copying
 * by hand is how one app ends up with last month's logo, so the copies are generated.
 *
 *   bun run brand:assets
 *
 * The copies are committed (not generated at build time) because a fresh clone and an
 * offline build must both have them without running this script first.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SOURCE = path.join(ROOT, 'packages', 'brand', 'assets')
const FILES = ['logo.png', 'logo-inverse.png', 'logo-icon.png']
const APPS = ['admin', 'desktop', 'web']

let copied = 0

for (const app of APPS) {
  const targetDir = path.join(ROOT, app, 'public')
  if (!existsSync(path.join(ROOT, app))) {
    console.warn(`skip ${app}: workspace not present`)
    continue
  }
  mkdirSync(targetDir, { recursive: true })

  for (const file of FILES) {
    const source = path.join(SOURCE, file)
    if (!existsSync(source)) {
      throw new Error(`Missing master asset ${path.relative(ROOT, source)}. See packages/brand/assets/README.md`)
    }
    const target = path.join(targetDir, file)
    copyFileSync(source, target)
    // A zero-byte copy is worse than a missing file: it renders as a broken image.
    if (statSync(target).size === 0) throw new Error(`Empty copy: ${path.relative(ROOT, target)}`)
    copied += 1
    console.log(`${path.relative(ROOT, target)}`)
  }
}

console.log(`brand assets synced (${copied} files)`)
