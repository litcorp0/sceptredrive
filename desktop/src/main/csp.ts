import { DEV_API_BASE_URL, DEV_POWERSYNC_URL } from './config.ts'

/**
 * The renderer's Content-Security-Policy.
 *
 * The Web SDK runs SQLite as WebAssembly inside workers, so the policy must
 * allow `wasm-unsafe-eval` (WASM compilation without `eval`) and worker loading
 * from the app origin plus `blob:` (wa-sqlite's worker bootstrap). Nothing else
 * is relaxed: no remote scripts, no `unsafe-eval`, no frames.
 *
 * Pure module: safe to unit-test outside Electron.
 */

/** Origins the packaged app may talk to, on top of the configured API/PowerSync URLs. */
export const PRODUCTION_API_ORIGINS = ['https://api.gikautos.com'] as const
export const PRODUCTION_POWERSYNC_ORIGINS = [
  'https://*.powersync.journeyapps.com',
  'https://*.gikautos.com',
] as const

export type CspOptions = {
  /** Vite dev server: adds React Refresh's inline script and HMR websockets. */
  dev: boolean
  /**
   * Allow localhost API/PowerSync origins. True for the dev server and for an
   * unpackaged build (E2E, local smoke tests); false for any packaged app, so a
   * shipped terminal can never be pointed at a local impersonator.
   */
  allowLocalOrigins?: boolean
  /** Origin of the configured API base URL (validated by `config.ts`). */
  apiOrigin?: string
  /** Origin of the configured PowerSync URL. */
  powersyncOrigin?: string
}

function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

/** Extra `connect-src` entries needed to talk to a local API/PowerSync. */
export const LOCAL_CONNECT_ORIGINS = [
  DEV_API_BASE_URL,
  DEV_POWERSYNC_URL,
  'ws://localhost:*',
] as const

export function buildContentSecurityPolicy(options: CspOptions): string {
  const connectSrc = unique([
    "'self'",
    ...PRODUCTION_API_ORIGINS,
    ...PRODUCTION_POWERSYNC_ORIGINS,
    ...(options.allowLocalOrigins ? LOCAL_CONNECT_ORIGINS : []),
    options.apiOrigin,
    options.powersyncOrigin,
  ])

  // React Refresh injects an inline preamble in dev only.
  const scriptSrc = options.dev
    ? "'self' 'unsafe-inline' 'wasm-unsafe-eval'"
    : "'self' 'wasm-unsafe-eval'"

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/**
 * True when `url`'s origin is one the CSP also permits in `connect-src`.
 *
 * Used to reject config values that would point the app at an origin the policy
 * forbids: the CSP is built from the config, so an unvalidated config could
 * silently widen the policy. The allowlist is deliberately narrow — our own
 * `*.gikautos.com` hosts, PowerSync Cloud hosts, and (local only) any localhost
 * origin.
 */
export function isAllowedConnectOrigin(url: string, options: { allowLocal: boolean }): boolean {
  let origin: string
  let hostname: string
  let protocol: string
  try {
    const parsed = new URL(url)
    origin = parsed.origin
    hostname = parsed.hostname
    protocol = parsed.protocol
  } catch {
    return false
  }

  if (
    options.allowLocal &&
    protocol === 'http:' &&
    (hostname === 'localhost' || hostname === '127.0.0.1')
  ) {
    return true
  }

  if (protocol !== 'https:') {
    return false
  }

  if (hostname === 'gikautos.com' || hostname.endsWith('.gikautos.com')) {
    return true
  }

  if (hostname.endsWith('.powersync.journeyapps.com')) {
    return true
  }

  return (PRODUCTION_API_ORIGINS as readonly string[]).includes(origin)
}
