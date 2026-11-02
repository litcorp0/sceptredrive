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

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

/**
 * An RFC 4180 reader for upload files: UTF-8 BOM, CRLF or LF, quoted commas, escaped
 * quotes and quoted newlines. It deliberately does **not** guess a delimiter, coerce
 * types or trim cells; the caller validates every value, because a spreadsheet is
 * untrusted input (OWASP A03/A05).
 *
 * The cap counts data rows, not the header. A file over the cap is refused before any
 * row is stored, so a 100 MB upload cannot become 100 MB of draft lines.
 */
export function parseCsv(text: string, options: { maxRows?: number } = {}): ParsedCsv {
  const maxRows = options.maxRows ?? 5_000
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    // A blank line is not a record. A row of empty cells is.
    if (row.length === 1 && row[0] === '') {
      row = []
      return
    }
    records.push(row)
    row = []
  }

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true
    } else if (char === ',') {
      endField()
    } else if (char === '\n') {
      endRow()
    } else if (char === '\r') {
      if (input[index + 1] === '\n') index += 1
      endRow()
    } else {
      field += char
    }
  }

  if (inQuotes) throw new SyntaxError('The CSV ends inside a quoted cell')
  if (field.length > 0 || row.length > 0) endRow()

  const [headers = [], ...rows] = records
  if (rows.length > maxRows) {
    throw new RangeError(`The file has ${rows.length} rows; the limit is ${maxRows}`)
  }
  return { headers, rows }
}

/**
 * A strict GHS string to integer pesewas. Accepts `12`, `12.5`, `12.50`, `1,234.56`
 * and an optional `GH₵`/`GHS`/`₵` prefix. It never uses floating point and never
 * accepts a negative amount or more than two decimals, so a CSV cannot smuggle a
 * rounding error into the ledger.
 */
export function parseMoneyToMinor(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/^(GH₵|GHS|₵)\s*/i, '')
    .replaceAll(',', '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole = '', fraction = ''] = cleaned.split('.')
  const digits = `${whole}${fraction.padEnd(2, '0')}`
  const minor = Number(digits)
  return Number.isSafeInteger(minor) ? minor : null
}

/** A whole, non-negative quantity from a CSV. Commas are accepted as thousands separators. */
export function parseQuantity(value: string): number | null {
  const cleaned = value.trim().replaceAll(',', '')
  if (!/^\d+$/.test(cleaned)) return null
  const quantity = Number(cleaned)
  return Number.isSafeInteger(quantity) ? quantity : null
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
