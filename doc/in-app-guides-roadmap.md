# In-App Guides Roadmap — documentation lives where it is used

**Date:** 2026-09-07
**Builds on:** the agent transparency epics EPIC-084 … EPIC-091 ([epics/completed.md](epics/completed.md);
the roadmap document itself was retired 2026-09-07 and lives in git history) — `call` is
the only MCP tool; every surface has a descriptor and, where it is on screen, an `elements` list — and
the existing agent guide corpus (`assets/mcp-res-*.md`, served as `persephone://guides/*`).
**Tracking:** each epic below gets its own `doc/epics/EPIC-XXX.md` when it starts and appears on
[active-work.md](active-work.md) only while active. This document is the sequence and the rules;
it is not a dashboard.

## The goal

User documentation moves **out of the GitHub repository and into the application**, where the two
readers who actually consult it can reach it without leaving what they are doing:

- **The user**, from a redesigned About page that is also the guide browser. Developers do not read
  manuals before using a tool; they discover by analogy with the software they use all day, and
  when something does not behave as expected they ask an agent. The guide has to be one click away
  at that moment, inside the app, not a link to `github.com/.../docs`.
- **The agent**, through `call`, under one root node — the same pages, the same words. When the
  user asks "how do I filter this grid?" the agent reads the grid guide the user could have read,
  and answers in the guide's terms.

Two things make the agent's copy better than a manual: **search** (`guides.search("filter rows")`
returns the matching passages with their page path), and **screen layout schemas** — every screen's
guide carries a hand-written map of where its controls sit, so the agent can say "the filter icon
is at the top-right of the grid toolbar" because the schema places it there. User and agent look
at the same picture and use the same names for the same things.

At the end, `docs/` is deleted from the repository. The README links to the guide folder inside
`src`/`assets` for anyone who wants to read on GitHub, but the shipped copy is the canonical one.

## Principles

1. **One corpus, two audiences — one root, not two.** The user guides and the agent guides
   (`mcp-res-*.md`) describe the same application and today overlap heavily (`docs/editors.md`,
   931 lines, and `assets/mcp-res-ui-editors.md` both catalogue every editor). They become **one
   folder of markdown pages** where front matter says which audience each page serves: `user`,
   `agent`, or both. Most pages are both. Agent-only pages exist (notebook JSON format, `ui-push`
   message shapes); user-only pages exist (installation). Nothing is written twice.
   A separate `agentGuide` root was considered and declined (2026-09-07): an agent asked "how do I
   make a notebook" needs the user's notebook guide and the notebook JSON format in **one** search,
   and audience is a property of a page, not a second tree. Agent-only pages live in `formats/` and
   `agents/`; the About browser hides them behind a toggle, the agent tree shows all of them.
2. **Content moves before it is rewritten.** The first epic relocates the existing text verbatim
   and gets the plumbing working. Splitting `editors.md` per screen, merging duplicates, and adding
   layout schemas is a later epic with its own review. A move-and-rewrite in one step cannot be
   reviewed.
3. **Hand-written purpose, again.** Layout schemas are written by a person looking at the screen,
   the way `elements` purposes are. Nothing derives them from the DOM — a DOM snapshot is what
   `window.screen.snapshot()` already gives, and it does not say what a control is *for* or where a
   user would look for it.
4. **Every guide is a `call` path; MCP resources are aliases.** Some models never read MCP
   resources — they do not know the protocol step, or refuse it — which the first QA runs against
   `persephone://guides/*` showed (user observation, recorded 2026-09-07). The agent already uses
   `call`, so every guide, agent-facing ones included, is reachable as a `guides.*` path. The twelve
   resource URIs are kept for clients that do read resources, but they are served from the same
   files; `assets/mcp-res-*.md` as a separate corpus goes away in EPIC-092.
5. **Retire nothing until its replacement passes the same gate.** `docs/` is deleted only after the
   in-app guides are reachable by both readers and the `mcp-test-agent-call` skill (Haiku, `call`
   only, no prior knowledge) answers the QA guide questions from `guides.*` alone.

## Where the pages live

`assets/guides/` — shipped with the app the way `assets/mcp-res-*.md` and `assets/editor-types/`
already are (`electron-builder.yml` `extraResources`), read at request time through the existing
mtime-cached loader (`src/main/mcp/manifest.ts:117-129`, `readGuideFile`), so an edit to a guide is
visible without a rebuild in dev and the packaged app carries its own copy. No build-time bundling:
the repo has no `?raw` or `import.meta.glob` usage today and the loader already solves freshness.

Structure mirrors what the guide tree will show:

```
assets/guides/
  index.md                    # the home page (today's docs/index.md, trimmed)
  getting-started.md
  whats-new.md                # release notes, moved here from docs/
  tabs-and-navigation.md
  shortcuts.md
  encryption.md
  editors/
    index.md                  # the catalogue (from docs/editors.md + mcp-res-ui-editors.md)
    grid.md  notebook.md  browser.md  markdown.md  …   # one page per screen (EPIC-094)
  screens/
    header.md  menu-bar.md  settings.md  sidebar.md    # non-editor screens (EPIC-094)
  scripting/
    index.md  api/…                                    # docs/scripting.md and docs/api/*
  agents/
    index.md                  # mcp-res-overview.md: the mental model, reading order, habits
    mcp-setup.md  agent-tools.md  boards.md  mneme.md  tools.md  browser.md  pages.md  scripting.md
  formats/
    notebook.md  links.md  graph.md  ui-push.md         # today's agent-only format resources
  manifest.json               # or front matter per page — see EPIC-092 decision
```

Each page starts with a short front-matter block: `title`, `audience` (`user | agent | both`),
`summary` (one line, shown in the tree and in `guides` hints), and for screen pages the `editorId`
or `screen` it documents so the app can jump from a screen to its guide. The existing breadcrumb
convention (`[← Home](./index.md)` on line one of every `docs/` page) is replaced by the tree; the
browser renders breadcrumbs from the path.

Relative links between pages stay relative markdown links, so the same files read correctly on
GitHub and in the app.

## The agent's view: the `guides` root node

`guides` is **already reserved at the root** (`src/renderer/scripting/ai-vision/root.ts:36`,
`RESERVED_ROOT_NAMES`, "owned by later tasks") and it is the word the MCP resources use
(`persephone://guides/*`). This roadmap takes that name rather than introducing `userGuide`: one
word, already promised, and the corpus is not user-only. **User decision needed** — if `userGuide`
is preferred for readability, it is a rename in one descriptor; record the choice in EPIC-092.

Served by the **main process** like `windows` and `main` (the files are main-owned; no window is
needed to read a guide), so `guides.*` works even when the renderer is busy or the window is closed.

| Path | Returns |
|---|---|
| `guides` | The tree: every page with its path, title and summary, grouped as the folders are. This is the overview a fresh agent reads once |
| `guides.editors` / `guides.formats` … | One folder: its pages |
| `guides.editors.grid` (also `guides["editors/grid"]`) | The page text, front matter stripped, with its `## Layout` schema if it has one |
| `guides.editors.grid.layout` | Just the layout schema — cheap when the agent only needs to point |
| `guides.search(query, limit = 10)` | Full-text search over every page the agent may read: matching passages (a heading and the paragraph or list item that matched) with their page path. Ranks title and heading hits above body hits. This is **text** search over markdown and sits beside `helpSearch`, which walks the descriptor graph (`src/shared/ai-vision/help-search.ts`) — the two answer different questions and the root overview says which to use for what |
| `guides.whatsNew` | The current release's section of `whats-new.md` — what changed since the agent last saw this app |

The `call("")` overview gains one line pointing at `guides` for "how does the user do X / where is
X on screen", and the `ui` and `editors` nodes' help texts point at the matching guide page.

**The MCP resources become aliases.** `src/main/mcp/manifest.ts` `resourceFiles` stops naming
`assets/mcp-res-*.md` and instead maps each existing URI to a page in `assets/guides/`
(`persephone://guides/notebook` → `formats/notebook.md`, `persephone://guides/ui-editors` →
`editors/index.md`, and so on); `persephone://guides/full` concatenates the `audience: agent` and
`both` pages. The URIs, names and descriptions do not change, so a client that pinned one keeps
working. `SERVER_INSTRUCTIONS` (`manifest.ts:18-31`) is rewritten to send the agent to `guides`
paths first and mention the resources only as an alternative. The `mcp-test-agent-call` run in
EPIC-092 is the gate: a fresh Haiku agent must answer the QA guide questions from `guides.*` without
touching a resource.

## The user's view: the About page becomes the guide browser

Design (user direction, 2026-09-07): the About page splits **left / right** with a vertical
divider.

- **Left** — today's card unchanged in content: icon, name, version, runtime versions, *Check for
  Updates* with its status line, GitHub repository and *Report issue* links
  (`src/renderer/editors/about/AboutView.ts`).
- **Right** — the guide browser. Its home state is a **contents** view: the guide tree with
  summaries, *What's New* at the top (with the current version's headline entries inline), and a
  *Resources* group — GitHub repository, issues, the boards catalogue, the MCP setup page.
  Clicking a guide renders it **in the right pane**: breadcrumbs, the markdown body, in-pane
  navigation for relative links and `#anchors`, a back button, and *Open in tab* to read it as an
  ordinary `md-view` page next to the work.

The right pane reuses the markdown editor's body view (`src/renderer/editors/markdown/
MarkdownBodyView.ts`) rather than a second renderer — it already scrolls to fragments, pushes
nav-back state, and re-targets local markdown links in place (`markdown-nav.ts`). The gap is the
**source**: link resolution assumes `file://` paths today. EPIC-093 introduces a guide link scheme
(working name `persephone-guide://editors/grid`) handled by the content pipeline — Layer 1 parser
sets the url, Layer 2 resolves an asset-backed pipe, Layer 3 opens `md-view` — so a guide can be
opened as a page from anywhere (a "?" affordance in an editor, the update-available toast, a menu
item, a `call` path) and links between guides navigate the same way in both hosts.

Two more entry points, both small:

- **Menu Bar** gets a *User Guide* item next to *About* (`src/renderer/ui/sidebar/MenuBarView.ts:104`);
  `F1` opens the guide for the **active screen** when it has one, otherwise the contents.
- The **update-available** flow's *What's New* link (`AboutView.ts:261`, an external GitHub URL
  today) opens the in-app `whats-new` page instead.

The About page gets an agent facade (`pages[i].editor` on `about-view` has none today —
`src/renderer/scripting/api-wrapper/PageWrapper.ts:96`): `open(path)`, `back()`, `current`, and an
`elements` list. That is the literal "same page": the agent can put the guide it is quoting in front
of the user with one call.

## Screen layout schemas — user and agent on the same page

Every page under `guides/editors/` and `guides/screens/` carries a `## Layout` section: an ASCII
box diagram of the screen's regions with the controls named as the user sees them (labels, icons
described in words) and as `elements` names them, so the agent can go from the picture to
`highlight(name)` without guessing.

```
+------------------------------------------------------------------+
| Toolbar:  [Add row] [Delete] [Columns ▾]        [Filter ⌕] [⋮]   |  top; filter at top-right
+------------------------------------------------------------------+
| Header row (click to sort, drag to reorder)                       |
| Cells … (double-click to edit, Ctrl+C/V paste from Excel)         |
+------------------------------------------------------------------+
| Status: rows / selected / filtered                                |  bottom-left
+------------------------------------------------------------------+
```

Rules the schemas follow, defined once in EPIC-094 and applied per screen:

- Regions are named in plain spatial words the agent can repeat to a user: *top-right of the
  toolbar*, *bottom status line*, *left sidebar panel*. No pixel positions.
- Every control in the schema that has an `elements` entry uses the **same name**, and the
  descriptor's `elements` entries gain an optional `where` string with that spatial phrase, so
  `guides.editors.grid.layout`, `pages[i].editor.elements` and `highlight` agree.
- Controls that only appear in a state (a find bar, a compare toolbar) are drawn in a second small
  diagram labelled with the state, not omitted.
- A schema is written by a person looking at the running screen and re-checked when the screen's
  toolbar changes; `/userdoc` gets that as an explicit step.

Whether a small **screenshot** belongs next to the schema is an open question (it helps the user,
costs the agent nothing since `call` returns text unless asked for an image block, and dates
quickly). The default is no images in the first pass; record the decision in EPIC-094.

## Epic sequence

| # | Epic | Delivers | Retires (when its replacement passes the gate) |
|---|---|---|---|
| 1 | ✅ **EPIC-092** — Guide corpus and the `guides` node | `assets/guides/` with front matter; a shared guide index module (`src/shared/guides/`) used by main and renderer; `docs/*.md` **and** the twelve `assets/mcp-res-*.md` moved verbatim into the tree (API reference included, unchanged); `guides`, `guides.<path>`, `guides.search`, `guides.whatsNew` served by main; `persephone://guides/*` re-pointed at the tree with unchanged URIs; overview, server instructions and node help pointers; QA guide-question set re-run through `call` only | `assets/mcp-res-*.md` as separate files (their content lives on in the tree). `docs/` stays until EPIC-095 |
| 2 | ✅ **EPIC-093** — About page as guide browser | Left/right split; contents view with What's New and Resources; in-pane markdown rendering with breadcrumbs, back, *Open in tab*; the guide link scheme through the content pipeline; Menu Bar *User Guide* item and `F1`; update toast opens in-app What's New; `about-view` agent facade | The external GitHub *What's New* URL in About |
| 3 | ✅ **EPIC-094** — Per-screen guides and layout schemas | `editors/index.md` (ex `docs/editors.md`) and the ex-`ui-editors` page merged and split into one page per editor; `screens/` pages for header, Menu Bar, Settings, sidebar panels (absorbing the ex-`ui` page); `## Layout` schema on every screen page; `where` on `elements`; screen → guide mapping (`editorId` front matter) behind `F1` and the "?" affordance; `mcp-test-agent-call` run on "where is X?" questions | The standalone `ui` and `ui-editors` pages (their URIs now alias the merged pages) |
| 4 | ✅ **EPIC-095** — Retire `docs/` | Delete `docs/`; README *Documentation* block points at `assets/guides/index.md` (and says the in-app copy is canonical); `CONTRIBUTING.md:164`, `build/README.txt` (already stale — describes `read_guide`), `assets/board-template/CLAUDE.md:724`, `assets/script-library/autoload/register-all.ts:11` re-pointed; release process step 3 rewritten for `assets/guides/whats-new.md`; `/userdoc` and `/document` skills rewritten for the new location and the layout-schema step | `docs/` (31 files, ~11k lines) |

**EPIC-092 completed 2026-09-07** ([epic document](epics/completed.md),
[gate run](../qa/runs/2026-09-07-epic-092-guide-questions.md)). Deviations from this document, all
recorded in the epic: the root shipped as `guides` and front matter beat a manifest, as defaulted
here; the corpus counts above were stale (43 pages — 15 root, 16 API, 12 ex-`mcp-res` — plus one
fixture, not "31 files"/"17 API pages"); the non-editor topic pages stayed flat at the tree root
rather than each taking a single-page folder; `docs/` keeps two stub index pages so nothing 404s
before EPIC-095; and `guides.<page>.layout` shipped early, returning a clear no-schema message, so
EPIC-094 only has to write markdown. The sketch above shows `mneme.md`, `mcp-setup.md` and the other
topic pages where they actually landed. Two things the gate found are deferred: the corpus does not
say whether session restore can be disabled (prose, EPIC-094, Q.7 still standing in the surface
file), and `PathSyntaxError` still does not suggest bracket syntax for a hyphenated segment, which
would fix hyphenated paths at the root instead of per-tree and wants its own task.

**EPIC-093 completed 2026-09-07** ([epic document](epics/completed.md),
[gate run](../qa/runs/2026-09-07-epic-093-about-guide-browser.md)). Deviations from this document,
all recorded in the epic: the link scheme shipped as `persephone-guide://<corpus-path>` as
defaulted here, but backed by a **new `guide` pipe provider** rather than an asset-resolved `file`
pipe — an absolute path into the install directory cannot survive an update, and would have shown
the user a path instead of a guide name. Reusing `MarkdownBodyView` required **narrowing its
coupling to an extracted interface**, not merely handing it a host object: it reads a state
projection, a host projection, the typed queue, four search commands, `page` and `setContainer`, and
the surface had to be measured before it could be judged safe. `open()` on the facade accepts a
**folder** path and resolves it to that folder's index page, which this document did not anticipate;
it also turns *Show agent guides* on rather than refusing an `audience: agent` page. A guide-browser
**search box was deliberately left out** so it lands on a proven pane. And `F1`'s screen-to-guide
mapping resolves for very few pages until EPIC-094 writes the per-screen guides, so its fallback to
the contents view is the normal path rather than an error path.

**EPIC-094 completed 2026-09-07** ([epic document](epics/completed.md),
[gate run](../qa/runs/2026-09-07-epic-094-where-is-x.md)). Deviations from this document, all
recorded in the epic: **screenshots stayed out**, as defaulted here. The editor split produced
**21** pages, not one per registered id — eight of the 32 registered "editors" are app screens
(Settings, About, the Tools hub, the MCP Inspector, Mneme, Board Info, toolsets) and took their
`editorId` on the page that documents that screen, while `storybook-view` is development-only and
got none; `grid-json`/`grid-csv`/`grid-jsonl` are one screen, so front matter had to learn a
**list-valued `editorId`**. Front matter also needed a **`screen` key** and, more urgently, needed to
**tolerate an unknown key**: the parser treated any unrecognised field as a whole-file failure, so
adding `screen:` to a page would have silently dropped its title, audience and summary and rendered
the raw YAML as body text. `where` could not go where this document implies — `hint.ts` never
rendered `elements` at all — so it surfaces on the resolved `elements` value and the `helpSearch`
hit instead. Six `editorId` values were **claimed twice**, so `F1` was already resolving by tree
order rather than by ownership. The grid's row filter, the control the gate question is about, had
no `data-name` and lives in the published `av-grid` package; it is addressed through the
declaration's existing `selector` field rather than a dependency release, since the element contract
deliberately excludes editor internals. The per-toolbar "?" affordance stayed **deferred** in favour
of a Menu Bar *Guide for this page* item, and `screens/mcp-inspector.md` was added because mapping
the Inspector to the header strip would have answered `F1` with a guide about a different screen.

Two lessons worth carrying into EPIC-095. **A schema derived from view code is not a schema.** Every
diagram was first drawn as a vertical list — one control per row — which carries position in prose
the `where` phrases already carry, and the Menu Bar was drawn wrong twice from the views and settled
only by opening it and measuring. Position has to be read off the running window. And **the epic
broke its own artifact in its last task**: adding the Menu Bar item shifted every icon in that row,
leaving `menubar-settings`' phrase claiming it sat immediately right of *User Guide* — the answer to
one of the gate's own questions. That is exactly the drift `/userdoc`'s new re-check step exists to
catch, found by opening the menu rather than by reading the diff.

**EPIC-095 completed 2026-09-07** ([epic document](epics/completed.md),
[gate run](../qa/runs/2026-09-07-epic-095-retirement.md)). Deviations from this document: the
pointer job in the EPIC-095 row above was **already five-sixths done**. Each of EPIC-092..094
re-pointed what it touched instead of deferring it, so the README block, `build/README.txt`, the
board-template link, `register-all.ts`, the release process and both skill definitions were correct
before this epic started; what survived was four prose sentences and two mentions of `read_guide`,
the tool deleted in US-1353. The row's counts were stale too — `docs/` held **two stub files**, not
"31 files, ~11k lines", because EPIC-092 had already moved the corpus. So the epic's real weight
fell on the two EPIC-094 deferrals rather than on retirement, and it ran as two tasks instead of six.

The deletion itself was unremarkable, which is the point: `docs/examples/` was verified empty and
its fixture confirmed already moved before anything was removed, and the post-deletion `git grep`
left only history, changelog, third-party URLs and two path-shaped example strings.

**Both EPIC-094 deferrals landed, one of them somewhere other than where it was aimed.** `highlight`
can now reveal a hover-gated control, closing gate question A.2: the grid's row filter rings at rest
where it previously returned `found: false`, because a CSS `:hover` rule tracks the real pointer and
no synthetic event can satisfy it, so the overlay temporarily sets inline `display` and restores it
on every dismissal path. The notebook chip did **not** land on the chips. `syncTags()` rebuilds every
chip through `replaceChildren()` on each note update — including per keystroke — so a chip is a
target the overlay would drop; but `tagsContainer` is a field initializer appended once, and
`notebook.md` already told the user to click *the tag area*. Naming the area was therefore both the
stable choice and the one the corpus had already made. The per-toolbar "?" button is **declined**
rather than deferred a fourth time, in favour of the Menu Bar item EPIC-094 shipped.

**The lesson, and it is the roadmap's own lesson turned on itself.** EPIC-094 recorded that a schema
derived from view code is not a schema — position has to be read off the running window. EPIC-095
found the same shape one level up: the plan for the notebook chip was derived from the *element
contract* and pointed at the wrong node, and what corrected it was the guide sentence already in the
corpus. When the documentation and the plan disagree about what a control *is*, the documentation
has usually been looking at the screen more recently.

## Closing note — the roadmap is complete

**2026-09-07.** All four epics are closed and the goal stated at the top holds: user documentation
lives in the application. `docs/` no longer exists. The corpus is `assets/guides/` — one folder,
two audiences, front matter saying which page serves whom — reachable by the user from the About
browser, the Menu Bar and `F1`, and by an agent from `guides.*` paths, `guides.search`, and the
twelve unchanged `persephone://guides/*` URIs. Every screen page carries a hand-drawn `## Layout`
schema whose spatial phrases match the `where` strings on the same controls' `elements` entries, so
both readers use the same words for the same things. Four epics, seventeen tasks, four gate runs,
all four passed.

What the roadmap got right was principle 5 — retire nothing until the replacement passes the same
gate. Deletion was scheduled last and gated on three prior passes, which is why the final epic was
small and dull. What it got wrong, repeatedly, was its own inventory: file counts, line numbers and
page counts were stale in every epic that checked them. A roadmap is a sequence and a set of rules;
its numbers are a snapshot and should be re-derived, never quoted.

### Consolidated Needs user check

Every open item from all four epics, collected so none stays buried in a completed epic document.
None is blocking; each is one user sentence from being settled.

- **Front matter in the GitHub preview** (EPIC-092). A `---` block renders as a table or as literal
  text depending on the viewer. Accepted because the in-app copy is canonical — but it matters more
  now that the README sends readers to `assets/guides/index.md`.
- **The API reference's long-term fate** (EPIC-092, EPIC-095). Kept, audience `user`, 16 pages. No
  usage evidence exists because the instrument the roadmap suggested — the About page counting
  guide opens — was deliberately not built inside a deletion epic. It is a small feature with a
  privacy shape and wants its own task if the question is to be settled.
- **External links to `docs/` now 404** (EPIC-095). Accepted. If a published link into `docs/` is
  known, two one-line redirect stubs can come back.
- **Whether *Show agent guides* should be sticky** (EPIC-093). Browser state today; resets when
  About is re-opened. A persisted `app.settings` entry is a small follow-up.
- **Whether the guide browser needs its own search box** (EPIC-093). `guides.search` serves the
  agent; the user-facing equivalent was deferred so the pane could prove itself first. It has.
- **`pages` and `pages.closePage` do not see folder pages** (EPIC-093). A real gap, sized and
  deliberately not fixed: `PageCollectionWrapper.all` filters on `mainEditor`, and admitting an
  editor-less page raises what `pages[i].editor` should be for a folder tab. Unrelated to guides.
- **`PathSyntaxError` does not suggest bracket syntax for a hyphenated segment** (EPIC-092 gate).
  Fixing it at the parser fixes hyphenated paths at every root rather than per tree.
- **`helpSearch` does not descend into the `guides` node** (EPIC-095 gate). The root's `guides`
  member line is searchable, but the node is never entered, so `guides.whatsNew` and `guides.search`
  are not discoverable through object-model search — an agent asking for "release notes" gets zero
  hits and recovers only via the no-match reply's hint. Same shape as the `PathSyntaxError` item: a
  fix at the shared search surface, not a guides change, and it wants its own task.
- **Screenshots stay out of the guides** (EPIC-094). Additive over finished pages if wanted.
- **`editors/index.md` shrank from 935 lines to a table** (EPIC-094). The prose moved to the
  per-editor pages, but a bookmark to the long catalogue lands somewhere different.
- **The per-toolbar "?" button is declined** (EPIC-095), reversing EPIC-094's "deferred". Additive
  if the user wants it anyway.
- **Root name `guides` vs `userGuide`** (EPIC-092) is effectively settled by shipping: the word is
  now in the About browser, the resource URIs and the `persephone-guide://` scheme.

Epics 2 and 3 are independent once EPIC-092 lands and can run in either order; EPIC-095 waits for
all three. EPIC-092 is deliberately a move, not a rewrite (principle 2): the diff must show the
same text at a new path so the review can concentrate on the loader, the node and the search.

## Decisions to record in the epic documents

- **Root name:** `guides` (reserved, matches the resource URIs) vs `userGuide` (the user's working
  name). Default `guides`; user to confirm in EPIC-092.
- **Manifest vs front matter.** Default: front matter per page (title, audience, summary,
  editorId) and a generated tree — one source of truth per file, no manifest to keep in sync. A
  `manifest.json` is the fallback if front matter proves awkward for the GitHub rendering.
- **The API reference** (`docs/api/*`, 17 pages, ~4k lines). It moves unchanged in EPIC-092 under
  `guides/scripting/api/`. Whether it stays long-term is a separate question: scripters get the same
  facts from IntelliSense (`assets/editor-types/*.d.ts`) and agents from `$help`. Default: keep,
  audience `user`, revisit after EPIC-095 with usage in mind (the About page can count guide opens
  locally if that helps decide).
- **`docs/examples/greek-gods.fg.json`** is a sample file, not documentation. Default: move to
  `assets/guides/examples/` and link it from the graph guide. Ask before deleting anything under
  `docs/examples/` (standing rule on fixtures).
- **Agent-only pages in the user tree.** Format pages (`formats/*`) are `audience: agent`; the About
  browser hides them by default with a *Show agent guides* toggle rather than omitting them — a
  user debugging an agent wants to read what the agent read.
- **What's New in release process.** Step 3 of `doc/standards/release-process.md` (clean up
  `docs/whats-new.md` on `main`) moves to the new path; the in-app *What's New* shows the released
  section, and the *upcoming* section only in dev builds or behind the same toggle.

## Out of scope / recorded concerns

- **Localisation** — none; the guides are English, as the app is.
- **Board and toolset authors' guides** (`persephone://guides/boards`, `tools`) are agent-facing
  authoring references; they join the tree as `audience: agent` pages in EPIC-092 so they are
  searchable and reachable by path, but their text is not touched by this roadmap.
- **Mneme** could index the guides folder and give semantic search for free. Not done here:
  Mneme is optional and off by default, and the guide search must work without it. Recorded as a
  possible later enhancement (a `guides` Mneme root the user can enable).
- **`build/README.txt`** describes a `read_guide` tool that no longer exists (US-1353). It is fixed
  in EPIC-095 with the other pointers; if a release ships before then, fix it in the release.
