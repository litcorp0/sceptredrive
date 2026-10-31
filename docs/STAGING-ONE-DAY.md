# One-day staging on free tiers — Render, Neon, Vercel, PowerSync Cloud

> **This is a disposable environment.** It exists to prove the deployed path end to end:
> a real API on Render, a real Postgres on Neon with PowerSync replicating from it, the
> console on Vercel, the public site on Vercel, and a POS uploading to it. It is torn down
> the same day (see §12). Nothing here is a production deployment, and no real customer
> data should enter it.
>
> Every value marked `<…>` is yours to substitute. Every command is copy-pasteable from the
> repository root unless a step says otherwise.

---

## 0. Run sheet

| # | Step | Time | Blocked by |
|---|---|---|---|
| 0 | Generate the auth secret + POS signing key | 2 min | nothing |
| 1 | Neon: project, logical replication, role, publication | 15 min | step 0 not needed |
| 2 | Migrate + seed from your laptop | 10 min | step 1 |
| 3 | Render: service, env, deploy, CORS preflight | 20 min | steps 0–2 |
| 4 | PowerSync Cloud: instance, DB connection, JWKS, sync config | 15 min | steps 1 + 3 (needs the JWKS URL) |
| 5 | Vercel: two projects, env, deploy | 20 min | step 3 |
| 6 | Console login across origins | 10 min *or an hour* | steps 3 + 5 |
| 7 | POS: config, enrol, one offline sale | 15 min | steps 3 + 4 |
| 8 | Prove the twelve checks (§10) | 15 min | everything |
| 9 | Takedown (§12) | 10 min | done |

Half a day if the cross-site cookie behaves; a full one if it does not. **Cost for the day:
$0**, or about $7 if you put Render on a paid instance so jobs never sleep.

---

## 1. What you will have at the end

| Piece | Host | URL | Notes |
|---|---|---|---|
| API | Render | `https://<api>.onrender.com` | Hono, `pg-boss` jobs, must be paid/awake to test jobs |
| Database | Neon | `ep-…neon.tech` | Frankfurt, logical replication on, **direct** URL |
| Sync | PowerSync Cloud | `https://<instance>.powersync.journeyapps.com` | development instance, same `sync-config.yaml` |
| Console | Vercel | `https://<admin>.vercel.app` | TanStack Start SSR |
| Public site | Vercel | `https://<web>.vercel.app` | TanStack Start SSR, reads `/api/public/site` |
| Till | Your machine | — | `config.json` points at Render + PowerSync Cloud |

**The one invariant:** the POS never needs Vercel or Neon directly. It talks to the API and
to PowerSync; PowerSync talks to Neon. If the graph looks like anything else, something is
misconfigured.

---

## 2. What the free tiers give you, and where they bite

| Service | Free plan | What will bite today |
|---|---|---|
| **Neon** | 1 project, 0.5 GB, scale-to-zero after 5 min | PowerSync keeps the compute awake, so it will not scale to zero — fine for one day, expensive for a month. **Logical replication is irreversible.** |
| **Render** | 750 h/month, sleeps after ~15 min idle | Cold start ~50 s on the first request. **No shell on free**, so migrations run from your laptop. `pg-boss` pauses while asleep. |
| **Vercel** | Hobby | **Nominally non-commercial.** A private one-day test is a defensible use; if that bothers you, see §13. |
| **PowerSync Cloud** | development instance | Fine for one terminal. Sync config redeploys cause a re-snapshot. |

---

## 3. Prerequisites

- Accounts: Neon, Render, Vercel, PowerSync Cloud (all free), plus a GitHub repo access token
  if you deploy from Git.
- Tools locally: `bun` (repo version), `node` 24, `psql`, `curl`.
- The repo checked out and green: `bun run check-types && bun run lint && bun run test`.
- A scratch file for secrets (`~/sceptre-staging.env`). **Never paste these into the repo.**
- The two free-tier rules: **migrations run from your laptop** (Render free has no shell), and
  **PowerSync must use the direct Neon host** (no `-pooler`).

---

## 4. Step 0 — Generate the two secrets before you create anything

The API refuses to boot in production without them (§3 of `api/src/config/env.ts`).

```bash
# 1. An auth secret: 32+ bytes, random, new for this environment.
openssl rand -base64 48

# 2. The POS signing key (Ed25519). Prints the private key and the public JWKS.
bun run --filter api keys:generate
```

Record in `~/sceptre-staging.env`:

```
BETTER_AUTH_SECRET=<paste openssl output>
POS_JWT_PRIVATE_KEY=<paste the value printed by keys:generate>
POS_JWT_KEY_ID=pos-v1
```

`POS_JWT_KEY_ID` is referenced by the API, by PowerSync's audience check and by the till. Keep
it `pos-v1` for today.

> **Why the key matters:** the API signs each device's short-lived JWT with this key and
> publishes the public half at `/.well-known/jwks.json`. PowerSync fetches that URL to verify
> a till's token. A mismatch between the key and the JWKS URL is the single most common
> "sync connects but nothing arrives" cause.

---

## 5. Step 1 — Neon

### 5.1 Create the project

1. New project → **region: Frankfurt (`eu-central-1`)**. Same region as Render, so API↔DB is
   a few milliseconds rather than crossing an ocean.
2. Copy **two** connection strings from the dashboard:
   - **Direct** — host looks like `ep-xxxx.eu-central-1.aws.neon.tech` (no `-pooler`).
   - **Pooled** — host contains `-pooler`.
   Record both. **Migrations and PowerSync use the direct one.**

### 5.2 Turn on logical replication — do this before migrating

Neon → Settings → Postgres → **enable Logical Replication**. It is **irreversible** and it
restarts every compute on the project. Doing it first means one restart, not a migration then
another restart.

CLI equivalent:

```bash
neon projects update <project-id> --enable-logical-replication --yes
```

### 5.3 Create the PowerSync role and publication

Connect with `psql "<direct-url>"` and run:

```sql
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD '<strong-password>';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;

CREATE PUBLICATION powersync FOR ALL TABLES;
```

Record `powersync_role` + that password; PowerSync needs them in §7.

### 5.4 Migrate and seed — from your laptop

```bash
export NEON_DIRECT='postgresql://neondb_owner:<password>@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require'

DATABASE_URL="$NEON_DIRECT" bun run db:migrate
DATABASE_URL="$NEON_DIRECT" bun run seed:admin
DATABASE_URL="$NEON_DIRECT" bun run db:seed        # optional: demo catalogue
```

`seed:admin` uses `ADMIN_EMAIL` / `ADMIN_PASSWORD` from the repo `.env`; `db:seed` builds the
demo branch, terminal, staff and catalogue. The shell `DATABASE_URL` wins over `.env` because
`dotenv` does not override an existing variable.

**Verify before moving on:**

```bash
psql "$NEON_DIRECT" -c "select count(*) from sale;"          # 0, or seeded sales
psql "$NEON_DIRECT" -c "select code, name from branch;"
psql "$NEON_DIRECT" -c "select key from setting limit 5;"
```

If `branch` is empty you will deploy an API with nothing to sync.

---

## 6. Step 2 — Render (the API)

### 6.1 Create the service

New → **Web Service** → connect the repo. Fill it in exactly like this:

| Field | Value | Why |
|---|---|---|
| Root Directory | `.` (repo root) | A Bun workspace: `api` alone cannot resolve `@sceptre/shared` / `@sceptre/db` |
| Runtime | Node | the API runs on Node, not Bun |
| **Node version** | **`24`** (env `NODE_VERSION=24`) | it runs `node src/index.ts`; Node 24 strips TS types |
| Build Command | `npm i -g bun && bun install --frozen-lockfile` | one lockfile at the root |
| Start Command | `cd api && node src/index.ts` | parity with local |
| Health Check Path | `/health` | the API serves `/health` and `/ready` |
| Instance type | Free for today | it sleeps after ~15 min idle; the first request takes ~50 s |

> **The two failures that look like "it won't start":**
> 1. **Node 22** — no type stripping, the process exits on the first `import … from './x.ts'`.
> 2. **The port.** The API binds `0.0.0.0` but reads **`API_PORT`**, while Render routes to
>    `PORT`. Set **both** to `10000` in the service env, or every request is a 502.

### 6.2 Environment variables

Add these on the Render service (Environment tab). Nothing else is required today.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24` |
| `API_PORT` | `10000` |
| `PORT` | `10000` |
| `DATABASE_URL` | the Neon **direct** URL (§5.1) |
| `DATABASE_POOL_MAX` | `5` |
| `BETTER_AUTH_SECRET` | §4 |
| `BETTER_AUTH_URL` | `https://<api>.onrender.com` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | `https://<admin>.vercel.app,https://<web>.vercel.app` |
| `ADMIN_URL` | `https://<admin>.vercel.app` |
| `CORS_ORIGINS` | `https://<admin>.vercel.app,https://<web>.vercel.app` |
| `POS_JWT_PRIVATE_KEY` | §4 |
| `POS_JWT_KEY_ID` | `pos-v1` |
| `POWERSYNC_URL` | `https://<instance>.powersync.journeyapps.com` |
| `POWERSYNC_AUDIENCE` | the audience you set in PowerSync (§7.3) |
| `JOBS_ENABLED` | `true` |
| `LOG_LEVEL` | `info` |
| `PAYSTACK_MODE` | `mock` |
| `EVAT_PROVIDER` | `mock` |

**The API exits at boot if any of these is missing in production** — `BETTER_AUTH_SECRET`
(32+ chars, not starting `replace-`), `CORS_ORIGINS` (non-empty) and `POS_JWT_PRIVATE_KEY`.
The deploy log names the variable, so read it rather than guessing.

Leave `ADMIN_EMAIL` / `ADMIN_PASSWORD` off Render: they are for the seeding step you already
ran on your laptop.

### 6.3 Deploy and check it

```bash
curl -sS https://<api>.onrender.com/health        # {"status":"ok"} (first call may take ~50 s)
curl -sS https://<api>.onrender.com/ready         # checks the database
curl -sS https://<api>.onrender.com/.well-known/jwks.json | head -c 200
```

The JWKS response must contain the key id `pos-v1`. If it is 404, the API is not the process
you think it is — check the deploy log.

**Prove CORS before you build anything on Vercel.** This is the check that saves you an hour
of "the login button does nothing":

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X OPTIONS \
  -H 'Origin: https://<admin>.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' \
  https://<api>.onrender.com/api/auth/sign-in/email
```

`204` (or `200`) with `access-control-allow-origin: https://<admin>.vercel.app` is what you
want. A bare `403` here is almost always the origin missing from `CORS_ORIGINS` or from
`BETTER_AUTH_TRUSTED_ORIGINS`.

---

## 7. Step 3 — PowerSync Cloud (development instance)

### 7.1 Create the instance

New instance → **development** → region closest to Neon (Frankfurt if offered). Note its
**instance URL**: `https://<instance>.powersync.journeyapps.com`.

### 7.2 Database connection

Database Connection → **Postgres** tab:

| Field | Value |
|---|---|
| Host / Port | from the **direct** Neon URL, `5432` |
| Database | `neondb` |
| Username | `powersync_role` |
| Password | §5.3 |
| SSL mode | `require` |

Do **not** paste the pooled hostname. PowerSync holds a persistent logical replication
connection and a pooler terminates it — the docs are explicit about this, and the failure
looks like "connected, then nothing syncs".

Click **Test Connection** before saving.

### 7.3 Client auth

Point PowerSync at the API's published JWKS and at the audience you put in `POWERSYNC_AUDIENCE`:

| Setting | Value |
|---|---|
| JWKS URI | `https://<api>.onrender.com/.well-known/jwks.json` |
| Audience | `https://<instance>.powersync.journeyapps.com` (or whatever you set in `POWERSYNC_AUDIENCE`) |

Both values must agree. A token minted for audience A and verified for audience B is rejected
with a signature error even though the key is correct.

### 7.4 Upload the sync config

Deploy this repository's `powersync/sync-config.yaml` (edition 3, branch-scoped streams) to
the instance — the dashboard's sync-config editor or the PowerSync CLI. It reads
`auth.parameter('branch_id')` and `auth.parameter('terminal_id')` from the token the API
mints, so nothing in the YAML needs editing for staging.

### 7.5 Verify replication reached Neon

```bash
psql "$NEON_DIRECT" -c "select slot_name, active from pg_replication_slots;"
```

A `powersync_*` slot, `active = t`, means the service is reading. If the slot is absent, the
database connection did not succeed — check the PowerSync instance logs for an SSL or
authentication error before you touch the app.

---

## 8. Step 4 — Vercel (console and public site)

Two **separate projects** from the same repository.

### 8.1 Project settings

| Field | `web` | `admin` |
|---|---|---|
| Root Directory | `web` | `admin` |
| Framework Preset | TanStack Start (auto-detected) | TanStack Start (auto-detected) |
| **Include files outside the root directory** | **ON** | **ON** |
| Install Command | `bun install --frozen-lockfile` | `bun install --frozen-lockfile` |
| Build Command | `bun run build` | `bun run build` |

Both apps have `nitro()` in their Vite config, which is what Vercel's TanStack Start support
needs — no adapter change today. **"Include files outside the root directory" is not optional**:
both projects import `@sceptre/shared` and `@sceptre/brand` from `packages/*`, and without it
the build fails with a module-not-found that sends people hunting for a phantom dependency.

### 8.2 Environment variables

| Project | Variable | Value | When it is read |
|---|---|---|---|
| `web` | `WEB_API_URL` | `https://<api>.onrender.com` | **server-side**, at request time, by `site.functions.ts` |
| `admin` | `VITE_API_URL` | `https://<api>.onrender.com` | **build time** — Vite inlines it |

`admin/src/env.ts` validates `VITE_API_URL` as a URL, so a missing value fails the **build**
rather than producing a console that cannot reach anything. That failure is a feature: set the
variable before the first deploy, not after.

The public site fetches `GET /api/public/site` and renders the branch/contact content from the
database, so if the homepage is empty the cause is almost always `WEB_API_URL` missing (or set
as a `VITE_` variable, which the server function cannot see).

### 8.3 Cross-site auth — the part that costs a day if you let it

The console runs on `*.vercel.app` and calls an API on `*.onrender.com`. That is a genuine
cross-site request, so all four of these must agree:

1. `CORS_ORIGINS` on Render lists `https://<admin>.vercel.app` (§6.2).
2. `BETTER_AUTH_TRUSTED_ORIGINS` lists it too.
3. `BETTER_AUTH_URL` is the **API** origin, not the console's.
4. The session cookie is `SameSite=None; Secure` (HTTPS both sides).

Test in this order:

```bash
# 1. the preflight answers (§6.3)
# 2. sign in, then reload the whole page — the session must survive
# 3. DevTools → Application → Cookies → the API origin: look for SameSite=None; Secure
```

If the console refuses to keep a session and you have spent more than 30 minutes on it: **point
the local console at the deployed API** instead.

```bash
cd admin && VITE_API_URL=https://<api>.onrender.com bun run dev
```

That still proves the deployed API, the Neon database, PowerSync and the whole POS path — which
is the point of the day. Note the `Origin` you are now sending (`http://localhost:3000`) is in
the API's development allowlist only when `NODE_ENV` is not production; on Render it is
production, so add `http://localhost:3000` to `CORS_ORIGINS` and `BETTER_AUTH_TRUSTED_ORIGINS`
for the test, then remove it.

---

## 9. Step 5 — The till

The POS talks to two URLs and nothing else. Put them in `config.json` in the app's user-data
directory:

| OS | Path |
|---|---|
| Linux | `~/.config/Sceptre Drive POS/config.json` |
| macOS | `~/Library/Application Support/Sceptre Drive POS/config.json` |
| Windows | `%APPDATA%\Sceptre Drive POS\config.json` |

```json
{
  "apiBaseUrl": "https://<api>.onrender.com",
  "powersyncUrl": "https://<instance>.powersync.journeyapps.com"
}
```

No rebuild is needed: the renderer's CSP already permits `https://*.powersync.journeyapps.com`
and the configured API origin. A **packaged** build refuses `localhost` unless
`SCEPTRE_ALLOW_LOCAL_API=1`, which is exactly why the staging URLs must be real HTTPS hosts.

Then, because the staging database is **new**:

1. In the console, create the branch (if the seed did not), a terminal, and enrol it → note the
   enrolment code.
2. On the till: sign out / reset local data → **Enrol** with the code → set a staff PIN.
   The old development device token means nothing to this database.
3. Open a shift.

> A fresh database has `pricing.vatRegistered` unset (defaults to **true**) and
> `pos.outOfStockPolicy` unset (defaults to **BLOCK**). Both are fine for a test — the demo
> catalogue is standard-rated and has stock, so sales will tax normally and out-of-stock items
> will ask for a manager PIN.

---

## 10. Prove it (goal-backward, in this order)

| # | Check | How | Pass looks like |
|---|---|---|---|
| 1 | API up | `curl .../health` | `200`, `{"status":"ok"}` |
| 2 | API↔DB | `curl .../ready` | `200` |
| 3 | Signing key published | `curl .../.well-known/jwks.json` | a key with `kid: pos-v1` |
| 4 | CORS | the `OPTIONS` curl in §6.3 | `204` + `access-control-allow-origin` |
| 5 | Sync reading | `pg_replication_slots` (§7.5) | `powersync_*`, `active = t` |
| 6 | Console session | sign in, hard-reload | still signed in |
| 7 | Catalogue down | open the till | products appear (PowerSync download) |
| 8 | Offline sale | unplug the network, complete a cash sale, replug | receipt printed; no error |
| 9 | Upload | wait for the sync badge to settle | sale appears in the console |
| 10 | Database truth | `psql "$NEON_DIRECT" -c "select count(*) from sale;"` | the sale is there, exactly once |
| 11 | Stock moved | inventory → the sold product | quantity down by the sold amount |
| 12 | Public site | open `https://<web>.vercel.app` | content from `/api/public/site`, not a blank shell |

Step 10 is the one that matters: if the till says "synced" and Neon says `0`, the upload never
happened and the outbox is holding it — check the POS sync screen before anything else.

---

## 11. Troubleshooting, by symptom

| Symptom | Likely cause | Fix |
|---|---|---|
| Render: 502 on every request | the app listens on `API_PORT`, Render routes to `PORT` | set both to `10000` |
| Render: process exits at boot | the log names the variable | fix that variable; production demands a 32+ `BETTER_AUTH_SECRET`, non-empty `CORS_ORIGINS`, `POS_JWT_PRIVATE_KEY` |
| Render: `Cannot find module '@sceptre/…'` | Root Directory is `api` instead of the repo root | set Root Directory `.` and rebuild |
| Render: syntax error on `.ts` import | Node 22 | `NODE_VERSION=24` |
| Render: first request takes ~50 s | free tier asleep | expected; wake it with `/health` before testing |
| Neon: "too many connections" | direct URL with a pool per cold start | use the pooled URL for the API (never for PowerSync/migrations) or lower `DATABASE_POOL_MAX` |
| PowerSync: connection fails with a certificate error | SSL not `require`, or a self-signed chain | set SSL `require`, use the download-certificate option |
| PowerSync connected, till receives nothing | audience or JWKS mismatch | `POWERSYNC_AUDIENCE` must equal the instance audience; JWKS must serve `kid: pos-v1` |
| PowerSync active, no rows for the branch | the token's `branch_id` is not the seeded branch | create the terminal under the seeded branch |
| Console: `MISSING_OR_NULL_ORIGIN` on sign-in | origin not trusted | add the Vercel origin to `BETTER_AUTH_TRUSTED_ORIGINS` |
| Console: preflight 403 | origin not in `CORS_ORIGINS` | add it; redeploy |
| Console: login works, reload logs out | cross-site cookie | `SameSite=None; Secure`, `BETTER_AUTH_URL` = API origin; fallback in §8.3 |
| Admin build fails: invalid environment | `VITE_API_URL` missing | add it to the Vercel project (Production **and** Preview) |
| Public site renders an empty shell | `WEB_API_URL` missing or set as `VITE_` | set the server-side variable, redeploy |
| POS: "request timed out" on upload | Render cold start | retry; the outbox keeps the sale |
| POS: cannot reach the API | `config.json` wrong, or a packaged build with a localhost URL | fix the file; never localhost in a packaged build |

---

## 12. Takedown tonight — in this order

1. **Vercel**: delete both projects (this also removes their deployments).
2. **PowerSync Cloud**: delete the instance. If you cannot, drop the leftover slot so Neon can
   clean its WAL:
   ```sql
   select slot_name, pg_drop_replication_slot(slot_name)
   from pg_replication_slots where active = false;
   ```
3. **Render**: suspend, then delete the service.
4. **Neon**: delete the project. This removes the database, the role and every setting.
5. **Local**: delete `~/sceptre-staging.env` and the staging `config.json` from
   `~/.config/Sceptre Drive POS/`, then re-enrol the till against your development API.
6. **Rotate** anything you pasted into a chat or a ticket: `BETTER_AUTH_SECRET` and
   `POS_JWT_PRIVATE_KEY` are cheap to regenerate and worthless once leaked.

---

## 13. What this stack does not prove (do not mistake it for launch readiness)

- **Caddy, TLS termination, Docker, the VPS, R2 backups and the restore drill** — none of these
  exist in this topology.
- **Paystack live**: `PAYSTACK_MODE=mock`, no webhook secret, no settlement.
- **GRA E-VAT**: `EVAT_PROVIDER=mock`; the real client is unimplemented until onboarding.
- **A signed Windows installer** and a packaged counter audit (`test:counter`).
- **Load**: one till, one operator, no concurrency.

Carry those into Phase 15. This run is about proving the deployed **application**, and it can
do that in an afternoon.

---

## Appendix A — Every variable, and who holds it

| Variable | Service | Secret | Example |
|---|---|---|---|
| `DATABASE_URL` | Render | yes | `postgresql://neondb_owner:…@ep-…neon.tech/neondb?sslmode=require` |
| `DATABASE_POOL_MAX` | Render | no | `5` |
| `NODE_ENV` | Render | no | `production` |
| `NODE_VERSION` | Render | no | `24` |
| `API_PORT` / `PORT` | Render | no | `10000` |
| `BETTER_AUTH_SECRET` | Render | **yes** | 48 random bytes, base64 |
| `BETTER_AUTH_URL` | Render | no | `https://<api>.onrender.com` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Render | no | `https://<admin>.vercel.app,https://<web>.vercel.app` |
| `ADMIN_URL` | Render | no | `https://<admin>.vercel.app` |
| `CORS_ORIGINS` | Render | no | same two origins |
| `POS_JWT_PRIVATE_KEY` | Render | **yes** | base64url PKCS8 Ed25519 |
| `POS_JWT_KEY_ID` | Render | no | `pos-v1` |
| `POWERSYNC_URL` | Render + POS config | no | `https://<instance>.powersync.journeyapps.com` |
| `POWERSYNC_AUDIENCE` | Render + PowerSync | no | the instance audience |
| `JOBS_ENABLED` | Render | no | `true` |
| `PAYSTACK_MODE` | Render | no | `mock` |
| `EVAT_PROVIDER` | Render | no | `mock` |
| `WEB_API_URL` | Vercel (`web`) | no | `https://<api>.onrender.com` |
| `VITE_API_URL` | Vercel (`admin`) | no | `https://<api>.onrender.com` |
| `powersync_role` password | PowerSync | **yes** | set in §5.3 |

## Appendix B — Command sheet

```bash
# migrate + seed against Neon
DATABASE_URL="$NEON_DIRECT" bun run db:migrate
DATABASE_URL="$NEON_DIRECT" bun run seed:admin

# check the deployed API
curl -sS https://<api>.onrender.com/health
curl -sS https://<api>.onrender.com/ready
curl -sS https://<api>.onrender.com/.well-known/jwks.json | head -c 200

# confirm PowerSync is reading
psql "$NEON_DIRECT" -c "select slot_name, active from pg_replication_slots;"

# confirm the sale landed, exactly once
psql "$NEON_DIRECT" -c "select receipt_number, total_minor, occurred_at from sale order by occurred_at desc limit 5;"
```
