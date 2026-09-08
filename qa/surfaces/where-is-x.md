# Surface QA: "where is X?" — layout schemas and `where`

Manual scenarios for the per-screen layout schemas and the `where` field on `elements`, landed by
EPIC-094. Run through `call` only; do not add or run automated tests or a test harness for this
surface. Leave pinned tabs untouched and close only pages created by the scenario.

This file is the third in a set, and the three differ in what they measure. [guide-questions.md](guide-questions.md)
asks whether an agent can **answer** from the corpus. [about-guide-browser.md](about-guide-browser.md)
asks whether it can **show** the answer on the user's screen. This one asks the narrower question
those two exposed and could not settle: whether the agent can say **where a control is** in words a
user standing in front of the screen can act on.

EPIC-093's run A.2 is the baseline and the reason this surface exists. Asked where a grid's row
filter was, a Haiku agent with `call` as its only tool searched the corpus, found nothing
positional, inspected the DOM, and answered **`.avg-filter-button`**. Correct, and useless: a CSS
class is not a place. The corpus now carries a hand-drawn `## Layout` schema for every editor and
screen, and every `elements` entry carries a `where` phrase in the schema's own words, so the same
question has a source that answers it.

## Gate rules

- **First call has no `path`.** The agent starts from the bare overview, as on every surface. An
  agent told "read `guides.editors.grid.layout`" has not tested discovery, which is the thing that
  failed in both prior epics.
- **The DOM is a failure, not a shortcut.** An answer sourced from `script.execute` DOM inspection,
  a CSS class, or a `selector` string is a **FAIL** even when it is factually right. That is
  precisely what A.2 already did, and the epic exists to remove the need for it. Reading a
  `selector` *field* off an `elements` result is not itself a failure — quoting it to the user as
  the location is.
- **A region, in the schema's words.** The answer must name a screen region the way the schema and
  the `where` phrase name it ("at the right edge of each column header", "the middle of the browser
  toolbar"). A vague direction ("in the toolbar somewhere", "near the top") is a `PARTIAL` and the
  finding is about the phrase, not the agent.
- **Pointing is part of answering.** The agent must call `highlight` on the control by its
  `elements` name. An answer with no highlight is a `PARTIAL`: the roadmap's whole claim is that the
  schema lets an agent go from the picture to `highlight(name)` without guessing.
- **Wrong turns are the data.** Record every path called before the right one. The routes worth
  watching for are `helpSearch` before `guides.search` (EPIC-092 fixed the pointer and EPIC-093's
  run ignored it), and reaching for `window.screen.snapshot()` — which returns an accessibility
  tree, not a place, and is the sophisticated version of reading the DOM.

## Result fields

Each scenario records: `Route` (`overview → <paths in call order>`), `Wrong paths` (`none` or every
incorrect path in order), `Answer` (the words the agent actually used for the location),
`Highlighted` (the `elements` name, or `none`), `Source` (`schema` / `where` / `DOM` / `other`), and
`PASS | PARTIAL | FAIL`.

## Scenarios

### B.1 — Where is the control that filters rows in a grid? (the A.2 baseline, verbatim)

**Request:** "Where is the control that filters rows in a grid? Point at it if you can."

Run verbatim so the result is comparable with
[the EPIC-093 run](../runs/2026-09-07-epic-093-about-guide-browser.md). The expected answer is a
button at the **right edge of each column header**, appearing when the header is hovered, the column
is filtered, or its filter popup is open — and `highlight("grid-column-filter")`.

The trap this scenario tests is that the control is **not on the toolbar**, which is where a reader
of the roadmap's illustrative sketch would look. An answer placing it in the grid toolbar is wrong
even though it sounds right.

### B.2 — Where do I type an address in the built-in browser?

**Request:** "Where do I type a web address in Persephone's browser?"

Expected: the address box occupying the **middle of the browser toolbar**, with the Go arrow at its
right edge; `highlight("url-input")`. Watch for an answer that gets the navigation buttons' order
wrong — they run **home, back, forward, reload**, not the order most agents will assume, and the
schema says so.

### B.3 — Where do I change a setting from the Menu Bar?

**Request:** "I want to change a setting. Where do I click, starting from the Menu Bar?"

Expected: the Menu Bar opens from the Persephone glyph at the far left of the header strip; the
Settings icon is the **last icon in the action row at the top of the left-hand category column**,
immediately right of *About*; `highlight("menubar-settings")`.

This is the scenario most likely to expose a stale phrase, because US-1378 inserted a new icon into
that row and shifted every icon after it.

### B.4 — How do I tag a note in a notebook, and where is that control?

**Request:** "How do I put a tag on a note in a notebook, and where is that control on screen?"

Expected: an answer from the notebook guide naming the region, plus a highlight of the relevant
`NOTEBOOK_ELEMENTS` entry. This scenario tests a **two-part** question — a how and a where — because
the epic's claim is that one page answers both, and a run that answers the how from the guide and
the where from the DOM is the split this surface is watching for.

### B.5 — Agent's choice

**Request:** "Pick any Persephone screen you like and tell me where one of its controls is."

Free scenario. Its value is which page the agent reaches for unprompted and whether it lands on a
schema at all — the same routing question EPIC-092 measured with the summaries. Record the screen
it chose; a screen nobody thought to check is the most useful result this surface can produce.
