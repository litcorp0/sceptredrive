import { afterEach, describe, expect, it } from 'vitest'
import type { DesktopApi } from '../../shared/ipc'
import {
  DesktopApiError,
  DesktopUnavailableError,
  desktopApi,
  isDesktopAvailable,
} from './desktop-api'

function installBridge(bridge: DesktopApi | undefined): void {
  Object.defineProperty(globalThis, 'window', {
    value: bridge ? { gikautos: bridge } : {},
    configurable: true,
    writable: true,
  })
}

function fakeBridge(overrides: Partial<DesktopApi['secure']> = {}): DesktopApi {
  return {
    app: {
      getInfo: async () => ({
        ok: false,
        error: { code: 'INTERNAL', message: 'not used' },
      }),
    },
    secure: {
      get: async () => ({ ok: true, data: 'stored-token' }),
      set: async () => ({ ok: true, data: null }),
      delete: async () => ({ ok: true, data: null }),
      ...overrides,
    },
    pin: {
      hash: async () => ({ ok: true, data: 'argon2-verifier' }),
      verify: async () => ({ ok: true, data: true }),
    },
    printer: {
      list: async () => ({ ok: true, data: [] }),
      print: async () => ({ ok: true, data: { ok: true, bytes: 0 } }),
      openDrawer: async () => ({ ok: true, data: { ok: true, bytes: 0 } }),
      test: async () => ({ ok: true, data: { ok: true, bytes: 0 } }),
    },
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('desktopApi', () => {
  it('throws a typed error when the preload bridge is missing', async () => {
    installBridge(undefined)
    expect(isDesktopAvailable()).toBe(false)
    await expect(desktopApi.getSecret('deviceToken')).rejects.toBeInstanceOf(
      DesktopUnavailableError,
    )
  })

  it('unwraps successful IPC results', async () => {
    installBridge(fakeBridge())
    expect(isDesktopAvailable()).toBe(true)
    await expect(desktopApi.getSecret('deviceToken')).resolves.toBe('stored-token')
  })

  it('turns a failed IPC result into a typed DesktopApiError', async () => {
    installBridge(
      fakeBridge({
        set: async () => ({
          ok: false,
          error: { code: 'KEYCHAIN_UNAVAILABLE', message: 'no secret service' },
        }),
      }),
    )

    const failure = desktopApi.setSecret('deviceToken', 'x')
    await expect(failure).rejects.toBeInstanceOf(DesktopApiError)
    await expect(desktopApi.setSecret('deviceToken', 'x')).rejects.toMatchObject({
      code: 'KEYCHAIN_UNAVAILABLE',
    })
  })

  it('passes PIN hashing and verification through the bridge', async () => {
    installBridge(fakeBridge())
    await expect(desktopApi.hashPin('2468', 'c2FsdA==')).resolves.toBe('argon2-verifier')
    await expect(desktopApi.verifyPin('argon2-verifier', '2468', 'c2FsdA==')).resolves.toBe(true)
  })
})
