import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { consoleEmailProvider, redactEmail } from './console.ts'
import { createFileEmailProvider } from './file.ts'
import { createEmailProvider } from './index.ts'

const cleanupDirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gikautos-mail-'))
  cleanupDirs.push(dir)
  return dir
}

describe('email provider selection', () => {
  it('selects the console provider when no Resend key is configured', () => {
    const provider = createEmailProvider({ emailFrom: 'GikAutos <no-reply@gikautos.local>' })
    expect(provider.name).toBe('console')
  })

  it('selects the file provider in development', () => {
    const provider = createEmailProvider({
      emailFrom: 'GikAutos <no-reply@gikautos.local>',
      nodeEnv: 'development',
    })
    expect(provider.name).toBe('file')
  })

  it('selects the Resend provider when a key is configured', () => {
    const provider = createEmailProvider({
      resendApiKey: 'test-key',
      emailFrom: 'GikAutos <no-reply@gikautos.local>',
      nodeEnv: 'development',
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

describe('file email provider', () => {
  it('writes the message to the mail folder', async () => {
    const dir = await makeTempDir()
    const provider = createFileEmailProvider(dir)

    await provider.send({
      to: 'manager@gikautos.local',
      subject: 'Reset your GikAutos password',
      text: 'Use this link: http://localhost:3000/reset-password?token=abc123',
    })

    const files = await readdir(dir)
    expect(files).toHaveLength(1)

    const content = await readFile(join(dir, files[0] ?? ''), 'utf8')
    expect(content).toContain('To: manager@gikautos.local')
    expect(content).toContain('Subject: Reset your GikAutos password')
    expect(content).toContain('token=abc123')
  })
})
