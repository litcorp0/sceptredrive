import { closeDb } from '@sceptre/db'
import '../src/config/env.ts'
import { seedAdmin } from '../src/seed/admin.ts'

/**
 * Create the bootstrap administrator without the demo dataset.
 *
 *   bun run seed:admin
 *   bun run seed:admin -- --email ops@example.com --password 'a-long-password'
 *
 * Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD in `.env`; the flags are
 * optional overrides for adding another administrator. The command is
 * idempotent by email: an existing account is reported and left untouched.
 * Passing `--password` puts the value in shell history, so prefer `.env`.
 */

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(
      [
        'Usage: bun run seed:admin [options]',
        '',
        'Creates the bootstrap admin (role ADMIN, no branch) without demo data.',
        'Credentials default to ADMIN_EMAIL / ADMIN_PASSWORD from .env.',
        '',
        'Options:',
        '  --email <address>     Override ADMIN_EMAIL',
        '  --password <value>    Override ADMIN_PASSWORD (min 12 characters; visible in shell history)',
        '  --name <name>         Display name (default: Sceptre Drive Admin)',
        '  --help, -h            Show this help',
      ].join('\n'),
    )
    return
  }

  if (hasFlag('--password')) {
    console.warn(
      '[seed:admin] --password is visible in shell history; prefer ADMIN_PASSWORD in .env',
    )
  }

  const result = await seedAdmin({
    email: option('--email') ?? undefined,
    password: option('--password') ?? undefined,
    name: option('--name') ?? undefined,
  })

  const email = (option('--email') ?? process.env.ADMIN_EMAIL)?.trim().toLowerCase()
  console.log(
    result === 'created'
      ? `[seed:admin] admin created: ${email}. Sign in and set up two-factor authentication.`
      : `[seed:admin] admin already present: ${email}. Nothing changed.`,
  )
}

main()
  .catch((error: unknown) => {
    console.error(`[seed:admin] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
