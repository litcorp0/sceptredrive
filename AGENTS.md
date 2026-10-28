# AGENTS.md — Sceptre Drive v1

This file is the standing contract for every agent working in this repository.
Read it at the start of every session, then load the skills it names.

## The one thing that must work

**The POS never stops selling, and stock, credit, and loyalty truth is always reconcilable.**
Cash and credit sales, receipts, shifts, and local stock movements work with the network
unplugged. Everything syncs bi-directionally and idempotently on reconnect, without
double-selling or losing a transaction.

## Absolute rules

1. **Research before you build.** Always look up the current, official documentation
   (Paystack, PowerSync, Electron Forge, TanStack Start, Better Auth, Drizzle, Hono,
   PostgreSQL) before producing any command, scaffold, config, or implementation.
   Never hand-roll what an official generator, CLI, or documented pattern already provides.
2. **Load the relevant skills before planning or coding.** At minimum:
   - `gsd` — planning, phase execution, verification.
   - `owasp-security` — **mandatory for every planning and building task**; treat its
     OWASP Top 10 / ASVS 5.0 / LLM guidance as acceptance criteria.
   - `powersync` — before any sync work.
   - `better-auth-best-practices` (+ `email-and-password-best-practices`,
     `better-auth-security-best-practices`,
     `organization-best-practices` when the task touches those areas).
   - `hono` — before any API route/middleware work.
   - `supabase-postgres-best-practices` — before schema, query, or index work.
   - `web-design-guidelines` / `frontend-design` — before UI work.
3. **Server is authoritative.** Money, tax, credit, loyalty, stock projections, and
   permissions are decided server-side. The client shows provisional values only.
4. **Integer money.** All amounts are integer minor units (pesewas). Never use floats for money.
5. **Append-only truth.** Stock movements, credit ledgers, and loyalty ledgers are append-only.
   Corrections are compensating entries, never edits or deletes.
6. **No secrets in the repo.** `.env` is ignored; `.env.example` is the template.
   Never log PII, tokens, PINs, card data, or Paystack secrets.

## Stack

| Layer | Technology |
|---|---|
| Package manager / workspace | Bun workspaces (single root lockfile) |
| API | Hono on Node 24, Zod, pino, Drizzle ORM, Better Auth, pg-boss |
| Database | PostgreSQL 17 (Docker on VPS; local via Docker Compose) |
| Admin / Manager | TanStack Start, React 19, Tailwind v4, shadcn, TanStack Query |
| Desktop POS | Electron Forge + Vite, React 19, Tailwind v4, shadcn, PowerSync Web SDK |
| Offline sync | PowerSync Cloud for staging/production; self-hosted Docker service for development/CI; branch-scoped Sync Streams |
| Payments | Paystack Ghana (MoMo, card, bank transfer, refunds, supplier transfers) |
| Currency / tax | GHS, VAT 15% + NHIL 2.5% + GETFund 2.5% = 20% on one base |
| E-VAT | Receipt contract now; mock provider until GRA onboarding |
| Reverse proxy / TLS | Caddy on a single Ubuntu VPS (staging + production stacks) |
| CI/CD | GitHub Actions; images to GHCR; SSH deploy; R2 encrypted backups |

## Repository layout

```text
admin/         TanStack Start console (Admin + Manager)
api/           Hono API (also owns Drizzle schema, migrations, and seeds)
desktop/       Electron Forge POS
packages/      shared (domain logic), db (Postgres client), brand (design tokens)
powersync/     sync-config.yaml + setup docs
design-system/ human-facing design rationale; `packages/brand` is the machine truth
infra/         Dockerfiles, compose stacks, Caddyfile, backup scripts (Phase 15)
.planning/     GSD project memory (this is the source of truth for scope)
```

> **Test command (2026-10-25):** always write `bun run test`. Bare `bun test` resolves to
> Bun's builtin runner, which ignores the workspace `test` scripts and runs every test file
> with the wrong setup.

> **Renamed 2026-10-24:** the product, workspace scope, and infrastructure were renamed to
> **Sceptre Drive** (`@sceptre/*`). The dev database is `sceptre_drive`, the desktop origin
> is `app://sceptre-drive`, and the code sweep is complete. The rename moved Electron's
> `userData` directory, so existing development terminals must re-enrol.

### API module layout (`api/src/modules/<domain>/`)

Every module keeps the same seven files, one concern per file:

| File | Responsibility |
|---|---|
| `<module>.routes.ts` | Paths, middleware, validators, controller wiring only |
| `<module>.validation.ts` | Zod schemas and the Hono validators composed from them |
| `<module>.controller.ts` | HTTP handlers: validated input → service → response |
| `<module>.service.ts` | Business rules, authorization, transactions, audit |
| `<module>.repository.ts` | Drizzle data access only; no business logic |
| `<module>.schema.ts` | Drizzle table definitions owned by the module |
| `<module>.types.ts` | TypeScript types, `z.infer` aliases, row types |

Flow: routes → validation → controller → service → repository → database.
Controllers never import repositories; services never import Hono types
(`Context`, middleware); cross-module calls go service-to-service. Drizzle
tables live in the owning module's `<module>.schema.ts` (cross-module FKs
reference sibling schema files); migrations and seeds live in `api/`
(`api/migrations`, `api/src/seed`), and `packages/db` provides only the
shared Postgres client. Shared HTTP infrastructure lives in `api/src/http/`,
auth in `api/src/auth/`.

## Workflow (GSD)

- Project memory lives in `.planning/`. **Read `.planning/STATE.md`, `PROJECT.md`,
  `REQUIREMENTS.md`, and `ROADMAP.md` before starting any task.**
- Work phase by phase. Each phase gets `00-CONTEXT.md`, research, detailed `PLAN.md`,
  and a verification pass before moving on.
- Plans are prompts. Implement one task at a time; commit atomically with conventional
  commit messages (`feat(...)`, `fix(...)`, `test(...)`, `docs(...)`, `chore(...)`).
- Goal-backward verification: prove the phase goal with tests or explicit human steps,
  not just "tasks done".
- Stop and ask when a decision affects money, credit, stock, loyalty, permissions, or
  production infrastructure.

## Parallel builds

`/parallel-build` runs a plan through parallel lane subagents. The controller keeps
the plan, the state file, and the root files; it never implements a lane's work
itself.

| Lane | Agent | Owns |
|---|---|---|
| shared | `shared-lane` | `packages/**` |
| api | `api-lane` | `api/**` (includes migrations and seeds) |
| admin | `admin-lane` | `admin/**` |
| pos | `pos-lane` | `desktop/**` |
| verification | `verify` | nothing — runs gates, read-only |
| review | `review` | nothing — reviews the diff, read-only |

Rules that make parallelism safe here:

- **One writer per lane.** Never dispatch two implementers into the same lane.
- **Disjoint file sets.** Two tasks that touch the same file are one lane task.
- **`packages/**` goes first and alone**, because both clients and the API depend
  on it. The controller hands the new exported names to the app lanes.
- **Root files belong to the controller** (`package.json`, `bun.lock`, `biome.json`,
  `compose.yaml`, `.github/`, `.planning/`, `AGENTS.md`). A lane reports
  `NEEDS_LANE_CHANGE`; the controller edits serially.
- **No repository-wide gate while a lane is writing.** Lanes run their own narrow
  suite, then `verify` runs the full gates once every lane is idle.
- **Read-only work parallelises freely**: `explore` for research, `verify` for
  gates, `review` for diffs.
- `experimental.subagent_depth` is `2`, so a lane may dispatch `verify` or `review`
  on its own change without routing back through the controller.

The non-negotiables do not relax under parallelism: server authority, integer
money, append-only ledgers, idempotency keys, and the rule that a decision about
money, credit, stock, loyalty, permissions, or production still stops and asks.

## Branching

- `dev` — local integration branch (feature branches → PR to `dev`).
- `staging` — created on the remote later; deploys staging.
- `main` — created on the remote later; protected; deploys production.
- Never push directly to `main`. Never commit secrets.

## Commands

From the repository root: `bun dev` (all workspaces), `bun dev:api`, `bun dev:admin`,
`bun dev:pos`, `bun lint`, `bun lint:fix`, `bun check-types`, `bun run test`, `bun build`,
`bun run brand:check`, plus the `db:*` (migrate, seed, test prepare), `sync:*`
(init, up, down, logs, config-check), and `*:pos` (build, package, make) scripts.
`bun run test` needs `sceptre_drive_test` migrated: run `bun run db:test:prepare` after a fresh
`docker compose up -d`.

## Non-negotiables for the POS

- Cash and credit work offline; MoMo/card/bank require internet.
- One cashier per terminal per shift; offline PIN login is device-bound.
- Never block a sale at the till. Stock oversell, over-limit credit, and loyalty
  double-spend are applied and recorded as sync conflicts for manager review.
- Every POS-originated mutation carries a client-generated idempotency key.
- Manager overrides are PIN-authorized, reason-coded, audited, and revalidated on sync.

## Current status

Phases 1–6 are complete and verified. Phase 7 (Identity, Design System & Brand
Foundation) is in progress; Phases 8–15 are planned. See `.planning/STATE.md`.
