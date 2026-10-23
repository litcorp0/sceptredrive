import type { PowerSyncDatabase } from '@powersync/web'

/**
 * Local catalogue search (Plan 06 Task 2).
 *
 * The terminal is the only place a cashier looks for a product, and it has no
 * network. Queries run against the synced `product` / `barcode` tables:
 *
 * 1. exact barcode (a scan),
 * 2. exact SKU,
 * 3. name substring, case-insensitive (SQLite `LIKE` is ASCII-insensitive).
 *
 * Everything is parameterised — a product name is data, never SQL (OWASP A05).
 * `LIKE` wildcards in user input are escaped so a search for "50%" searches for
 * those characters instead of matching everything.
 */

export interface CatalogRow {
  id: string
  sku: string
  name: string
  base_price_minor: number
  tax_category: string
  barcode?: string | null
}

/** A search returns a working set; browsing the whole catalogue is virtualised. */
export const SEARCH_LIMIT = 60
export const BROWSE_LIMIT = 5000

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export function searchPattern(query: string): string {
  return `%${escapeLike(query)}%`
}

export interface ProductQuery {
  sql: string
  parameters: string[] | Array<string | number>
}

const PRODUCT_COLUMNS = 'p.id, p.sku, p.name, p.base_price_minor, p.tax_category'

/**
 * One query covers search and browse: an empty term lists the catalogue, a
 * term matches name, SKU, or barcode. Exact SKU hits sort first, then name.
 */
export function buildProductSearchQuery(rawQuery: string, limit = SEARCH_LIMIT): ProductQuery {
  const query = rawQuery.trim()

  return {
    sql: `SELECT ${PRODUCT_COLUMNS},
                 (SELECT b.code FROM barcode b WHERE b.product_id = p.id ORDER BY b.code LIMIT 1) AS barcode
            FROM product p
           WHERE p.is_active = ?
             AND (? = ''
                  OR p.name LIKE ? ESCAPE '\\'
                  OR p.sku LIKE ? ESCAPE '\\'
                  OR p.sku = ? COLLATE NOCASE
                  OR EXISTS (SELECT 1 FROM barcode b WHERE b.product_id = p.id AND b.code = ?))
        ORDER BY CASE WHEN p.sku = ? COLLATE NOCASE THEN 0 ELSE 1 END,
                 p.name COLLATE NOCASE
           LIMIT ?`,
    parameters: [1, query, searchPattern(query), searchPattern(query), query, query, query, limit],
  }
}

/** Exact barcode, then exact SKU. Used by the scanner and the Enter key. */
export function buildExactLookupQuery(code: string): ProductQuery {
  return {
    sql: `SELECT ${PRODUCT_COLUMNS},
                 (SELECT b.code FROM barcode b WHERE b.product_id = p.id ORDER BY b.code LIMIT 1) AS barcode
            FROM product p
           WHERE p.is_active = ?
             AND (EXISTS (SELECT 1 FROM barcode b WHERE b.product_id = p.id AND b.code = ?)
                  OR p.sku = ? COLLATE NOCASE)
           ORDER BY CASE WHEN p.sku = ? COLLATE NOCASE THEN 0 ELSE 1 END
           LIMIT 1`,
    parameters: [1, code, code, code],
  }
}

export type CatalogProductRow = {
  id: string
  sku: string
  name: string
  base_price_minor: number
  tax_category: string
  barcode: string | null
}

/**
 * Resolves a scanned or typed code to one product. Barcode first: a shelf
 * label must win over a SKU that happens to look the same.
 */
export async function findProductByCode(
  db: PowerSyncDatabase,
  code: string,
): Promise<CatalogProductRow | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  const lookup = buildExactLookupQuery(trimmed)
  return db.getOptional<CatalogProductRow>(lookup.sql, lookup.parameters)
}

/**
 * What the Enter key should add for the current results: an exact code match,
 * or the only result when the search is unambiguous.
 */
export function pickEnterTarget(
  query: string,
  rows: readonly CatalogProductRow[],
): CatalogProductRow | null {
  const term = query.trim().toLowerCase()
  if (!term) return null
  if (rows.length === 1) return rows[0] ?? null
  const exact = rows.find((row) => row.sku.toLowerCase() === term || row.barcode === query.trim())
  return exact ?? null
}
