import { describe, expect, it } from 'vitest'
import { consoleEmailProvider, redactEmail } from './console.ts'
import { createEmailProvider } from './index.ts'

describe('email provider selection', () => {
  it('selects the console provider when no Resend key is configured', () => {
    const provider = createEmailProvider({ emailFrom: 'GikAutos <no-reply@gikautos.local>' })
    expect(provider.name).toBe('console')
  })

  it('selects the Resend provider when a key is configured', () => {
    const provider = createEmailProvider({
      resendApiKey: 'test-key',
      emailFrom: 'GikAutos <no-reply@gikautos.local>',
    })
    expect(provider.name).toBe('resend')
  })
})

describe('console email provider', () => {
  it('sends without throwing and never logs the full recipient address', async () => {
    await expect(
      consoleEmailProvider.send({
        to: 'cashier@gikautos.local',
        subject: 'Your GikAutos account',
        text: 'Temporary password enclosed.',
      }),
    ).resolves.toBeUndefined()
  })

  it('redacts local parts and handles malformed addresses', () => {
    expect(redactEmail('cashier@gikautos.local')).toBe('c******@gikautos.local')
    expect(redactEmail('ab@example.com')).toBe('a**@example.com')
    expect(redactEmail('not-an-email')).toBe('[redacted]')
  })
})
