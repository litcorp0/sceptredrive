import { describe, expect, it } from 'vitest'
import {
  buildExactLookupQuery,
  buildProductSearchQuery,
  type CatalogProductRow,
  escapeLike,
  pickEnterTarget,
  SEARCH_LIMIT,
  searchPattern,
} from './search'

function row(overrides: Partial<CatalogProductRow> = {}): CatalogProductRow {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    sku: 'SDP-00001',
    name: 'Brake Pad Set',
    base_price_minor: 10_000,
    tax_category: 'STANDARD',
    brand_name: 'Bosch',
    barcode: '4006381333931',
    ...overrides,
  }
}

describe('LIKE escaping', () => {
  it('escapes wildcards and the escape character itself', () => {
    expect(escapeLike('50%')).toBe('50\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('a\\b')).toBe('a\\\\b')
    expect(escapeLike('plain')).toBe('plain')
  })

  it('wraps the escaped term for a contains match', () => {
    expect(searchPattern('50%')).toBe('%50\\%%')
  })
})

describe('buildProductSearchQuery', () => {
  it('never concatenates the search term into SQL', () => {
    const query = buildProductSearchQuery("brake' OR 1=1 --")
    expect(query.sql).not.toContain('brake')
    expect(query.sql).not.toContain('OR 1=1')
    expect(query.parameters).toContain("brake' OR 1=1 --")
  })

  it('binds every placeholder and asks for the limit last', () => {
    const query = buildProductSearchQuery('pad', 25)
    expect(query.sql).toContain("ESCAPE '\\'")
    expect((query.sql.match(/\?/g) ?? []).length).toBe(query.parameters.length)
    expect(query.parameters.at(-1)).toBe(25)
  })

  it('only returns active products', () => {
    const query = buildProductSearchQuery('')
    expect(query.sql).toContain('p.is_active = ?')
    expect(query.parameters[0]).toBe(1)
  })

  it('selects the brand name for the product card', () => {
    const query = buildProductSearchQuery('pad')
    expect(query.sql).toContain('b.name AS brand_name')
    expect(query.sql).toContain('LEFT JOIN brand b ON b.id = p.brand_id')
  })

  it('defaults to the search cap', () => {
    expect(buildProductSearchQuery('x').parameters.at(-1)).toBe(SEARCH_LIMIT)
  })

  it('trims the term', () => {
    expect(buildProductSearchQuery('  pad  ').parameters[1]).toBe('pad')
  })
})

describe('buildExactLookupQuery', () => {
  it('matches a barcode or a SKU, barcode first', () => {
    const query = buildExactLookupQuery('4006381333931')
    expect(query.sql).toContain('FROM barcode bc')
    expect(query.sql).toContain('LEFT JOIN brand b ON b.id = p.brand_id')
    expect(query.sql).toContain('LIMIT 1')
    expect(query.parameters).toEqual([1, '4006381333931', '4006381333931', '4006381333931'])
    expect(query.sql).not.toContain('4006381333931')
  })
})

describe('pickEnterTarget', () => {
  it('adds the only result', () => {
    expect(pickEnterTarget('pad', [row()])?.id).toBe(row().id)
  })

  it('prefers an exact SKU match among many results', () => {
    const target = row({ id: 'target', sku: 'SDP-00002', name: 'Oil Filter' })
    expect(pickEnterTarget('sdp-00002', [row(), target])?.id).toBe('target')
  })

  it('prefers an exact barcode match among many results', () => {
    const target = row({ id: 'target', sku: 'X', barcode: '1234567890' })
    expect(pickEnterTarget('1234567890', [row(), target, row({ id: 'other' })])?.id).toBe('target')
  })

  it('returns null for an ambiguous partial match', () => {
    expect(pickEnterTarget('pad', [row(), row({ id: 'other' })])).toBeNull()
  })

  it('returns null for an empty term', () => {
    expect(pickEnterTarget('   ', [row()])).toBeNull()
  })
})
