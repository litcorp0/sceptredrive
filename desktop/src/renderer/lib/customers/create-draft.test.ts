import type { PowerSyncDatabase } from '@powersync/web'
import { describe, expect, it } from 'vitest'
import { createCustomerDraft } from './create-draft'

interface FakeOptions {
  syncedCustomer?: { id: string; name: string; phone: string } | null
  draft?: { id: string; name: string; phone: string } | null
}

function fakeDb(options: FakeOptions = {}) {
  const statements: Array<{ sql: string; parameters: unknown[] }> = []

  const db = {
    getOptional: async (sql: string) => {
      if (sql.includes('FROM customer_draft')) return options.draft ?? null
      if (sql.includes('FROM customer')) return options.syncedCustomer ?? null
      return null
    },
    getAll: async () => [],
    writeTransaction: async (work: (tx: unknown) => Promise<void>) => {
      await work({
        execute: async (sql: string, parameters: unknown[]) => {
          statements.push({ sql, parameters })
        },
      })
    },
  }

  return { db: db as unknown as PowerSyncDatabase, statements }
}

describe('createCustomerDraft', () => {
  it('requires a name', async () => {
    const { db } = fakeDb()
    expect(await createCustomerDraft(db, { name: '   ', phone: '0241234567' })).toEqual({
      status: 'invalid_name',
    })
  })

  it('requires a valid Ghana number', async () => {
    const { db } = fakeDb()
    expect(await createCustomerDraft(db, { name: 'Ama', phone: '12345' })).toEqual({
      status: 'invalid_phone',
    })
  })

  it('creates a draft with a normalized phone and a uuid id', async () => {
    const { db, statements } = fakeDb()
    const result = await createCustomerDraft(db, {
      name: '  Ama   Boateng ',
      phone: '024 123 4567',
    })

    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    expect(result.customer.name).toBe('Ama Boateng')
    expect(result.customer.phone).toBe('+233241234567')
    expect(result.customer.draftId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.customer.isDraft).toBe(true)
    expect(result.customer.customerId).toBeNull()

    const insert = statements.find((statement) =>
      statement.sql.includes('INSERT INTO customer_draft'),
    )
    expect(insert).toBeDefined()
    expect(insert?.parameters).toContain('+233241234567')
    expect(insert?.parameters).toContain(result.customer.draftId)
  })

  it('selects an existing synced customer instead of duplicating the phone', async () => {
    const { db, statements } = fakeDb({
      syncedCustomer: { id: 'existing-id', name: 'Akosua', phone: '+233241234567' },
    })
    const result = await createCustomerDraft(db, { name: 'Akosua', phone: '0241234567' })

    expect(result).toEqual({
      status: 'existing',
      customer: {
        customerId: 'existing-id',
        draftId: null,
        name: 'Akosua',
        phone: '+233241234567',
        isDraft: false,
      },
    })
    expect(statements).toHaveLength(0)
  })

  it('selects an existing local draft instead of creating a second one', async () => {
    const { db, statements } = fakeDb({
      draft: { id: 'draft-id', name: 'Ama', phone: '+233241234567' },
    })
    const result = await createCustomerDraft(db, { name: 'Ama', phone: '0241234567' })

    expect(result.status).toBe('existing')
    expect(statements).toHaveLength(0)
  })

  it('rejects an over-long name', async () => {
    const { db } = fakeDb()
    const result = await createCustomerDraft(db, {
      name: 'a'.repeat(121),
      phone: '0241234567',
    })
    expect(result.status).toBe('invalid_name')
  })
})
