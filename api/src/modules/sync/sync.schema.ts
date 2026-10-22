/**
 * The `sync` module owns no tables.
 *
 * It is the device-facing edge of the POS: it authenticates a terminal, issues
 * the short-lived device JWT and the PowerSync JWT, and snapshots the settings
 * the offline client needs. All persisted state lives in the `org` (device,
 * terminal, branch), `platform` (settings), and domain modules, so this file
 * exists only to keep the seven-file module layout honest.
 */
export {}
