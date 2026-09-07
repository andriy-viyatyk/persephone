# Guide questions — the documentation surface

The gate for EPIC-092's `guides` node, and the reusable one for EPIC-094 and EPIC-095.

Every other surface file asks the agent to *do* something. This one asks it to *answer* something,
which is a different test: the agent must find the page that knows, read it, and answer in the
guide's own terms. It exists because the twelve `persephone://guides/*` MCP resources failed exactly
this test — some models never take the resource-read step, so a corpus reachable only as a resource
is, for them, a corpus that is not there (roadmap principle 4). Every guide is now a `call` path;
this file proves it.

## Gate rules

- **First call has no `path`.** As in every surface, the agent starts from the bare overview and
  must reach the corpus from what the overview tells it. An agent that goes straight to a path it
  was told about in the request has not tested discovery.
- **No resource reads.** The whole point. If the agent reads `persephone://guides/*` instead of
  calling `guides.*`, the scenario is a `FAIL` even when the answer is right — and the finding is
  that `SERVER_INSTRUCTIONS` or the overview still advertises the resource first. The Haiku runner
  (`mcp-test-agent-call`) has `call` as its only tool, so it cannot read a resource; the Codex pass
  can, and is the one that actually tests this.
- **Read-only.** No scenario creates a page, writes a file, or changes app state. An agent that
  creates a page to "show" its answer has answered a question that was not asked; note it as a
  finding, not a failure, unless it was told to.
- **Answers are graded against the page, not against the truth.** The measure is whether the answer
  came from the corpus and matches what the page says. A correct answer the agent already knew from
  pre-training is not evidence the corpus is reachable — check the transcript for the call that
  fetched the page, and mark `PARTIAL` when there is none.
- **Wrong turns are the data.** Record every path called before the right one. A scenario that lands
  on the answer after four wrong guesses is a `PARTIAL` and a finding about a summary or a hint,
  which is the output this suite exists to produce.

## Result fields

Each scenario records: `Route` (`overview → <paths in call order>`), `Wrong paths` (`none` or every
incorrect path in order), `Page reached` (the guide path the answer came from), `Resource read`
(`none` — anything else is a FAIL), and `PASS | PARTIAL | FAIL`.

## Scenarios

### Q.1 — Find a feature inside a screen

**Request:** "How do I filter rows in a grid so I only see the ones I care about?"

**Expected route:** overview → `guides` (or `guides.search("filter rows")`) → `guides.editors.grid`.
**Answers from:** `editors/grid.md`.
**Tests:** the search path, which is the node's main value. "filter rows" is not a heading in the
corpus, so this fails unless body passages are searched and returned with their page path.

### Q.2 — A fact that lives in a table

**Request:** "What is the keyboard shortcut to compare two files?"

**Expected route:** overview → `guides.search("compare")` → `guides.shortcuts`.
**Answers from:** `shortcuts.md`.
**Tests:** passage extraction from a markdown table row. A search that only returns paragraphs
misses this, and the agent will read the whole page instead — acceptable, but record it.

### Q.3 — A whole-page answer

**Request:** "Can I password-protect a file, and what encryption does it use?"

**Expected route:** overview → `guides.search("encryption")` or `guides` → `guides.encryption`.
**Answers from:** `encryption.md`. The answer must name AES-256-GCM.
**Tests:** page fetch with front matter stripped — if the agent quotes `audience: both` back at the
user, the strip is broken.

### Q.4 — What changed

**Request:** "I just updated Persephone. What is new in this version?"

**Expected route:** overview → `guides.whatsNew`.
**Answers from:** the current release's section of `whats-new.md`.
**Tests:** `whatsNew` returns the *current* section rather than all 2,200 lines. An agent that
fetches the whole page and truncates has found a defect in `whatsNew`, not in itself.

### Q.5 — An agent-only format page

**Request:** "I want to build a notebook file for the user. What JSON shape does it need?"

**Expected route:** overview → `guides.search("notebook")` → `guides.formats.notebook`.
**Answers from:** `formats/notebook.md`.
**Tests:** that `audience: agent` pages are in the agent's tree and in its search results — the
single-corpus decision (roadmap principle 1). It also tests ranking: two pages match "notebook"
(`editors/notebook.md`, the user page, and `formats/notebook.md`, the format), and the agent asking
about JSON should be able to tell which is which **from the summaries alone**. If it reads both, the
finding is a summary that does not distinguish them.

### Q.6 — Setup, outside the app

**Request:** "How do I connect a different AI client to Persephone's MCP server?"

**Expected route:** overview → `guides.search("MCP")` → `guides.mcp-setup` (also
`guides["mcp-setup"]`).
**Answers from:** `mcp-setup.md`.
**Tests:** a hyphenated page name, which is the path form most likely to break — `guides.mcp-setup`
is not a valid identifier, so the bracket form must work and the tree must show a form that resolves.

### Q.7 — A feature the user has the wrong word for

**Request:** "When I restart the app my tabs come back. Can I turn that off?"

**Expected route:** overview → `guides.search("session restore")` or `guides.search("tabs")` →
`guides.tabs-and-navigation`.
**Answers from:** `tabs-and-navigation.md`.
**Tests:** search when the user's words ("tabs come back") are not the corpus's words ("session
restore"). Expected to be the hardest scenario; a `PARTIAL` here is a finding about the page's
summary, and possibly the one place a synonym belongs in the prose.

### Q.8 — Two audiences, one question

**Request:** "What is a board, and how do I install one?"

**Expected route:** overview → `guides.search("board")` → `guides.boards`.
**Answers from:** `boards.md` (user). The agent-facing `agents/boards.md` is the authoring
reference and is the wrong page for "how do I install one".
**Tests:** that the agent picks the user page for a user question and the authoring page for an
authoring question. Ask the follow-up in the same run — "now write me one" — and confirm it moves to
`guides.agents.boards`. Two pages, one search, the audience deciding: this is the case that argued
against a separate `agentGuide` root.

## Coverage

| Scenario | Tests | Page |
|---|---|---|
| Q.1 | body-passage search, editor sub-page | `editors/grid.md` |
| Q.2 | table-row passage | `shortcuts.md` |
| Q.3 | page fetch, front matter stripped | `encryption.md` |
| Q.4 | `guides.whatsNew` current-section extraction | `whats-new.md` |
| Q.5 | agent-audience page in tree + search, summary disambiguation | `formats/notebook.md` |
| Q.6 | hyphenated page path, bracket form | `mcp-setup.md` |
| Q.7 | search across the user's vocabulary gap | `tabs-and-navigation.md` |
| Q.8 | audience routing between a user and an agent page on one topic | `boards.md`, `agents/boards.md` |

Eight scenarios, covering the tree, a page, search over headings/body/tables, `whatsNew`, both
audiences, and the two path forms. `guides.<page>.layout` is deliberately **not** covered: no page
has a `## Layout` section until EPIC-094, which adds the scenarios for it.
