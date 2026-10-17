import { logger } from '../logger.ts'
import type { EmailMessage, EmailProvider } from './types.ts'

/** Keeps the first character of the local part; never logs the full address. */
export function redactEmail(address: string): string {
  const at = address.indexOf('@')
  if (at <= 0) return '[redacted]'
  const local = address.slice(0, at)
  const domain = address.slice(at)
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 2))}${domain}`
}

/**
 * Development provider: records that an email would have been sent without
 * writing message bodies or full recipient addresses to the logs.
 */
export const consoleEmailProvider: EmailProvider = {
  name: 'console',
  async send(message: EmailMessage): Promise<void> {
    logger.info(
      { provider: 'console', to: redactEmail(message.to), subject: message.subject },
      'email not sent (console provider)',
    )
  },
}
