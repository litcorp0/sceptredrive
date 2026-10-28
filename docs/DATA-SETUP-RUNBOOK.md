# Sceptre Drive — Data Setup Runbook

> **Who this is for:** the person setting up a real Sceptre Drive business (or a
> realistic staging copy) from an empty database. It assumes no demo data.
>
> **What it is:** the data counterpart to Phases 1–14. It does not explain the
> code; it says **what to create, in what order, with which fields**, so every
> feature has the rows it reads and every ledger reconciles.
>
> **How to use it:** work top to bottom. Each stage states why it comes now, what
> to do in the admin console, and how to prove it worked. Skipping ahead usually
> fails on a foreign key or leaves a feature with nothing to show.

**Last updated:** 2026-10-28
**Applies to:** Sceptre Drive v1, Phases 1–14 complete

---

## Contents

- [0. The model you are setting up](#0-the-model-you-are-setting-up)
- [1. Environment and the empty database](#1-environment-and-the-empty-database)
- [2. Company-wide settings](#2-company-wide-settings)
- [3. Branches and terminals](#3-branches-and-terminals)
- [4. People, roles and PINs](#4-people-roles-and-pins)
- [5. Catalog and pricing](#5-catalog-and-pricing)
- [6. Suppliers and supplier products](#6-suppliers-and-supplier-products)
- [7. Opening stock](#7-opening-stock)
- [8. Customers, credit and loyalty](#8-customers-credit-and-loyalty)
- [9. The procurement cycle](#9-the-procurement-cycle)
- [10. The first POS day](#10-the-first-pos-day)
- [11. Inventory operations](#11-inventory-operations)
- [12. Payments](#12-payments)
- [13. E-VAT](#13-e-vat)
- [14. Oversight: dashboard, analytics, audit, approvals](#14-oversight-dashboard-analytics-audit-approvals)
- [15. Reset, reseed and repeat](#15-reset-reseed-and-repeat)
- [16. Go-live data checklist](#16-go-live-data-checklist)
- [Appendix A — Dependency checklist](#appendix-a--dependency-checklist)
- [Appendix B — Roles at a glance](#appendix-b--roles-at-a-glance)
- [Appendix C — Status vocabularies](#appendix-c--status-vocabularies)
- [Appendix D — Settings quick reference](#appendix-d--settings-quick-reference)
- [Appendix E — Rules that must never be broken](#appendix-e--rules-that-must-never-be-broken)

---

## 0. The model you are setting up

### 0.1 A branch is the operational unit

A **branch** owns stock, shifts, sales, credit profiles, purchase orders and
staff. A manager is locked to one branch; an administrator can switch between
all of them. The admin console's branch switcher changes what you are looking
at, and branch-scoped settings are written to the selected branch.

Two branch types exist:

| Type | Purpose | POS terminal? |
|---|---|---|
| `WAREHOUSE` | Receiving, bulk stock, transfers out. Stock-only. | No |
| `RETAIL` | Selling, shifts, cash drawers, customers. | Yes |

The system does not hard-block a terminal on a warehouse, but the operating
model is **stock-only**. Keep tills in retail branches.

### 0.2 Three roles, one authority chain

| Role | Scope | Typical use |
|---|---|---|
| `ADMIN` | All branches, all permissions | Owner / head office. Decides approvals that need admin authority. |
| `MANAGER` | One branch | Runs the branch: staff, stock, credit, approvals within policy. |
| `CASHIER` | One branch, POS only | Sells at the till. Never calls the admin API. |

Authorization is server-side. The UI hides what a role cannot do, but the API is
the authority. Manager overrides at the till are PIN-authorized and audited.

### 0.3 Money, stock and points are append-only

- All money is stored as **integer pesewas**. `GH₵ 12.34` is `1234`. Never enter
  fractions of a pesewa.
- **Money notation:** the database, API and every calculation use integer
  pesewas; the console and receipts display cedis. `1 cedi = 100 pesewas`, so
  `1,000,000` pesewas is `GH₵ 10,000.00`. Where a stored integer matters, this
  runbook shows both.
- Stock movements, credit ledger entries and loyalty ledger entries are
  **append-only**. A correction is a compensating entry, never an edit or a
  delete.
- A sale is a document. A refund is a new document that refers to it.
- The server recomputes authoritative values (tax, totals, expected cash, stock
  projections). The client shows provisional values only.

### 0.4 The order things depend on

```text
settings (numbering, tax mode)
        │
        ▼
branches ──► terminals
        │
        ▼
staff (manager, cashier) ──► PINs ──► device bindings
        │
        ▼
catalog (units, brands, categories, products)
        │
        ├──► suppliers ──► supplier products
        │
        ▼
opening stock (GRN) ──► transfers ──► thresholds / counts
        │
        ▼
customers ──► credit profiles ──► loyalty accounts
        │
        ▼
procurement ──► payables ──► payments / E-VAT
        │
        ▼
POS shifts ──► sales ──► refunds ──► reconciliation
```

You can create a branch before its staff, but not a manager before a branch. You
can create a product before a supplier, but not a supplier-product link before
the product. Stock before sales is not a hard constraint, but a sale with no
stock is recorded as an oversell conflict, so set opening stock first.

---

## 1. Environment and the empty database

### 1.1 Prerequisites

- **Bun 1.3.14** (the repository's `packageManager`).
- **Docker** with Compose, for PostgreSQL and the local PowerSync service.
- **Node 24** available to the API and Electron Forge.
- Ports free: `3000` (admin), `4000` (API), `8080` (PowerSync), and the Postgres
  host port (`5433` by default; this machine's `.env` uses `5434`).

### 1.2 Create `.env`

```bash
cp .env.example .env
```

Fill at least these. Never commit `.env`.

| Variable | What to put |
|---|---|
| `DATABASE_URL` | Local Postgres URL. Match `POSTGRES_PORT` in the same file. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:4000` |
| `ADMIN_URL` | `http://localhost:3000` |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` |
| `ADMIN_EMAIL` | The first administrator's address |
| `ADMIN_PASSWORD` | At least 12 characters |
| `STAFF_ID_PREFIX` | e.g. `GA`; staff IDs become `GA-0001` |
| `STAFF_ID_START` | `1` |
| `POWERSYNC_URL` | `http://localhost:8080` for local sync |
| `PAYSTACK_MODE` | `mock` until the business has keys |
| `EVAT_PROVIDER` | `mock` until GRA onboarding completes |

If the Postgres port clashes with something already running:

```dotenv
POSTGRES_PORT="5434"
DATABASE_URL="postgresql://sceptre_drive:sceptre_drive@localhost:5434/sceptre_drive"
```

The password above is the local Compose default, not a production secret.

### 1.3 Start the database and migrate

```bash
bun install
docker compose up -d
bun run db:migrate
```

`db:migrate` applies everything in `api/migrations`. It is idempotent; running it
again applies nothing.

### 1.4 Create the bootstrap admin

```bash
bun run seed:admin
```

- Reads `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Creates role `ADMIN`, no branch, no TOTP secret.
- Idempotent by email: if the account exists it prints `already present`.
- Optional overrides:

```bash
bun run seed:admin --email ops@example.com --password 'a-long-password'
```

Passing `--password` puts the value in shell history; prefer `.env`.

**This is not the demo seed.** It creates only the administrator. To create the
full demo dataset instead, see [§15.3](#153-the-demo-dataset).

### 1.5 Start the applications

```bash
bun run dev          # all workspaces
# or separately
bun run dev:api
bun run dev:admin
bun run dev:pos
```

For offline sync, initialise and start the local PowerSync service:

```bash
bun run sync:init
bun run sync:up
```

### 1.6 First sign-in

1. Open `http://localhost:3000/login`.
2. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
3. Open the user menu (top right) → **Set up two-factor**.
4. Confirm the password, scan the QR code with an authenticator app, and store
   the backup codes.
5. Only after your own 2FA works, go to **Settings → Access** and enable
   **Require two-factor authentication**. Enabling it before enrolling would
   lock you out of the console.
6. Change the seeded password from the user menu → **Change password** if the
   seeded value was shared.

**Verify:** `Settings → Staff` shows you as `ADMIN` with a staff ID such as
`GA-0001`. The branch switcher shows **All branches**.

---

## 2. Company-wide settings

Open **Settings**. Each row saves on its own. Branch-scoped rows are written to
the branch selected in the top bar; with **All branches** selected they are
read-only, so a stray save cannot become a global override.

Set these **before** creating records that allocate numbers. Changing a prefix
later does not renumber existing documents.

### 2.1 Identity and numbering

| Setting | Label | Recommended first value |
|---|---|---|
| `staff.idPrefix` | Staff ID prefix | `GA` |
| `staff.idSequence` | Next staff number | `1` |
| `catalog.skuPrefix` | SKU prefix | `GIK` |
| `catalog.skuSequence` | Next SKU number | `1` |
| `inventory.receiptPrefix` | Goods receipt prefix | `GRN` |
| `inventory.transferPrefix` | Transfer prefix | `TRF` |
| `inventory.countPrefix` | Stock count prefix | `CNT` |
| `supplier.codePrefix` | Supplier code prefix | `SUP` |
| `payable.invoicePrefix` | Purchase invoice prefix | `SINV` |
| `payable.paymentPrefix` | Supplier payment prefix | `PAY` |
| `procurement.orderPrefix` | Purchase order prefix | `PO` |
| `procurement.returnPrefix` | Purchase return prefix | `PR` |
| `procurement.creditNotePrefix` | Supplier credit note prefix | `SCN` |
| `credit.repaymentPrefix` | Repayment receipt prefix | `REP` |
| `inventory.writeOffPrefix` | Write-off serial prefix | `WO` |

Sequences advance only when a document is posted. Gaps are acceptable and
expected.

### 2.2 Money and tax

| Setting | Label | Recommended first value |
|---|---|---|
| `pricing.taxMode` | Tax mode | **Tax-inclusive prices** for Ghana retail |
| `pricing.managerBandPercent` | Manager price band (%) | `10` |
| `tax.sellerTin` | Seller TIN | Leave blank until GRA assigns it |
| `tax.sellerVatNumber` | Seller VAT number | Leave blank until issued |

Tax is VAT 15% + NHIL 2.5% + GETFund 2.5% on one base. In inclusive mode the
entered price already contains all three; in exclusive mode they are added on
top. Choose once, before entering prices.

`managerBandPercent` is admin-only: it is how far a manager may move a price
without an approval. A manager cannot raise their own band.

### 2.3 Till behaviour

| Setting | Label | Recommended first value |
|---|---|---|
| `pos.maxCashierDiscountPercent` | Cashier discount ceiling (%) | `0` |
| `pos.maxManagerDiscountPercent` | Manager discount ceiling (%) | `100` or a real policy |
| `pos.pinMaxAttempts` | PIN attempts before lockout | `5` |
| `pos.pinLockMinutes` | PIN lockout (minutes) | `5` |
| `pos.clockSkewToleranceMinutes` | Clock tolerance (minutes) | `10` |
| `pos.syncBatchSize` | Sync batch size | `25` |
| `pos.salesRequireOpenShift` | Sales need an open shift | **on** |
| `pos.receiptFooter` | Receipt footer | Business closing line |
| `receipt.header` | Receipt header | Business name / thank-you line (branch-scoped) |

### 2.4 Credit and loyalty

| Setting | Label | Recommended first value |
|---|---|---|
| `loyalty.earnPointsPerCedi` | Points earned per GHS 1 | `1` |
| `loyalty.pointsPerCedi` | Points per GHS 1 discount | `100` |
| `loyalty.expiryMonths` | Points expiry (months) | `12` |
| `loyalty.minimumRedeemPoints` | Minimum redemption (points) | `100` |

Loyalty has no global on/off switch; a customer earns only when a loyalty
account exists and the cashier attaches the customer to the sale.

### 2.5 Inventory and procurement policy

The console asks for **cedis** and stores **whole pesewas**. Enter the value in
the left-hand cedi column; the field shows the pesewas equivalent as you type.

| Setting | Label | Value (cedis) | Stored (pesewas) |
|---|---|---|---|
| `inventory.countVarianceToleranceMinor` | Count variance tolerance | `GH₵ 10.00` | `1000` |
| `procurement.approvalThresholdMinor` | Purchase approval threshold | `GH₵ 10,000.00` | `1000000` |
| `pos.shiftVarianceToleranceMinor` | Shift variance tolerance | `GH₵ 20.00` | `2000` |
| `pos.refundApprovalThresholdMinor` | Refund approval threshold | `GH₵ 200.00` | `20000` |

| Setting | Label | Recommended first value |
|---|---|---|
| `inventory.abcAThresholdBp` | ABC class A share (basis points) | `8000` (80%) |
| `inventory.abcBThresholdBp` | ABC class B share (basis points) | `9500` (95%) |
| `procurement.safetyDays` | Safety days of cover | `7` |
| `procurement.defaultLeadDays` | Assumed lead time (days) | `14` |

A and B thresholds must satisfy A < B; the service refuses an invalid pair.
Tolerances are branch-overridable but admin-writable: a branch that sets its own
tolerance has none.

### 2.6 Feature flags

Flags are typed settings, not a second store. They are **on** by default.

| Flag | Label | When to turn it off |
|---|---|---|
| `flag.supplierTransfers` | Supplier transfers | Paystack transfers are not live yet |
| `flag.evatSubmission` | E-VAT submission | GRA credentials are not ready |
| `flag.posConflictResolution` | POS conflict resolution | You do not want managers resolving sync conflicts |

**Verify:** reload Settings. Every row shows `Global` or `Branch` as its source;
a row that still shows `Default` has never been changed.

---

## 3. Branches and terminals

### 3.1 Create the warehouse first

Go to **Branches → New branch**.

| Field | Warehouse example | Notes |
|---|---|---|
| Name | `Accra Warehouse` | Human name |
| Type | `Warehouse` | Stock-only |
| City | `Accra` | Required |
| Area | blank | Optional |
| Address | `...` | Optional |
| Phone | `...` | Optional |

The **code is generated automatically** from the type, city and area — you do not
type it. The dialog shows a read-only preview; the final code is confirmed on
save and may gain a suffix if it is already taken.

| Type | Inputs | Example code |
|---|---|---|
| Retail, with area | city + area | `ACC-SPX` |
| Retail, no area | city | `ACC-R1`, then `ACC-R2` |
| Warehouse | city | `ACC-WH1`, then `ACC-WH2` |

The code is the branch's short identity and appears in terminal codes. You
cannot change it later from the edit form.

Create **all warehouses before retail branches** if you plan to open stock in a
warehouse and transfer it out. A retail branch can receive directly, but the
warehouse-first flow gives a cleaner movement trail.

### 3.2 Create retail branches

Repeat **New branch** with type `Retail`, for example city `Accra` and area
`Spintex`, which yields `ACC-SPX`. Each retail branch is a separate stock, shift
and credit world.

A branch is never deleted. **Deactivate** it when it closes; historical sales,
stock and ledgers keep referring to it.

### 3.3 Create terminals per retail branch

Go to **Terminals → New terminal**.

| Field | Example | Notes |
|---|---|---|
| Branch | `ACC-SPX · Accra Spintex` | Admin chooses; a manager is fixed to their branch |
| Name | `Counter 1` | Human label |

The terminal **code is allocated automatically** from the branch code, e.g.
`ACC-SPX-T01`. Do not create a terminal on a warehouse.

Repeat per till. A branch can have several terminals; each device enrols
separately.

### 3.4 Enrol a POS device

1. In **Terminals**, find the terminal → **Enrollment**.
2. A one-time code appears, valid for **15 minutes** and usable **once**.
   Generating a new code expires the previous one.
3. On the POS machine, open the app. If it has no credential it shows
   **Enrol this terminal**.
4. Enter the code. The device stores its token in the OS keychain, bound to that
   terminal and branch.
5. **Devices** on the terminal row shows the binding. **Revoke** removes it; the
   device must enrol again.

On Linux without a secret service, Electron reports a basic keychain. Treat that
as a warning: enrolment and sync stop rather than storing a token in the clear.

**Verify:** `Terminals` lists `ACC-SPX-T01 · Counter 1 · ACC-SPX`; the POS reaches
its sign-in screen and the sync badge reports a session.

---

## 4. People, roles and PINs

### 4.1 Create the branch managers

Go to **Staff → New staff account**.

| Field | Value |
|---|---|
| Name | Real name |
| Email | Unique; this is the console login |
| Role | `Manager` |
| Branch | The branch they run |
| Phone | Optional |

A manager **must** have a branch; an admin **must not**. The API enforces both.
The account receives a temporary password and an invitation email (or the
temporary password is shown when email is not configured). The first console
sign-in forces a password change.

Create one manager per retail branch, plus one for the warehouse if that
warehouse has staff.

### 4.2 Create cashiers

Same dialog, role `Cashier`, branch set. A cashier never signs into the admin
console; the account exists for POS identity, PIN and audit.

### 4.3 Set the first PIN

On the staff row → **Set PIN**.

- 4–6 digits.
- Avoid repeated digits and straight sequences.
- This is a **temporary PIN**: it signs the cashier out of every POS terminal
  and they must choose a new PIN at the till on first use.
- Resetting a PIN bumps its version; every bound terminal must adopt the new
  version.

The manager who sets the PIN tells the cashier the temporary value out of band.
Never send a PIN by email or put it in a ticket.

### 4.4 Enable two-factor for every admin

User menu → **Set up two-factor**. Then, when all admins are enrolled, turn on
`auth.requireTwoFactor` in **Settings → Access**. From then on an admin without
TOTP is redirected to setup and cannot use the console.

Break-glass if an admin loses both authenticator and backup codes:

```bash
bun run --filter api two-factor:reset -- --email admin@example.com
```

That removes the TOTP secret and backup codes and disables 2FA for the account.
It weakens the account; use it deliberately.

### 4.5 Deactivate leavers, never delete

**Staff → Deactivate**. Sessions end, the POS binding is refused, and the audit
trail keeps the person's name. The last active admin cannot be deactivated or
demoted; create the replacement first.

### 4.6 Check the permission matrix

**Staff → Permissions** shows what each role can do. It is read-only. The short
version:

- **Admin** — everything, all branches.
- **Manager** — their branch: staff, terminals, catalog read, price override,
  inventory, counts, transfers, write-offs request, credit, loyalty, suppliers,
  payables, procurement, approvals within their authority, POS oversight.
- **Cashier** — POS only: sell, hold, void cart, discount within the cashier
  ceiling, refund with manager PIN, repayment.

**Verify:** Staff list shows staff IDs (`GA-0001`, …), roles and branches. Sign
in as a manager in a private window; the sidebar is smaller and the branch
switcher is fixed.

## 5. Catalog and pricing

Create master data in this order. Each step is a prerequisite for the next.

### 5.1 Units of measure

**Catalog → Units → New unit**. Examples: `PCS` Piece, `SET` Set, `PAIR` Pair,
`BOX` Box, `LTR` Litre. The code is short and uppercase.

### 5.2 Brands

**Catalog → Brands → New brand**. Examples: Bosch, Denso, NGK, Febi. A product
may have no brand; a brand is never required.

### 5.3 Categories

**Catalog → Categories → New category**. Create parents first, then children
(e.g. `Engine` → `Oil Filters`, `Air Filters`, `Belts`). A product belongs to
exactly one category; the category can be a child.

Archiving a category or brand does not remove it from existing products.

### 5.4 Products

**Catalog → Products → New product**.

| Field | Notes |
|---|---|
| SKU | Suggested from `catalog.skuPrefix`; unique. Accept or type your own. |
| Name | What the cashier searches for |
| Category | Required |
| Brand | Optional |
| Unit | Required |
| Tax category | The product's tax treatment |
| Base price | In GHS; stored as integer pesewas |
| Description | Optional |

Price entry follows `pricing.taxMode`:

- **Inclusive** — the entered price is what the customer pays; tax is extracted.
- **Exclusive** — tax is added on top at the till.

After saving, open the product detail page to:

1. **Barcodes** — add every supplier and case barcode. A barcode is unique; the
   same code cannot belong to two products.
2. **Price overrides** — set a branch-specific price. The base price remains the
   catalogue price; the override applies only at that branch.
3. **Archive** — hide from new sales without deleting history.

### 5.5 Price changes and the manager band

A manager may move a price within `pricing.managerBandPercent` without asking.
A larger change raises a `PRICE_CHANGE` approval for an admin. The request is
decided in **Approvals**; the price does not move until approved.

### 5.6 Manager product submissions

A manager who cannot create products directly can use **Catalog → Submit a
product**. The submission goes to an admin for approval and creates the product
on approval. The server refuses a submission from the person who would decide
it, so an admin must use the normal product form.

**Verify:** the product list shows the product, its SKU, base price and effective
price for the selected branch. Search by name, SKU and barcode all find it. The
POS catalog shows it after the next sync.

---

## 6. Suppliers and supplier products

### 6.1 Create suppliers

**Suppliers → New supplier**.

| Field | Notes |
|---|---|
| Name | Legal or trading name |
| Contact | Person you call |
| Phone / Email | At least one reachable channel |
| Payment terms (days) | Used for invoice due dates and ageing |
| TIN / VAT | Supplier's tax identity, printed on payables where relevant |
| Address | Optional |
| Notes | Optional |

The supplier code (`SUP-00001`) is allocated automatically.

### 6.2 Add payment details

On the supplier detail page, **Payment details** holds the account(s) you pay:

- Bank: bank name, account name, account number.
- Mobile money: network, registered name, phone.

A supplier payment or transfer can only use an **active** detail matching the
chosen method. Add at least one per method you will use.

### 6.3 Link the products the supplier sells

On the supplier detail page → **Products → Add supplied product**.

| Field | Notes |
|---|---|
| Product | Search the catalog |
| Supplier SKU | The supplier's own code |
| Lead time (days) | Overrides `procurement.defaultLeadDays` for this link |

These links drive replenishment suggestions and purchase-order lines. Link
every product you actually buy from that supplier, not just the top sellers.

**Verify:** the supplier detail page lists active payment details and supplied
products with lead times.

---

## 7. Opening stock

The goal is a correct stock ledger at cut-over. There are two valid routes.
The warehouse-first route is recommended because it leaves one movement trail
from receipt to shelf.

### 7.1 Route A (recommended): warehouse then transfer

**Step 1 — receive into the warehouse.**

Switch the console to the warehouse branch (top-bar branch switcher; an admin
can choose any branch). Go to **Inventory → Receipts → Receive stock**.

| Field | Notes |
|---|---|
| Supplier | Optional; choose the real supplier when known |
| Supplier invoice number | Optional; the supplier's document number |
| Lines | Product, quantity, unit cost |
| Note | Optional context |

Posting creates a goods receipt (`GRN-00001`) and appends `stock_movement` rows
at cost. The warehouse stock level rises.

**Step 2 — transfer to each retail branch.**

**Inventory → Transfers → New transfer**.

| Field | Notes |
|---|---|
| From branch | The warehouse |
| To branch | The retail branch |
| Lines | Product and quantity |
| Note | Optional |

Save the draft, then move it through: **Request → Approve → Dispatch →
Receive**. The receiving branch confirms quantities; a short delivery is
**Short closed**, which records the difference rather than pretending it
arrived. Statuses are `Draft`, `Awaiting approval`, `Approved`, `Dispatched`,
`Received`, `Short closed`, `Cancelled`.

**Step 3 — set reorder points.**

**Inventory → Stock**, per product → **Stock levels**:

| Field | Meaning |
|---|---|
| Minimum (reorder point, units) | When stock at or below this, replenishment suggests an order |
| Maximum (top-up level, units) | The level an order should reach |
| Minimum order quantity (units) | The smallest order worth placing |

### 7.2 Route B: receive directly into retail

For a single-branch shop, skip the transfer and **Receive stock** with the retail
branch selected. This is valid and simpler; you lose the warehouse movement
trail, not any correctness.

### 7.3 Count what you received

Before go-live, run a stock count so the ledger starts from a verified number:

**Inventory → Counts → New count** → choose branch, optional category filter,
note. Enter counted quantities per line, then **Post count**. A posted count
whose absolute variance value exceeds `inventory.countVarianceToleranceMinor`
raises a trigger count for review.

### 7.4 Optional: ABC classification

`inventory.abcAThresholdBp` and `inventory.abcBThresholdBp` drive ABC classes.
The scheduled job recomputes them from sales value. Class A is the small share of
products that produce most value; it is used by replenishment and reporting.
Nothing must be entered by hand.

**Verify:** **Inventory → Stock** shows a quantity per product for the branch.
**Inventory → Movements** (product detail) shows the receipt and transfer
entries in order. Nothing was edited; every row is an append.

---

## 8. Customers, credit and loyalty

### 8.1 Create customers

**Customers → New customer**.

| Field | Notes |
|---|---|
| Name | Required |
| Phone | The main lookup at the till and in credit |
| Email | Optional |
| Address | Optional |
| Branch | The owning branch; credit is branch-scoped |

A customer can exist at more than one branch; the credit profile is per branch.

### 8.2 Set credit terms

On the customer detail page → **Credit settings**.

| Field | Notes |
|---|---|
| Credit limit (GHS) | The maximum outstanding balance |
| Payment terms (days) | Due date for new charges |
| Credit hold | Blocks new credit sales until lifted |
| Notes | Why the limit exists |

Rules:

- A **manager may lower** a limit directly; a lower limit reduces exposure.
- A **manager may not raise** a limit. They use **Request limit increase**,
  which creates a `CREDIT_LIMIT_CHANGE` approval for an admin.
- An **admin may set** any limit directly.
- A limit of `0` with a balance is over limit and blocks new credit.

### 8.3 Record an opening balance (if migrating)

If customers already owe money, record it as a credit ledger entry, never by
editing a profile:

**Customer detail → New credit entry** → Kind **Charge** → reason
**Opening balance** → amount → reference (e.g. the old system's invoice) → note.

A charge that would exceed the limit needs `credit.override` and a reason. The
entry is audited.

### 8.4 Record repayments

**Customer detail → Record repayment**: amount, method (`Cash`, `MoMo`, `Bank`),
and a transaction reference for non-cash. A repayment reduces the balance and
gets a `REP-00001` receipt number.

### 8.5 Loyalty

The loyalty account is created automatically on the customer's first loyalty
activity (earning, redeeming or an adjustment); the customer detail shows the
loyalty card and its balance. Configure earning and redemption in **Settings →
Loyalty** before the first loyalty sale.

Manual adjustments are allowed and audited:

**Customer detail / Loyalty → Adjust loyalty points**:

- **Earn** — points for an amount paid outside the POS (floors per sale).
- **Redeem** — consume points, oldest lots first.
- **Adjustment** — correct in either direction with a reason.

Points expire after `loyalty.expiryMonths`. The expiry job runs on a schedule.

### 8.6 Watch over-limit accounts

**Customers → Over limit** lists every profile where `limit > 0` and
`balance > limit`. **Customers → Aging** shows outstanding balances by age band
for the branch. Managers see their branch; admins see all.

**Verify:** the customer detail shows balance, limit, headroom and loyalty
points. An opening charge appears in the credit ledger with its reason and
reference.

---

## 9. The procurement cycle

This is the full buy-to-pay loop. You can run it manually in any order that
matches your supplier, but each document refers to the one before it.

### 9.1 Replenishment suggestions

**Procurement → Replenishment**. Suggestions use:

- current stock and the reorder point/threshold,
- the supplier-product lead time (or `procurement.defaultLeadDays`),
- `procurement.safetyDays` of extra cover,
- ABC class and recent sales velocity.

Review the suggested quantity before ordering. The suggestion is advice, not an
order.

### 9.2 Create a purchase order

**Procurement → Orders → New order**.

| Field | Notes |
|---|---|
| Supplier | Required |
| Branch | Receiving branch (admin chooses; manager fixed) |
| Expected delivery | Optional |
| Lines | Product, quantity, unit cost |
| Note | Delivery instructions or approver context |

Save as **Draft**, then **Submit**. A **manager's** order whose goods value is at
or above `procurement.approvalThresholdMinor` becomes `Pending approval` and an
admin must decide it; below the threshold it is approved automatically. An
**admin's** order is approved on submit (nobody approves their own request).

Statuses: `Draft → Pending approval → Approved → Sent → Partially received →
Received → Closed`, with `Rejected`/`Cancelled` as terminal branches.

### 9.3 Receive the goods

Open the order → **Receive**. Enter the quantity received per line. More than
ordered requires a reason. If the delivery is partial, the order becomes
`Partially received`; receive again later. The receipt creates `GRN-…` and stock
movements at the received cost.

If the supplier invoice number is known, enter it; it helps matching later.

### 9.4 Record the supplier invoice

**Suppliers → Invoices → New supplier invoice**. Link the goods receipt or the
purchase order where possible.

| Field | Notes |
|---|---|
| Supplier | Required |
| Supplier invoice number | The supplier's number |
| Invoice date / Due date | Drives ageing |
| Tax treatment | Inclusive or exclusive |
| VAT / NHIL / GETFund | Amounts as printed by the supplier |
| Lines | Product, quantity, unit cost |

The invoice can be matched to a receipt/order; **Reconciliation** shows what is
matched, unmatched and disputed.

### 9.5 Pay the supplier

**Suppliers → Payments → Record supplier payment**: supplier, branch, amount,
paid-at date, method (`Cash`, `Bank transfer`, `Mobile money`), reference, and
allocations against open invoices. Non-cash methods need an active payment
detail and a reference.

Voiding a payment is a compensating action with a reason; it never deletes the
row.

### 9.6 Return goods to the supplier

On the order → **Return goods**. Choose the goods receipt, the lines and
quantities, a required reason, and optionally the supplier credit note number.
Posting creates a supplier return and reverses the stock movement. A return is
not an edit to the receipt.

### 9.7 Reconcile

**Suppliers → Reconciliation** separates:

- **Manual** — recorded by hand, not tied to a Paystack transfer.
- **Settled** — a transfer that moved money.
- **Unposted** — money moved but the payment is not yet posted.

Investigate every unposted row before closing the month.

### 9.8 Supplier transfers (Paystack)

With `flag.supplierTransfers` on and a Paystack mode that can move money:

**Suppliers → Transfers → Send a supplier transfer**: supplier, branch, amount,
Paystack balance, **Pay to** (an active bank/MoMo detail), allocations, note.
The transfer requires an OTP confirmation. Status runs `Pending → Success`,
with `Failed`, `Reversed`, `Blocked`, `Rejected` as terminal states.

The supplier detail shows whether the recipient exists at the provider before
money moves.

**Verify:** the order reaches `Received`, the invoice appears in
**Payables → Aging**, the payment allocation reduces the invoice balance, and
**Reconciliation** shows the row in the right bucket.

## 10. The first POS day

### 10.1 Before opening the doors

- The terminal is enrolled (§3.4).
- The cashier has a temporary PIN (§4.3) and the manager is present for the
  first PIN change.
- The branch has products, prices and opening stock (§5, §7).
- A shift can be opened with a realistic float.

### 10.2 Sign in and choose a PIN

1. The POS shows **Terminal sign-in**.
2. Select the staff member (or enter staff ID/email).
3. Enter the temporary PIN.
4. On first use the till asks the cashier to **choose your own PIN** (4–6
   digits, not repeated or sequential).
5. A manager override is required for actions above the cashier's authority,
   such as a discount beyond the cashier ceiling or a refund. The override is
   PIN-authorized, reason-coded and audited.

### 10.3 Open the shift

**Shift → Open shift** → enter the **opening float** (cash counted in the
drawer). The shift row is created on the terminal and syncs. If
`pos.salesRequireOpenShift` is on, no sale is possible until this is done.

### 10.4 Sell

On **Sell**:

1. Scan a barcode or search by name/SKU.
2. Optionally attach a customer (phone/name) for credit or loyalty.
3. Adjust quantity; apply a line or sale discount within the allowed ceiling.
4. **Hold** a cart to serve someone else; recall it from the holds tray. Recalled
   prices are re-checked and differences are shown.
5. **Void** a cart or a held cart with a reason; a void is recorded, not deleted.
6. **Tender** and choose a method:

| Method | Works offline? | Notes |
|---|---|---|
| Cash | Yes | Change is calculated; drawer kicks after commit |
| Credit | Yes | Needs a customer, a credit profile, and headroom |
| MoMo | No | Electronic; needs the API/provider |
| Card | No | Electronic |
| Bank transfer | No | Electronic |

Split tenders are allowed, with one credit tender at most. Credit cannot exceed
the sale total. An over-limit credit sale is **still recorded** at the till and
raised as a sync conflict for manager review; never block a sale at the till.

7. Complete the sale. A receipt number is allocated locally in the form
   `TERMINAL-YYYYMMDD-NNNN`. Printing failure never rolls back the sale; retry
   from the receipt.

### 10.5 Refunds

**Refund** (manager PIN):

1. Find the sale by receipt number or customer phone.
2. Choose the lines and quantities to return.
3. Choose restock: **Resalable** (returns to stock), **Damaged** (requires a
   reason), **Not returned** (no stock movement).
4. Choose a reason: customer changed their mind, wrong item, defective, price
   dispute, duplicate sale, other.
5. Choose the money-back tender(s). A refund is a new document.
6. A gross refund at or above `pos.refundApprovalThresholdMinor` raises an
   approval for an admin.

### 10.6 Repayments

**Repayment**: find the customer by name/phone, enter the amount, choose
`Cash`, `MoMo` or `Bank`, and add the transaction reference for non-cash. The
repayment reduces the credit balance and gets a `REP-…` receipt.

### 10.7 Close the shift

**Shift → Close shift**:

1. Resolve or explicitly leave held carts; the close asks.
2. Enter the **counted cash**.
3. The till shows expected cash and the variance.
4. Close. The server recomputes expected cash when the shift syncs; a variance
   over `pos.shiftVarianceToleranceMinor` raises a **shift review**.
5. Print the **Z report**. **Print again** is safe; it never re-closes the shift.

Expected cash is opening float + cash sales − cash refunds + cash in − cash out.
Cash refunds must be included, or the drawer closes short by exactly the refund.

### 10.8 Sync, outbox and conflicts

The header badge and **Sync** screen show pending work, the last successful
upload, the outbox and cached conflicts.

- PowerSync is **download-only**; every write goes through the durable outbox.
- Uploads are FIFO, one server transaction per item, with idempotency keys.
- A rejected transaction is dead-lettered without blocking later rows.
- Cash and credit work with the network unplugged. Electronic tenders require
  connectivity.
- Conflicts (oversell, over-limit credit, loyalty double-spend, override
  revalidation) are **applied and recorded** for manager review; they never
  block the sale. Resolve them in the admin console (§14.4).

**Verify:** the sale appears in **POS oversight → Sales**, the shift in
**Shifts**, the receipt reprints, and the sync badge returns to zero pending.

---

## 11. Inventory operations

### 11.1 Adjust stock

**Inventory → Stock → Adjust**: product, direction (increase/decrease),
quantity, reason and note. An adjustment is a movement, not an edit. Use it for
count corrections, damage found outside a write-off, or data fixes.

### 11.2 Transfers

**Inventory → Transfers**. A transfer moves stock between branches:

`Draft → Awaiting approval → Approved → Dispatched → Received`, or
`Short closed` / `Cancelled`.

- The source branch dispatches; stock leaves its projection.
- The destination branch receives; stock enters its projection.
- A short close records the missing quantity instead of forcing a full receipt.

### 11.3 Counts

**Inventory → Counts → New count**: branch, optional category filter, note.
The count opens with the current expected quantity per line. Enter counted
quantities and **Post count**.

- Variance = counted − expected, valued at cost.
- A variance above the tolerance raises a trigger count.
- A posted count is closed; corrections are new movements, not edits.

### 11.4 Write-offs

**Inventory → Write-offs → New write-off**: branch-month serial, lines with
product, quantity and reason (`Damage`, `Expiry`, `Obsolescence`, `Theft`,
`Supplier fault`, `Other`), note. The write-off is `Pending approval` until an
admin decides it. Approval posts the stock movement; rejection leaves stock
untouched.

### 11.5 Reports and exports

**Inventory → Stock** shows quantity, value at cost, threshold and ABC class.
The stock report prints the period the API resolved and stamps the branch. A
report too large to display refuses to export rather than exporting a truncated
total.

**Verify:** the stock movement history for the product shows every receipt,
transfer, count, write-off and adjustment in order.

---

## 12. Payments

### 12.1 Modes

`PAYSTACK_MODE` selects the provider:

| Mode | Behaviour |
|---|---|
| `mock` | Charges nothing, needs no credentials. Use for development and training. |
| `test` | Real Paystack test keys. Real API, test money. |
| `live` | Real money. Refuses to boot without live keys and outside production. |

`test` and `live` refuse to boot without `PAYSTACK_SECRET_KEY`; `live` also
requires `PAYSTACK_WEBHOOK_SECRET` and a real `PAYSTACK_EMAIL_DOMAIN`.

### 12.2 The POS electronic tender

MoMo, card and bank transfer require connectivity. The till creates a payment
intent, the provider confirms, and the result is recorded as a `payment` and
`payment_event`. The sale is not complete on a pending electronic payment; the
till waits for the provider result.

### 12.3 Refunds to electronic tenders

A refund can return money to the original electronic tender. The refund tender
status is `Pending`, `Settled`, `Failed` or `Needs attention`. A failed
electronic refund is retried by the job queue; it is visible in
**POS oversight → Refunds**.

### 12.4 Supplier payments and transfers

- **Manual** — record cash/bank/MoMo paid outside Paystack (§9.5).
- **Transfer** — Paystack moves the money and requires OTP (§9.8).

Both appear in **Suppliers → Reconciliation**. A manual payment is not
automatically "settled"; a transfer is settled only when Paystack reports
success.

### 12.5 Webhooks

The API exposes a Paystack webhook. In test/live, point Paystack at
`/api/payments/webhook/paystack` and set `PAYSTACK_WEBHOOK_SECRET`. The webhook is
idempotent: replaying it does not double-post a payment.

### 12.6 Before live money

1. Switch to `test` and run a real card/MoMo charge and refund.
2. Confirm the webhook reaches staging/production and is verified.
3. Confirm the settlement bank account and Paystack balance.
4. Turn on `flag.supplierTransfers` only when transfers are funded.
5. Move to `live` in production with the live keys, then repeat one small
   charge and refund.

**Verify:** **Suppliers → Reconciliation** has no unexplained `Unposted` rows,
and every electronic refund tender is `Settled` or deliberately `Needs
attention`.

---

## 13. E-VAT

### 13.1 What is required

The receipt contract is already implemented. Actual GRA submission needs:

- `tax.sellerTin` and `tax.sellerVatNumber` in **Settings → Tax**.
- `EVAT_PROVIDER=gra`, `EVAT_BASE_URL`, `EVAT_SECURITY_KEY`.
- `flag.evatSubmission` on.

Until GRA onboarding completes, keep `EVAT_PROVIDER=mock`. The mock certifies
deterministically and needs no credentials, so the whole flow can be rehearsed.

### 13.2 How a submission is created

Sales and refunds that carry tax are queued for E-VAT. The database is the
queue; a pg-boss job is the doorbell. A submission moves through:

`Queued → Waiting for invoice → Submitting → Certified`

with `Retry` for a transient failure and `Attention` when a human must act.
The 24-hour stamping deadline is real; a late submission is a compliance
problem, not a UI state.

### 13.3 Operate the queue

**E-VAT** lists submissions with status, document kind, branch and period.
Open a row to see the payload, the provider response and the deadline. An admin
can **Retry** an `Attention` row; the retry uses the configured backoff
(`1, 2, 5, 15, 60, 240, 720` minutes).

If the seller TIN/VAT is blank, the service refuses to submit and reports
`tax.sellerTin`/`tax.sellerVatNumber` as the missing prerequisite. It does not
send a blank identity to GRA.

**Verify:** with `EVAT_PROVIDER=mock`, complete a taxable sale and watch the
submission reach `Certified`. Then switch the flag off until GRA credentials
exist.

---

## 14. Oversight: dashboard, analytics, audit, approvals

### 14.1 Dashboard

**Dashboard** answers "today at this branch": revenue (ex-tax), gross margin,
credit outstanding, stock value at cost, take and tax by period, and how the
money arrived (cash, credit, MoMo, card, bank). Every figure is a server
aggregate over the ledgers.

### 14.2 Analytics

**Analytics** has seven tabs, all branch- and period-scoped, with the view in the
URL so it can be shared:

| Tab | Answers |
|---|---|
| Sales | Take, tax, margin, sales count over time |
| Products | Best sellers, slow movers, margin by product |
| Inventory | Stock value, movement, ABC, cover |
| Credit | Outstanding, ageing, over-limit |
| Loyalty | Points issued, redeemed, liability |
| Payables | Owed, ageing, supplier concentration |
| Tax | Output tax by period, ready for filing |

### 14.3 Approvals

**Approvals** is the inbox. Types that can appear:

- `PURCHASE_ORDER` — goods value at or above the threshold (admin).
- `PRICE_CHANGE` — a move beyond the manager band (admin).
- `CREDIT_LIMIT_CHANGE` — a limit increase requested by a manager (admin).
- `REFUND` — gross refund at or above the threshold (admin).
- `STOCK_WRITE_OFF` — a write-off (admin).
- `SHIFT_VARIANCE_REVIEW` — a close outside tolerance (manager).

Each row stores the authority that must decide it. A rejection needs a reason
code: `Over threshold`, `Price too high`, `Out of policy`, `Incomplete`,
`Duplicate`, `Other`. Decide with the reason; "no" without a reason is not
accepted.

### 14.4 POS oversight and conflicts

**POS oversight** has four tabs:

| Tab | Shows |
|---|---|
| Sales | Every sale, its lines, tenders and receipt |
| Refunds | Refund documents and their tender status |
| Shifts | Open/closed shifts, expected vs counted cash, review status |
| Conflicts | Oversell, over-limit credit, loyalty double-spend, override revalidation |

Conflicts are applied and queued, never used to block a sale. A manager resolves
or dismisses each one with a note. The queue is hidden when
`flag.posConflictResolution` is off.

### 14.5 Branch operations

**Branch operations** is the manager's queue: pending approvals, shift reviews,
trigger counts, over-limit credit, low stock, stale transfers. Each card links
to the exact filtered list it counted.

### 14.6 Audit log

**Audit log** records every privileged action with actor, action, entity, before
and after. It exports the trail, never payload secrets. Use it to answer "who
changed this price/limit/PIN/flag?".

**Verify:** perform one action of each kind (a price change, a limit increase, a
refund, a write-off) and find each in **Approvals** and **Audit log**.

## 15. Reset, reseed and repeat

### 15.1 Inspect before destroying

`db:truncate` prints the target host/database (never the password) and supports a
dry run that changes nothing:

```bash
bun run db:truncate --dry-run
```

It lists every table and its row count. Use it to confirm you are pointed at the
local database, not staging.

### 15.2 Full wipe

```bash
bun run db:truncate --yes
bun run seed:admin
```

What survives:

- the schema and every migration (`drizzle.__drizzle_migrations`);
- pg-boss's schema version (job payloads are kept unless `--with-jobs`).

What is removed: users, sessions, devices, enrolments, branches, terminals,
staff, catalog, suppliers, customers, credit, loyalty, stock, sales, shifts,
refunds, approvals, audit, settings and all ledgers.

Safety rails:

| Rail | Behaviour |
|---|---|
| `NODE_ENV=production` | Refused unconditionally |
| Non-local `DATABASE_URL` | Refused unless `--allow-remote` |
| Missing `--yes` | Refused (a dry run does not need it) |
| `--with-jobs` | Also clears pg-boss job payloads; keeps its version |

After a wipe:

1. Restart the API and PowerSync; they hold pooled connections.
2. Re-enrol every terminal (§3.4); device tokens are gone.
3. Clear the POS local database **before** it syncs. A terminal holding local
   sales would otherwise upload them to an empty server. Re-enrolment plus a
   local reset is the clean path.
4. Run `bun run seed:admin`, then rebuild the data from §2 onward.

### 15.3 The demo dataset

For development, training or a walkthrough, the demo seed creates a realistic
two-branch business in one command:

```bash
bun run db:seed -- --demo
```

It creates:

- branches `ACC-SPX` (retail, Spintex) and `ACC-WH1` (warehouse);
- terminal `ACC-SPX-T01` Counter 1;
- a manager (`manager@sceptre.local`) and cashier (`cashier@sceptre.local`);
- units, brands, categories, products, barcodes and a branch price override;
- opening stock, a supplier and supplier products, a purchase invoice/payment;
- customers, credit and loyalty data, settings, a shift and demo sales.

The demo emails/passwords come from `DEMO_MANAGER_EMAIL` and `DEMO_PASSWORD`.
The seed refuses to run when `NODE_ENV=production`.

Use `bun run seed:admin` (not the demo seed) for a clean, real setup.

### 15.4 Test database

```bash
docker compose up -d
bun run db:test:prepare
bun run test
```

`db:test:prepare` creates/migrates `sceptre_drive_test`. Tests share that
database and run serially, so do not point a destructive script at it while a
test suite is running.

### 15.5 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `seed:admin` says `ADMIN_PASSWORD must be at least 12 characters` | Short or blank password | Set a longer `ADMIN_PASSWORD` or pass `--password` |
| `db:truncate` refuses `non-local database` | Copied a staging/production URL | Use the local URL, or `--allow-remote` deliberately |
| `db:truncate` refuses `NODE_ENV=production` | Production shell | Never run it there; use a backup/restore path |
| Terminal says `enrol this terminal` | Device token revoked or wiped | Generate a new enrollment code |
| Cashier cannot sign in | No PIN, wrong PIN, or lockout | Manager resets PIN; wait out the lockout |
| No sales possible | No open shift | Open a shift with a float |
| Product missing at the till | Not synced yet | Sync; check the terminal's branch |
| Credit sale refused | No profile, hold, or no headroom | Set terms; use an authorized override; it records a conflict |
| Receipt prints nothing | Printer transport/offline | Fix printer; retry print; the sale is safe |
| E-VAT row stuck `Attention` | Missing TIN/VAT or provider issue | Fill seller identity; retry as admin |
| Analytics empty | No sales in the period/branch | Check the period, branch and tab |
| Staff cannot see a branch | Manager is scoped to one branch | Admin must switch branch or change the account |

---

## 16. Go-live data checklist

Run this list the day before real trading.

### Identity and access

- [ ] Every admin has TOTP enabled; `auth.requireTwoFactor` is on.
- [ ] The seeded admin password is changed, or the account is disabled after a
      named admin exists.
- [ ] One manager per retail branch; every cashier has a branch.
- [ ] Every leaver is deactivated, not deleted.
- [ ] Staff ID prefix and next number are correct.

### Network and stock

- [ ] Every warehouse and retail branch exists with stable codes.
- [ ] Every retail till has a terminal and is enrolled.
- [ ] Opening stock is received and counted; variances are posted.
- [ ] Reorder points and minimum order quantities are set.
- [ ] A test transfer from warehouse to retail reaches `Received`.

### Money and tax

- [ ] `pricing.taxMode` matches how prices are quoted.
- [ ] VAT/NHIL/GETFund treatment is confirmed on a test invoice.
- [ ] Shift variance, refund and purchase approval thresholds are agreed.
- [ ] Loyalty earn/redeem values are agreed and tested.
- [ ] Credit limits and terms exist for every credit customer.
- [ ] Supplier payment details are active and correct.

### Payments and compliance

- [ ] Paystack mode is `live` in production, with live keys and a verified
      webhook.
- [ ] One small live charge and refund succeeded.
- [ ] Supplier transfers are funded before the flag is turned on.
- [ ] Seller TIN/VAT are filled if GRA has issued them.
- [ ] E-VAT provider is `mock` until GRA onboarding is complete.
- [ ] Backups run and a restore has been rehearsed (Phase 15).

### The first day

- [ ] Open a shift with a real float.
- [ ] Sell one cash sale, one credit sale and one electronic sale.
- [ ] Print a receipt and kick the drawer.
- [ ] Refund one sale and confirm stock/money treatment.
- [ ] Close the shift, print the Z, and check the variance.
- [ ] Unplug the network, make a cash sale, reconnect, and confirm sync.
- [ ] Find every one of those actions in the console.

---

## Appendix A — Dependency checklist

Use this as a quick "what must exist before I create X" table.

| I want to create… | It needs first… |
|---|---|
| Terminal | An active retail branch |
| Manager | A branch |
| Cashier | A branch |
| PIN | A staff account |
| Product | A category and a unit (brand optional) |
| Barcode | A product |
| Branch price override | A product and a branch |
| Supplier product link | A supplier and a product |
| Goods receipt | A branch, products, and optionally a supplier |
| Stock transfer | Two branches and products |
| Stock count | A branch and products |
| Write-off | A branch, products and a manager |
| Credit profile | A customer and a branch |
| Credit charge | A credit profile |
| Loyalty account | A customer |
| Purchase order | A supplier, a branch and products |
| Supplier invoice | A supplier; a receipt/order improves matching |
| Supplier payment | A supplier, an open invoice and an active payment detail |
| Supplier transfer | A supplier, an active payment detail, and Paystack |
| Sale | An open shift, products and (for credit) a credit profile |
| Refund | A completed sale and a manager PIN |
| E-VAT submission | A taxable sale/refund, seller TIN/VAT, and the flag |

---

## Appendix B — Roles at a glance

| Capability | Admin | Manager | Cashier |
|---|---|---|---|
| All branches | yes | no (one branch) | no (one branch) |
| Branches create/deactivate | yes | no | no |
| Terminals create/revoke | yes | yes (own branch) | no |
| Staff create/update | yes | yes (own branch) | no |
| Staff PIN reset | yes | yes (own branch) | no |
| Catalog read | yes | yes | POS catalog |
| Catalog create | yes | submit for approval | no |
| Price override within band | yes | yes | no |
| Inventory receive/adjust/transfer/count | yes | yes | no |
| Write-off request | yes | yes | no |
| Write-off approval | yes | no | no |
| Supplier/payables | yes | yes | no |
| Procurement | yes | yes | no |
| Credit profile / repayment / adjust | yes | yes | no |
| Credit limit increase | direct | request only | no |
| Refund | yes | yes | needs manager PIN |
| Discount | yes | within manager ceiling | within cashier ceiling |
| POS oversight | yes | own branch | no |
| Conflict resolve | yes | own branch | no |
| E-VAT read | yes | yes | no |
| E-VAT retry | yes | no | no |
| Settings read/update | yes | own branch (branch-scoped) | no |
| Audit read | yes | own branch | no |

The API is authoritative; the console merely hides what a role cannot use.

---

## Appendix C — Status vocabularies

| Document | Statuses |
|---|---|
| Stock transfer | `Draft`, `Awaiting approval`, `Approved`, `Rejected`, `Dispatched`, `Received`, `Short closed`, `Cancelled` |
| Stock count | `Open`, `Posted`, `Cancelled` |
| Write-off | `Pending approval`, `Approved`, `Rejected`, `Cancelled` |
| Purchase order | `Draft`, `Pending approval`, `Approved`, `Rejected`, `Sent`, `Partially received`, `Received`, `Closed`, `Cancelled` |
| Supplier return | `Draft`, `Posted`, `Cancelled` |
| Supplier transfer | `Pending`, `Success`, `Failed`, `Reversed`, `Blocked`, `Rejected` |
| E-VAT submission | `Queued`, `Waiting for invoice`, `Submitting`, `Certified`, `Retry`, `Attention` |
| Refund tender | `Pending`, `Settled`, `Failed`, `Needs attention` |
| Shift | `Open`, `Closed`; review `None`, `Required`, `Reviewed` |
| Sync conflict | `Open`, `Resolved`, `Dismissed` |

---

## Appendix D — Settings quick reference

| Group | Keys |
|---|---|
| Pricing | `pricing.taxMode`, `pricing.managerBandPercent` |
| Point of sale | `pos.maxCashierDiscountPercent`, `pos.maxManagerDiscountPercent`, `pos.pinMaxAttempts`, `pos.pinLockMinutes`, `pos.clockSkewToleranceMinutes`, `pos.syncBatchSize`, `pos.receiptFooter`, `pos.salesRequireOpenShift`, `pos.shiftVarianceToleranceMinor`, `pos.refundApprovalThresholdMinor` |
| Credit | `credit.repaymentPrefix`, `credit.repaymentSequence` |
| Loyalty | `loyalty.earnPointsPerCedi`, `loyalty.pointsPerCedi`, `loyalty.expiryMonths`, `loyalty.minimumRedeemPoints` |
| Inventory | `inventory.receiptPrefix`, `inventory.receiptSequence`, `inventory.transferPrefix`, `inventory.transferSequence`, `inventory.countPrefix`, `inventory.countSequence`, `inventory.countVarianceToleranceMinor`, `inventory.writeOffPrefix`, `inventory.abcAThresholdBp`, `inventory.abcBThresholdBp` |
| Procurement | `procurement.approvalThresholdMinor`, `procurement.safetyDays`, `procurement.defaultLeadDays`, `procurement.orderPrefix`, `procurement.returnPrefix`, `procurement.creditNotePrefix` |
| Suppliers | `supplier.codePrefix`, `supplier.codeSequence` |
| Payables | `payable.invoicePrefix`, `payable.invoiceSequence`, `payable.paymentPrefix`, `payable.paymentSequence` |
| Tax | `tax.sellerTin`, `tax.sellerVatNumber` |
| Feature flags | `flag.supplierTransfers`, `flag.evatSubmission`, `flag.posConflictResolution` |
| Access | `auth.requireTwoFactor` |
| Staff | `staff.idPrefix`, `staff.idSequence` |
| Receipts | `receipt.header` |
| Catalog | `catalog.skuPrefix`, `catalog.skuSequence` |

Money keys end in `Minor` and are entered in **cedis** in the console; they are
stored as whole pesewas. Percentage keys are whole percent. Basis-point keys use
`1 bp = 0.01%`. CSV exports keep raw pesewas so a spreadsheet can total exactly.

---

## Appendix E — Rules that must never be broken

1. **Server is authoritative.** Money, tax, credit, loyalty, stock projections
   and permissions are decided server-side. Do not "fix" a value in the client.
2. **Integer money.** Every amount is integer pesewas. No floats, ever.
3. **Append-only ledgers.** Stock movements, credit and loyalty ledgers are
   append-only. Correct with a compensating entry, not an edit or delete.
4. **A sale is never blocked at the till.** Oversell, over-limit credit and
   loyalty double-spend are applied and recorded as conflicts for review.
5. **Every POS mutation has an idempotency key.** Replaying an upload must not
   double-sell.
6. **Manager overrides are PIN-authorized, reason-coded, audited, and
   revalidated on sync.**
7. **One cashier per terminal per shift.** Offline PIN login is device-bound.
8. **No secrets in the repository, logs, receipts or audit payloads.**
9. **A correction is a new document.** Refunds, returns, voids and reversals
   refer to the original; they do not erase it.
10. **Stop and ask** when a change affects money, credit, stock, loyalty,
    permissions or production infrastructure.

