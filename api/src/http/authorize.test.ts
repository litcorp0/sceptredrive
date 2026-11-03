import { describe, expect, it } from 'vitest'
import { assertBranchAccess, branchScope, resolveBranchFilter, roleOf } from '../auth/scope.ts'
import { requirePermission } from './authorize.ts'
import { AppError } from './errors.ts'
import { factory, type SessionUser } from './factory.ts'

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
    staffId: 'SD-0001',
    phone: null,
    isActive: true,
    mustChangePassword: false,
    image: null,
    ...overrides,
  } as SessionUser
}

function appWithUser(userValue: SessionUser | null, permission: 'branch.read' | 'branch.create') {
  const app = factory.createApp()
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ code: error.code }, error.statusCode as 401 | 403)
    }
    return c.json({ code: 'INTERNAL' }, 500)
  })
  app.use(async (c, next) => {
    c.set('user', userValue)
    await next()
  })
  app.get('/api/scoped', requirePermission(permission), (c) => c.json({ ok: true }))
  return app
}

describe('roleOf', () => {
  it('fails closed for unknown roles', () => {
    expect(roleOf(user({ role: 'SUPERUSER' }))).toBe('CASHIER')
    expect(roleOf(user({ role: 'ADMIN' }))).toBe('ADMIN')
  })
})

describe('requirePermission', () => {
  it('rejects anonymous requests with 401', async () => {
    const response = await appWithUser(null, 'branch.read').request('/api/scoped')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED' })
  })

  it('rejects cashiers with 403', async () => {
    const response = await appWithUser(user({ role: 'CASHIER' }), 'branch.read').request(
      '/api/scoped',
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'FORBIDDEN' })
  })

  it('rejects managers without the permission', async () => {
    const response = await appWithUser(user(), 'branch.create').request('/api/scoped')
    expect(response.status).toBe(403)
  })

  it('admits managers with the permission', async () => {
    const response = await appWithUser(user(), 'branch.read').request('/api/scoped')
    expect(response.status).toBe(200)
  })

  it('admits admins', async () => {
    const response = await appWithUser(
      user({ role: 'ADMIN', branchId: null }),
      'branch.create',
    ).request('/api/scoped')
    expect(response.status).toBe(200)
  })
})

describe('branch scoping', () => {
  it('gives admins an unscoped view', () => {
    expect(branchScope(user({ role: 'ADMIN', branchId: null }))).toBeNull()
    expect(resolveBranchFilter(user({ role: 'ADMIN', branchId: null }))).toBeNull()
    expect(resolveBranchFilter(user({ role: 'ADMIN', branchId: null }), 'branch-9')).toBe(
      'branch-9',
    )
  })

  it('scopes managers to their own branch', () => {
    expect(branchScope(user())).toBe('branch-1')
    expect(resolveBranchFilter(user())).toBe('branch-1')
    expect(resolveBranchFilter(user(), 'branch-1')).toBe('branch-1')
  })

  it('denies managers requesting another branch', () => {
    expect(() => resolveBranchFilter(user(), 'branch-2')).toThrow(AppError)
    expect(() => assertBranchAccess(user(), 'branch-2')).toThrow(AppError)
    expect(() => assertBranchAccess(user(), 'branch-1')).not.toThrow()
  })

  it('denies managers without an assigned branch', () => {
    expect(() => branchScope(user({ branchId: null }))).toThrow(AppError)
  })

  it('lets admins access any branch', () => {
    expect(() =>
      assertBranchAccess(user({ role: 'ADMIN', branchId: null }), 'branch-2'),
    ).not.toThrow()
  })
})
