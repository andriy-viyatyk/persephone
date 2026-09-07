# US-1360 — Malformed-input acceptance run and regression suite

**Status:** Implemented (unreviewed — epic close runs the completion skills) · **Epic:**
[EPIC-091 — `call` surface hardening](../../epics/EPIC-091.md)

## Goal

Prove EPIC-091's six code tasks against a fresh agent that has never seen the surface, and leave
the probes behind as a repeatable suite — so that error quality becomes something the project can
regress-test rather than rediscover by external audit.

## Background

The five preceding tasks each verified their own fixes live, one probe at a time, by the agent that
planned them. That is enough to know a fix works and not enough to know the *surface* works: the
original evaluation's value came from an agent with no context, no guide, and an intent to break
things, and none of the per-task checks reproduce that.

This task therefore has two deliverables, and the second is the durable one:

1. **A run**, recorded in `qa/runs/`, replaying the report's own appendix coverage list against the
   fixed build — plus report section 4, the list of behaviours an outsider found *good*, which is
   the regression surface for everything the epic changed.
2. **A surface file**, `qa/surfaces/malformed-input.md`, so the run is repeatable. Every other file
   in that suite is organised by screen; this one is organised by *failure*, which makes it the one
   place where "the error message quietly lost its valid-value list" is catchable. No build,
   typecheck or lint finds that.

Per `doc/agents-common.md` and the `codex-dev` skill, a QA run is never delegated: the deliverable
of a QA run is usually a documentation fix rather than code, and that judgement does not survive
being summarised by another agent.

## Implementation plan

1. Write `qa/surfaces/malformed-input.md` with scenarios M.1 to M.7, each stating *why* the probe
   exists (which report item, and what the old behaviour was), the exact assertions, and cleanup.
   M.7 is the section 4 preserve checklist.
2. Add the file to the `qa/surfaces/README.md` index, with a paragraph explaining why this file's
   surface is not a screen.
3. Run the Haiku pass — `Skill(skill: "mcp-test-agent-call", …)` — with four requests covering M.1,
   M.2, M.3 and M.6, phrased as a user would phrase them rather than as paths, so the agent has to
   discover the surface.
4. Replay by hand, through `call`, whatever the Haiku agent did not exercise, and mark those rows
   **(direct)** in the run log rather than blurring the distinction.
5. Record the result in `qa/runs/2026-09-07-epic-091-malformed-input.md`, including a section
   naming what the Haiku pass did *not* test.
6. Record the epic's agent-visible behaviour changes in `docs/whats-new.md` under
   `## Version 5.0.0 (Upcoming)`.

## Outcome

**PASS.** [The run log](../../../qa/runs/2026-09-07-epic-091-malformed-input.md) has the detail. The
two results worth carrying forward:

- **The hint-economics fix is measurable.** A first unknown member of a kind still returns the
  complete member list (~2,500 bytes); a second returns the kind summary plus a `$help` pointer
  (~200 bytes). That ratio is what report item 1.2 was asking for, and the member list survived —
  which was the epic's abort criterion for US-1355.
- **The Haiku agent normalized two malformed probes into valid calls.** Asked to search for "the
  number 123" it sent `helpSearch("123")`; asked to push one line it wrapped it in an array. Both
  are the correct calls; it declined to make the mistake. Those rows were replayed directly.

  This is a finding, not a gap in the run, and it sharpens what the epic bought. A competent agent
  does not often send a number where a string belongs, so this defect class is rare per session —
  but the report's evaluator hit it repeatedly while probing deliberately, and the cost when it
  lands was the whole problem: a no-op reported as success, or 2,400 tokens spent on a typo. A
  failure mode that is rare is one an agent will *trust*, which is exactly why it must not lie.

Nothing on the section 4 preserve list regressed. The unsaved-changes interception — report §4's
standout item and an explicit epic abort criterion, because `closePage` gained argument validation
in US-1356 — was checked twice, after US-1356 and again after the last commit.

## Acceptance criteria

- [x] `qa/surfaces/malformed-input.md` exists, is indexed in `qa/surfaces/README.md`, and covers
      every report item the epic acted on plus the section 4 preserve list.
- [x] A Haiku pass through `mcp-test-agent-call` completed all four requests unaided, from a bare
      `call` with no path.
- [x] Rows the Haiku pass did not exercise were replayed directly and are marked as such.
- [x] The run is recorded in `qa/runs/` with its gaps named.
- [x] Agent-visible behaviour changes are in `docs/whats-new.md` under 5.0.0.
- [x] The instance is left as it was found: four pages, Log View cleared, no pinned tab touched.

## Files changed

| File | Change |
|---|---|
| `qa/surfaces/malformed-input.md` | New: scenarios M.1 to M.7 |
| `qa/surfaces/README.md` | Index row and a paragraph on why this surface is not a screen |
| `qa/runs/2026-09-07-epic-091-malformed-input.md` | The run log |
| `docs/whats-new.md` | The epic's agent-visible changes under 5.0.0 |
