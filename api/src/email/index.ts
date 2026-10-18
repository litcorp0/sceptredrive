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
 * Selects the email provider once at boot: Resend when an API key is present,
 * the local mail folder in development, the console provider otherwise.
 * Emails are never silently dropped in production: the console provider
 * redacts recipients and boot logs an error.
 */
export function createEmailProvider(options: EmailProviderOptions): EmailProvider {
  if (options.resendApiKey) {
    return createResendEmailProvider(options.resendApiKey, options.emailFrom)
  }
  if (options.nodeEnv === 'development') {
    return createFileEmailProvider(options.mailDir)
  }
  return consoleEmailProvider
}

export const email: EmailProvider = createEmailProvider({
  resendApiKey: env.RESEND_API_KEY,
  emailFrom: env.EMAIL_FROM,
  nodeEnv: env.NODE_ENV,
})

if (env.NODE_ENV === 'production' && email.name === 'console') {
  logger.error('RESEND_API_KEY is not set; transactional email is disabled in production')
}
