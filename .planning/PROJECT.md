# GikAutos v1 — Project Context

**Initialized:** 2026-10-17
**Type:** Greenfield (fresh repository history; the earlier prototype was deleted)

## Vision

A multi-branch automotive spare-parts business platform for Ghana: an offline-first
Point of Sale, a branch-aware back-office console for admins and managers, and a
single server-authoritative core for stock, customers, credit, loyalty, suppliers,
payments, and reconciliation.

The business runs retail branches and warehouses (warehouses are a branch type).
Cashiers sell on Windows desktop terminals; managers run a branch; the admin
supervises the whole business.

## Core Value (the one thing that must work)

**The POS never stops selling, and stock, credit, and loyalty truth is always
reconcilable.** Cash and credit sales, receipts, shifts, and local stock movements
work with the network unplugged. Everything syncs bi-directionally and idempotently
on reconnect, without double-selling or losing a transaction.

## Locked Decisions

| Area | Decision |
|---|---|
| Clean start | Fresh git history; the previous prototype and its planning were deleted |
| API | Hono on Node 24, Zod, pino, Drizzle ORM, Better Auth, pg-boss |
| Database | PostgreSQL 17 on a VPS via Docker; Drizzle migrations |
| Admin / Manager | TanStack Start, React 19, Tailwind v4, shadcn, TanStack Query |
| Desktop POS | Electron Forge + Vite, React 19, TypeScript, Tailwind v4, shadcn |
| Offline sync | PowerSync Cloud (Free → Pro); Web SDK in the Electron renderer |
| Payments | Paystack Ghana: MoMo, card, bank transfer, refunds, supplier transfers |
| Currency | GHS; all amounts integer minor units (pesewas) |
| Tax | VAT 15% + NHIL 2.5% + GETFund 2.5% = 20% on one base; inclusive/exclusive |
| E-VAT | Compliant receipt contract now; mock provider until GRA onboarding |
| Roles | Admin (global), Manager (branch), Cashier (terminal) |
| Branch types | `RETAIL` and `WAREHOUSE`; warehouses are stock-only, no POS sales |
| Credit | Branch-local limit and balance per customer; global customer identity |
| Loyalty | Global points balance; earn and redeem at any branch |
| Loyalty rules | Configurable; defaults 1 pt per GHS 1, 100 pts = GHS 1, 12-month expiry |
| Cashier / terminal | One cashier per terminal per shift; offline PIN login is device-bound |
| Offline payments | Cash and credit offline; MoMo/card/bank require internet |
| Offline credit | Cached limit; allow within limit; over-limit needs manager PIN |
| Offline loyalty | Redeem within cached points; conflicts flagged on sync |
| Offline stock | Never block a sale; allow oversell and flag a reconciliation conflict |
| Refunds | Cash refunds offline with manager approval; electronic refunds online |
| Suppliers | Supplier invoices + payments ledger; Paystack transfers + manual fallback |
| Hardware | Windows, ESC/POS receipt printer, keyboard-wedge scanner, cash drawer |
| Deployment | One VPS, separate staging/prod Docker stacks, Caddy, GitHub Actions, R2 backups |
| Scale target | 5 branches, 20 terminals, 5k SKUs, 20k customers |
| Data import | Manual entry only in v1 |

## Constraints

- **ABSOLUTE RULE 1:** Research the current, official documentation before producing any
  command, scaffold, config, or implementation. Never hand-roll what an official
  generator, CLI, or documented pattern already provides.
- **ABSOLUTE RULE 2:** Load every relevant agent skill before planning or implementing.
  See `AGENTS.md`.
- **ABSOLUTE RULE 3:** Load and apply `owasp-security` before every planning or building
  task. Treat OWASP Top 10 / ASVS 5.0 / LLM guidance as acceptance criteria.
- Solo builder → one language (TypeScript), one toolchain, low ops burden, strong conventions.
- Must survive Ghana connectivity realities (offline POS, spotty branch links).
- Financial correctness: integer minor units, append-only stock ledger,
  server-authoritative money, credit, and loyalty.
- GRA E-VAT-ready receipts with offline generation up to 24 hours.
- Ghana Data Protection Act obligations for customer PII.
- No paid service is required to develop: Paystack, E-VAT, and PowerSync all have
  mock/test paths until credentials exist.

## Tech Stack

- **Monorepo:** Bun workspaces (single root lockfile), shared `tsconfig` base, Biome.
- **API:** Hono + `@hono/node-server` on Node 24; Drizzle ORM (`postgres` driver);
  Better Auth (email/password + TOTP); Zod validation; pino logging; pg-boss jobs.
- **Database:** PostgreSQL 17, Docker locally and on the VPS; logical replication for PowerSync.
- **Admin:** TanStack Start (Vite + Nitro), TanStack Router/Query/Table, shadcn, Tailwind v4.
- **Desktop POS:** Electron Forge + Vite plugin, React 19, TanStack Router (hash history),
  Tailwind v4, shadcn, PowerSync Web SDK (wa-sqlite), ESC/POS printing.
- **Sync:** PowerSync Cloud, Sync Streams (edition 3), branch-scoped JWT claims,
  outbox-based upload endpoint with idempotency.
- **Payments:** Paystack Ghana (charge API, webhooks, verify, refunds, transfers).
- **Infra:** Ubuntu VPS, Docker Compose, Caddy TLS, GitHub Actions, GHCR, Cloudflare R2 backups.

## Users & Roles

| Role | App | Scope |
|---|---|---|
| Admin | Admin console | Whole business; creates branches, terminals, users, settings |
| Manager | Admin console | One branch (or warehouse); full branch operations except global settings |
| Cashier | Desktop POS | One terminal per shift in one branch; sells, takes payment, handles returns |

## Scope (sub-projects → phases)

| Sub-project | Contents | Phase |
|---|---|---|
| S0 Foundation | Monorepo, API skeleton, DB, auth, RBAC, branches/terminals/staff, audit, admin shell, CI | 1 |
| S1 Catalog & Pricing | Categories, brands, UOM, products, barcodes, prices, Ghana tax | 2 |
| S2 Inventory & Transfers | Stock ledger, receive, adjust, transfer, count, low stock | 3 |
| S3 Customers, Credit & Loyalty | Global identity, branch credit, ledgers, repayments, loyalty | 4 |
| S4 Suppliers & Payables | Supplier master, invoices, payments, balances, aging | 5 |
| S5 POS Offline Core | Electron shell, enrollment, PIN, sync, shifts, cash/credit sale, receipts | 6 |
| S6 POS Payments & Returns | Paystack, split tender, returns, repayments, Z-reports | 7 |
| S7 Admin Operations & Reports | Dashboards, reports, conflicts, Paystack transfers, E-VAT adapter | 8 |
| S8 Production Hardening | VPS, TLS, backups, monitoring, security, offline drills, installer, UAT | 9 |

See `.planning/ROADMAP.md` for success criteria and `.planning/REQUIREMENTS.md`
for the requirement-to-phase mapping.

## Out of Scope (v1)

- E-commerce storefront and customer mobile app
- Delivery and rider management
- Payroll, attendance, and commissions
- Full double-entry general ledger, financial statements, period close
- AI features (advisor, forecasting, document AI, anomaly detection)
- Vehicle fitment make/model/year mapping and VIN decode (schema may add it later)
- CSV/bulk data import (manual entry only)
- Multi-company SaaS tenancy (single company; modelled so it can be added)
- Hardware card reader integration (Paystack hosted/online channels only)
- Non-Windows desktop builds
- Multiple currencies

## Assumptions

- Warehouses are stock-only branches: no POS terminals and no sales.
- Product prices are VAT-inclusive by default; a setting supports exclusive pricing.
- Customer phone numbers are unique in E.164 format (Ghana, +233).
- Loyalty points are earned on the net merchandise amount actually paid, excluding tax,
  and redeemed as a discount before tax.
- A manager override is available offline using the manager PIN cached on the terminal.
- The VPS runs Postgres with TLS and a PowerSync-only firewall allowlist.
- English-only UI in v1; GHS-only; 80mm thermal receipts; A4/PDF statements.

## Operator Setup Gates (not blocking development)

All development runs with mocks until these exist:

- VPS + domain (Phase 9)
- PowerSync Cloud account and two instances, staging + production (Phase 6)
- Paystack registered business + keys (Phase 7; `PAYSTACK_MODE=mock` until then)
- GRA E-VAT onboarding credentials (Phase 8; `EVAT_PROVIDER=mock` until then)
- Windows code-signing certificate (Phase 9; unsigned builds first)

## History

The previous prototype was removed on 2026-10-17. A git bundle of its history is
kept outside the repository at
`/tmp/opencode/gikautos-old-history.bundle` (safe to delete).
