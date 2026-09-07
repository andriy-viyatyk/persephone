# US-1378 — Screen → guide mapping, aliases, and the `/userdoc` step

## Goal

Make every registered user-facing editor resolve to exactly one guide, make the guide path visible
from the editor facade an agent is already holding, and expose the active-page guide through the
Menu Bar. Retire the two superseded standalone guide files without breaking their stable resource
URIs, and make `/userdoc` keep layout schemas and `where` phrases synchronized with toolbar changes.

This is an investigation and implementation plan only. It does not implement source or guide
changes, add a dashboard entry, run tests, or commit.

This task belongs to [EPIC-094 — Per-screen guides and layout schemas](../../epics/EPIC-094.md).

## Background

EPIC-094 defines this as the mapping task after the editor and screen pages exist. Decision 6 says
the stable `persephone://guides/ui` and `persephone://guides/ui-editors` resources re-point to the
replacement catalogues; they must not concatenate a whole folder because `persephone://guides/full`
already owns the all-guides response (`doc/epics/EPIC-094.md:119-126`). Decision 7 makes the cheap
“?” affordance a Menu Bar item, not a button copied into every editor toolbar
(`doc/epics/EPIC-094.md:128-136`). Decision 10 makes `editorId` unique across the corpus and
assigns it to the user-facing page (`doc/epics/EPIC-094.md:203-218`).

US-1375 already made `GuideFrontMatter` and `GuideTreePage` list-aware and added the `screen` key
(`src/shared/guides/index.ts:19-37`; `src/shared/guides/front-matter.ts:9-12,30-42,54-85`).
US-1376 delivered 21 editor pages and owns the editor-page layouts; US-1377 delivered the eight
screen pages plus the three top-level screen-owning guides and owns their layouts and screen facade
phrases (`doc/tasks/US-1376-editor-layout-schemas/README.md:24-53`;
`doc/tasks/US-1377-screen-layout-schemas/README.md:1-8,26-45`). The current screen pages already
contain `## Layout` sections and state mappings, including `screens/menu-bar.md`
(`assets/guides/screens/menu-bar.md:17-75`).

### Current `editorId` audit

The registered corpus currently has 33 declaration lines because the Grid page owns three IDs and
some IDs are duplicated. The complete grep is `rg -n 'editorId:' assets/guides -g '*.md'`; the
declarations are at the lines below. The duplicate audit found six IDs, not only the five inherited
groups called out in the epic:

| ID | Current declarations | Resolution and owner |
|---|---|---|
| `browser-view` | `assets/guides/agents/browser.md:5`; `assets/guides/editors/browser.md:5` | Remove the agent-page field; add a prose link to `../editors/browser.md`. Owner: `editors/browser.md`. |
| `notebook-view` | `assets/guides/formats/notebook.md:5`; `assets/guides/editors/notebook.md:5` | Remove the format-page field; add a prose link to `../editors/notebook.md`. Owner: `editors/notebook.md`. |
| `graph-view` | `assets/guides/formats/graph.md:5`; `assets/guides/editors/graph.md:5` | Remove the format-page field; add a prose link to `../editors/graph.md`. Owner: `editors/graph.md`. |
| `link-view` | `assets/guides/formats/links.md:5`; `assets/guides/editors/links.md:5` | Remove the format-page field; add a prose link to `../editors/links.md`. Owner: `editors/links.md`. |
| `log-view` | `assets/guides/formats/ui-push.md:5`; `assets/guides/editors/log-view.md:5` | Remove the format-page field; add a prose link to `../editors/log-view.md`. Owner: `editors/log-view.md`. |
| `tools-hub-view` | `assets/guides/editors/index.md:5`; `assets/guides/screens/index.md:6` | Choose option 1: remove the catalogue field and retain `screens/index.md:6` as the owner. Its prose must explicitly identify that page as the Tools & Editors screen guide (`assets/guides/screens/index.md:1-16`). |

All other current declarations are unique: `grid-json`, `grid-csv`, and `grid-jsonl` share
`assets/guides/editors/grid.md:5`; the screen IDs are on `assets/guides/screens/index.md:6`,
`assets/guides/screens/settings.md:6`, and `assets/guides/screens/mcp-inspector.md:6`; and the
top-level screen-owned IDs are on `assets/guides/mneme.md:5`, `assets/guides/boards.md:5`, and
`assets/guides/agent-tools.md:5`. The user-facing owner rule is why the agent-only format and
browser reference pages lose their metadata rather than the new editor pages.

The duplicate is currently silent: `findGuidePath()` returns the first matching page encountered
by recursive tree order (`src/renderer/api/internal/KeyboardService.ts:9-20`), and the guide index
sorts folders and pages lexically before building that tree (`src/shared/guides/index.ts:120-139,
245-284`). The check must be loud but contained: `getTree()` serves the `guides` node, the About
contents view, and F1, so a Markdown metadata typo must not make the whole corpus unavailable. Add
an all-pages duplicate diagnostic before applying the audience filter, but never throw from
`getTree()`. The diagnostic must name the ID and every conflicting path, be carried on the affected
tree entries, and be included in the `guides` node's child summaries so the agent or maintainer
holding the result can see it. Keep the content, search, and layout paths usable.

For the lookup itself, collect all matching page candidates and rank `audience: user` before
`audience: both`, preserving lexical tree order as the deterministic tie-breaker. F1 already asks
for `getTree("user")` (`src/renderer/api/internal/KeyboardService.ts:94-115`), which excludes
agent-only pages; the explicit rank makes the user-facing ownership rule hold even while a
duplicate is being reported. The acceptance check is therefore detection and reporting plus F1
resolution to the user-facing page, not index failure.

### Complete F1 coverage evidence

`register-editors.ts` registers exactly the following 32 IDs (`src/renderer/editors/register-editors.ts:132-203`).
The mapping table is the acceptance evidence for the epic: it is checked against the current
front-matter grep above after duplicate cleanup, while F1 continues to resolve through the user
tree. `storybook-view` is the sole deliberate exception: it is a development-only importer and
has no guide page (`src/renderer/editors/register-editors.ts:169-175`).

| # | Registered ID | Guide page or deliberate result |
|---:|---|---|
| 1 | `monaco` | `editors/monaco.md:5` |
| 2 | `grid-json` | `editors/grid.md:5` |
| 3 | `grid-csv` | `editors/grid.md:5` |
| 4 | `grid-jsonl` | `editors/grid.md:5` |
| 5 | `log-view` | `editors/log-view.md:5` |
| 6 | `md-view` | `editors/markdown.md:5` |
| 7 | `svg-view` | `editors/svg.md:5` |
| 8 | `html-view` | `editors/html.md:5` |
| 9 | `mermaid-view` | `editors/mermaid.md:5` |
| 10 | `graph-view` | `editors/graph.md:5` |
| 11 | `draw-view` | `editors/draw.md:5` |
| 12 | `link-view` | `editors/links.md:5` |
| 13 | `rest-client` | `editors/rest-client.md:5` |
| 14 | `notebook-view` | `editors/notebook.md:5` |
| 15 | `env-vars-view` | `editors/env-vars.md:5` |
| 16 | `browser-view` | `editors/browser.md:5` |
| 17 | `image-view` | `editors/image.md:5` |
| 18 | `archive-view` | `editors/archive.md:5` |
| 19 | `video-view` | `editors/video.md:5` |
| 20 | `settings-view` | `screens/settings.md:6` |
| 21 | `about-view` | `screens/index.md:6` |
| 22 | `tools-hub-view` | `screens/index.md:6` |
| 23 | `mcp-view` | `screens/mcp-inspector.md:6` |
| 24 | `mneme-config` | `mneme.md:5` |
| 25 | `storybook-view` | `unmapped: development-only Storybook editor; no shipped user guide` |
| 26 | `category-view` | `editors/folder.md:5` |
| 27 | `git-tree` | `editors/git-tree.md:5` |
| 28 | `mneme-root` | `mneme.md:5` |
| 29 | `board-view` | `editors/board.md:5` |
| 30 | `toolset-view` | `agent-tools.md:5` |
| 31 | `board-info` | `boards.md:5` |
| 32 | `file-diff` | `editors/file-diff.md:5` |

The eight IDs implemented as app screens are therefore owned by `screens/index.md` (About and
Tools Hub), `screens/settings.md`, `screens/mcp-inspector.md`, `mneme.md` (two IDs), `boards.md`,
and `agent-tools.md`, consistent with the source-backed screen ownership in
`doc/tasks/US-1377-screen-layout-schemas/README.md:916-923`.

## Implementation Plan

### 1. Enforce one corpus owner per `editorId`

- [ ] Remove `editorId` from the five agent-only/format duplicate pages listed above and add one
  sentence in each pointing to its user-facing owner. Preserve the format-specific JSON/API prose;
  the link is the replacement for metadata ownership, not a merge of the format reference into the
  screen guide.
- [ ] Remove `editorId: "tools-hub-view"` from `assets/guides/editors/index.md`. Keep its catalogue
  table and make its link explicitly identify `assets/guides/screens/index.md` as the Tools & Editors
  screen guide. This is option 1: `screens/index.md` already declares both `about-view` and
  `tools-hub-view` (`assets/guides/screens/index.md:1-6`), and its existing screen schema makes it
  the user-facing owner; do not create `screens/tools-hub.md` or make the ID deliberately unmapped.
- [ ] Add non-throwing duplicate reporting to `src/shared/guides/index.ts` in the `getTree()` path,
  before `buildTree(pages.filter(...))` (`:163-166`). Normalize scalar and list values, collect all
  pages claiming each ID, and annotate each affected page with a diagnostic naming the ID and every
  conflicting path. Propagate that field through the tree result and include it in `guides` child
  summaries in `src/main/mcp/ai-vision/guides.ts`, so it is visible on the result an agent holds.
- [ ] Replace the first-match-only resolver in `src/renderer/api/internal/KeyboardService.ts:9-20`
  with candidate collection and deterministic ranking: `audience: user` first, then `both`, then
  existing lexical tree order. F1's `getTree("user")` filter (`:94-115`) already excludes agent-only
  pages. A duplicate is thus reported without taking down the corpus, and F1 still selects the
  user-facing owner.

Before:

```ts
async function getTree(audience: GuideAudienceFilter = "all"): Promise<readonly GuideTreeNode[]> {
    const pages = await loadPages(await scan());
    return buildTree(pages.filter(page => audienceIncludes(page.audience, audience)));
}
```

After:

```ts
async function getTree(audience: GuideAudienceFilter = "all"): Promise<readonly GuideTreeNode[]> {
    const pages = annotateEditorIdDiagnostics(await loadPages(await scan()));
    return buildTree(pages.filter(page => audienceIncludes(page.audience, audience)));
}
```

`GuideTreePage` gains an optional diagnostics field (`src/shared/guides/index.ts:27-38`); the helper
does not reject or throw, and only adds a bounded warning to pages in a collision. `toChildren()`
must expose that warning in the child summary (`src/main/mcp/ai-vision/guides.ts:159-166`) while
the projected page still retains its existing `path`, `call`, and `open` fields
(`src/main/mcp/ai-vision/guides.ts:180-209`). The verification pass reruns the metadata grep,
checks that every duplicate produces a visible diagnostic, and calls F1 on every row in the 32-ID
table; the sole intended unmapped result is `storybook-view`.

### 2. Make facade help carry a derived guide pointer

The facade is already created with the live ID. `PageWrapper.currentEditorId()` reads the active
model's `editorId`, and `PageWrapper.editor` uses that ID both to obtain the registry name and to
select the facade factory (`src/renderer/scripting/api-wrapper/PageWrapper.ts:184-210`). Every
typed facade constructor also receives an `id`; for example, Grid receives the current ID while
its three IDs share one facade (`src/renderer/scripting/api-wrapper/GridEditorFacade.ts:121-135`).
The registry itself currently stores `id`, `name`, `mcpHint`, matching, and loading metadata but no
guide path (`src/renderer/editors/base/editorRegistry.ts:54-86`).

Add an optional `guidePath?: string` to `EditorDefinition` and the local `EditorRow`, populate it
for the 31 mapped IDs in `src/renderer/editors/register-editors.ts`, and leave it absent for
`storybook-view`. This is one mapping table beside the registry, not 21 hand-written URLs in
facades. The table must match the F1 table and the corpus validator; the registry is a synchronous
runtime pointer, while F1 remains authoritative for actual user-tree resolution.

Add `src/renderer/scripting/api-wrapper/editor-guide-help.ts` with a small synchronous formatter:
look up `editorRegistry.getById(editorId)?.guidePath`, treat `board-editor:<root>` as the mapped
`board-view` guide, and otherwise return the base help plus a pointer. Reuse the existing canonical
URL builder from `src/shared/guides/guide-links.ts:1-24`; use the same identifier/bracket rule as
`callPath()` (`src/main/mcp/ai-vision/guides.ts:198-203`) so paths such as
`editors/file-diff` become `guides["editors/file-diff"]`.

The pointer should name both forms:

```text
Guide: read <call path> for the page text; show it with <open URL>.
```

Use both because the facade help is often the result the agent is holding. `call` answers “what
does this guide say?” and `open` answers “show this guide to the user”; EPIC-093's gate proved that
a capability absent from the held result is effectively absent to the agent
(`qa/runs/2026-09-07-epic-093-about-guide-browser.md:29-47,83-87`). The guide tree/search projection
already deliberately exposes `path`, `call`, and `open` together
(`src/main/mcp/ai-vision/guides.ts:42-56,159-203`), so the facade pointer should offer the same
two actions rather than only a raw filesystem-like path.

Wrap the existing static help in every facade descriptor with the helper, preserving the existing
domain-specific text. This covers the 21 editor facades and the screen-owned facades: 

`src/renderer/scripting/api-wrapper/ArchiveEditorFacade.ts`,
`BoardEditorFacade.ts`, `BrowserEditorFacade.ts`, `DrawEditorFacade.ts`,
`EnvVarsEditorFacade.ts`, `FileDiffEditorFacade.ts`, `FolderViewEditorFacade.ts`,
`GitTreeEditorFacade.ts`, `GraphEditorFacade.ts`, `GridEditorFacade.ts`,
`HtmlEditorFacade.ts`, `ImageEditorFacade.ts`, `LinkEditorFacade.ts`,
`LogViewEditorFacade.ts`, `MarkdownEditorFacade.ts`, `MermaidEditorFacade.ts`,
`NotebookEditorFacade.ts`, `RestClientEditorFacade.ts`, `SvgEditorFacade.ts`,
`TextEditorFacade.ts`, and `VideoEditorFacade.ts` (all under
`src/renderer/scripting/api-wrapper/`), plus the exact screen-facade files
`AboutEditorFacade.ts`, `BoardInfoEditorFacade.ts`, `McpInspectorFacade.ts`,
`MnemeConfigEditorFacade.ts`, `MnemeRootEditorFacade.ts`, `ToolsetEditorFacade.ts`, and
`ToolsHubEditorFacade.ts`. `GenericEditorFacade.ts` should retain a no-guide explanation for an
unmapped ID such as Storybook. No individual facade should hardcode a `persephone-guide://` URL.

Before:

```ts
help: GRID_EDITOR_HELP,
```

After:

```ts
help: withEditorGuideHelp(this.id, GRID_EDITOR_HELP),
```

The helper must not query the asynchronous guide index while building a descriptor: `help` is a
string or synchronous function in `IAiVisionDescriptor` (`src/shared/ai-vision/types.ts:59-71`),
whereas the guide index reads the corpus asynchronously (`src/renderer/guides/index.ts:1-14`).
The registry metadata therefore gives the cheapest correct pointer and keeps the corpus lookup in
F1.

### 3. Share the F1 active-guide route with the Menu Bar

Extract the body currently named `KeyboardService.openActiveGuideOrContents()` into an exported
renderer helper in `src/renderer/api/internal/KeyboardService.ts`, or make that method the shared
callable entry point without duplicating it in the view. The code must remain the exact F1 route:

1. Read `pagesModel.activePage?.mainEditorInstance?.editorId`.
2. Read the user-filtered guide tree and call `findGuidePath()`.
3. If there is no ID, no mapping, or resolution fails, call
   `pagesModel.showAboutPage({ atContents: true })`.
4. Otherwise open About and call `AboutEditor.guideBrowser.openGuide({ kind: "guide", path })`.

Those behaviours are currently implemented at `src/renderer/api/internal/KeyboardService.ts:94-120`;
the fallback is not an error page and must be reused for `storybook-view` and any future
deliberately unmapped editor. Keep F1's guard label and give the Menu Bar click its own guard label
around the same shared function.

Before:

```ts
private async openActiveGuideOrContents(): Promise<void> {
    // resolve active editor, find user guide, open About or About contents
}
```

After:

```ts
export async function openActiveGuideOrContents(): Promise<void> {
    // the existing F1 implementation, shared by F1 and MenuBarView
}

// KeyboardService.handleKeyDown calls the exported function for F1.
// MenuBarView calls the same function for “Guide for this page”.
```

Add the new `IconButtonView` in `src/renderer/ui/sidebar/MenuBarView.ts` after the existing User
Guide button and before Settings. The live geometry supplied for this task is a 233px action row
with icons at x = 4, 34, 151, 181, and 211; the source explains the 117px gap: the row has a
`gap: "sm"` (`MenuBarView.ts:70-76`) and an unsized `SpacerView` between file actions and app
actions (`:89-124,186-193`). `Spacer.css` gives that spacer `flex: 1 1 auto`
(`src/renderer/uikit/Spacer/Spacer.css:2-5`), so inserting the new icon into the app-action group
shrinks the spacer and fits the sixth icon. Do not put it beside Open File/New Window, and do not
change `MenuBar.css`.

Use an existing registered icon and the title `Guide for this page`; the new handler closes the
Menu Bar and calls the shared active-guide function. Its action is distinct from User Guide:
User Guide always opens About at contents (`MenuBarView.ts:111-117,586-589`), while the new item
selects the active screen's guide and falls back to those same contents when unmapped.

Before:

```ts
this.userGuideButton.root,
this.settingsButton.root,
```

After:

```ts
this.userGuideButton.root,
this.guideForPageButton.root,
this.settingsButton.root,
```

The item needs its own stable `data-name`, for example `menubar-guide-for-page`, and its own
`MENU_BAR_ELEMENTS` declaration. The contract requires stable names for the Menu Bar controls and
the current curated declaration is at `src/renderer/scripting/ai-vision/namespaces/menu-bar.ts:14-29`;
`createElements()` derives the resolved `elements` value and `highlight` member from that list
(`src/renderer/scripting/ai-vision/elements.ts:117-160`). Add a `where` phrase matching the schema,
for example “top action row of the left category column, right group, after User Guide and before
Settings”. Update `assets/guides/screens/menu-bar.md`'s main diagram and label mapping so the new
item appears in the same order. This is a Menu Bar control, not a per-editor toolbar control; the
per-toolbar “?” remains deferred by decision 7.

### 4. Re-point resource aliases and retire superseded files

Change only the target file for the two existing entries in `src/main/mcp/manifest.ts:98-108`:

| Stable entry | Before | After |
|---|---|---|
| `ui-guide` / `persephone://guides/ui` | `guides/agents/ui.md` | `guides/screens/index.md` |
| `ui-editors-guide` / `persephone://guides/ui-editors` | `guides/agents/ui-editors.md` | `guides/editors/index.md` |

Keep each name and URI. Keep the editor description because the catalogue still covers all editor
types and links to the 21 detailed pages (`assets/guides/editors/index.md:10-38`). Update the UI
description to say it is the screen catalogue/layout entry point plus stable selector guidance,
because `screens/index.md` is now a catalogue with links to focused screen pages
(`assets/guides/screens/index.md:9-25`). Mirror that wording in the copied resource table in
`assets/guides/mcp-setup.md:208-224` so the user-facing resource documentation does not describe
the retired full shell file.

Update the stale runtime pointers in the same pass:

- `src/main/mcp/manifest.ts:18-30` (`SERVER_INSTRUCTIONS`) should direct agents to
  `guides.screens` or `guides.screens.index`, not `guides.agents.ui`.
- `src/renderer/scripting/ai-vision/namespaces/ui.ts:38-48` should use the screen catalogue path
  for app-control documentation.
- `build/README.txt:24-37` should list `resources\\assets\\guides\\screens\\index.md` and
  `resources\\assets\\guides\\editors\\index.md` in its offline quick-start list instead of
  the two deleted files.

Delete these two files only after the manifest target changes are in place:

- `assets/guides/agents/ui.md`, the 336-line shell guide now fully placed into the screen pages
  (`doc/tasks/US-1375-screens-pages-and-front-matter/README.md:247-250`).
- `assets/guides/agents/ui-editors.md`, the 12-line compatibility pointer
  (`assets/guides/agents/ui-editors.md:1-12`) that would otherwise
  remain a visible extra tree/search/About entry.

The no-loss check is the US-1375 coverage table, not a second informal reread of the retired file:
its 17 headings map one-to-one to `screens/index.md`, `screens/header.md`, `screens/tabs.md`,
`screens/menu-bar.md`, `screens/sidebar.md`, and `screens/settings.md`, with the dialogs page added
for verified transient surfaces (`doc/tasks/US-1375-screens-pages-and-front-matter/README.md:247-275,329-340`).
Before deletion, verify those destinations are present and that the current screen catalogue still
contains the migrated agent sections (`assets/guides/screens/index.md:157-236`).

`persephone://guides/full` remains safe: its handler obtains `guideIndex.getTree("agent")`, flattens
that tree, and reads each surviving page (`src/main/mcp/server-factory.ts:42-70`). Deleting the two
files removes them from the corpus; it does not leave a hard-coded full-resource filename. The
focused aliases use `readGuideFile(res.file)`, which reads the new existing target
(`src/main/mcp/server-factory.ts:27-40`; `src/main/mcp/manifest.ts:121-127`). The `guides.agents`
folder still exists for the remaining agent pages, while `guides.screens` and `guides.editors` are
the new catalogue branches. Historical task notes and release notes may retain their historical
`ui`/`ui-editors` wording because the stable aliases remain valid; current runtime/offline
instructions must not point at deleted files.

### 5. Replace the stale no-layout promise

Rewrite `NO_LAYOUT_MESSAGE` and the `GUIDE_PAGE_MEMBERS.layout` summary in
`src/main/mcp/ai-vision/guides.ts:9-18`. The message should explain that the requested page is a
catalogue or API/format reference rather than a screen layout, and point to the actual locations
where schemas live: `assets/guides/screens/`, `assets/guides/editors/`, and the top-level
screen-owning guides `mneme.md`, `boards.md`, and `agent-tools.md`. It must not mention a later
task now that EPIC-094's schemas have landed.

Before:

```ts
const NO_LAYOUT_MESSAGE = "No layout schema is available for this guide yet; layout schemas arrive per screen in a later task.";
{ name: "layout", kind: "property", summary: "The page's ## Layout schema, or the later-task message when no schema exists." },
```

After:

```ts
const NO_LAYOUT_MESSAGE = "This page is a catalogue or API/format reference rather than a screen layout, so it has no ## Layout schema. Screen and editor schemas live in the corresponding pages under guides/screens, guides/editors, or the top-level screen guides.";
{ name: "layout", kind: "property", summary: "The page's ## Layout schema; catalogue and API/format reference pages may legitimately have none." },
```

### 6. Make `/userdoc` durable and actionable

The canonical skill is `.agents/skills/userdoc/SKILL.md`; `.claude/skills/userdoc/SKILL.md` is only a
pointer to it (`.claude/skills/userdoc/SKILL.md:9-12`). Edit the canonical file only. Replace its
static “user-facing pages” table, which still lists `editors/index.md` as the complete editor
overview and only Grid/Notebook/Browser (`.agents/skills/userdoc/SKILL.md:17-56`), with a durable
derivation rule:

> Treat every Markdown page under `assets/guides/` whose front matter has `audience: user` or
> `audience: both` as user-facing. Derive the current page list from the guide tree rather than
> maintaining a hand-written table; the current editor pages are the 21 files under
> `assets/guides/editors/`, and the current screen pages are the eight files under
> `assets/guides/screens/`, with the remaining user/both top-level and API pages included by the
> same rule.

This is more durable than another enumerated table because US-1374 has already expanded the editor
set to 21 pages (`doc/tasks/US-1376-editor-layout-schemas/README.md:24-29`) and US-1375/1377
expanded the screen set to eight pages (`doc/tasks/US-1377-screen-layout-schemas/README.md:1-8`).
It also keeps API and top-level pages in scope without confusing a catalogue with a screen schema.

Add an explicit step to the skill's workflow after comparing relevant docs with code:

> When a screen's toolbar changes, re-check that screen guide's `## Layout` schema and every
> affected `where` phrase. Open the live screen, diff its visible `[data-name]` nodes against the
> owning facade's `elements` list, then update the diagram, label mapping, and phrase together.
> Use the same live-diff method specified by US-1376 and US-1377
> (`doc/tasks/US-1376-editor-layout-schemas/README.md:871-888`;
> `doc/tasks/US-1377-screen-layout-schemas/README.md:875-888,961-966`).

The step is intentionally about a live `[data-name]` diff, not a source-only guess: the epic assigns
visual accuracy to live review, while the schema and facade list share one vocabulary
(`doc/epics/EPIC-094.md:45-60`). The Menu Bar implementation must therefore update
`screens/menu-bar.md` and `MENU_BAR_ELEMENTS` in the same change.

## Concerns

- **Registry mapping can drift from Markdown metadata.** The registry `guidePath` is a synchronous
  pointer for facade help, while the corpus remains the F1 authority. Mitigate this with the
  corpus-wide uniqueness validator, the exact 32-row table above, and a manual comparison of every
  registry path with the post-cleanup `editorId` grep. Do not make F1 silently fall back to the
  registry path.
- **A duplicate hidden by audience filtering can return the wrong first page.** The existing
  recursive resolver is first-match (`src/renderer/api/internal/KeyboardService.ts:9-20`). Report
  collisions on the affected tree entries and rank `user` before `both`; do not throw from the
  shared `getTree()` path used by `guides`, About, and F1 (`src/shared/guides/index.ts:163-166`).
- **Facade-help scope is wider than the 21 editor pages.** Screen-owned facades also expose
  `pages[i].editor.$help`; applying one helper to every typed facade keeps About, Board Info, MCP,
  Mneme, Toolset, and Tools Hub pointers consistent. Generic Storybook remains explicitly
  unmapped, not a fake guide.
- **The Menu Bar has two similar question actions.** Keep the existing User Guide semantics
  (contents) and label the new action “Guide for this page”. Put it in the app-action group after
  User Guide and before Settings, where the flex spacer makes room; do not add a per-toolbar button.
- **Deleting a file is order-sensitive.** Re-point and verify both resource aliases first, then
  delete the old files. `readGuideFile()` uses synchronous `statSync()` and read access
  (`src/main/mcp/manifest.ts:121-127`), so a stale manifest target would fail immediately.
- **The full resource is intentionally broad.** It reads all current `audience: agent` and
  `audience: both` pages through the guide index, so the deletion changes membership but does not
  require a concatenation replacement (`src/main/mcp/server-factory.ts:42-78`).
- **Historical documentation is not current runtime guidance.** Leave dated task/release prose
  that describes the old aliases historically, but update current server instructions, `ui` help,
  and the offline build instructions so agents do not receive a deleted path.
- **No tests or harnesses.** Follow the project rule for this documentation/API-vocabulary task:
  use the grep/table/tree checks and manual live UI verification; do not introduce unit tests or a
  test harness. Do not edit `active-work.md`, as the user explicitly prohibited a dashboard entry.

### Files that need no changes

These are evidence or already-correct consumers: `.claude/skills/userdoc/SKILL.md` (thin pointer;
the canonical skill is edited), `src/renderer/uikit/Spacer/Spacer.css` (its existing flex spacer is
the required geometry), `src/renderer/ui/sidebar/MenuBar.css` (no new styling is needed),
`src/shared/guides/front-matter.ts` and `src/shared/guides/index.ts` metadata propagation already
landed in US-1375 (only the optional diagnostic field and contained duplicate reporting are added to
the latter),
`assets/guides/mcp-setup.md`'s URI/name table structure (only the stale UI description row is
updated), `assets/guides/whats-new.md` and historical task documents, `doc/active-work.md`,
`doc/epics/EPIC-094.md`, and all unit-test/test-harness files (none are to be added). The existing
`src/renderer/content/providers/GuideProvider.ts` and guide URL parser already resolve canonical
corpus paths and need no behavior change (`src/renderer/content/providers/GuideProvider.ts:7-20`;
`src/shared/guides/guide-links.ts:15-24`).

## Acceptance Criteria

- [ ] The post-change `editorId` grep has exactly one owner for every declared ID; the six current
  duplicate IDs are resolved as specified, and each former agent/format page has a prose link to
  its user-facing owner.
- [ ] A duplicate scalar/list `editorId` claim is detected across the entire corpus before audience
  filtering, reported on the affected tree entries and `guides` child result, and never takes down
  `createGuideIndex().getTree()`; F1 still resolves the user-facing page through
  `KeyboardService.findGuidePath()`.
- [ ] All 32 registrations in `src/renderer/editors/register-editors.ts` match the table in this
  document. Thirty-one map to the stated guide pages, including `tools-hub-view` at
  `screens/index.md`; exactly one ID, `storybook-view`, is reported as the deliberate
  development-only unmapped ID.
- [ ] Every mapped typed editor facade exposes help containing a derived guide call path and
  `persephone-guide://` open URL; no facade hand-writes its own guide URL. Grid's three IDs and
  custom `board-editor:<root>` IDs resolve to their shared pages.
- [ ] F1 and Menu Bar “Guide for this page” call one shared active-guide implementation. A mapped
  page opens its guide in About; no mapping, Storybook, absent active editor, or lookup failure
  opens About at contents.
- [ ] The sixth Menu Bar icon is mounted after User Guide and before Settings, on the app-action
  side of the existing flex spacer. It has its own `data-name`, `MENU_BAR_ELEMENTS` entry, matching
  `where` phrase, and `screens/menu-bar.md` schema/mapping entry.
- [ ] `persephone://guides/ui` reads `guides/screens/index.md` and
  `persephone://guides/ui-editors` reads `guides/editors/index.md`, retaining URI/name contracts;
  current descriptions and copied MCP setup documentation describe the new targets accurately.
- [ ] `assets/guides/agents/ui.md` and `assets/guides/agents/ui-editors.md` are deleted only after
  the alias handoff; the US-1375 coverage table and destination headings verify no shell fact was
  dropped, and `persephone://guides/full`, `guides.agents`, `guides.screens`, and `guides.editors`
  still enumerate the intended corpus.
- [ ] `SERVER_INSTRUCTIONS`, `ui` help, and `build/README.txt` contain no current pointer to the
  deleted `guides.agents.ui` page. Historical release/task records may retain their dated wording.
- [ ] `NO_LAYOUT_MESSAGE` and its member summary describe legitimate catalogue/API/format pages
  without a schema and point agents to the actual screen/editor schema locations.
- [ ] The canonical `/userdoc` skill derives its user-facing page set from `assets/guides/` and
  explicitly requires a live `[data-name]`-versus-facade-`elements` diff plus `## Layout`/`where`
  re-check whenever a screen toolbar changes. The `.claude` file remains only a pointer.
- [ ] This task-documenting turn changes only this README. No implementation, dashboard entry,
  unit tests, test harness, or commit is produced.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1378-screen-guide-mapping/README.md` | This investigation, complete mapping table, decisions, implementation plan, evidence, and acceptance criteria. |
| `src/shared/guides/index.ts` | Add a non-throwing corpus-wide scalar/list `editorId` diagnostic before audience filtering and carry it on affected tree pages. |
| `assets/guides/agents/browser.md` | Remove duplicate `editorId`; link to `editors/browser.md`. |
| `assets/guides/formats/notebook.md` | Remove duplicate `editorId`; link to `editors/notebook.md`. |
| `assets/guides/formats/graph.md` | Remove duplicate `editorId`; link to `editors/graph.md`. |
| `assets/guides/formats/links.md` | Remove duplicate `editorId`; link to `editors/links.md`. |
| `assets/guides/formats/ui-push.md` | Remove duplicate `editorId`; link to `editors/log-view.md`. |
| `assets/guides/editors/index.md` | Remove the duplicate `tools-hub-view` declaration and retain an explicit link to its `screens/index.md` owner. |
| `assets/guides/agents/ui.md` | Delete the superseded 336-line shell guide after alias handoff and coverage verification. |
| `assets/guides/agents/ui-editors.md` | Delete the superseded 12-line compatibility pointer after alias handoff. |
| `src/renderer/editors/base/editorRegistry.ts` | Add optional synchronous `guidePath` metadata to editor definitions. |
| `src/renderer/editors/register-editors.ts` | Populate the one registry-side guide mapping for the 32 registered IDs; leave Storybook unmapped. |
| `src/renderer/scripting/api-wrapper/editor-guide-help.ts` | New shared formatter deriving both guide `call` and `open` pointers, including custom boards. |
| `src/renderer/scripting/api-wrapper/*EditorFacade.ts` | Wrap typed facade help with the shared derived pointer; preserve domain help text. |
| `src/renderer/scripting/api-wrapper/GenericEditorFacade.ts` | Keep an explicit no-guide explanation for unmapped generic editors. |
| `src/renderer/api/internal/KeyboardService.ts` | Share the existing F1 active-guide/fallback route with Menu Bar callers. |
| `src/renderer/ui/sidebar/MenuBarView.ts` | Add “Guide for this page” to the app-action group after User Guide and before Settings. |
| `src/renderer/scripting/ai-vision/namespaces/menu-bar.ts` | Add the new stable element declaration and spatial phrase. |
| `assets/guides/screens/menu-bar.md` | Add the new action to the layout schema and user-label mapping. |
| `src/main/mcp/manifest.ts` | Re-point the two stable resource aliases and update current server guidance. |
| `assets/guides/mcp-setup.md` | Align the copied UI resource description with the screen catalogue target. |
| `src/renderer/scripting/ai-vision/namespaces/ui.ts` | Replace the deleted `guides.agents.ui` help pointer with the screen catalogue path. |
| `build/README.txt` | Update the offline guide quick-start paths after the two deletions. |
| `src/main/mcp/ai-vision/guides.ts` | Replace the stale later-task no-layout message and member summary. |
| `.agents/skills/userdoc/SKILL.md` | Derive user-facing pages from the tree and add the toolbar schema/`where` live-diff step. |
