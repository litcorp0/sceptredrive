import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConfigError, loadRuntimeConfig, parseRuntimeConfig } from './config'

describe('parseRuntimeConfig', () => {
  it('accepts http and https URLs', () => {
    expect(
      parseRuntimeConfig({
        apiBaseUrl: 'https://api.gikautos.com',
        powersyncUrl: 'https://abc.powersync.journeyapps.com',
      }),
    ).toEqual({
      apiBaseUrl: 'https://api.gikautos.com',
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gikautos-config-'))

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
      apiBaseUrl: 'https://api.gikautos.com',
      powersyncUrl: 'https://powersync.gikautos.com',
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
      JSON.stringify({ apiBaseUrl: 'https://api.gikautos.com', powersyncUrl: 'https://x.example' }),
    )

    expect(loadRuntimeConfig(target, false).apiBaseUrl).toBe('https://api.gikautos.com')
  })
})
