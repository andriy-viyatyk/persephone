# EPIC-091: `call` surface hardening — acting on the external MCP evaluation

## Status

**Status:** Active
**Created:** 2026-09-07
**Started:** 2026-09-07
**Completed:** —
**Source:** [EPIC-091-evaluation-report.md](EPIC-091-evaluation-report.md) — an independent agent
with no project context evaluated Persephone 5.0.0's single-tool `call` surface.
**Follows:** [agent-transparency-roadmap.md](../agent-transparency-roadmap.md), which is complete.
This epic is not part of it; it is the first outside audit of what that programme built.

## Overview

Seven epics built the `call` tree and one deleted the thirty-two tools it replaced. Every one of
them was judged by an agent *this project wrote the prompts for*. EPIC-091 is the first time the
surface was judged by an agent that had never seen it, was told nothing about it, and was actively
trying to break it — and the interesting thing about the resulting report is what it did **not**
say.

It did not say the design is wrong. It said the opposite, at length: discovery works, the error
messages are better than most MCP servers ship, the unsaved-changes dialog interception is
"better agent-safety design than I see in most MCP servers". The roadmap's central bet — that one
path-based tool plus live hints beats thirty-four tool descriptions — was taken up by a stranger
and it held.

What the report found instead is that the surface is **half-finished in a very specific way**:
about half of it validates its arguments and the other half does not validate them at all. That is
not a design flaw, it is an incompleteness, and it produces the single worst failure mode an agent
surface can have — a call that reports success and did nothing.

### The three clusters, and why only one of them is really a bug list

1. **One correctness bug.** `pages.logView.push("text")` iterates the string and writes one log
   entry per character. This corrupts user-visible output rather than merely returning an unhelpful
   error, and it is in the primary documented output channel. It is US-1354 and it is first.
2. **Hint economics.** The `hints` parameter is not consulted on the error path, and `auto`'s
   once-per-session dedupe is bypassed there. Six typos in one session re-emitted the full root
   member list six times, ~2.5k tokens each — more context than every successful call in that
   session combined. This is not a correctness defect; it is the largest single cost in the whole
   surface, which for an agent surface is close to the same thing.
3. **The silent no-op class.** Twelve calls return `[]`, `null` or `false` for input that is simply
   wrong. `helpSearch(123)` → `[]`. `grid.addRows("five")` → `[]`. `tools.search(12345)` → the
   entire tool catalogue. `closePage("no-such-id")` → `false`, while its sibling `showPage` with
   the identical bad input throws an error listing every open page id.

That last pairing is the epic in miniature. Two methods, same argument, same failure, opposite
diagnostic quality.

### The standing rule this epic inherits, and enforces

EPIC-087 and EPIC-090 both landed the same rule by live discovery:

> **Never let a node silently accept guessed input — validate, and throw with an actionable
> message that names the bad value, lists the valid ones, and gives a copy-paste example.**

Every item in section 2 of the report is a violation of a rule this project already wrote down.
EPIC-091 does not introduce a standard; it finishes applying one.

### What must not regress

Section 4 of the report ("What works well") is a list of behaviours found valuable by an outsider
and is therefore the epic's regression surface. Each is checked explicitly in the US-1360
acceptance run: the discovery chain, `resolved up to "..."` on every error, unknown-member member
lists, enumerated valid values, the `args`/`value` mutual-exclusion error that deliberately carries
no hint block, method-path-without-args returning a descriptor, `[CAUTION: ...]` annotations, the
unsaved-changes dialog interception, and the `openUrl` / `openUrlInBrowserTab` split with its
load-race warning.

The hint work in US-1355 is the one that could damage this list, because "emit fewer hints" and
"unknown member returns the valid member list" pull in opposite directions. Decision 3 below is
where that tension is resolved rather than traded away.

## Reproduction — every claim was checked live before any fix

The report was written against a running 5.0.0 by an agent with no access to this repository, so
none of its claims were taken on trust. Each was replayed through `call` on the dev build on
2026-09-07 before its task was written.

| Report item | Replay result |
|---|---|
| 1.1 `push("not-an-array")` | **Reproduces.** Returned 12 `entryIds` for a 12-character string. |
| 1.2 `hints: "never"` on an error | **Reproduces.** `path: "nosuch", hints: "never"` returned the complete root member list. |
| 1.3 `helpSearch("grid", -5)` | **Reproduces.** 7 results where the unlimited call returns 12. |
| 1.4 invalid `language` | **Reproduces.** `addEditorPage("grid-json", "nonexistent-language", …)` returned `editor: "monaco"` with the bogus language stored verbatim. |
| 1.5 hint uses the call path | **Reproduces.** `pages.addEditorPage.editor` returns the *method descriptor*, not an editor. |
| 1.6 `maxLength` on structured results | **Reproduces.** `maxLength: 300` on a `helpSearch` array returned it untruncated. |
| 1.7 `maxLength: 0` | **Reproduces.** `[truncated: showing 0 of 5 chars]`. |
| §2 `helpSearch` with `args: []` | **Reproduces.** `[]`. |
| §2 `grid.addRows("five")` / `editCell("nocol","norow","x")` | **Reproduces.** `[]` and `null`. |
| §2 `tools.search(12345)` | **Reproduces.** Returned all 5 registered tools. |
| §2 `version` with `args: ["unexpected"]` | **Reproduces.** Returned `"5.0.0"` with no complaint. |
| §2 `closePage("no-such-page-id")` | **Reproduces.** `false`. |
| 3.1 signature disagreement | **Reproduces.** Descriptor: `addEditorPage(editor, language, title)`. Arity error: `(editor, language, title, content?)` with a four-argument example. |
| 3.3 `output.grid` example quoting | **Reproduces**, and the source confirms it — see below. |
| 3.6 `script.execute` dual failure reporting | **Reproduces.** `throw new Error('boom')` → a successful result with `isError: true`. |
| 3.7 stack traces | **Reproduces.** The same result carried eight frames of `ScriptRunnerBase.ts`, `ScriptRunner.ts` and `resolver.ts` internals over `http://localhost:5273/`. |

**Nothing in the report failed to reproduce.** An outside agent working blind produced sixteen
specific, replayable claims and got all sixteen right. That is worth recording, because it is the
reason this epic treats the report as evidence rather than as opinion.

### The one place the report is wrong, and it changes the epic

The report's central recommendation for section 2 reads:

> *"you already have an argument-validation helper producing excellent messages (`addEditorPage`,
> `deleteRows`, `openUrl`, `highlight` all use it). Apply it uniformly."*

**There is no such helper.** Verified against the source: the four named sites do not share code.
`addEditorPage` builds its messages inline (`PagesLifecycleModel.ts:264-280`); `openUrl` has its own
module (`open-url-validation.ts`, with `pipelineInputError` and `PIPELINE_INPUT_FORMS`); `highlight`
goes through `createElements`' `unknownNameError` hook (`elements.ts:100-146`); and the same pattern
is re-implemented independently in at least eight further places (`tools.ts:155/192/207`,
`menu-bar.ts:66`, `settings.ts:235-237`, `PageCollectionWrapper.ts:311-323`, and others).

Worse, **`deleteRows` — the site the report holds up as the standard — has no validation at all.**
The message it quotes,

> *"rowKeys must be an array of row keys — what getRowKey returns, not row objects or indices"*

does not exist in the codebase. `GridEditorFacade.deleteRows` (line 185) passes straight through to
`GridEditor.deleteRows` (line 715), which filters unknown keys away silently. The evaluating agent
saw a good message somewhere in the surface and attributed it to the wrong member; the member it
named is in fact a *third* silent no-op that section 2 missed.

This is the difference between a two-hour task and a real one, and it is why the epic was
worth planning rather than simply executing. US-1356 must **extract** the helper before it can
apply it. See decision 2.

## Decisions

### 1. Group by code area, not by report item number

The report is organised by severity and symptom, which is right for a report and wrong for a task
list — items 1.3, 1.6 and 1.7 are three symptoms of one file's parameter handling
(`call-tools.ts` + `result-shaper.ts`), and section 2's twelve rows are one helper applied twelve
times. Tasks are cut by **where the change lands**, so each is a single reviewable diff and no two
tasks touch the same function.

The mapping is in the task table below. The epic is not done until every numbered report item
appears either in that table or in the "Report items not acted on" table.

### 2. US-1356 extracts the shared validator first, then applies it

Because the helper the report assumed does not exist, section 2 cannot be fixed by twelve small
edits without producing twelve messages that immediately begin to drift. The task therefore has two
halves, in order:

1. **Extract** a single argument-validation module — the natural home is beside the resolver in
   `src/shared/ai-vision/`, since both the renderer facades and the `main` twin need it. Its
   contract is the one the report describes and the surface already half-implements: *name the
   rejected value and its type, list the valid values (or point at the path that lists them when
   the list is long), and give a copy-paste example.* The richest existing implementation,
   `normalizeUiPushEntry` (`ui-push-validation.ts:76`), is the model to generalise from — not a
   thing to duplicate.
2. **Apply** it to section 2's twelve rows plus `deleteRows`, which the report missed. Each
   converted call site deletes its ad-hoc message rather than keeping both — the standing rule
   from EPIC-084 onward: **move handlers, do not reimplement them, and remove the original.**

Converting the eight *already-good* sites (`addEditorPage`, `openUrl`, `highlight`, `showPage`, …)
to the extracted helper is explicitly **out of scope**. They work, an outside agent praised them,
and rewriting working error messages to share a base class is refactoring dressed as a fix. They
are converted opportunistically only where a task is already editing the function.

### 3. Hints on the error path: gate and dedupe, but never at the cost of the member list

The report asks for two things in tension. It wants `hints: "never"` honoured on errors and `auto`
deduped there (1.2), and it also lists "unknown member returns the valid member list" among the
behaviours worth preserving (§4). Resolving that badly — by suppressing error hints — would delete
the feature that makes the surface self-teaching.

The mechanism is already understood, which makes the fix narrow. `errorAt`
(`resolver.ts:199-219`) *does* route through `nodeHint`, which reads and mutates the `seenKinds`
dedupe set — but the unknown-member, non-writable and `()`-on-a-property branches pass
`forceMembers = true`, and that flag builds its hint inline at lines 211-214, **bypassing both the
dedupe and the `hints` mode check**. Three call sites, one flag. The resolution, in priority order:

1. **A near-match suggestion replaces the dump whenever one exists.** `pagez`, `Pages` and
   `page.contnet` are each one edit from a real member. A Levenshtein-1/2 hit — and a
   case-insensitive exact hit, special-cased, because `Pages` is a distinct and common mistake —
   emits `"pagez" is not a member of Persephone. Did you mean "pages"?`, one line instead of ~2,400
   tokens. This is strictly *better* than the member list for the case it covers, so it is not a
   trade.
2. **With no near match, the member list is emitted — once per kind per session**, through the
   dedupe the success path already uses. Repeat failures of the same kind get the one-line summary
   plus `Details: call with path "<kind>.$help"`.
3. **`hints: "never"` is honoured absolutely**, including on the `forceMembers` branches. A caller
   that asked for no hints and received 2,400 tokens of hint has been ignored, and there is no
   reading of the parameter's documentation under which that is correct.
4. **The error text itself is never suppressed.** `resolved up to "..."` (built in
   `call-tools.ts:250-251`), the named bad value and the enumerated valid values are part of the
   *error*, not the hint block, and no `hints` setting touches them. This is the line that keeps §4
   intact.

### 4. `closePage` is brought to `showPage`'s standard, and this is a deliberate behaviour change

`closePage("no-such-page-id")` will throw an error listing the open page ids instead of returning
`false`. A caller that branches on the `false` return will now see an exception.

Taken knowingly. `false` is unreadable — it means "no such page" *and* "the close was refused" and
would equally mean "you passed a number" — and the sibling method with the identical argument
already throws with a good message it builds itself (`PageCollectionWrapper.ts:311-323`, which
exists precisely because `PagesNavigationModel` ignores unknown ids silently). The report called
this pair "the sharpest illustration of the inconsistency" and it is right.

The one case that must keep working is `closePage` on a page whose close is intercepted by the
unsaved-changes dialog. That is not an argument error, it is the pending-dialog path, and it must
keep returning its current pending result untouched. It is an explicit acceptance criterion of
US-1356 and an abort criterion below — report §4 calls that interception the standout behaviour of
the whole surface, and no consistency win is worth damaging it.

### 5. Mutation return shapes (3.5) are **documented, not unified**

The report asks for a uniform `{ ok: true }` across `page.language = x`, `closePage`,
`logView.clear()`, `editCell` and `dialogs[0].click()`. This epic declines, and records why, because
it is the one recommendation being turned down.

- **The blast radius is the whole tree and the gain is cosmetic.** Every void member across seven
  epics of surface would change shape, against sixteen QA surface files and roughly sixty recorded
  scenarios that assert current returns. That is a large regression surface bought for
  "machine-checkable", when an agent that reads `{ "kind": "Page" }` can read `true`.
- **The shapes are not arbitrary.** `dialogs[0].click()` returns `true` because a click can fail to
  find its button; `closePage` returns a boolean because a close can be refused; `clear()` returns
  `null` because clearing cannot fail. Flattening all three to `{ ok: true }` *loses* information in
  two of them.
- **The real complaint underneath is discoverability**, and that is cheap. What a member returns
  belongs in its `$help` line. US-1359 states the return shape for every void or boolean-returning
  member it touches, which answers the caller's actual question without moving any behaviour.

Where a return shape is *actively misleading* rather than merely varied, it is changed — that is
decision 4's `closePage`, and it is the only one.

### 6. `maxLength` extends to structured results, with `shown` / `total`

The parameter description says "Cut **string** results", so 1.6 is as-specified — and as-specified
is the problem, because `boards`, `tools.search`, `entries` and `rows` are exactly where a context
blowup comes from and there is currently no defence against any of them. Today `result-shaper.ts`
bounds structured results only by `MAX_DEPTH = 8` and `MAX_ARRAY_ITEMS = 500` (lines 21-22), neither
of which is caller-controllable.

US-1357 applies `maxLength` to the serialized JSON of an array or object result, **truncating whole
array elements** and reporting `shown: n, total: m` — never cutting the JSON mid-token, which would
hand the caller something it cannot parse. The default (20000) is unchanged, so no existing caller
sees a difference. The depth cap stays as it is: the standing rule that `call`'s own input schema
must not be truncated depends on it.

Schema minimums go in the same task. `maxLength` and `windowIndex` are declared
`z.number().int().optional()` with no bound (`call-tools.ts:129`, `params.ts:9`), which is where the
report's `minimum: -9007199254740991` comes from — it is zod's integer range, not a deliberate
choice. `maxLength` gets `minimum: 1`, `windowIndex` `minimum: 0`, so the MCP layer rejects them
before the resolver sees them. `helpSearch`'s `limit` — used only at `help-search.ts:65` as
`slice(0, limit)`, which is the whole of bug 1.3 — is validated and clamped to ≥ 1.

### 7. An invalid `language` throws — it does not warn

Report item 1.4 offers two fixes: validate the language, or keep the requested editor and warn. This
epic validates and throws, for the reason the report itself gives — *"the call reports success, and
the mistake only surfaces later when `editor.addRows` doesn't exist"* — and because "keep the editor
and warn" leaves a bogus string persisted in the page's state, which the report also observed via
`page.language = "also-nonexistent-language"` → `{ ok: true }`.

The mechanism is now known and is not in `addEditorPage` at all: `editorRegistry.validateForLanguage`
(`editorRegistry.ts:203-208`) returns `"monaco"` whenever the editor's matcher does not accept the
language, and an unknown language is accepted by no matcher. So the same silent downgrade reaches
every caller of that function, including `PagesLifecycleModel.ts:303-306`. The fix distinguishes
*"this language is real but this editor does not handle it"* — where falling back to monaco is
correct and should stay — from *"this language does not exist"*, which is an argument error.

The message does **not** inline the language list, which is long. It names the bad value and points
at the registry path that lists them:

```
Unknown language "nonexistent-language". Read `editors.languages` for the valid ids.
```

The `page.language` setter (`PageWrapper.ts:192-194`) gets the same validation, since it is the same
mistake by another route.

### 8. Stack traces are trimmed to user frames in every build, not only packaged ones

Report 3.7 suggests trimming in packaged builds and accepts full traces in dev. This epic trims in
both, because the frames being removed — `ScriptRunnerBase.ts`, `ScriptRunner.ts`, `resolver.ts` —
are Persephone's own call machinery and are noise to *every* caller, in every build, on every
failure. A developer debugging Persephone itself reads the devtools console, not an MCP result.
The user frames of the submitted script are kept in full.

There is a second reason, which the report could not see: the main-process twin already behaves this
way. `main-script.ts:164` returns `errMessage(...)` with no stack at all, while the renderer's
`convertToText` (`script-utils.ts:6-11`) appends the entire stack. `script.execute` and
`main.script.execute` are documented as two halves of one idea (EPIC-090 decision 3) and currently
report failures differently. Trimming brings them together instead of further apart.

### 9. Row keys (3.2) are documented and made readable; `rows` keeps its shape

`rows` is the data payload — callers `JSON.parse` it and treat it as records. Injecting a key field
into every row would corrupt that for a diagnostic need.

The report guessed the key format correctly but could not see why it is invisible: keys live in an
off-object `WeakMap` (`grid-utils.ts:98-125`, `getRowKey` minting `r<N>` on demand), so they are
genuinely not on the row objects and no amount of reading `rows` would ever have revealed them. The
only place a key currently leaks to the surface is `selection.rowKeyStart` / `rowKeyEnd`
(`GridEditorFacade.ts:141-142`).

US-1358 therefore states the key format in `GridEditor.$help` and exposes the keys through a read
path rather than inside the row objects. The report's secondary observation — that `addRows(2)`
returns `{}` while a pre-existing row is `{ "a": null }`, so new rows do not carry the declared
columns — is investigated in the same task and fixed if it is a defect rather than the grid's
intended sparse representation.

### 10. `pages.addEditorPage.editor` is a resolver bug, not a hint-wording bug

Report 1.5 reads as a documentation problem and is not one. `resolver.ts:171` builds the hint path
as `formatPath(walked)`, and `walked` includes the **call** segment pushed at line 160 — so a hint
for a *returned* object is addressed by the path of the method that produced it, for every method in
the tree that returns a node, not only `addEditorPage`. `PageCollectionWrapper` and `root.ts` have
the same shape.

The fix is at the resolver, addressing a returned object by its own identity when it has one. That
makes it a small change in one file with tree-wide effect, which is the opposite of how the report
scoped it, and it is why it sits in US-1358 next to the language work rather than in the
documentation task.

### 11. The acceptance run is a fresh outside agent, and it becomes a regression suite

US-1360 runs a Haiku pass through `mcp-test-agent-call` replaying the report's appendix coverage
list — the same twenty-odd malformed-input probes — and records it in `qa/runs/`. A new
`qa/surfaces/malformed-input.md` makes it repeatable, which is what turns this epic from "we fixed a
report" into "this class of defect is now caught". Section 4's preserve-list is checked in the same
pass.

## Tasks

| Task | Report items | What it covers |
|---|---|---|
| [US-1354](../tasks/US-1354-logview-push-guard/README.md) | 1.1, rec. 1 | `logView.push` non-array guard, string shorthand, entry validation |
| [US-1355](../tasks/US-1355-error-hint-economics/README.md) | 1.2, 3.8, rec. 2 | `hints` honoured on errors, `forceMembers` dedupe, near-match "did you mean" |
| [US-1356](../tasks/US-1356-uniform-arg-validation/README.md) | §2 (all 12 rows) + `deleteRows`, rec. 3 | Extract the shared validator, then apply it; `closePage` parity with `showPage` |
| [US-1357](../tasks/US-1357-call-parameter-bounds/README.md) | 1.3, 1.6, 1.7, recs. 6, 9 | `limit` clamp, schema minimums, `maxLength` for structured results |
| [US-1358](../tasks/US-1358-language-and-identity/README.md) | 1.4, 1.5, 3.2, recs. 4, 5, 7 | Language validation, returned-object hint identity, row keys |
| [US-1359](../tasks/US-1359-surface-documentation/README.md) | 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, recs. 8, 10 | Signature agreement, example quoting, settings example, return shapes and `isError` in `$help`, stack-trace trimming |
| [US-1360](../tasks/US-1360-malformed-input-acceptance/README.md) | §4, appendix | Haiku acceptance run, `qa/runs/` record, `qa/surfaces/malformed-input.md` |

## Report items not acted on

Every numbered report item ends up either in the task table above or in this table with a reason.

| Item | Decision | Reason |
|---|---|---|
| 3.5 — unify mutation return shapes | **Not unified.** Documented in `$help` instead (US-1359); `closePage` alone changes shape. | Decision 5: the blast radius is every void member across seven epics and ~60 QA scenarios; two of the five shapes carry information a uniform `{ ok: true }` would lose. |
| §2 — "apply the existing validation helper" | **Premise corrected, recommendation kept.** US-1356 extracts the helper first. | No shared helper exists; the pattern is re-implemented ad hoc in at least eleven places, and the `deleteRows` message quoted as the standard is not in the codebase. See "The one place the report is wrong" above. |

## Abort criteria

- **US-1355 is the one that can go wrong.** If the near-match/dedupe work degrades any behaviour in
  report section 4 — in particular if an unknown member stops teaching the caller what *is* valid —
  the task reverts to honouring `hints: "never"` only, and the dedupe and suggestion work is
  recorded as unfinished rather than shipped degraded. The member list is the feature; the token
  cost is the price of it.
- **US-1356 must not break the pending-dialog path.** If `closePage`'s new validation cannot be
  added without disturbing the unsaved-changes interception, `closePage` keeps its boolean and the
  row moves to the not-acted-on table.
- **US-1356's extraction must not rewrite working messages.** If converting the twelve silent
  no-ops turns into a refactor of the eight sites that already validate well, stop and ship the
  twelve.
- **US-1357's structured `maxLength` must not truncate mid-token.** If bounding a structured result
  cannot be done without producing invalid JSON in some shape, the task ships the schema minimums
  and the `limit` clamp only, and 1.6 moves to the not-acted-on table.
- **Two recovery attempts on a wedged renderer**, then stop and report — per the standing rule.

## Needs user check

1. **`closePage` on an unknown id now throws instead of returning `false`** (decision 4). A
   deliberate, agent-visible behaviour change, recorded in `docs/whats-new.md` under 5.0.0. A script
   or board that branches on the `false` return needs a `try`.

## Notes

### 2026-09-07 — epic created

Written after replaying all sixteen of the report's claims live against the dev build, and after
mapping the code behind each one. None of the claims failed to reproduce, so the epic's content is
the report's content minus one recommendation (3.5's unification, declined in decision 5) and plus
three things the report could not know from outside:

- **The validation helper it told us to reuse does not exist**, and the member it named as the
  gold standard has no validation at all. US-1356 grew a first half.
- **Two of its "documentation" findings are single-line resolver bugs with tree-wide effect** —
  1.5's dead hint path (`resolver.ts:171`, every method that returns a node) and 1.2's hint leak
  (the `forceMembers` branch at `resolver.ts:211-214`, three call sites). Both are cheaper and
  broader than the report's framing suggests.
- **1.4's silent editor downgrade is not in `addEditorPage`** but in
  `editorRegistry.validateForLanguage`, so the fix has to separate a legitimate fallback from an
  argument error rather than simply adding a check.

The judgement most worth revisiting later is **decision 3**. Suppressing hints on the error path is
easy and the report asks for it; the reason it is not simply done is that the same report lists the
error-path member list as one of the surface's best features. Betting on near-match suggestions to
make the dedupe safe is the interesting call in this epic, and if the acceptance run shows an agent
getting lost after a typo, decision 3 is where to look first.
