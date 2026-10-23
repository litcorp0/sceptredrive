import { describe, expect, it } from 'vitest'
import { app } from '../app.ts'

/**
 * The POS binding credential travels in `x-pos-binding`, which is a custom
 * header: a browser preflight must approve it or every PIN-change/validate call
 * from the Electron renderer fails as a network error.
 */
describe('CORS preflight', () => {
  it('allows the POS binding header from the console origin', async () => {
    const response = await app.request('/api/pos/staff/change-pin', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-pos-binding',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-pos-binding',
    )
  })
})
