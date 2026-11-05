import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { consoleEmailProvider, redactEmail } from './console.ts'
import { createFileEmailProvider } from './file.ts'
import { createEmailProvider, fromAddressProblem } from './index.ts'

const cleanupDirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sceptre-drive-mail-'))
  cleanupDirs.push(dir)
  return dir
}

describe('email provider selection', () => {
  it('selects the console provider when no Resend key is configured', () => {
    const provider = createEmailProvider({ emailFrom: 'Sceptre Drive <no-reply@sceptre.local>' })
    expect(provider.name).toBe('console')
  })

  it('selects the file provider in development', () => {
    const provider = createEmailProvider({
      emailFrom: 'Sceptre Drive <no-reply@sceptre.local>',
      nodeEnv: 'development',
    })
    expect(provider.name).toBe('file')
  })

  it('selects the Resend provider when a key is configured', () => {
    const provider = createEmailProvider({
      resendApiKey: 'test-key',
      emailFrom: 'Sceptre Drive <no-reply@sceptre.local>',
      nodeEnv: 'development',
    })
    expect(provider.name).toBe('resend')
  })

  it('never selects a sending provider in a test, even with a real key (P20-D7)', () => {
    // A developer `.env` with a live key must not turn the suite into a mailer.
    const provider = createEmailProvider({
      resendApiKey: 'test-key',
      emailFrom: 'Sceptre Drive <no-reply@sceptredrive.com>',
      nodeEnv: 'test',
    })
    expect(provider.name).toBe('console')
  })

  it('fails loudly in production when no key is configured', async () => {
    const provider = createEmailProvider({
      emailFrom: 'Sceptre Drive <no-reply@sceptre.local>',
      nodeEnv: 'production',
    })
    expect(provider.name).toBe('disabled')
    await expect(
      provider.send({ to: 'cashier@example.com', subject: 'Account', text: 'Hello' }),
    ).rejects.toThrow(/RESEND_API_KEY is not set/)
  })
})

describe('fromAddressProblem', () => {
  it('accepts an address on a verified domain', () => {
    expect(fromAddressProblem('Sceptre Drive <no-reply@sceptre-drive.com>')).toBeUndefined()
  })

  it('rejects the .local default, which no recipient can resolve', () => {
    expect(fromAddressProblem('Sceptre Drive <no-reply@sceptre.local>')).toMatch(/\.local/)
  })

  it("rejects Resend's shared sender, which only reaches the account owner", () => {
    expect(fromAddressProblem('Sceptre Drive <onboarding@resend.dev>')).toMatch(/onboarding/)
  })
})

describe('console email provider', () => {
  it('sends without throwing and never logs the full recipient address', async () => {
    await expect(
      consoleEmailProvider.send({
        to: 'cashier@sceptre.local',
        subject: 'Your Sceptre Drive account',
        text: 'Temporary password enclosed.',
      }),
    ).resolves.toBeUndefined()
  })

  it('redacts local parts and handles malformed addresses', () => {
    expect(redactEmail('cashier@sceptre.local')).toBe('c******@sceptre.local')
    expect(redactEmail('ab@example.com')).toBe('a**@example.com')
    expect(redactEmail('not-an-email')).toBe('[redacted]')
  })
})

describe('file email provider', () => {
  it('writes the message to the mail folder', async () => {
    const dir = await makeTempDir()
    const provider = createFileEmailProvider(dir)

    await provider.send({
      to: 'manager@sceptre.local',
      subject: 'Reset your Sceptre Drive password',
      text: 'Use this link: http://localhost:3000/reset-password?token=abc123',
    })

    const files = await readdir(dir)
    expect(files).toHaveLength(1)

    const content = await readFile(join(dir, files[0] ?? ''), 'utf8')
    expect(content).toContain('To: manager@sceptre.local')
    expect(content).toContain('Subject: Reset your Sceptre Drive password')
    expect(content).toContain('token=abc123')
  })
})
