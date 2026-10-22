import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source-level security guard.
 *
 * Some Electron settings silently undo the whole isolation model (Node in the
 * renderer, webviews, disabled web security, insecure content). A unit test on
 * the CSP cannot catch a regression there, so scan the main-process sources for
 * the patterns outright.
 */

const mainDir = path.resolve(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(full)
      if (entry.name.endsWith('.test.ts')) return []
      if (!/\.(ts|tsx|mts|cts)$/.test(entry.name)) return []
      return [full]
    })
    .sort()
}

const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /nodeIntegration\s*:\s*true/, reason: 'Node must stay out of the renderer' },
  { pattern: /nodeIntegrationInWorker\s*:\s*true/, reason: 'Node must stay out of workers' },
  { pattern: /nodeIntegrationInSubFrames\s*:\s*true/, reason: 'Node must stay out of sub-frames' },
  { pattern: /contextIsolation\s*:\s*false/, reason: 'contextIsolation must stay enabled' },
  { pattern: /sandbox\s*:\s*false/, reason: 'the renderer sandbox must stay enabled' },
  { pattern: /webSecurity\s*:\s*false/, reason: 'web security must never be disabled' },
  {
    pattern: /allowRunningInsecureContent\s*:\s*true/,
    reason: 'insecure content is never allowed',
  },
  { pattern: /webviewTag\s*:\s*true/, reason: 'webviews are never allowed' },
  { pattern: /enableRemoteModule/, reason: 'the remote module is removed/banned' },
  { pattern: /\.loadFile\(/, reason: 'file:// is never used for the app' },
  { pattern: /nodeIntegration\s*:\s*!app\.isPackaged\s*$/, reason: 'no conditional Node access' },
]

describe('main-process source guards', () => {
  const files = sourceFiles(mainDir)

  it('finds the main-process sources', () => {
    expect(files.length).toBeGreaterThan(3)
  })

  it.each(FORBIDDEN)('has no "$reason" regression', ({ pattern, reason }) => {
    const offenders = files.filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
    expect(offenders, `${reason} (${pattern})`).toEqual([])
  })

  it('never opens external URLs on behalf of renderer content', () => {
    const offenders = files.filter((file) =>
      /shell\s*\.\s*openExternal/.test(fs.readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
