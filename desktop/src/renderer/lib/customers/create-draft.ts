import type { PowerSyncDatabase } from '@powersync/web'
import { normalizeGhanaPhone } from '@sceptre/shared'
import { uuidv7 } from '../id'
import { type CustomerHit, findCustomerByPhone } from './search'

/**
 * Offline customer creation (Plan 06 Task 3, D19).
 *
 * A new customer is written as a local draft with a client UUID and a
 * normalized Ghana phone, usable immediately without the server. On the sale
 * upload the API inserts the customer with the same id (or links the existing
 * one by phone and raises `DUPLICATE_CUSTOMER`).
 *
 * The draft is *not* a placeholder to be thrown away: the id is what the sale
 * carries, so the same person keeps one identity across offline terminals as
 * far as the server can reconcile.
 */

export type DraftResult =
  | { status: 'created'; customer: CustomerHit }
  | { status: 'existing'; customer: CustomerHit }
  | { status: 'invalid_name' }
  | { status: 'invalid_phone' }

export const CUSTOMER_NAME_MAX = 120

export async function createCustomerDraft(
  db: PowerSyncDatabase,
  input: { name: string; phone: string },
): Promise<DraftResult> {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!name) return { status: 'invalid_name' }
  if (name.length > CUSTOMER_NAME_MAX) return { status: 'invalid_name' }

  const phone = normalizeGhanaPhone(input.phone)
  if (!phone) return { status: 'invalid_phone' }

  // An existing synced customer (or a draft from earlier today) is selected
  // instead of creating a second identity for one phone number.
  const existing = await findCustomerByPhone(db, phone)
  if (existing) return { status: 'existing', customer: existing }

  const draftId = uuidv7()
  const createdAt = new Date().toISOString()

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO customer_draft (id, name, phone, created_at, linked_customer_id, acked_at)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      [draftId, name, phone, createdAt],
    )
  })

  return {
    status: 'created',
    customer: { customerId: null, draftId, name, phone, isDraft: true },
  }
}
