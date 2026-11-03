import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeNetworkFailure, isOffline } from './network-status'

function setOnline(value: boolean) {
  vi.stubGlobal('navigator', { onLine: value })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isOffline', () => {
  it('is true only when the machine reports no link', () => {
    setOnline(false)
    expect(isOffline()).toBe(true)
    setOnline(true)
    expect(isOffline()).toBe(false)
  })
})

describe('describeNetworkFailure', () => {
  it('blames the connection, not the server, when the machine is offline', () => {
    setOnline(false)
    const failure = describeNetworkFailure('sceptredrive.onrender.com')
    expect(failure.code).toBe('OFFLINE')
    expect(failure.message).toMatch(/no internet connection/i)
    expect(failure.message).not.toContain('sceptredrive.onrender.com')
  })

  it('names the host when the link exists but the server does not answer', () => {
    setOnline(true)
    const failure = describeNetworkFailure('sceptredrive.onrender.com')
    expect(failure.code).toBe('NETWORK_ERROR')
    expect(failure.message).toContain('sceptredrive.onrender.com')
  })
})
