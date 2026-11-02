#!/usr/bin/env node
/**
 * Stamp the release version into `desktop/package.json`, which is where Electron Forge
 * reads the number the installer is named after.
 *
 *   node scripts/set-release-version.mjs 0.2.0          # write it
 *   node scripts/set-release-version.mjs 0.2.0 --check  # validate only
 *   node scripts/set-release-version.mjs 0.2.0 --check --floor 0.3.1
 *
 * This exists for the `Release` workflow: a release is dispatched with the version to
 * ship, and the build stamps it before Forge runs, so nobody has to bump the file, commit
 * it, and then tag the same thing by hand.
 *
 * The stamp is build-local. `desktop/package.json` in the repository keeps the last
 * committed number and is not modified by a release, so the tag — not the file — is the
 * record of what shipped. Since the file therefore stops advancing once releases start,
 * `--floor` lets the workflow pass the newest published tag so a downgrade is still caught.
 *
 * Refuses a downgrade: a release lower than the committed version, or lower than the floor,
 * is almost always a typo, and it would publish an installer older than ones already out.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/**
 * Compare two versions by precedence. Build metadata is not part of this regex, and
 * prerelease ordering is only as precise as a release pipeline needs: `0.2.0-rc.1` is
 * lower than `0.2.0`, and two prereleases compare as equal.
 */
function compare(a, b) {
  const left = a.match(SEMVER)
  const right = b.match(SEMVER)
  for (let i = 1; i <= 3; i += 1) {
    const diff = Number(left[i]) - Number(right[i])
    if (diff !== 0) return Math.sign(diff)
  }
  const leftPre = left[4] === undefined
  const rightPre = right[4] === undefined
  if (leftPre === rightPre) return 0
  return leftPre ? 1 : -1
}

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const floorIndex = args.indexOf('--floor')
const floor = floorIndex === -1 ? undefined : args[floorIndex + 1]
const version = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--floor')
const packagePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'package.json')

if (version === undefined) {
  console.error(
    'usage: node scripts/set-release-version.mjs <version> [--check] [--floor <version>]',
  )
  process.exit(2)
}

if (!SEMVER.test(version)) {
  console.error(`::error::'${version}' is not a version like 0.2.0 or 0.2.0-rc.1.`)
  process.exit(2)
}

if (floor !== undefined) {
  if (!SEMVER.test(floor)) {
    console.error(`::error::'${floor}' is not a usable floor version.`)
    process.exit(2)
  }
  if (compare(version, floor) < 0) {
    console.error(
      `::error::Refusing to release ${version}: ${floor} is already published. ` +
        'A lower version would put an older installer on top of the newest release.',
    )
    process.exit(1)
  }
}

const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
const current = manifest.version

if (typeof current !== 'string' || !SEMVER.test(current)) {
  console.error(`::error::desktop/package.json has no usable version (found ${current}).`)
  process.exit(2)
}

if (compare(version, current) < 0) {
  console.error(
    `::error::Refusing to release ${version}: desktop/package.json is already at ${current}. ` +
      'Releasing a lower version would publish an installer older than the ones on the Releases page.',
  )
  process.exit(1)
}

if (version === current) {
  console.log(`desktop/package.json is already at ${version}; nothing to stamp.`)
  process.exit(0)
}

if (checkOnly) {
  console.log(`Version ${version} is valid and ahead of ${current}.`)
  process.exit(0)
}

manifest.version = version
// Match the repository formatting: two-space indent and a trailing newline, so a stamped
// file is byte-identical to one Biome would write.
writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Stamped desktop/package.json: ${current} -> ${version}`)
