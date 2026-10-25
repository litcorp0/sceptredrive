#!/usr/bin/env node
/**
 * Phase 9 Plan 08 — endpoint performance evidence.
 *
 *   bun .planning/phases/09-analytics-dashboard/evidence/verify-analytics-perf.mjs
 *
 * Reads the authenticated cookie the walkthrough leaves at
 * `/tmp/opencode/analytics-cookie.txt` (override with `SCEPTRE_COOKIE` or `COOKIE_FILE`),
 * calls each analytics endpoint ten times, and reports p50/p95/max. The budget is D13's:
 * p95 ≤ 300 ms on the local Docker Postgres with the demo month loaded.
 *
 * It also runs `EXPLAIN (ANALYZE, BUFFERS)` on the two heaviest access patterns and prints
 * the plan, so a regression can be read rather than guessed. This is evidence, not a CI gate:
 * timings depend on the machine.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

const repoRoot = path.resolve(import.meta.dirname, '../../../..')
const env = fs.existsSync(path.join(repoRoot, '.env'))
  ? fs.readFileSync(path.join(repoRoot, '.env'), 'utf8')
  : ''
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]

const apiUrl = process.env.API_URL ?? envValue('API_URL') ?? 'http://localhost:4000'
const cookieFile = process.env.COOKIE_FILE ?? '/tmp/opencode/analytics-cookie.txt'
const cookie = process.env.SCEPTRE_COOKIE ?? fs.readFileSync(cookieFile, 'utf8').trim()
if (!cookie) {
  console.error(`No session cookie. Run the walkthrough first, or set SCEPTRE_COOKIE.`)
  process.exit(1)
}

const today = new Date().toISOString().slice(0, 10)
const from = new Date(Date.now() - 41 * 86_400_000).toISOString().slice(0, 10)
const base = `from=${from}&to=${today}&granularity=day`

const ENDPOINTS = [
  ['overview', `/api/analytics/overview?${base}`],
  ['sales', `/api/analytics/sales?${base}`],
  ['products', `/api/analytics/products?${base}`],
  ['inventory', `/api/analytics/inventory?${base}`],
  ['credit', `/api/analytics/credit?${base}`],
  ['loyalty', `/api/analytics/loyalty?${base}`],
  ['payables', `/api/analytics/payables?${base}`],
  ['tax', `/api/analytics/tax?${base}`],
  ['sales-export', `/api/analytics/sales/export?${base}`],
  ['products-export', `/api/analytics/products/export?${base}`],
  ['tax-export', `/api/analytics/tax/export?${base}`],
]

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  return sorted[Math.max(0, index)]
}

const rows = []
let failures = 0

for (const [name, endpoint] of ENDPOINTS) {
  const timings = []
  let status = 0
  let bytes = 0
  // One warm-up call is excluded so the numbers describe steady state. Six calls per
  // endpoint keeps the whole run under the endpoint's own rate limit (120/min for reports,
  // 20/min for exports), because measuring must not require disabling a security control.
  for (let run = 0; run < 6; run += 1) {
    const started = performance.now()
    const response = await fetch(`${apiUrl}${endpoint}`, {
      headers: { cookie, accept: name.endsWith('export') ? 'text/csv' : 'application/json' },
    })
    const body = await response.arrayBuffer()
    const elapsed = performance.now() - started
    status = response.status
    bytes = body.byteLength
    if (run > 0) timings.push(elapsed)
    if (!response.ok) break
  }

  const p50 = timings.length > 0 ? percentile(timings, 0.5) : Number.NaN
  const p95 = timings.length > 0 ? percentile(timings, 0.95) : Number.NaN
  const max = timings.length > 0 ? Math.max(...timings) : Number.NaN
  const row = {
    endpoint: name,
    status,
    p50: Math.round(p50),
    p95: Math.round(p95),
    max: Math.round(max),
    bytes,
  }
  rows.push(row)
  const overBudget = status !== 200 || !(p95 <= 300)
  if (overBudget) failures += 1
  console.log(
    `${overBudget ? 'FAIL' : 'ok  '} ${name.padEnd(16)} status ${status}  p50 ${String(row.p50).padStart(4)}ms  p95 ${String(row.p95).padStart(4)}ms  max ${String(row.max).padStart(4)}ms  ${(bytes / 1024).toFixed(0)}KiB`,
  )
}

// --- query plans -------------------------------------------------------------

const databaseUrl = process.env.DATABASE_URL ?? envValue('DATABASE_URL')
if (databaseUrl) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()

  const plans = [
    [
      'overview series (gap-filled buckets over the branch index)',
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT date_trunc('day', s.occurred_at, 'UTC') AS bucket, count(*)
       FROM sale s
       WHERE s.occurred_at >= now() - interval '42 days'
       GROUP BY 1 ORDER BY 1`,
    ],
    [
      'product report (sale_line aggregated through sale)',
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT l.product_id, sum(l.base_minor), sum(l.unit_cost_minor::bigint * l.quantity)
       FROM sale_line l
       JOIN sale s ON s.id = l.sale_id
       WHERE s.occurred_at >= now() - interval '42 days'
       GROUP BY l.product_id`,
    ],
  ]

  for (const [label, query] of plans) {
    const result = await client.query(query)
    console.log(`\n### ${label}`)
    for (const line of result.rows.map((row) => Object.values(row)[0])) console.log(line)
  }

  const { rows: counts } = await client.query(
    `SELECT (SELECT count(*) FROM sale)::int AS sales,
            (SELECT count(*) FROM sale_line)::int AS lines,
            (SELECT count(*) FROM branch)::int AS branches`,
  )
  console.log(
    `\nDataset: ${counts[0].sales} sales, ${counts[0].lines} lines, ${counts[0].branches} branches`,
  )
  await client.end()
}

console.log(
  `\n${ENDPOINTS.length - failures}/${ENDPOINTS.length} endpoints within the 300 ms p95 budget`,
)
if (failures > 0) process.exit(1)
