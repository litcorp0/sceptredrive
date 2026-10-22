# PowerSync Web SDK spike — Phase 6 gate

**Date:** 2026-10-22
**Verdict:** ✅ **PASS** — the PowerSync Web SDK runs inside the sandboxed Electron
renderer served from `app://gikautos`, with encrypted, persistent, local-only tables.
Plan 03 (sync config + connector) can proceed on the Web SDK.

## Versions

| Component | Version |
|---|---|
| Electron | 45.0.0 (Chromium 156.0.8078.48, Node 24.18.0) |
| Electron Forge | 8.0.1 (`plugin-vite` 8.0.1, stable on Vite 8) |
| Vite | 8.3.5 |
| `@powersync/web` | 2.5.0 |
| `@powersync/react` | 2.1.0 |
| `@journeyapps/wa-sqlite` | 2.0.8 |
| React | 19.2.0 |

Host: Linux x64 (CachyOS kernel 7.2.9), Electron running under Wayland/X11, packaged
with `maker-zip` and launched with `--no-sandbox --disable-gpu` (headless CI-style host).

## What was proven

Every check below runs in the **production** renderer path (built bundles, `app://`
origin, strict CSP) and again in the **packaged** binary:

| Step | Result |
|---|---|
| Keychain encryption key read from OS storage (44-char base64, 32 random bytes) | ✅ |
| Open encrypted WASM SQLite database (`ChaCha20` via SQLite3MultipleCiphers) | ✅ |
| Insert into a `localOnly` table | ✅ |
| Read back | ✅ |
| Update and read back | ✅ |
| `db.watch()` notifies on change (async-iterator form) | ✅ |
| Close and reopen the database, row still present | ✅ |
| Quit the packaged app and relaunch it, row still present (`run #1` → `run #2`) | ✅ |
| No CSP violations in the console | ✅ |
| No renderer errors | ✅ |

### VFS comparison

| VFS | Works under `app://` | Open time (unpackaged) | Notes |
|---|---|---|---|
| `IDBBatchAtomicVFS` (SDK default) | ✅ | 844–1586 ms | IndexedDB; broadest compatibility |
| `OPFSCoopSyncVFS` | ✅ | 467–982 ms | Faster; OPFS-backed; recommended default |

**Decision (carried into Plan 03):** use **`OPFSCoopSyncVFS`** as the POS database VFS,
with `IDBBatchAtomicVFS` as the fallback when OPFS is unavailable
(`navigator.storage.getDirectory` missing). Both are proven by this gate, so the
fallback is a runtime branch, not an unverified claim.

## Findings that Plan 03 must honour

1. **`vfs: undefined` crashes the db worker.** The SDK's `loadModuleAndVfs` switch has no
   `default` branch, so a value that arrives `undefined` throws
   `resolveVfs is not a function` and the worker retries three times before failing.
   Always pass an explicit `vfs`. Build the adapter with `WASQLiteOpenFactory` so the
   options are not re-resolved through a defaulting layer.
2. **`enableMultiTabs: false`.** The multi-tab default creates shared workers, which the
   POS does not need (one window, one terminal) and which log warnings under `app://`.
3. **Use the SDK's own worker.** `powersync-web copy-assets -o public` writes
   `public/@powersync/worker.js` plus its VFS/WASM chunks; passing
   `worker: '/@powersync/worker.js'` makes the worker resolve its dynamic imports against
   those assets. A bundler-generated worker also works in an unpackaged build but is the
   less predictable path.
4. **CSP is exactly what the research predicted:** `script-src 'self' 'wasm-unsafe-eval'`,
   `worker-src 'self' blob:`, and `connect-src` limited to our origins. No `unsafe-eval`,
   no CSP violations.
5. **Storage lives in the Chromium profile** (OPFS/IndexedDB under `userData`), not as a
   file path we control. Restart persistence is therefore tied to
   `app.getPath('userData')`, which `--user-data-dir` also redirects (used by the E2E for
   isolation).
6. **Local-only tables behave as documented:** `localOnly: true` rows never enter the
   upload queue, which is the POS write model (D7).
7. **No `connect()` was called.** This is a local-only spike; `fetchCredentials` /
   `uploadData` are Plan 03.

## Environment caveat

This host has no freedesktop secret service, so Electron reports
`secureStorage: { available: true, level: 'basic', backend: 'basic_text' }` — the Linux
fallback encrypts with a hardcoded password. The renderer surfaces that level honestly
(`app.getInfo().secureStorage`) so the POS can warn the operator and Plan 04's enrolment
can require `level: 'os'`. On Windows (the Phase 9 target) `safeStorage` uses DPAPI and
reports `os`.

## Reproduction

```bash
bun install
bun run package:pos                      # builds + packages the Linux app
bun run --filter desktop test:spike      # this gate (8 checks)
bun run --filter desktop test:e2e        # shell security + keychain (35 checks)
```

Artifacts written by the gate:

- `powersync-spike-report.json` — both VFS reports with every step and timing
- `powersync-spike.png` — the `#spike` screen after a passing run

## Risks handed to later plans

- Windows packaging/OPFS on a real terminal is unverified until Phase 9's human checklist
  (Plan 09 covers installer + hardware). The IDB fallback keeps a working path if OPFS
  misbehaves on a customer machine.
- The bundled `assets/worker-*.js` is still emitted by Vite (unused at runtime now). It
  can be dropped once Plan 03 wires the real connector, if the build size matters.
