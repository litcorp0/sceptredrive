#!/usr/bin/env bash
#
# Phase 13 — the whole gate matrix, in one transcript.
#
#   bash .planning/phases/13-pos-payments-returns/evidence/run-suites.sh
#
# Writes `suites.txt` beside this script. Every suite runs even after a failure, so one
# transcript names every red gate rather than stopping at the first. Requires the Docker
# Postgres (`docker compose up -d`) with `sceptre_drive_test` prepared, and a built desktop
# (`.vite` + `out/`) for the two Electron gates.
#
# The first step is not a suite: it applies every migration to a **scratch** database created
# empty for the purpose, so `0013_enum_phase13.sql` is proved to apply before the DDL that uses
# its values. Plan 13 §1 asks for this against the dev database (`docker compose down -v`);
# this script does it against a throwaway database instead, because the dev database and the
# API/PowerSync stack were live for the walkthrough. The ordering proved is identical.
set -uo pipefail

cd "$(dirname "$0")/../../../.." || exit 1
OUT=".planning/phases/13-pos-payments-returns/evidence/suites.txt"
: > "$OUT"

run() {
  local label="$1"
  shift
  echo "" >> "$OUT"
  echo "### $label" >> "$OUT"
  echo "\$ $*" >> "$OUT"
  "$@" >> "$OUT" 2>&1
  local status=$?
  echo "[exit $status]" >> "$OUT"
  return $status
}

FAILED=0

# --- migrations from zero, on a database that has never held a table -------------------------
echo "### migrations from zero (scratch database)" >> "$OUT"
SCRATCH="sceptre_drive_phase13_migrate_check"
echo "\$ dropdb/createdb $SCRATCH && DATABASE_URL=.../$SCRATCH bun run --filter api db:migrate" >> "$OUT"
PORT="$(docker compose port postgres 5432 2>/dev/null | cut -d: -f2)"
docker compose exec -T postgres dropdb -U sceptre_drive --if-exists "$SCRATCH" >> "$OUT" 2>&1
docker compose exec -T postgres createdb -U sceptre_drive "$SCRATCH" >> "$OUT" 2>&1
DATABASE_URL="postgresql://sceptre_drive:sceptre_drive@localhost:${PORT}/${SCRATCH}" \
  bun run --filter api db:migrate >> "$OUT" 2>&1
MIGRATE_STATUS=$?
echo "[exit $MIGRATE_STATUS]" >> "$OUT"
if [ "$MIGRATE_STATUS" -ne 0 ]; then
  FAILED=1
else
  echo "\$ psql -c 'select count(*) from drizzle.__drizzle_migrations'" >> "$OUT"
  docker compose exec -T postgres psql -U sceptre_drive -d "$SCRATCH" -Atc \
    "select (select count(*) from drizzle.__drizzle_migrations) || ' migrations applied; ' || (select string_agg(typname, ',' order by typname) from pg_type where typname in ('payment_status','refund_restock','cart_void_reason','refund_reason','payment_method','payment_provider')) || ' created'" \
    >> "$OUT" 2>&1
  echo "[exit $?]" >> "$OUT"
fi
docker compose exec -T postgres dropdb -U sceptre_drive --if-exists "$SCRATCH" >> "$OUT" 2>&1

# --- the gate matrix ------------------------------------------------------------------------
run "check-types (all workspaces)" bun run check-types || FAILED=1
run "lint (biome check .)" bun run lint || FAILED=1
run "shared tests" bun run --filter @sceptre/shared test || FAILED=1
run "api tests" bun run --filter api test || FAILED=1
run "desktop tests" bun run --filter desktop test || FAILED=1
run "admin check-types" bun run --filter admin check-types || FAILED=1
run "admin build" bun run --filter admin build || FAILED=1
run "module gates (strict: admin + POS)" bun run modules:check:strict || FAILED=1
run "brand gate" bun run brand:check || FAILED=1
run "token gate" bun run tokens:check || FAILED=1
# One Electron suite at a time: these two share :4000 and the printer adapter directory.
run "desktop receipt + drawer (Electron)" bun run --filter desktop test:print || FAILED=1
run "desktop security smoke (Electron)" bun run --filter desktop test:e2e || FAILED=1

# `test:counter` is deliberately not in the matrix: it drives PowerSync + Electron through a
# fresh enrolment and is run by hand (see evidence/counter-audit.txt and 13-VERIFICATION.md §5).
# Adding it here would put a third Electron suite in the same transcript as two others.

echo "" >> "$OUT"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL SUITES PASSED" >> "$OUT"
  echo "ALL SUITES PASSED"
else
  echo "ONE OR MORE SUITES FAILED — read the [exit N] lines above" >> "$OUT"
  echo "ONE OR MORE SUITES FAILED"
fi
exit "$FAILED"
