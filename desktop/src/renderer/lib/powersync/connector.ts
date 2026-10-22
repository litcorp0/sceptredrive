import type { PowerSyncBackendConnector } from '@powersync/web'
import { DeviceRevokedError, fetchPowersyncToken } from '../api/client'
import { markDeviceRevoked } from '../auth/session'

/**
 * Download-only connector.
 *
 * `fetchCredentials` asks our API for a short-lived PowerSync JWT; the API
 * re-reads the device/terminal/branch chain every time, so a revoked terminal
 * stops syncing within one token lifetime.
 *
 * There is deliberately **no `uploadData`**: local writes go to local-only
 * tables and our own outbox (`POST /api/pos/sync/upload`, Plan 08), because a
 * sale is one atomic server transaction, not a set of row CRUD operations.
 */
export class PosConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<{ endpoint: string; token: string; expiresAt?: Date }> {
    try {
      const { endpoint, token, expiresAt } = await fetchPowersyncToken()
      return { endpoint, token, expiresAt: new Date(expiresAt) }
    } catch (error) {
      if (error instanceof DeviceRevokedError) {
        // Stop reconnecting: the terminal needs a new enrolment code.
        await markDeviceRevoked()
      }
      throw error
    }
  }
  /**
   * Never called: PowerSync only invokes this when its CRUD queue has rows, and
   * all POS writes go to local-only tables. Present because the SDK's TypeScript
   * interface requires the member; throwing here makes an accidental call loud.
   */
  async uploadData(): Promise<void> {
    throw new Error('PowerSync uploadData is not used: POS writes go through the outbox')
  }
}

export const posConnector = new PosConnector()
