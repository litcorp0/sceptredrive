---
phase: 12-branch-ops-approvals
plan: 07
title: Credit limit change requests and the over-limit list
lane: api
depends_on: [03]
requirements: [APR-01, APR-02, APR-04, MGR-05, BRN-05]
---

# Plan 07 — Credit is money, so an increase is a request

## Goal

A manager can reduce a customer's credit limit immediately — the only change that makes the branch
safer — and any increase waits for an admin who sees the current limit, the proposed limit and the
balance. The manager's branch view gets the list of customers already over their limit, not just a
count.

## Read first

- `00-DECISIONS.md` P12-D6, P12-D21 … P12-D23.
- `api/src/modules/credit/credit.service.ts:177-375,432-482` — `postEntry`, `updateProfile`, the
  over-limit decision and the audit actions.
- `api/src/modules/credit/credit.repository.ts:19-39,54-60,200-240` — `lockOrCreateProfile`,
  `updateProfileBalance`, `sumForCustomerBranch`.
- `api/src/modules/credit/credit.validation.ts:30-41` — `profileUpdateSchema`.
- `api/src/modules/analytics/analytics.repository.ts:410-418` — the over-limit predicate this plan
  must match.
- `api/src/modules/approvals/approvals.service.ts` (Plan 03).

## Tasks

### 1. `updateProfile` splits the limit from everything else

`credit.service.ts` keeps one entry point (`PUT /api/credit/profiles/:customerId`,
`credit.profile.manage`) and changes what it does with `limitMinor`:

| Actor | `newLimit < current` | `newLimit = current` | `newLimit > current` |
|---|---|---|---|
| `MANAGER` | apply, audit `credit.profile_updated` with `after.via: 'DIRECT_DECREASE'` | no-op | **403** "A credit limit increase is requested and approved. Use Request limit increase." |
| `ADMIN` | apply | no-op | apply, `after.via: 'DIRECT'` |

`hold`, `paymentTermDays` and `notes` are unchanged for both roles — they do not increase exposure.

The rule lives in **one** place (`updateProfile`), not in the route and not in the console: a
client that hides the field must still hit a 403 if it sends one (OWASP A01).

### 2. The request

```ts
export async function requestCreditLimitIncrease(
  user: SessionUser, actor: AuditActor, customerId: string,
  input: { proposedLimitMinor: number; reason: string },
): Promise<{ approvalId: string; status: 'PENDING' }>
```

- Admin → **400**, "An admin changes a limit directly" (P12-D3).
- Branch = `branchScope(user)`; `requireCustomer(customerId)`; `lockOrCreateProfile` so a customer
  with no profile at this branch gets one at limit 0 before the request is valued.
- `proposedLimitMinor` must be **greater** than the current limit → 400 otherwise (a decrease needs
  no approval, and a request that would do nothing is noise).
- `requestApproval(actor, { type: 'CREDIT_LIMIT_CHANGE', entityId: profile.id, branchId,
  amountMinor: proposedLimitMinor, deciderRole: 'ADMIN', deciderBranchId: null, note: reason,
  payload: { customerId, branchId, currentLimitMinor: profile.limitMinor,
  proposedLimitMinor, balanceMinor: profile.balanceMinor } })`.
- Audit `credit.limit_change_requested` with before/after.
- A second pending request for the same profile → **409** from the partial unique index, with the
  customer named.

### 3. The decision handler

```ts
registerDecisionHandler('CREDIT_LIMIT_CHANGE', async (tx, approval, actor, decision, input) => {
  const payload = creditLimitPayloadSchema.parse(approval.payload)
  if (decision === 'REJECTED') return
  const profile = await lockProfileById(approval.entityId!, tx)
  if (!profile) throw new NotFoundError('Credit profile not found')
  if (profile.limitMinor !== payload.currentLimitMinor) {
    throw new ConflictError('The limit changed while this request was waiting. Reject it and raise a new one.')
  }
  await updateProfileLimit(profile.id, payload.proposedLimitMinor, tx)
  await writeAudit({ ...actor, action: 'credit.profile_updated', entity: 'credit_profile',
    entityId: profile.id, branchId: profile.branchId,
    before: { limitMinor: profile.limitMinor },
    after: { limitMinor: payload.proposedLimitMinor, via: 'approval', approvalId: approval.id } }, tx)
})
```

No ledger entry is written. A limit is an entitlement, not money owed; `balanceMinor` stays a
projection of `credit_ledger_entry` and is untouched by this plan (the reconciliation test proves
it).

### 4. Subject loader

```ts
registerSubjectLoader('CREDIT_LIMIT_CHANGE', async (approval) => {
  const profile = await findProfileById(approval.entityId!)
  return { kind: 'credit_limit_change', customerId: profile.customerId, branchId: profile.branchId,
    currentLimitMinor, proposedLimitMinor, balanceMinor: profile.balanceMinor }
})
```

The detail adds the customer's name and phone, the utilisation
(`ratioBp(balance, proposedLimit)`), and the resulting position — including the case where the
approved limit leaves the customer over it, which is allowed (P12-D21) and must be visible rather
than discovered at the next sale.

### 5. The over-limit list

```ts
export async function listOverLimit(user, query: { branchId?; limit; offset }):
  Promise<{ customers: OverLimitRow[]; total: number; branchId: string | null }>

interface OverLimitRow {
  customerId: string; customerName: string; phone: string | null
  branchId: string; limitMinor: number; balanceMinor: number; overByMinor: number
}
```

Predicate, identical to analytics (`analytics.repository.ts:410-418`):
`limit_minor > 0 AND balance_minor > limit_minor`, ordered `overByMinor DESC` so the biggest
exposure is first. Route `GET /api/credit/over-limit` (`credit.read`), branch-scoped through
`resolveBranchFilter`.

A test asserts `listOverLimit(...).total` equals analytics' `overLimitCreditCount` for the same
branch and fixture, so the two definitions cannot drift.

### 6. Routes and validation

| Method | Path | Permission |
|---|---|---|
| POST | `/api/credit/profiles/:customerId/limit-requests` | `credit.profile.manage` |
| GET | `/api/credit/over-limit` | `credit.read` |

```ts
export const creditLimitRequestSchema = z.object({
  proposedLimitMinor: z.number().int().min(1).max(100_000_000_000),
  reason: z.string().trim().min(3).max(300),
}).strict()
```

`profileUpdateSchema` is unchanged; the increase rule is authority, not shape.

### 7. Tests (`credit.test.ts`)

- manager decreases 5 000 → 4 000 → 200, `limit_minor` = 4 000, audit `via: 'DIRECT_DECREASE'`;
- manager increases 5 000 → 6 000 → **403**, limit unchanged, zero approvals;
- admin increases → 200, zero approvals;
- manager requests 5 000 → 8 000 with a reason → approval `PENDING`, `amountMinor` = 8 000,
  `entityId` = profile id, limit still 5 000;
- admin approves → limit 8 000, `credit_ledger_entry` count unchanged, `balance_minor` unchanged;
- approve a second time → 409;
- approve after another admin changed the limit → 409, limit unchanged, approval still `PENDING`;
- reject → limit unchanged;
- request a decrease → 400; request with no reason → 400; admin requesting → 400;
- two pending requests for one profile → 409; a pending request at branch A does not block branch B
  (different profile ids);
- over-limit list: three profiles, one at exactly the limit (excluded), one above (included), one
  with `limit_minor = 0` (excluded); total matches analytics' count;
- another branch's manager reading the list with `?branchId=<foreign>` → 403.

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: API grows by ~20; the existing `updateProfile` tests that raised a limit as a manager are
updated to the new rule and named in the commit body.

## Commits

1. `feat(api): managers lower credit limits directly and request increases`
2. `feat(api): approved credit limit change with a stale-request guard`
3. `feat(api): over-limit customer list`
4. `test(api): limit authority, one-shot approval and over-limit parity`

## Done when

- No manager-reachable path raises a credit limit without an admin decision.
- A decrease is immediate and audited.
- The over-limit list and the analytics count agree on the same fixture.
