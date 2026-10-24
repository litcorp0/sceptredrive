import pino from 'pino'
import { env } from './config/env.ts'

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'pin',
  'secret',
  'token',
  '*.password',
  '*.token',
  '*.secret',
]

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'sceptre-drive-api' },
  redact: { paths: redactPaths, censor: '[redacted]' },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname,service',
          },
        },
      }
    : {}),
})

export type Logger = pino.Logger
