import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * API client behaviour: one refresh on 401, terminal 403, timeouts, and error
 * bodies that never leak request data.
 */

const fetchMock = vi.fn()
const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

const {
  apiRequest,
  setAccessToken,
  setTokenRefresher,
  ApiError,
  DeviceRevokedError,
  fetchSession,
} = await import('./client')

describe('apiRequest', () => {
  it('sends the bearer token and JSON body', async () => {
    setAccessToken('jwt-1')
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    const result = await apiRequest<{ ok: boolean }>('/api/pos/session', {
      method: 'POST',
      body: { a: 1 },
    })

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/pos/session')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt-1')
    expect(init.body).toBe('{"a":1}')
    expect(init.credentials).toBe('omit')
  })

  it('refreshes once and retries on 401', async () => {
    setAccessToken('expired')
    setTokenRefresher(async () => {
      setAccessToken('fresh')
      return 'fresh'
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'no' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    await expect(apiRequest('/api/pos/powersync/token', { method: 'POST' })).resolves.toEqual({
      ok: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(secondHeaders.authorization).toBe('Bearer fresh')
  })

  it('does not loop when the refresh also fails', async () => {
    setTokenRefresher(async () => null)
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'no' } }, 401),
    )

    await expect(apiRequest('/api/pos/anything')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a revoked device as DeviceRevokedError', async () => {
    setTokenRefresher(null)
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'DEVICE_REVOKED', message: 'revoked' } }, 403),
    )

    const failure = apiRequest('/api/pos/powersync/token', { method: 'POST' })
    await expect(failure).rejects.toBeInstanceOf(DeviceRevokedError)
    await expect(failure).rejects.toMatchObject({ code: 'DEVICE_REVOKED' })
  })

  it('reports a timeout as a typed error', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )

    await expect(apiRequest('/api/pos/session', { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      status: 0,
    })
  })

  it('does not leak the response body of a malformed JSON error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>nope</html>', { status: 502 }))

    const failure = apiRequest('/api/pos/session')
    await expect(failure).rejects.toBeInstanceOf(ApiError)
    await expect(failure).rejects.toMatchObject({
      status: 502,
      message: 'Request failed with status 502',
    })
  })

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(apiRequest('/api/pos/anything', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('exposes Retry-After on a 429 so the uploader can honour it', async () => {
    setTokenRefresher(null)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'slow down' } }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '42' },
      }),
    )

    await expect(apiRequest('/api/pos/sync/upload', { method: 'POST' })).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 42,
    })
  })

  it('sends the device token (not the JWT) for the session call and never refreshes it', async () => {
    setAccessToken('jwt-1')
    fetchMock.mockResolvedValue(jsonResponse({ deviceId: 'd' }))

    await fetchSession('device-token-xyz')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer device-token-xyz')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
