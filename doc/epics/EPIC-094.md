# EPIC-094 — Per-screen guides and layout schemas

**Status:** Active
**Started:** 2026-09-07
**Roadmap:** epic 3 of 4 in the [in-app guides roadmap](../in-app-guides-roadmap.md)
**Builds on:** [EPIC-092](EPIC-092.md) — the corpus in `assets/guides/`, front matter with
`editorId`, `src/shared/guides/`, the main-process `guides` node with `guides.<page>.layout` already
returning a no-schema message; [EPIC-093](EPIC-093.md) — the About guide browser, the
`persephone-guide://` scheme, the Menu Bar item and `F1`'s `editorId` mapping

## Goal

Answer **"where is X on screen?"** from the corpus, in words the user and the agent both use.

EPIC-092 moved the documentation into the app and EPIC-093 put a reader in front of the user. Both
gates passed, and both left the same question open. Asked *"where is the control that filters rows in
a grid?"*, a Haiku agent with `call` as its only tool searched the corpus, found nothing positional,
inspected the DOM instead, and reported **`.avg-filter-button`** — a CSS class
([run A.2](../../qa/runs/2026-09-07-epic-093-about-guide-browser.md)). The answer was technically
correct and useless to a user, and it was our fault, not the model's: no page in the corpus says
where anything is.

This epic writes that down. Every editor and every non-editor screen gets its own guide page carrying
a `## Layout` schema — a hand-drawn map of the screen's regions with each control named as the user
sees it *and* as `elements` names it — and every `elements` entry gains a `where` phrase drawn from
the same schema. When the three strings agree, an agent can go from a question to
"the filter icon sits on each column header, at the right edge" to `highlight("columnFilter")`
without ever reading the DOM.

## Why this is an epic and not a documentation chore

1. **Three surfaces have to agree, and only one of them is prose.** A schema names a control; an
   `elements` entry names the same control; `highlight` resolves that name to a DOM node. Today the
   first does not exist, the second has no positional field, and nothing keeps them in step. Adding
   `where` to the shared element type touches the type, the builder, the hint renderer and
   `helpSearch` — the path every surface descriptor in seven epics resolves through.
2. **The content is a merge, not a move.** EPIC-092 deliberately kept both sides of every
   user/agent overlap: `editors/index.md` (935 lines, one section per editor, user voice) and
   `agents/ui-editors.md` (309 lines, the same editors by id, agent voice) describe the same
   application twice, and `agents/ui.md` (336 lines) is the only description of the chrome. Merging
   them and splitting per screen is the rewrite EPIC-092's principle 2 deferred to here — it needs
   its own review because the diff cannot be checked mechanically.
3. **A schema can only be written by looking at the screen, and only verified the same way.**
   Nothing derives it from the DOM (roadmap principle 3): a snapshot says what exists, not what a
   control is *for* or where a user would look for it. So the accuracy of every schema is a live-app
   check, and that check is Claude's, not Codex's — it is the same faculty as a plan review, and it
   does not survive being summarised.
4. **Retirement has a gate.** `persephone://guides/ui` and `ui-editors` are pinned URIs. They may
   stop naming their own files only once the merged pages answer for them.

## Decisions

Recorded here so the tasks do not re-litigate them.

### 1. No screenshots

The roadmap leaves this open with a default of no images in the first pass; **taken as defaulted.**
Three reasons, in order of weight: a screenshot dates the moment the toolbar changes and nothing in
the build detects it, while a stale ASCII schema at least reads as prose that disagrees with the
screen; `call` returns text, so an image costs the agent nothing but buys it nothing either; and the
schema is the artifact both readers share, which is the whole point of the epic — adding a picture
beside it invites the two to drift. Revisit after EPIC-095 if users say the schemas are hard to read.

### 2. One page per editor, even when the page is short

The roadmap's sketch names `grid.md`, `notebook.md`, `browser.md`, `markdown.md`, `rest-client.md`,
`log-view.md`, "…". The alternative considered was grouping the thin viewers (image, video, SVG,
Mermaid, HTML preview) into one `editors/viewers.md`. Declined: front matter carries **one**
`editorId` per page (`src/shared/guides/index.ts:19-24`), and that field is what `F1`,
`guides.<page>.layout` and `pages[i].editor` help map through. A grouped page would either take one
id and mis-map the rest, or take none and leave five editors with no guide — reintroducing the gap
this epic exists to close. A four-paragraph page with a two-box schema is honest; a missing mapping
is not.

`register-editors.ts:132` registers **32** ids, and they are not all editors a user chooses:
`settings-view`, `about-view`, `tools-hub-view`, `mcp-view`, `mneme-config`, `mneme-root`,
`board-info`, `toolset-view` are **app screens** that happen to be implemented as editors. Those
take their `editorId` on the matching `screens/` page rather than an `editors/` page — the field
does not care which folder it sits in, and a user pressing `F1` on Settings should land on the
Settings screen guide. `storybook-view` is a development-only editor and gets no page (recorded
here so US-1374 does not invent one). That leaves 23 ids on `editors/` pages and 8 on `screens/`
pages, all 31 mapped.

The three existing dedicated pages (`editors/grid.md`, `notebook.md`, `browser.md`) are the **base**
for their editors — they are the user-voice pages and they are longer and better than the catalogue
sections. The catalogue section and the `ui-editors` section merge *into* them, not over them.
`grid.md` claims one id, so `grid-json` / `grid-csv` / `grid-jsonl` cannot all map through front
matter as it stands; see decision 10.

### 3. `editors/index.md` becomes a short catalogue

It stops being the 935-line editor manual and becomes a one-screen table: editor, id, what it opens,
link to its page. It keeps `audience: both` and absorbs `ui-editors.md`'s "how a user gets to an
editor" and "switching editors" framing, which is catalogue-level and belongs at the index.

### 4. `screens/` pages: six, absorbing `agents/ui.md`

`screens/header.md`, `menu-bar.md`, `settings.md`, `sidebar.md`, `tabs.md`, `dialogs.md`, plus
`screens/index.md` as the catalogue. `agents/ui.md`'s anatomy sections map onto them almost
one-to-one (*Header strip* and *Status indicators* → `header.md`; *The Menu Bar* → `menu-bar.md`;
*Settings* and *Settings worth knowing about* → `settings.md`; *Page area and sidebar* → `sidebar.md`;
*A page tab* → `tabs.md`), and `doc/architecture/ui-element-contract.md`'s "Shell selectors" section
is already organised the same way — which is the evidence that these are the real seams, not six
folders invented for symmetry. `sidebar.md` covers Explorer, Search and Boards panels in one page:
they share the panel frame and a user switching between them is on one screen, not three.

`agents/ui.md`'s agent-only material (stable selectors, `highlight` mechanics, "in a browser page —
not supported", errors and verification) stays agent-voiced and moves to `screens/index.md`, which
therefore carries `audience: both` with an agent section rather than splitting into a fourth voice.

### 5. `where` is an optional free-text spatial phrase, not a structured position

`where?: string` on the shared element entry, holding the same words the schema uses: *"top-right of
the grid toolbar"*, *"right edge of each column header"*, *"bottom status line, left end"*. Not an
enum, not coordinates. An enum would need a vocabulary that survives every screen and would still be
translated back into a sentence at the point of use; coordinates are what the roadmap forbids. The
field is optional because a control with no sensible position (a whole-page region, a state-only
affordance) should say nothing rather than say something vague.

**Where it has to surface, measured rather than assumed.** There is no "element hint list" to add a
field to: `src/shared/ai-vision/hint.ts` does not render `descriptor.elements` at all — its
`formatMembers` / `formatChildren` / `buildHelp` print members, children, overview and help only.
So an element's text reaches an agent through exactly two paths, and `where` must be added to both:

1. The resolved `elements` **value**, built in `createElements`'s `provide("elements")`
   (`src/renderer/scripting/ai-vision/elements.ts:117-125`), today `{ name, purpose, selector,
   visible }`. This is the path an agent takes when it is already on a page.
2. The `helpSearch` element hit, `src/shared/ai-vision/help-search.ts:82-91`, whose `matchedLine` is
   `element "<name>" — <purpose>` plus the `highlight` pointer. `where` joins the line *and* the
   matched text, so "where is the filter" can match on the position phrase itself.

A positional fact the agent does not receive in the result it is holding does not exist. That is
EPIC-092's and EPIC-093's shared lesson arriving a third time; both epics' gates failed on exactly
this shape, and both fixes were "put the string where the agent is already looking".

Note that `SETTINGS_ELEMENTS` (`namespaces/settings.ts:152`) is **generated** from
`SETTINGS_CATALOG.flatMap`, one entry per setting key with the section's selector. Its `where` is
therefore a property of the *section*, not of each of the 24 keys — one phrase per section,
inherited. US-1377 owns that.

### 6. The retired URIs re-point; they do not concatenate

`persephone://guides/ui` → `screens/index.md`, `persephone://guides/ui-editors` →
`editors/index.md`. The mapping is one `file:` field per entry in `src/main/mcp/manifest.ts`
`resourceFiles`, so re-pointing is a two-line change and keeps the URI, name and description
promise intact. Concatenating the whole merged folder behind one URI was considered and declined:
`persephone://guides/full` already exists for "give me everything", and a resource that silently
grew from 336 lines to a folder would blow past what a resource read is for. A client that pinned
`ui` gets the catalogue plus links, which is what the page was.

### 7. The "?" affordance is decided by cost, in US-1378

The roadmap mentions a "?" affordance "only if it is cheap and consistent". The cheap and consistent
form is a **Menu Bar item** — *Guide for this page* — beside the existing *User Guide* item added in
EPIC-093 (`src/renderer/ui/sidebar/MenuBarView.ts`), routing through the exact code path `F1`
already uses. A per-editor "?" button in every toolbar is not cheap: it is a change to every editor's
toolbar view, it competes for space on toolbars that are already full, and it would need its own
`data-name` and `elements` entry per editor. Default: the Menu Bar item ships, the per-toolbar button
is recorded as deferred to EPIC-095 or later.

### 8. Schema shape, fixed once

Applied by every page so an agent that has read one schema can read them all:

- A fenced block (no language tag) holding `+--+`/`|` boxes, top-to-bottom in screen order.
- Region rows carry the controls the user sees, in left-to-right order, in `[Label]` brackets;
  icon-only controls are described in words (`[Filter ⌕]`, `[⋮ more]`).
- A right-hand margin comment after the box gives the spatial phrase for that row
  (`| top; filter at top-right`) — the same words as the `where` field.
- Below the block, a short list maps **user-facing label → `elements` name** for every control that
  has one, and says explicitly which drawn controls have no `elements` entry and why.
- State-dependent controls get a **second, smaller block** labelled with the state
  (`### When the find bar is open`), never omitted and never merged into the main diagram.
- No pixels, no sizes, no colours. Spatial words only.

### 9. A schema names a control that has no `elements` entry → add the entry

When a schema draws a control the agent cannot address, the default is to **add** the `elements`
entry with a `data-name` per [ui-element-contract.md](../architecture/ui-element-contract.md), not
to drop the control from the schema — an undrawn control is invisible to both readers, which is
worse than an unaddressable one. The exception is a control the agent must not drive (a destructive
confirm, an OS dialog); those stay drawn and are listed as "no `elements` entry: <reason>".

### 10. Front matter needs a `screen` key and a multi-id `editorId` — and today it has neither

Two facts found by reading `src/shared/guides/front-matter.ts` rather than the roadmap, both of
which change a task's scope:

**`screen:` is not supported, and adding it does not fail loudly.** The parser accepts exactly
`title | audience | summary | editorId`; any other key makes `parseValue` return `undefined`, which
triggers the **whole-file fallback** — front matter ignored, raw YAML rendered as body text, title
taken from the filename. That is the same class of defect EPIC-093 shipped and had to fix (front
matter rendering as visible text above a guide's title). So US-1375 must extend `GuideFrontMatter`
and the parser with `screen?: string` **before** any `screens/` page declares one, and an unknown
key should be tolerated rather than poisoning the page — a strictly better failure mode for a corpus
that two more epics will keep editing.

**Five `editorId` values are already claimed twice.** `browser-view` by both `agents/browser.md`
and `editors/browser.md`; `notebook-view` by both `editors/notebook.md` and `formats/notebook.md`;
`graph-view`, `link-view` and `log-view` only by `formats/*` pages, which are `audience: agent`.
`F1` maps an active editor to a page through this field, so today it either resolves to an
agent-only format reference or to whichever page the index happens to return first. Rule, enforced
in US-1378: **`editorId` is unique across the corpus and belongs to the user-facing page.** The
`formats/*` and `agents/*` pages drop the field and gain a prose link to the editor page instead;
the mapping is then a function, not a race.

`grid-json` / `grid-csv` / `grid-jsonl` are one screen and one page, so `editorId` becomes a
**list** (`editorId: ["grid-json", "grid-csv", "grid-jsonl"]`) rather than three near-duplicate
pages. US-1375 makes the parser accept a single value or a list, keeping the single-value form
working unchanged.

## Tasks

| Task | Title | Depends on |
|------|-------|------------|
| US-1373 | `where` on `elements`: shared type, `createElements`, the `elements` value, `helpSearch` hits, and `GRID_ELEMENTS` filled as the worked example | — |
| US-1374 | Editor pages: merge the two catalogues, split one page per editor, `editorId` front matter | 1375 (parser) |
| US-1375 | `screens/` pages and the front-matter extension: `screen` key, list-valued `editorId`, tolerant unknown keys | — |
| US-1376 | `## Layout` schemas for every editor page, and `where` for the editor facade element lists | 1373, 1374 |
| US-1377 | `## Layout` schemas for every `screens/` page, and `where` for the chrome and settings element lists | 1373, 1375 |
| US-1378 | Screen → guide mapping: unique `editorId`, facade `$help` pointers, `F1` coverage, the Menu Bar *Guide for this page* item, resource aliases, the no-schema message, the `/userdoc` step | 1374, 1375 |
| US-1379 | QA surface, the "where is X?" gate run across four screens plus the A.2 baseline, and its remediation | all |

US-1375 runs first because it owns the parser change every page's front matter depends on; US-1373
is independent of all of it. The two schema tasks need both the field and their pages; US-1378 needs
the pages to point at; US-1379 is the gate.

**Volume, so no task is mis-sized.** The element lists hold roughly **344** entries across 33 static
consts and four dynamic panel kinds — about 240 in the editor facades (US-1376) and about 104 in the
chrome, tab, panel and settings lists (US-1377). `where` is filled from the schema that task just
wrote, not guessed separately, which is why the field lands in US-1373 with one list filled and the
other 343 phrases follow their own screens.

## The gate

`mcp-test-agent-call` (Haiku, `call` only, no prior knowledge), on **five** requests:

1. *Where is the control that filters rows in a grid?* — the A.2 baseline, re-run verbatim.
2. *Where do I type an address in the built-in browser?*
3. *Where do I change a setting from the Menu Bar?*
4. *How do I tag a note in a notebook, and where is that control?*
5. One free "where is X" on a screen the agent picks itself.

**Pass** requires, for each: the answer names a **screen region in the schema's own words**, it came
from `guides.*` and not from the DOM or a CSS class, and the agent called `highlight` on the element
by its `elements` name. A correct answer sourced from `script.execute` DOM inspection is a **fail** —
that is precisely what A.2 already did. Logged to `qa/runs/2026-09-07-epic-094-where-is-x.md`. The
epic does not close on a failed gate: fix what misled the agent and re-run.

## Risks

- **The merge loses a fact.** 1244 lines of user prose and 645 of agent prose become ~30 pages, and
  a dropped sentence is invisible in a diff that large. Mitigation: US-1374 and US-1375 each carry a
  coverage table mapping every source heading to its destination page, checked before the task
  closes; nothing is deleted that is not placed.
- **A schema is confidently wrong.** The failure mode is not an ugly diagram, it is a diagram that
  reads well and puts the control on the wrong side — which then propagates into `where`, into the
  agent's answer, and to the user. Mitigation: every schema is checked against the live window
  (`window.screen.snapshot()`, `pages[i].editor.elements`) by Claude, not by the author, and the
  gate is a weak model reading the schema cold.
- **`where` on the shared element type has blast radius.** It is the same type every surface
  descriptor uses. Mitigation: strictly additive and optional; US-1373 changes rendering only where
  `purpose` already renders.
- **Scope creep into EPIC-095.** Deleting `docs/`, re-pointing the README and rewriting the release
  process are epic 4. This epic touches `/userdoc` only to add the schema re-check step.

## Needs user check

Recorded rather than blocking; work proceeds on the defaults above.

- **Screenshots stay out** (decision 1). If the user wants them, it is an additive pass over
  finished pages, not a rework.
- **The per-toolbar "?" button** is deferred in favour of the Menu Bar item (decision 7).
- **Session restore prose**, deferred from EPIC-092's gate (does the corpus say whether session
  restore can be disabled?) — folded into US-1375's `tabs.md`, since that is the page that owns it.
- **`editors/index.md` shrinks from 935 lines to a table.** The removed prose is not lost — it lands
  on the per-editor pages — but anyone who bookmarked the long catalogue sees a different page.
