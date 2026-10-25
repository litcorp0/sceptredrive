import { describe, expect, it } from 'vitest'
import { CSV_DANGEROUS_PREFIX, csvCell, toCsv } from './csv.ts'

const COLUMNS = [
  { key: 'name' as const, header: 'name' },
  { key: 'amount' as const, header: 'amount_minor' },
]

describe('CSV formula-injection escaping', () => {
  it('prefixes every formula-initiating character', () => {
    expect(csvCell('=1+2')).toBe("'=1+2")
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\tcmd')).toBe("'\tcmd")
    // CR and LF also force quoting, so the row cannot be split.
    expect(csvCell('\rcmd')).toBe(`"'\rcmd"`)
    expect(csvCell('\ncmd')).toBe(`"'\ncmd"`)
  })

  it('prefixes the full-width variants some locales execute', () => {
    for (const value of ['＝1+2', '＋1', '－1', '＠SUM(A1)']) {
      expect(csvCell(value)).toBe(`'${value}`)
    }
  })

  it('matches the two documented OWASP examples', () => {
    expect(csvCell('=1+2";=1+2')).toBe(`"'=1+2"";=1+2"`)
    expect(csvCell(`=1+2'" ;,=1+2`)).toBe(`"'=1+2'"" ;,=1+2"`)
  })

  it('does not mangle a negative number into text', () => {
    expect(csvCell(-1_250)).toBe('-1250')
    expect(CSV_DANGEROUS_PREFIX.test('-1250')).toBe(true)
  })

  it('quotes commas, quotes, and newlines, doubling inner quotes', () => {
    expect(csvCell('Bolt, M8')).toBe('"Bolt, M8"')
    expect(csvCell('12" pipe')).toBe('"12"" pipe"')
    // A newline in the middle is not a formula, but it must be quoted.
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
  })

  it('quotes leading and trailing spaces so they survive', () => {
    expect(csvCell(' padded')).toBe('" padded"')
  })

  it('renders null and undefined as an empty cell', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('refuses a non-integer number instead of writing a float into money', () => {
    expect(() => csvCell(12.5)).toThrow(TypeError)
  })
})

describe('toCsv', () => {
  it('writes a BOM, a header row, CRLF lines, and no trailing blank line', () => {
    const csv = toCsv(COLUMNS, [{ name: 'Bolt', amount: 12_500 }])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toBe('\uFEFFname,amount_minor\r\nBolt,12500')
  })

  it('omits the BOM when asked', () => {
    const csv = toCsv(COLUMNS, [{ name: 'Bolt', amount: null }], { bom: false })
    expect(csv).toBe('name,amount_minor\r\nBolt,')
  })

  it('still emits a header when there are no rows', () => {
    expect(toCsv(COLUMNS, [], { bom: false })).toBe('name,amount_minor')
  })

  it('escapes a hostile product name in a full document', () => {
    const csv = toCsv(COLUMNS, [{ name: '=HYPERLINK("http://evil")', amount: 100 }], {
      bom: false,
    })
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(""http://evil"")",100`)
  })
})
