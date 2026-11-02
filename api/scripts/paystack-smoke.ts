/**
 * A staging-only Paystack connectivity check.
 *
 * It proves the credential, the API base URL and the GHS currency path without
 * touching the till or the database. It prints no secret and, in `live` mode,
 * refuses to run unless `--live` is passed explicitly; a live initialize creates
 * a real transaction (no money moves until someone pays it).
 *
 * Usage:
 *   bun run --filter api paystack:smoke
 *   bun run --filter api paystack:smoke -- --momo
 *   bun run --filter api paystack:smoke -- --live --amount 100
 *
 * The default amount is 100 pesewas (GHS 1.00). Test mode also prints the
 * checkout URL so the operator can complete a card payment with a test card.
 */
import { env } from '../src/config/env.ts'

const TIMEOUT_MS = 20_000
const DEFAULT_AMOUNT_MINOR = 100

interface Envelope<T> {
  status?: boolean
  message?: string
  data?: T
}

interface BalanceRow {
  currency?: string
  balance?: number
}

interface TransactionData {
  id?: number | string
  reference?: string
  status?: string
  authorization_url?: string
  display_text?: string
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function amountFromArgs(): number {
  const index = process.argv.indexOf('--amount')
  if (index === -1) return DEFAULT_AMOUNT_MINOR
  const parsed = Number(process.argv[index + 1])
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_AMOUNT_MINOR
}

function money(minor: number): string {
  return `GHS ${Math.trunc(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, '0')}`
}

async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Envelope<T> | null }> {
  const response = await fetch(`${env.PAYSTACK_BASE_URL.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  let parsed: Envelope<T> | null = null
  try {
    parsed = (await response.json()) as Envelope<T>
  } catch {
    parsed = null
  }
  return { status: response.status, body: parsed }
}

function fail(message: string): never {
  console.error(`FAIL  ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const allowLive = hasFlag('live')
  const mode = env.PAYSTACK_MODE
  const key = env.PAYSTACK_SECRET_KEY

  console.log(`Paystack smoke test`)
  console.log(`  mode:       ${mode}`)
  console.log(`  base URL:   ${env.PAYSTACK_BASE_URL}`)
  console.log(`  email:      @${env.PAYSTACK_EMAIL_DOMAIN}`)
  console.log(`  webhook:    /api/payments/webhook/paystack`)
  console.log(`  webhook key configured: ${env.paystackWebhookSecret ? 'yes' : 'no'}`)

  if (mode === 'mock') {
    console.log(
      '\nPAYSTACK_MODE=mock. Nothing was called. Set PAYSTACK_MODE=test and an sk_test_ key.',
    )
    return
  }

  if (!key) fail('PAYSTACK_SECRET_KEY is not configured')

  if (mode === 'live' && !allowLive) {
    fail(
      'PAYSTACK_MODE=live. Re-run with --live only when you intend to create a real transaction; no money moves until it is paid.',
    )
  }

  if (
    env.PAYSTACK_EMAIL_DOMAIN.endsWith('.example') ||
    env.PAYSTACK_EMAIL_DOMAIN === 'example.com'
  ) {
    console.warn(
      'WARN  PAYSTACK_EMAIL_DOMAIN is the .example placeholder. Use a domain the business owns before staging or production.',
    )
  }

  const balance = await call<BalanceRow[]>('GET', '/balance')
  if (balance.status !== 200 || !balance.body?.status) {
    fail(
      `balance check failed (${balance.status}): ${balance.body?.message ?? 'no JSON body'}. Check the key and the mode.`,
    )
  }
  const ghs = balance.body.data?.find((row) => row.currency?.toUpperCase() === 'GHS')
  console.log(`\nPASS  balance: ${ghs ? money(ghs.balance ?? 0) : 'no GHS balance row'}`)

  const amount = amountFromArgs()
  const stamp = Date.now()
  const reference = `smoke_${stamp}_${Math.random().toString(36).slice(2, 8)}`
  const email = `paystack-smoke+${stamp}@${env.PAYSTACK_EMAIL_DOMAIN}`

  const initialize = await call<TransactionData>('POST', '/transaction/initialize', {
    amount,
    email,
    currency: 'GHS',
    reference,
    channels: ['card'],
    metadata: { smoke: true },
  })
  if (initialize.status !== 200 || !initialize.body?.status || !initialize.body.data) {
    fail(
      `initialize failed (${initialize.status}): ${initialize.body?.message ?? 'no JSON body'}. Check the key, the GHS currency and the email domain.`,
    )
  }
  console.log(`PASS  initialize: ${reference} (${money(amount)})`)
  if (mode === 'test' && initialize.body.data.authorization_url) {
    console.log(`      checkout: ${initialize.body.data.authorization_url}`)
    console.log('      Use a test card from docs/PAYSTACK-STAGING.md to complete it.')
  }

  const verify = await call<TransactionData>(
    'GET',
    `/transaction/verify/${encodeURIComponent(reference)}`,
  )
  console.log(
    `PASS  verify: ${verify.body?.data?.status ?? 'unknown'} (${verify.status}) — pending/abandoned is expected until the checkout is paid`,
  )

  if (hasFlag('momo')) {
    if (mode === 'live') fail('--momo is test-mode only')
    const momoReference = `smoke_momo_${stamp}`
    const momo = await call<TransactionData>('POST', '/charge', {
      amount,
      email,
      currency: 'GHS',
      reference: momoReference,
      mobile_money: { phone: '0551234987', provider: 'mtn' },
      metadata: { smoke: true },
    })
    if (momo.status !== 200 || !momo.body?.status) {
      fail(`MoMo charge failed (${momo.status}): ${momo.body?.message ?? 'no JSON body'}`)
    }
    console.log(
      `PASS  MoMo charge: ${momoReference} status ${momo.body.data?.status ?? 'unknown'}${
        momo.body.data?.display_text ? ` — ${momo.body.data.display_text}` : ''
      }`,
    )
    console.log(
      '      Test MTN number 0551234987 completes without a PIN/OTP. Check the webhook delivery in the Paystack dashboard.',
    )
  }

  console.log('\nDone. No secret was printed.')
}

await main()
