---
phase: 01-foundation
name: Foundation & Platform
depends_on: []
requirements: [FOUND-01..14, ADM-01, ADM-09]
status: planned
created: 2026-10-17
---

# Phase 1 — Foundation & Platform — Locked Context

**Goal:** A clean monorepo runs end to end. Admin and manager sign in; the organisation
(branches, warehouses, terminals, staff) exists; permissions and audit are enforced;
CI is green.

This document records the decisions taken with the operator before writing the plans.
It overrides convenience in any later plan.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Workspace | Bun workspaces at the repo root with `admin/`, `api/`, `desktop/`, `packages/*`; one root lockfile; shared versions via Bun catalogs | Single lockfile, deduped installs, `bun run --filter` for task running |
| D2 | Language/tooling | TypeScript strict, Biome 2 (root config + nested `"extends": "//"`), Node 24 runtime for the API | One formatter/linter; admin already uses Biome |
| D3 | Database | PostgreSQL **18** (current stable; PowerSync supports 11+) via Docker Compose; `wal_level=logical` locally for future sync; Drizzle ORM + drizzle-kit | Local client is psql 18; PowerSync compatibility verified |
| D4 | API framework | Hono 4 + `@hono/node-server` on Node 24; Zod + `@hono/zod-validator`; pino logging; `serve()` + graceful shutdown | Locked stack; verified current versions |
| D5 | ORM / driver | Drizzle stable 0.45.4 + drizzle-kit 0.31.11 with the `pg` (node-postgres) driver; one pool shared by Drizzle and pg-boss later | Single Postgres driver; pg-boss uses `pg` internally |
| D6 | Auth | Better Auth 1.7.10 + `@better-auth/drizzle-adapter`; email/password; no public sign-up; TOTP two-factor | CLI can generate the Drizzle schema without a live DB |
| D7 | Admin bootstrap | Seed the first admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`; **TOTP setup is forced on the first admin login**; managers may enable TOTP optionally | Security baseline; operator decision |
| D8 | Password hashing | Argon2id via `@node-rs/argon2` (Better Auth custom `hash`/`verify`) with ASVS L1 minimum length 12 | OWASP ASVS; pin parameters |
| D9 | Sessions | 7-day sliding (`updateAge` 24 h), 5-minute signed cookie cache, `freshAge` 1 h for sensitive actions | Operator choice; balances UX and revocation |
| D10 | Email | `EmailProvider` seam: console adapter in development, Resend adapter when `RESEND_API_KEY` is set; wired to Better Auth password reset | No key required to develop; production ready later |
| D11 | Branch codes | City + area short form, suggested and editable before save: `ACC-SPX` (Accra/Spintex), `KUM-ADM` (Kumasi/Adum); warehouses use `CITY-WHn` (`ACC-WH1`); uniqueness enforced | Operator wants easy location identification |
| D12 | Terminal / staff IDs | Terminal code = branch code + `-T01`; staff ID = business-wide sequential `GA-0001` (prefix configurable in env) | Operator choice; readable and auditable |
| D13 | RBAC | Fixed roles `ADMIN`, `MANAGER`, `CASHIER`; permission strings `resource.action`; branch scope enforced server-side; admin bypasses branch filter | Manager = full branch admin except global settings |
| D14 | Admin rendering | TanStack Start SSR shell + client-side data via TanStack Query; API is the only auth provider; direct API calls with cookies (dev cross-port, prod same-site subdomains) | Uses TanStack Start properly; API stays the security boundary |
| D15 | Audit | Append-only `audit_log`; explicit `audit()` service calls on mutations plus Better Auth database hooks for session/user events; no PII in logs | OWASP A09; reconciliability |
| D16 | Dev seed | Idempotent seed creates a demo retail branch, a warehouse, a manager, a cashier, and a small catalog | Operator wants testable features immediately |
| D17 | CI | GitHub Actions on PR/push with Postgres service, `bun install --frozen-lockfile`, lint, typecheck, tests, builds | Phase gate FOUND-13 |
| D18 | Package scope | `@gikautos/*` for workspace packages; app names `admin`, `api` | Consistency with the repository name |

## Architectural Invariants (from PROJECT.md — do not violate)

- **Server is authoritative.** Permissions, branch scope, and (later) money/credit/loyalty are decided in the API.
- **Integer money** (pesewas) — even in Phase 1, never introduce floats.
- **Append-only** audit; no update/delete paths for audit rows.
- **No secrets in the repo**; `.env` is ignored, `.env.example` is the template.
- **The API never trusts the admin.** Admin route guards are UX only; every endpoint authorizes itself.
- **Rate limiting** on authentication and other sensitive endpoints (Better Auth built-in + Hono middleware where needed).
- **Fail closed.** Authorization errors deny; errors are logged with a request ID and returned as generic messages.

## Version Pins (verified on npm, 2026-10-17)

`better-auth@1.7.10`, `@better-auth/drizzle-adapter@1.7.10`, `drizzle-orm@0.45.4`,
`drizzle-kit@0.31.11`, `hono@4.13.13`, `@hono/node-server@2.1.5`,
`@hono/zod-validator@0.9.1`, `zod@4.6.7`, `pino@10.4.0`, `pg@8.23.1`,
`@node-rs/argon2@2.2.2`, `resend@6.34.1`, `vitest@5.0.5`; Bun `1.3.14`, Node `24.18`;

## Bootstrap Order

1. Workspace, tooling, Docker Postgres, shared package, db package (Plan 01).
2. API skeleton, env config, logging, errors, health, org/platform schema, migration, tests (Plan 02).
3. Better Auth, RBAC, branches/terminals/devices, staff, audit, settings, seeds (Plan 03).
4. Admin shell, auth pages, CRUD screens, email adapter, CI, phase verification (Plan 04).

## Open Items (carry into later phases)

- PowerSync local sync service container is added in Phase 6; Phase 1 only prepares `wal_level=logical`.
- Cashier PIN fields (`pin_hash`, `pin_version`) are added to the staff schema in Phase 1 for forward
  compatibility but are only populated and used in Phase 6.
- E-VAT, Paystack, and marketing email providers remain mocked until their phases.
