import '../config/env.ts'
import { closeDb } from '@sceptre/db'
import { seedAdmin } from './admin.ts'
import { seedDemo } from './demo.ts'

const runDemo = process.argv.includes('--demo')

async function main(): Promise<void> {
  if (runDemo && process.env.NODE_ENV === 'production') {
    console.error('[seed] refusing to run the demo seed with NODE_ENV=production')
    process.exit(1)
  }

  const admin = await seedAdmin()
  console.log(`[seed] admin ${admin === 'created' ? 'created' : 'already present'}`)

  if (runDemo) {
    const result = await seedDemo()
    if (result.created.length > 0) {
      console.log(`[seed] demo data created: ${result.created.join(', ')}`)
    } else {
      console.log('[seed] demo data already present')
    }
  }
}

try {
  await main()
} finally {
  await closeDb()
}
