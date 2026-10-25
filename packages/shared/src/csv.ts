/**
 * CSV writing with formula-injection escaping.
 *
 * A CSV stops being a data file the moment a spreadsheet opens it: a cell beginning with
 * `=`, `+`, `-`, `@`, TAB, CR, or LF is treated as a formula, and so are the full-width
 * forms `＝`, `＋`, `－`, `＠` in some locales. OWASP's current guidance (2026) is to quote
 * every cell, double the quotes, and prefix a leading apostrophe on anything dangerous.
 *
 * Two deliberate limits:
 *
 * - **Numbers pass through untouched.** A money column must stay numeric so a spreadsheet
 *   can total it; `-1250` is a number, not a formula. Only strings are sanitised.
 * - **No TAB-inside-quotes mitigation.** It is the Excel-resistant variant, but it changes
 *   the data for every programmatic consumer of the file. Exports here are also parsed by
 *   our own evidence scripts, so the trade-off is not worth it. Excel can still strip the
 *   apostrophe on save and reopen; that is a spreadsheet behaviour, not a server one.
 *
 * Rows end CRLF and the file starts with a UTF-8 BOM so Excel reads GHS symbols and
 * non-ASCII product names correctly.
 */

/**
 * Anything a spreadsheet may execute. Applied to string cells only.
 */
export const CSV_DANGEROUS_PREFIX = /^[=+\-@\t\r\n＝＋－＠]/

export interface CsvColumn<T> {
  key: keyof T & string
  header: string
}

/** One RFC 4180 cell: escaped for formulas, quoted when it has to be. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError('CSV numbers must be safe integers (money in minor units)')
    }
    return String(value)
  }

  const safe = CSV_DANGEROUS_PREFIX.test(value) ? `'${value}` : value
  const needsQuotes =
    safe.includes(',') ||
    safe.includes('"') ||
    safe.includes('\r') ||
    safe.includes('\n') ||
    safe.startsWith(' ') ||
    safe.endsWith(' ')
  return needsQuotes ? `"${safe.replaceAll('"', '""')}"` : safe
}

/**
 * A complete CSV document: header row, one row per record, CRLF line endings, optional
 * UTF-8 BOM. No trailing blank line.
 */
export function toCsv<T extends object>(
  columns: ReadonlyArray<CsvColumn<T>>,
  rows: ReadonlyArray<T>,
  options: { bom?: boolean } = {},
): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')]
  for (const row of rows) {
    lines.push(
      columns
        .map((column) => csvCell(row[column.key] as string | number | null | undefined))
        .join(','),
    )
  }
  const body = lines.join('\r\n')
  return options.bom === false ? body : `\uFEFF${body}`
}
