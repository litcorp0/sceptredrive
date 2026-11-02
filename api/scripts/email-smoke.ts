/**
 * A staging-only check for transactional email (staff invitations, password resets).
 *
 * It sends one real message through the Resend API with the same `RESEND_API_KEY` and
 * `EMAIL_FROM` the service uses, then prints Resend's answer verbatim. That turns "the
 * invite never arrived" into one of three sentences:
 *
 *   - the key is missing or wrong        -> 401
 *   - the from domain is not verified     -> 403
 *   - the recipient is refused            -> 403, because Resend's shared
 *                                           `onboarding@resend.dev` sender only delivers to
 *                                           the address that owns the Resend account
 *
 * Usage:
 *   bun run --filter api email:smoke -- --to you@example.com
 *
 * Run it with the deployed service's environment (Render → Shell, or `render env`), not your
 * laptop's `.env`, or it checks the wrong key. The message body is fixed and harmless; it
 * prints no secret.
 */
import { env } from '../src/config/env.ts'
import { fromAddressProblem } from '../src/email/index.ts'

const RESEND_API = 'https://api.resend.com'
const TIMEOUT_MS = 20_000

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function fail(message: string, hint?: string): never {
  console.error(`\nFAILED: ${message}`)
  if (hint) console.error(hint)
  process.exit(1)
}

async function post(path: string, key: string, body: unknown): Promise<Response> {
  return fetch(`${RESEND_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

async function get(path: string, key: string): Promise<Response> {
  return fetch(`${RESEND_API}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

const to = argument('--to') ?? env.ADMIN_EMAIL

console.log(`NODE_ENV:   ${env.NODE_ENV}`)
console.log(`EMAIL_FROM: ${env.EMAIL_FROM}`)
console.log(`RESEND_API_KEY: ${env.RESEND_API_KEY ? 'set' : 'NOT SET'}`)

if (!env.RESEND_API_KEY) {
  fail(
    'RESEND_API_KEY is not set in this environment.',
    'The service cannot send from here at all: invitations report failure and nothing leaves the process.',
  )
}

const fromProblem = fromAddressProblem(env.EMAIL_FROM)
if (fromProblem) {
  console.warn(`WARNING: ${fromProblem}`)
}

if (!to) {
  fail('No recipient.', 'Pass --to you@example.com, or set ADMIN_EMAIL.')
}
console.log(`to:         ${to}\n`)

const response = await post('/emails', env.RESEND_API_KEY, {
  from: env.EMAIL_FROM,
  to: [to],
  subject: 'Sceptre Drive email check',
  text: 'This is a connectivity check for transactional email. If you received it, sending works.',
})

const body = await response.text()
console.log(`Resend answered ${response.status}: ${body}`)

if (!response.ok) {
  if (response.status === 401) {
    console.log('\nHint: the API key is wrong, revoked, or from another Resend account.')
  } else if (response.status === 403 && body.toLowerCase().includes('testing emails')) {
    console.log(
      '\nHint: onboarding@resend.dev only sends to the Resend account owner. Verify a domain and set EMAIL_FROM to an address on it.',
    )
  } else if (response.status === 403) {
    console.log('\nHint: EMAIL_FROM is not on a domain verified in Resend (Domains page).')
  } else if (response.status === 422) {
    console.log('\nHint: Resend rejected the request; the message above names the field.')
  }
  process.exit(1)
}

// Which domains this key may send from, so an unverified sender is visible immediately.
const domains = await get('/domains', env.RESEND_API_KEY)
if (domains.ok) {
  const payload = (await domains.json()) as { data?: { name?: string; status?: string }[] }
  const rows = payload.data ?? []
  console.log(`\nDomains on this Resend account (${rows.length}):`)
  for (const row of rows) console.log(`  ${row.status ?? 'unknown'}\t${row.name ?? 'unnamed'}`)
  if (rows.length === 0) {
    console.log('  none — only onboarding@resend.dev can send, and only to the account owner')
  }
}

console.log('\nOK: Resend accepted the message. Check the inbox and the Resend → Emails page.')
