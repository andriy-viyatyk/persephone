# EPIC-092 guide-question gate — 2026-09-07

**Surface:** [`qa/surfaces/guide-questions.md`](../surfaces/guide-questions.md)
**Harness:** `.claude/skills/mcp-test-agent-call` (Haiku, `call` as its only tool), two independent
sessions of three questions each.
**Build:** Persephone 5.0.0, dev (`npm start`), manifest `call` only, MCP at
`http://127.0.0.1:7865/mcp`.
**Corpus:** `assets/guides/`, 43 markdown pages (12 `agent`, 12 `both`, 19 `user`) plus one JSON
fixture, after US-1361/1362/1363.

## The gate

**PASS.** Six questions, six answers taken from `guides.*`, and **no MCP resource was read in either
session** — both agents answered "no" to the explicit resource question. That was the epic's gate
(roadmap principle 4 and principle 5): the twelve `persephone://guides/*` resources had failed this
same test because some models never take the resource-read step, and the corpus is now reachable
without it.

Three scenarios reached the answer after wrong turns. Two produced routing findings that were fixed
and re-run to `PASS` (see **Re-runs** below); the third is a prose gap deferred to EPIC-094 with
reasons. None of the findings was a defect in the node or the corpus's reachability.

| # | Scenario | Question | Result | Source path |
|---|---|---|---|---|
| A1 | Q.1 | "How do I filter rows in a grid…?" | PARTIAL → **PASS** on re-run | `guides.editors.grid` |
| A2 | Q.4 | "I just updated Persephone. What's new…?" | PARTIAL → **PASS** on second re-run | `guides.whatsNew` |
| A3 | Q.6 | "How do I connect a different AI client…?" | PASS | `guides["mcp-setup"]` |
| B1 | Q.7 | "My tabs come back. Can I turn that off?" | PARTIAL | `guides["tabs-and-navigation"]` |
| B2 | Q.8 | "What is a board, and how do I install one?" | PASS | `guides.boards` |
| B3 | Q.5 | "What JSON shape does a notebook need?" | PASS | `guides.formats.notebook` |

## What the successes prove

**The single-corpus decision holds** (roadmap principle 1, epic decision 5). B3 went from the bare
overview to `guides.formats.notebook` — an `audience: agent` page — **in one hop**, and reported
"only one candidate". B2, asked a *user* question about the same topic that has both a user page and
an agent authoring page, chose `guides.boards` and never opened `guides.agents.boards`. One tree, two
audiences, and the summaries were enough to route between them. This was the argument against a
separate `agentGuide` root, and it survived contact.

**Hyphenated paths work because the tree hands out a usable form.** A3 and A2 both called
`guides["mcp-setup"]` and `guides["whats-new"]` correctly and neither tried the parser-invalid
`guides.mcp-setup`. The per-entry `call` field added in US-1363 did its job; without it the agent
would have hit a `PathSyntaxError` raised before any node could hint.

**Front matter is invisible to the reader.** No answer quoted `audience:` or `title:` back at the
user, and no agent mentioned a `---` block.

## Findings

### F1 — agents reach for `helpSearch` on documentation questions, and get silence (both sessions)

The single most expensive pattern in both transcripts. A1 spent three calls on
`helpSearch("filter rows grid")`, `helpSearch("filter")`, `helpSearch("grid")`; A2 tried
`helpSearch("what's new version changelog release")` and `helpSearch("release notes")`; B1 tried
`helpSearch("restore tabs on restart")`, `helpSearch("session restore")` and
`helpSearch("session restore disable turn off")`. **Every one returned empty**, and in A1 and A2 the
agent never called `guides.search` at all — it recovered by *browsing* the tree instead.

Session A's own verdict names it exactly: *"helpSearch searches the live descriptor graph (code
structure), not the documentation tree. For user-facing questions, `guides` folder structure is more
reliable than search."* It had to learn that by failing five times. Both nodes already cross-
reference each other in their summaries (US-1363), and that was not enough, because the agent does
not read `helpSearch`'s summary before calling it — it reads the *result*.

**Fix:** when `helpSearch` returns zero hits, say so and point at `guides.search` in the empty
result itself. An empty array is a dead end; an empty array that names the other search turns five
wasted calls into one redirect. This is a hint fix in the result path, not a change to what
`helpSearch` searches.

### F2 — `guides.whatsNew` was never discovered; the agent read the whole 264k page instead

A2 answered Q.4 correctly, but from `guides["whats-new"]` — the complete 264,765-character history —
rather than `guides.whatsNew`, which returns the current release's 14,878-character section and
exists precisely for this question. The agent found the *page* by browsing the tree and never learned
the *method* existed, because the `guides` tree result lists pages and folders and does not mention
the node's own members.

**Fix:** make the `guides` result advertise `whatsNew` and `search` where the agent is already
looking — in the node's summary/hint text that accompanies the tree — so the two members are visible
to an agent that discovers the corpus by browsing rather than by reading `$help`.

### F3 — the corpus does not answer "can I turn session restore off?" (documentation gap, not a defect)

B1 reached `guides["tabs-and-navigation"]`, read it, checked `settings.sections` across eleven
sections, and produced a hedged and partly incorrect answer: *"There is no explicit setting in
Settings to disable session restore… unpinned tabs are not automatically restored."* The routing was
right and the agent was diligent; the corpus simply does not state whether session restore can be
disabled, so no search ranking could have rescued it.

This is the scenario the surface file predicted would be hardest, and it is a **prose** gap. It is
recorded for EPIC-094, which owns the per-screen rewrite, rather than fixed here: EPIC-092 is a move,
not a rewrite, and editing that page's wording now would violate the epic's own scope rule. Q.7 stays
in the surface file as a standing test.

## Not covered

`guides.<page>.layout` was deliberately not tested: no page carries a `## Layout` section until
EPIC-094. The path exists and returns its no-schema message, which was verified by hand rather than
by the agent.

## Harness caveat, recorded honestly

`mcp-test-agent-call` runs as a forked context, so the runner inherits the parent session rather than
starting from true zero, and its instructions ("ignore all project files, your only knowledge comes
from `call` and its hints") are a rule rather than an enforced boundary. Both runners were told again
in the prompt to prove every answer through `call` and to report the exact call sequence, and both
produced routes with real dead ends — five empty `helpSearch` calls are not what an agent with the
answers in context would do, so the transcripts read as genuine discovery. Still, the strongest claim
this run supports is *"the corpus is reachable and the routing works"*, not *"a model with no prior
exposure would find it"*. The Codex pass in `qa/README.md` step 3 is the harness that can test the
resource question properly, since it is the one that actually has resource access.

## Re-runs after the fixes

Both findings were fixed and the affected scenarios re-run, per `qa/README.md` step 4.

### A1 / Q.1 — PARTIAL → **PASS**

Route: `overview → helpSearch("filter rows grid") → guides.search("filter rows grid") → guides.editors.grid`.

The single empty `helpSearch` now redirects instead of dead-ending, and the agent moved to
`guides.search` on its next call rather than after three more attempts. Answer came from the
`### Filtering` section of `editors/grid.md`, in the guide's own words. No resource read.

### A2 / Q.4 — PARTIAL → **PASS**, after a second fix

The first re-run still failed, and instructively. The agent **quoted the new `guides` hint back**
— *"use guides.search for what the documentation says about X and guides.whatsNew for what changed
in this release without reading the whole history"* — and then browsed to `guides["whats-new"]`
anyway, read 20,000 truncated characters, and concluded *"the object model does not expose a
`.currentReleaseOnly` property, so reading the full What's New document was the only discovery
path."* It had the answer in hand and did not act on it.

So the pointer was moved to where the agent was actually about to click: the `whats-new` page's own
front-matter `summary`, which is the line the tree prints next to that entry. It now reads *"Every
release's notes, newest first — the complete history; call `guides.whatsNew` instead for just the
running version's section."* One line of metadata, no code change.

Re-run route: `overview → guides → guides.whatsNew`. **No wrong paths.** ~8,500 characters read
instead of 20,000 truncated, and the agent volunteered why: *"The very first call's hint explicitly
stated 'call guides.whatsNew instead for just the running version's section'. I found this
advertised in the guide index and used it correctly."*

**The lesson generalises, and it is the run's real finding.** Three times over, a correct pointer in
the wrong place did nothing: cross-referencing the two searches in their member *summaries* did not
stop eight empty `helpSearch` calls; naming `whatsNew` in the node's hint did not stop the agent
browsing past it. What worked each time was putting the pointer in the **result the agent was already
reading** — the empty search result, and the tree row for the page it was about to open. An agent
reads results, not documentation about results.

### B1 / Q.7 — remains **PARTIAL**, deferred to EPIC-094

Not re-run: the finding is a prose gap (the corpus does not say whether session restore can be
disabled), and rewriting that page inside EPIC-092 would break the epic's move-not-rewrite rule.
Q.7 stays in the surface file as a standing test.

## Correction to one runner's self-report

The Q.4 re-runner answered "yes" to the resource question, explaining that *"`guides.whatsNew` is an
MCP resource returned through the `call` tool's path resolution"*. That is a terminology confusion on
its part, not a resource read: its own route lists only `call` paths, and no `persephone://` URI
appears in any transcript from any session. The gate's claim stands — six questions plus two re-runs,
zero resource reads.
