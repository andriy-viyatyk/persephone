# EPIC-091 acceptance run — malformed input and error quality

**Date:** 2026-09-07
**Build:** 5.0.0 dev, at commit `723ef5b5` (US-1359, the last of the epic's six code tasks)
**Surface file:** [qa/surfaces/malformed-input.md](../surfaces/malformed-input.md)
**Haiku pass:** `mcp-test-agent-call` — an agent with no knowledge of this project and `call` as its
only tool. 26 tool calls, one session.
**Direct pass:** the rows the Haiku agent did not exercise (see "What the Haiku pass did not test"),
replayed by hand through `call`.

## What was being tested

Not "does `call` work" — the EPIC-090 gate answered that. This run asks the question EPIC-091 was
created for: **when a call is wrong, does the caller learn what was wrong, what would be right, and
what did it cost to find out?** The scenarios are the report's own appendix coverage list, replayed
against the fixes.

Section 4 of the [source report](../../doc/epics/EPIC-091-evaluation-report.md) — the behaviours an
outside evaluator found *good* — was checked in the same pass, because it is the regression surface
for everything the epic changed.

## Verdict

**PASS.** Every scenario the Haiku agent exercised behaved as the surface file specifies, and it
completed all four requests unaided. Its own summary, unprompted:

> *"Could the tool tell you enough to complete the requests? YES, completely."*
> *"Errors consistently suggest the correct path or valid values… The tool validates arguments and
> suggests alternatives before execution."*

The last clause is the epic's whole point restated by a stranger: before EPIC-091 the tool did
*not* validate arguments before execution across half its surface, and that is precisely what the
original evaluation objected to.

## M.1 — the output channel

| Call | Result | Verdict |
|---|---|---|
| `pages.logView.push([{ type: "log.info", text: "deployment finished" }])` | `{ entryIds: ["1"], dialogIds: [] }` | PASS |
| `pages.logView.entries` | one entry, text `"deployment finished"` | PASS |
| `pages.logView.clear()` | `null`, channel emptied | PASS |
| `push("deployment finished")` — bare string (**direct**) | one `entryIds` value, `dialogIds: []` | PASS |
| `push(123)` (**direct**) | errors, naming the value and its runtime type, with an accepted shape | PASS |

The bare-string case is report bug 1.1, the epic's only correctness bug. Before the fix it returned
twelve entry ids for a twelve-character string.

## M.2 — a typo costs one line, not a member list

This is the run's most useful measurement, because the report's second-largest finding was a cost
rather than a defect.

| Path | Response | Size |
|---|---|---|
| `pagez` | `"pagez" is not a member of Persephone. Did you mean "pages" or "page"?` | ~150 bytes |
| `Pages` | `"Pages" is not a member of Persephone. Did you mean "pages"?` | ~100 bytes |
| `pages.qqqqqqqq` — first unknown member of kind `Pages` | error **plus the full `Pages` member list** | ~2,500 bytes |
| `pages.wwwwwwww` — second, same kind | error plus the kind summary and `Details: call with path "pages.$help"` | ~200 bytes |

All four rows are the intended behaviour and the ratio is the result: **a repeat failure of the same
kind now costs about an eighth of the first one**, while the first still teaches the caller the
complete valid member list. That was the tension in the epic's decision 3 — the report wanted the
dumps deduped *and* listed the member list among the behaviours worth preserving — and this table is
the evidence it was resolved rather than traded.

`pagez` naming **two** candidates is deliberate. It is one edit from both `pages` (substitution) and
`page` (deletion); the reviewed plan had suppressed a suggestion on any tie, which sent the full
~2,400-token dump for the single most likely typo on the surface. Corrected during live
verification of US-1355.

Also confirmed **direct**: the suggestion is part of the error rather than the hint block, so it
survives `hints: "never"`; and `hints: "always"` still repeats the member list for a no-near-match
failure.

## M.3 — wrong arguments fail instead of returning nothing

| Call | Result | Verdict |
|---|---|---|
| `pages.closePage("no-such-page-id")` | error listing the four open page ids, with an example | PASS — report §2's sharpest row |
| `version` with `args: ["unexpected"]` | `"5.0.0"` **plus** a warning that the property takes no arguments; `isError` unset | PASS |
| `helpSearch("123")` — a valid string matching nothing | `[]` | PASS, and see below |
| `tools.search("12345")` — likewise | `{ total: 0, returned: 0, tools: [] }` | PASS, and see below |
| `helpSearch(123)` — a number (**direct**) | error naming the value and its type | PASS |
| `tools.search(12345)` — a number (**direct**) | error; **no longer returns the whole catalogue** | PASS |
| `helpSearch` with `args: []`, `helpSearch(null)`, `helpSearch({query:"grid"})`, `helpSearch("grid","not-a-number")`, `helpSearch("grid","x","extra","more")` (**direct**) | each errors, naming the argument and the problem | PASS |
| `editor.addRows("five")`, `addRows(-3)`, `editCell("nocol","norow","x")`, `deleteRows(["nosuchkey"])` (**direct**) | each errors; `editCell` lists the live column keys | PASS |

The two string rows deserve their own note. They are not failures — a *valid* query that matches
nothing must still return an empty result, and the surface file requires exactly that check, so the
Haiku agent supplied it by accident. The malformed-**number** forms were replayed directly.

## M.4 — numeric bounds

| Call | Result | Verdict |
|---|---|---|
| `helpSearch("grid", -5)` | **1** result | PASS — was `12 − 5 = 7` |
| `helpSearch("grid")`, no limit | 13 results | PASS (13, not the report's 12: this epic added help lines) |
| `maxLength: 0` / `-10` (**direct**) | refused by the schema before the handler: `Too small: expected number to be >=1` | PASS |
| `windowIndex: -1` (**direct**) | refused the same way, `>=0` | PASS |
| `helpSearch("grid", NaN)` (**direct**) | falls back to the default rather than returning `[]` | PASS |

## M.5 — a large structured result can be bounded

Verified **direct**: `helpSearch("grid")` with `maxLength: 500` returned two complete elements as
valid, parseable JSON followed by `[truncated: showing 2 of 12 items — raise maxLength or read a
narrower path]`. The same call without `maxLength` returns everything, so the 20000 default is
unchanged. Report item 1.6, which had been the only large-result risk with no caller-controllable
defence.

## M.6 — unknown values, and following a hint to a returned object

| Call | Result | Verdict |
|---|---|---|
| `addEditorPage("grid-json", "nonexistent-language", "Lang Check")` | **error**, `Unknown language "nonexistent-language". Read editors.languages for the valid ids.` | PASS — was a silent monaco downgrade reported as success |
| `addEditorPage("grid-json", "json", "Lang Check")` | a real grid page; its hint advertised the editor under `pages["<the new id>"]` | PASS — report 1.5 |
| the agent then followed that hint to `pages["<id>"].editor` | reached the grid facade | PASS — the path used to return a method descriptor |
| `editor.addRows(2)` | `[{}, {}]` | PASS — sparse rows are intended, asserted so a later change does not "fix" them |
| `editor.rowKeys` | `["0", "1", "2"]` | PASS — report 3.2; previously unobtainable |
| `editor.editCell("a", "1", "TestValue")` | succeeded, using a key read from `rowKeys` | PASS |
| `editor.rowCount` | `3` | PASS |
| `addEditorPage("grid-json", "typescript", …)` (**direct**) | a **monaco** page, silently | PASS — a real language the editor cannot handle is a legitimate fallback, not an argument error |
| `addEditorPage("monaco","plaintext","T","initial text")` (**direct**) | `initial text` present in `page.content` | PASS — the fourth argument used to be dropped by the wrapper |

The `rowKeys` → `editCell` sequence is the one to notice. The original evaluation had to *guess*
the key format and said so; the Haiku agent read the keys and used one, with no guide and no
guessing.

## M.7 — the preserve list (report section 4)

| # | Behaviour | Verdict |
|---|---|---|
| 1 | Discovery: bare overview → `children (live)` → `$help` | PASS — the agent named the empty-path overview as "the critical starting point" |
| 2 | `resolved up to "..."` on every error | PASS |
| 3 | An unknown member returns the valid member list | PASS on first encounter for its kind (M.2) |
| 4 | Valid values enumerated for an unknown editor id and an unknown tool id | PASS — 32 editors, 5 tool ids, both still listed in full |
| 5 | `args` + `value` together errors and carries **no** hint block | PASS — checked explicitly; the restraint survived |
| 6 | A method path with no `args` returns a descriptor rather than firing | PASS — `boards.list` returned its descriptor |
| 7 | `[CAUTION: …]` annotations on mutating members | PASS |
| 8 | The unsaved-changes interception | PASS — an explicit abort criterion of the epic, since `closePage` gained argument validation. Closing a modified page returns the pending result with its attention text naming Save / Don't Save / Cancel and instructing the agent not to discard the user's work unprompted. Verified after US-1356 and again after the last commit. |
| 9 | The `openUrl` / `openUrlInBrowserTab` split and its load-race warning | PASS — text unchanged |

Nothing on the preserve list regressed. Item 8 was the one at real risk and was checked twice.

## What the Haiku pass did not test

Recorded because a run log that hides its gaps is worth less than one that names them.

The agent **normalized two malformed probes into valid ones**: asked to "search the help for the
number 123" it called `helpSearch("123")`, and asked to push a single line it wrapped it in an
array. Both are the *correct* calls; it simply did not make the mistake it was asked to make. Those
rows were replayed directly and are marked **(direct)** above.

That is a finding rather than a defect in the run, and it cuts both ways. A competent agent does not
often send a number where a string belongs — so this class of bug is not something every session
hits. But the report's evaluator hit it repeatedly *while probing deliberately*, and the cost when it
happens was the whole problem: a silent no-op reported as success, or 2,400 tokens for a typo. The
fix is worth having precisely because the failure is rare enough to be trusted when it appears.

## Housekeeping

Every page created by this run was closed by its returned id (one unsaved-changes prompt answered
**Don't Save**, on the run's own throwaway scratch page). The Log View was cleared. No pinned tab and
no pre-existing page was read, modified, activated or closed. No trust or consent dialog was
answered.
