# EPIC-093 gate — the About page as guide browser

**Date:** 2026-09-07
**Surface:** [about-guide-browser.md](../surfaces/about-guide-browser.md), scenarios A.1 and A.2
**Runner:** `mcp-test-agent-call` (Haiku, `call` as its only tool, no prior knowledge of Persephone)
**Epic:** [EPIC-093](../../doc/epics/EPIC-093.md)

Two requests, run as a pair because they are the two halves of the epic's claim: *show me the grid
guide* (can the agent put the real guide on the user's screen?) and *where is the control that
filters rows* (can it answer a "where is X" question from the corpus?).

## Run 1 — FAIL on A.1, PARTIAL on A.2

### A.1 — "Show me the guide for the grid editor"

**Route:** overview → `guides.editors` → `guides.editors.grid` →
`pages.addEditorPage("md-view", "markdown", "Grid Editor Guide", "<the entire guide text>")`

**On screen:** a new page containing a **copy** of the guide's text.

**Verdict: FAIL** — and the most valuable result of the epic.

The agent found the right guide immediately and read it correctly. Then, asked to *show* it, it
copy-pasted the whole text into a brand-new page. That page is a dead clone: no guide identity, no
breadcrumbs, no working links to other guides, no *Open in tab*, and content frozen at the moment it
was copied. The application had just gained, in this very epic, the ability to open the real thing
in two different hosts — and the agent never learned that.

**The cause was ours, not the model's.** Every string the `guides` node hands out described only how
to *read* a guide's text: the node summary talked about the tree, `search` and `whatsNew`; each page
entry gave a title and a summary; nothing — not the summary, not `$help`, not a tree entry, not the
root overview line — mentioned that a guide can be **shown**, or that `persephone-guide://` exists.
So the agent reached for the only "put something in front of the user" tool it knew about.

This is EPIC-092's lesson arriving a second time: *an agent reads a result, not a summary.* A
capability that is not named in the result the agent is holding does not exist. EPIC-092 hit it
twice — `guides.search` invisible behind eight empty `helpSearch` calls, and `guides.whatsNew`
invisible while an agent read a 264,765-character page instead — and both fixes were the same shape:
put the pointer where the agent is already looking.

**Fix (US-1372):** every guide page entry now carries an `open` field beside the existing `path` and
`call` fields — `"open": "persephone-guide://editors/grid"` — following EPIC-092's own precedent of
handing out a ready-to-use string rather than one the agent must construct. Folder entries omit it,
because a folder has no page URL. The `guides` node summary, its `$help` and the root overview line
now name both hosts (`pages.openUrl(...)` for a tab, `pages["about-page"].editor.open(...)` for the
About browser) and say plainly that showing a guide means opening it, **not** copying its text into a
new page. `SERVER_INSTRUCTIONS` got the same treatment.

### A.2 — "Where is the control that filters rows in a grid? Point at it if you can."

**Route:** `helpSearch("filter rows grid")` (0 hits) → `pages.addEditorPage("grid-json", …)` to make
a sample grid → `page.editor` → `page.editor.elements` → `helpSearch("filter")` →
`page.editor.filters` → `script.execute` DOM inspection, finding `.avg-filter-button`

**Verdict: PARTIAL.** The answer was correct — the filter control is a button on each column header —
but it came from **the DOM, not the guide**. The agent inspected the running app instead of reading
the page that already describes the control, and it put nothing on the user's screen.

Two findings, neither of them a defect to fix here:

1. **`helpSearch` already points the way, and the pointer was ignored.** I checked the live
   behaviour: `helpSearch("filter rows grid")` returns `hits: 0` with
   `hint: "Search documentation text with guides.search(\"filter rows grid\")."` — EPIC-092's fix is
   in place and correct. The agent simply did not take it. That is worth knowing precisely because
   the fixable part is already fixed: the remaining gap is judgement, not information.
2. **This is the baseline EPIC-094 starts from.** "Where is X" is the question the layout schemas
   exist to answer, and the corpus does not carry one yet. An agent forced to find a control's
   position had to read the DOM and report a CSS class name (`avg-filter-button`) — which is a fact
   about our markup, not a place on screen a user could be told to look. Re-run A.2 after EPIC-094
   writes the schemas; the measure is whether the answer starts naming regions ("the filter icon at
   the top-right of the grid toolbar") instead of class names.

## Run 2 — after the US-1372 fix: PASS on both

Same two requests, fresh agent, against the `open` field and the reworded hints.

### A.1 — PASS

**Route:** overview → `guides.editors` → `pages.openUrl("persephone-guide://editors/grid")`
**Wrong paths:** none.
**On screen:** the real guide, as an `md-view` page with the guide's own identity.

One hop shorter than the failing run, and it never read the page's text at all — it did not need to,
because the entry it was already looking at carried the URL. In its own report it named how it knew:
"Located the Grid Editor guide at `guides.editors.grid` with the open URL:
`persephone-guide://editors/grid`". That is the whole finding: the string had to be *in the result*,
not in a summary elsewhere.

### A.2 — PASS

**Route:** `helpSearch("filter rows")` (0) → `helpSearch("filter")` → `helpSearch("grid")` →
`guides.editors.grid` → a sample grid page → its `editor.elements` and `editor.$help`
**Answered from:** `editors/grid.md` — "Click the filter icon on any column header to open filter
options", plus the filter bar above the grid.

The change that matters: it answered **from the guide**, not from the DOM. Run 1 ended up calling
`script.execute` and reporting a CSS class name (`avg-filter-button`); this run read the page that
describes the control and told the user where to look in the user's own terms. Its verdict names the
deciding step as "reading `guides.editors.grid` directly".

Findings, recorded rather than fixed:

- **Three `helpSearch` calls before reaching the corpus.** The same routing wobble EPIC-092 recorded
  and partly fixed. The empty-result pointer to `guides.search` is present and correct; the agent
  again preferred more `helpSearch` guesses to taking it. Nothing further to fix in the surface —
  this is the residue EPIC-094's schemas and any future search wording will have to move.
- **It still built a sample grid to inspect.** Harmless and arguably diligent, but it shows the
  instinct to check the running app persists even once the guide has answered. Worth watching after
  EPIC-094: a layout schema should make the inspection unnecessary.

## Verdict

**Gate passed** on the second run, with the failure of the first being the epic's most useful output.
A.1 is the epic's headline claim and it now holds from a cold start with no prior knowledge. A.2
passes on the answer's *source*, which is what this suite measures, and stands as the pre-schema
baseline for EPIC-094.

## Housekeeping

Read-only except where a scenario opened its own pages; every page the runs created was closed
afterwards, the user's own pages and pinned tabs were left untouched, and the About page — a
singleton at id `about-page` — was never closed.

## Housekeeping

Read-only except where a scenario opened its own pages; every page the runs created was closed
afterwards, the user's own pages and pinned tabs were left untouched, and the About page — a
singleton at id `about-page` — was never closed.
