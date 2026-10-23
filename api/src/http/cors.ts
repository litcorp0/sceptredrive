import { cors } from 'hono/cors'
import { env } from '../config/env.ts'

const allowedOrigins = new Set(env.corsOrigins)

export const corsMiddleware = cors({
  origin: (origin) => (allowedOrigins.has(origin) ? origin : undefined),
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Branch-Id', 'X-Pos-Binding'],
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['X-Request-Id', 'Content-Length'],
  maxAge: 600,
})
