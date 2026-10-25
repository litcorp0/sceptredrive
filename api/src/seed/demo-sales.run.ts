import '../config/env.ts'
import { closeDb } from '@sceptre/db'
import { seedDemoSales } from './demo-sales.ts'

/**
 * CLI for `seed:demo-sales`.
 *
 * Same shape as `seed/run.ts`: refuse production before touching the database, then print
 * one summary line. The heavy lifting lives in `demo-sales.ts`, which the tests call
 * directly with a scratch fixture.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('[seed:demo-sales] refusing to run with NODE_ENV=production')
    process.exit(1)
  }

  const result = await seedDemoSales()

  if (result.sales === 0 && result.created.length === 0) {
    console.log('[seed:demo-sales] demo sales already present; nothing written')
    return
  }

  const summary = [
    ...result.created,
    `${result.shifts} shift${result.shifts === 1 ? '' : 's'}`,
    `${result.sales} sale${result.sales === 1 ? '' : 's'}`,
  ]
  console.log(`[seed:demo-sales] created: ${summary.join(', ')}`)
}

try {
  await main()
} finally {
  await closeDb()
}
