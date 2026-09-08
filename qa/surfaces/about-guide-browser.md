# Surface QA: the About page as guide browser

Manual scenarios for the About page's two panes and the `about-view` facade, landed by EPIC-093.
Run through `call` only; do not add or run automated tests or a test harness for this surface.
Leave pinned tabs untouched and close only pages created by the scenario.

This file is the pair to [guide-questions.md](guide-questions.md), and the difference is the whole
point. That file asks whether an agent can *answer* from the corpus. This one asks whether it can
**put the answer on the user's screen** — the roadmap's "same page": the user and the agent looking
at one document, in one place, using the same words for the same things. An answer typed into chat
and an answer showing in the pane are different deliverables, and only the second one survives the
end of the conversation.

## Gate rules

- **First call has no `path`.** As in every surface, the agent starts from the bare overview. An
  agent that jumps straight to `pages[i].editor.open(...)` because the request named it has not
  tested discovery.
- **The About page is a singleton.** Its id is always `about-page`, it is never created twice, and
  it must not be closed by a scenario — the user's own About tab, if open, is the one being driven.
- **Guide tabs are the scenario's own pages.** A guide opened as an `md-view` tab
  (`persephone-guide://…`) was created by the run and may be closed at the end. Nothing else may be.
- **Showing beats telling.** A scenario that ends with the right guide *named in prose* but the pane
  still on contents is a `PARTIAL`, and the finding is about the facade's discoverability, not the
  agent. The measure is what is on screen.
- **Wrong turns are the data.** Record every path called before the right one, exactly as
  `guide-questions.md` does. This surface has two plausible-but-wrong routes worth watching for —
  `pages.openUrl("persephone-guide://…")`, which opens a *tab* rather than using the pane, and
  `pages.showAboutPage()` followed by no navigation at all — and both are findings about the member
  summaries rather than failures.

## Result fields

Each scenario records: `Route` (`overview → <paths in call order>`), `Wrong paths` (`none` or every
incorrect path in order), `On screen` (what the pane was actually showing at the end, read back from
`pages["about-page"].editor.current`), and `PASS | PARTIAL | FAIL`.

## Scenarios

### A.1 — Show me the grid guide

**Request:** "Show me the guide for the grid editor."

**Start:** The runner's first operation is `call` with no `path`.

**Expected route:** overview → `guides` (or `pages`) → `pages["about-page"].editor.open("editors/grid")`.

**Verify:** `pages["about-page"].editor.current` is `{ kind: "guide", path: "editors/grid" }`, the
About page is active, and `elements` reports `about-guide-body` and `about-guide-breadcrumbs` as
`visible: true` while `about-guide-tree` is `visible: false`.

**Tests:** the epic's headline capability, and whether an agent asked to *show* something finds the
pane rather than opening a tab or answering in prose. Watch which node it reaches first: `guides`
holds the corpus, `pages[…].editor` holds the screen, and the request needs both.

### A.2 — Where is the filter control?

**Request:** "Where is the control that filters rows in a grid? Point at it if you can."

**Start:** The runner's first operation is `call` with no `path`.

**Expected route:** overview → `guides.search("filter rows")` or `guides.editors.grid` → the grid
page → `pages["about-page"].editor.open("editors/grid")`, and — if a grid page is open — that
page's own `editor.highlight(...)`.

**Verify:** the answer's words come from `editors/grid.md`, and the guide is on screen. If the agent
highlights a control on a real grid page as well, record it: that is the behaviour EPIC-094's layout
schemas are meant to make reliable, and this run is the baseline for how well it works **without**
them.

**Tests:** the "where is X" question the roadmap names, on a corpus that does not yet carry layout
schemas. A `PARTIAL` here is expected and is the measurement EPIC-094 starts from — record what the
agent had to guess.

### A.3 — The notebook JSON format, which the user cannot see by default

**Request:** "Show me the documentation for the notebook file format."

**Start:** The runner's first operation is `call` with no `path`.

**Expected route:** overview → `guides` / `guides.search` → `pages["about-page"].editor.open("formats/notebook")`.

**Verify:** the pane shows the guide, and the *Show agent guides* toggle is now on — `open()` turns
it on rather than refusing an `audience: agent` page, and leaves it on so the user can see and undo
what changed. Read `elements` and confirm `about-show-agent-guides` exists; return to contents with
`back()` and confirm the `agents` and `formats` folders are now listed in the tree.

**Tests:** the single-corpus decision from EPIC-092 seen from the *user's* screen, and whether the
declared side effect is discoverable from the member summary rather than a surprise.

### A.4 — Open it properly so I can keep it

**Request:** "I want the scripting guide open in its own tab so I can read it next to my code."

**Start:** The runner's first operation is `call` with no `path`.

**Expected route:** overview → `pages.openUrl("persephone-guide://scripting/index")`.

**Verify:** a new `md-view` page exists whose `filePath` is `persephone-guide://scripting/index` and
whose title is the guide's front-matter title, not a file name and not a path inside the install
directory. Call it a second time and confirm the existing tab is focused rather than duplicated.

**Tests:** the distinction A.1 does not test — the pane and a tab are different requests, and the
agent has to tell them apart from the member summaries. Note if it reaches for the pane here, or for
`openUrlInBrowserTab`.

### A.5 — A guide that does not exist

**Request:** "Open the guide about the plugin marketplace."

**Start:** The runner's first operation is `call` with no `path`.

**Verify:** `open()` throws an error naming the requested path and pointing at `guides` for valid
ones, the pane does **not** change, and no page is created. The agent should then discover that no
such guide exists and say so — rather than opening something adjacent and presenting it as the
answer.

**Tests:** the no-silent-no-op rule on this surface, and whether an actionable error routes the
agent to discovery instead of to a guess. An agent that substitutes a different guide without saying
so is a `FAIL` and a finding about the error's wording.

### A.6 — A folder, not a page

**Request:** "Show me the editors documentation."

**Start:** The runner's first operation is `call` with no `path`.

**Verify:** `open("editors")` resolves to the folder's index page and `current.path` reports
`editors/index` — the page actually on screen, not the string the caller typed. `open("formats")`,
by contrast, must fail with an error that names the folder's pages, because that folder has no index.

**Tests:** that the addressable things an agent sees in the guide tree are the addressable things the
facade accepts. This was a real defect during the epic: `open("editors")` was refused although
`guides.editors` answers for it.

### A.7 — Back, and the history it pops

**Request:** none — drive this one directly.

**Call:** `open("editors/grid")`, then `open("scripting/index")`, then `back()`, then `back()`, then
`back()` once more.

**Verify:** the first `back()` returns to `editors/grid`, the second to
`{ kind: "contents" }`, and the third **throws** an actionable empty-history error rather than
returning quietly. `current` never reports `path: null` — on contents the key is absent.

**Tests:** the two rules EPIC-091 established, on the newest surface: absent keys omitted rather than
nulled, and an impossible action erroring rather than lying.

### A.8 — The user's own way in

**Request:** none — drive this one directly, then look at the screen.

**Call:** click `menubar-about` (Menu Bar), and press `F1` on a browser page and on a page with
no matching guide.

**Verify:** the Menu Bar item opens About at **contents** even when the pane was showing a guide;
`F1` on the browser page opens the Browser guide through its `editorId` front matter; `F1` on a page
with no mapping opens contents and reports nothing as an error; and `F1` inside a focused Monaco
editor leaves Monaco's command palette alone.

**Tests:** the entry points a user actually uses, and the rule that a missing screen-to-guide mapping
is the normal path rather than a failure — most guide pages will not carry `editorId` until EPIC-094.
