import { DEV_API_BASE_URL, DEV_POWERSYNC_URL, SCEPTRE_DOMAIN } from './config.ts'

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
export const PRODUCTION_API_ORIGINS = [`https://api.${SCEPTRE_DOMAIN}`] as const
export const PRODUCTION_POWERSYNC_ORIGINS = [
  'https://*.powersync.journeyapps.com',
  `https://*.${SCEPTRE_DOMAIN}`,
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
 * Placeholder for the renderer's meta CSP. It is filled by `serveRenderer` at request time,
 * not at build time: a meta policy baked into the bundle cannot name origins the running
 * configuration chose (a staging host, for example), and Chromium enforces the *intersection*
 * of the header and the meta tag. A narrower meta therefore blocks fetch calls the header
 * allows — which is exactly how enrolment failed on a packaged till.
 */
export const CSP_PLACEHOLDER = '<!--%SCEPTRE_CSP%-->'

/** The same policy as a meta tag, minus `frame-ancestors` (ignored in meta, warned about). */
export function metaContentSecurityPolicy(policy: string): string {
  return policy
    .split('; ')
    .filter((directive) => !directive.startsWith('frame-ancestors'))
    .join('; ')
}

/** Fills `CSP_PLACEHOLDER` in the renderer document with the policy in force. */
export function injectMetaPolicy(html: string, policy: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${metaContentSecurityPolicy(policy)}" />`
  return html.replace(CSP_PLACEHOLDER, meta)
}

/**
 * The policy the Vite dev server sends with the renderer document.
 *
 * Dev is local by definition: the API, PowerSync, and HMR all live on localhost,
 * so the local origins are on. `vite.renderer.config.mts` uses this function
 * rather than calling `buildContentSecurityPolicy` directly, so the header a
 * developer actually runs under is covered by the same tests as every other
 * policy — a missing `allowLocalOrigins` here is exactly how enrolment against
 * `http://localhost:4000` got blocked while every packaged test stayed green.
 */
export function devContentSecurityPolicy(): string {
  return buildContentSecurityPolicy({ dev: true, allowLocalOrigins: true })
}

/**
 * True for a plain-HTTP loopback origin — the shape a local impersonator would use. A packaged
 * build refuses these unless `SCEPTRE_ALLOW_LOCAL_API=1`, whoever configured them.
 */
export function isLocalConnectOrigin(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    )
  } catch {
    return false
  }
}

/**
 * Whether a configured URL may be used by this app.
 *
 * Two rules, and which applies depends on where the configuration came from:
 *
 *   - a loopback origin is refused in a packaged build unless the operator opted in, because a
 *     shipped till pointed at `http://localhost:4000` is a credential harvester;
 *   - the narrow host allowlist above constrains a **user-writable** config file only. A baked
 *     config is inside the package, compiled there by whoever built it, so any https host is
 *     trusted — otherwise every deployment host (a Render subdomain today, our own domain later)
 *     would have to be hardcoded into the app before it could be used.
 */
export function isOriginPermitted(
  url: string,
  options: { allowLocal: boolean; trusted: boolean },
): boolean {
  if (isLocalConnectOrigin(url) && !options.allowLocal) return false
  if (options.trusted) return true
  return isAllowedConnectOrigin(url, { allowLocal: options.allowLocal })
}

/**
 * True when `url`'s origin is one the CSP also permits in `connect-src`.
 *
 * Used to reject config values that would point the app at an origin the policy
 * forbids: the CSP is built from the config, so an unvalidated config could
 * silently widen the policy. The allowlist is deliberately narrow — our own
 * `*.${SCEPTRE_DOMAIN}` hosts, PowerSync Cloud hosts, and (local only) any
 * localhost origin.
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

  if (hostname === SCEPTRE_DOMAIN || hostname.endsWith(`.${SCEPTRE_DOMAIN}`)) {
    return true
  }

  if (hostname.endsWith('.powersync.journeyapps.com')) {
    return true
  }

  return (PRODUCTION_API_ORIGINS as readonly string[]).includes(origin)
}
