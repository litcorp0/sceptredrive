import { describe, expect, it } from 'vitest'
import { app } from '../app.ts'

describe('auth routes', () => {
  it('serves the better auth ok endpoint', async () => {
    const response = await app.request('/api/auth/ok')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('blocks the public sign-up endpoint', async () => {
    const response = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@example.com',
        password: 'long-enough-password',
        name: 'A',
      }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})
