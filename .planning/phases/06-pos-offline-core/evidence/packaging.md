# Phase 6 — Packaging evidence (Plan 09, Task 5)

**Date:** 2026-10-23
**Host:** Linux x64 (dev VM), Electron 45.0.0, Electron Forge 8.0.1, Vite 8.3.5

## Artefacts

| Artefact | Path | SHA-256 |
|---|---|---|
| Linux unpacked binary | `desktop/out/GikAutos POS-linux-x64/GikAutos POS` | `cc7fe11c5f394cf12a0c55339fc2e62c44a5791199cc740dec3cd013c689ff27` |
| Linux ZIP (archive of the package) | `desktop/out/make/zip/linux/x64/GikAutos POS-linux-x64.zip` | `710a2c6d7ce61663954626a965c69f1242c226bde75f478f895cf581dc596ab8` |

The ZIP was produced with `python3 -m zipfile` because the host has no `zip` binary and
Forge's ZIP maker shells out to it (`spawn zip ENOENT`). CI runners and the Windows image
ship `zip`, so `bun run make:pos` is expected to work there. Recorded as an environment
gap, not a code change: the maker configuration itself is sound (the same hook produced
`desktop/out/make`).

## What the packaged build proves

`bun run --filter desktop test:e2e` — **38/38**:

- the packaged app loads from `app://gikautos` (never `file://`);
- `window.require`, `process`, `module`, and `ipcRenderer` are absent in the renderer;
- the fuses block `--inspect` (no Node debugger in the shipped binary);
- the protocol handler sends the CSP header and `index.html` carries the meta fallback;
- `window.open` and remote navigation are denied; no extra window is created;
- no CSP violations in the console.

`node desktop/test/e2e/print-smoke.mjs` — **21/21**: receipt text columns, money fields,
drawer kick bytes, cut, simulated failure → retry, reprint marker, no CSP/page errors.

Earlier phase evidence (still valid): `smoke-pin-ui.mjs` 5/5 (Argon2 over real IPC in the
packaged app) and `smoke-selling-ui.mjs` (route guards) against the same package.

## Windows installer

The unsigned Squirrel installer cannot be built on this host and requires a
`windows-latest` GitHub runner. `.github/workflows/desktop.yml` contains the job, but it is
`workflow_dispatch` until a git remote exists. **Pending** (operator action): push `dev`,
run the job, then install on a clean Windows VM and repeat the packaged smoke with the fake
or real printer. Acceptance: the app launches, enrols, sells, and prints; the installer is
unsigned (no code-signing certificate yet — Phase 9).

## Accepted limitations

- v0.1.0 is unsigned; SmartScreen will warn until the Phase 9 certificate is installed.
- Linux packages are produced for verification only; the POS target is Windows.
- The packaged binary intentionally refuses `http://localhost` API/PowerSync origins
  (`allowLocalOrigins = isDev || !app.isPackaged`). The end-to-end tests therefore run the
  **unpackaged production build** (same `app://` renderer and CSP) against the local API;
  a packaged binary is never pointed at a local impersonator.
- Hardware (ESC/POS printer, drawer, keyboard-wedge scanner) is not present; the fake
  adapter writes exactly the bytes the real adapter would send.
