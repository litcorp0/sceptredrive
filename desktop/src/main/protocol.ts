import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { injectMetaPolicy } from './csp'
import { APP_SCHEME, resolveAppAssetPath } from './paths'

/**
 * Serves the packaged renderer from `app://sceptre-drive/…`.
 *
 * A privileged standard scheme gives the renderer a real origin, which is what
 * web workers, WASM, IndexedDB/OPFS, and a strict CSP need. `file://` is an
 * opaque origin and is never used for the app.
 */

let schemeRegistered = false

export function registerAppScheme(): void {
  if (schemeRegistered) return
  schemeRegistered = true
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

export function serveRenderer(rootDir: string, contentSecurityPolicy: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const filePath = resolveAppAssetPath(rootDir, request.url)
    if (!filePath) {
      return new Response('Not found', { status: 404 })
    }

    let response: Response
    try {
      response = await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', contentSecurityPolicy)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('Referrer-Policy', 'no-referrer')

    // The document carries a meta policy as well. Fill it from the policy in force: a meta
    // baked at build time cannot know the configured API origin, and the browser intersects
    // the two, so a stale copy silently blocks fetch calls the header permits.
    if (filePath.endsWith('.html')) {
      return new Response(injectMetaPolicy(await response.text(), contentSecurityPolicy), {
        status: response.status,
        headers,
      })
    }

    return new Response(response.body, { status: response.status, headers })
  })
}

export function rendererRootDir(buildDir: string, windowName: string): string {
  return path.join(buildDir, '..', 'renderer', windowName)
}
