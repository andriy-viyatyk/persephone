# EPIC-095 gate run — after `docs/` was deleted

**Date:** 2026-09-07
**Skill:** `mcp-test-agent-call` (Haiku, `call` as its only Persephone tool, no prior knowledge of
the application)
**Epic:** [EPIC-095 — Retire `docs/`](../../doc/epics/EPIC-095.md), the last of the
[in-app guides roadmap](../../doc/in-app-guides-roadmap.md)

## Why this run

Roadmap principle 5 says a corpus is retired only when its replacement passes the same gate. EPIC-092
proved an agent could reach the corpus, EPIC-093 that a user could, EPIC-094 that the layout schemas
answer "where is X?". This run is the **post-deletion** check: with `docs/` gone from the repository,
can a fresh weak agent still answer a mixed set from `guides.*` alone? A mixed set was used
deliberately rather than repeating one epic's questions — a guide question, a where-is-X question,
and a what's-new question — because the risk after a deletion is a regression anywhere in the
corpus, not in one topic.

## Result: 3 PASS, 0 PARTIAL, 0 FAIL

Nine tool calls, 49 seconds. No answer came from the DOM, a CSS class, or a selector string.

| # | Question | Result | Sourced from |
|---|---|---|---|
| Q1 | How does a user filter rows in a grid? | **PASS** | `guides.editors.grid` |
| Q2 | Where are a note's tags, and how does a user add one? | **PASS** | `guides.editors.notebook` |
| Q3 | What changed most recently for AI agents? | **PASS** | `guides.search` → `guides["whats-new"]` |

### Q1 — grid row filter

Answered in the guide's own words: the filter button is "at the right edge of a column header",
appearing "when you hover it", and named `grid-column-filter`. This is the same phrasing EPIC-094's
gate established, so the per-screen guides survived the deletion intact.

### Q2 — note tags

The interesting one, because US-1381 changed this page in this epic. The agent answered with the
**tag area** — "on the note card's title row, between the title and the Expand/Delete buttons at the
right edge" — and named the element `note-tags`, quoting both the layout section and the prose
paragraph. It did not mention individual chips as addressable, which is exactly the distinction the
task drew. The guide, the `where` phrase and the facade agreed, and a fresh agent reproduced the
agreement without being told to look for it.

### Q3 — what's new

Answered correctly (the 34-tools-to-one `call` consolidation, and the new ability to point out Grid
and Notebook controls — the latter being this epic's own entry). But it took a recovery step, which
is the run's one real finding.

## Finding: `helpSearch` does not descend into the `guides` node

The agent's first move for Q3 was `helpSearch`, which returned nothing, and it recovered via
`guides.search`. Reproduced directly afterwards:

```
helpSearch("release notes")  → 0 hits
helpSearch("what's new")     → 0 hits
helpSearch("changelog")      → 0 hits
helpSearch("documentation tree") → 1 hit: the `guides` member line on the root
```

So the root's **member line** for `guides` is searchable, but the `guides` node is never *entered* by
the walk, and therefore none of its own members — `whatsNew`, `search`, the tree — is reachable
through object-model search. `helpSearch` walks from the root through `children()` and through
properties a descriptor marked `node: true` (`src/shared/ai-vision/help-search.ts:24-63`); `guides`
is served by the main process and is not on that walk.

**Severity: polish, not a defect.** The miss degrades gracefully — `helpSearch`'s no-match reply
carries the hint `Search documentation text with guides.search("...")`, which is precisely how the
agent recovered, unprompted, on its first retry. The design also states that the two searches answer
different questions: `helpSearch` walks the descriptor graph, `guides.search` searches markdown. What
is arguably wrong is only that `guides.whatsNew` *is* a descriptor member and so a reader could
reasonably expect the descriptor search to find it.

**Acted on in this epic:** the `whatsNew` summary was reworded from "The selected release-notes
section for the running version" to lead with "What's new: the release notes / changelog section …
and what changed since you last saw this app" (`src/main/mcp/ai-vision/guides.ts:14`). This does not
fix `helpSearch` — the node is still not walked — but it is the text an agent reads in `guides.$help`
and in the node's hint, and it now uses the words an agent actually searches for.

**Not acted on:** making `helpSearch` walk the `guides` tree. That is a change to the shared search
used by every root, not a guides change, and it belongs in its own task alongside EPIC-092's
`PathSyntaxError` finding, which has the same shape — a fix at the shared surface rather than per
tree. Recorded in the roadmap's consolidated Needs-user-check list.

## Live surface verification

Checked by hand in the running window after the deletion, all serving:

| Surface | Result |
|---|---|
| `guides.whatsNew` | Serves the 5.0.0 upcoming section |
| `guides.editors.notebook.layout` | Serves the schema, with the updated "tag area" margin phrase |
| About page guide browser (`pages["about-page"].editor.open("editors/notebook")`) | Opens; `current` returns `{ kind: "guide", path: "editors/notebook" }` |
| `persephone://guides/*` resource aliases | Unchanged and registered |

And the two US-1381 behaviours, live:

- `pages[1].editor.highlight("note-tags", …)` → `{ found: true, count: 7, highlighted: 7 }` across
  seven mounted notes.
- `pages[…].editor.highlight("grid-column-filter", …)` on a grid **at rest** — nothing hovered, no
  column filtered, no popup open → `{ found: true, count: 2, highlighted: 2 }`. Before this epic the
  same call returned `found: false`; this is EPIC-094 gate question A.2 closed.
- Cleanup verified by reading the DOM either side of dismissal: during the highlight the buttons
  carried inline `display: inline-flex` (computed `flex`); after `clearHighlights()` the inline value
  was back to empty and computed `display` back to `none`. Nothing survived dismissal.

## Verdict

The corpus answers a mixed question set from `call` alone with `docs/` deleted, and the two controls
this epic made pointable are pointable. The gate passes; the one finding is a discoverability polish
item with a working fallback, recorded rather than fixed.
