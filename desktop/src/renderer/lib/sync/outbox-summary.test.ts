import { describe, expect, it } from 'vitest'
import {
  NO_UNSYNCED_SALES,
  needsUnsyncedAcknowledgement,
  unsyncedSalesAcknowledgement,
  unsyncedSalesWarning,
} from './outbox-summary'

/**
 * The close-time warning (2026-10-28, TEM-MNZ-T01).
 *
 * A shift was closed while one of its sales sat in the outbox as a dead letter,
 * and the store learned about it only when the server's variance review asked a
 * manager to explain a GHS 1,650 shortfall. These are the sentences that make the
 * close say so first.
 */
describe('unsynced sales at the close', () => {
  it('says nothing when every sale is on the server', () => {
    expect(unsyncedSalesWarning(NO_UNSYNCED_SALES)).toBeNull()
    expect(unsyncedSalesAcknowledgement(NO_UNSYNCED_SALES)).toBeNull()
    expect(needsUnsyncedAcknowledgement(NO_UNSYNCED_SALES)).toBe(false)
  })

  it('names a waiting sale and its singular verb', () => {
    const warning = unsyncedSalesWarning({ pending: 1, blocked: 0 })
    expect(warning).toContain('1 sale saved here has not reached the server yet')
    expect(warning).toContain('will upload when the connection is back')
    // The consequence, stated before the drawer is counted.
    expect(warning).toContain('A sale that arrives after this close is applied')
  })

  it('names a refused sale as the manager’s job, not the cashier’s wait', () => {
    const warning = unsyncedSalesWarning({ pending: 0, blocked: 2 })
    expect(warning).toContain('2 sales were refused by the server')
    expect(warning).toContain('need a manager to retry them from Sync')
    expect(warning).not.toContain('will upload when the connection is back')
  })

  it('reports both kinds without losing either', () => {
    const warning = unsyncedSalesWarning({ pending: 1, blocked: 1 })
    expect(warning).toBe(
      '1 sale saved here has not reached the server yet and will upload when the connection is back; ' +
        '1 sale was refused by the server and needs a manager to retry it from Sync. ' +
        'A sale that arrives after this close is applied, but a manager has to review it against this drawer.',
    )
  })

  it('asks for an acknowledgement only when something is waiting', () => {
    expect(needsUnsyncedAcknowledgement({ pending: 0, blocked: 0 })).toBe(false)
    expect(needsUnsyncedAcknowledgement({ pending: 3, blocked: 0 })).toBe(true)
    expect(unsyncedSalesAcknowledgement({ pending: 0, blocked: 1 })).toBe(
      'I understand this close happens before every sale has reached the server',
    )
  })
})
