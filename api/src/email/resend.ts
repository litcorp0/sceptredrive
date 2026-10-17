import { Resend } from 'resend'
import { logger } from '../logger.ts'
import type { EmailMessage, EmailProvider } from './types.ts'

export function createResendEmailProvider(apiKey: string, from: string): EmailProvider {
  const resend = new Resend(apiKey)

  return {
    name: 'resend',
    async send(message: EmailMessage): Promise<void> {
      const { error } = await resend.emails.send({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      })

      if (error) {
        logger.error(
          { provider: 'resend', code: error.name, subject: message.subject },
          'email send failed',
        )
        throw new Error(`Email send failed: ${error.message}`)
      }
    },
  }
}
