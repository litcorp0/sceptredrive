import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy, isAllowedConnectOrigin } from './csp'

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

  it('permits the production API and PowerSync Cloud origins', () => {
    const connect = directive(buildContentSecurityPolicy({ dev: false }), 'connect-src')
    expect(connect).toContain("'self'")
    expect(connect).toContain('https://api.gikautos.com')
    expect(connect).toContain('https://*.powersync.journeyapps.com')
    expect(connect).not.toContain('localhost')
  })

  it('adds the validated runtime config origins without duplicating defaults', () => {
    const connect = directive(
      buildContentSecurityPolicy({
        dev: false,
        apiOrigin: 'https://api.gikautos.com',
        powersyncOrigin: 'https://sync.example.com',
      }),
      'connect-src',
    )
    expect(connect).toContain('https://sync.example.com')
    expect(connect.match(/https:\/\/api\.gikautos\.com/g) ?? []).toHaveLength(1)
  })

  it('relaxes only what the dev server needs', () => {
    const policy = buildContentSecurityPolicy({ dev: true })
    expect(directive(policy, 'script-src')).toContain("'unsafe-inline'")
    const connect = directive(policy, 'connect-src')
    expect(connect).toContain('ws://localhost:*')
    expect(connect).toContain('http://localhost:4000')
  })
})

describe('isAllowedConnectOrigin', () => {
  it('accepts the production API and Cloud PowerSync origins', () => {
    expect(isAllowedConnectOrigin('https://api.gikautos.com', { dev: false })).toBe(true)
    expect(isAllowedConnectOrigin('https://abc123.powersync.journeyapps.com', { dev: false })).toBe(
      true,
    )
    expect(isAllowedConnectOrigin('https://powersync.gikautos.com', { dev: false })).toBe(true)
    expect(isAllowedConnectOrigin('https://api.staging.gikautos.com', { dev: false })).toBe(true)
  })

  it('rejects anything else in a packaged build', () => {
    expect(isAllowedConnectOrigin('https://evil.example', { dev: false })).toBe(false)
    expect(isAllowedConnectOrigin('http://localhost:4000', { dev: false })).toBe(false)
    expect(isAllowedConnectOrigin('http://10.0.0.5:4000', { dev: false })).toBe(false)
  })

  it('accepts local origins only in development', () => {
    expect(isAllowedConnectOrigin('http://localhost:8080', { dev: true })).toBe(true)
    expect(isAllowedConnectOrigin('http://evil.example', { dev: true })).toBe(false)
  })
})
