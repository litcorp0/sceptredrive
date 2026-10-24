import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, resolveAppAssetPath } from './paths'

const root = '/opt/sceptre-drive/resources/.vite/renderer/main_window'

describe('resolveAppAssetPath', () => {
  it('serves index.html for the origin root', () => {
    expect(resolveAppAssetPath(root, `${APP_ORIGIN}/`)).toBe(path.join(root, 'index.html'))
  })

  it('serves nested renderer assets', () => {
    expect(resolveAppAssetPath(root, `${APP_ORIGIN}/assets/index-abc123.js`)).toBe(
      path.join(root, 'assets', 'index-abc123.js'),
    )
    expect(resolveAppAssetPath(root, `${APP_ORIGIN}/@powersync/worker.js`)).toBe(
      path.join(root, '@powersync', 'worker.js'),
    )
  })

  it('decodes URL-encoded paths', () => {
    expect(resolveAppAssetPath(root, `${APP_ORIGIN}/assets/caf%C3%A9.js`)).toBe(
      path.join(root, 'assets', 'café.js'),
    )
  })

  it('refuses to escape the renderer directory', () => {
    // The URL parser already collapses plain `..` segments, so the value stays
    // inside the renderer directory.
    const normalized = resolveAppAssetPath(root, `${APP_ORIGIN}/../../main.cjs`)
    expect(normalized).not.toBeNull()
    expect(normalized?.startsWith(root)).toBe(true)

    // Encoded separators survive the parser and must be rejected by the guard.
    expect(resolveAppAssetPath(root, `${APP_ORIGIN}/%2e%2e%2f%2e%2e%2fmain.cjs`)).toBeNull()
    expect(resolveAppAssetPath(root, `${APP_ORIGIN}/..%2f..%2fmain.cjs`)).toBeNull()
    expect(resolveAppAssetPath(root, `${APP_ORIGIN}/assets/..%2f..%2f..%2fmain.cjs`)).toBeNull()
  })

  it('rejects other hosts and malformed URLs', () => {
    expect(resolveAppAssetPath(root, 'app://evil/index.html')).toBeNull()
    expect(resolveAppAssetPath(root, 'https://sceptre-drive/index.html')).toBeNull()
    expect(resolveAppAssetPath(root, 'not a url')).toBeNull()
  })

  it('rejects null bytes', () => {
    expect(resolveAppAssetPath(root, `${APP_ORIGIN}/index.html%00.js`)).toBeNull()
  })
})
