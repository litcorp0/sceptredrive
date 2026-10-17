# AGENTS.md — GikAutos v1

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
     `better-auth-security-best-practices`, `two-factor-authentication-best-practices`,
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
| Offline sync | PowerSync Cloud (Free → Pro), branch-scoped Sync Streams |
| Payments | Paystack Ghana (MoMo, card, bank transfer, refunds, supplier transfers) |
| Currency / tax | GHS, VAT 15% + NHIL 2.5% + GETFund 2.5% = 20% on one base |
| E-VAT | Receipt contract now; mock provider until GRA onboarding |
| Reverse proxy / TLS | Caddy on a single Ubuntu VPS (staging + production stacks) |
| CI/CD | GitHub Actions; images to GHCR; SSH deploy; R2 encrypted backups |

## Repository layout

```text
admin/        TanStack Start console (Admin + Manager)
api/          Hono API
desktop/      Electron Forge POS (created in Phase 6)
packages/     shared, db, sync, ui (created in Phase 1)
powersync/    sync-config.yaml + setup docs (created in Phase 6)
infra/        Dockerfiles, compose stacks, Caddyfile, backup scripts (Phase 9)
.planning/    GSD project memory (this is the source of truth for scope)
```

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

## Branching

- `dev` — local integration branch (feature branches → PR to `dev`).
- `staging` — created on the remote later; deploys staging.
- `main` — created on the remote later; protected; deploys production.
- Never push directly to `main`. Never commit secrets.

## Commands

Root scripts will be added in Phase 1 (`bun dev`, `bun lint`, `bun check-types`,
`bun test`, `bun build`). Until then, each workspace keeps its own scripts:
`admin/` (Vite/TanStack Start) and `api/` (Hono/tsx).

## Non-negotiables for the POS

- Cash and credit work offline; MoMo/card/bank require internet.
- One cashier per terminal per shift; offline PIN login is device-bound.
- Never block a sale at the till. Stock oversell, over-limit credit, and loyalty
  double-spend are applied and recorded as sync conflicts for manager review.
- Every POS-originated mutation carries a client-generated idempotency key.
- Manager overrides are PIN-authorized, reason-coded, audited, and revalidated on sync.

## Current status

Planning is complete and approved. The next step is Phase 1 planning and execution.
See `.planning/STATE.md`.
