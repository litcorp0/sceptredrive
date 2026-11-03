import type { PowerSyncDatabase } from '@powersync/web'
import { normalizeGhanaPhone } from '@sceptre/shared'

/**
 * Customer lookup on the terminal (Plan 06 Task 3).
 *
 * The till searches two sources and presents them as one list:
 *
 * - synced `customer` rows (global identity, D8);
 * - local `customer_draft` rows the terminal created offline, until the server
 *   links them on the next upload (D19).
 *
 * Phone matching is digit-based, because a cashier types a national number
 * (`024 123 4567`) while the database stores E.164 (`+233241234567`).
 */

export interface CustomerHit {
  /** Set for a synced customer. */
  customerId: string | null
  /** Set for a local draft. */
  draftId: string | null
  name: string
  phone: string
  isDraft: boolean
}

export const CUSTOMER_SEARCH_LIMIT = 20

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * The digits a stored E.164 number and a typed national number share. Leading
 * zeros are dropped: `0241234567` → `241234567`, which is a substring of
 * `+233241234567`.
 */
export function phoneMatchDigits(value: string): string {
  return phoneDigits(value).replace(/^0+/, '')
}

/** Escapes the LIKE wildcards a customer name might legitimately contain (`100%`, `a_b`). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/**
 * The name/phone filter shared by synced customers and local drafts.
 *
 * The phone clause is guarded by the digit term on purpose. `phoneMatchDigits('ama')` is `''`,
 * so an unguarded `phone LIKE '%%'` matches every row and the whole OR became true — a name
 * search returned the unfiltered list, which read as "search does nothing until I type a phone
 * number". The `? <> ''` guard keeps name terms to name matching.
 */
function customerFilter(rawTerm: string): { clause: string; parameters: string[] } {
  const term = rawTerm.trim()
  const digits = phoneMatchDigits(term)

  return {
    clause: `(? = '' OR name LIKE ? ESCAPE '\\' OR (? <> '' AND phone LIKE ? ESCAPE '\\'))`,
    parameters: [term, `%${escapeLike(term)}%`, digits, `%${digits}%`],
  }
}

export function buildCustomerSearchQuery(
  rawQuery: string,
  limit = CUSTOMER_SEARCH_LIMIT,
): { sql: string; parameters: Array<string | number> } {
  const filter = customerFilter(rawQuery)

  return {
    sql: `SELECT id, name, phone, created_at
            FROM customer
           WHERE status = 'ACTIVE'
             AND anonymized_at IS NULL
             AND ${filter.clause}
        ORDER BY name COLLATE NOCASE
           LIMIT ?`,
    parameters: [...filter.parameters, limit],
  }
}

interface CustomerRow {
  id: string
  name: string
  phone: string
}

interface DraftRow {
  id: string
  name: string
  phone: string
}

function toSyncedHit(row: CustomerRow): CustomerHit {
  return { customerId: row.id, draftId: null, name: row.name, phone: row.phone, isDraft: false }
}

function toDraftHit(row: DraftRow): CustomerHit {
  return { customerId: null, draftId: row.id, name: row.name, phone: row.phone, isDraft: true }
}

/** Synced customers first, then unlinked drafts; a synced row wins a duplicate. */
export async function searchCustomers(
  db: PowerSyncDatabase,
  rawQuery: string,
  limit = CUSTOMER_SEARCH_LIMIT,
): Promise<CustomerHit[]> {
  const query = buildCustomerSearchQuery(rawQuery, limit)
  const synced = await db.getAll<CustomerRow>(query.sql, query.parameters)

  // Same filter for drafts: a local customer must be findable by name before it is uploaded.
  const filter = customerFilter(rawQuery)
  const draftSql = `SELECT id, name, phone
                      FROM customer_draft
                     WHERE acked_at IS NULL
                       AND ${filter.clause}
                  ORDER BY name COLLATE NOCASE
                     LIMIT ?`
  const drafts = await db.getAll<DraftRow>(draftSql, [...filter.parameters, limit])

  const seenPhones = new Set(synced.map((row) => row.phone))
  const hits: CustomerHit[] = synced.map(toSyncedHit)

  for (const draft of drafts) {
    if (seenPhones.has(draft.phone)) continue
    hits.push(toDraftHit(draft))
  }

  return hits.slice(0, limit)
}

/** Exact phone lookup, used to refuse a duplicate offline customer. */
export async function findCustomerByPhone(
  db: PowerSyncDatabase,
  phone: string,
): Promise<CustomerHit | null> {
  const normalized = normalizeGhanaPhone(phone)
  if (!normalized) return null

  const synced = await db.getOptional<CustomerRow>(
    `SELECT id, name, phone FROM customer
      WHERE phone = ? AND status = 'ACTIVE' AND anonymized_at IS NULL
      LIMIT 1`,
    [normalized],
  )
  if (synced) return toSyncedHit(synced)

  const draft = await db.getOptional<DraftRow>(
    'SELECT id, name, phone FROM customer_draft WHERE phone = ? AND acked_at IS NULL LIMIT 1',
    [normalized],
  )
  return draft ? toDraftHit(draft) : null
}
