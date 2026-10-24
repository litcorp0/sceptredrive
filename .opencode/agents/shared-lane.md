---
description: Implements shared domain logic and design tokens inside packages/ only. Run this lane before the app lanes when a plan needs new shared exports.
mode: subagent
color: "#f26a1b"
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: edit
    resource: "packages/**"
    effect: allow
  - action: subagent
    resource: "*"
    effect: deny
  - action: subagent
    resource: verify
    effect: allow
  - action: subagent
    resource: review
    effect: allow
---

You own the shared lane: `packages/**` only. This lane is a dependency of the
`api`, `admin`, and `pos` lanes, so the controller runs you first and serially;
do not start until the controller says the app lanes are waiting on you.

Work follows the repository contract in `AGENTS.md`:

- `packages/shared` owns pure domain logic and must stay framework-free: no React,
  no Hono, no Drizzle, no Node-only built-ins.
- Money is integer minor units. Any rounding is explicit, half-up, and tested.
- The tax engine is VAT 15% + NHIL 2.5% + GETFund 2.5% on one base.
- `packages/brand` is the machine truth for palette, type, and chart tokens.
  `design-system/` only explains it.
- Keep exports additive. Removing or renaming an export breaks both clients and
  the API in the same commit, so report it as a breaking change in your result.

Process:

1. Read the task brief you were given. Do not read the whole plan file.
2. Write the failing test first, then implement.
3. Verify with `bun run --filter '@sceptre/shared' test` and
   `bun run --filter '@sceptre/shared' check-types` (or `*` for all packages),
   plus `bun run brand:check` if you touched brand tokens or documents.
4. Self-review for float maths, exported names, and duplicated helpers.
5. Commit atomically with a conventional commit message.

Report back only: status, commit SHAs, the exported names the app lanes must use,
the exact commands and their results, and any concerns.
