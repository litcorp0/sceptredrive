# Phase 6 — Security review (Plan 09, Task 5)

**Scope:** the offline POS surface added in Phase 6 — device authentication, PowerSync
tokens and streams, staff PINs and bindings, the local encrypted database, the upload
endpoint, sale application, printing, and the Electron shell.
**Standard:** OWASP Top 10:2025 and ASVS 5.0 Level 2 (no HIGH findings open).

## Findings fixed during verification

| Finding | Impact | Fix |
|---|---|---|
| `x-pos-binding` missing from the CORS allowlist | Browser preflight blocked PIN change and binding validation; a cashier could authorize but never replace a temporary PIN. | Added the header and a preflight regression test (`api/src/http/cors.test.ts`). |
| Device token never persisted | Quitting the app lost the long-lived credential and forced re-enrolment, breaking the offline promise. | `persistDeviceToken` at redemption (`routes/login.tsx`). |
| Offline start never resumed sync | A terminal that booted without the network never connected PowerSync or started the uploader. | Re-establish the session on `online` and on manual Sync now (`powersync/provider.tsx`). |
| Local-only rows omitted `id` | Real SQLite rejected `sale_line`, `sale_tender`, and `cart_draft_line` inserts (NOT NULL id). | Generate an id per row. |
| `anonymized_at` missing locally | Customer search failed with `no such column`. | Added the synced column (defense in depth; the stream filters it server-side). |
| Revocation discovered by the credential fetch hid the reason | Pending sales were intact but the UI showed no revoked state. | Derive revocation from the session on the badge and sync page. |
| Credit "continue without approval" could not complete | The approval dialog reopened forever, blocking an over-limit sale the server accepts. | Track the conscious bypass; covered by a pure helper test. |

## ASVS L2 checklist

### Authentication and sessions
- Device tokens are 32 random bytes (256 bits), returned once, stored only as
  `HMAC-SHA256(token)` keyed with the auth secret. Redemption locks the enrollment row
  `FOR UPDATE`; reuse is 400.
- Device JWTs are Ed25519, 15 minutes, `aud=gikautos-pos`, `kid=pos-v1`; the private key is
  required in production (boot fails) and served publicly only as a JWK. Tampering,
  wrong audience, and expired tokens are 401.
- `requireDeviceJwt` re-reads device → terminal → branch on every call and fails closed
  (403 revoked/inactive/warehouse). Revocation takes effect immediately.
- Staff PINs are 4–6 digits with triviality checks shared by API, console, and terminal;
  hashed with Argon2id (64 MiB, t=3, p=4) in the Electron main process with a per-device
  pepper. PIN, hash, and binding tokens never appear in responses, logs, or audit rows.
- One active binding per (device, staff), 90-day expiry, revoked on PIN change, role,
  branch, or deactivation. Lockout is per binding (`pos.pinMaxAttempts`), unlocked by an
  independent manager binding.
- Rate limits: session 30/min, binding authorize 10/min/device, PIN change 10/min/device,
  upload 60/min/device, conflicts/state 60/min/device.
- Console admins are forced through TOTP by the console flow; the API itself relies on
  session + permission checks (pre-existing Phase 1 boundary, unchanged).

### Access control
- Every POS read/write is scoped from the JWT: conflict reads, sync state, and shifts are
  terminal-scoped; uploads verify the body's `deviceId`/`terminalId` against the JWT.
- Reconciliation is `inventory.read`: admins may target one branch or all, managers are
  pinned to their own branch; cashiers 403.
- Managers may reset only cashier PINs in their branch; admins anyone.
- A manager/session cookie cannot call device endpoints (401) and a device JWT cannot call
  admin endpoints (401) — both asserted in the walkthrough.
- Branch and warehouse guards: warehouses cannot host terminals, and a device on an
  inactive terminal/branch is refused.

### Data protection
- The local database is encrypted WASM SQLite (ChaCha20) opened through
  `WASQLiteOpenFactory` + `OPFSCoopSyncVFS`; an explicit `vfs` avoids the SDK default-branch
  crash. The key lives in `safeStorage` only (`secrets.json`, mode 0600, ciphertext only,
  no plaintext fallback; `KEYCHAIN_UNAVAILABLE` otherwise).
- Server credentials never reach the renderer: the config snapshot excludes staff records,
  PIN material, and tokens; the session payload never echoes the device token.
- Error messages never carry payloads or PII; the uploader's stored error fields are codes
  and short messages only.

### Integrity and injection
- The upload is a strict Zod discriminated union (`.strict()`), bounded (1–50 transactions,
  amount ceilings, ISO timestamps); the shared `priceCart` is the only pricing path.
- All API SQL is Drizzle/parameterized; all terminal SQL binds parameters and escapes
  `%`, `_`, and `\` in LIKE terms.
- Exactly-once: one `pos_sync_transaction` row per (terminal, client transaction), reserved
  with `ON CONFLICT DO NOTHING RETURNING`; replays return the stored result with no side
  effects. Proven by the duplicate-upload drill (24/24) and the last-unit race (18/18).
- Append-only stock, credit, and loyalty ledgers; corrections are compensating entries.
  Reconciliation re-derives header/tender/stock/credit/loyalty facts and reports
  divergences without repairing them.
- Price and total drift are stored as charged and flagged; the server never silently
  reprices.

### Electron hardening
- Production loads `app://gikautos` through a privileged standard scheme; never `file://`.
- Strict CSP sent as a header and mirrored in a meta fallback that is a superset (browsers
  intersect). Config origins are checked against a fixed allowlist; a packaged app refuses
  localhost.
- `contextIsolation` on, Node integration off, sandbox on, `window.open` and remote
  navigation denied, all permission requests refused, fuses block `--inspect` and disable
  `NODE_OPTIONS`/`--inspect` in the shipped binary.
- The preload exposes a typed, Zod-validated surface with sender checks; no secrets cross
  IPC except the keychain values the renderer itself set.
- The printer port crosses IPC as a bounded, validated job; native failures collapse to
  `PRINTER_*` codes without raw error text.

### Logging and alerting
- pino structured logs with request IDs; request bodies, tokens, PINs, and PII are not
  logged. Audit covers enrollment, device/token issuance, binding create/change/failure,
  shift open/close/cash movement, sale applied, conflicts, overrides, and credit/loyalty
  entries.
- The POS keeps a local, read-only outbox/conflict log for the manager.

### Exceptional conditions
- All authorization and token failures fail closed; unknown products/invalid totals reject
  one transaction without blocking the rest of the batch; corrupt local payloads
  dead-letter per row.
- A 403 on upload marks the device revoked and pauses (`REVOKED`); a 401 pauses 60 s; 429
  honours `Retry-After`; 5xx backs off. No max-attempt dead letter for network failures, so
  a long outage never drops a sale.

## Dependency audit

`bun audit` (2026-10-23): **2 moderate, 0 high/critical**.

| Advisory | Where | Assessment |
|---|---|---|
| `postcss-selector-parser < 7.1.6` (CPU exhaustion) | `@tailwindcss/typography` in the admin build | Build-time CSS parsing only; not shipped to the POS or the API runtime. Update with the Phase 9 dependency sweep. |
| `esbuild <= 0.24.2` (dev-server request spoofing) | `drizzle-kit`, `vite`, `@tanstack/react-start` | Development tooling only. Neither the POS package nor the API production image runs esbuild. Update in Phase 9. |

No HIGH or CRITICAL advisories. `bun.lock` pins every dependency; Workspace packages are
local.

## Residual risks (accepted)

- **Unsigned Windows builds** until Phase 9 (SmartScreen warnings).
- **Self-hosted PowerSync service** in development/CI; staging/production use PowerSync
  Cloud instances that are not provisioned yet (Phase 9 setup gate). Upgrades follow the
  `next` → `stable` channel discipline; the service is pinned (`1.27.1`).
- **Physical terminal** risks (someone with the unlocked device can read the local DB via
  the app) are mitigated by OS encryption, the PIN session, and device revocation; they
  cannot be eliminated on a shared till.
- **`basic_text` keychain on Linux** is reported as `secureStorage.level: 'basic'`; a
  production Windows terminal reports `os` (DPAPI). Enrollment may require `os` in Phase 9.
- **Local API origin refusal** for packaged builds is deliberate and means packaged E2E
  against localhost is impossible; the production renderer path is exercised unpackaged.
- **Manager discount/credit approvals are revalidated on sync**; if the approving binding
  died offline, the sale applies and `OVERRIDE_INVALID` is raised for review — never a
  silent approval.

## Conclusion

**No open HIGH findings.** The seven issues found and fixed during this phase are listed
above; the walkthrough, race, duplicate, and Electron end-to-end suites assert the security
behaviours directly (401/403 scoping, revocation, no token/PII leakage, CSP with no
violations, no Node in the renderer).
