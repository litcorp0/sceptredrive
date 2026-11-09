# PowerSync

Development and CI run the **official self-hosted PowerSync Service** in Docker.
Staging and production use **PowerSync Cloud** with the same `sync-config.yaml`; only the
endpoint, the JWT audience, and the deploy command change.

```
powersync/
├── sync-config.yaml   # what each terminal receives (edition 3 / Sync Streams)
├── service.yaml       # service config: replication, storage, client_auth, health
├── init/powersync.sql # roles, bucket-storage database, publication (idempotent)
└── .generated/        # `bun run sync:up` output (gitignored)
```

## Bring-up order

```bash
bun run db:up                     # Docker Postgres (host port from POSTGRES_PORT, default 5433)
DATABASE_URL=postgresql://sceptre_drive:sceptre_drive@localhost:5433/sceptre_drive bun run db:migrate
DATABASE_URL=postgresql://sceptre_drive:sceptre_drive@localhost:5433/sceptre_drive bun run db:seed -- --demo
bun run sync:init                 # roles + storage DB + publication (first time, idempotent)
DATABASE_URL=postgresql://sceptre_drive:sceptre_drive@localhost:5433/sceptre_drive bun run dev:api
bun run sync:up                   # starts the service on :8080
bun run sync:logs                 # wait for "Activated new replication stream"
```

If port 5433 is already taken on the machine, set `POSTGRES_PORT` in `.env` (the compose
file and `db:test:prepare` both honour it) and use the same port in `DATABASE_URL`.

## Environment

| Variable | Used by | Notes |
|---|---|---|
| `POSTGRES_PORT` | compose | Host port for the Docker Postgres |
| `PS_DATA_SOURCE_URI` | service | Replication connection (role `powersync_role`) |
| `PS_STORAGE_URI` | service | Bucket storage (`sceptre_drive_powersync`, role `powersync_storage`) |
| `PS_JWKS_URI` | service | Where the service fetches our public key |
| `PS_ADMIN_TOKEN` | service / CLI | Admin API bearer token (development only) |
| `POWERSYNC_URL` | API | Instance URL returned to clients; unset ⇒ token endpoint answers 503 |
| `POWERSYNC_AUDIENCE` | API | Must match `client_auth.audience` |

All `PS_*` values are substituted into `service.yaml` with the `!env` tag (only `PS_`
prefixed variables are allowed, with `::number` / `::boolean` casts).

## What syncs

`sync-config.yaml` streams the catalogue, barcodes, brands, branch prices, branch stock,
customers, branch credit profiles, loyalty accounts and live loyalty lots. The
`branch_id` filter comes from the **signed JWT claim** (`auth.parameter('branch_id')`), so
a terminal cannot widen its own scope.

Never synced: staff (PIN hashes), settings, sales, credit/loyalty ledgers, suppliers,
payables, audit.

Adding a synced table takes two steps — the stream in `sync-config.yaml` **and** the
publication:

```sql
ALTER PUBLICATION powersync ADD TABLE <table>;
```

## JWKS and the generated service config

The API publishes `/.well-known/jwks.json`. In staging/production the service fetches it
over HTTPS (`client_auth.jwks_uri`), so key rotation needs no redeploy.

Locally the container may not be allowed to reach a process on the host (a restrictive
firewall drops container→host traffic), so `bun run sync:up` first runs
`scripts/prepare-powersync-service.mjs`, which reads the API's current JWKS and writes
`powersync/.generated/service.yaml` with the public key **inlined**. If the API is not
running, it falls back to the committed `service.yaml` and warns.

Give `.env` a stable `POS_JWT_PRIVATE_KEY` (`bun run --filter api keys:generate`) in
development. With the ephemeral dev key the JWT changes on every API restart, which
invalidates both the terminals' stored JWTs and the generated service config.

## Health and diagnostics

```bash
curl -s http://localhost:8080/probes/liveness          # 200 when alive
curl -s http://localhost:8080/probes/startup           # 200 once startup finished
docker compose logs --since 60s powersync | grep -iE "error|replicating"
bun run sync:config-check                              # our config contract (44 checks)
```

`POST /sync/stream` is the client endpoint: a malformed token returns `401 PSYNC_S2101`.
That is the quickest way to tell "our JWT is wrong" from "the stream parameters are wrong".

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `postgres does not support ssl` | `sslmode` must be a **separate YAML key**, not a URI parameter |
| `TransformError: api > tokens > type must be string` | the generated config lost its `!env` tags — re-run `bun run sync:up` |
| `Cannot find publication` / no data | `bun run sync:init` was not run, or the table is missing from the publication |
| Replication never starts | `wal_level` must be `logical`; changing it requires recreating the Postgres container |
| Client gets 401 from the service | audience mismatch (API `POWERSYNC_AUDIENCE` vs `client_auth.audience`) or a stale inline key |
| Container cannot reach the API | expected on some hosts — the generated config inlines the key instead |

## Cloud (staging / production, Phase 9)

1. Create one Cloud instance per environment and connect it to that environment's
   Postgres.
2. Set `client_auth.jwks_uri` to the public API URL and the audience to the Cloud instance
   URL; keep using `POS_JWT_PRIVATE_KEY` in the API.
3. Deploy `sync-config.yaml` (`powersync deploy sync-config` or the dashboard).
4. Point the POS at the Cloud instance with `POWERSYNC_URL` — the client contract does not
   change.

`service.yaml` and `init/powersync.sql` are development-only artefacts.
