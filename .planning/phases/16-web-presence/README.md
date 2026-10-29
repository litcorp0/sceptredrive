# Phase 16 — Web Presence & Console-Managed Site Content

Four plans plus a verification pass. Plans are prompts: execute one at a time, commit
atomically, verify before moving on. `00-CONTEXT.md` is the locked frame;
`00-DECISIONS.md` refines it and **wins where the two disagree**. `01-RESEARCH.md` is the
source list and the verified repository facts — read it once, do not repeat it.

**Post-v1 and additive.** The v1 milestone (Phases 1–15) is unchanged. This phase reads the
settings registry and branch master that Phase 14 finished, and is independent of Phase
15's deployment inputs.

**Status:** ✅ Complete and verified 2026-10-29 — see [`05-VERIFICATION.md`](./05-VERIFICATION.md).

| Plan | Title | Lane | Depends on |
|---|---|---|---|
| 01 | Brand assets — the supplied mark, three variants, three apps | shared | — |
| 02 | Shared contract, `web.*` settings and the public site endpoint | api | 01 |
| 03 | Console — the Website group and the long-copy control | admin | 02 |
| 04 | The web workspace and the Sceptre Drive site | web | 01, 02, 03 |
| 05 | Verification, evidence, state update | verification | 04 |

## Why this order

- **01 first.** The three apps need the same files; producing them once in
  `packages/brand/assets` and copying them is the only way a favicon, a login screen and a
  footer cannot disagree.
- **02 before 03 and 04.** The console renders keys the API defines, and the site consumes
  a contract the API serializes. A UI written first would invent both.
- **03 before 04.** The site's end-to-end proof is an operator edit reaching the page, so
  the editing surface must exist before the consumer is tested.
- **04 last, then 05.** The site is the only plan that can regress the other three, so it
  runs with every lane idle and the verification pass follows it.

## Lanes

| Lane | Owns | Plans |
|---|---|---|
| shared | `packages/**` | 01 |
| api | `api/**` | 02 |
| admin | `admin/**` | 03 |
| web | `web/**` | 04 |
| controller | root `package.json`, `biome.json`, `scripts/**`, `.planning/**` | the workspace wiring in 04, this file, STATE |
| verification | nothing — runs gates, read-only | 05 |

## Frozen decisions

- One React and one TanStack version in the lockfile (the dual-React incident of
  2026-10-29 is the reason).
- The public endpoint is a whitelist, never a settings dump.
- The site is valid before the first edit and after an API outage.
- No cart, checkout, account, price or stock on the site.
- No brand hex outside `packages/brand`; `tokens:check` covers `web`.
- The branch master owns address and phone; the website group owns the copy and the two
  missing branch details (hours, map).

## Verification philosophy

The phase is done when a person can prove, not assume:

1. the logo is right on light and charcoal in all three apps;
2. an admin edit in Settings → Website changes the live site without a rebuild;
3. the public endpoint carries no key name, no source, no PII and no warehouse;
4. the site renders its content with the API stopped and with JavaScript disabled;
5. keyboard, contrast and reduced-motion legs pass;
6. every repository gate is green.
