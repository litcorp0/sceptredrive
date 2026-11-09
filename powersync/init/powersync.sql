-- PowerSync development bootstrap. Idempotent: safe to re-run.
--
-- Run with:  bun run sync:init
--            (docker compose exec -T postgres psql -U sceptre_drive -d sceptre_drive)
--
-- Creates:
--   1. `powersync_role`        — logical-replication reader on the source DB
--   2. `sceptre_drive_powersync`    — bucket storage database (Postgres storage)
--   3. the `powersync` publication scoped to the synced tables only
--
-- Passwords here are development-only. Staging and production use PowerSync
-- Cloud, so these roles never exist outside the local Docker stack.

\set ON_ERROR_STOP on

-- 1. Replication role -------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role') THEN
    CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD 'powersync_role';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE sceptre_drive TO powersync_role;
GRANT USAGE ON SCHEMA public TO powersync_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;

-- 2. Bucket storage database ------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_storage') THEN
    CREATE ROLE powersync_storage WITH LOGIN PASSWORD 'powersync_storage';
  END IF;
END
$$;

SELECT 'CREATE DATABASE sceptre_drive_powersync OWNER powersync_storage'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'sceptre_drive_powersync')
\gexec

GRANT CREATE ON DATABASE sceptre_drive_powersync TO powersync_storage;

-- 3. Publication ------------------------------------------------------------
-- Scoped to the synced tables: ledger, staff, audit, and payable tables are
-- never replicated. Adding a synced table requires:
--   ALTER PUBLICATION powersync ADD TABLE <table>;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    EXECUTE $publication$
      CREATE PUBLICATION powersync FOR TABLE
        product,
        barcode,
        brand,
        product_price,
        stock_level,
        customer,
        credit_profile,
        loyalty_account,
        loyalty_lot
    $publication$;
  END IF;
END
$$;

-- Existing development databases predate the brand stream: add it once.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'powersync' AND tablename = 'brand'
  ) THEN
    ALTER PUBLICATION powersync ADD TABLE brand;
  END IF;
END
$$;

SELECT pubname, puballtables, pubinsert, pubupdate, pubdelete
FROM pg_publication
WHERE pubname = 'powersync';
