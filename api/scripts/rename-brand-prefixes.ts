import { closeDb, pool } from '@sceptre/db'
import '../src/config/env.ts'

/**
 * Move identifiers that predate the rename onto the Sceptre Drive prefixes.
 *
 * Staff ids were `GA-0001` and SKUs `GIK-00001`, after the old brand. The code defaults are now
 * `SD` and `SDP`, but defaults only affect rows created afterwards, and both prefixes live in
 * settings — so an existing database keeps showing the old identifiers until this runs.
 *
 *   bun run prefix:rename            # report what would change
 *   bun run prefix:rename -- --apply
 *
 * Safe to run twice: every statement matches only the old prefix, so a second run reports zero.
 * Staff ids and SKUs are display identifiers: stock, sales and ledgers reference product and user
 * rows by id, so renaming a label relinks nothing. Existing terminals keep whatever they cached
 * locally; sales made after this show the new labels.
 */

interface Step {
  label: string
  countSql: string
  applySql: string
}

const STEPS: Step[] = [
  {
    label: "staff id prefix setting: 'GA' -> 'SD'",
    countSql: `select count(*)::int as n from "setting"
               where key = 'staff.idPrefix' and value = to_jsonb('GA'::text)`,
    applySql: `update "setting" set value = to_jsonb('SD'::text)
               where key = 'staff.idPrefix' and value = to_jsonb('GA'::text)`,
  },
  {
    label: "SKU prefix setting: 'GIK' -> 'SDP'",
    countSql: `select count(*)::int as n from "setting"
               where key = 'catalog.skuPrefix' and value = to_jsonb('GIK'::text)`,
    applySql: `update "setting" set value = to_jsonb('SDP'::text)
               where key = 'catalog.skuPrefix' and value = to_jsonb('GIK'::text)`,
  },
  {
    label: "staff ids: 'GA-…' -> 'SD-…'",
    countSql: `select count(*)::int as n from "user" where staff_id like 'GA-%'`,
    applySql: `update "user" set staff_id = 'SD-' || substring(staff_id from 4)
               where staff_id like 'GA-%'`,
  },
  {
    label: "product SKUs: 'GIK-…' -> 'SDP-…'",
    countSql: `select count(*)::int as n from "product" where sku like 'GIK-%'`,
    applySql: `update "product" set sku = 'SDP-' || substring(sku from 5)
               where sku like 'GIK-%'`,
  },
]

const apply = process.argv.includes('--apply')

async function count(step: Step): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(step.countSql)
  return rows[0]?.n ?? 0
}

async function main(): Promise<void> {
  console.log(apply ? 'Applying prefix rename\n' : 'Dry run — pass --apply to write\n')

  let changed = 0
  for (const step of STEPS) {
    const before = await count(step)
    if (!apply || before === 0) {
      console.log(`  ${before.toString().padStart(5)}  ${step.label}`)
      changed += before
      continue
    }
    await pool.query(step.applySql)
    const after = await count(step)
    console.log(`  ${(before - after).toString().padStart(5)}  ${step.label}`)
    changed += before - after
  }

  if (apply) {
    console.log(`\nDone. ${changed} row(s) changed.`)
    if (changed > 0) {
      console.log('Restart the API and PowerSync so pooled clients see the new values.')
    }
  } else {
    console.log(`\n${changed} row(s) would change. Re-run with --apply to write.`)
  }
}

main()
  .catch((error) => {
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
