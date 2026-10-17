import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { db } from '@gikautos/db'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { env } from '../config/env.ts'
import { email } from '../email/index.ts'
import { logger } from '../logger.ts'
import {
  account,
  session,
  twoFactor as twoFactorTable,
  user,
  verification,
} from '../modules/identity/staff.schema.ts'
import { writeAudit } from '../modules/platform/audit.service.ts'
import { authDatabaseHooks } from './hooks.ts'
import { hashPassword, verifyPassword } from './password.ts'

export const SESSION_FRESH_AGE_SECONDS = 60 * 60

const betterAuthLogger: NonNullable<BetterAuthOptions['logger']> = {
  level: env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace' ? 'debug' : 'info',
  disableColors: true,
  log: (level, message) => {
    const line = `[better-auth] ${message}`
    if (level === 'debug') logger.debug(line)
    else if (level === 'warn') logger.warn(line)
    else if (level === 'error') logger.error(line)
    else logger.info(line)
  },
}

export const auth = betterAuth({
  appName: 'GikAutos',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.trustedOrigins,
  logger: betterAuthLogger,
  database: drizzleAdapter(db, {
    provider: 'pg',
    transaction: true,
    schema: { user, session, account, verification, twoFactor: twoFactorTable },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    // Accounts are created by staff management only, never by the visitor.
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
    sendResetPassword: async ({ user, url }) => {
      await email.send({
        to: user.email,
        subject: 'Reset your GikAutos password',
        text: `Hello ${user.name},\n\nUse this link to reset your GikAutos password. The link expires in one hour.\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
      })
    },
    onPasswordReset: async ({ user }) => {
      await writeAudit({
        action: 'auth.password.reset',
        entity: 'user',
        entityId: user.id,
      })
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: SESSION_FRESH_AGE_SECONDS,
    cookieCache: { enabled: true, maxAge: 60 * 5, strategy: 'compact' },
  },
  rateLimit: {
    enabled: env.NODE_ENV === 'production',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/two-factor/*': { window: 60, max: 5 },
      '/request-password-reset': { window: 60, max: 3 },
    },
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === 'production',
  },
  user: {
    additionalFields: {
      role: { type: 'string', required: false, defaultValue: 'CASHIER', input: false },
      branchId: { type: 'string', required: false, input: false },
      staffId: { type: 'string', required: false, unique: true, input: false },
      phone: { type: 'string', required: false },
      isActive: { type: 'boolean', required: false, defaultValue: true, input: false },
      mustChangePassword: { type: 'boolean', required: false, defaultValue: false, input: false },
      pinHash: { type: 'string', required: false, input: false, returned: false },
      pinVersion: {
        type: 'number',
        required: false,
        defaultValue: 0,
        input: false,
        returned: false,
      },
    },
  },
  databaseHooks: authDatabaseHooks,
  plugins: [twoFactor({ issuer: 'GikAutos' })],
})

export type Auth = typeof auth
export type AuthSession = typeof auth.$Infer.Session
export type AuthUser = typeof auth.$Infer.Session.user
