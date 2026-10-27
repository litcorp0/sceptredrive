import type { Context } from 'hono'
import { AppError } from './errors.ts'
import type { AppEnv } from './factory.ts'

/**
 * The one CSV response contract.
 *
 * Every export in the API goes through these three functions so the headers, the row
 * cap and the filename shape cannot drift between modules. The document itself is
 * built by `toCsv`/`csvCell` in `@sceptre/shared`, which owns the formula-injection
 * escaping (OWASP: a cell beginning `=`, `+`, `-`, `@`, TAB, CR or LF is executable).
 *
 * Three deliberate limits:
 * - **A capped export is refused, not truncated.** Half a ledger is worse than an
 *   error a user can act on: a partial file totals to the wrong number and no one can
 *   tell by looking at it.
 * - **`no-store, private`.** A report carries branch financials and, for the audit
 *   export, staff identity; it must not sit in a shared proxy cache.
 * - **The filename is slugged.** It is built from database strings (a branch code), and
 *   a newline or a quote in a `content-disposition` header is a header-injection bug.
 */

/** A runaway export would exhaust memory before it printed anything useful. */
export const MAX_EXPORT_ROWS = 50_000

export interface CsvExport {
  filename: string
  csv: string
}

const UNSAFE_FILENAME_PART = /[^a-z0-9_-]+/gi

function slug(value: string): string {
  return value.replaceAll(UNSAFE_FILENAME_PART, '-').toLowerCase()
}

/**
 * `sceptre-<report>-<branch|all-branches>-<from>-<to>.csv`, or `…-asof-<date>.csv`
 * for a report whose basis is an instant rather than a period.
 */
export function csvFilename(report: string, branchCode: string | null, suffix: string): string {
  const scope = branchCode ? slug(branchCode) : 'all-branches'
  return `sceptre-${slug(report)}-${scope}-${slug(suffix)}.csv`
}

/**
 * Refuses an export larger than the cap. Callers fetch `MAX_EXPORT_ROWS + 1` so the
 * refusal is decided by the data, not by a limit clause that silently drops rows.
 */
export function enforceExportCap(rowCount: number): void {
  if (rowCount > MAX_EXPORT_ROWS) {
    throw new AppError(
      413,
      'EXPORT_TOO_LARGE',
      `An export can carry at most ${MAX_EXPORT_ROWS} rows; narrow the filter and try again`,
    )
  }
}

export function sendCsv(c: Context<AppEnv>, result: CsvExport): Response {
  c.header('content-type', 'text/csv; charset=utf-8')
  c.header('content-disposition', `attachment; filename="${result.filename}"`)
  c.header('cache-control', 'no-store, private')
  return c.body(result.csv)
}
