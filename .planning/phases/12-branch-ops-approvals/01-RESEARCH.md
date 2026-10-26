# Phase 12 — Research

Read once. This file records the **official documentation** consulted and the **repository facts**
verified on 2026-10-26, so the execution session does not repeat either. Line numbers are from
this working tree.

---

## 1. Official documentation

| Topic | Source | What it settles |
|---|---|---|
| Enum evolution | [PostgreSQL 17 — ALTER TYPE](https://www.postgresql.org/docs/17/sql-altertype.html) | "If `ALTER TYPE ... ADD VALUE` is executed inside a transaction block, the new value cannot be used until after the transaction has been committed." Additions are one migration file, every use the next (P12-D9, P12-D15) |
| Drizzle enum + custom migrations | [Drizzle — PostgreSQL column types, `enum`](https://orm.drizzle.team/docs/column-types/pg), [Custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations) | `pgEnum(name, [...])` emits `CREATE TYPE`; `drizzle-kit generate --custom --name=…` writes an empty SQL file for a change Kit cannot express (enum-only migrations) |
| pg-boss scheduling | [pg-boss — Scheduling](https://pgboss.io/api/scheduling) | `schedule(name, cron, data, options)` upserts on `(name, key)`; `tz`; `missed: 'skip' \| 'once'`; schedules are checked every 30 s, so use 5-field cron; at least one instance must be running |
| pg-boss send options | [pg-boss — Jobs](https://pgboss.io/api/jobs) | `send(name, data, options)`; `startAfter`, `singletonKey` + `singletonSeconds` is a throttle not a lock; `send()` resolves `null` when throttled; `retryLimit`, `expireInSeconds` |
| Hono routing, validators, `app.request()` | `hono` skill (`@hono/zod-validator`, `c.req.valid('json' \| 'query' \| 'param')`) | Route shape already used in this repository; no new middleware |
| TanStack Router search state | Repository pattern `admin/src/routes/_authenticated/analytics.tsx:1-8` + `admin/src/modules/analytics/utils/search.ts:24-46` | `validateSearch` + `search: { middlewares: [stripSearchParams(defaults)] }`; the inbox keeps its filter in the URL the same way |
| OWASP Top 10:2025 / ASVS 5.0 | `owasp-security` skill | A01 (broken access control) is this phase's whole risk: deny by default, ownership checks, no self-approval, IDOR legs on every `/:id` |
| ABC cycle counting | [Shopify — Cycle counting](https://www.shopify.com/blog/cycle-count), [Kardex — Cycle counting methods](https://www.kardex.com/en-us/blog/cycle-counting-and-stock-audits) | A ≈ top 20% of value/velocity counted monthly, B quarterly, C 1–2× a year; event-driven triggers ("negative quantities, high pick frequency") are standard practice, which is what D17 encodes |
| PowerSync streams | `powersync/sync-config.yaml` (read, not changed) | The POS receives products, barcodes, prices, stock levels, customers, credit profiles and loyalty only. `shift`, `stock_movement`, `approval` and every new table are **not** synced, so Phase 12 needs no sync-config change |

**Version facts.** `pg-boss` is `12.38.0` (`bun.lock:1327`, catalog `package.json:30`). PostgreSQL
is 17. Drizzle Kit is the migration runner (`api/package.json` `db:generate` / `db:migrate`).

---

## 2. Repository facts — approvals

1. **The table already exists** — `api/src/modules/approvals/approvals.schema.ts:58-98`:
   `id, type, entity_id (uuid, no FK), branch_id (FK restrict), status, requested_by, requested_at,
   request_note, amount_minor, payload jsonb, decided_by, decided_at, decision_reason_code,
   decision_note, created_at, updated_at`.
2. **Partial unique index** — `approval_open_entity_unique` on `(type, entity_id) WHERE status =
   'PENDING' AND entity_id IS NOT NULL` (`approvals.schema.ts:87-90`). `PRODUCT_CREATE` has no
   entity id and is therefore not deduplicated (`api/src/seed/helpers.ts:1542-1544`).
3. **Every Phase 12 type already exists in the enum** — `PURCHASE_ORDER, PRODUCT_CREATE,
   TRANSFER_REQUEST, STOCK_WRITE_OFF, PRICE_CHANGE, CREDIT_LIMIT_CHANGE, SHIFT_VARIANCE_REVIEW,
   REFUND` (`approvals.schema.ts:28-40`; shared `packages/shared/src/approvals.ts:16-33`;
   migration `api/migrations/0010_procurement.sql:3`).
4. **Every type maps to ADMIN** — `APPROVAL_DECIDER_ROLE` (`packages/shared/src/approvals.ts:63-72`)
   and `approvalDeciderRole` (`:74-76`). `decideApproval` gates on `roleOf(user) ===
   approvalDeciderRole(type)` **and** `procurement.approve` (`approvals.service.ts:140-158`).
5. **Self-approval is already blocked** — `approvals.service.ts:160-165`, compared against
   `actorLabel(actor)`; proven by `approvals.test.ts:241-259`.
6. **Decision handlers are a registry** — `registerDecisionHandler` / `HANDLERS` /
   `assertDecisionHandlersRegistered` / `registeredDecisionTypes`
   (`approvals.service.ts:45-69`). Boot asserts exactly `['PRODUCT_CREATE', 'PURCHASE_ORDER']`
   (`api/src/app.ts:39-41`). Only those two are registered
   (`products.service.ts:680`, `procurement.service.ts:734`).
7. **Subjects are three arms** — `purchase_order | product | other`
   (`approvals.types.ts:28-31`); `subjectOf` maps two types and returns `other` for the rest
   (`approvals.service.ts:305-315`).
8. **One list endpoint, newest first** — `GET /api/approvals` with `type`, `status`, `branchId`,
   `limit` (≤ 200, default 50), `offset` (`approvals.validation.ts:5-14`); ordered
   `requestedAt DESC` (`approvals.repository.ts:51-63`). No count-only endpoint.
9. **All four routes are procurement-gated** — `procurement.read` on list/detail/withdraw,
   `procurement.approve` on decide (`approvals.routes.ts:13-44`).
10. **`procurement.approve` is admin-only** — absent from `MANAGER_PERMISSIONS`
    (`packages/shared/src/permissions.ts:68-115`); managers therefore cannot decide anything.
11. **Audit seam** — `writeAudit(entry, executor)` (`platform/audit.service.ts:11-13`), used by
    every decision (`approvals.service.ts:99-113`, `:194-209`).
12. **Document numbering** — `allocateDocumentNumber(kind, branchId, executor, now)`
    (`platform/sequences.service.ts:54-86`), `DocumentKind = 'purchase_order' | 'supplier_return' |
    'supplier_credit_note'` (`:16`), table `document_sequence` unique on
    `(branch_id, kind, period)` (`platform/sequences.schema.ts:16-41`).
13. **Settings registry** — `SETTING_DEFINITIONS` (`platform/settings.validation.ts:5-271`) with
    `{ schema, defaultValue, branchScoped, writableBy? }`; `getSettingValue` /
    `getResolvedSetting` (`settings.service.ts:87-108`); `writableByOf` defaults branch-scoped
    keys to manager (`:32-38`). Neither `pricing.managerBandPercent`,
    `pos.shiftVarianceToleranceMinor` nor `inventory.countVarianceToleranceMinor` exists.

## 3. Repository facts — transfers, inventory, counts

14. **Transfer status has five values** — `DRAFT, DISPATCHED, RECEIVED, SHORT_CLOSED, CANCELLED`
    (`transfers/transfers.schema.ts:14-20`); table columns at `:22-56`, lines at `:58-76`.
15. **`createTransfer` allows either side to be the manager's** —
    `transfers.service.ts:100-167`, guard at `:119-121`. **`dispatchTransfer` requires the source
    branch** (`:311`) and only accepts `DRAFT` (`:316-318`). So a manager can create an outgoing
    transfer and dispatch it themselves — the hole D4 describes.
16. **Dispatch posts `TRANSFER_OUT` with no `allowNegative`** (`:344-360`), so insufficient stock
    is a 409. Receive posts `TRANSFER_IN` at the line's cost (`:434-452`). Short-close posts
    nothing (`:495-551`).
17. **One movement writer** — `postMovements(actor, inputs, options)`
    (`inventory/inventory.service.ts:114-192`). It validates (inbound positive + cost, outbound
    negative, `ADJUSTMENT` needs a reason), locks or creates the level, refuses negative stock
    unless `allowNegative`, re-averages inbound cost, appends the movement, updates the projection,
    and derives `product.cost_price_minor` for `RECEIPT` only.
18. **Movement enums** — `stock_movement_type`: `RECEIPT, ADJUSTMENT, TRANSFER_OUT, TRANSFER_IN,
    COUNT_VARIANCE, SALE, SUPPLIER_RETURN`; `stock_movement_reference`: `RECEIPT, ADJUSTMENT,
    TRANSFER, COUNT, SALE, SUPPLIER_RETURN`; `stock_adjustment_reason`: `DAMAGE, LOSS, FOUND,
    CORRECTION, EXPIRED, OTHER` (`inventory/inventory.schema.ts:15-52`). Enum additions already
    have a precedent file: `api/migrations/0009_enum_supplier_return.sql`.
19. **`createAdjustment`** posts an `ADJUSTMENT` immediately for anyone with `inventory.adjust`
    (`inventory.service.ts:438-492`; route `inventory.routes.ts:58-64`). Managers have that
    permission (`permissions.ts:85-90`). This is the path P12-D13 closes for shrinkage.
20. **Counts** — `stock_count` + `stock_count_line` (`counts/counts.schema.ts:17-62`); status
    `OPEN | POSTED | CANCELLED` (`:15`). `createCount` (`counts.service.ts:61-124`) resolves the
    category **and its children** (`:69-74`), snapshots levels (`:76-102`), allocates
    `inventory.countSequence`. `postCount` (`:191-274`) posts `COUNT_VARIANCE` movements through
    `postMovements` and pre-checks negatives (`:209-221`). Variance is computed on read, never
    stored (`counts.repository.ts:88-91`).
21. **The snapshot only sees existing levels** — `selectSnapshotRows` joins `stock_level`
    (`counts.repository.ts:115-134`), so a never-stocked product cannot be counted (P12-D31).
22. **`stock_count` has no scheduling columns** — no `due_at`, `assigned_to`, `schedule_id`,
    `count_type` or trigger fields.
23. **Oversell conflicts** — `sync_conflict` (`pos/pos.schema.ts:278-307`) with
    `type/severity/status/details jsonb`, created in `applySale`
    (`pos.service.ts:984-1014`, `:1295-1317`) through `addConflict` (`pos/pos.conflicts.ts:25-50`).
    `details.productId` is where the product lives. There is no index on `(type, created_at)`.
24. **Low stock** — `listLowStock` → `queryStock(..., true)` (`inventory.service.ts:532-565`);
    predicate `quantity_on_hand <= threshold` with a non-null threshold
    (`inventory.repository.ts:358-374`). `stock_threshold` carries `max_quantity` and
    `min_order_quantity` (`inventory.schema.ts:112-138`).
25. **Branch types** — `branch_type`: `RETAIL | WAREHOUSE` (`org/branches.schema.ts:12-20`). This
    is what decides transfer authority (P12-D11).

## 4. Repository facts — price, credit, shift

26. **Effective price** — `resolveEffectivePrice(base, override)` (`packages/shared/src/pricing.ts:14-26`);
    override wins unconditionally. One row per `(product, branch)` (`products.schema.ts:70-92`),
    upserted in place, no history.
27. **Override writes** — `setPriceOverride` / `removePriceOverride`
    (`products.service.ts:416-496`) with permission `price.override`
    (`products.routes.ts:109-129`), audit `product.price.override_set` / `_removed`. A manager can
    already set **any** price; no band exists. `price.update` is declared and used by no route.
28. **Credit profile** — `limit_minor`, `hold`, `payment_term_days`, `balance_minor` projection
    (`credit/credit.schema.ts:46-72`). `updateProfile` (`credit.service.ts:432-482`) writes any
    limit for `credit.profile.manage` (admin **and** manager, `permissions.ts:42`, `:99`), audit
    `credit.profile_updated`. Over-limit is decided at `credit.service.ts:275-285`; the POS path
    flags instead of blocking (`pos.service.ts:1018-1051`).
29. **Shift** — `shift_status` is `OPEN | CLOSED` only (`pos/pos.schema.ts:18`); columns include
    `opening_float_minor, counted_cash_minor, client_expected_cash_minor,
    server_expected_cash_minor, variance_minor, close_note, closed_by` (`:57-98`).
    `computeExpectedCash` (`pos.service.ts:376-385`); `closeShift` computes
    `variance = counted − serverExpected` (`:573-576`), stores it unconditionally (`:605-618`) and
    raises `SHIFT_VARIANCE_MISMATCH` when client and server disagree (`:579-603`).
    **No tolerance, no review state, no reviewer.**
30. **Reconciliation filters `status = 'CLOSED'`** — `pos/pos.reconciliation.ts:291-299`, which is
    why a review *status* would be a defect (P12-D24).
31. **No admin shift list** — `admin/src/modules/` has no shifts module and `admin/src/routes/`
    has no shift route. The only shift reads are `findOpenShiftByTerminal` /
    `findShiftByIdForUpdate` (`pos.repository.ts:215-233`).
32. **Analytics attention** — `selectAttention` (`analytics.repository.ts:376-449`) returns
    `lowStockCount, openConflictCount, conflictsBySeverity, openShiftCount, overLimitCreditCount,
    expiringPoints`. Over-limit is a **count only**; no list endpoint returns the rows
    (`getAging` has buckets but no limit field).

## 5. Repository facts — console and gates

33. **Module contract** — `admin/src/modules/README.md:8-18`; 17 modules listed in
    `scripts/check-modules.mjs:39-51`; folder whitelist and `index.ts` barrel enforced by
    `scripts/lib/module-rules.mjs:25-34,161-195`; deep imports and cross-module internals fail
    (`:203-229`; Biome `admin/biome.json:50-75`); routes ≤ 25 lines, one barrel, no query hooks
    (`check-modules.mjs:96-169`).
34. **Nav** — `NavPath` union (`sidebar.tsx:37-50`), `NAV_GROUPS` (`:68-117`), permission filter
    via `can()` (`:225-234`), `SECTION_LABELS` / `PAGE_LABELS` for breadcrumbs (`:128-156`).
    `SidebarMenuBadge` exists (`components/ui/sidebar.tsx:563-580`) and has **zero callers**.
35. **List/detail pattern** — `queryOptions` factories + key factories
    (`inventory/api/transfers.ts:6-22`, `keys.ts:34-38`); `TableMessage` / `Pagination` /
    `EmptyState`; detail pages early-return on loading/error and distinguish 403/404
    (`procurement/pages/order-detail-page.tsx:64-82`).
36. **Settings UI is a second registry** — `SettingKey` union + `SETTING_META`
    (`admin/src/modules/settings/types/index.ts:1-21`,
    `pages/settings-page.tsx:15-166`) lists 19 keys and none of the Phase 11 or Phase 12 keys; a
    setting is only editable when it is in both registries.
37. **The console has no unit tests** — `admin/package.json` has no `test` script; the regression
    net is `admin/test/walkthrough-sections.mjs` (868 lines, Playwright, 1440×1000, sections table
    at `:133-165`, `visit()` asserting URL + text + zero console errors + zero failed requests at
    `:212-232`). Phase 11 closed at **159/159**.
38. **API walkthrough precedent** — `phases/11-procurement-replenishment/evidence/walkthrough-procurement.mjs`
    uses `fetch` + `pg` (no browser), creates fixtures through the API, prints `PASS n` / `FAIL n`;
    Phase 11 recorded **85 assertions**.

## 6. The five facts that shape this phase

1. **The approval entity exists but its authority model cannot express D4** — `decider_role` +
   `decider_branch_id` on the row (P12-D2).
2. **Managers cannot decide anything today** — `procurement.approve` is admin-only and every type
   maps to ADMIN. Without P12-D1/D2, context D4, BRN-01 and BRN-04 are unimplementable.
3. **Two unapproved paths already exist** — a manager's direct price override
   (`products.service.ts:416`) and direct shrinkage adjustment (`inventory.service.ts:438`). Both
   must be gated by the workflow or the workflow is theatre (P12-D13, P12-D18).
4. **`shift_status` cannot carry review state** — the reconciliation query filters `CLOSED`
   (`pos.reconciliation.ts:291`). Review is a separate column (P12-D24).
5. **Nothing here reaches the POS** — `shift`, `stock_movement`, `approval`, `stock_write_off`,
   `count_schedule` and `stock_abc_class` are not in `powersync/sync-config.yaml`. The phase must
   keep `git diff --stat -- desktop/ powersync/` empty and the desktop suite at its Phase 11
   count (**421**).
