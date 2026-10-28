import { closeDb, pool } from '@sceptre/db'
import '../src/config/env.ts'
import {
  assertSafeTruncateTarget,
  buildTruncateStatement,
  type DatabaseTable,
  describeDatabaseTarget,
  quoteIdentifier,
  selectTruncateTargets,
} from '../src/seed/truncate.ts'

/**
 * Wipe every application table while keeping the migrated schema.
 *
 *   bun run db:truncate --dry-run      # list tables and row counts, change nothing
 *   bun run db:truncate --yes          # full wipe; then run `bun run seed:admin`
 *
 * Full wipe means users, branches, catalog, stock, sales, ledgers, settings and
 * audit. Drizzle's migration table and pg-boss's schema version survive.
 *
 * Consequences to plan for:
 *   - every staff session ends and every POS device token is gone, so terminals
 *     must be enrolled again;
 *   - a terminal that still holds local sales will try to upload them to an empty
 *     server, so clear the POS local database before it syncs;
 *   - the API and PowerSync keep pooled connections; restart them afterwards.
 */

interface CliOptions {
  dryRun: boolean
  yes: boolean
  allowRemote: boolean
  withJobs: boolean
  help: boolean
}

function parseOptions(argv: readonly string[]): CliOptions {
  return {
    dryRun: argv.includes('--dry-run'),
    yes: argv.includes('--yes'),
    allowRemote: argv.includes('--allow-remote'),
    withJobs: argv.includes('--with-jobs'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

function usage(): string {
  return [
    'Usage: bun run db:truncate [options]',
    '',
    'Truncates every public table, keeps the schema and migrations.',
    '',
    'Options:',
    '  --dry-run        List the tables and their row counts; change nothing',
    '  --yes            Required for a real wipe',
    '  --allow-remote   Allow a non-local DATABASE_URL (refused by default)',
    '  --with-jobs      Also clear pg-boss job payloads (keeps its schema version)',
    '  --help, -h       Show this help',
    '',
    'Examples:',
    '  bun run db:truncate --dry-run',
    '  bun run db:truncate --yes && bun run seed:admin',
  ].join('\n')
}

async function listTables(): Promise<DatabaseTable[]> {
  const { rows } = await pool.query<{ schemaname: string; tablename: string }>(
    `select schemaname, tablename
       from pg_tables
      where schemaname in ('public', 'pgboss')
      order by schemaname, tablename`,
  )
  return rows.map((row) => ({ schema: row.schemaname, name: row.tablename }))
}

async function countRows(table: DatabaseTable): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::bigint as count from ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`,
  )
  return Number(rows[0]?.count ?? 0)
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))

  if (options.help) {
    console.log(usage())
    return
  }

  const target = describeDatabaseTarget(process.env.DATABASE_URL ?? '')
  console.log(`[db:truncate] target: ${target.host}/${target.database} as ${target.user}`)

  assertSafeTruncateTarget({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL ?? '',
    allowRemote: options.allowRemote,
    // A dry run changes nothing, so it does not need the destructive flag.
    confirmed: options.dryRun || options.yes,
  })

  const targets = selectTruncateTargets(await listTables(), {
    includeJobs: options.withJobs,
  })

  if (targets.length === 0) {
    throw new Error('No tables matched; check DATABASE_URL and the schema name')
  }

  console.log(`[db:truncate] ${targets.length} table(s) selected`)

  if (options.dryRun) {
    let total = 0
    for (const table of targets) {
      const count = await countRows(table)
      total += count
      console.log(`  ${table.schema}.${table.name.padEnd(32)} ${String(count).padStart(8)}`)
    }
    console.log(`[db:truncate] dry run: ${total} row(s) would be removed. Nothing changed.`)
    return
  }

  await pool.query(buildTruncateStatement(targets))
  console.log(
    `[db:truncate] truncated ${targets.length} table(s); schema and migrations are intact.`,
  )
  console.log('[db:truncate] next: bun run seed:admin, then restart the API and PowerSync.')
  console.log(
    '[db:truncate] terminals must re-enrol; clear the POS local database before it syncs to an empty server.',
  )
}

main()
  .catch((error: unknown) => {
    console.error(`[db:truncate] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
