#!/usr/bin/env node
/**
 * Phase 6 Plan 03 walkthrough — device auth → PowerSync token → service.
 *
 * Verifies the whole device-facing path against a running API (`:4000`) and the
 * self-hosted PowerSync service (`:8080`), using the Docker Postgres that both
 * of them share:
 *
 *   1. seed an enrollment for the demo terminal
 *   2. redeem it (device token issued once)
 *   3. exchange the token for a device JWT + config snapshot
 *   4. mint a PowerSync JWT
 *   5. present that JWT to the PowerSync service (rejected only for protocol
 *      reasons, never for authentication)
 *   6. re-check that a revoked device is refused
 *
 * Usage (repo root, API + postgres + powersync running):
 *   DATABASE_URL=postgresql://gikautos:gikautos@localhost:5434/gikautos \
 *     bun run .planning/phases/06-pos-offline-core/evidence/walkthrough-sync.mjs
 */
import { createHmac, randomInt } from 'node:crypto'
import { Client } from 'pg'

const apiUrl = process.env.API_BASE_URL ?? 'http://localhost:4000'
const syncUrl = process.env.POWERSYNC_URL ?? 'http://localhost:8080'
const databaseUrl = process.env.DATABASE_URL
const secret = process.env.BETTER_AUTH_SECRET

if (!databaseUrl || !secret) {
  console.error('DATABASE_URL and BETTER_AUTH_SECRET are required')
  process.exit(2)
}

const failures = []
let checks = 0

function check(condition, label, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
    return
  }
  failures.push(detail ? `${label} (${detail})` : label)
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function code() {
  let value = ''
  for (let index = 0; index < 8; index += 1) value += ALPHABET[randomInt(ALPHABET.length)]
  return value
}

function hashEnrollment(value) {
  return createHmac('sha256', secret)
    .update(value.toUpperCase().replace(/[\s-]/g, ''))
    .digest('hex')
}

const db = new Client({ connectionString: databaseUrl })
await db.connect()

try {
  const terminal = await db.query(
    `SELECT t.id, t.code, b.id AS branch_id, b.code AS branch_code, b.name AS branch_name
       FROM terminal t JOIN branch b ON b.id = t.branch_id
      WHERE t.is_active = true AND b.type = 'RETAIL'
      ORDER BY t.code LIMIT 1`,
  )
  if (terminal.rowCount === 0) {
    console.error('no active retail terminal found; run `bun run db:seed -- --demo`')
    process.exit(2)
  }
  const term = terminal.rows[0]
  console.log(`\nTarget terminal ${term.code} (${term.branch_name})`)

  // 1. enrollment fixture ----------------------------------------------------
  const enrollmentCode = code()
  const enrollment = await db.query(
    `INSERT INTO terminal_enrollment (terminal_id, code_hash, expires_at)
     VALUES ($1, $2, now() + interval '10 minutes')
     RETURNING id`,
    [term.id, hashEnrollment(enrollmentCode)],
  )
  check(enrollment.rowCount === 1, 'enrollment created for the demo terminal')

  // 2. redeem ---------------------------------------------------------------
  const redeemResponse = await fetch(`${apiUrl}/api/enrollments/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: enrollmentCode, fingerprint: 'walkthrough-sync' }),
  })
  const redeemed = await redeemResponse.json()
  check(redeemResponse.status === 201, 'redeem returns 201', `status ${redeemResponse.status}`)
  check(
    typeof redeemed.deviceToken === 'string' && redeemed.deviceToken.length === 43,
    'a 32-byte device token is issued once',
  )
  check(redeemed.terminalId === term.id, 'the device is bound to the terminal', redeemed.terminalId)

  const stored = await db.query(
    'SELECT token_hash, status, fingerprint FROM device WHERE id = $1',
    [redeemed.deviceId],
  )
  check(stored.rows[0]?.token_hash !== redeemed.deviceToken, 'only the token hash is stored')
  check(stored.rows[0]?.status === 'ACTIVE', 'the device starts ACTIVE')

  const reuse = await fetch(`${apiUrl}/api/enrollments/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: enrollmentCode }),
  })
  check(reuse.status === 400, 'the code cannot be redeemed twice', `status ${reuse.status}`)

  // 3. session --------------------------------------------------------------
  const sessionResponse = await fetch(`${apiUrl}/api/pos/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${redeemed.deviceToken}` },
  })
  const session = await sessionResponse.json()
  check(sessionResponse.status === 200, 'session returns 200', `status ${sessionResponse.status}`)
  check(session.branch?.id === term.branch_id, 'session reports the terminal branch')
  check(typeof session.accessToken === 'string', 'session issues a device JWT')
  check(session.config?.serverTimeZone === 'Africa/Accra', 'config carries the server time zone')
  check(session.config?.taxMode === 'INCLUSIVE', 'config carries the tax mode')
  check(
    !JSON.stringify(session).includes(redeemed.deviceToken),
    'the session payload never echoes the device token',
  )
  check(
    !/pinHash|pin_hash|"password"|deviceToken|refreshToken/i.test(JSON.stringify(session.config)),
    'the config snapshot carries no credentials',
  )

  const refresh = await fetch(`${apiUrl}/api/pos/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${redeemed.deviceToken}` },
  })
  check(refresh.status === 200, 'the device token doubles as the refresh credential')

  // 4. PowerSync token ------------------------------------------------------
  const tokenResponse = await fetch(`${apiUrl}/api/pos/powersync/token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.accessToken}` },
  })
  const syncAuth = await tokenResponse.json()
  check(tokenResponse.status === 200, 'PowerSync token endpoint returns 200')
  check(
    syncAuth.endpoint === syncUrl,
    'the endpoint matches the configured instance',
    syncAuth.endpoint,
  )

  const [, payloadPart] = String(syncAuth.token).split('.')
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))
  check(claims.branch_id === term.branch_id, 'the token is scoped to the branch')
  check(claims.terminal_id === term.id, 'the token names the terminal')
  check(claims.aud === syncUrl, 'the audience matches the instance', claims.aud)

  // 5. the service accepts the token ---------------------------------------
  // `POST /sync/stream` is the client endpoint. A garbage token is rejected with
  // 401 PSYNC_S2101, so anything else means our JWT verified (the request then
  // fails on the client protocol parameters, which this script does not send).
  const bogus = await fetch(`${syncUrl}/sync/stream`, {
    method: 'POST',
    headers: { authorization: 'Bearer not-a-jwt', 'content-type': 'application/json' },
    body: '{}',
  })
  check(bogus.status === 401, 'the service rejects a malformed token', `status ${bogus.status}`)

  const syncResponse = await fetch(`${syncUrl}/sync/stream`, {
    method: 'POST',
    headers: { authorization: `Bearer ${syncAuth.token}`, 'content-type': 'application/json' },
    body: '{}',
  })
  check(
    syncResponse.status !== 401 && syncResponse.status !== 403,
    'the PowerSync service verifies our JWT',
    `status ${syncResponse.status}`,
  )

  if (syncResponse.status === 401 || syncResponse.status === 403) {
    console.log('   body:', (await syncResponse.text()).slice(0, 300))
  }

  // 6. revocation -----------------------------------------------------------
  await db.query(`UPDATE device SET status = 'REVOKED', revoked_at = now() WHERE id = $1`, [
    redeemed.deviceId,
  ])
  const revokedSession = await fetch(`${apiUrl}/api/pos/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${redeemed.deviceToken}` },
  })
  check(revokedSession.status === 403, 'a revoked device cannot open a session')

  const revokedToken = await fetch(`${apiUrl}/api/pos/powersync/token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.accessToken}` },
  })
  check(revokedToken.status === 403, 'a revoked device cannot mint a PowerSync token')

  await db.query('DELETE FROM device WHERE id = $1', [redeemed.deviceId])
} finally {
  await db.end()
}

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
