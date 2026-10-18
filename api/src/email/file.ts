import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '../logger.ts'
import { redactEmail } from './console.ts'
import type { EmailMessage, EmailProvider } from './types.ts'

const here = dirname(fileURLToPath(import.meta.url))

/** Local mail folder used by the development provider (gitignored). */
export const DEFAULT_MAIL_DIR = resolve(here, '../../.mail')

/**
 * Development provider: writes each message to a local folder so flows that
 * depend on email links (password reset, invitations) can be tested without a
 * mail service. Files are written with owner-only permissions and only the
 * file path plus a redacted recipient are logged — message bodies and tokens
 * never reach the logs.
 */
export function createFileEmailProvider(directory: string = DEFAULT_MAIL_DIR): EmailProvider {
  return {
    name: 'file',
    async send(message: EmailMessage): Promise<void> {
      await mkdir(directory, { recursive: true })

      const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
      const suffix = randomBytes(4).toString('hex')
      const file = join(directory, `${timestamp}-${suffix}.txt`)

      const content = [
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '',
      ].join('\n')
      await writeFile(file, content, { encoding: 'utf8', mode: 0o600 })

      logger.info(
        { provider: 'file', to: redactEmail(message.to), file },
        'email written to local mail folder',
      )
    },
  }
}
