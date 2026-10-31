/**
 * Windows application identity.
 *
 * Squirrel writes the Start Menu shortcut with an Application User Model ID of
 * `com.squirrel.<nupkg id>.<exe name without .exe>`. The running app has to
 * announce the *same* id, or Windows counts the shortcut and the live window as
 * two applications: duplicate taskbar buttons, a pin that never activates, and
 * notifications that point at nothing.
 *
 * `SQUIRREL_PACKAGE_ID` is the MakerSquirrel `name` and the packaged executable
 * name in `forge.config.mts`. It is one camel-case word on purpose — NuGet ids
 * cannot contain spaces, and the two halves of the id must agree. The Forge
 * config cannot import this module (it is loaded before the app bundles), so
 * `identity.test.ts` asserts the two files still name the same package.
 */
export const SQUIRREL_PACKAGE_ID = 'SceptreDrivePOS'

/** `com.squirrel.SceptreDrivePOS.SceptreDrivePOS`, matching the Squirrel shortcut. */
export const APP_USER_MODEL_ID = `com.squirrel.${SQUIRREL_PACKAGE_ID}.${SQUIRREL_PACKAGE_ID}`
