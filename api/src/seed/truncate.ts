/**
 * Pure helpers for the destructive `db:truncate` command.
 *
 * Keeping selection, quoting and safety here (rather than in the CLI) means the
 * dangerous parts can be tested without a database, and the CLI cannot grow a
 * second, slightly different definition of "safe". See `scripts/truncate-data.ts`.
 */

export interface DatabaseTable {
  schema: string
  name: string
}

export interface TruncateSelectionOptions {
  /** Also clear pg-boss job payloads. The schema version is always preserved. */
  includeJobs?: boolean
}

export interface SafeTruncateInput {
  nodeEnv: string | undefined
  databaseUrl: string
  allowRemote: boolean
  /** `--yes`; a dry run does not need it because it changes nothing. */
  confirmed: boolean
}

export interface DatabaseTarget {
  host: string
  database: string
  user: string
}

/**
 * Hosts that are unambiguously this machine or the Compose network. Anything
 * else needs `--allow-remote`, so a copied production URL is not wiped by a
 * command that looked local.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal'])

/**
 * Drizzle's bookkeeping table lives in its own schema and is never selected, but
 * the name is also protected explicitly: a future drizzle-kit setting that moves
 * it into `public` must not quietly erase the migration history.
 */
const PROTECTED_TABLES = new Set(['drizzle.__drizzle_migrations'])

/** pg-boss re-runs its own migrations if this row is lost, so it always stays. */
const JOB_TABLES_ALWAYS_KEPT = new Set(['version'])

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

function qualifiedName(table: DatabaseTable): string {
  return `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`
}

/**
 * Quotes one identifier. The regex is intentionally conservative: every table
 * this project owns matches it, and a name that does not is a bug rather than
 * something to escape at the last moment.
 */
export function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`Refusing to quote an unexpected SQL identifier: ${JSON.stringify(value)}`)
  }
  return `"${value}"`
}

/**
 * The tables a full wipe touches, in a stable order. `public` is everything the
 * application owns; `pgboss` is opt-in because its jobs may outlive the data
 * they refer to, but a stale queue after a reset is its own kind of confusing.
 */
export function selectTruncateTargets(
  tables: readonly DatabaseTable[],
  options: TruncateSelectionOptions = {},
): DatabaseTable[] {
  const seen = new Set<string>()
  const selected: DatabaseTable[] = []

  for (const table of tables) {
    const key = `${table.schema}.${table.name}`
    if (PROTECTED_TABLES.has(key)) continue

    const isPublic = table.schema === 'public'
    const isJobTable =
      options.includeJobs === true &&
      table.schema === 'pgboss' &&
      !JOB_TABLES_ALWAYS_KEPT.has(table.name)

    if (!isPublic && !isJobTable) continue
    if (seen.has(key)) continue

    seen.add(key)
    selected.push({ schema: table.schema, name: table.name })
  }

  return selected.sort((a, b) => {
    if (a.schema !== b.schema) return a.schema.localeCompare(b.schema)
    return a.name.localeCompare(b.name)
  })
}

/**
 * One statement, so foreign keys never impose an order and `RESTART IDENTITY`
 * resets every owned sequence. `CASCADE` covers any table added later that the
 * discovery query did not see (for example a table in a schema we do not own).
 */
export function buildTruncateStatement(targets: readonly DatabaseTable[]): string {
  if (targets.length === 0) {
    throw new Error('Refusing to truncate: no tables were selected')
  }

  return `TRUNCATE TABLE ${targets.map(qualifiedName).join(', ')} RESTART IDENTITY CASCADE`
}

/** Connection details a human can read, with no password in sight. */
export function describeDatabaseTarget(databaseUrl: string): DatabaseTarget {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL is not a valid URL')
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (database.length === 0) {
    throw new Error('DATABASE_URL does not name a database')
  }

  return {
    host: url.host,
    database,
    user: decodeURIComponent(url.username),
  }
}

/**
 * Refuses the three ways a wipe goes wrong: production, an unconfirmed
 * invocation, and a remote database that was mistaken for the local one.
 */
export function assertSafeTruncateTarget(input: SafeTruncateInput): void {
  if (input.nodeEnv === 'production') {
    throw new Error(
      'Refusing to truncate: NODE_ENV=production. This command is for development and test databases only.',
    )
  }

  if (!input.confirmed) {
    throw new Error(
      'Refusing to truncate without confirmation. Re-run with --yes (or use --dry-run to inspect).',
    )
  }

  const target = describeDatabaseTarget(input.databaseUrl)
  const hostname = new URL(input.databaseUrl).hostname

  if (!LOCAL_HOSTS.has(hostname) && !input.allowRemote) {
    throw new Error(
      `Refusing to truncate a non-local database (${target.host}/${target.database}). Re-run with --allow-remote if that is genuinely intended.`,
    )
  }
}
