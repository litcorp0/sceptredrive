import { type DbExecutor, db } from '@sceptre/db'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { getSettingValue } from '../platform/settings.service.ts'
import { lockOrCreateProfile } from './credit.repository.ts'
import type { CreditProfileRow } from './credit.types.ts'

/**
 * The one place a branch credit profile is born (2026-10-28).
 *
 * A profile that does not exist yet is created with the branch's
 * `credit.defaultLimitMinor`; a profile that already exists is returned untouched
 * and locked. That is the whole rule, and it is deliberately narrow:
 *
 * - **Birth only.** An existing limit is never rewritten, so turning the default
 *   on does not quietly grant credit to yesterday's customers and does not undo a
 *   manager's decision to lower one. An explicit `0` stays `0`.
 * - **One setting, one place.** Profile editing, a limit request, a manual
 *   adjustment and the credit charge on a sale all pass through here, so the
 *   default cannot apply on one path and not another.
 * - **Audited.** A limit that appeared without a person in the trail is worse
 *   than no limit at all: every creation writes `credit.profile_created` with the
 *   value the branch's policy granted.
 *
 * This lives outside `credit.service.ts` on purpose. `customers.service.ts` must
 * create the profile at registration, and `credit.service.ts` already imports
 * `requireCustomer` from it — importing back would close a cycle. Nothing here
 * reads the customer module.
 */

export interface EnsureCreditProfileInput {
  customerId: string
  branchId: string
  actor: AuditActor
  executor?: DbExecutor
}

export interface EnsuredCreditProfile {
  profile: CreditProfileRow
  /** True when this call created the row — the caller may have been first. */
  created: boolean
  /** The branch's default at the moment of creation (0 for an existing row). */
  defaultLimitMinor: number
}

export async function ensureCreditProfile(
  input: EnsureCreditProfileInput,
): Promise<EnsuredCreditProfile> {
  const executor = input.executor ?? db
  const defaultLimitMinor = await getSettingValue(
    'credit.defaultLimitMinor',
    { branchId: input.branchId },
    executor,
  )

  const { profile, created } = await lockOrCreateProfile(
    executor,
    input.customerId,
    input.branchId,
    defaultLimitMinor,
  )

  if (created) {
    await writeAudit(
      {
        ...input.actor,
        action: 'credit.profile_created',
        entity: 'credit_profile',
        entityId: profile.id,
        branchId: input.branchId,
        after: {
          customerId: input.customerId,
          limitMinor: profile.limitMinor,
          // `default` is the branch policy; an explicit limit writes its own
          // `credit.profile_updated` row immediately afterwards.
          limitSource: 'default',
        },
      },
      executor,
    )
  }

  return { profile, created, defaultLimitMinor }
}
