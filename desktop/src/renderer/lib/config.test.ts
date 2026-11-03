import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The renderer must use the configuration the main process resolved, not its own build-time
 * default. A packaged till that fell back to `http://localhost:4000` failed enrolment with
 * "Cannot reach the server" while the baked URLs sat unread in the app resources.
 */
async function loadConfig() {
  vi.resetModules()
  return import('./config')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('posRuntimeConfig', () => {
  it('uses the runtime configuration the main process resolved', async () => {
    vi.stubGlobal('sceptreDrive', {
      runtimeConfig: {
        apiBaseUrl: 'https://sceptredrive.onrender.com',
        powersyncUrl: 'https://abc123.powersync.journeyapps.com',
      },
    })

    const { posRuntimeConfig } = await loadConfig()

    expect(posRuntimeConfig.apiBaseUrl).toBe('https://sceptredrive.onrender.com')
    expect(posRuntimeConfig.powersyncUrl).toBe('https://abc123.powersync.journeyapps.com')
  })

  it('falls back to build-time values when no bridge exists (browser tests)', async () => {
    const { posRuntimeConfig } = await loadConfig()
    expect(posRuntimeConfig.apiBaseUrl).toBe('http://localhost:4000')
  })

  it('refuses a malformed bridged configuration instead of silently using localhost', async () => {
    vi.stubGlobal('sceptreDrive', {
      runtimeConfig: { apiBaseUrl: 'not a url', powersyncUrl: 'https://sync.example' },
    })

    await expect(loadConfig()).rejects.toThrow()
  })
})
