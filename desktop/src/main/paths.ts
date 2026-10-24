import path from 'node:path'

export const APP_SCHEME = 'app'
export const APP_HOST = 'sceptre-drive'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

/**
 * Maps an `app://` request URL to a file inside the bundled renderer directory.
 *
 * Anything outside that directory (encoded traversal, sibling directories, a
 * different host) resolves to `null` so the protocol handler can answer 404.
 *
 * Pure module: no Electron imports, so it is unit-testable.
 */
export function resolveAppAssetPath(rootDir: string, requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }

  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    return null
  }

  if (decoded.includes('\0')) {
    return null
  }

  const relative = decoded === '/' || decoded === '' ? '/index.html' : decoded
  const root = path.resolve(rootDir)
  const resolved = path.resolve(root, `.${relative}`)

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null
  }

  return resolved
}
