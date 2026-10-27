/**
 * `settings` — the branch-scoped and global console settings.
 *
 * Move map (Phase 8, D8): `routes/_authenticated/settings.tsx` renders `SettingsPage`; the route
 * keeps no markup, query or handler (D6). The page still reads `activeBranchId` from the branch
 * context because settings are branch-scoped; that did not change.
 *
 * Phase 14 (P14-D42): the page renders every key `GET /api/settings` returns, so the key list is
 * the server's. `SETTING_META` and this module's types are presentation hints — a key with no
 * entry still renders, labelled with the key itself.
 *
 * `settingsListOptions` is exported for the domains that read a single rate (loyalty, catalog):
 * the fetcher and its key stay here even when another module consumes them.
 */
export { settingsListOptions, settingsUpdate } from "./api/settings"
export { SettingsPage } from "./pages/settings-page"
export type { ResolvedSetting, SettingKey, SettingMeta, SettingsUpdateInput } from "./types"
