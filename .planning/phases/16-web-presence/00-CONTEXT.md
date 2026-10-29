---
phase: 16-web-presence
name: Web Presence & Console-Managed Site Content
depends_on: [01-foundation, 14-admin-operations-evatu]
requirements: [WEB-01, WEB-02, WEB-03, WEB-04, WEB-05, WEB-06, WEB-07, WEB-08, WEB-09, WEB-10, WEB-11, WEB-12]
status: context-locked
created: 2026-10-29
---

# Phase 16 — Web Presence & Console-Managed Site Content

**Goal:** Sceptre Drive has a fast, accessible public website that tells a car owner or a
workshop what the business sells and how to reach a branch — and every word, link, status
and branch detail on that site is edited in the existing admin console, not in code. The
site is the seam for the future store, not the store itself.

**Post-v1, additive.** This phase does not change the v1 milestone definition. It is
sequenced after Phase 14 because it reads the settings registry and the branch master that
Phase 14 finished, and it is independent of Phase 15's deployment inputs.

## Problem

Sceptre Drive's only public surface today is a POS receipt. The business is a multi-branch
automotive spare-parts retailer in Ghana; a customer cannot find the counter, a workshop
cannot ask for a part, and an operator cannot correct a phone number without a developer.
The alternative — a static brochure with copy in JSX — guarantees that the site and the
business disagree within a month.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| P16-D1 | Where the site lives | A new `web/` workspace in this repository, not a separate repo | One lockfile, one CI, one brand package; the future store can call the Hono API without cross-repo plumbing |
| P16-D2 | Stack | TanStack Start + Vite + Nitro + Tailwind v4, versions pinned to `admin` | Same framework as the console, SSR for SEO, no second toolchain; one React and one TanStack version in the lockfile |
| P16-D3 | Where content is edited | The existing **Admin → Settings** page gains a `Website` group; no new console page | The settings page already renders every key the API defines with audit, branch overrides and scope rules. A second write path would drift |
| P16-D4 | Content namespace | `web.*` in `SETTING_DEFINITIONS`, with defaults so the site works before anyone edits | Server-authoritative, audited by `setting.updated`, validated by Zod at the edge |
| P16-D5 | Branch contact | Existing `branch.address` / `branch.phone`; new branch-scoped `web.branchHours` and `web.branchMapUrl` (admin-only) | Address and phone already exist and are edited on the branch form; hours and a map link are genuinely missing |
| P16-D6 | Public read | New read-only module `api/src/modules/site/` exposing `GET /api/public/site` | The web app must not hold a session; the endpoint returns a whitelisted projection, never the settings table |
| P16-D7 | Delivery | SSR fetch with a short cache (5 s dev, 60 s prod) and a bundled typed fallback | Edits appear without a redeploy; an API outage cannot blank the marketing site |
| P16-D8 | What is configurable | Identity, hero/about copy, announcement, shop status, contact email/phone/WhatsApp, social links, branch hours/map | Text and links only. Image uploads need object storage and a media pipeline — a later phase |
| P16-D9 | Photography | A small licensed stock set downloaded into `web/public`, credited, swappable | No empty design and no unlicensed hotlinking; the operator can replace files without code changes |
| P16-D10 | Logo | One transparent master in `packages/brand/assets`, copied to each app by a script; an inverse variant for charcoal surfaces | The supplied artwork has a black wordmark that disappears on the POS fascia; one master keeps three apps honest |
| P16-D11 | Commerce boundary | No cart, checkout, payments, accounts, prices or stock on the site; `/shop` is a coming-soon teaser | The store is a future phase; a fake shop is worse than an honest teaser |
| P16-D12 | Design direction | "The Counter Ticket" — charcoal, paper, one orange accent, mono part data, a ticket artifact, one orchestrated load | Grounded in the business's physical counter, not a generic automotive template |
| P16-D13 | Accessibility | WCAG 2.2 AA: skip link, landmarks, 44 px targets, visible focus, AA contrast, reduced motion | The brand tokens already carry the measured contrast; the site must not weaken them |
| P16-D14 | Privacy | The public payload carries business content only — no customer data, no staff data, no internal flags | OWASP A01/A02; a marketing endpoint is an unauthenticated surface |
| P16-D15 | Verification | Real browser legs, a settings round-trip, an API-down fallback, SEO/a11y evidence, all gates | Goal-backward: the phase is done when an operator edit reaches the site and nothing regresses |

## Invariants

- The site never depends on the API being reachable; the fallback is always valid content.
- An admin edit is audited and appears without a rebuild.
- The public endpoint returns only the whitelist; no `source`, no key names, no PII.
- Branch address/phone have one owner (the branch master); the site does not duplicate them.
- One React, one TanStack version in the lockfile.
- No brand hex outside `packages/brand`; `tokens:check` covers `web` too.
- No claim the operator has not made: no invented statistics, no implied distributorship.

## Open Items

- Real branch details (address, hours, phone, WhatsApp) are placeholders marked in one data
  file until the operator supplies them; the console is the long-term source.
- The original vector logo, if it exists, would sharpen the assets; the raster is used up to
  header sizes only.
- Image uploads, product data, stock, prices and checkout belong to a future store phase.
- Deployment of `web` (Caddy/Nitro) belongs to Phase 15's infra work.

## Planned Plans

1. Brand assets: transparent logo, inverse, icon; sync script; admin and desktop wiring.
2. Shared contract, `web.*` settings and the public site endpoint.
3. Console: the Website settings group and the long-copy control.
4. The `web/` workspace and the marketing site.
5. Verification, evidence and state update.
