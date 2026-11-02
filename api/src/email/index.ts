import { env } from '../config/env.ts'
import { logger } from '../logger.ts'
import { consoleEmailProvider } from './console.ts'
import { createFileEmailProvider } from './file.ts'
import { createResendEmailProvider } from './resend.ts'
import type { EmailProvider } from './types.ts'

export type { EmailMessage, EmailProvider } from './types.ts'

export interface EmailProviderOptions {
  resendApiKey?: string | undefined
  emailFrom: string
  nodeEnv?: 'development' | 'test' | 'production' | undefined
  mailDir?: string | undefined
}

/**
 * Production with no Resend key.
 *
 * The console provider resolves successfully, so a deployment without `RESEND_API_KEY`
 * reported `invitationSent: true` and the console told an administrator the invite "was
 * emailed" while nothing left the process. Failing here makes the flag false, so the
 * credentials are shown for hand-over instead of assumed delivered.
 */
export const disabledEmailProvider: EmailProvider = {
  name: 'disabled',
  async send(): Promise<void> {
    throw new Error('Transactional email is disabled: RESEND_API_KEY is not set')
  },
}

/**
 * Selects the email provider once at boot: Resend when an API key is present,
 * the local mail folder in development, a failing provider in production, and the
 * console provider otherwise.
 */
export function createEmailProvider(options: EmailProviderOptions): EmailProvider {
  if (options.resendApiKey) {
    return createResendEmailProvider(options.resendApiKey, options.emailFrom)
  }
  if (options.nodeEnv === 'development') {
    return createFileEmailProvider(options.mailDir)
  }
  if (options.nodeEnv === 'production') {
    return disabledEmailProvider
  }
  return consoleEmailProvider
}

/**
 * Why Resend would reject the from address, if it would.
 *
 * Two values look configured but cannot deliver: the repository default ends in `.local`,
 * which no mail system can resolve, and Resend's shared `onboarding@resend.dev` sender only
 * delivers to the address that owns the Resend account.
 */
export function fromAddressProblem(emailFrom: string): string | undefined {
  const address = emailFrom.toLowerCase()
  if (address.includes('@resend.dev')) {
    return 'EMAIL_FROM uses onboarding@resend.dev, which only delivers to the Resend account owner. Verify a domain in Resend and send from an address on it.'
  }
  if (/@[^>\s]*\.local/.test(address)) {
    return 'EMAIL_FROM uses a .local domain that no recipient can resolve. Verify a domain in Resend and send from an address on it.'
  }
  return undefined
}

export const email: EmailProvider = createEmailProvider({
  resendApiKey: env.RESEND_API_KEY,
  emailFrom: env.EMAIL_FROM,
  nodeEnv: env.NODE_ENV,
})

if (env.NODE_ENV === 'production' && !env.RESEND_API_KEY) {
  logger.error(
    'RESEND_API_KEY is not set: staff invitations and password resets will fail, not send. Set it and EMAIL_FROM in the service environment.',
  )
}

const fromProblem = fromAddressProblem(env.EMAIL_FROM)
if (env.NODE_ENV === 'production' && fromProblem) {
  logger.error(`EMAIL_FROM cannot deliver: ${fromProblem}`)
}
