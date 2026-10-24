---
phase: 15-production-hardening
name: Production Hardening & Launch
depends_on: [01-foundation, 02-catalog-pricing, 03-inventory-transfers, 04-customers-credit, 05-suppliers-payables, 06-pos-offline-core, 07-identity-design-system, 08-admin-modules-shell, 09-analytics-dashboard, 10-desktop-pos-redesign, 11-procurement-replenishment, 12-branch-ops-approvals, 13-pos-payments-returns, 14-admin-operations-evatu]
requirements: [OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, OPS-08]
status: context-deferred
created: 2026-10-24
---

# Phase 15 — Production Hardening & Launch — Context Deferred

**Status: context deferred, deliberately.** This phase is infrastructure and launch, and most
of its decisions are operator inputs that do not exist yet. Writing a full locked context now
would be invention that the plan would later contradict.

## Why deferred

Every other phase was locked because its decisions affect money, stock, credit, or the till.
This phase's decisions affect **where the system runs and who can recover it**, and they are
all external:

| Input needed | Why it blocks |
|---|---|
| The real domain | `SCEPTRE_DOMAIN` is a placeholder (Phase 7 D4). TLS, CORS, PowerSync origins, and the desktop's allowed connect origins all derive from it |
| VPS provider, region, and size | Determines whether the staging and production stacks coexist on one host, and the resource limits in `compose.yaml` |
| RPO and RTO targets | Set the backup frequency, retention, and whether the restore drill is hourly or daily |
| Backup retention and storage | Cloudflare R2 is the stated choice; the retention policy and encryption-key custody are not decided |
| Windows code-signing certificate | Whether v1 ships signed installers or documents an unsigned-install warning |
| PowerSync Cloud instances | Staging and production instances, and the static-IP allowlist, are account setup, not code |
| Monitoring provider | Uptime, error tracking, and alerting destination |
| UAT participants and the go-live date | The sign-off gate |

## What is already decided (from earlier phases, do not re-litigate)

- Caddy on a single Ubuntu VPS, staging and production stacks, images to GHCR, SSH deploy.
- PostgreSQL 17 in Docker on the VPS; development and CI use the self-hosted PowerSync
  service, staging and production use PowerSync Cloud with the same `sync-config.yaml`.
- Encrypted `pg_dump` backups to Cloudflare R2 with a documented restore drill.
- GitHub Actions: staging auto-deploy, production behind an approval gate, migrations before
  deploy, health-checked rollout, rollback to the previous tag.
- The desktop CSP stays as strict as Phase 6 built it; no origin is added for convenience.
- OWASP ASVS L2 as the review bar; dependency and secret scans in CI.

## Known blockers to record when the context is written

1. Replace `SCEPTRE_DOMAIN` and update the CSP tests, `.env.example`, and the PowerSync config
   in one commit.
2. Re-enrolment: the Phase 7 rename invalidated device tokens and moved the Electron
   data directory. Any terminal enrolled before Phase 7 must be re-enrolled before launch.
3. PowerSync Cloud project, two instances, signing keys (asymmetric, never HS256), and the
   static-IP allowlist.
4. Branch count and terminal count for the load test — the target was five branches and
   twenty terminals.
5. Ghana DPA documentation: device loss and wipe procedure, retention policy for customer
   identity stored on encrypted POS disks.

## Planned Plans (outline only)

1. Staging stack: compose, Caddy, TLS, environment separation, health checks.
2. Production stack: approval gate, migrations, rollout, rollback, resource limits.
3. Backups: encrypted dumps to R2, retention, restore script, and a drill with recorded
   RPO/RTO.
4. Monitoring and alerting.
5. Security hardening: ASVS L2 review, dependency and secret scans, rate limits, headers.
6. Offline drill suite at scale, load test, and E2E in CI.
7. Windows installer signing and auto-update.
8. Runbooks, UAT, and the go-live checklist.

## How to unblock

Bring the eight inputs above to a planning session. The context then becomes a normal locked
document and the plans can be written. Until then, nothing in Phases 1–14 depends on a Phase
15 decision — except the domain swap, which is a one-line change centralised in Phase 7.
