# Sceptre Drive POS (desktop)

Electron Forge 8 + Vite 8 + React 19 shell for the offline-first point of sale. The
renderer is served from `app://sceptre-drive` behind a strict CSP with no Node access; the main
process owns the OS keychain, PIN hashing, and the ESC/POS printer adapter.

> Phase 6 status: shell, security baseline, keychain, PowerSync sync, offline PIN/shift,
> selling, sale completion, receipts, ESC/POS printing, the cash drawer, and the durable
> outbox with sync/conflict status are in place. Phase verification is Plan 09.

## Commands

Run from the repository root unless noted.

| Command | What it does |
|---|---|
| `bun run dev:pos` | Forge dev server + Electron window (HMR) |
| `bun run build:pos` / `bun run package:pos` | Build bundles and package an unpacked app in `desktop/out/` |
| `bun run make:pos` | Build installers — Squirrel on Windows, ZIP elsewhere |
| `bun run --filter desktop test` | Unit tests (Vitest, node environment) |
| `bun run --filter desktop test:e2e` | Playwright: origin, CSP, isolation, keychain (needs a display) |
| `bun run --filter desktop test:spike` | PowerSync gate: both VFS backends + restart persistence |
| `bun run --filter desktop test:print` | Packaged receipt + drawer through the fake ESC/POS adapter |
| `bun run --filter desktop test:sync` | Device sync smoke (needs the API + PowerSync service) |
| `bun run --filter desktop test:counter` | Counter audit: enrol, sell, home figures, 9 screens × 3 widths, keyboard, offline relaunch (needs the full stack — see below) |
| `bun .planning/phases/06-pos-offline-core/evidence/verify-outbox.ts` | Outbox recovery simulation (real SQLite, scripted server) |

`make:pos` on Linux needs the `zip` binary (MakerZIP shells out to it); CI images have it,
minimal distros may not.

### `test:counter` prerequisites

The counter audit drives the app end to end, so it needs more than a build:

- the API on `:4000`, Postgres on `:5434`, and the PowerSync service on `:8080`
  (`bun run dev:api`, `docker compose up -d`, `bun run sync:up`);
- the demo seed (`bun run db:seed -- --demo`) for the `ACC-SPX` branch and its products;
- a built renderer (`bun run --filter desktop package`), because it launches the `.vite`
  bundle through Electron;
- `.env` with `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `DATABASE_URL`.

It creates its own terminal and its own credit customer per run and never deletes a shipped
row, so it is safe to run repeatedly. It exits `2` and names the missing prerequisite rather
than reporting assertions that were never reached. Screenshots land in
`.planning/phases/10-desktop-pos-redesign/evidence/shots/`.

It drives the **unpackaged** production build on purpose: a packaged app sets
`allowLocalOrigins: false`, so it cannot enrol against a localhost API. `test:e2e` proves the
packaged binary separately.

### A packaged build against a local API (demo / pilot)

A packaged terminal cannot reach `http://localhost:4000` by default, because a local
impersonator could collect an enrolment code and a device token. For a local demo or an
on-site pilot, launch the packaged app with the explicit opt-in:

```bash
SCEPTRE_ALLOW_LOCAL_API=1 ./out/Sceptre\ Drive\ POS-linux-x64/sceptre_drive_pos
```

The flag adds `http://localhost:4000`, `http://localhost:8080`, and `ws://localhost:*` to
`connect-src` and lets `config.json` name a localhost API. It prints
`[security] SCEPTRE_ALLOW_LOCAL_API=1 …` on startup, is read at launch only (it writes no
setting), and accepts exactly the string `1` — `true`, `yes`, and `0` are all off. Never set
it on a terminal that talks to a real server.

Write the target into `userData/config.json` first if the API is not on the defaults:

```json
{ "apiBaseUrl": "http://localhost:4000", "powersyncUrl": "http://localhost:8080" }
```

## Renamed to Sceptre Drive (2026-10-24)

The application was renamed on 2026-10-24. Three consequences are accepted rather than
migrated, because v1 had not launched:

- **Electron's `userData` directory moved.** It derives from `productName`, so the old
  directory is no longer read. A development terminal loses its enrolled device, PIN
  bindings, cached staff, shift, and any unsynced sales. Delete the old directory, re-enrol
  the terminal with a fresh enrolment code, then open a shift.
- **The local POS database file was renamed** (`sceptre-drive-pos.db`). Old local data is
  orphaned. Upload anything pending before deleting the old file; nothing in production is
  affected.
- **The protocol origin changed** to `app://sceptre-drive`. Existing device JWTs carry the
  old audience and are rejected, which is why re-enrolment is required.

No migration code is written for either. `productName`, the Squirrel name, and the origin
live in `package.json`, `forge.config.mts`, and `src/main/paths.ts`.

## Layout

```
desktop/
├── src/main/            Electron main process
│   ├── main.ts          lifecycle, startup config, CSP wiring
│   ├── protocol.ts      app:// handler (serves the renderer, sets security headers)
│   ├── paths.ts         pure request → file mapping with traversal guard
│   ├── csp.ts           pure Content-Security-Policy builder + origin allowlist
│   ├── security.ts      navigation/permission/webview guards, IPC sender check
│   ├── windows.ts       hardened BrowserWindow
│   ├── config.ts        validated runtime config (URLs, not secrets)
│   ├── printing/       ESC/POS bytes, real + fake adapters, drawer
│   └── ipc/             keychain, app info, printer handlers, registration
├── src/preload/         the only bridge (contextBridge, whitelisted methods)
├── src/renderer/        React UI
│   ├── lib/desktop-api.ts   typed wrapper + DesktopUnavailableError/DesktopApiError
│   ├── lib/receipt/         one model → screen preview + 42-column ESC/POS text
│   ├── lib/sale/            atomic sale completion, receipt numbering
│   ├── lib/printing/        printer settings, transport, print orchestration
│   └── lib/powersync/       encrypted local database + connector
├── src/shared/          IPC + printing contracts shared by all three processes
├── scripts/             prepare-desktop.mjs (Forge/Bun workspace bridge)
└── test/e2e/            Playwright smoke, PowerSync gate, print smoke
```

## Bundled libraries live in `devDependencies`

Vite bundles the renderer, the preload, and the main process, so React, PowerSync, and
Tailwind are **dev** dependencies. Only modules that must not be bundled (the native
`@node-rs/argon2`, and `@maxxuxx/node-printer` for ESC/POS) belong in `dependencies`;
those need to be materialised as real files in `desktop/node_modules` because Electron
Forge does not follow symlinks — see `scripts/prepare-desktop.mjs`, which also writes the
exact runtime package list Forge copies.

## Printing

`ReceiptPrinter` is a port. The renderer builds a receipt model and a 42-column text job;
the main process turns it into ESC/POS bytes (`initialize → rows → feed(3) → optional
drawer kick → cut`) and sends it through:

- `winspool` (Windows spooler RAW), `network` (TCP 9100), or `fake` (files, the default
  and CI path).

A print failure is recorded on the sale (`print_status = FAILED`, short `print_error`) and
offered as Retry. It never rolls the sale back and never blocks the next sale. The cash
drawer kicks only with a cash tender, after the sale has committed. `#dev/print` is the
hardware-neutral diagnostic used by `test:print`; the Windows human checklist lives in
`.planning/phases/06-pos-offline-core/evidence/printing.md`.

## Sync and the outbox

PowerSync is **download-only**; every write goes through the durable `outbox` and
`POST /api/pos/sync/upload`, one server transaction per item. The uploader drains strict
FIFO, resets `in_flight` rows after a crash (server replay is safe), pauses on 401/403,
honours `Retry-After`, and backs off exponentially on 5xx/network errors. A rejected
transaction is dead-lettered without blocking later rows.

The header badge and `#pos/sync` show pending work, the last successful upload, the
outbox, and conflicts cached locally. `navigator.onLine === false` skips scheduled drains,
but the manual **Sync now** still tries (Chromium's `false` is a strong offline hint;
`true` is not proof the API is reachable). Evidence:
`.planning/phases/06-pos-offline-core/evidence/outbox-recovery.md`.

## Why `scripts/prepare-desktop.mjs` exists

This repository installs with Bun's **hoisted** linker (`bunfig.toml`). Electron Forge
resolves `electron` from the project directory and packages that directory's
`node_modules`; with hoisting, both land at the repository root. Bun 1.3 does not yet
implement self-contained workspaces (`workspaces.selfContained` /
`installConfig.hoistingLimits`) for the hoisted linker, so the script links `electron`
into `desktop/node_modules` and materialises native runtime modules when they exist.
`packagerConfig.ignore` keeps the link out of the packaged app.

Electron 45 downloads its binary lazily on first `require('electron')`, which Forge
triggers on the first `start`/`package` — no postinstall hook is involved, so
`bun install --frozen-lockfile` in CI behaves the same as a local install.

## Security baseline

- `app://sceptre-drive` is a privileged standard scheme. `file://` is never used.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webviewTag: false`,
  `webSecurity: true`. DevTools are disabled in packaged builds.
- Navigation is limited to the app origin; `window.open` and `<webview>` are denied; every
  permission request is refused; IPC senders are checked against the allowed origin *and*
  the main window's `webContents`.
- CSP (`src/main/csp.ts`, sent as a header by the `app://` handler and injected into
  `index.html` as a meta fallback):
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'
  https://api.<SCEPTRE_DOMAIN> https://*.powersync.journeyapps.com
  https://*.<SCEPTRE_DOMAIN>; worker-src 'self' blob:; object-src 'none';
  base-uri 'self'; form-action 'none'; frame-ancestors 'none'`.
  Both `<SCEPTRE_DOMAIN>` entries derive from the single `SCEPTRE_DOMAIN` constant in
  `src/main/config.ts`.
  `wasm-unsafe-eval` is required by wa-sqlite; `unsafe-eval` is never granted.
- Fuses: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`,
  `EnableNodeCliInspectArguments` off; cookie encryption, embedded asar integrity, and
  `OnlyLoadAppFromAsar` on.

The CSP is derived from `config.json` in `app.getPath('userData')`, but every origin is
checked against a fixed allowlist first, so a tampered config cannot widen the policy.
Dev additionally allows `http://localhost:*`, `ws://localhost:*`, and inline scripts for
React Refresh. An unpackaged build allows the localhost origins without the dev relaxations;
a packaged build allows them only with `SCEPTRE_ALLOW_LOCAL_API=1` (see above).

## Secrets

`userData/secrets.json` (mode `0600`) holds ciphertext only, produced by the **async**
`safeStorage` API (`encryptStringAsync`/`decryptStringAsync`; the sync API is deprecated in
Electron 45 and removed in 46). Keys: `deviceToken`, `deviceId`, `terminalId`, `branchId`,
`powersyncDbKey`, and the diagnostics-only `keychainSelfTest` probe.

There is no plaintext fallback: when OS encryption is unavailable every operation fails
with `KEYCHAIN_UNAVAILABLE`, so enrolment and sync stop instead of storing a bearer token
in the clear. On Linux without a secret service Electron reports
`secureStorage.level: 'basic'` (`basic_text` backend) — surfaced through `app.getInfo()` so
the UI can warn and enrolment can require `level: 'os'`. Windows uses DPAPI and reports
`os`.

## PowerSync

The SDK runs inside the sandboxed renderer: encrypted WASM SQLite (ChaCha20) in a worker,
`localOnly` tables for sales/outbox/deltas, no `connect()` yet. The gate result and the
operational findings (explicit VFS, `enableMultiTabs: false`, the SDK's own worker) are in
`.planning/phases/06-pos-offline-core/evidence/powersync-spike.md`.

Production VFS: `OPFSCoopSyncVFS`, with `IDBBatchAtomicVFS` as the fallback.

## Packaging

`maker-squirrel` produces the unsigned Windows installer; `maker-zip` covers Linux/macOS
development builds. Squirrel cannot be built on Linux (no Wine path), so
`.github/workflows/desktop.yml` runs the installer job on `windows-latest`. That job is
`workflow_dispatch` only until the repository has a remote; see the open items in
`.planning/STATE.md`. **The installer is unsigned** — SmartScreen will warn until Phase 9
adds code signing and auto-update.

### Windows identity and icon

| What the user sees | Where it comes from |
|---|---|
| Start Menu / Apps list entry | `productName` (`Sceptre Drive POS`) |
| Installer file | `Sceptre Drive POS-<version> Setup.exe` |
| Install folder | `%LOCALAPPDATA%\SceptreDrivePOS\` (Squirrel `name`) |
| Running executable | `SceptreDrivePOS.exe` (`packagerConfig.executableName`) |
| Taskbar group / notifications | `com.squirrel.SceptreDrivePOS.SceptreDrivePOS` |
| Icon (exe, installer, shortcut, window) | `desktop/icons/icon.ico` |

The package id and executable name are one camel-case word on purpose: Squirrel stamps the
shortcut with `com.squirrel.<package id>.<exe name>`, and a space in either half gives
Windows a second taskbar group for the same app. `src/main/identity.ts` announces the same
id at startup, and `identity.test.ts` fails if `forge.config.mts` drifts from it.

`desktop/icons/icon.ico` is committed (a build must not need ImageMagick). It is generated
from the brand master, which stays the single source of truth:

```bash
magick packages/brand/assets/logo-icon.png -background none \
  -define icon:auto-resize=256,128,64,48,32,24,16 desktop/icons/icon.ico
```

`MakerSquirrel.iconUrl` (the icon in *Programs and Features*) is still unset: it is fetched
from a public HTTPS URL at install time, so it waits for the production domain. macOS needs
an `.icns` before `make` is attempted there.

