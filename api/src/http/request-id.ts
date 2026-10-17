import { randomUUID } from 'node:crypto'
import { factory } from './factory.ts'

const HEADER = 'x-request-id'
const VALID_PATTERN = /^[\w.-]{8,64}$/

export const requestId = factory.createMiddleware(async (c, next) => {
  const incoming = c.req.header(HEADER)
  const id = incoming && VALID_PATTERN.test(incoming) ? incoming : randomUUID()
  c.set('requestId', id)
  c.header(HEADER, id)
  await next()
})
