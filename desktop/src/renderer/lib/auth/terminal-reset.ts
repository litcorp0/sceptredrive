import { desktopApi, isDesktopAvailable } from '../desktop-api'
import { closeDatabase, getDatabase } from '../powersync/database'

/**
 * Credentials that identify this terminal on the server. The PowerSync database
 * key is deliberately kept: clearing the tables is enough, and deleting the key
 * while the encrypted file still exists would leave it unreadable.
 */
const TERMINAL_SECRETS = ['deviceToken', 'deviceId', 'terminalId', 'branchId'] as const

/**
 * Factory-reset this terminal's local state.
 *
 * This is the only operation allowed to delete local sales, held carts, cached
 * staff/catalogue data and the device credential. It must stay behind an
 * explicit confirmation: a terminal with unsynced sales loses them, and that is
 * exactly what a cashier must not do by accident.
 *
 * Used after a server database reset, or when a machine is reassigned. The
 * renderer reloads into the enrolment screen.
 */
export async function resetTerminalData(): Promise<void> {
  if (!isDesktopAvailable()) {
    throw new Error('The desktop bridge is required to reset this terminal')
  }

  try {
    const database = await getDatabase()
    // `clearLocal: true` also deletes local-only tables: sales, outbox, held
    // carts and the cached configuration. Without it, the next sync would keep
    // showing the old branch and terminal.
    await database.disconnectAndClear({ clearLocal: true })
    await closeDatabase()
  } catch {
    // A database that cannot be opened (for example a missing keychain) is not
    // a reason to leave the dead credential in place. Removing it still moves
    // the terminal towards a clean enrolment.
  }

  for (const key of TERMINAL_SECRETS) {
    await desktopApi.deleteSecret(key).catch(() => undefined)
  }

  window.location.hash = '#login'
  window.location.reload()
}
