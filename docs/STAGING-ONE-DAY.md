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
| 3b | Paystack test mode: keys, webhook, smoke test (§6.4) | 10 min | step 3 |
| 4 | PowerSync Cloud: instance, DB connection, JWKS, sync config | 15 min | steps 1 + 3 (needs the JWKS URL) |
| 5 | Vercel: two projects, env, deploy | 20 min | step 3 |
| 6 | Console login across origins | 10 min *or an hour* | steps 3 + 5 |
| 7 | POS: config, enrol, one offline sale (§9.1 for Windows) | 15 min | steps 3 + 4 |
| 8 | Prove the fourteen checks (§10) | 15 min | everything |
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
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD 'SceptreDrive0808@gmail.com';
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
| `CORS_ORIGINS` | `https://<admin>.vercel.app,https://<web>.vercel.app,app://sceptre-drive` |
| `POS_JWT_PRIVATE_KEY` | §4 |
| `POS_JWT_KEY_ID` | `pos-v1` |
| `POWERSYNC_URL` | `https://<instance>.powersync.journeyapps.com` |
| `POWERSYNC_AUDIENCE` | the audience you set in PowerSync (§7.3) |
| `JOBS_ENABLED` | `true` |
| `LOG_LEVEL` | `info` |
| `PAYSTACK_MODE` | `test` (staging only; production uses `live`) |
| `PAYSTACK_SECRET_KEY` | `sk_test_…` from the Paystack dashboard |
| `PAYSTACK_WEBHOOK_SECRET` | empty — Paystack signs with the secret key |
| `PAYSTACK_BASE_URL` | `https://api.paystack.co` |
| `PAYSTACK_EMAIL_DOMAIN` | a domain you own, e.g. `sceptre-drive.com` |
| `EVAT_PROVIDER` | `mock` |

`app://sceptre-drive` is the **packaged till's** origin. In development the API adds it (and
localhost) automatically, but in production `CORS_ORIGINS` is the whole list — leave it out and
every POS request fails the preflight with a generic network error while the console works
perfectly. It is not a browser website, so it is easy to forget.

`https://<admin>.vercel.app` stays in both lists even though the console reaches the API through
its own `/api` proxy (§8.3): the proxied request still carries `Origin: https://<admin>.vercel.app`,
and Better Auth checks it against `BETTER_AUTH_TRUSTED_ORIGINS`.

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

### 6.4 Paystack test mode (optional, recommended)

Staging must use **test keys**. The API refuses an `sk_live_` key when `PAYSTACK_MODE=test`
and refuses an `sk_test_` key when `PAYSTACK_MODE=live`, so a wrong pair fails at boot instead
of charging a real card.

1. Paystack dashboard → switch to **Test mode** → **Developers → API Keys & Webhooks** →
   copy the test secret key (`sk_test_…`).
2. Set the **test webhook URL** to `https://<api>.onrender.com/api/payments/webhook/paystack`.
3. Leave **Callback URL** at the default for the POS (the till polls and closes the checkout
   window); set a page on your own domain only if you add a web checkout.
4. Enable **Card**, **Mobile Money** (MTN/Telecel/AT) and **Bank Transfer** for GHS.
5. Set the Render env rows in §6.2 and redeploy.
6. From the repo root, with the staging env loaded:

```bash
bun run paystack:smoke            # GET /balance + initialize + verify, no secret printed
bun run paystack:smoke -- --momo  # also a test MoMo charge to 0551234987
```

The full dashboard checklist, test cards, MoMo number, transfer/OTP notes and live checklist
are in `docs/PAYSTACK-STAGING.md`. Do not put live keys in this disposable environment.

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

**Two required variables, both public, neither a secret.**

| Project | Variable | Value | Required? | When it is read |
|---|---|---|---|---|
| `web` | `WEB_API_URL` | `https://<api>.onrender.com` | **required** | **server-side**, at request time, by `site.functions.ts` |
| `admin` | `VITE_API_URL` | `https://<admin>.vercel.app` — the console's **own** origin | **required** | **build time** — Vite inlines it into the bundle |
| `admin` | `API_URL` | `https://<api>.onrender.com` | **required** in a deployment | **server-side** — the `/api/*` proxy target and the guards' API origin |
| `web` | `VITE_SITE_URL` | `https://<web>.vercel.app` | optional | **build time** — canonical links, `robots.txt`, JSON-LD |
| `admin` | `VITE_APP_TITLE` | `Sceptre Drive` | optional | build time — page title fallback |

Only these. Neither project touches the database, Paystack, the POS JWT key, or Better Auth
secrets — both reach the API over HTTPS, and the API holds every secret. **Do not copy the
Render environment into Vercel**; the private key must not exist on a public host. A `BETTER_AUTH_SECRET`
or `POS_JWT_PRIVATE_KEY` in a Vercel project is a leak with no benefit.

`WEB_API_URL` is read on the server at request time, so it works whether or not Vercel rebuilds;
`VITE_*` values are inlined, so changing one needs a **redeploy**, not just a variable edit.

`admin/src/env.ts` validates `VITE_API_URL` as a URL, so a missing value fails the **build**
rather than producing a console that cannot reach anything. That failure is a feature: set the
variable before the first deploy, not after.

If `VITE_SITE_URL` is left unset, `siteUrl()` falls back to `http://localhost:3004`, so the
sitemap, `robots.txt` and the JSON-LD `@id` point at a host nobody can reach. The site still
renders; only the SEO surface is wrong, which is why it is optional for a one-day test.

The public site fetches `GET /api/public/site` and renders the branch/contact content from the
database, so if the homepage is empty the cause is almost always `WEB_API_URL` missing (or set
as a `VITE_` variable, which the server function cannot see).

### 8.3 The console's session cookie — why the API sits behind `/api`

The console does not trust the browser for authentication. `session.functions.ts`
reads the session **on the server**, by forwarding the browser's `Cookie` header to the
API, and the route guards (`routes/login.tsx`, `routes/_authenticated/route.tsx`) act on
that answer.

That means the only cookie the console can ever see is the one the browser sent **to the
console**. A host-only cookie set by `api.onrender.com` is never sent to
`admin.vercel.app`, so a cross-origin console signs in, receives a token, and then every
guard still sees an anonymous visitor — you are bounced back to `/login` with a valid
session sitting in the API's own cookie jar. `SameSite=None` does not help: it only lets
the *browser* attach a cross-site cookie, and a cookie scoped to the API host is still
never sent to the console host.

So the console serves `/api/*` itself:

| Who | Talks to | Why |
|---|---|---|
| Browser (`authClient`, `apiRequest`) | `VITE_API_URL` = the console's own origin | one origin, so the cookie is first-party |
| Console server (`getSession`) | `API_URL` = the API's origin | no self-call through its own public host |
| Console server's `/api/*` route rule | `API_URL` | proxies whatever the browser sends |

Set on the `admin` Vercel project, then **redeploy** (both are read at build time):

```
VITE_API_URL = https://<admin>.vercel.app
API_URL      = https://<api>.onrender.com
```

`API_URL` is deliberately *not* a `VITE_` name: it is server-only and must never enter the
browser bundle.

Verify in this order:

1. Open `https://<admin>.vercel.app/api/auth/get-session` in the browser. It must answer
   `null` (JSON), not 404 or a CORS error — that proves the proxy exists.
2. Sign in.
3. DevTools → Application → Cookies → **the console's origin**: `better-auth.session_token`
   must be there. Not on the API's origin — the browser never talks to that host directly.
4. Reload the whole page. The console must stay signed in.

On the VPS the same rule applies, and Caddy does the proxying instead of Nitro. Note it is
`handle`, not `handle_path`: the API expects the `/api` prefix, so it must not be stripped.

```caddyfile
console.example.com {
	handle /api/* {
		reverse_proxy api:4000
	}
	handle {
		reverse_proxy admin:3000
	}
}
```

with `VITE_API_URL=https://console.example.com` and `API_URL=http://api:4000`. Here Caddy
answers `/api/*` before it ever reaches the console process, so the Nitro route rule is unused
and `API_URL` exists only to spare `getSession` a call through the public host.

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

### 9.1 Writing `config.json` on Windows

Windows hides file extensions, and PowerShell's `Set-Content -Encoding utf8` writes a BOM; either
one produces a `config.json` the app refuses to read. Write it in PowerShell rather than Notepad:

1. Start the app once, then quit it. That creates the folder.
2. `Win+R` → `%APPDATA%\Sceptre Drive POS` → Enter. That is
   `C:\Users\<you>\AppData\Roaming\Sceptre Drive POS`.
3. Paste this into **Windows PowerShell** with the two staging URLs. `New-Item -Force` makes the
   folder even if the app has not run yet, and `WriteAllText` writes UTF-8 without a BOM:

```powershell
$dir = Join-Path $env:APPDATA 'Sceptre Drive POS'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$json = @'
{
  "apiBaseUrl": "https://<api>.onrender.com",
  "powersyncUrl": "https://<instance>.powersync.journeyapps.com"
}
'@

[System.IO.File]::WriteAllText((Join-Path $dir 'config.json'), $json)
```

4. Check it parses — silence means valid:

```powershell
Get-Content "$env:APPDATA\Sceptre Drive POS\config.json" -Raw | ConvertFrom-Json
```

5. Start the app. It should reach sign-in and ask for an enrolment code.

Two failure modes to recognise, because neither says "check your config":

- **No file at all** falls back to `https://api.gikautos.com` and `https://powersync.gikautos.com`
  (`defaultRuntimeConfig`), which do not exist yet, so the till simply fails to connect.
- **An unreadable file** (`config.json.txt`, a BOM, a missing key) fails closed with
  `app.exit(1)`: the window closes as it opens, and `CONFIG_INVALID` is printed to the console.

Both keys are required and each must be a full `http(s)` URL; only their origins feed the CSP.
The file is read once at startup, so a later edit needs a full quit and restart, not just closing
the window. The diagnostics screen shows **User data** — the live `app.getPath('userData')` — which
confirms the folder the app actually reads.

### 9.2 Building the till — Linux and Windows

The POS is **not part of the deployed stack**: it is a desktop binary. Render, Vercel,
Neon and PowerSync host the server side; the till is built locally (or in CI) and installed on
the machine. "Staging" for it means one file: `config.json` above.

**Linux — build here**

```bash
bun run make:pos
```

Output (MakerZIP, since the Forge config only makes a Squirrel installer for Windows):

```
desktop/out/make/zip/linux/x64/Sceptre Drive POS-linux-x64-<version>.zip
```

Unzip it anywhere and run the binary inside.

> `make:pos` needs the **`zip` binary**, which some Linux installs lack. Without it the run
> packages the app and then fails with `spawn zip ENOENT`. Install it once:
> `sudo apt install zip` (or `sudo dnf install zip`).

For a faster loop, `bun run package:pos` skips the archive entirely and leaves a runnable
directory at `desktop/out/Sceptre Drive POS-linux-x64/`:

```bash
"desktop/out/Sceptre Drive POS-linux-x64/SceptreDrivePOS"
```


**Windows — build on Windows, not from Linux**

Squirrel installers require a Windows host; Wine is not supported for this maker. The
repository already contains the job for it (`.github/workflows/desktop.yml`):

1. Push the branch, then GitHub → **Actions → Desktop → Run workflow** (`workflow_dispatch`).
2. It lints, typechecks, runs the desktop unit tests, then
   `bun run make:pos -- --platform win32 --arch x64`.
3. Download the **`sceptre-pos-windows-installer`** artifact: `Sceptre Drive POS-<version> Setup.exe`,
   the `.nupkg` and `RELEASES`.

With no signing certificate the installer is **unsigned** — Windows SmartScreen will warn;
"More info → Run anyway" is expected for a test. Signing is Phase 15.

If the repository is not on GitHub yet, the same command on any Windows machine with Bun and
Node installed produces the installer:

```powershell
bun install --frozen-lockfile
bun run make:pos
```

**On each machine, before the first launch**, write `config.json` into the user-data directory
(`~/.config/Sceptre Drive POS/` on Linux, `%APPDATA%\Sceptre Drive POS\` on Windows; the Windows
walkthrough is §9.1) — a **packaged** build refuses `localhost` unless
`SCEPTRE_ALLOW_LOCAL_API=1`, so a wrong URL fails loudly rather than quietly selling to a
development API.

**Two installs mean two devices.** Each machine enrols separately (console → terminal →
enrolment code), and a device token belongs to one machine. That is the check worth doing:
enrol Linux, enrol Windows, sell offline on each, and watch both sales land in Neon.

> The packaged build is also where CSP and keychain behaviour differ from the dev server. If a
> sale prints, uploads and survives a restart on both OSes, the till is verified; a `bun run dev`
> window is not the same test.

### 9.3 Publishing the Windows installer as a GitHub Release

Windows only: the till fleet is Windows, and every extra artefact is another thing to keep
working. Two workflows handle it.

| Workflow | Runs when | Produces |
|---|---|---|
| **Desktop (Windows build)** | every push to `dev` touching `desktop/**`, `packages/**`, `scripts/release-assets.sh`, `bun.lock` (or manual) | an installer attached to the **Actions run** as `pos-windows-<sha>`, 14-day retention, **no release** — plus a dry run of the release flatten/checksum step |
| **Release** | manual with a tag (**preferred**), or a tag matching `v*` | the installer on the **Releases** page, plus `SHA256SUMS.txt` and install notes |
| **CI** (pre-existing) | every push to `dev`/`staging` and every PR | lint, typecheck, tests, build |
| **Desktop** (pre-existing) | manual | the full gates: lint, types, unit, e2e, spike, schema, print, outbox |

So: **ordinary pushes do not create releases.** They produce a downloadable installer, which is
the thing you want while iterating — "does my change still build and install on Windows?" A
release is a deliberate act, because it carries a version number people keep.

**Cut a release (preferred):**

1. Merge to `dev`.
2. Actions → **Release** → **Run workflow**, branch `dev`, version `0.2.0`.

Nothing is bumped by hand. The run stamps that version into `desktop/package.json` before
Forge builds, so the installer is named `Sceptre Drive POS-0.2.0 Setup.exe`, then creates the
tag `v0.2.0` as its last step, pinned to the commit it built. The committed file keeps its old
number — the tag is the record of what shipped — so instead the run refuses any version lower
than the newest published tag. A failed run leaves no tag: fix, push, re-dispatch.

**Or push a tag by hand** — the version comes from the tag, with the same stamping, but with
one catch: a tag resolves the workflow file *at the tagged commit*, so a fix sitting on `dev`
does not apply to a tag cut before it.

```bash
git tag v0.2.0
git push origin v0.2.0
```

**Take a dev build:** Actions → **Desktop (Windows build)** → the run for your commit →
Artifacts → `pos-windows-<sha>`.

> **If the publish step fails with 403:** the repository must allow the workflow token to
> write. Settings → Actions → General → Workflow permissions → **Read and write**, then re-run.
> The workflow already asks for `contents: write`; the repository setting can still refuse it.

**Deliberately absent:** signing (Phase 15 needs the certificate) and auto-update (there is no
feed; a new version means a new download). Re-running the same tag re-uploads the assets in
place rather than failing.

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
| 13 | Paystack credential | `bun run paystack:smoke` | `PASS balance`, `PASS initialize`, `PASS verify` |
| 14 | Card + webhook | a card tender with `4084 0840 8408 4081` | payment `PAID`; dashboard Webhook Events shows `200` |

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
| POS: every API call fails with a network error, console is fine | `app://sceptre-drive` missing from `CORS_ORIGINS` (production does not add dev origins) | add it, redeploy, relaunch the till |
| Console: sign-in returns JSON / token but you land back on `/login` | the API cookie is host-only for the API host, so the console's server-side guard never sees it | set `VITE_API_URL` to the console's own origin and `API_URL` to the API, then redeploy — §8.3 |
| Admin build fails: invalid environment | `VITE_API_URL` missing | add it to the Vercel project (Production **and** Preview), then redeploy |
| Homepage renders but empty | `WEB_API_URL` missing, or set as `VITE_API_URL` (server function cannot see a `VITE_` name) | set `WEB_API_URL`, redeploy |
| Sitemap/robots point at `localhost:3004` | `VITE_SITE_URL` unset | set it, redeploy |
| Public site renders an empty shell | `WEB_API_URL` missing or set as `VITE_` | set the server-side variable, redeploy |
| POS: "request timed out" on upload | Render cold start | retry; the outbox keeps the sale |
| POS: cannot reach the API | `config.json` wrong, or a packaged build with a localhost URL | fix the file; never localhost in a packaged build |
| Paystack: `Invalid key` | `PAYSTACK_MODE` and key prefix disagree | `sk_test_` with `test`, `sk_live_` with `live` in production |
| Paystack: webhook `401` | `PAYSTACK_WEBHOOK_SECRET` is not the secret key | leave it empty or copy the same secret key |
| Paystack: card window opens but stays blank | callback URL points at your domain, which the Electron window blocks | use the default callback for the POS; the poll settles the payment |
| Paystack: MoMo stays `pay_offline` | the customer did not approve within 180s | expected; start a new charge |
| Paystack: payment pending after checkout | webhook late or signature rejected | check Webhook Events; the till's `verify` poll may settle first |

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
- **Paystack live**: the one-day stack uses test keys and no settlement. Test mode does not
  prove business activation, settlement, real recipient banks or live transfer limits; the
  live checklist is `docs/PAYSTACK-STAGING.md` §8.
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
| `CORS_ORIGINS` | Render | no | the two Vercel origins **plus `app://sceptre-drive`** |
| `POS_JWT_PRIVATE_KEY` | Render | **yes** | base64url PKCS8 Ed25519 |
| `POS_JWT_KEY_ID` | Render | no | `pos-v1` |
| `POWERSYNC_URL` | Render + POS config | no | `https://<instance>.powersync.journeyapps.com` |
| `POWERSYNC_AUDIENCE` | Render + PowerSync | no | the instance audience |
| `JOBS_ENABLED` | Render | no | `true` |
| `PAYSTACK_MODE` | Render | no | `test` (staging) / `live` (production) |
| `PAYSTACK_SECRET_KEY` | Render | **yes** | `sk_test_…` / `sk_live_…` |
| `PAYSTACK_WEBHOOK_SECRET` | Render | **yes** if set | empty, or exactly the secret key |
| `PAYSTACK_EMAIL_DOMAIN` | Render | no | a domain the business owns |
| `EVAT_PROVIDER` | Render | no | `mock` |
| `WEB_API_URL` | Vercel (`web`) | no | `https://<api>.onrender.com` |
| `VITE_API_URL` | Vercel (`admin`) | no | `https://<api>.onrender.com` |
| `VITE_SITE_URL` | Vercel (`web`) | yes for correct SEO | `https://<web>.vercel.app` |
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
