---
phase: 07-identity-design-system
plan: 02
wave: 1
title: Desktop identity, protocol host, CSP, and copy
requirements: [UIX-01]
depends_on: [01]
status: planned
created: 2026-10-24
---

# Plan 02 — Desktop Identity, Protocol Host, CSP, and Copy

**Goal:** The installed application is Sceptre Drive POS — its window title, protocol
origin, user-data directory, installer name, CSP text, and every string a cashier can see —
with the production domain centralised behind one constant so the eventual domain purchase
is a one-line change.

## Task 1 — Protocol host and asset paths

**Files:** `desktop/src/main/paths.ts`, `desktop/src/main/paths.test.ts`,
`desktop/src/main/protocol.ts`, `desktop/src/main/windows.ts`,
`desktop/vite.renderer.config.mts`, `desktop/index.html`,
`desktop/src/main/protocol.test.ts` (if present)

- `APP_HOST = 'gikautos'` → `APP_HOST = 'sceptre-drive'`. A hyphen is valid in a registered
  standard scheme host; confirm the protocol handler still resolves `app://sceptre-drive/…`
  and that `resolveAppAssetPath` rejects `app://evil/…` and `https://sceptre-drive/…`
  exactly as before.
- Update the protocol registration comment and the windows loader to the new origin.
- `index.html`: `<!--%GIKAUTOS_CSP%-->` → `<!--%SCEPTRE_CSP%-->`, `<title>Sceptre Drive
  POS</title>`, and the `data-testid`-bearing shell copy if any contains the old name.
- `vite.renderer.config.mts`: placeholder replacement string, plugin name `sceptre-csp`,
  and the comment that names the `app://` origin.
- Do **not** change `target: 'chrome140'` or any security-relevant build option.

**Verify:** `bun run --filter desktop test` — `paths.test.ts` passes with the new host; a
manual `bun run --filter desktop start` loads the renderer from `app://sceptre-drive/index.html`
with no CSP violation in the console.

**Commit:** `chore(desktop): move the app protocol to app://sceptre-drive`

## Task 2 — Product name, installer, and application metadata

**Files:** `desktop/package.json`, `desktop/forge.config.mts`, `desktop/scripts/prepare-desktop.mjs`

- `productName`: `GikAutos POS` → `Sceptre Drive POS`; `description`; `author.name` →
  `Sceptre Drive`; `author.email` → the placeholder engineering address for the new domain.
- `forge.config.mts`: `packagerConfig.name`, `MakerSquirrel({ name: 'sceptre_drive_pos' })`,
  and the executable name. Leave `appBundleId`/`appId` untouched if absent, otherwise set a
  `com.sceptredrive.pos` placeholder and note it in the open items.
- **Document the consequence:** changing `productName` moves Electron's `userData`
  directory, so a development terminal loses its enrolled device, PIN bindings, and local
  sales. Add a `desktop/README.md` "Renamed from GikAutos" section covering: delete the old
  `userData` directory, re-enrol the terminal, re-open a shift. No migration code is
  written — v1 has not launched.

**Verify:** `bun run --filter desktop package` produces an app whose window title reads
`Sceptre Drive POS`; the packaged shell smoke test (38 assertions) passes after re-enrolment;
`app.getPath('userData')` ends in `Sceptre Drive POS`.

**Commit:** `chore(desktop): rename the application to Sceptre Drive POS`

## Task 3 — Centralise the production domain

**Files:** `desktop/src/main/config.ts`, `desktop/src/main/csp.ts`,
`desktop/src/main/csp.test.ts`, `desktop/src/main/config.test.ts`, `.env.example`

- Introduce in `config.ts`:
  ```ts
  /**
   * The production apex domain. One constant on purpose: the domain is not yet
   * purchased, so every origin below derives from it. Changing this line and the
   * CSP test expectations is the whole swap.
   */
  export const SCEPTRE_DOMAIN = 'gikautos.com' // TODO(domain): replace when purchased
  export const PRODUCTION_API_BASE_URL = `https://api.${SCEPTRE_DOMAIN}`
  export const PRODUCTION_POWERSYNC_URL = `https://powersync.${SCEPTRE_DOMAIN}`
  ```
- `csp.ts` derives `PRODUCTION_API_ORIGINS` and `PRODUCTION_POWERSYNC_ORIGINS`
  (`https://${SCEPTRE_DOMAIN}`, `https://*.${SCEPTRE_DOMAIN}`) from the same constant, and
  `isAllowedConnectOrigin` tests the hostname against `SCEPTRE_DOMAIN` instead of a literal.
- Keep the CSP **exactly as strict**: `default-src 'self'`, `font-src 'self'`,
  `script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `frame-ancestors 'none'`.
  This task changes where the origin strings come from, not what is allowed.
- Update `csp.test.ts` and `config.test.ts` to build expectations from `SCEPTRE_DOMAIN`.
- Add a comment in `.env.example` beside the API URLs naming `SCEPTRE_DOMAIN` as the source
  of truth.

**Verify:** `bun run --filter desktop test` (CSP, config, paths suites green);
`grep -rn "gikautos" desktop/src/main` returns only the single TODO-bearing constant line;
the produced CSP string is byte-identical to the pre-change policy apart from nothing —
diff it explicitly and paste the before/after into the plan summary.

**Commit:** `refactor(desktop): derive production origins from one domain constant`

## Task 4 — Renderer copy and POS strings

**Files:** `desktop/src/renderer/**` (all `GikAutos` occurrences),
`desktop/src/renderer/lib/powersync/database.ts`, `desktop/src/renderer/lib/powersync/spike.ts`

- Visible strings: `GikAutos POS` → `Sceptre Drive POS` in the login card, app header,
  settings, receipt footer default, and the boot/centered screens.
- `POS_DB_FILENAME = 'gikautos-pos.db'` → `'sceptre-drive-pos.db'`; spike database names
  likewise. This orphans any local POS data — acceptable and documented in Task 2's README
  section.
- Receipt default footer text (`pos.receiptFooter` seed value) → `Sceptre Drive`.
- Leave every behavioural path alone: cart, sale, shift, credit, loyalty, outbox, printing.

**Verify:** `bun run --filter desktop test` (339 assertions, none edited);
`grep -rn 'GikAutos' desktop/src/renderer` returns nothing; the login screen and header read
`Sceptre Drive POS` in a manual launch.

**Commit:** `chore(desktop): rename renderer copy and local database`

## Definition of Done

- Desktop suite 339/339, packaged shell smoke 38/38.
- `bun run brand:check` passes with only the `SCEPTRE_DOMAIN` line allowed.
- CSP diff reviewed line by line; no origin added and none removed.
- Re-enrolment instructions exist in `desktop/README.md`.
