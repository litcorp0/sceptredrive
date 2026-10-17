import '../load-env.ts'

// Seeds are implemented in Plan 03:
// - admin seed from ADMIN_EMAIL / ADMIN_PASSWORD (idempotent, always)
// - demo seed (branches, terminals, manager, cashier) with --demo in non-production
async function main(): Promise<void> {
  console.log('[seed] no seeds implemented yet (arrive in Plan 03)')
}

await main()
