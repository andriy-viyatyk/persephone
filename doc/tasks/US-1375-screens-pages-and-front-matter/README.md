# US-1375 — `screens/` pages and the front-matter extension

Epic: [EPIC-094 — Per-screen guides and layout schemas](../../epics/EPIC-094.md)

## Goal

Extend guide front matter with `screen`, list-valued `editorId`, and tolerant unknown-key parsing,
then create the seven core `assets/guides/screens/` pages plus a dedicated MCP Inspector page that
absorb the application-shell guide and its screen-specific destinations. The pages must be complete
prose with an explicit `## Layout` insertion point for US-1377; this task does not write layout
schemas, change runtime UI code, add tests, edit the dashboard, or commit anything.

## Background

### The front-matter parser and its load-bearing fallback

`GuideFrontMatter` currently has exactly four fields at
`src/shared/guides/index.ts:19-24`: required `title`, `audience`, and `summary`, plus optional
scalar `editorId`. `GuideTreePage` repeats the optional scalar at
`src/shared/guides/index.ts:26-36`, and `createGuideIndex().loadPage()` copies the parsed value
into the tree/page object at `src/shared/guides/index.ts:144-155`.

The current parser is deliberately small and is not a general YAML parser:

1. `parseGuideFile()` constructs `fallback` at `src/shared/guides/front-matter.ts:10-19` with
   `title: filenameStem(relativePath)`, `audience: "both"`, `summary: ""`, and
   `content: text`.
2. A file without the opening delimiter, without a closing delimiter, with a malformed or
   duplicate metadata line, or with an invalid parsed value returns that fallback at
   `src/shared/guides/front-matter.ts:21-24` and `:28-35`.
3. The load-bearing unknown-key defect is in `parseValue()` at
   `src/shared/guides/front-matter.ts:55-65`: the guard at line 57 returns `undefined` for every
   key other than `title`, `summary`, `editorId`, and `audience`; the loop at lines 33-35 treats
   that `undefined` as a whole-file failure. Therefore adding `screen:` to an existing page today
   does not merely lose that field: the entire front matter is ignored.
4. The fallback body is observable. `GuideProvider.readBinary()` calls
   `parseGuideFile(...).content` at `src/renderer/content/providers/GuideProvider.ts:23-28`, so
   fallback content sends the raw YAML block to the Markdown renderer as body text, while the
   title exposed by the guide index is the filename stem from the fallback above.

The implementation must preserve this distinction: malformed *known* metadata remains a
whole-file fallback, while a syntactically valid unknown key is skipped and the remaining known
metadata continues to parse. Unknown keys will be silently ignored. `ParsedGuideFile` exposes only
`frontMatter` and `content` at `src/shared/guides/front-matter.ts:3-6`; no warning channel exists,
and the current consumers (`GuideProvider` above and the guide index) cannot display a note. Adding
an ignored-key diagnostic would expand the public return shape for no current consumer, so this
task chooses silent forward-compatible tolerance.

### Existing `editorId` consumers and the F1 mapping

The grep for `editorId` across `src/` and `assets/` finds two different concepts. The guide
metadata field is the one that changes; editor-model identity, persistence, panel ownership, and
API editor switching remain scalar runtime IDs and must not be widened.

| Hit / consumer | Verified behavior | Verdict for this task |
|---|---|---|
| `src/shared/guides/index.ts:19-36,144-155` | Declares and propagates guide metadata. | Change `screen` and `editorId` types and propagation. |
| `src/shared/guides/front-matter.ts:26-65` | Stores recognized values and parses the four current keys; `parseValue()` currently poisons the file for unknown keys. | Change recognized-key handling, add `screen`, and preserve scalar strings while accepting an editor-id list. |
| `src/renderer/api/internal/KeyboardService.ts:9-15` | `findGuidePath()` recursively compares each page’s `editorId` with one active runtime ID. | Change the comparison to match a scalar or `includes()` on a list. |
| `src/renderer/api/internal/KeyboardService.ts:92-115` | F1 gets the active main editor ID, requests `getGuideIndex().getTree("user")`, finds a match, opens About, and opens the matched guide; no match opens About contents. | This is the only guide-metadata consumer that needs list-aware behavior. |
| `src/renderer/guides/index.ts:1-17` | Exposes the shared index/tree/page helpers without inspecting `editorId`. | No change. |
| `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts:4,147-150` | Opens a `GuidePage` by path and uses its content; it does not resolve editor IDs. | No change. |
| `src/renderer/content/providers/GuideProvider.ts:4-5,23-28` | Strips front matter and serves only parsed content to a read-only guide provider. | No change beyond inheriting the parser’s tolerant behavior. |
| `assets/guides/agents/browser.md:1-6` | Existing `browser-view` producer, audience `agent`. | Keep during this task; US-1378/US-1374 resolve the duplicate corpus ownership. |
| `assets/guides/editors/browser.md:1-6` | Existing `browser-view` producer, audience `both`. | Keep during this task; later editor-page work makes the mapping unique. |
| `assets/guides/editors/notebook.md:1-6` | Existing `notebook-view` producer, audience `both`. | Keep during this task; later editor-page work owns the unique mapping. |
| `assets/guides/formats/notebook.md:1-6` | Duplicate `notebook-view` producer, audience `agent`. | Keep during this task; US-1378/US-1374 remove the duplicate field later. |
| `assets/guides/formats/graph.md:1-6`, `formats/links.md:1-6`, `formats/ui-push.md:1-6` | `graph-view`, `link-view`, and `log-view` are format/agent guide producers. | Keep during this task; later mapping work moves ownership to user-facing pages. |
| `assets/guides/scripting/api/page.md:68` | Mentions the runtime `mainEditorInstance.editorId` API property in prose. | No change; this is not guide front matter. |
| `assets/editor-types/page-panels.d.ts:8,25` | Uses `editorId` for the owning editor instance/kind of a panel. | No change; this is not guide front matter. |
| `src/shared/persistence.ts:20-24`, `src/renderer/api/pages/**`, `src/renderer/editors/**`, `src/renderer/ui/app/RenderEditorView.ts:41-53`, `src/renderer/ui/secondary-views/panel-key.ts:5-30`, `src/renderer/scripting/api-wrapper/PageWrapper.ts:174-203`, `src/renderer/scripting/ai-vision/page-editor-switches.ts:36-71`, `page-panels.ts:224,294,320`, and `namespaces/window-screen.ts:34` | Use scalar IDs for registered editors, persisted descriptors, panel owners, editor switching, or browser-screen narrowing. | No change; widening guide metadata must not alter the runtime editor-ID contracts. |

`MenuBarView` is only the visible entry point: its User Guide button is declared with
`name: "menubar-user-guide"` at `src/renderer/ui/sidebar/MenuBarView.ts:110-116` and calls
`pagesModel.showAboutPage({ atContents: true })` at `:586-588`. It does not resolve an editor ID.
The only behavioral consumer of guide `editorId` is the F1 resolution in the `KeyboardService` path
above. Today it scans the user-visible tree
in deterministic path order, returns the first exact scalar match, and otherwise falls back to
contents. Consequently `browser-view` can match both `agents/browser.md` and `editors/browser.md`
(the `agents` path sorts first), `notebook-view` has two matches in different folders, and the
agent-only `graph-view`, `link-view`, and `log-view` format pages are excluded by the
`getTree("user")` filter. US-1375 makes the matcher list-aware; uniqueness and ownership cleanup
remain assigned to US-1374/US-1378 as EPIC-094 specifies.

### Screen-page allocation and front matter

The allocation rule is subject-based: an `editorId` belongs on a page whose subject is the screen
that editor ID identifies. A user pressing F1 while looking at the MCP Inspector must not receive a
header guide whose future `## Layout` schema draws unrelated header controls. Where no page documents
the screen, this task either writes that page or leaves the ID unmapped; it never attaches the ID to
an entry-point page for a different screen. `screen` follows the same subject vocabulary, except the
catalogue index deliberately has no screen value because it is not a guide to one application
screen.

The verified allocations are:

- `settings-view` belongs to `screens/settings.md`.
- `mneme-config` and `mneme-root` belong together on `assets/guides/mneme.md`, which explicitly
  documents the Config & monitoring editor and the Mneme root search editor at
  `assets/guides/mneme.md:26-48`.
- `board-info` belongs to `assets/guides/boards.md`: its published-catalog sections document the
  Board Info install surface and the installed-board properties surface, including versions and
  uninstall, at `assets/guides/boards.md:464-490`. No new Board Info page is needed.
- `toolset-view` belongs to `assets/guides/agent-tools.md`, whose per-toolset editor section
  documents the read-only toolset view and its actions at `assets/guides/agent-tools.md:59-74`.
- `tools-hub-view` belongs to `assets/guides/editors/index.md`. Its catalogue explains that the
  Tools & Editors hub lists every editor, board, and tool and supports pinning at
  `assets/guides/editors/index.md:935`; `agent-tools.md` covers the Tools tab but not the hub as a
  whole. US-1374 owns the catalogue page, so its hub wording and this new metadata must stay
  coordinated.
- `mcp-view` gets the new `assets/guides/screens/mcp-inspector.md`. `assets/guides/mcp-setup.md`
  is setup-only (Quick Start, client configuration, resources, and troubleshooting at
  `assets/guides/mcp-setup.md:12-20,22-54,204-224,314-325`) and does not document the Inspector's
  connection form, tools, resources, prompts, or history. The dedicated page is justified by the
  substantial Inspector surface verified at `src/renderer/editors/mcp-inspector/McpInspectorView.ts:48-90,111-148`.
- `about-view` is intentionally unmapped. `screens/index.md` is the catalogue titled “Persephone
  Screens”, not an About-screen guide; F1 falling back to About contents is harmless because About
  is itself the guide browser. No `screens/about.md` is needed for this task.
- `storybook-view` remains intentionally unmapped and gets no page, per EPIC-094 decision 2.

Adding `editorId` to `mneme.md`, `boards.md`, `agent-tools.md`, and `editors/index.md` is an
intentional set of edits outside `screens/`. US-1378 must run the uniqueness pass across these new
claims and the existing `browser-view`/`notebook-view` duplicates, and reconcile any overlapping
ownership planned by US-1374. The exact front matter to create or add is:

`assets/guides/screens/index.md`

```yaml
---
title: "Persephone Screens"
audience: both
summary: "A catalogue of Persephone's screen guides, with the window model and agent guidance for finding and highlighting elements."
---
```

`assets/guides/screens/header.md`

```yaml
---
title: "Header Strip"
audience: both
summary: "The header strip, status indicators, and the screen destinations they open."
screen: "header"
---
```

`assets/guides/screens/menu-bar.md`

```yaml
---
title: "Menu Bar"
audience: both
summary: "The Menu Bar categories, commands, Tools & Editors hub, and its file and folder actions."
screen: "menu-bar"
---
```

`assets/guides/screens/settings.md`

```yaml
---
title: "Settings"
audience: both
summary: "Where Settings lives, how its sections work, and the settings that affect Persephone's screens and services."
screen: "settings"
editorId: "settings-view"
---
```

`assets/guides/screens/sidebar.md`

```yaml
---
title: "Page Area and Sidebar"
audience: both
summary: "The page area and the shared sidebar frame for Explorer, Search, Boards, and other panels."
screen: "sidebar"
---
```

`assets/guides/screens/tabs.md`

```yaml
---
title: "Page Tabs"
audience: both
summary: "Page tabs, language and close controls, grouping, pinned tabs, and session restoration."
screen: "tabs"
---
```

`assets/guides/screens/dialogs.md`

```yaml
---
title: "Dialogs and Transient Surfaces"
audience: both
summary: "Application dialogs, find bars, Log View questions, unsaved-change prompts, and file-opening surfaces."
screen: "dialogs"
---
```

`assets/guides/screens/mcp-inspector.md`

```yaml
---
title: "MCP Inspector"
audience: both
summary: "Connect to an MCP server and inspect its connection details, tools, resources, prompts, and request history."
screen: "mcp-inspector"
editorId: "mcp-view"
---
```

The existing screen-specific guide pages receive one metadata line each, immediately after their
summary:

```yaml
# assets/guides/mneme.md
editorId: ["mneme-config", "mneme-root"]

# assets/guides/boards.md
editorId: "board-info"

# assets/guides/agent-tools.md
editorId: "toolset-view"

# assets/guides/editors/index.md
editorId: "tools-hub-view"
```

The `screen` values introduced by this task are the documented set
`header`, `menu-bar`, `settings`, `sidebar`, `tabs`, `dialogs`, and `mcp-inspector`, each owned by
the correspondingly named page under `assets/guides/screens/`. The catalogue index and the four
existing guide homes above have no new `screen` value: their subjects are a guide catalogue or a
feature/editor surface, while their `editorId` values identify the screen they actually document.

`screen` has no consumer in the current source. It is metadata that lets a screen be named before
the application has a lookup for it; it must not be presented as functional routing in this task.
The likely first consumer is US-1378's Menu Bar “Guide for this page” action, which needs a stable
name for a non-editor screen such as the header or sidebar. Keeping the values above small and
documented gives that future consumer one vocabulary instead of a collection of ad-hoc strings.

The scalar form must remain a scalar in the parsed result, and the list form must remain an array;
this lets one page claim related screen IDs without changing existing single-value pages.

### Coverage of `assets/guides/agents/ui.md`

The source is 336 lines and has the following complete heading inventory. Every heading and its
prose will be placed; the old material is not silently dropped during the split.

| Source heading in `assets/guides/agents/ui.md` | Destination |
|---|---|
| `# Persephone UI Guide — explaining the app to its user` (line 7) | `screens/index.md` as the new index introduction and guide links |
| `## What Persephone is` (line 26) | `screens/index.md` |
| `## Anatomy of the window` (line 39) | `screens/index.md` for the overall model and cross-page links |
| `### Header strip` (line 56) | `screens/header.md` |
| `### Status indicators (bottom-right corner of the header strip)` (line 68) | `screens/header.md` |
| `### A page tab` (line 79) | `screens/tabs.md` |
| `### The Menu Bar` (line 117) | `screens/menu-bar.md` |
| `### About guide browser` (line 150) | `screens/index.md` |
| `### Page area and sidebar` (line 172) | `screens/sidebar.md` |
| `## Settings` (line 193) | `screens/settings.md` |
| `### Settings worth knowing about` (line 235) | `screens/settings.md` |
| `## Pointing at an element on screen` (line 249) | `screens/index.md` in the agent-voiced section |
| `### In a board` (line 256) | `screens/index.md` |
| `### In a browser page — not supported` (line 277) | `screens/index.md` |
| `## Answering "where is X?" reliably` (line 296) | `screens/index.md` |
| `## Errors & verification` (line 308) | `screens/index.md` |
| `## Where to go next` (line 327) | `screens/index.md` |

The index will carry `audience: both` and explicitly retain the agent-voiced material for
`ui.elements`, `ui.highlight`, board overlays, browser-page limitations, verification, and the
next-guide links. The user-facing shell explanations will be written in the same pages so the
corpus has one screen vocabulary.

### Selector freshness findings

The source guide’s tables were compared with the canonical Shell selectors in
`doc/architecture/ui-element-contract.md:71-174`, `HEADER_ELEMENTS` (16 declarations) at
`src/renderer/scripting/ai-vision/namespaces/ui.ts:5-22`, `MENU_BAR_ELEMENTS` (10 declarations)
at `src/renderer/scripting/ai-vision/namespaces/menu-bar.ts:14-25`, and `SIDEBAR_ELEMENTS` (4
declarations) at `src/renderer/scripting/ai-vision/page-panels.ts:39-44`.

Discrepancies to correct while moving the prose:

- The header table in `agents/ui.md:56-66` omits the contractual `app-header` and
  `page-tabs-wrapper`; both are present in `HEADER_ELEMENTS` and the architecture contract at
  `:79-84`.
- The Menu Bar table includes `menubar-user-guide` at `agents/ui.md:117-148`, but it is absent from
  both the architecture contract’s Menu Bar list (`:126-136`) and `MENU_BAR_ELEMENTS`. The DOM
  control is real—`MenuBarView.ts:110-116` creates it—so the new Menu Bar page should retain the
  selector and the architecture contract should add it to the public shell list.
- The sidebar table omits `page-nav-panel`, even though it is the first declaration in
  `SIDEBAR_ELEMENTS` at `page-panels.ts:39-44`. The new sidebar page should include it and the
  architecture contract should add it to the Page area list.
- The Settings prose at `agents/ui.md:193-247` contains no stable selectors. The canonical
  contract lists `settings-root`, `settings-content`, `settings-view-file`, and all 13 section
  selectors at `ui-element-contract.md:138-162`; the new Settings page must carry those selectors
  when describing the screen.
- The About table in `agents/ui.md:150-171` quotes `about-root`, `about-card`,
  `about-guide-browser`, `about-guide-tree`, `about-show-agent-guides`, `about-whats-new`,
  `about-resources`, `about-guide-page`, `about-guide-breadcrumbs`, `about-guide-body`,
  `about-guide-back`, and `about-guide-open-tab`, but none are in the architecture document’s
  Shell selectors section. They are real About controls in `AboutGuideBrowserView.ts:126-171,216-265,355`
  and `AboutView.ts:75-80,214-242`, except the final name is stale: the source creates
  `about-guide-open-in-tab` at `AboutGuidePageView.ts:121-128`. The new index must use the actual
  `about-guide-open-in-tab` name, and the architecture contract should add the corrected About
  selectors rather than preserve the stale name.
- The dynamic `panelElements(kind)` sets at `page-panels.ts:148-175` are not in `agents/ui.md`:
  Explorer has `explorer-secondary-view`, `explorer-header-actions`, `explorer-up`,
  `explorer-search`, `explorer-boards`, `explorer-collapse-all`, `explorer-close`,
  `explorer-open-board`, `explorer-open-toolset`, `explorer-open-git`, and `explorer-open-mneme`;
  Search has `search-secondary-view` and `search-secondary-close`; Boards has
  `boards-empty`, `boards-empty-actions`, `boards-create-empty`, `boards-create-demo-empty`,
  `boards-secondary-view`, `boards-tools-switch-bar`, `boards-close`, `boards-tools-switch`,
  `boards-create`, `explorer-boards`, and `explorer-tools`; Git has `git-panel`,
  `git-panel-toolbar`, `git-panel-tabs`, `git-branches-sort-alpha`, `git-panel-header-actions`,
  `git-panel-refresh`, `git-panel-close`, `git-panel-repo-name`, `git-changes`,
  `git-changes-unstaged`, `git-changes-staged`, `git-changes-toolbar`, `git-changes-file`,
  `git-commit`, `git-stage`, `git-unstage`, `git-changes-splitter`, `git-branches-tree`, and
  `git-tags-tree`. This is intentional rather than an omission: the old guide explicitly says
  editor-specific panel roots are not part of the shell guide. `sidebar.md` will document the
  shared frame and `page.panels` API, not promise these dynamic/editor-specific names.

The selector correction is documentation-only. No runtime selector is renamed in this task; the
architecture contract update is needed so the moved guide and its canonical public list agree.

### Dialog and transient-surface investigation

`dialogs.md` is justified as a cross-cutting screen page even though `agents/ui.md` has no dialog
heading. It will cover the following verified surfaces and their boundaries:

- The shared `FindBarView` is an app-owned absolute overlay named `find-bar` with `find-input`,
  `find-prev`, `find-next`, and `find-close` at `src/renderer/editors/shared/FindBarView.ts:26-75,127-136`.
  Markdown mounts it when search is visible at `src/renderer/editors/markdown/MarkdownBodyView.ts:416-434`;
  Browser mounts it when its find state is visible at `src/renderer/editors/browser/BrowserView.ts:482-488`.
  Monaco is different: `TextEditorFacade` documents that its native find/replace widget has no
  persistent app-owned selector at `src/renderer/scripting/api-wrapper/TextEditorFacade.ts:61-64`,
  and `MonacoBodyView` triggers the native find and replace actions at `:249-250`.
- Ordinary application modals are provided by `ui.confirm`, `ui.input`, `ui.password`, and
  `ui.textDialog`, which dynamically open the corresponding dialog views at
  `src/renderer/api/ui.ts:28-60`. The page will explain that these are blocking modal surfaces,
  with cancel/answer semantics, not shell regions.
- Log View’s inline interactive entries are six distinct types—`input.confirm`, `input.text`,
  `input.buttons`, `input.checkboxes`, `input.radioboxes`, and `input.select`—declared at
  `src/renderer/editors/log-view/logTypes.ts:46-113` and rendered by the matching switch in
  `src/renderer/editors/log-view/LogEntryContent.ts:34-61`. The page will distinguish these
  inline questions from the modal stack and point agents to `pages.logView`/`dialogs` as
  appropriate.
- The unsaved-changes prompt is a real confirmation modal: `TextFileActionsModel.confirmRelease()`
  calls `ui.confirm` with title `Unsaved Changes` and Save / Don’t Save / Cancel at
  `src/renderer/editors/text/TextFileActionsModel.ts:78-101`; `PageModel.close()` invokes release
  checks for modified panel and main editors at `src/renderer/api/pages/PageModel.ts:683-708`.
  The page will state that Cancel leaves the page visible and that Save/Don’t Save are the two
  destructive choices.
- “Open File” is a two-stage surface, not only a native picker. `PagesLifecycleModel.openFileWithDialog()`
  opens the app `OpenUrlDialog` first, then routes a File choice to the native picker at
  `src/renderer/api/pages/PagesLifecycleModel.ts:489-508`; the Electron handler uses
  `dialog.showOpenDialog` with `openFile` and optional multi-selection at
  `src/ipc/main/dialog-handlers.ts:10-30`. `dialogs.md` will cover both the app URL/file choice
  and the OS-owned file dialog, without pretending the latter has app `data-name` selectors.

### Session restore truth for `tabs.md`

EPIC-092 deferred whether session restore can be disabled. The code has no such setting:
`AppSettingsKey` in `src/renderer/api/settings.ts:20-50` contains no session-restore key, and the
settings defaults likewise contain no opt-out. `PagesPersistenceModel.init()` always calls
`restoreState()` before handling CLI file/URL arguments at
`src/renderer/api/pages/PagesPersistenceModel.ts:253-270`. `restoreState()` reads the per-window
`openFiles` data file and accepts only schema version 4 at `:73-80`; `applyState()` reconstructs
the persisted pages and groupings at `:210-239`. The accurate prose in `tabs.md` is therefore:
session restore is always attempted for a valid saved `openFiles` state; there is no user setting
to disable it. A missing, unreadable, or non-v4 state simply produces no restored pages, after
which startup continues and `checkEmptyPage()` runs. `window.close-to-tray` is unrelated—it
controls whether the last window hides or quits, as documented in the setting comments at
`src/renderer/api/settings.ts:121`.

## Implementation Plan

### 1. Extend the shared metadata shape

- [ ] Update `src/shared/guides/index.ts:19-36` so both `GuideFrontMatter` and `GuideTreePage`
  expose `screen?: string` and `editorId?: string | readonly string[]`. Keep the scalar form as
  `string` in the union so all current single-value pages retain the same runtime shape.
- [ ] Update `src/shared/guides/index.ts:144-155` to conditionally copy both parsed optional
  fields into `GuidePage`. `GuidePage` inherits them from `GuideTreePage`; no duplicate interface
  field is needed.

Before:

```ts
export interface GuideFrontMatter {
    readonly title: string;
    readonly audience: GuideAudience;
    readonly summary: string;
    readonly editorId?: string;
}

export interface GuideTreePage {
    // ...
    readonly editorId?: string;
}
```

After:

```ts
export interface GuideFrontMatter {
    readonly title: string;
    readonly audience: GuideAudience;
    readonly summary: string;
    readonly screen?: string;
    readonly editorId?: string | readonly string[];
}

export interface GuideTreePage {
    // ...
    readonly screen?: string;
    readonly editorId?: string | readonly string[];
}
```

### 2. Make `parseGuideFile()` recognize the extension safely

- [ ] Update `src/shared/guides/front-matter.ts:26-47` to include `screen` and the union-valued
  `editorId` in its temporary values and returned front matter.
- [ ] Keep `title`, `summary`, and `screen` scalar values quoted exactly as current metadata is
  quoted. For `editorId`, retain the current quoted scalar branch byte-for-byte in behavior, so
  every existing single-value page keeps the same parsed value and rendered result, and add a list
  branch that accepts a bracketed sequence of quoted strings, returning the array in source order.
  Reject non-string list members, malformed lists, and empty/invalid known values as `undefined`,
  which continues to select the existing whole-file fallback.
- [ ] Change the loop’s recognized-key handling so an unknown syntactically valid key is skipped
  before it can invoke the current unknown-key `undefined` failure. Known duplicate keys, malformed
  metadata lines, invalid `audience`, and invalid known values continue to return `fallback`.
  Unknown keys are silently ignored, including an unknown key with no value; no warning is added to
  `ParsedGuideFile`.
- [ ] Ensure the fallback remains exactly the old object: filename-stem title, `both` audience,
  empty summary, no optional fields, and raw file content. This is the compatibility guard against
  rendering YAML as guide prose for malformed known metadata.

Before:

```ts
const values: Partial<Record<"title" | "audience" | "summary" | "editorId", string>> = {};
// ...
const value = parseValue(match[1], match[2]);
if (value === undefined) return fallback;
values[match[1] as "title" | "audience" | "summary" | "editorId"] = value;
```

After (shape of the intended control flow):

```ts
type GuideValue = string | readonly string[];
const values: Partial<Record<"title" | "audience" | "summary" | "screen" | "editorId", GuideValue>> = {};
const knownKeys = new Set(["title", "audience", "summary", "screen", "editorId"]);

// Inside the metadata loop:
const key = match[1];
if (!knownKeys.has(key)) continue;
if (keys.has(key)) return fallback;
keys.add(key);
const value = parseValue(key, match[2]);
if (value === undefined) return fallback;
values[key as keyof typeof values] = value;
```

The exact parser may use a narrower key-specific helper rather than the illustrative union
assignment above; the required observable behavior is the scalar/list distinction, tolerant
unknown keys, and unchanged fallback.

### 3. Make F1 consume scalar or list metadata

- [ ] Update `findGuidePath()` in `src/renderer/api/internal/KeyboardService.ts:9-15` from an
  exact scalar comparison to a scalar-or-list predicate. A scalar page matches with `===`; an array
  page matches with `node.editorId.includes(editorId)`. Preserve recursive folder traversal and
  first-match ordering until US-1378 establishes corpus uniqueness.
- [ ] Do not change `MenuBarView.ts`: its User Guide button intentionally opens About at contents;
  it does not perform editor-ID mapping. Do not widen runtime editor IDs in the rest of the grep
  inventory above.

Before:

```ts
if (node.kind === "page" && node.editorId === editorId) return node.path;
```

After:

```ts
if (node.kind === "page" && (
    node.editorId === editorId
    || (Array.isArray(node.editorId) && node.editorId.includes(editorId))
)) return node.path;
```

### 4. Create the screen pages without layout schemas

- [ ] Create `assets/guides/screens/index.md` with the exact catalogue front matter above. Its
  structure is: introduction and guide links; `## What Persephone is`; `## Anatomy of the window`
  with the overall shell diagram/model; `## Layout` as the reserved insertion slot; `## About guide
  browser`; `## Pointing at an element on screen`; `### In a board`; `### In a browser page — not
  supported`; `## Answering "where is X?" reliably`; `## Errors & verification`; and `## Where to
  go next`. It retains an agent-voiced section while remaining `audience: both`, but does not claim
  `about-view` because it is a catalogue rather than an About-screen guide.
- [ ] Create `assets/guides/screens/header.md` with the exact front matter above. Its structure is:
  purpose and status summary; `## Header strip`; `## Status indicators`; selector and
  conditional-state notes; and `## Layout` at the reserved slot between the introduction and the
  prose. It documents only the header, not the screens reached from its indicators.
- [ ] Create `assets/guides/screens/menu-bar.md` with the exact front matter above. Its structure
  is: opening/closing behavior; `## Menu Bar regions and controls`; `## Built-in categories`; and
  keyboard/file/folder actions, with `## Layout` between the opening model and those details. It
  explains that Tools & Editors, Board Info, and toolsets are destinations, while their actual
  screen guides own their editor IDs.
- [ ] Create `assets/guides/screens/settings.md` with the exact front matter above. Its structure
  is: entry points and settings workflow; `## Layout`; `## Settings sections and stable targets`;
  `## Settings worth knowing about`; and connected-MCP versus file-editing guidance. Include the
  no-session-restore fact only by linking to `tabs.md`, not by claiming Settings owns it.
- [ ] Create `assets/guides/screens/sidebar.md` with the exact front matter above. Its structure
  is: page-area model; `## Layout`; `## Shared sidebar frame`; `### Explorer`; `### Search`;
  `### Boards`; and the `page.panels` ownership/expanded-state guidance. Keep all three panels on
  this page because they share the same frame.
- [ ] Create `assets/guides/screens/tabs.md` with the exact front matter above. Its structure is:
  tab anatomy; `## Layout`; `## Tab controls and states`; `## Language and pinned-tab shapes`;
  `## Grouping`; `## Tab menu`; and `## Session restore`. State that valid saved session state is
  always attempted and there is no setting to disable it.
- [ ] Create `assets/guides/screens/dialogs.md` with the exact front matter above. Its structure
  is: scope and modal-versus-inline distinction; `## Layout`; `## Find and replace surfaces`;
  `## Application dialogs`; `## Log View dialog entries`; `## Unsaved changes`; and `## Opening a
  file`. Cover verified surfaces only. Explicitly classify `find-bar`, `find-input`, `find-prev`,
  `find-next`, and `find-close` as contractual app-owned Find Bar names verified at
  `src/renderer/editors/shared/FindBarView.ts:26-75`; Monaco's native find widget has no addressable
  app selector, as documented at `src/renderer/scripting/api-wrapper/TextEditorFacade.ts:61-64`,
  and the OS file picker is likewise not given an app `data-name`.
- [ ] Create `assets/guides/screens/mcp-inspector.md` with the exact front matter above. Its
  structure is: how to open/connect; `## Layout` after the introduction; connection state and
  server capabilities; tools, resources, prompts, and history; and failure/disconnect guidance.
  The page owns `mcp-view` because its subject is the Inspector screen itself.
- [ ] Put the corrected About selector and the canonical shell selectors into their relevant new
  pages. Preserve the old guide’s user-facing purpose prose and agent instructions, while replacing
  stale selector names and filling the omissions listed above.
- [ ] Add the needed public-list corrections to
  `doc/architecture/ui-element-contract.md`: `menubar-user-guide`, `page-nav-panel`, a corrected
  About selector subsection including `about-guide-open-in-tab`, and any omitted About names from
  the verified list. Do not add dynamic editor-panel names to the shell contract.
- [ ] Keep the contract's Scope distinction explicit while writing `dialogs.md`: the architecture
  contract still excludes transient dialogs, popup menus, and toasts as shell regions, so the page
  must not present them as shell layout anchors (`doc/architecture/ui-element-contract.md:195-204`).
  Within that boundary, the five app-owned Find Bar
  names are stable, contractual editor-local targets; Monaco's native widget and the OS picker are
  not addressable by app selectors. This is a documentation boundary, not a request to enumerate
  every transient surface in the shell contract.

No `## Layout` diagram or schema is to be written in this task. Each page has a real introduction
and real content before and after the reserved heading, so US-1377 can insert the fixed schema at
an unambiguous point without replacing a TODO or placeholder.

### 5. Retire the old source only after the URI handoff

- [ ] Leave `assets/guides/agents/ui.md` in place during US-1375. It is currently the target of the
  pinned `persephone://guides/ui` resource at `src/main/mcp/manifest.ts:98-101`; deleting it now
  would break the URI before its replacement exists.
- [ ] Do not change `src/main/mcp/manifest.ts` in this task. US-1378 owns the coordinated change
  from `guides/agents/ui.md` to `guides/screens/index.md`, after which US-1378 may delete the
  retired source file. The old file’s material is already fully placed by the coverage table above.

## Concerns

- **Unknown-key diagnostics:** Silent ignore is intentional. There is no existing diagnostic
  return path, and `GuideProvider` only consumes content. If a future author needs warnings, that
  is a separate API decision; this task must not turn an additive metadata extension into a new
  parser result contract.
- **List syntax compatibility:** Existing pages must continue to expose a scalar string, not a
  one-element array. The list parser should accept the exact quoted-array form used by the new
  front matter and reject malformed known values through the existing fallback.
- **F1 duplicate ownership:** List-aware matching does not solve existing duplicate metadata or
  agent-only pages. The subject-based allocation keeps each new ID on a page about that screen,
  while US-1374/US-1378 must later make `editorId` unique and user-facing across the existing
  corpus. This task preserves current first-match behavior so it does not silently broaden mapping
  policy.
- **Selector contract drift:** The old guide includes real About/User Guide selectors that the
  architecture contract and curated AI-vision lists do not fully mirror, and one About selector is
  misspelled/stale. The plan corrects documentation and the architecture contract without changing
  DOM names.
- **Dialog scope:** The page is warranted by several verified transient surfaces. Its five
  app-owned Find Bar names (`find-bar`, `find-input`, `find-prev`, `find-next`, `find-close`) are
  contractual editor-local targets; Monaco's native widget and the OS file picker have no
  addressable app selectors. The architecture contract's Scope still excludes transient surfaces
  as shell regions (`doc/architecture/ui-element-contract.md:195-204`), so those names must not
  become shell layout anchors or imply a contract for every dialog, popup menu, or toast.
- **Screen-ID allocation:** The header and Menu Bar are entry points, not substitutes for the
  Inspector, Mneme, Board Info, or toolset screens. `mcp-view` therefore gets a dedicated page;
  the other IDs use existing pages that actually describe their surfaces. `about-view` and
  `storybook-view` remain unmapped for the explicit reasons above. The outside-`screens/` metadata
  additions must be checked against US-1374's planned editor-page fields in US-1378's uniqueness
  pass.
- **No implementation-phase work now:** This README is the deliverable. No source, asset, manifest,
  dashboard, test harness, or commit is to be changed in this task-document phase except the task
  README itself.

## Acceptance Criteria

- [ ] `doc/tasks/US-1375-screens-pages-and-front-matter/README.md` follows Goal → Background →
  Implementation Plan → Concerns → Acceptance Criteria and includes a Files Changed summary.
- [ ] The plan cites the exact parser function and lines proving that an unknown key currently
  returns `undefined`, that `parseGuideFile()` falls back to filename-stem metadata/raw content,
  and that `GuideProvider` renders fallback content as the body.
- [ ] The plan specifies `screen?: string`, `editorId?: string | readonly string[]`, scalar/list
  parsing, silent unknown-key tolerance, unchanged malformed-known-key fallback, and a list-aware
  `KeyboardService.findGuidePath()`.
- [ ] The plan lists every guide-metadata producer/consumer found by the `editorId` grep with a
  verdict, and distinguishes those from unrelated scalar runtime editor IDs.
- [ ] The plan explains the current F1 mapping: user-filtered tree, recursive first exact match,
  About navigation on success, and About contents fallback on failure.
- [ ] The plan contains all 17 headings from `assets/guides/agents/ui.md` in the coverage table,
  with every heading assigned to exactly one destination and no source prose left unplaced.
- [ ] The seven core new pages plus the dedicated MCP Inspector page have verbatim front matter in
  the plan. The plan accounts for all eight EPIC-094 editor IDs: seven are mapped to pages about
  their screens and `about-view` is explicitly unmapped; `storybook-view` is also explicitly
  excluded.
- [ ] Each page has a placeholder-free content structure and an explicit `## Layout` slot, while no
  layout schema is authored for US-1377.
- [ ] The plan records that `agents/ui.md` remains until US-1378 repoints
  `persephone://guides/ui`, and cites `src/main/mcp/manifest.ts:98-101` as the reason.
- [ ] The plan records the verified session-restore truth: no disable setting, valid v4
  `openFiles` restore is always attempted at startup, and `window.close-to-tray` is unrelated.
- [ ] The plan lists every selector discrepancy: missing `app-header`/`page-tabs-wrapper`, the
  unlisted `menubar-user-guide`, missing `page-nav-panel`, absent Settings contract entries,
  missing About contract entries and stale `about-guide-open-tab`, and the intentionally omitted
  dynamic panel sets.
- [ ] No unit tests, test harnesses, dashboard entries, source implementation, manifest handoff,
  old-guide deletion, or commit is performed by this task-document phase.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1375-screens-pages-and-front-matter/README.md` | This investigation, coverage map, decisions, and implementation plan. |
| `src/shared/guides/index.ts` | Add optional `screen`; widen guide metadata `editorId`; propagate both optional fields. |
| `src/shared/guides/front-matter.ts` | Parse `screen`, scalar/list `editorId`, and silently skip unknown keys while retaining the existing fallback for invalid known metadata. |
| `src/renderer/api/internal/KeyboardService.ts` | Match a runtime editor ID against a scalar or list-valued guide metadata field. |
| `assets/guides/screens/index.md` | New screen-guide catalogue and agent-voiced screen guidance; no `about-view` claim and no layout schema. |
| `assets/guides/screens/header.md` | New header/status-indicator guide; no unrelated destination IDs and no layout schema. |
| `assets/guides/screens/menu-bar.md` | New Menu Bar guide; explains destinations without claiming their editor IDs and has no layout schema. |
| `assets/guides/screens/settings.md` | New Settings guide; claims `settings-view`; no layout schema. |
| `assets/guides/screens/sidebar.md` | New shared page-area/sidebar guide for Explorer, Search, and Boards; no layout schema. |
| `assets/guides/screens/tabs.md` | New tab and session-restore guide; no layout schema. |
| `assets/guides/screens/dialogs.md` | New verified transient-surface guide; no layout schema. |
| `assets/guides/screens/mcp-inspector.md` | New MCP Inspector screen guide claiming `mcp-view`; no layout schema. |
| `assets/guides/mneme.md` | Add `editorId: ["mneme-config", "mneme-root"]` because the page documents both screens. |
| `assets/guides/boards.md` | Add `editorId: "board-info"` because the catalog sections document Board Info install/properties. |
| `assets/guides/agent-tools.md` | Add `editorId: "toolset-view"` because the per-toolset editor section documents that screen. |
| `assets/guides/editors/index.md` | Add `editorId: "tools-hub-view"` because the catalogue documents the hub it backs; coordinate with US-1374. |
| `doc/architecture/ui-element-contract.md` | Reconcile the public shell selector list with the moved guide: User Guide, page-nav, and corrected About selectors. |

Files verified and intentionally requiring no change in US-1375: `src/main/mcp/manifest.ts` (the
URI handoff belongs to US-1378 and the old file must remain until then),
`assets/guides/agents/ui.md` (retired only after that handoff), `assets/guides/mcp-setup.md`
(setup-only; `mcp-view` belongs to the new Inspector page), existing duplicate editor-ID producers
outside the four metadata additions above (ownership cleanup belongs to US-1374/US-1378),
`src/renderer/guides/index.ts`,
`src/renderer/content/providers/GuideProvider.ts`, `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts`,
all runtime editor-ID consumers listed above, `src/renderer/scripting/ai-vision/namespaces/ui.ts`,
`src/renderer/scripting/ai-vision/namespaces/menu-bar.ts`, and the dynamic panel declarations in
`src/renderer/scripting/ai-vision/page-panels.ts`. No unit tests or test harnesses exist for this
project’s guide workflow and none are to be added.
