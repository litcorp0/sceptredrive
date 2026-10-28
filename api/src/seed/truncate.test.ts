import { describe, expect, it } from 'vitest'
import {
  assertSafeTruncateTarget,
  buildTruncateStatement,
  describeDatabaseTarget,
  quoteIdentifier,
  selectTruncateTargets,
} from './truncate.ts'

const LOCAL_URL = 'postgresql://sceptre_drive:super-secret@localhost:5434/sceptre_drive'
const REMOTE_URL = 'postgresql://sceptre_drive:super-secret@db.example.com:5432/sceptre_drive'

const TABLES = [
  { schema: 'drizzle', name: '__drizzle_migrations' },
  { schema: 'pgboss', name: 'version' },
  { schema: 'pgboss', name: 'job' },
  { schema: 'pgboss', name: 'queue' },
  { schema: 'public', name: 'sale' },
  { schema: 'public', name: 'user' },
  { schema: 'public', name: 'branch' },
] as const

describe('selectTruncateTargets', () => {
  it('selects every public table and leaves migrations and jobs alone by default', () => {
    const targets = selectTruncateTargets(TABLES)

    expect(targets.map((table) => `${table.schema}.${table.name}`)).toEqual([
      'public.branch',
      'public.sale',
      'public.user',
    ])
  })

  it('includes job payloads but never the pg-boss schema version', () => {
    const targets = selectTruncateTargets(TABLES, { includeJobs: true })
    const names = targets.map((table) => `${table.schema}.${table.name}`)

    expect(names).toContain('pgboss.job')
    expect(names).toContain('pgboss.queue')
    expect(names).not.toContain('pgboss.version')
  })

  it('deduplicates repeated rows and sorts deterministically', () => {
    const targets = selectTruncateTargets([
      { schema: 'public', name: 'user' },
      { schema: 'public', name: 'user' },
      { schema: 'public', name: 'branch' },
    ])

    expect(targets).toEqual([
      { schema: 'public', name: 'branch' },
      { schema: 'public', name: 'user' },
    ])
  })

  it('never selects another schema by accident', () => {
    const targets = selectTruncateTargets([{ schema: 'powersync', name: 'op' }])

    expect(targets).toEqual([])
  })
})

describe('quoteIdentifier', () => {
  it('quotes a normal table name', () => {
    expect(quoteIdentifier('sale_line')).toBe('"sale_line"')
  })

  it('refuses punctuation and whitespace instead of escaping it', () => {
    for (const value of ['sale; drop table user', 'sale"line', 'sale line', '1sale', '']) {
      expect(() => quoteIdentifier(value)).toThrow(/unexpected SQL identifier/)
    }
  })
})

describe('buildTruncateStatement', () => {
  it('builds one statement with identity restart and cascade', () => {
    const statement = buildTruncateStatement([
      { schema: 'public', name: 'sale' },
      { schema: 'public', name: 'user' },
    ])

    expect(statement).toBe(
      'TRUNCATE TABLE "public"."sale", "public"."user" RESTART IDENTITY CASCADE',
    )
  })

  it('refuses an empty target list', () => {
    expect(() => buildTruncateStatement([])).toThrow(/no tables were selected/)
  })
})

describe('describeDatabaseTarget', () => {
  it('names the target without leaking the password', () => {
    const target = describeDatabaseTarget(LOCAL_URL)

    expect(target).toEqual({
      host: 'localhost:5434',
      database: 'sceptre_drive',
      user: 'sceptre_drive',
    })
    expect(JSON.stringify(target)).not.toContain('super-secret')
  })

  it('rejects a URL that does not name a database', () => {
    expect(() => describeDatabaseTarget('postgresql://user:pass@localhost:5432/')).toThrow(
      /does not name a database/,
    )
  })
})

describe('assertSafeTruncateTarget', () => {
  const safe = {
    nodeEnv: 'development',
    databaseUrl: LOCAL_URL,
    allowRemote: false,
    confirmed: true,
  }

  it('accepts a confirmed local development database', () => {
    expect(() => assertSafeTruncateTarget(safe)).not.toThrow()
  })

  it('refuses production even when confirmed', () => {
    expect(() => assertSafeTruncateTarget({ ...safe, nodeEnv: 'production' })).toThrow(
      /NODE_ENV=production/,
    )
  })

  it('refuses an unconfirmed wipe', () => {
    expect(() => assertSafeTruncateTarget({ ...safe, confirmed: false })).toThrow(/--yes/)
  })

  it('refuses a remote database unless it is explicitly allowed', () => {
    expect(() => assertSafeTruncateTarget({ ...safe, databaseUrl: REMOTE_URL })).toThrow(
      /non-local database/,
    )
    expect(() =>
      assertSafeTruncateTarget({ ...safe, databaseUrl: REMOTE_URL, allowRemote: true }),
    ).not.toThrow()
  })
})
