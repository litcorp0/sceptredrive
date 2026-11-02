import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  allowsLocalOrigins,
  ConfigError,
  loadRuntimeConfig,
  parseRuntimeConfig,
  readAllowLocalApiFlag,
  resolveRuntimeConfig,
  SCEPTRE_DOMAIN,
} from './config'

describe('parseRuntimeConfig', () => {
  it('accepts http and https URLs', () => {
    expect(
      parseRuntimeConfig({
        apiBaseUrl: `https://api.${SCEPTRE_DOMAIN}`,
        powersyncUrl: 'https://abc.powersync.journeyapps.com',
      }),
    ).toEqual({
      apiBaseUrl: `https://api.${SCEPTRE_DOMAIN}`,
      powersyncUrl: 'https://abc.powersync.journeyapps.com',
    })
  })

  it('rejects non-http schemes and junk', () => {
    expect(() =>
      parseRuntimeConfig({
        apiBaseUrl: 'file:///etc/passwd',
        powersyncUrl: 'http://localhost:8080',
      }),
    ).toThrow()
    expect(() =>
      parseRuntimeConfig({ apiBaseUrl: 'nope', powersyncUrl: 'http://localhost:8080' }),
    ).toThrow()
    expect(() => parseRuntimeConfig({})).toThrow()
  })
})

describe('loadRuntimeConfig', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-drive-config-'))

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('falls back to the local development defaults when no file exists', () => {
    expect(loadRuntimeConfig(path.join(tmpRoot, 'missing'), true)).toEqual({
      apiBaseUrl: 'http://localhost:4000',
      powersyncUrl: 'http://localhost:8080',
    })
  })

  it('falls back to the production endpoints in a packaged build', () => {
    expect(loadRuntimeConfig(path.join(tmpRoot, 'missing'), false)).toEqual({
      apiBaseUrl: `https://api.${SCEPTRE_DOMAIN}`,
      powersyncUrl: `https://powersync.${SCEPTRE_DOMAIN}`,
    })
  })

  it('fails closed on malformed JSON', () => {
    const target = path.join(tmpRoot, 'malformed')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'config.json'), '{ nope')

    expect(() => loadRuntimeConfig(target, false)).toThrowError(ConfigError)
  })

  it('fails closed on an invalid shape', () => {
    const target = path.join(tmpRoot, 'invalid')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'config.json'), JSON.stringify({ apiBaseUrl: 42 }))

    expect(() => loadRuntimeConfig(target, false)).toThrowError(ConfigError)
  })

  it('reads a valid config file', () => {
    const target = path.join(tmpRoot, 'valid')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(
      path.join(target, 'config.json'),
      JSON.stringify({
        apiBaseUrl: `https://api.${SCEPTRE_DOMAIN}`,
        powersyncUrl: 'https://x.example',
      }),
    )

    expect(loadRuntimeConfig(target, false).apiBaseUrl).toBe(`https://api.${SCEPTRE_DOMAIN}`)
  })
})

describe('allowsLocalOrigins', () => {
  it('always allows a dev server, packaged or not', () => {
    expect(allowsLocalOrigins({ isDev: true, isPackaged: true, allowLocalApi: false })).toBe(true)
    expect(allowsLocalOrigins({ isDev: true, isPackaged: false, allowLocalApi: false })).toBe(true)
  })

  it('allows an unpackaged build without any opt-in', () => {
    expect(allowsLocalOrigins({ isDev: false, isPackaged: false, allowLocalApi: false })).toBe(true)
  })

  it('refuses a packaged build by default', () => {
    expect(allowsLocalOrigins({ isDev: false, isPackaged: true, allowLocalApi: false })).toBe(false)
  })

  it('allows a packaged build only with the explicit opt-in', () => {
    expect(allowsLocalOrigins({ isDev: false, isPackaged: true, allowLocalApi: true })).toBe(true)
  })
})

describe('readAllowLocalApiFlag', () => {
  it('accepts exactly "1"', () => {
    expect(readAllowLocalApiFlag({ SCEPTRE_ALLOW_LOCAL_API: '1' })).toBe(true)
  })

  it('ignores everything else', () => {
    for (const value of ['0', 'true', 'yes', 'TRUE', ' 1', '']) {
      expect(readAllowLocalApiFlag({ SCEPTRE_ALLOW_LOCAL_API: value })).toBe(false)
    }
    expect(readAllowLocalApiFlag({})).toBe(false)
  })
})

describe('resolveRuntimeConfig', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-drive-baked-'))

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function write(file: string, contents: string): string {
    fs.writeFileSync(file, contents)
    return file
  }

  it('uses the baked file without any userData file', () => {
    const bundled = write(
      path.join(root, 'baked.json'),
      JSON.stringify({
        apiBaseUrl: 'https://api.staging.example',
        powersyncUrl: 'https://sync.staging.example',
      }),
    )
    expect(
      resolveRuntimeConfig({
        userDataDir: path.join(root, 'empty'),
        local: false,
        bundledConfigPath: bundled,
      }),
    ).toEqual({
      apiBaseUrl: 'https://api.staging.example',
      powersyncUrl: 'https://sync.staging.example',
    })
  })

  it('prefers the baked file over a userData file, so a stray copy cannot break startup', () => {
    const userDir = path.join(root, 'user')
    fs.mkdirSync(userDir, { recursive: true })
    write(
      path.join(userDir, 'config.json'),
      JSON.stringify({
        apiBaseUrl: 'http://localhost:4000',
        powersyncUrl: 'http://localhost:8080',
      }),
    )
    const bundled = write(
      path.join(root, 'baked2.json'),
      JSON.stringify({
        apiBaseUrl: 'https://api.staging.example',
        powersyncUrl: 'https://sync.staging.example',
      }),
    )
    expect(
      resolveRuntimeConfig({ userDataDir: userDir, local: false, bundledConfigPath: bundled })
        .apiBaseUrl,
    ).toBe('https://api.staging.example')
  })

  it('ignores a malformed userData file when a baked one exists', () => {
    const userDir = path.join(root, 'broken-user')
    fs.mkdirSync(userDir, { recursive: true })
    write(path.join(userDir, 'config.json'), 'not json at all')
    const bundled = write(
      path.join(root, 'baked3.json'),
      JSON.stringify({
        apiBaseUrl: 'https://api.staging.example',
        powersyncUrl: 'https://sync.staging.example',
      }),
    )
    expect(() =>
      resolveRuntimeConfig({ userDataDir: userDir, local: false, bundledConfigPath: bundled }),
    ).not.toThrow()
  })

  it('falls back to userData, then to the defaults, when nothing is baked', () => {
    const userDir = path.join(root, 'plain')
    fs.mkdirSync(userDir, { recursive: true })
    write(
      path.join(userDir, 'config.json'),
      JSON.stringify({ apiBaseUrl: 'https://api.example', powersyncUrl: 'https://sync.example' }),
    )
    expect(resolveRuntimeConfig({ userDataDir: userDir, local: false }).apiBaseUrl).toBe(
      'https://api.example',
    )
    expect(
      resolveRuntimeConfig({ userDataDir: path.join(root, 'missing'), local: false }).powersyncUrl,
    ).toContain('powersync')
  })
})
