import { randomUUID } from 'node:crypto'
import { factory } from './factory.ts'

const HEADER = 'x-request-id'
const VALID_PATTERN = /^[\w.-]{8,64}$/

export const requestId = factory.createMiddleware(async (c, next) => {
  const incoming = c.req.header(HEADER)
  const id = incoming && VALID_PATTERN.test(incoming) ? incoming : randomUUID()
  c.set('requestId', id)
  c.header(HEADER, id)
  try {
    // Downstream handlers (Better Auth hooks, audit) read the id from the raw request.
    c.req.raw.headers.set(HEADER, id)
  } catch {
    // Header mutation is unavailable in some runtimes; the context value still carries the id.
  }
  await next()
})
