#!/usr/bin/env node
/**
 * Validates the PowerSync configuration in `powersync/`.
 *
 *   bun run sync:config-check
 *
 * This is a contract check, not a full Service validation: it catches the
 * mistakes that silently break sync (wrong edition, an unscoped branch stream,
 * a ledger table leaking into the publication, a missing JWKS/audience).
 * The Service itself validates the config on boot — check `bun run sync:logs`.
 */
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

const root = path.resolve(import.meta.dirname, '..')
const syncConfigPath = path.join(root, 'powersync', 'sync-config.yaml')
const serviceConfigPath = path.join(root, 'powersync', 'service.yaml')
const publicationPath = path.join(root, 'powersync', 'init', 'powersync.sql')

/** `!env PS_FOO` is a PowerSync config tag; keep it as the variable name. */
const envTag = {
  tag: '!env',
  resolve: (value) => ({ fromEnv: value }),
}

const failures = []
let checks = 0

function check(condition, label, detail) {
  checks += 1
  if (condition) return
  failures.push(detail ? `${label} (${detail})` : label)
}

function readYaml(file) {
  return YAML.parse(fs.readFileSync(file, 'utf8'), { customTags: [envTag], prettyErrors: true })
}

const syncConfig = readYaml(syncConfigPath)
const serviceConfig = readYaml(serviceConfigPath)
const publicationSql = fs.readFileSync(publicationPath, 'utf8')

// --- Sync config -----------------------------------------------------------
check(
  syncConfig.config?.edition === 3,
  'sync-config declares edition 3',
  syncConfig.config?.edition,
)

const expectedStreams = [
  'pos_products',
  'pos_barcodes',
  'pos_prices',
  'pos_stock',
  'pos_customers',
  'pos_credit',
  'pos_loyalty',
]
const streams = syncConfig.streams ?? {}
check(
  JSON.stringify(Object.keys(streams).sort()) === JSON.stringify([...expectedStreams].sort()),
  'the expected stream set is present',
  Object.keys(streams).join(', '),
)

function queriesOf(stream) {
  if (stream.query) return [stream.query]
  return stream.queries ?? []
}

const branchScoped = ['pos_prices', 'pos_stock', 'pos_credit']
for (const name of branchScoped) {
  const queries = queriesOf(streams[name] ?? {})
  check(
    queries.length > 0 && queries.every((query) => query.includes("auth.parameter('branch_id')")),
    `${name} is scoped to the signed branch claim`,
  )
}

for (const [name, stream] of Object.entries(streams)) {
  check(stream.auto_subscribe === true, `${name} auto-subscribes`)
}

// Anything that must never reach a terminal.
const forbiddenTables = [
  'staff',
  'user',
  'credit_ledger_entry',
  'loyalty_ledger_entry',
  'audit_log',
  'supplier',
  'supplier_payment',
  'stock_movement',
  'session',
]
const syncText = JSON.stringify(syncConfig).toLowerCase()
for (const table of forbiddenTables) {
  check(!new RegExp(`from\\s+${table}\\b`).test(syncText), `sync-config does not stream ${table}`)
}

// --- Service config --------------------------------------------------------
const connection = serviceConfig.replication?.connections?.[0]
check(connection?.type === 'postgresql', 'replication uses a Postgres connection')
check(
  connection?.uri?.fromEnv === 'PS_DATA_SOURCE_URI',
  'replication URI comes from PS_DATA_SOURCE_URI',
)
check(connection?.sslmode === 'disable', 'sslmode is a separate key (local Docker network only)')
check(serviceConfig.storage?.type === 'postgresql', 'bucket storage uses Postgres')
check(
  serviceConfig.storage?.uri?.fromEnv === 'PS_STORAGE_URI',
  'storage URI comes from PS_STORAGE_URI',
)
check(serviceConfig.port === 8080, 'the service listens on 8080')
check(
  serviceConfig.sync_config?.path === 'sync-config.yaml',
  'sync_config points at the mounted sync-config.yaml',
)
check(
  serviceConfig.client_auth?.jwks_uri?.fromEnv === 'PS_JWKS_URI',
  'client_auth fetches our JWKS',
)
check(
  Array.isArray(serviceConfig.client_auth?.audience) &&
    serviceConfig.client_auth.audience.length > 0,
  'client_auth declares an audience',
)
check(
  Array.isArray(serviceConfig.api?.tokens) && serviceConfig.api.tokens.length > 0,
  'an admin API token is configured',
)
check(serviceConfig.healthcheck?.probes?.use_http === true, 'HTTP health probes are enabled')

// --- Publication -----------------------------------------------------------
check(/CREATE PUBLICATION powersync/.test(publicationSql), 'publication is named powersync')
for (const table of [
  'product',
  'barcode',
  'product_price',
  'stock_level',
  'customer',
  'credit_profile',
  'loyalty_account',
  'loyalty_lot',
]) {
  check(new RegExp(`\\b${table}\\b`).test(publicationSql), `publication includes ${table}`)
}
check(
  /wal_level=logical/.test(fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8')),
  'compose enables wal_level=logical',
)

if (failures.length > 0) {
  console.error(`sync config check failed (${failures.length}/${checks}):`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}

console.log(`sync config OK (${checks} checks)`)
