import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Phase 4 phase-verification walkthrough: drives the real HTTP API against the
// freshly migrated + seeded dev database and asserts the credit / loyalty
// ledgers directly in SQL. Mirrors the console flows the browser walkthrough
// exercises and proves the five Phase 4 roadmap criteria.

const API = 'http://localhost:4000'
const ORIGIN = 'http://localhost:3000'
const REPO = '/home/litcorp/Projects/Fullstack/gikautos'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1234'
const WALKTHROUGH_MANAGER_PASSWORD = 'walkthrough-manager-2026'
const WALKTHROUGH_CASHIER_PASSWORD = 'walkthrough-cashier-2026'
const WALKTHROUGH_WH_PASSWORD = 'walkthrough-wh-manager-2026'
const TOTP_FILE = '/tmp/opencode/admin-totp.json'

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', 'gikautos-postgres', 'psql', '-U', 'gikautos', '-d', 'gikautos', '-tAc', query],
    { encoding: 'utf8' },
  ).trim()
}

/** SQL string literal (single-quote escape). */
function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function makeJar() {
  const jar = new Map()
  return {
    header: () => [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; '),
    update(response) {
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(';')[0]
        const index = pair.indexOf('=')
        if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
      }
    },
  }
}

async function request(path, { method = 'GET', cookie = '', body } = {}) {
  const headers = { origin: ORIGIN }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }
  return { status: response.status, body: parsed }
}

async function signIn(email, password) {
  const jar = makeJar()
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  jar.update(response)
  const body = await response.json().catch(() => null)
  return { status: response.status, body, cookie: jar.header() }
}

function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char)
    if (value === -1) continue
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function totpCode(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30)
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buffer.writeUInt32BE(counter % 2 ** 32, 4)
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) %
    1_000_000
  return String(code).padStart(6, '0')
}

async function adminSignIn() {
  const env = readFileSync(`${REPO}/.env`, 'utf8')
  const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\n]*)`, 'm')) ?? [])[1]
  const secret = JSON.parse(readFileSync(TOTP_FILE, 'utf8')).secret
  const jar = makeJar()
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email: envValue('ADMIN_EMAIL'), password: envValue('ADMIN_PASSWORD') }),
  })
  jar.update(response)
  const body = await response.json().catch(() => null)
  if (body?.twoFactorRedirect === true) {
    const verify = await fetch(`${API}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: jar.header() },
      body: JSON.stringify({ code: totpCode(secret) }),
    })
    jar.update(verify)
    return {
      status: verify.status,
      body: await verify.json().catch(() => null),
      cookie: jar.header(),
    }
  }
  return { status: response.status, body, cookie: jar.header() }
}

function isoDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

function daysAgoIso(offsetDays) {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString()
}

function addDaysUtc(isoTimestamp, days) {
  if (!isoTimestamp) return ''
  return new Date(new Date(isoTimestamp).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

const stamp = String(Date.now()).slice(-4)
const mainName = `Walkthrough Credit ${stamp}`
const mainPhone = `024 555 ${stamp}`
const overpayName = `Walkthrough Overpay ${stamp}`
const overpayPhone = `024 556 ${stamp}`
const eraseName = `Walkthrough Erase ${stamp}`
const erasePhone = `024 557 ${stamp}`
const loyaltyName = `Walkthrough Loyalty ${stamp}`
const loyaltyPhone = `024 558 ${stamp}`

console.log(`Phase 4 walkthrough — fresh database, stamp ${stamp}\n`)

// ---------------------------------------------------------------- sessions
console.log('-- Fixtures and sessions --')
const admin = await adminSignIn()
check('admin signs in with password + TOTP', admin.status === 200, `status ${admin.status}`)

let res = await request('/api/branches', { cookie: admin.cookie })
check('admin session is accepted', res.status === 200, `status ${res.status}`)
const branches = res.body?.branches ?? []
const spx = branches.find((branch) => branch.code === 'ACC-SPX')
const wh1 = branches.find((branch) => branch.code === 'ACC-WH1')
check('seeded branches ACC-SPX and ACC-WH1 exist', Boolean(spx && wh1))

const managerSession = await signIn('manager@gikautos.local', DEMO_PASSWORD)
check('demo manager signs in', managerSession.status === 200, `status ${managerSession.status}`)
res = await request('/api/me/password', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { currentPassword: DEMO_PASSWORD, newPassword: WALKTHROUGH_MANAGER_PASSWORD },
})
check('manager clears the forced password change', res.status === 200, `status ${res.status}`)

const cashierSession = await signIn('cashier@gikautos.local', DEMO_PASSWORD)
check('demo cashier signs in', cashierSession.status === 200, `status ${cashierSession.status}`)
res = await request('/api/me/password', {
  method: 'POST',
  cookie: cashierSession.cookie,
  body: { currentPassword: DEMO_PASSWORD, newPassword: WALKTHROUGH_CASHIER_PASSWORD },
})
check('cashier clears the forced password change', res.status === 200, `status ${res.status}`)

res = await request('/api/staff', {
  method: 'POST',
  cookie: admin.cookie,
  body: {
    email: 'walkthrough-wh-manager@gikautos.local',
    name: 'Walkthrough Warehouse Manager',
    role: 'MANAGER',
    branchId: wh1.id,
  },
})
check('admin creates the temporary warehouse manager', res.status === 201, `status ${res.status}`)
const whStaff = res.body?.staff
const whTempPassword = res.body?.temporaryPassword
check(
  'warehouse manager gets a staff id and forced password change',
  /^GA-\d{4}$/.test(whStaff?.staffId ?? '') && whStaff?.mustChangePassword === true,
  whStaff?.staffId,
)

const whSession = await signIn('walkthrough-wh-manager@gikautos.local', whTempPassword)
check('warehouse manager signs in with the temporary password', whSession.status === 200)
res = await request('/api/me/password', {
  method: 'POST',
  cookie: whSession.cookie,
  body: { currentPassword: whTempPassword, newPassword: WALKTHROUGH_WH_PASSWORD },
})
check('warehouse manager sets a real password', res.status === 200, `status ${res.status}`)

res = await request('/api/branches', { cookie: managerSession.cookie })
check(
  'branch manager sees only their own branch',
  res.status === 200 && res.body?.branches?.length === 1 && res.body.branches[0].id === spx.id,
)
res = await request('/api/branches', { cookie: whSession.cookie })
check(
  'warehouse manager sees only their own branch',
  res.status === 200 && res.body?.branches?.length === 1 && res.body.branches[0].id === wh1.id,
)

// ------------------------------------- Criterion 1: global identity
console.log('\n-- Criterion 1: global customer identity with branch-owned credit --')
res = await request('/api/customers', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { name: mainName, phone: mainPhone },
})
check('manager creates a customer at ACC-SPX', res.status === 201, `status ${res.status}`)
const mainCustomer = res.body?.customer
const mainId = mainCustomer?.id
check(
  'customer is owned by the manager branch and active',
  mainCustomer?.createdBranchId === spx.id && mainCustomer?.status === 'ACTIVE',
)

res = await request(`/api/customers?q=${stamp}`, { cookie: whSession.cookie })
check(
  'warehouse manager finds the same customer by phone suffix',
  res.status === 200 && (res.body?.customers ?? []).some((row) => row.id === mainId),
)
res = await request(`/api/customers?q=${encodeURIComponent(mainName)}`, {
  cookie: whSession.cookie,
})
check(
  'warehouse manager finds the same customer by name fragment',
  res.status === 200 && (res.body?.customers ?? []).some((row) => row.id === mainId),
)

res = await request(`/api/customers/${mainId}`, { cookie: whSession.cookie })
check(
  'warehouse manager sees the customer but no credit profile',
  res.status === 200 && (res.body?.creditProfiles ?? []).length === 0,
)

res = await request(`/api/customers/${mainId}`, {
  method: 'PATCH',
  cookie: managerSession.cookie,
  body: { address: '12 Walkthrough Close, Accra' },
})
check('manager updates the customer profile', res.status === 200, `status ${res.status}`)

res = await request(`/api/credit/profiles/${mainId}`, {
  method: 'PUT',
  cookie: managerSession.cookie,
  body: { limitMinor: 50_000, paymentTermDays: 14 },
})
check('manager sets the ACC-SPX credit profile', res.status === 200, `status ${res.status}`)
check(
  'profile carries the limit and terms at ACC-SPX',
  res.body?.profile?.branchId === spx.id &&
    res.body?.profile?.limitMinor === 50_000 &&
    res.body?.profile?.paymentTermDays === 14,
)

res = await request(`/api/customers/${mainId}`, { cookie: managerSession.cookie })
check(
  'branch manager sees the SPX credit profile on the customer',
  (res.body?.creditProfiles ?? []).length === 1 && res.body.creditProfiles[0].branchId === spx.id,
)
res = await request(`/api/customers/${mainId}`, { cookie: whSession.cookie })
check(
  'warehouse manager still sees no credit profile for the SPX customer',
  (res.body?.creditProfiles ?? []).length === 0,
)
res = await request(`/api/credit/profiles?customerId=${mainId}`, { cookie: whSession.cookie })
check(
  'warehouse manager profile list for the customer is empty',
  res.status === 200 && (res.body?.profiles ?? []).length === 0,
)
res = await request(`/api/credit/profiles?branchId=${spx.id}`, { cookie: whSession.cookie })
check(
  'warehouse manager cannot list another branch profiles',
  res.status === 403,
  `status ${res.status}`,
)

// ------------------------------------- Criterion 2: credit ledger
console.log('\n-- Criterion 2: append-only credit ledger with limit enforcement --')
res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: {
    customerId: mainId,
    kind: 'CHARGE',
    amountMinor: 30_000,
    reasonCode: 'OPENING_BALANCE',
  },
})
check('opening charge posts', res.status === 201, `status ${res.status}`)
const c1 = res.body?.entry
check(
  'opening charge carries the payment-term due date',
  c1?.dueDate === addDaysUtc(c1?.occurredAt, 14),
  `${c1?.dueDate} vs ${c1?.occurredAt}`,
)
check('balance projects to GHS 300.00', res.body?.profile?.balanceMinor === 30_000)

res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: mainId, kind: 'CHARGE', amountMinor: 25_000, reasonCode: 'SALE' },
})
check('charge over the limit is refused', res.status === 409, `status ${res.status}`)
check(
  'refusal names the limit rule',
  (res.body?.error?.message ?? '').includes('exceeds the credit limit'),
  res.body?.error?.message,
)

res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: {
    customerId: mainId,
    kind: 'CHARGE',
    amountMinor: 25_000,
    reasonCode: 'SALE',
    override: { reasonCode: 'TEMPORARY_APPROVAL', note: 'Walkthrough override' },
  },
})
check('manager override posts the over-limit charge', res.status === 201, `status ${res.status}`)
const c2 = res.body?.entry
check(
  'entry records the override reason and approver',
  c2?.overrideReason === 'TEMPORARY_APPROVAL' && /^GA-\d{4}$/.test(c2?.overriddenBy ?? ''),
  `${c2?.overrideReason ?? ''} by ${c2?.overriddenBy ?? ''}`,
)
check('balance projects to GHS 550.00', res.body?.profile?.balanceMinor === 55_000)

const overrideAudit = sql(
  `SELECT count(*) FROM audit_log WHERE action = 'credit.override' AND entity_id = ${q(c2?.id)} AND after->>'reasonCode' = 'TEMPORARY_APPROVAL'`,
)
check('override is audited with the reason code', overrideAudit === '1', `rows ${overrideAudit}`)

res = await request(`/api/credit/entries?customerId=${mainId}&branchId=${spx.id}`, {
  cookie: managerSession.cookie,
})
check(
  'entry list shows both charges newest-first',
  res.status === 200 && res.body?.total === 2 && res.body?.entries?.[0]?.kind === 'CHARGE',
  `total ${res.body?.total}`,
)

res = await request(`/api/credit/profiles/${mainId}`, {
  method: 'PUT',
  cookie: managerSession.cookie,
  body: { limitMinor: 500_000 },
})
check('manager raises the limit for the walkthrough window', res.status === 200)

const backdatedCharges = [
  { amountMinor: 10_000, occurredDays: 24, dueDays: 10, key: 'c3' },
  { amountMinor: 15_000, occurredDays: 54, dueDays: 40, key: 'c4' },
  { amountMinor: 12_000, occurredDays: 89, dueDays: 75, key: 'c5' },
  { amountMinor: 8_000, occurredDays: 134, dueDays: 120, key: 'c6' },
]
const chargeIds = { c1: c1.id, c2: c2.id }
for (const charge of backdatedCharges) {
  res = await request('/api/credit/entries', {
    method: 'POST',
    cookie: managerSession.cookie,
    body: {
      customerId: mainId,
      kind: 'CHARGE',
      amountMinor: charge.amountMinor,
      reasonCode: 'SALE',
      occurredAt: daysAgoIso(charge.occurredDays),
      dueDate: isoDay(-charge.dueDays),
    },
  })
  check(`backdated charge ${charge.key} posts`, res.status === 201, `status ${res.status}`)
  chargeIds[charge.key] = res.body?.entry?.id
}
check(
  'balance projects to GHS 1000.00 after backdated charges',
  res.body?.profile?.balanceMinor === 100_000,
)

const idempotencyKey = `walkthrough-credit-idem-${stamp}`
res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: {
    customerId: mainId,
    kind: 'CHARGE',
    amountMinor: 1_000,
    reasonCode: 'SALE',
    idempotencyKey,
  },
})
check('idempotent charge posts', res.status === 201, `status ${res.status}`)
chargeIds.c7 = res.body?.entry?.id
const replay = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: {
    customerId: mainId,
    kind: 'CHARGE',
    amountMinor: 1_000,
    reasonCode: 'SALE',
    idempotencyKey,
  },
})
check(
  'replaying the idempotency key returns the same entry',
  replay.body?.entry?.id === chargeIds.c7,
  `${replay.body?.entry?.id} vs ${chargeIds.c7}`,
)
const idemRows = sql(
  `SELECT count(*) FROM credit_ledger_entry WHERE branch_id = ${q(spx.id)} AND idempotency_key = ${q(idempotencyKey)}`,
)
check('the ledger holds exactly one entry for the key', idemRows === '1', `rows ${idemRows}`)

res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: mainId, kind: 'REFUND', amountMinor: 3_000, reasonCode: 'RETURN' },
})
check('refund posts', res.status === 201, `status ${res.status}`)
check('refund is stored negative', res.body?.entry?.amountMinor === -3_000)
check('balance projects to GHS 980.00 after the refund', res.body?.profile?.balanceMinor === 98_000)

// ------------------------------------- Criterion 3: repayment + FIFO
console.log('\n-- Criterion 3: repayments, FIFO settlement, statement, aging --')
res = await request('/api/credit/repayments', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: mainId, amountMinor: 4_000, method: 'CASH' },
})
check('repayment posts', res.status === 201, `status ${res.status}`)
const repayment = res.body?.entry
check('repayment is stored negative', repayment?.amountMinor === -4_000)
check(
  'repayment allocates the REP receipt number',
  /^REP-\d{5}$/.test(repayment?.referenceNumber ?? ''),
  repayment?.referenceNumber,
)
check(
  'first walkthrough receipt follows the seeded opening repayment (REP-00002)',
  repayment?.referenceNumber === 'REP-00002',
  repayment?.referenceNumber,
)
check('balance projects to GHS 940.00', res.body?.profile?.balanceMinor === 94_000)

const fifoRows = sql(
  `WITH totals AS (
     SELECT COALESCE(SUM(-amount_minor), 0) AS credit FROM credit_ledger_entry
     WHERE customer_id = ${q(mainId)} AND branch_id = ${q(spx.id)} AND amount_minor < 0
   ), charges AS (
     SELECT id, amount_minor,
            COALESCE(SUM(amount_minor) OVER (
              ORDER BY occurred_at, created_at, id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0) AS before_minor
     FROM credit_ledger_entry
     WHERE customer_id = ${q(mainId)} AND branch_id = ${q(spx.id)} AND kind = 'CHARGE'
   )
   SELECT charges.id::text || '|' ||
          (charges.amount_minor - GREATEST(0, LEAST(charges.amount_minor, (SELECT credit FROM totals) - charges.before_minor)))::text
   FROM charges`,
)
const fifoOutstanding = new Map(
  fifoRows
    .split('\n')
    .filter(Boolean)
    .map((row) => row.split('|')),
)
const expectedOutstanding = new Map([
  [chargeIds.c6, '1000'],
  [chargeIds.c5, '12000'],
  [chargeIds.c4, '15000'],
  [chargeIds.c3, '10000'],
  [chargeIds.c1, '30000'],
  [chargeIds.c2, '25000'],
  [chargeIds.c7, '1000'],
])
check(
  'FIFO reconstruction settles oldest charges first (7 charges, 1 partial)',
  fifoOutstanding.size === 7 &&
    [...expectedOutstanding].every(([id, expected]) => fifoOutstanding.get(id) === expected),
  JSON.stringify(Object.fromEntries(fifoOutstanding)),
)

res = await request(`/api/credit/statements/${mainId}?branchId=${spx.id}`, {
  cookie: managerSession.cookie,
})
check('statement opens for the customer', res.status === 200, `status ${res.status}`)
const statement = res.body
check(
  'full statement opens at zero and closes at the balance',
  statement?.openingBalanceMinor === 0 &&
    statement?.closingBalanceMinor === 94_000 &&
    statement?.currentBalanceMinor === 94_000,
  `closing ${statement?.closingBalanceMinor}`,
)
check(
  'statement lists all nine ledger rows',
  statement?.entries?.length === 9,
  `${statement?.entries?.length}`,
)
const agingFromStatement = new Map(
  (statement?.aging ?? []).map((row) => [row.entryId, String(row.outstandingMinor)]),
)
check(
  'statement aging matches the FIFO per-charge outstanding',
  agingFromStatement.size === 7 &&
    [...expectedOutstanding].every(([id, expected]) => agingFromStatement.get(id) === expected),
)

res = await request(`/api/credit/statements/${mainId}?branchId=${spx.id}&from=${isoDay(-30)}`, {
  cookie: managerSession.cookie,
})
check(
  'windowed statement opens with the pre-window balance',
  res.body?.openingBalanceMinor === 35_000 && res.body?.closingBalanceMinor === 94_000,
  `opening ${res.body?.openingBalanceMinor}, closing ${res.body?.closingBalanceMinor}`,
)
check('windowed statement lists the six in-range rows', res.body?.entries?.length === 6)

res = await request(`/api/credit/aging?branchId=${spx.id}`, { cookie: managerSession.cookie })
const spxAging = (res.body?.branches ?? []).find((branch) => branch.branch?.id === spx.id)
const mainAgingRow = (spxAging?.customers ?? []).find((row) => row.customerId === mainId)
check(
  'aging buckets match the hand-computed FIFO outstanding',
  mainAgingRow?.buckets?.current === 56_000 &&
    mainAgingRow?.buckets?.days1To30 === 10_000 &&
    mainAgingRow?.buckets?.days31To60 === 15_000 &&
    mainAgingRow?.buckets?.days61To90 === 12_000 &&
    mainAgingRow?.buckets?.over90 === 1_000 &&
    mainAgingRow?.totalMinor === 94_000,
  JSON.stringify(mainAgingRow?.buckets ?? {}),
)
check(
  'aging reports the oldest due date',
  mainAgingRow?.oldestDueDate === isoDay(-120),
  mainAgingRow?.oldestDueDate,
)

res = await request(`/api/credit/aging?branchId=${spx.id}&asOf=${isoDay(-31)}`, {
  cookie: managerSession.cookie,
})
const spxAgingPast = (res.body?.branches ?? []).find((branch) => branch.branch?.id === spx.id)
const mainAgingPast = (spxAgingPast?.customers ?? []).find((row) => row.customerId === mainId)
check(
  'aging as-of a past date re-buckets the same settlement',
  mainAgingPast?.buckets?.current === 66_000 &&
    mainAgingPast?.buckets?.days1To30 === 15_000 &&
    mainAgingPast?.buckets?.days31To60 === 12_000 &&
    mainAgingPast?.buckets?.days61To90 === 1_000 &&
    mainAgingPast?.buckets?.over90 === 0 &&
    mainAgingPast?.totalMinor === 94_000,
  JSON.stringify(mainAgingPast?.buckets ?? {}),
)

res = await request('/api/customers', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { name: overpayName, phone: overpayPhone },
})
const overpayId = res.body?.customer?.id
check('overpay customer created', res.status === 201, `status ${res.status}`)
await request(`/api/credit/profiles/${overpayId}`, {
  method: 'PUT',
  cookie: managerSession.cookie,
  body: { limitMinor: 10_000, paymentTermDays: 0 },
})
res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: overpayId, kind: 'CHARGE', amountMinor: 10_000, reasonCode: 'SALE' },
})
check('overpay charge posts', res.status === 201, `status ${res.status}`)
res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: overpayId, kind: 'REFUND', amountMinor: 3_000, reasonCode: 'RETURN' },
})
check(
  'refund reduces the principal owed',
  res.body?.profile?.balanceMinor === 7_000,
  `${res.body?.profile?.balanceMinor}`,
)
res = await request('/api/credit/repayments', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: overpayId, amountMinor: 25_000, method: 'CASH' },
})
check(
  'overpayment leaves a negative credit balance',
  res.status === 201 && res.body?.profile?.balanceMinor === -18_000,
  `${res.body?.profile?.balanceMinor}`,
)
check('second repayment gets REP-00003', res.body?.entry?.referenceNumber === 'REP-00003')
res = await request(`/api/credit/statements/${overpayId}?branchId=${spx.id}`, {
  cookie: managerSession.cookie,
})
check(
  'overpay statement settles to the negative balance with no aging rows',
  res.body?.currentBalanceMinor === -18_000 && (res.body?.aging ?? []).length === 0,
)

// ------------------------------------- Criterion 4: loyalty
console.log('\n-- Criterion 4: loyalty earn, FEFO redeem, adjust, expiry, clawback --')
res = await request('/api/customers', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { name: loyaltyName, phone: loyaltyPhone },
})
const loyaltyId = res.body?.customer?.id
check('loyalty customer created', res.status === 201, `status ${res.status}`)

res = await request('/api/loyalty/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: loyaltyId, kind: 'EARN', netPaidMinor: 50 },
})
check(
  'an earn that floors to zero points writes nothing',
  res.status === 201 && res.body?.entry === null && res.body?.account?.balancePoints === 0,
)

const loyaltyIdemKey = `walkthrough-loyalty-idem-${stamp}`
res = await request('/api/loyalty/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: {
    customerId: loyaltyId,
    kind: 'EARN',
    netPaidMinor: 20_000,
    occurredAt: daysAgoIso(40),
    idempotencyKey: loyaltyIdemKey,
  },
})
check(
  'backdated earn posts 200 points',
  res.body?.entry?.pointsDelta === 200,
  `${res.body?.entry?.pointsDelta}`,
)
const lotA = res.body?.lot
const loyaltyAccountId = res.body?.account?.id
check('earn creates the first FEFO lot', lotA?.points === 200 && lotA?.remainingPoints === 200)
const earnAEntryId = res.body?.entry?.id
const loyaltyReplay = await request('/api/loyalty/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: {
    customerId: loyaltyId,
    kind: 'EARN',
    netPaidMinor: 20_000,
    occurredAt: daysAgoIso(40),
    idempotencyKey: loyaltyIdemKey,
  },
})
check('loyalty idempotency replays the same entry', loyaltyReplay.body?.entry?.id === earnAEntryId)
const loyaltyIdemRows = sql(
  `SELECT count(*) FROM loyalty_ledger_entry WHERE idempotency_key = ${q(loyaltyIdemKey)}`,
)
check('the loyalty ledger holds exactly one earn for the key', loyaltyIdemRows === '1')

res = await request('/api/loyalty/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: loyaltyId, kind: 'EARN', netPaidMinor: 30_000 },
})
const lotB = res.body?.lot
check(
  'second earn posts 300 points in a later lot',
  res.body?.entry?.pointsDelta === 300 && lotB?.points === 300,
)
check('balance is 500 points', res.body?.account?.balancePoints === 500)

res = await request('/api/loyalty/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: loyaltyId, kind: 'REDEEM', points: 250 },
})
check(
  'redeem posts 250 points',
  res.status === 201 && res.body?.entry?.pointsDelta === -250,
  `status ${res.status}`,
)
const redeemEntryId = res.body?.entry?.id
check(
  'redeem quote values the points at the configured rate',
  res.body?.quote?.points === 250 && res.body?.quote?.discountMinor === 250,
  JSON.stringify(res.body?.quote ?? {}),
)
const consumption = res.body?.consumption ?? []
check(
  'FEFO consumes the earliest-expiry lot first',
  consumption.length === 2 &&
    consumption[0]?.lotId === lotA.id &&
    consumption[0]?.points === 200 &&
    consumption[1]?.lotId === lotB.id &&
    consumption[1]?.points === 50,
  JSON.stringify(consumption.map((row) => [row.lotId, row.points])),
)
check('balance is 250 points after the redeem', res.body?.account?.balancePoints === 250)
const lotRemaining = sql(
  `SELECT id || '|' || remaining_points FROM loyalty_lot WHERE id IN (${q(lotA.id)}, ${q(lotB.id)})`,
)
const remainingMap = new Map(
  lotRemaining
    .split('\n')
    .filter(Boolean)
    .map((row) => row.split('|')),
)
check(
  'lot balances zero the consumed lot and leave 250 in the newer lot',
  remainingMap.get(lotA.id) === '0' && remainingMap.get(lotB.id) === '250',
  JSON.stringify(Object.fromEntries(remainingMap)),
)
const redeemConsumption = sql(
  `SELECT lot_id || '|' || points FROM loyalty_lot_consumption WHERE entry_id = ${q(redeemEntryId)} ORDER BY created_at`,
)
check(
  'consumption rows are stored for both lots',
  redeemConsumption === `${lotA.id}|200\n${lotB.id}|50`,
  redeemConsumption,
)

res = await request('/api/loyalty/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: loyaltyId, kind: 'ADJUST', points: 50, reasonCode: 'GOODWILL' },
})
const lotC = res.body?.lot
check(
  'positive adjustment posts with a reason and creates a lot',
  res.body?.entry?.pointsDelta === 50 &&
    res.body?.entry?.reasonCode === 'GOODWILL' &&
    lotC?.points === 50,
)
check('balance is 300 points after the adjustment', res.body?.account?.balancePoints === 300)

sql(`UPDATE loyalty_lot SET expires_at = now() - interval '1 day' WHERE id = ${q(lotB.id)}`)
res = await request('/api/loyalty/expiry-run', { method: 'POST', cookie: admin.cookie })
check(
  'expiry run expires the backdated lot',
  res.status === 200 &&
    res.body?.accounts === 1 &&
    res.body?.lots === 1 &&
    res.body?.points === 250,
  JSON.stringify(res.body ?? {}),
)
const expireRow = sql(
  `SELECT points_delta || '|' || (branch_id IS NULL) || '|' || (created_by IS NULL) || '|' || reason_code
   FROM loyalty_ledger_entry WHERE account_id = ${q(loyaltyAccountId)} AND kind = 'EXPIRE'`,
)
check(
  'EXPIRE entry is negative, global, job-written, reason EXPIRY',
  expireRow === '-250|true|true|EXPIRY',
  expireRow,
)
check(
  'expired lot is zeroed',
  sql(`SELECT remaining_points FROM loyalty_lot WHERE id = ${q(lotB.id)}`) === '0',
)
res = await request(`/api/loyalty/accounts/${loyaltyId}`, { cookie: managerSession.cookie })
check('balance is 50 points after the expiry', res.body?.balancePoints === 50)
res = await request('/api/loyalty/expiry-run', { method: 'POST', cookie: admin.cookie })
check(
  'a second expiry run changes nothing',
  res.body?.accounts === 0 && res.body?.lots === 0 && res.body?.points === 0,
  JSON.stringify(res.body ?? {}),
)

res = await request('/api/loyalty/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: loyaltyId, kind: 'CLAWBACK', points: 400, reasonCode: 'RETURN' },
})
check('clawback posts and drives the balance negative', res.body?.entry?.pointsDelta === -400)
check('balance is -350 points after the clawback', res.body?.account?.balancePoints === -350)
check(
  'clawback drains the remaining adjustment lot',
  sql(`SELECT remaining_points FROM loyalty_lot WHERE id = ${q(lotC.id)}`) === '0',
)

res = await request(`/api/loyalty/accounts/${loyaltyId}`, { cookie: managerSession.cookie })
check('account detail reports the negative balance', res.body?.balancePoints === -350)
check('account detail returns all three lots expiry-ascending', (res.body?.lots ?? []).length === 3)
check('account detail counts six entries', res.body?.entryTotal === 6, `${res.body?.entryTotal}`)
check(
  'newest history entry is the clawback',
  (res.body?.entries ?? [])[0]?.kind === 'CLAWBACK',
  (res.body?.entries ?? [])[0]?.kind,
)

res = await request('/api/loyalty/liability', { cookie: admin.cookie })
const liability = res.body
check(
  'liability resolves the redemption rate',
  liability?.pointsPerCedi === 100,
  `${liability?.pointsPerCedi}`,
)
check(
  'liability outstanding reconciles with the rate',
  liability?.outstandingValueMinor ===
    Math.floor((liability?.outstandingPoints * 100) / liability?.pointsPerCedi),
  `${liability?.outstandingPoints} → ${liability?.outstandingValueMinor}`,
)
check(
  'outstanding points are the net of every account',
  liability?.outstandingPoints === 250 + -350,
  `${liability?.outstandingPoints}`,
)
check(
  'negative balance is flagged with its owner',
  (liability?.negativeBalances ?? []).length === 1 &&
    liability.negativeBalances[0].customerId === loyaltyId &&
    liability.negativeBalances[0].balancePoints === -350 &&
    liability.negativeBalances[0].branchId === spx.id,
  JSON.stringify(liability?.negativeBalances ?? []),
)
check(
  'expiring-soon exposure is zero on a fresh seed',
  liability?.expiringSoonPoints === 0,
  `${liability?.expiringSoonPoints}`,
)
const spxActivity = (liability?.activity?.rows ?? []).find((row) => row.branchId === spx.id)
check(
  'SPX activity totals reconcile the postings (incl. seeded 250)',
  spxActivity?.earnedPoints === 750 &&
    spxActivity?.redeemedPoints === 250 &&
    spxActivity?.clawedBackPoints === 400 &&
    spxActivity?.adjustedPoints === 50 &&
    spxActivity?.netPoints === 150,
  JSON.stringify(spxActivity ?? {}),
)
const globalActivity = (liability?.activity?.rows ?? []).find((row) => row.branchId === null)
check('global expiry row carries the expired points', globalActivity?.expiredPoints === 250)

res = await request('/api/loyalty/liability', { cookie: managerSession.cookie })
check(
  'manager liability rows are scoped to SPX plus global expiry',
  (res.body?.activity?.rows ?? []).every(
    (row) => row.branchId === null || row.branchId === spx.id,
  ) && (res.body?.activity?.rows ?? []).some((row) => row.branchId === spx.id),
)
check(
  'manager sees the negative balance their branch owns',
  (res.body?.negativeBalances ?? []).some((row) => row.customerId === loyaltyId),
)
res = await request('/api/loyalty/liability', { cookie: whSession.cookie })
check(
  'warehouse manager does not see SPX loyalty activity',
  (res.body?.activity?.rows ?? []).every((row) => row.branchId === null),
)
check(
  'warehouse manager does not see the SPX negative balance',
  !(res.body?.negativeBalances ?? []).some((row) => row.customerId === loyaltyId),
)

// ------------------------------------- Criterion 5: scoping + permissions
console.log('\n-- Criterion 5: branch scoping, permissions, idempotency --')
res = await request(`/api/credit/profiles/${mainId}`, {
  method: 'PUT',
  cookie: whSession.cookie,
  body: { branchId: wh1.id, limitMinor: 20_000, paymentTermDays: 7 },
})
check(
  'warehouse manager opens a WH1 profile for the same customer',
  res.status === 200 && res.body?.profile?.branchId === wh1.id,
)
res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: whSession.cookie,
  body: {
    customerId: mainId,
    branchId: wh1.id,
    kind: 'CHARGE',
    amountMinor: 5_000,
    reasonCode: 'SALE',
  },
})
check(
  'warehouse manager posts against the WH1 profile',
  res.status === 201 && res.body?.profile?.balanceMinor === 5_000,
)

res = await request(`/api/credit/profiles?customerId=${mainId}`, { cookie: managerSession.cookie })
check(
  'each branch profile keeps its own balance',
  (res.body?.profiles ?? []).length === 1 &&
    res.body.profiles[0].branchId === spx.id &&
    res.body.profiles[0].balanceMinor === 94_000,
)
res = await request(`/api/credit/profiles?customerId=${mainId}`, { cookie: whSession.cookie })
check(
  'warehouse profile is isolated from the SPX balance',
  (res.body?.profiles ?? []).length === 1 &&
    res.body.profiles[0].branchId === wh1.id &&
    res.body.profiles[0].balanceMinor === 5_000,
)
res = await request(`/api/customers/${mainId}`, { cookie: whSession.cookie })
check(
  'warehouse customer detail shows only the WH1 profile',
  (res.body?.creditProfiles ?? []).length === 1 && res.body.creditProfiles[0].branchId === wh1.id,
)

res = await request('/api/credit/aging', { cookie: admin.cookie })
const adminAgingBranches = res.body?.branches ?? []
const adminSpx = adminAgingBranches.find((branch) => branch.branch?.id === spx.id)
const adminWh1 = adminAgingBranches.find((branch) => branch.branch?.id === wh1.id)
check(
  'admin aging shows both branches separately',
  (adminSpx?.customers ?? []).some(
    (row) => row.customerId === mainId && row.totalMinor === 94_000,
  ) &&
    (adminWh1?.customers ?? []).some(
      (row) => row.customerId === mainId && row.totalMinor === 5_000,
    ),
)
res = await request('/api/credit/aging', { cookie: managerSession.cookie })
check(
  'manager aging covers only their branch',
  (res.body?.branches ?? []).length === 1 && res.body.branches[0].branch?.id === spx.id,
)
res = await request('/api/credit/aging', { cookie: whSession.cookie })
check(
  'warehouse manager aging covers only their branch',
  (res.body?.branches ?? []).length === 1 && res.body.branches[0].branch?.id === wh1.id,
)

const denials = [
  ['GET', `/api/credit/entries?customerId=${mainId}&branchId=${spx.id}`, undefined],
  ['GET', `/api/credit/statements/${mainId}?branchId=${spx.id}`, undefined],
  ['GET', `/api/credit/aging?branchId=${spx.id}`, undefined],
  [
    'POST',
    '/api/credit/entries',
    { customerId: mainId, branchId: spx.id, kind: 'CHARGE', amountMinor: 100, reasonCode: 'SALE' },
  ],
  [
    'POST',
    '/api/credit/repayments',
    { customerId: mainId, branchId: spx.id, amountMinor: 100, method: 'CASH' },
  ],
]
for (const [method, path, body] of denials) {
  res = await request(path, { method, cookie: whSession.cookie, body })
  check(
    `warehouse manager denied ${method} ${path.split('?')[0]} across branches`,
    res.status === 403,
    `status ${res.status}`,
  )
}
for (const [method, path, body] of [
  [
    'POST',
    '/api/credit/entries',
    { customerId: mainId, branchId: wh1.id, kind: 'CHARGE', amountMinor: 100, reasonCode: 'SALE' },
  ],
  ['GET', `/api/credit/statements/${mainId}?branchId=${wh1.id}`, undefined],
]) {
  res = await request(path, { method, cookie: managerSession.cookie, body })
  check(
    `SPX manager denied ${method} ${path.split('?')[0]} into WH1`,
    res.status === 403,
    `status ${res.status}`,
  )
}

res = await request('/api/loyalty/expiry-run', { method: 'POST', cookie: managerSession.cookie })
check('manager cannot run the loyalty expiry job', res.status === 403, `status ${res.status}`)
res = await request('/api/settings', {
  method: 'PATCH',
  cookie: managerSession.cookie,
  body: { key: 'loyalty.minimumRedeemPoints', value: 200 },
})
check('manager cannot change global settings', res.status === 403, `status ${res.status}`)

res = await request('/api/customers', { cookie: cashierSession.cookie })
check('cashier cannot list customers', res.status === 403, `status ${res.status}`)
res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: cashierSession.cookie,
  body: { customerId: loyaltyId, kind: 'CHARGE', amountMinor: 100, reasonCode: 'SALE' },
})
check('cashier cannot post credit entries', res.status === 403, `status ${res.status}`)
res = await request('/api/loyalty/liability', { cookie: cashierSession.cookie })
check('cashier cannot read the loyalty liability', res.status === 403, `status ${res.status}`)

// ------------------------------------- Lifecycle + anonymization + reconciliation
console.log('\n-- Customer lifecycle, anonymization, reconciliation, audit --')
res = await request('/api/customers', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { name: eraseName, phone: erasePhone },
})
const eraseId = res.body?.customer?.id
check('erase customer created', res.status === 201, `status ${res.status}`)
await request(`/api/credit/profiles/${eraseId}`, {
  method: 'PUT',
  cookie: managerSession.cookie,
  body: { limitMinor: 100_000 },
})
res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: eraseId, kind: 'CHARGE', amountMinor: 5_000, reasonCode: 'SALE' },
})
check('erase customer charge posts', res.status === 201)
res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: eraseId, kind: 'ADJUSTMENT', amountMinor: -500, reasonCode: 'CORRECTION' },
})
check('signed adjustment posts', res.status === 201 && res.body?.profile?.balanceMinor === 4_500)

res = await request(`/api/customers/${eraseId}/archive`, {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { note: 'Walkthrough archive attempt' },
})
check('manager cannot archive a customer', res.status === 403, `status ${res.status}`)
res = await request(`/api/customers/${eraseId}/anonymize`, {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { note: 'Walkthrough erase attempt' },
})
check('manager cannot anonymize a customer', res.status === 403, `status ${res.status}`)

res = await request(`/api/customers/${eraseId}/archive`, {
  method: 'POST',
  cookie: admin.cookie,
  body: { note: 'Walkthrough archive' },
})
check(
  'admin archives the customer',
  res.status === 200 && res.body?.customer?.status === 'ARCHIVED',
)
res = await request('/api/credit/entries', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: eraseId, kind: 'CHARGE', amountMinor: 100, reasonCode: 'SALE' },
})
check(
  'archived customers cannot be charged new credit',
  res.status === 409 && (res.body?.error?.message ?? '').includes('Archived customers'),
  res.body?.error?.message,
)
res = await request(`/api/customers/${eraseId}/reactivate`, {
  method: 'POST',
  cookie: admin.cookie,
})
check(
  'admin reactivates the customer',
  res.status === 200 && res.body?.customer?.status === 'ACTIVE',
)
res = await request('/api/credit/repayments', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { customerId: eraseId, amountMinor: 4_500, method: 'CASH' },
})
check('erase customer settles to zero', res.status === 201 && res.body?.profile?.balanceMinor === 0)

res = await request(`/api/customers/${mainId}/anonymize`, {
  method: 'POST',
  cookie: admin.cookie,
  body: { note: 'Walkthrough erase attempt' },
})
check(
  'anonymize blocked while credit is unreconciled',
  res.status === 409 &&
    (res.body?.error?.message ?? '').includes('unreconciled credit at ACC-SPX: GHS 940.00'),
  res.body?.error?.message,
)
res = await request(`/api/customers/${loyaltyId}/anonymize`, {
  method: 'POST',
  cookie: admin.cookie,
  body: { note: 'Walkthrough erase attempt' },
})
check(
  'anonymize blocked while loyalty points are unreconciled',
  res.status === 409 &&
    (res.body?.error?.message ?? '').includes('-350 unreconciled loyalty points remain'),
  res.body?.error?.message,
)

res = await request(`/api/customers/${eraseId}/anonymize`, {
  method: 'POST',
  cookie: admin.cookie,
  body: { note: 'Walkthrough erase' },
})
check(
  'zero-balance customer is anonymized',
  res.status === 200 &&
    res.body?.customer?.name === 'Anonymized customer' &&
    res.body?.customer?.phone === null,
  `status ${res.status}`,
)
const erasedRow = sql(
  `SELECT name || '|' || (phone IS NULL) || '|' || (anonymized_at IS NOT NULL) FROM customer WHERE id = ${q(eraseId)}`,
)
check(
  'anonymized row scrubs PII but keeps the record',
  erasedRow === 'Anonymized customer|true|true',
  erasedRow,
)
const erasedEntries = sql(
  `SELECT count(*) FROM credit_ledger_entry WHERE customer_id = ${q(eraseId)}`,
)
check(
  'anonymization keeps the credit ledger intact',
  erasedEntries === '3',
  `rows ${erasedEntries}`,
)
res = await request(`/api/customers?q=${encodeURIComponent('Walkthrough Erase')}`, {
  cookie: admin.cookie,
})
check(
  'anonymized customers disappear from the name search',
  res.body?.total === 0,
  `total ${res.body?.total}`,
)
res = await request(`/api/customers?q=${stamp}`, { cookie: admin.cookie })
check(
  'anonymized customer is absent from the phone-suffix search',
  !(res.body?.customers ?? []).some((row) => row.id === eraseId),
)

const creditDivergences = sql(
  `SELECT count(*) FROM credit_profile p
   LEFT JOIN (
     SELECT customer_id, branch_id, SUM(amount_minor) AS ledger FROM credit_ledger_entry GROUP BY 1, 2
   ) l ON l.customer_id = p.customer_id AND l.branch_id = p.branch_id
   WHERE p.balance_minor <> COALESCE(l.ledger, 0)`,
)
check(
  'credit reconciliation: profiles match their ledger',
  creditDivergences === '0',
  `divergences ${creditDivergences}`,
)
const orphanEntries = sql(
  `SELECT count(*) FROM credit_ledger_entry e
   LEFT JOIN credit_profile p ON p.customer_id = e.customer_id AND p.branch_id = e.branch_id
   WHERE p.id IS NULL`,
)
check(
  'credit reconciliation: no entries without a profile',
  orphanEntries === '0',
  `orphans ${orphanEntries}`,
)

const loyaltyDivergences = sql(
  `SELECT count(*) FROM loyalty_account a
   LEFT JOIN (
     SELECT account_id, COALESCE(SUM(points_delta), 0) AS points FROM loyalty_ledger_entry GROUP BY 1
   ) e ON e.account_id = a.id
   WHERE a.balance_points <> COALESCE(e.points, 0)`,
)
check(
  'loyalty reconciliation: balances match the ledger',
  loyaltyDivergences === '0',
  `divergences ${loyaltyDivergences}`,
)
const lotDivergences = sql(
  `SELECT count(*) FROM loyalty_account a
   LEFT JOIN (
     SELECT account_id, SUM(remaining_points) AS remaining FROM loyalty_lot GROUP BY 1
   ) l ON l.account_id = a.id
   LEFT JOIN (
     SELECT e.account_id,
            SUM(CASE WHEN e.points_delta > 0 THEN e.points_delta ELSE 0 END) -
            COALESCE((SELECT SUM(c.points) FROM loyalty_lot_consumption c
                      JOIN loyalty_lot lo ON lo.id = c.lot_id WHERE lo.account_id = e.account_id), 0) AS expected
     FROM loyalty_ledger_entry e GROUP BY e.account_id
   ) x ON x.account_id = a.id
   WHERE COALESCE(l.remaining, 0) <> COALESCE(x.expected, 0)`,
)
check(
  'loyalty reconciliation: lots match earn-minus-consumption',
  lotDivergences === '0',
  `divergences ${lotDivergences}`,
)
const negativeLots = sql(`SELECT count(*) FROM loyalty_lot WHERE remaining_points < 0`)
check('loyalty reconciliation: no negative lots', negativeLots === '0', `rows ${negativeLots}`)

const auditActions = sql(
  `SELECT action || '|' || count(*)::text FROM audit_log
   WHERE action IN (
     'customer.created', 'customer.updated', 'customer.archived', 'customer.reactivated',
     'customer.anonymized', 'credit.charge', 'credit.repayment', 'credit.refund',
     'credit.adjustment', 'credit.profile_updated', 'credit.override', 'loyalty.earned',
     'loyalty.redeemed', 'loyalty.adjusted', 'loyalty.clawback', 'loyalty.expiry_run'
   ) GROUP BY action`,
)
const auditMap = new Map(
  auditActions
    .split('\n')
    .filter(Boolean)
    .map((row) => row.split('|')),
)
const expectedAudits = [
  'customer.created',
  'customer.updated',
  'customer.archived',
  'customer.reactivated',
  'customer.anonymized',
  'credit.charge',
  'credit.repayment',
  'credit.refund',
  'credit.adjustment',
  'credit.profile_updated',
  'credit.override',
  'loyalty.earned',
  'loyalty.redeemed',
  'loyalty.adjusted',
  'loyalty.clawback',
  'loyalty.expiry_run',
]
const missingAudits = expectedAudits.filter((action) => !auditMap.has(action))
check('every walkthrough action is audited', missingAudits.length === 0, missingAudits.join(', '))

res = await request('/api/customers?q=Kwame', { cookie: admin.cookie })
const kwameId = (res.body?.customers ?? []).find((row) => row.name?.startsWith('Kwame'))?.id
res = await request(`/api/loyalty/accounts/${kwameId}`, { cookie: admin.cookie })
check(
  'demo loyalty fixture is untouched at 250 points',
  res.body?.balancePoints === 250,
  `${res.body?.balancePoints}`,
)

// ------------------------------------- Restore + cleanup
console.log('\n-- Restore demo sessions and clean up --')
res = await request('/api/me/password', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { currentPassword: WALKTHROUGH_MANAGER_PASSWORD, newPassword: DEMO_PASSWORD },
})
check('manager password restored to the demo value', res.status === 200, `status ${res.status}`)
res = await request('/api/me/password', {
  method: 'POST',
  cookie: cashierSession.cookie,
  body: { currentPassword: WALKTHROUGH_CASHIER_PASSWORD, newPassword: DEMO_PASSWORD },
})
check('cashier password restored to the demo value', res.status === 200, `status ${res.status}`)

res = await request(`/api/staff/${whStaff.id}/deactivate`, { method: 'POST', cookie: admin.cookie })
check('temporary warehouse manager is deactivated', res.status === 200, `status ${res.status}`)
res = await request('/api/customers', { cookie: whSession.cookie })
check('deactivated warehouse manager is locked out', res.status === 401, `status ${res.status}`)

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
