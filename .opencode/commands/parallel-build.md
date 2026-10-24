---
description: Execute a plan with parallel lane subagents, then verify and review
agent: build
---

You are the controller for a parallel build. $ARGUMENTS

## 1. Read before you split

Read the plan file, `.planning/STATE.md`, and `AGENTS.md`. Do not hand a subagent
the whole plan: it gets a task brief and the interfaces it touches, nothing else.

## 2. Partition into lanes

Every task belongs to exactly one lane, by file ownership:

| Lane | Agent | Owns |
|---|---|---|
| shared | `shared-lane` | `packages/**` |
| api | `api-lane` | `api/**` (includes migrations and seeds) |
| admin | `admin-lane` | `admin/**` |
| pos | `pos-lane` | `desktop/**` |

Rules for the split:

- One writer per lane. Never dispatch two implementers into the same lane.
- `packages/**` is a dependency of every other lane: run `shared-lane` first and
  alone, then start the app lanes with the new exported names in their briefs.
- Root files (`package.json`, `bun.lock`, `biome.json`, `compose.yaml`, `.github/`,
  `.planning/`, `AGENTS.md`) are yours. A lane that needs one reports
  `NEEDS_LANE_CHANGE`; you make that edit yourself, serially.
- If two tasks must touch the same file, they are one lane task, not two.
- Read-only work (research, tracing, counting) goes to `explore` and can run
  alongside everything.

## 3. Dispatch in parallel

For each lane, write a task brief to a file, then call the `subagent` tool with
`background: true` — one call per lane, all in the same batch. Never run lane
implementers sequentially when their file sets are disjoint.

Each dispatch contains, and contains only:

1. One line on where the task fits in the project.
2. The brief path: "read this first — it is your requirements, with the exact
   values to use verbatim".
3. Interfaces and decisions from already-finished lanes that the brief cannot
   know (shared export names, API contract, schema columns).
4. Your resolution of any ambiguity you noticed in the brief.
5. The report path and the report contract: status, commits, test command and
   result, concerns.

Do not paste prior-task summaries or the plan into a dispatch.

## 4. Collect and integrate

As each lane reports:

- `DONE` — record the commits in `.planning/` only if the plan asks for it; do not
  edit lane files yourself.
- `DONE_WITH_CONCERNS` — read the concerns; fix real scope or correctness issues
  by re-dispatching that lane, not by editing its files.
- `NEEDS_CONTEXT` — supply the missing context and re-dispatch the same lane.
- `NEEDS_LANE_CHANGE` — make the cross-lane edit yourself, then re-dispatch.
- `BLOCKED` — stop and escalate with the blocker, the lane, and what you tried.

Do not run a repository-wide gate while any lane is still writing.

## 5. Verify serially

Once every lane is idle:

1. Dispatch `verify` with the gates this change needs (lint, types, tests, build,
   brand gate). It is read-only and reports, it does not fix.
2. On failure, dispatch exactly one fix subagent with the complete failure list and
   the covering test names. Re-run the affected gate only, then the full gates once.
3. If a lane's tests passed but the repository gate fails, the failure belongs to
   whichever lane owns the file — re-dispatch that lane, do not fix it yourself.

## 6. Review, then report

1. Generate one diff package for the whole change (commit list, `--stat`, full
   diff with context) and dispatch `review` with the brief paths and that package.
2. Fix `Critical` and `Important` findings with one subagent carrying the whole
   list, then re-review. Record `Minor` findings in your final report.
3. Produce a final report: lane table (task → agent → commits → test result),
   gate table (gate → PASS/FAIL → evidence), open findings, and the exact human
   steps needed for anything a machine cannot prove.

Stop only for a real blocker, an ambiguity that prevents progress, or completion.
Do not ask "should I continue?" between lanes.
