import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../auth/auth.ts', () => ({
  auth: { api: { getSession: vi.fn() } },
  SESSION_FRESH_AGE_SECONDS: 3600,
}))

import { auth } from '../auth/auth.ts'
import { AppError } from './errors.ts'
import { factory, type SessionData, type SessionUser } from './factory.ts'
import { loadSession, requireFreshSession, requireSession } from './session.ts'

const getSession = vi.mocked(auth.api.getSession)

function testApp() {
  const app = factory.createApp()
  app.use(async (c, next) => {
    c.set('logger', { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never)
    await next()
  })
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ code: error.code }, error.statusCode as 401 | 403)
    }
    return c.json({ code: 'INTERNAL' }, 500)
  })
  return app
}

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'test@sceptre.local',
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: 'MANAGER',
    branchId: 'branch-1',
    staffId: 'GA-0001',
    phone: null,
    isActive: true,
    mustChangePassword: false,
    image: null,
    ...overrides,
  } as SessionUser
}

function session(createdAt = new Date()): SessionData {
  return {
    id: 'session-1',
    token: 'token-1',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt,
    updatedAt: createdAt,
    ipAddress: null,
    userAgent: null,
  } as SessionData
}

beforeEach(() => {
  getSession.mockReset()
})

describe('loadSession', () => {
  it('stores the session and user from better auth', async () => {
    getSession.mockResolvedValue({ session: session(), user: user() } as never)
    const app = testApp()
    app.use(loadSession)
    app.get('/api/whoami', (c) => c.json({ id: c.get('user')?.id ?? null }))

    const response = await app.request('/api/whoami')

    expect(await response.json()).toEqual({ id: 'user-1' })
  })

  it('treats a failing session lookup as anonymous', async () => {
    getSession.mockRejectedValue(new Error('boom'))
    const app = testApp()
    app.use(loadSession)
    app.get('/api/whoami', (c) => c.json({ id: c.get('user')?.id ?? null }))

    const response = await app.request('/api/whoami')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: null })
  })

  it('skips the lookup for health and auth paths', async () => {
    const app = testApp()
    app.use(loadSession)
    app.get('/health', (c) => c.json({ ok: true }))
    app.all('/api/auth/*', (c) => c.json({ ok: true }))

    await app.request('/health')
    await app.request('/api/auth/get-session')

    expect(getSession).not.toHaveBeenCalled()
  })
})

describe('requireSession', () => {
  it('rejects anonymous requests with 401', async () => {
    const app = testApp()
    app.use(loadSession)
    app.use(requireSession)
    app.get('/api/thing', (c) => c.json({ ok: true }))

    const response = await app.request('/api/thing')

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED' })
  })

  it('rejects deactivated accounts with 403', async () => {
    getSession.mockResolvedValue({
      session: session(),
      user: user({ isActive: false }),
    } as never)
    const app = testApp()
    app.use(loadSession)
    app.use(requireSession)
    app.get('/api/thing', (c) => c.json({ ok: true }))

    const response = await app.request('/api/thing')

    expect(response.status).toBe(403)
  })

  it('blocks everything but the password change route until the password changes', async () => {
    getSession.mockResolvedValue({
      session: session(),
      user: user({ mustChangePassword: true }),
    } as never)
    const app = testApp()
    app.use(loadSession)
    app.use(requireSession)
    app.get('/api/thing', (c) => c.json({ ok: true }))
    app.post('/api/me/password', (c) => c.json({ ok: true }))

    const blocked = await app.request('/api/thing')
    const allowed = await app.request('/api/me/password', { method: 'POST' })

    expect(blocked.status).toBe(403)
    expect(allowed.status).toBe(200)
  })
})

describe('requireFreshSession', () => {
  it('accepts a session created within the fresh window', async () => {
    getSession.mockResolvedValue({ session: session(), user: user() } as never)
    const app = testApp()
    app.use(loadSession)
    app.use(requireFreshSession)
    app.post('/api/thing', (c) => c.json({ ok: true }))

    const response = await app.request('/api/thing', { method: 'POST' })

    expect(response.status).toBe(200)
  })

  it('returns REAUTH_REQUIRED for a stale session', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    getSession.mockResolvedValue({ session: session(twoHoursAgo), user: user() } as never)
    const app = testApp()
    app.use(loadSession)
    app.use(requireFreshSession)
    app.post('/api/thing', (c) => c.json({ ok: true }))

    const response = await app.request('/api/thing', { method: 'POST' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'REAUTH_REQUIRED' })
  })
})
