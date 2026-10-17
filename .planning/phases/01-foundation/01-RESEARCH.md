---
phase: 01-foundation
researched: 2026-10-17
sources: [better-auth.com/docs, orm.drizzle.team, hono.dev/docs, pgboss.io, bun.com/docs, biomejs.dev, npm registry]
---

# Phase 1 — Research

## Verified versions (npm, 2026-10-17)

| Package | Version | Notes |
|---|---|---|
| `better-auth` | 1.7.10 | Peer `drizzle-orm ^0.45.2`, `drizzle-kit >=0.31.4`, `@tanstack/react-start ^1.0.0`, `pg ^8.0.0` |
| `@better-auth/drizzle-adapter` | 1.7.10 | Adapter is now its own package (not `better-auth/adapters/drizzle`) |
| `drizzle-orm` | 0.45.4 | `1.0.0-rc.4` exists on the `rc` tag; use stable |
| `drizzle-kit` | 0.31.11 | `generate` / `migrate` / `studio` / `check` |
| `hono` | 4.13.13 | Web-standards router |
| `@hono/node-server` | 2.1.5 | `serve()` returns a `node:http` server |
| `@hono/zod-validator` | 0.9.1 | Supports Zod 3.25+ and 4.x |
| `zod` | 4.6.7 | Used for env + request validation |
| `pino` | 10.4.0 | Structured JSON logs |
| `pg` | 8.23.1 | node-postgres driver (Drizzle + pg-boss) |
| `@node-rs/argon2` | 2.2.2 | Argon2id hashing for Better Auth custom hash |
| `resend` | 6.34.1 | Transactional email seam |
| `vitest` | 5.0.5 | Unit/integration tests |
| Bun / Node | 1.3.14 / 24.18.0 | Local environment confirmed |

## Better Auth + Drizzle (current docs)

- Install `better-auth` and `@better-auth/drizzle-adapter`; configure
  `drizzleAdapter(db, { provider: "pg" })`.
- Generate the schema with the CLI:
  `bunx auth@latest generate --adapter drizzle --dialect postgresql --output packages/db/src/schema/auth.ts`
  (works without a database connection). Re-run after adding plugins.
- Date columns generated as `timestamp` (Postgres); strings work too.
- Better Auth validates the configured schema at startup and logs missing tables/columns.
  Drizzle checks the schema object, not the live DB — migrations must still be applied.
- Better Auth on Hono mounts directly:
  `app.all("/api/auth/*", (c) => auth.handler(c.req.raw))`.
- CORS must be registered before the auth route; explicit origin + `credentials: true`;
  the same origin goes in `trustedOrigins`.
- Security defaults to keep: CSRF on, rate limiting on (with per-endpoint rules for
  `/sign-in/email`), secure httpOnly cookies, `SameSite=Lax`.
- Cookie cache: `session.cookieCache = { enabled: true, maxAge: 300, strategy: "compact" }`.
- Password reset: `emailAndPassword.sendResetPassword` + `revokeSessionsOnPasswordReset: true`;
  minimum password length 12.
- Two-factor plugin: `twoFactor({ issuer: "GikAutos" })`; TOTP + backup codes; secrets
  encrypted with the auth secret; session is only created after verification.
- `databaseHooks` (user/session create/update/delete) are the place to write auth audit events.

## Drizzle + node-postgres

- `drizzle({ client: pool, schema })` with `const pool = new Pool({ connectionString })`.
- `drizzle.config.ts`: `dialect: "postgresql"`, schema glob, `out`, `dbCredentials.url`.
- `drizzle-kit generate` produces timestamped SQL + snapshots; `drizzle-kit migrate` applies
  and records in `drizzle.__drizzle_migrations`.
- Use `migrate(db, { migrationsFolder })` at startup only in development; production
  migrations run as a deploy step (Phase 9).
- Postgres 18 is current stable; PowerSync only requires 11+. Enable `wal_level=logical`
  locally now so Phase 6 does not need a database restart surprise.

## Hono on Node 24

- `serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, cb)`; handle `SIGTERM`/`SIGINT`,
  call `server.close()`, `closeIdleConnections()`, then a hard-exit deadline.
- Health route before DB-dependent middleware; readiness checks the pool with `SELECT 1`.
- Register middleware in order: request id → logger → security headers → CORS → routes.
- Use `createFactory()` for a shared `Env` (Variables: session, user, requestId, logger).
- Body limits and explicit CORS origins; never `*` with credentials.

## pg-boss (for later phases, install when first queue exists)

- ESM-only, Node ≥ 22.12; `new PgBoss({ connectionString, schema: "pgboss" })`.
- Queues must be created before `send()`; handlers receive an **array** of jobs.
- Retries use seconds-based fields (`retryLimit`, `retryDelay`, `retryBackoff`,
  `expireInSeconds`, `deleteAfterSeconds`); dead-letter is another queue.
- Phase 1 does **not** add pg-boss; the first queue arrives with loyalty expiry (Phase 4).

## Bun workspaces

- Root `package.json`:
  `"workspaces": { "packages": ["admin", "api", "desktop", "packages/*"], "catalog": { ... } }`.
- Reference shared versions with `catalog:` and internal packages with `workspace:*`.
- `bun install` at the root installs everything; `bun run --filter '<name>' <script>` runs scripts.
- Keep one lockfile; nested lockfiles were removed.

## Biome 2 monorepo

- One root `biome.json` (recommended rules + formatter options); nested configs use
  `"extends": "//"` (implies `root: false`).
- The admin scaffold already has a `biome.json`; convert it to `"extends": "//"` and move
  shared options to the root.

## Admin (TanStack Start) integration notes

- Scaffold already uses Vite 8 + Nitro + Tailwind 4 + shadcn; keep pinned versions.
- Better Auth client: `createAuthClient({ baseURL: import.meta.env.VITE_API_URL + "/api/auth" })`.
- Dev: admin `:3000` calls API `:4000` cross-origin; `localhost` cookies are shared across
  ports and `SameSite=Lax` permits same-site requests; the API must allow the admin origin
  with credentials.
- Production: `admin.example.com` → `api.example.com` is same-site; host-only cookies on
  the API host are sent. CORS + `trustedOrigins` must list the admin origin.
- Session reads for route guards: TanStack Start server function that forwards request
  cookies to `GET {API}/api/auth/get-session`; `beforeLoad` redirects anonymous users.
- Every server function/data call still hits the API, which authorizes independently.

## Security decisions from OWASP / better-auth skills

- Password hash: Argon2id (`@node-rs/argon2`, memoryCost 64 MiB, timeCost 3, parallelism 4).
- Rate limit sign-in at 5/min per IP; TOTP endpoints have built-in limits.
- Trusted origins explicit per environment; CSRF stays on.
- Session fresh-age for sensitive mutations (role changes, resets, deactivation, settings).
- Audit auth events via `databaseHooks`; never log tokens, passwords, PINs, or full PII.
- Generic auth errors (no account enumeration); email sending is backgrounded.
