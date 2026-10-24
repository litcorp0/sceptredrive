#!/usr/bin/env node
/**
 * Brand gate — fails the build when the pre-rename brand string reappears.
 *
 * The product was renamed on 2026-10-24. A partial sweep is invisible in review, so the
 * rename is enforced mechanically: every tracked file is scanned (case-insensitive) and
 * the command exits non-zero unless each match is on the allowlist below.
 *
 * Only *tracked* files are scanned on purpose. Build output (`admin/.output`,
 * `desktop/.vite`), installed dependencies, local mail dumps, and `.env` are untracked or
 * ignored, and a stale string in a generated artefact is not a source problem.
 *
 *   bun run brand:check
 *
 * To allow a deliberate exception, add the repository-relative path to ALLOW with a
 * comment saying why. Keep that list as short as the plan requires.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** The pre-rename brand, matched case-insensitively. */
const OLD_BRAND = 'gikautos'

/**
 * Deliberate exceptions. Empty is the goal; every entry needs a reason.
 *
 * - `desktop/src/main/config.ts` carries the `SCEPTRE_DOMAIN` placeholder (the production
 *   domain is not purchased yet). It is the single line the eventual swap edits.
 */
const ALLOW = new Set(['desktop/src/main/config.ts'])

/** Applied migrations are history and are never rewritten. */
const SKIP_PREFIXES = ['api/migrations/', '.planning/phases/']

/** Generated files whose content is not authored. */
const SKIP_FILES = new Set(['bun.lock', 'scripts/check-brand.mjs'])

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  return output.split('\0').filter(Boolean)
}

function isAllowed(file) {
  if (SKIP_FILES.has(file) || ALLOW.has(file)) return true
  return SKIP_PREFIXES.some((prefix) => file.startsWith(prefix))
}

function isBinary(buffer) {
  // Git decides binary-ness by NUL bytes; mirror that so images never reach the decoder.
  return buffer.subarray(0, 8000).includes(0)
}

const violations = []
let scanned = 0

for (const file of trackedFiles()) {
  if (isAllowed(file)) continue
  const buffer = readFileSync(file)
  if (isBinary(buffer)) continue
  scanned += 1
  const lines = buffer.toString('utf8').split('\n')
  for (const [index, line] of lines.entries()) {
    if (line.toLowerCase().includes(OLD_BRAND)) {
      violations.push(`${file}:${index + 1}: ${line.trim()}`)
    }
  }
}

if (violations.length === 0) {
  console.log(`brand check OK (${scanned} tracked files, old brand absent)`)
  process.exit(0)
}

console.error(`brand check FAILED — ${violations.length} stale brand reference(s):\n`)
for (const violation of violations) console.error(`  ${violation}`)
console.error(
  '\nRename the string, or add the file to ALLOW in scripts/check-brand.mjs with a reason.',
)
process.exit(1)
