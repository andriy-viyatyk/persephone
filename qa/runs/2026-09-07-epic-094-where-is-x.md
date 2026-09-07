# QA run — EPIC-094: "where is X?"

**Date:** 2026-09-07
**Surface:** [where-is-x.md](../surfaces/where-is-x.md), scenarios B.1 … B.5
**Runner:** `mcp-test-agent-call` (Haiku, `call` as its only tool, no prior knowledge of Persephone)
**Epic:** [EPIC-094](../../doc/epics/EPIC-094.md)
**Baseline:** [EPIC-093 run A.2](2026-09-07-epic-093-about-guide-browser.md)

Five requests in five independent sessions, each starting from the bare overview. The question the
epic exists to answer is not "can the agent find the guide" — EPIC-092 settled that — but "can it
say **where** a control is, in words a user in front of the screen can act on".

**The baseline is one sentence long.** Asked the same first question a day earlier, an agent read
the DOM and answered **`.avg-filter-button`**.

## Result

| # | Scenario | Region named | Source | Highlighted | Verdict |
|---|----------|--------------|--------|-------------|---------|
| B.1 | Grid row filter (A.2 verbatim) | right edge of each column header, on hover / while filtered | `guides.editors.grid` | called by name; overlay found no visible target | **PARTIAL** |
| B.2 | Browser address box | across the middle of the browser toolbar, after the navigation buttons | `guides.editors.browser` | `url-input` | **PASS** |
| B.3 | Settings from the Menu Bar | last icon in the action row at the top of the left category column | `window.menuBar.elements` (`where`) | `menubar-settings` | **PASS** |
| B.4 | Tagging a note (after fix) | tag chips on the note card's title row, between the title and Expand/Delete | `guides.editors.notebook` | none — chips have no entry | **PARTIAL** |
| B.5 | Agent's choice — page tabs | inside the tab, after the tab root and before the title | `guides.screens.tabs` + `pages[i].tab.elements` | offered `tab-language` | **PASS** |

**3 PASS, 2 PARTIAL, 0 FAIL. No answer in any session came from the DOM, a CSS class or a
`selector` string.** That is the gate's central criterion and the baseline's exact failure.

## What the run proves

**The corpus answers positional questions now, and the agent takes it.** Every session reached a
`## Layout` schema or a `where` phrase and quoted it. B.1 is the direct comparison: same question,
same model, same single tool — DOM inspection and a CSS class before, "the right edge of each column
header, appearing when you hover it" from the guide after.

**`where` works as a second, independent route.** B.3 never opened a guide page. It went
`helpSearch("menu") → window.menuBar → window.menuBar.elements` and read the phrase off the element
entry, quoting it back verbatim — *"right end, immediately right of Guide for this page"*. That
phrase had been wrong until hours earlier: US-1378's new Menu Bar item shifted every icon in the row
and left `menubar-settings` claiming it sat immediately right of *User Guide*. The epic broke its own
artifact in its last task, and this scenario is the one that would have caught it.

**Two schemas were wrong and the run found one of them.** B.4 failed its first pass with a hedge —
*"the UI integration for tag editing appears in the note's metadata when viewed/expanded"* — which is
not a place. Investigating it live showed the notebook guide never said where a tag is added, **and**
that its schema drew the Categories and Tags panels to the *right* of the note cards when they are on
the left (`notebook-categories` at x=2, note cards at x=248). Both were fixed and B.4 re-run clean.
This is the epic's own stated risk realised: a diagram that reads well and puts the region on the
wrong side, derived from view code and never checked against the window.

## Two pointing gaps, both with reasons, both recorded rather than fixed

The surface counts a missing `highlight` as PARTIAL, so these are the two partials:

1. **`grid-column-filter` is addressable but not highlightable at rest.** The agent did exactly what
   the epic claims it should — went from the schema to `highlight("grid-column-filter")` without
   guessing — and the overlay found nothing, because the button is `display: none` until its header
   is hovered, its column is filtered, or its popup is open. `visible: false` is correct and
   documented (US-1373 recorded it as an aggregate). Whether a highlight should be able to *reveal* a
   hover-gated control is a real question and a new one; it belongs to `highlight`, not to this epic.
2. **Note tag chips have no `elements` entry.** Recorded in the notebook page's no-entry list as
   repeated per-note content. The grid's filter is the precedent for adding a repeated control with
   an explicit selector and `highlightOptions: { all: true }`, so consistency argues for giving the
   chips the same treatment; it needs a `data-name` in `NoteItemView` and was outside the reviewed
   plans at close.

Neither is a regression and neither blocks the epic's claim, which is about the words. Both are
carried into EPIC-095's list.

## Routing notes

- `helpSearch` before `guides.search` still happens (B.1, B.2, B.4 all opened with `helpSearch`),
  but it is no longer a dead end: the searches led to the right guide anyway. EPIC-093's finding
  that the `helpSearch → guides.search` pointer gets ignored stands, and stays a judgement problem
  rather than an information one.
- Nobody reached for `window.screen.snapshot()`. That was the sophisticated version of reading the
  DOM and the surface was watching for it.
- B.1's second run created its own grid page to verify against, then read `elements` off it. Reading
  a `selector` *field* is not the failure the DOM was — it quoted the guide to the user and used the
  selector only to try to point.

## Housekeeping

Pages created by the runs (`zz-epic094-note`, `Grid Filter Demo`) were closed; the user's Tor browser
page was reported restricted and never touched; no pinned tab was altered.
