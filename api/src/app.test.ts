import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@gikautos/db', () => ({
  checkDb: vi.fn(),
  closeDb: vi.fn(),
}))

import { checkDb } from '@gikautos/db'
import { app } from './app.ts'

const checkDbMock = vi.mocked(checkDb)

beforeEach(() => {
  checkDbMock.mockResolvedValue(undefined)
})

describe('health endpoints', () => {
  it('reports liveness with security headers and a request id', async () => {
    const response = await app.request('/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok' })
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
  })

  it('reports readiness when the database responds', async () => {
    const response = await app.request('/ready')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
  })

  it('fails readiness closed when the database is unreachable', async () => {
    checkDbMock.mockRejectedValueOnce(new Error('connection refused'))

    const response = await app.request('/ready')

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'unavailable' })
  })
})

describe('request ids', () => {
  it('echoes a valid incoming request id', async () => {
    const response = await app.request('/health', {
      headers: { 'x-request-id': 'test-request-123456' },
    })

    expect(response.headers.get('x-request-id')).toBe('test-request-123456')
  })

  it('replaces an invalid incoming request id', async () => {
    const response = await app.request('/health', {
      headers: { 'x-request-id': 'bad id with spaces' },
    })

    const requestId = response.headers.get('x-request-id')
    expect(requestId).toBeTruthy()
    expect(requestId).not.toBe('bad id with spaces')
  })
})

describe('cors', () => {
  it('allows the configured admin origin', async () => {
    const response = await app.request('/health', {
      headers: { origin: 'http://localhost:3000' },
    })

    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  })

  it('does not allow unknown origins', async () => {
    const response = await app.request('/health', {
      headers: { origin: 'https://evil.example' },
    })

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('errors', () => {
  it('returns a generic JSON body for unknown routes', async () => {
    const response = await app.request('/does-not-exist')

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    })
  })
})
