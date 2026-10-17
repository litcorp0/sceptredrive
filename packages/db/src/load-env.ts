import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const here = dirname(fileURLToPath(import.meta.url))

// Load the repository-root .env regardless of the workspace the script runs from.
config({ path: resolve(here, '../../../.env'), quiet: true })
