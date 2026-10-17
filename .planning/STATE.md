# STATE — GikAutos v1

**Milestone:** v1
**Updated:** 2026-10-17
**Status:** Phase 1 in progress — Plans 01 and 02 complete; Plans 03 and 04 pending.
**Next action:** Execute Plan 03 (auth, RBAC, organisation APIs, audit, seeds), then Plan 04
(admin console, CI, phase verification).

---

## Progress

| Phase | Name | Status |
|---|---|---|
| 0 | Planning & decisions | ✅ Complete |
| 1 | Foundation & Platform | 🚧 In progress (2/4 plans) |
| 2 | Catalog & Pricing | ⬜ Not started |
| 3 | Inventory & Transfers | ⬜ Not started |
| 4 | Customers, Credit & Loyalty | ⬜ Not started |
| 5 | Suppliers & Payables | ⬜ Not started |
| 6 | POS Offline Core | ⬜ Not started |
| 7 | POS Payments, Returns & Shifts | ⬜ Not started |
| 8 | Admin Operations, Reports & E-VAT | ⬜ Not started |
| 9 | Production Hardening & Launch | ⬜ Not started |

### Phase 1 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Workspace, tooling, Postgres, shared and db packages | ✅ Complete |
| 02 | API skeleton, configuration, logging, health, first schema | ✅ Complete |
| 03 | Auth, RBAC, organisation APIs, audit, seeds | ⬜ Next |
| 04 | Admin shell, auth flows, CRUD screens, CI, verification | ⬜ Pending |

---

## Repository State

- Fresh git history on `dev`; planning + Phase 1 Plans 01 and 02 committed.
- Root Bun workspace with catalogs; `@gikautos/shared` (roles, permissions, branch codes)
  and `@gikautos/db` (Drizzle client, config, migrations) exist and pass typecheck/tests.
- API boots on Node 24 with Node's native TypeScript type stripping (no build step):
  `bun run dev:api`. Validated env, pino logs, request IDs, security headers, CORS,
  `/health` and `/ready` are implemented and covered by 8 tests.
- Postgres 18 runs via `compose.yaml` on host port **5433** (5432 is taken by a system
  Postgres). `wal_level=logical` and 10 replication slots are enabled for Phase 6.
- Migration `0000` applied: `branch`, `terminal`, `device`, `terminal_enrollment`,
  `audit_log`, `setting`.
- Old-build containers (`gikautos-powersync-*`, `infra-postgres-1`) were removed; their
  volumes were left untouched for now.
- Local `.env` exists (gitignored) with a generated auth secret and dev admin credentials.
- Desktop app, PowerSync config, and infrastructure are created in later phases
  (6, 6, and 9 respectively). A bundle of the deleted prototype's git history is stored at
  `/tmp/opencode/gikautos-old-history.bundle` (safe to delete).

---

## Decisions Log

| Date | Decision |
|---|---|
| 2026-10-17 | The earlier prototype and its planning are discarded; fresh git history on `dev`. |
| 2026-10-17 | v1 scope: POS + back office + inventory + suppliers + credit + loyalty + Paystack. E-commerce, delivery, payroll, GL, AI, fitment, and mobile are out of scope. |
| 2026-10-17 | API: Hono + Drizzle + Better Auth on Node 24. |
| 2026-10-17 | Offline sync: PowerSync Cloud (Free → Pro), Web SDK in the Electron renderer. |
| 2026-10-17 | Database: PostgreSQL 17 on a VPS via Docker; PowerSync Cloud connects over TLS with an IP allowlist. |
| 2026-10-17 | Admin/Manager: TanStack Start. Desktop POS: Electron Forge + Vite + React + shadcn + Tailwind. |
| 2026-10-17 | Ghana GHS; VAT 15% + NHIL 2.5% + GETFund 2.5% = 20%; E-VAT receipt contract now, GRA adapter mock until credentials. |
| 2026-10-17 | Roles: Admin (global), Manager (branch), Cashier (terminal). One cashier per terminal per shift. |
| 2026-10-17 | Credit is branch-local; customer identity and loyalty are global. |
| 2026-10-17 | Offline: cash + credit work; MoMo/card/bank require internet. Never block a sale; oversell, over-limit credit, and loyalty double-spend become reconciliation conflicts. |
| 2026-10-17 | Loyalty: configurable; defaults 1 pt/GHS 1, 100 pts = GHS 1, 12-month expiry. |
| 2026-10-17 | Suppliers: invoices + payments ledger; Paystack transfers + manual fallback. |
| 2026-10-17 | Deployment: one VPS, separate staging/prod Docker stacks, Caddy, GitHub Actions, R2 backups. |
| 2026-10-17 | Scale target: 5 branches, 20 terminals, 5k SKUs, 20k customers. Manual data entry only. |

---

## Open Items (carry forward)

- GRA E-VAT onboarding: credentials, QR encoding, submission API shape (mock until then).
- Paystack registered business and keys; `PAYSTACK_MODE=mock` until then.
- VPS provider, domain, and DNS (Phase 9 setup gate).
- Windows code-signing certificate (Phase 9; unsigned builds first).
- PowerSync Cloud account + two instances (staging/prod) before Phase 6 human verification.
- Physical hardware for human verification: ESC/POS printer, keyboard-wedge scanner, cash drawer.

---

## Session Notes

- Load `gsd` and `owasp-security` before every planning or building task; load
  `powersync`, `hono`, `better-auth-*`, and `supabase-postgres-best-practices` when the
  task touches those areas.
- Plans are prompts. Implement one task at a time and commit atomically.
- Stop and ask before decisions that affect money, credit, stock, loyalty, permissions,
  or production infrastructure.
- The API runs TypeScript directly on Node 24 (`node src/index.ts`) using erasable-syntax
  type stripping; keep source free of TS enums, namespaces, and parameter properties.
- Branch code suggestions use first/second/last consonant for long area names
  (Spintex → SPX, Adum → ADM); codes stay editable before save.
- Root scripts: `bun run db:up`, `dev:api`, `dev:admin`, `lint`, `check-types`, `test`,
  `db:generate`, `db:migrate`, `db:seed`.
