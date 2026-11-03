import { describe, expect, it } from 'vitest'
import { SCEPTRE_DOMAIN } from './config'
import {
  buildContentSecurityPolicy,
  devContentSecurityPolicy,
  isAllowedConnectOrigin,
  isLocalConnectOrigin,
  isOriginPermitted,
} from './csp'

function directive(policy: string, name: string): string {
  const found = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `))
  if (!found) throw new Error(`missing directive ${name}`)
  return found
}

describe('buildContentSecurityPolicy', () => {
  it('allows WASM and workers for the PowerSync Web SDK', () => {
    const policy = buildContentSecurityPolicy({ dev: false })

    expect(directive(policy, 'script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'")
    expect(directive(policy, 'worker-src')).toBe("worker-src 'self' blob:")
    expect(directive(policy, 'object-src')).toBe("object-src 'none'")
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'")
  })

  it('never enables plain unsafe-eval or inline scripts in a packaged build', () => {
    const scriptSrc = directive(buildContentSecurityPolicy({ dev: false }), 'script-src')
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  it('permits the production API, PowerSync Cloud, and our own hosts', () => {
    const connect = directive(buildContentSecurityPolicy({ dev: false }), 'connect-src')
    expect(connect).toContain("'self'")
    expect(connect).toContain(`https://api.${SCEPTRE_DOMAIN}`)
    expect(connect).toContain('https://*.powersync.journeyapps.com')
    expect(connect).toContain(`https://*.${SCEPTRE_DOMAIN}`)
    expect(connect).not.toContain('localhost')
  })

  it('adds the validated runtime config origins without duplicating defaults', () => {
    const connect = directive(
      buildContentSecurityPolicy({
        dev: false,
        apiOrigin: `https://api.${SCEPTRE_DOMAIN}`,
        powersyncOrigin: 'https://sync.example.com',
      }),
      'connect-src',
    )
    expect(connect).toContain('https://sync.example.com')
    expect(connect.split(`https://api.${SCEPTRE_DOMAIN}`)).toHaveLength(2)
  })

  it('allows localhost only when local origins are enabled', () => {
    const local = directive(
      buildContentSecurityPolicy({ dev: false, allowLocalOrigins: true }),
      'connect-src',
    )
    expect(local).toContain('http://localhost:4000')
    expect(local).toContain('http://localhost:8080')
    expect(local).toContain('ws://localhost:*')

    const packaged = directive(buildContentSecurityPolicy({ dev: false }), 'connect-src')
    expect(packaged).not.toContain('localhost')
  })

  it('relaxes only what the dev server needs', () => {
    const policy = buildContentSecurityPolicy({ dev: true, allowLocalOrigins: true })
    expect(directive(policy, 'script-src')).toContain("'unsafe-inline'")
  })
})

describe('devContentSecurityPolicy', () => {
  it('lets the dev renderer reach the local API, PowerSync, and HMR sockets', () => {
    const policy = devContentSecurityPolicy()
    const connect = directive(policy, 'connect-src')

    expect(connect).toContain('http://localhost:4000')
    expect(connect).toContain('http://localhost:8080')
    expect(connect).toContain('ws://localhost:*')
  })

  it('relaxes inline scripts for React Refresh but never grants unsafe-eval', () => {
    const scriptSrc = directive(devContentSecurityPolicy(), 'script-src')
    expect(scriptSrc).toContain("'unsafe-inline'")
    expect(scriptSrc).toContain("'wasm-unsafe-eval'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })
})

describe('isOriginPermitted', () => {
  it('accepts a baked deployment host, such as a Render subdomain', () => {
    expect(
      isOriginPermitted('https://sceptredrive.onrender.com', { allowLocal: false, trusted: true }),
    ).toBe(true)
  })

  it('still refuses the same host when it came from a user-writable file', () => {
    expect(
      isOriginPermitted('https://sceptredrive.onrender.com', { allowLocal: false, trusted: false }),
    ).toBe(false)
  })

  it('refuses a loopback origin in a packaged build even when baked', () => {
    expect(isOriginPermitted('http://localhost:4000', { allowLocal: false, trusted: true })).toBe(
      false,
    )
  })

  it('allows loopback only with the explicit opt-in', () => {
    expect(isOriginPermitted('http://localhost:4000', { allowLocal: true, trusted: true })).toBe(
      true,
    )
  })

  it('keeps the allowlist for file-based configuration', () => {
    expect(isOriginPermitted('https://evil.example', { allowLocal: false, trusted: false })).toBe(
      false,
    )
    expect(
      isOriginPermitted(`https://api.${SCEPTRE_DOMAIN}`, { allowLocal: false, trusted: false }),
    ).toBe(true)
  })
})

describe('isLocalConnectOrigin', () => {
  it('spots plain-HTTP loopback origins, which a packaged build refuses', () => {
    expect(isLocalConnectOrigin('http://localhost:4000')).toBe(true)
    expect(isLocalConnectOrigin('http://127.0.0.1:8080')).toBe(true)
  })

  it('leaves everything else alone', () => {
    expect(isLocalConnectOrigin('https://localhost:4000')).toBe(false)
    expect(isLocalConnectOrigin('https://sceptredrive.onrender.com')).toBe(false)
    expect(isLocalConnectOrigin('http://10.0.0.5:4000')).toBe(false)
    expect(isLocalConnectOrigin('not a url')).toBe(false)
  })
})

describe('isAllowedConnectOrigin', () => {
  it('accepts the production API and Cloud PowerSync origins', () => {
    expect(isAllowedConnectOrigin(`https://api.${SCEPTRE_DOMAIN}`, { allowLocal: false })).toBe(
      true,
    )
    expect(
      isAllowedConnectOrigin('https://abc123.powersync.journeyapps.com', { allowLocal: false }),
    ).toBe(true)
    expect(
      isAllowedConnectOrigin(`https://powersync.${SCEPTRE_DOMAIN}`, { allowLocal: false }),
    ).toBe(true)
    expect(
      isAllowedConnectOrigin(`https://api.staging.${SCEPTRE_DOMAIN}`, { allowLocal: false }),
    ).toBe(true)
  })

  it('rejects anything else in a packaged build', () => {
    expect(isAllowedConnectOrigin('https://evil.example', { allowLocal: false })).toBe(false)
    expect(isAllowedConnectOrigin('http://localhost:4000', { allowLocal: false })).toBe(false)
    expect(isAllowedConnectOrigin('http://10.0.0.5:4000', { allowLocal: false })).toBe(false)
  })

  it('accepts local origins only when local access is allowed', () => {
    expect(isAllowedConnectOrigin('http://localhost:4000', { allowLocal: true })).toBe(true)
    expect(isAllowedConnectOrigin('http://127.0.0.1:8080', { allowLocal: true })).toBe(true)
    expect(isAllowedConnectOrigin('http://evil.example', { allowLocal: true })).toBe(false)
  })
})
