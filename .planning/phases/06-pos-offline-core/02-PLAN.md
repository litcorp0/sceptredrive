---
phase: 06-pos-offline-core
plan: 02
wave: 1
title: Desktop shell, Electron security, keychain, and PowerSync spike
requirements: [POS-01, POS-02, POS-14, SYNC-01, SYNC-08]
depends_on: []
status: planned
created: 2026-10-22
---

# Plan 02 — Desktop Shell, Security, Keychain, PowerSync Spike

**Goal:** A hardened Electron Forge 8 + Vite 8 + React 19 shell boots on Linux and can be
packaged for Windows; the renderer runs behind an `app://` origin with a strict CSP and no
Node access; secrets are stored with async `safeStorage`; and a PowerSync Web SDK
database (WASM worker, encryption, persistence) works inside that renderer. The spike's
outcome is recorded before any POS feature is built.

## Task 1 — Scaffold the desktop workspace

**Files:** `desktop/package.json`, `desktop/forge.config.ts`,
`desktop/vite.main.config.ts`, `desktop/vite.preload.config.ts`,
`desktop/vite.renderer.config.ts`, `desktop/tsconfig.json`, root `package.json`,
root `package.json` workspaces/self-contained settings, `biome.json` ignores,
`.gitignore`

- Scaffold with the official generator
  (`npx create-electron-app@latest desktop --template=vite --typescript`) into
  `desktop/`, then adapt:
  - remove the generated lockfile and let the root Bun workspace own installation;
  - scripts use `bun x electron-forge start|package|make` and `bun run` for Vite/tsc;
  - `@electron-forge/*` **8.0.1**, `electron` **45**, `vite` **8.3.x**, React 19.2,
    `@vitejs/plugin-react`, TypeScript, Tailwind v4 (`@tailwindcss/vite`), shadcn setup;
  - `"main": ".vite/build/main.cjs"` and preload at `preload.cjs` (Forge 8);
  - `"type": "module"`; Forge config is ESM (`forge.config.ts`).
- Make `desktop` self-contained for packaging:
  `"installConfig": { "hoistingLimits": "workspaces" }` in `desktop/package.json`
  (or root `workspaces.selfContained: ["desktop"]`). Confirm `desktop/node_modules`
  contains real directories, not symlinks, for `react`, `@powersync/web`,
  `@maxxuxx/node-printer` (added in Plan 07).
- Forge config: Vite plugin with main/preload/renderer entries, `packagerConfig:
  { asar: true, name: 'GikAutos POS' }`, `plugin-auto-unpack-natives`,
  `maker-squirrel` (Windows), `maker-zip` (Linux/dev), fuses plugin.
- Root scripts: `dev:pos`, `build:pos`, `package:pos`, `make:pos`; root `check-types`,
  `lint`, `test`, and `build` include the desktop workspace.
- Add a minimal `src/main/main.ts` (create window, load renderer), `src/preload/preload.ts`,
  and `src/renderer/main.tsx` with a placeholder route so the app boots.

**Verify:** `bun install`; `bun run dev:pos` opens a window; `bun run build:pos`;
`bun run package:pos` produces an unpacked app on Linux; `bun run lint`,
`bun run check-types`; `desktop/node_modules/react` is a real directory.
**Commit:** `feat(desktop): scaffold electron forge 8 pos shell`

## Task 2 — Security baseline

**Files:** `desktop/src/main/main.ts`, `desktop/src/main/protocol.ts`,
`desktop/src/main/windows.ts`, `desktop/src/main/security.ts`,
`desktop/index.html`, `desktop/forge.config.ts`

- Register `app` as a privileged standard/secure scheme with
  `registerSchemesAsPrivileged` and serve the built renderer via `protocol.handle('app',
  …)`; dev uses the Vite dev-server URL, production uses `app://gikautos/index.html`.
  Never use `file://` for the app.
- `BrowserWindow`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webviewTag: false`, `preload: path.join(__dirname, 'preload.cjs')`, `show: false` until
  `ready-to-show`. Disable devtools in production; keep them in dev only.
- `will-navigate` blocks any URL not matching the app origin; `setWindowOpenHandler`
  denies all; `session.setPermissionRequestHandler` denies camera/mic/geolocation/
  notifications/notifications; `webContents.on('will-attach-webview')` prevents webviews;
  `app.on('web-contents-created')` applies the same rules to every contents.
- Verify IPC senders: every `ipcMain.handle` checks `event.senderFrame.url` starts with the
  app origin (dev server or `app://`) and the sender is the main window.
- CSP (response header from the protocol handler and a `<meta>` fallback):
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'
  https://api.gikautos.com https://*.powersync.journeyapps.com ws://localhost:*;
  worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
  The API/PowerSync origins come from validated runtime config, not string concatenation.
- Fuses: `RunAsNode: false`, `EnableCookieEncryption: true`,
  `EnableNodeOptionsEnvironmentVariable: false`, `EnableNodeCliInspectArguments: false`,
  `EnableEmbeddedAsarIntegrityValidation: true`, `OnlyLoadAppFromAsar: true`.
- Add a `security.test.ts` asserting the CSP string includes `wasm-unsafe-eval` and
  `worker-src`, and that no `nodeIntegration`/`webviewTag`/`webSecurity: false` exists in
  the main sources (source-level guard).

**Verify:** app boots in dev and packaged mode; `window.require`, `process`, and
`ipcRenderer` are undefined in the renderer; an attempted `window.open('https://…')` is
denied; DevTools cannot open in a production build; the CSP header is present on
`app://gikautos/index.html`.
**Commit:** `feat(desktop): harden electron shell and renderer origin`

## Task 3 — Typed preload IPC and keychain

**Files:** `desktop/src/preload/preload.ts`, `desktop/src/renderer/lib/desktop-api.ts`,
`desktop/src/main/ipc/keychain.ts`, `desktop/src/main/ipc/app-info.ts`,
`desktop/src/shared/ipc.ts`

- Define one `DesktopApi` interface in `desktop/src/shared/ipc.ts`; preload exposes only
  whitelisted methods via `contextBridge.exposeInMainWorld('gikautos', api)`:
  `app.getInfo()`, `secure.get(key)`, `secure.set(key, value)`, `secure.delete(key)`,
  and (later plans) `printer.*`, `pin.*`, `config.*`. No generic `invoke(channel, …)`.
- Main keychain service: async `safeStorage` only. `get` decrypts; `set` encrypts and
  writes to `userData/secrets.json` (or a single file per key) with mode `0600`; values
  are JSON strings. `isAsyncEncryptionAvailable()` must be true on Windows/Linux with a
  secret service; if unavailable, fail closed for device enrollment/sync and surface
  `KEYCHAIN_UNAVAILABLE` (do not fall back to plaintext).
- Store/derive keys: `deviceToken`, `powersyncDbKey` (32 random bytes, base64),
  `deviceId`, `terminalId`, `branchId`, `apiBaseUrl`, `powersyncUrl` (non-secret config
  can be a separate unencrypted `config.json`).
- Validate every IPC input with Zod (or hand-written guards) and return typed errors; log
  only key names, never values.
- Renderer wrapper throws a typed `DesktopUnavailableError` when `window.gikautos` is
  missing (web dev) so tests can mock it.

**Verify:** unit tests for encrypt/decrypt round-trip with a mocked `safeStorage`; a
dev-manual check that `secrets.json` contains ciphertext, not the token; missing preload
fails with the typed error; `check-types`.
**Commit:** `feat(desktop): add typed preload bridge and safeStorage keychain`

## Task 4 — PowerSync Web SDK spike (phase gate)

**Files:** `desktop/src/renderer/lib/powersync/spike.ts`,
`desktop/src/renderer/lib/powersync/spike-schema.ts`,
`desktop/vite.renderer.config.ts`, `desktop/public/@powersync/*` (generated),
`desktop/scripts/copy-powersync-assets.mjs`, `desktop/package.json`,
`.planning/phases/06-pos-offline-core/evidence/powersync-spike.md`

- Install `@powersync/web@2.5.0`, `@powersync/react@2.1.0`,
  `@journeyapps/wa-sqlite@2.0.8`.
- Vite renderer config: `optimizeDeps.exclude: ['@powersync/web']`,
  `worker.format: 'es'`, `base: './'` for the packaged build; run
  `powersync-web copy-assets -o public/@powersync` in `postinstall` and before build.
- Instantiate **one** `PowerSyncDatabase` at module scope with:
  - a spike schema containing one synced-style table and one `localOnly` table;
  - `database: { dbFilename: 'gikautos-spike.db' }` and the default VFS first;
  - `encryptionKey` read from the keychain (generate on first run);
  - no `connect()` (local-only spike).
- Prove: create DB, insert/read/update, watch a query, close and reopen the app and read
  the row back, and confirm the file exists under `userData`; then repeat with
  `WASQLiteVFS.OPFSCoopSyncVFS` and record which VFS works under `app://`.
- Record in `evidence/powersync-spike.md`: Electron/Forge/Vite/PowerSync versions, VFS
  outcome, worker asset paths, CSP changes actually required, startup time, and the
  decision for the production VFS. **If the Web SDK cannot run in the sandboxed renderer,
  stop and escalate** — the fallback (Node SDK in main + IPC) is a different architecture
  and needs operator approval.
- Add a `powersync-spike.test.ts` (renderer unit test with a mocked DB where possible) and
  a Playwright `_electron.launch` smoke that asserts the spike route reports success.

**Verify:** spike route shows `OK` in dev **and** in a packaged Linux build; data survives
restart; no CSP violations in the console; `check-types`; the evidence file records the
gate result.
**Commit:** `feat(desktop): prove powersync web sdk in electron`

## Task 5 — Packaging and Windows job

**Files:** `.github/workflows/desktop.yml`, `desktop/README.md`

- Add a `windows-latest` job that runs `bun install --frozen-lockfile`,
  `bun run lint`, `bun run check-types`, `bun run --filter desktop test`,
  `bun run make:pos -- --platform win32 --arch x64`, and uploads `desktop/out/make/**`.
  The job is manual (`workflow_dispatch`) until a git remote exists; keep the Linux CI job
  unchanged except for building the desktop workspace.
- Document local commands, the self-contained workspace requirement, the `app://` origin,
  and the unsigned-installer caveat.
- Confirm Squirrel output exists and the packaged app launches on Linux (`maker-zip`).

**Verify:** workflow lints with `actionlint`; a local `bun run package:pos` succeeds; the
Windows job is documented as pending the remote (open item), not silently skipped.
**Commit:** `chore(desktop): add windows packaging workflow and docs`

## Done When

The desktop workspace builds and packages from the Bun monorepo; the renderer is isolated
behind `app://` with a strict CSP and no Node access; secrets are ciphertext via async
`safeStorage`; and the PowerSync Web SDK spike is proven (or explicitly escalated) with
its evidence recorded before feature work begins.
