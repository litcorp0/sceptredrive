# Phase 10 — Desktop POS Modules, Chrome & Shift Home

Ten plans. Plans are prompts: execute one at a time, commit atomically, verify before moving
on. `00-CONTEXT.md` is the locked context; `00-DECISIONS.md` refines it and wins where the two
disagree.

| Plan | Title | Lane | Depends on |
|---|---|---|---|
| 01 | Shared counter maths, local schema indexes, desktop module gate | shared + controller | — |
| 02 | `modules/` scaffolding and the route → page split | pos | 01 |
| 03 | Primitives, chrome, and counter ergonomics | pos | 02 |
| 04 | Home data layer: reactive queries and pure aggregation | pos | 02 |
| 05 | Home screen, `#home`, and `dev-charts` retirement | pos | 03, 04 |
| 06 | Sell module: catalog, cart, and the counter panels | pos | 03 |
| 07 | Tender and receipt modules | pos | 03 *(after 06 in the serial order; shares no file with it)* |
| 08 | Shift, login, settings, sales, and sync modules | pos | 03 *(after 07 in the serial order; shares no file with it)* |
| 09 | Counter audit: widths, keyboard, reduced motion, offline copy | verification | 08 |
| 10 | Verification, evidence, and state update | verification | 09 |

## Why this order

- **01 is first.** Its shared part is alone: `packages/shared` is imported by both clients and the
  API, and a lane writing into it while another builds against it is the one collision this
  repository does not survive. Its gate-script and desktop-schema parts are disjoint from it and
  from each other, so those three run as wave 1.
- **02 is a move, not a redesign.** About 5,000 lines change location and none change
  behaviour. Keeping it isolated means a failing test in 02 is a mistake in the move, not an
  argument about a screen. Every later plan edits module internals; none of them edit routes.
- **03 before 04–08** because the primitives are shared by every screen. Doing one screen
  first would mean writing the same `Dialog` replacement five times.
- **04 before 05** because the home screen is the only genuinely new behaviour in the phase.
  Its queries and maths get tests before a pixel exists.
- **06, 07, and 08 share the route and barrel surface**, so the default order is sequential. They
  can run beside each other only under the directory split in the wave table below, with the
  frozen file set honoured. Nothing is gained by parallelising them loosely.
- **04 runs beside 06–08** in wave 4 because it writes only `modules/home/**` and reads one hook
  Plan 03 extracted. That is the whole of the safe parallelism in this phase.
- **05 follows 04** because it consumes the home page, and it follows 03 because it edits the
  chrome. It owns `main.tsx`, `routes/_pos/app.tsx`, and `app-header.tsx` alone.
- **09 runs when every lane is idle.** No repository-wide gate and no browser suite while a
  lane is writing.
- **10 last.** It proves the goal backwards and amends `00-CONTEXT.md` with the decisions this
  phase actually took.

## Execution shape — what may run in parallel

Seven of the ten plans write `desktop/**`, which is one lane, and `AGENTS.md` allows one writer
per lane. So this phase is **mostly serial by rule, not by convenience**. The waves below are the
only safe parallelism; anything beyond them trades a green suite for an ambiguous one.

| Wave | Work | Lanes | Why it is safe |
|---|---|---|---|
| 1 | 01a shared helpers · 01b `scripts/lib/module-rules.mjs` + root scripts · 01c desktop schema, database, migration test | shared, controller, pos | three disjoint trees; nothing in 01b or 01c imports the 01a names |
| 2 | **02 alone** | pos | moves ~5,000 lines; a second writer makes the move unreviewable |
| 3 | **03 alone** | pos | touches every screen's controls plus `components/layout` and `components/common` |
| 4 | **04 ∥ 06 ∥ 07 ∥ 08** | pos, split by directory | 04 writes only `modules/home/**`; 06 owns `modules/{sell,cart,catalog,customers,credit,loyalty}`; 07 owns `modules/{tender,receipt}`; 08 owns `modules/{shift,auth,settings,sales,sync}`. They meet only through `lib/**` and `@sceptre/shared`, which none of them edits |
| 5 | **05 alone** | pos + controller | owns `main.tsx`, `routes/_pos/app.tsx`, the two module landing lines, and `components/layout/app-header.tsx` |
| 6 | 09, then 10 | verification | read-only; needs the stack up and every lane idle |

**Frozen file set for wave 4.** `main.tsx`, `routes/_pos/app.tsx`, `routes/login.tsx`,
`routes/shift.tsx`, `components/layout/**`, `components/common/**`, `desktop/package.json`, and
`desktop/biome.json` are owned by the controller during that wave. A lane that needs one reports
`NEEDS_LANE_CHANGE`; nobody edits them in place.

**Worktrees.** Wave 1 and wave 4 lanes run in their own worktrees. Merging wave 4 is real work —
three desktop rewrites land against one history — so take it only if the ~20 % saving is worth a
careful merge. Otherwise run the plans serially; nothing in them assumes a particular execution
shape.

**Never while a lane is writing:** `bun run modules:check:strict`, `bun run test`, or any browser
suite. Wave 6 is the only place the repository-wide gates run.

## Lane ownership

| Lane | Owns | Plans |
|---|---|---|
| shared | `packages/**` | 01 (part 1) |
| pos | `desktop/**` (including `desktop/package.json` and `desktop/biome.json`) | 02–08 |
| controller | root `package.json`, `scripts/**`, `biome.json`, `.github/**`, `.planning/**`, `AGENTS.md` | 01 (part 2), 09, 10 |
| verification | nothing — runs gates, read-only | 09, 10 |

The admin and API lanes are idle for this phase. The only API file touched is
`api/src/modules/analytics/analytics.service.ts`, adopting the shared average-basket helper —
a controller-held follow-up in Plan 01, because it is one call site and it must not drift.

## Locked decisions carried from `00-CONTEXT.md`

D1 fourteen modules with the seven folders · D2 `lib/` keeps PowerSync, outbox, printing, and
the domain services · D3 hash route → module page, guards stay in `routes/_pos/app.tsx` · D4
home reads local SQLite only · D5 home content · D6 home never gates selling · D7 primitives
adopted · D8 counter ergonomics · D9 density · D10 copy · D11 Recharts with a 250 KB budget ·
D12 no behaviour change · D13 verification matrix.

Amendments taken during planning (P10-D1…D15) are in `00-DECISIONS.md`. Read it before Plan
01 — four of them change what the home screen shows.

## Repository guardrails that apply to every plan

- **The till never blocks.** Nothing in this phase may gate, delay, or interrupt a sale.
- Server stays authoritative. Phase 10 adds **no API endpoint, no migration, and no server
  rule**; the home screen computes display figures from rows the terminal already wrote. The one
  API edit is `analytics.service.ts` calling the shared average-basket helper — same behaviour,
  one less copy of a rounding rule.
- Integer minor units. No float touches money. The only division is the shared average-basket
  helper, which rounds once.
- No new synced table and no change to `powersync/sync-config.yaml`. If a plan thinks it needs
  one, it stops and asks.
- Offline is a normal state, never an error style.
- `bun run test`, not `bun test` (Bun resolves the latter to its builtin runner).
- Before declaring a plan done: `bun run lint`, `bun run check-types`, `bun run brand:check`,
  `bun run tokens:check`, `bun run modules:check`, `bun run test`. Plans 01–04 run the reporting
  form because the desktop's pending list is still non-empty; `modules:check:strict` becomes the
  required form from Plan 05, which is when the controller wires the desktop gate into it.
- Packaging needs `npm_config_user_agent="npm/11.16.0 node/v24.18.0 linux x64"` prefixed to
  `bun run --filter desktop package`; Bun exports `npm/undefined` and Forge refuses it. This is
  environmental and predates the phase.

## Definition of done for the phase

1. `desktop/src/renderer/modules/` holds every POS domain with the same seven folders; each
   route file resolves a hash route to a module page and holds no markup.
2. A cashier signs in with an open shift, lands on `#home`, reads today's take, expected cash
   in the drawer, credit given, items sold, the hourly shape, and the top five sellers, and
   starts selling with one action.
3. Every screen works with the network unplugged and the home figures are correct offline and
   after a relaunch.
4. No money rule changed: desktop suite, Electron E2E, offline walkthrough, packaged shell, and
   packaged print all still pass.
5. Offline reads as a normal state; no counter action is hover-only; every target is ≥ 44 px.
