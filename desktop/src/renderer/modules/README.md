# POS modules

Every counter screen belongs to exactly one domain module, and every hash route resolves to a
module page. This file is the contract; each rule names the thing that enforces it.

## Layout

```
modules/<domain>/
  api/         the local data source: SQL, row types (the POS has no HTTP calls here)
  components/  connected UI (may fetch)
  hooks/       useQuery wrappers over api/
  pages/       composition roots; one per hash route
  types/       types and z.infer aliases
  ui/          presentational only — never queries
  utils/       pure functions, unit-tested with vitest
  index.ts     the only entry point
```

The seven folders mirror the admin console deliberately (Phase 8's module layout). What changes is
their meaning, not their names: on the terminal the data source is the encrypted local PowerSync
database, so `api/` holds SQL rather than fetchers and `hooks/` holds `useQuery` calls.

A folder appears when it has real content. Never create an empty folder to look complete.

## Rules

**1. `ui/` never queries.** No `useQuery`, no `usePowerSync`, no `@powersync/react` import inside
`ui/`. `components/` may be connected and takes its data from `hooks/` or from the page. `pages/`
compose; a page calling `useQuery(xQuery())` is still composition, not a connected component.

*Enforced by:* review, and the counter audit in `desktop/test/e2e/counter-audit.mjs`.

**2. Cross-module imports go through the barrel.** `@/modules/<name>` is allowed;
`@/modules/<name>/components/...` is not. Inside a module, use relative imports — a module
importing itself by alias would resolve through its own barrel and invite a cycle.

*Enforced by:* `bun run modules:check:pos` (hard failure) and Biome's `noRestrictedImports`.

**3. One owning component per module.** A panel exports one component and owns its own dialogs.
`modules/customers` exports `CustomerPanel`, which renders `CustomerDialog` and
`CustomerCreateDialog` internally; `modules/loyalty` does the same with its redeem dialog. A
consumer that needs two pieces from one module is usually a sign the pieces belong together.

*Why:* Phase 8 hit this twice — a shared component living inside one module forces that module's
barrel to re-export it into a cycle. Anything genuinely shared by more than one module belongs in
`components/common/`, not inside a module.

**4. `routes/` only routes.** A route file resolves a hash route to a module page. Four files are
exempt by name and by reason (`scripts/check-desktop-modules.mjs`): `_pos/app.tsx` keeps the five
route guards because they are behaviour, and `_pos/dev-{sync,print,charts}.tsx` are diagnostics.

*Enforced by:* `bun run modules:check:pos` — a route over 25 lines, importing more than one barrel,
or rendering markup is reported (and fails under `--strict`).

**5. `lib/` is not a module.** PowerSync provider/schema/connector, the outbox, printing, the API
clients, auth sessions, and the pure domain services stay in `lib/` with their tests. They carry
the offline correctness of the system; a module imports them, it does not absorb them.

## What stays outside `modules/`

`App.tsx` (the diagnostics shell), `SpikePanel.tsx` (the Phase 6 PowerSync gate), and the four
exempt route files. None of them is a counter screen.

## Generated primitives

`components/ui/` is shadcn output, with one local edit: the registry writes
`import { cn } from "@/lib/utils"`, and this app imports `cn` from the `cn` package instead
(Phase 7 deleted `lib/utils.ts`). Rewrite that one import line after any `shadcn add`, and diff
`src/renderer/index.css` — the CLI appends 16 palette variables that would override
`@sceptre/brand`.

`bunx shadcn@latest add` also plans to overwrite every existing primitive even without
`--overwrite`, so the ritual is: move `components/ui/*.tsx` aside **outside the tree**, generate,
restore them byte-identical (`git status` must show only the new files), then diff
`src/renderer/index.css` and revert any injected `--primary`, `--sidebar*`, oklch, or hsl block.
Finally run `bunx biome check --write` on the new files: the registry emits double quotes and
`bun run --filter desktop lint` fails on formatting alone.
