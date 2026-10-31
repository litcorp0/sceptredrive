import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_USER_MODEL_ID, SQUIRREL_PACKAGE_ID } from './identity'

describe('windows app identity', () => {
  it('uses the id format Windows matches against the Squirrel shortcut', () => {
    expect(APP_USER_MODEL_ID).toBe('com.squirrel.SceptreDrivePOS.SceptreDrivePOS')
  })

  it('names the same package and executable as the Forge config', () => {
    // Forge loads `forge.config.mts` before any app code exists, so the id cannot be
    // imported there. This is the only thing keeping the two halves in step.
    const forgeConfig = readFileSync(
      path.join(import.meta.dirname, '..', '..', 'forge.config.mts'),
      'utf8',
    )

    expect(forgeConfig).toContain(`const SQUIRREL_PACKAGE_ID = '${SQUIRREL_PACKAGE_ID}'`)
    expect(forgeConfig).toContain('executableName: SQUIRREL_PACKAGE_ID')
    expect(forgeConfig).toContain('name: SQUIRREL_PACKAGE_ID')
  })
})
