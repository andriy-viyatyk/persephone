# US-1376 — `## Layout` schemas for editor pages and `where` on editor elements

## Goal

Give every editor guide a source-backed, reviewable `## Layout` schema and make each in-scope
editor-facade element carry the same short spatial phrase. The schema is the user-facing map; the
facade list is the addressable vocabulary; the two must be written together so an agent can answer
“where is X?” and then highlight the named element.

This is an investigation and implementation plan only. It does not implement the schemas, change
facades, add a dashboard entry, run tests, or commit.

## Background

EPIC-094 decision 8 fixes one schema shape: a language-less fenced ASCII box in screen order,
right-margin spatial phrases, a user-label → `elements` mapping list, and separate smaller state
diagrams; it forbids pixels, sizes, colours, and coordinates (`doc/epics/EPIC-094.md:161-175`).
Decision 9 says a drawn addressable control normally gets a new `elements` entry with a stable
`data-name`, with only controls the agent must not drive remaining unaddressed
(`doc/epics/EPIC-094.md:176-182`). The phrase convention is short, present-tense, user-facing
location prose; popup/state names must match the separately labelled state diagram
(`doc/tasks/US-1373-where-on-elements/README.md:333-341`).

US-1374 has already placed an empty `## Layout` slot in each of the 21 editor pages. For example,
Grid's slot is between “How to Open” and “Data and editing” (`assets/guides/editors/grid.md:13-24`).
The page set is `archive`, `board`, `browser`, `draw`, `env-vars`, `file-diff`, `folder`,
`git-tree`, `graph`, `grid`, `html`, `image`, `links`, `log-view`, `markdown`, `mermaid`,
`monaco`, `notebook`, `rest-client`, `svg`, and `video`; their `editorId` values are recorded in
the catalogue (`assets/guides/editors/index.md:16-38`).

### Ownership boundary

US-1376 owns the 19 editor facades with static element lists and the two editor pages whose facade
has no static list. The seven app-screen facades in the requested count are owned by US-1377:
About, Board Info, MCP Inspector, Mneme Config, Mneme Root, Toolset, and Tools Hub. EPIC-094
explicitly classifies those ids as screen pages (`doc/epics/EPIC-094.md:76-86`), and the catalogue
already directs those pages to `screens/` (`assets/guides/editors/index.md:63-69`). Their lists
must not be given editor-page phrases in this task; US-1377 writes their screen schemas and fills
their `where` values.

The ownership arithmetic is complete: 171 editor entries owned here + 70 screen entries owned by
US-1377 = all 241 entries in the requested static facade lists. `DrawEditorFacade` and
`LinkEditorFacade` add no entries to that arithmetic because they intentionally publish no static
`elements` list (`src/renderer/scripting/api-wrapper/DrawEditorFacade.ts:28-42`;
`src/renderer/scripting/api-wrapper/LinkEditorFacade.ts:30-45`).

Decision: `editors/index.md` does not receive a `## Layout` schema. It is a catalogue table plus catalogue-level
“how to get to an editor” and switching prose, not a screen with editor controls
(`assets/guides/editors/index.md:8-15,40-69`; EPIC-094 decision 3 at
`doc/epics/EPIC-094.md:96-101`).
Accordingly, `guides["editors/index"].layout` returning the no-schema message is correct; the
Tools & Editors hub screen is separately owned by US-1377, whose screen schema is the correct place
for its controls.

### Counts verified from the current declarations

The counts below are the number of entries in each `*_ELEMENTS` array, verified against the current
array ranges. The total is 241, of which 70 are screen-owned and 171 are editor-owned. Grid's ten
entries already contain the US-1373 worked-example phrases and its explicit repeated-filter
selector (`src/renderer/scripting/api-wrapper/GridEditorFacade.ts:19-71`); implementation must
reconcile its schema to that existing wording, not silently create a second vocabulary.

| Facade | Current entries | Owner | Evidence |
|---|---:|---|---|
| `AboutEditorFacade` | 24 | US-1377 | `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts:11-36` |
| `ArchiveEditorFacade` | 2 | US-1376 | `src/renderer/scripting/api-wrapper/ArchiveEditorFacade.ts:8-11` |
| `BoardEditorFacade` | 5 | US-1376 | `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:41-47` |
| `BoardInfoEditorFacade` | 11 | US-1377 | `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts:18-30` |
| `BrowserEditorFacade` | 14 | US-1376 | `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:61-76` |
| `EnvVarsEditorFacade` | 8 | US-1376 | `src/renderer/scripting/api-wrapper/EnvVarsEditorFacade.ts:12-21` |
| `FileDiffEditorFacade` | 4 | US-1376 | `src/renderer/scripting/api-wrapper/FileDiffEditorFacade.ts:7-12` |
| `FolderViewEditorFacade` | 1 | US-1376 | `src/renderer/scripting/api-wrapper/FolderViewEditorFacade.ts:8-10` |
| `GitTreeEditorFacade` | 4 | US-1376 | `src/renderer/scripting/api-wrapper/GitTreeEditorFacade.ts:17-22` |
| `GraphEditorFacade` | 33 | US-1376 | `src/renderer/scripting/api-wrapper/GraphEditorFacade.ts:10-44` |
| `GridEditorFacade` | 10 | US-1376, already filled | `src/renderer/scripting/api-wrapper/GridEditorFacade.ts:19-71` |
| `HtmlEditorFacade` | 4 | US-1376 | `src/renderer/scripting/api-wrapper/HtmlEditorFacade.ts:9-14` |
| `ImageEditorFacade` | 3 | US-1376 | `src/renderer/scripting/api-wrapper/ImageEditorFacade.ts:8-12` |
| `LogViewEditorFacade` | 12 | US-1376 | `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts:15-28` |
| `MarkdownEditorFacade` | 7 | US-1376 | `src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts:7-15` |
| `McpInspectorFacade` | 12 | US-1377 | `src/renderer/scripting/api-wrapper/McpInspectorFacade.ts:33-46` |
| `MermaidEditorFacade` | 6 | US-1376 | `src/renderer/scripting/api-wrapper/MermaidEditorFacade.ts:9-16` |
| `MnemeConfigEditorFacade` | 8 | US-1377 | `src/renderer/scripting/api-wrapper/MnemeConfigEditorFacade.ts:24-33` |
| `MnemeRootEditorFacade` | 9 | US-1377 | `src/renderer/scripting/api-wrapper/MnemeRootEditorFacade.ts:8-18` |
| `NotebookEditorFacade` | 11 | US-1376 | `src/renderer/scripting/api-wrapper/NotebookEditorFacade.ts:9-21` |
| `RestClientEditorFacade` | 21 | US-1376 | `src/renderer/scripting/api-wrapper/RestClientEditorFacade.ts:24-46` |
| `SvgEditorFacade` | 4 | US-1376 | `src/renderer/scripting/api-wrapper/SvgEditorFacade.ts:9-14` |
| `TextEditorFacade` | 12 | US-1376 | `src/renderer/scripting/api-wrapper/TextEditorFacade.ts:8-21` |
| `ToolsetEditorFacade` | 3 | US-1377 | `src/renderer/scripting/api-wrapper/ToolsetEditorFacade.ts:11-15` |
| `ToolsHubEditorFacade` | 3 | US-1377 | `src/renderer/scripting/api-wrapper/ToolsHubEditorFacade.ts:10-14` |
| `VideoEditorFacade` | 10 | US-1376 | `src/renderer/scripting/api-wrapper/VideoEditorFacade.ts:8-19` |

These current counts close exactly: 171 editor entries + 70 screen entries = 241 entries across
the requested static facade lists. The planned `toolbar-downloads` decision-9 addition is a new
addressable control missing from the current Browser list, so the post-change total becomes 172
editor entries and 242 static entries; it does not represent an omitted current list entry.

`DrawEditorFacade` and `LinkEditorFacade` deliberately have no static `elements` list at all
(`src/renderer/scripting/api-wrapper/DrawEditorFacade.ts:28-42`;
`src/renderer/scripting/api-wrapper/LinkEditorFacade.ts:30-45`). Their pages still get schemas,
but their prose must not promise that any drawn control is addressable through `page.editor.elements`.

### Shared toolbar evidence

The reusable evidence applies only to editors that instantiate `TextChromeView` and let it create a
`PageToolbarView`. In that path, `PageToolbarView` creates page navigation and left content, inserts
the spacer, then appends the right slot and editor switch (`src/renderer/editors/base/PageToolbarView.ts:358-387`);
`TextChromeView` puts compare/run buttons and left contributions in the left slot, puts Show Resources
and right contributions in the right slot, and mounts the toolbar above content
(`src/renderer/editors/base/TextChromeView.ts:345-411`). For those editors only, the schema uses:

`[Page navigation] [left-slot controls] [spacer] [right-slot controls] [Editor switch]`.

The 14 text-chrome-hosted editors are `draw`, `env-vars`, `file-diff`, `graph`, `grid`, `html`,
`links`, `log-view`, `markdown`, `mermaid`, `monaco`, `notebook`, `rest-client`, and `svg`. Their
view constructors instantiate `TextChromeView` at `src/renderer/editors/draw/index.ts:341-361`,
`env-vars/index.ts:17-33`, `file-diff/index.ts:19-38`, `graph/index.ts:138-166`,
`grid/index.ts:212-240`, `html/index.ts:170-203`, `link-editor/index.ts:381-423`,
`log-view/index.ts:144-177`, `markdown/index.ts:156-194`, `mermaid/index.ts:195-237`,
`monaco/index.ts:16-29`, `notebook/index.ts:219-270`, `rest-client/index.ts:17-33`, and
`svg/index.ts:112-147`.

The seven editors that own their toolbar are `archive`, `board`, `browser`, `folder`, `git-tree`,
`image`, and `video`. `archive`, `folder`, `git-tree`, `image`, and `video` instantiate
`PageToolbarView`; `board` instantiates `BoardToolbarView`; and `browser` supplies its own
`BrowserToolbarView` inside `EditorToolbarView` at `archive/ArchiveEditorView.ts:12-65`,
`board/BoardEditorView.ts:78-101`, `browser/BrowserView.ts:257-331,384-453`,
`category/CategoryEditor.ts:7-68`, `git-tree/GitTreeEditorView.ts:15-201`,
`image/ImageView.ts:1-51`, and `video/VideoView.ts:8-100`. Their schemas must not draw
`page-nav-panel` or `page-editor-switch` unless that editor's own view actually creates them.
The classification is exhaustive: 14 TextChrome hosts + 7 own-toolbar hosts = all 21 editor pages.

The verified 1536px Grid geometry applies to the text-chrome-hosted Grid only: page navigation at
the far left, Grid controls next, search at the right slot, and `page-editor-switch` to its right;
the Grid row filter is instead at the right edge of each column header, not in the toolbar
(`doc/tasks/US-1373-where-on-elements/README.md:280-297`).

## Implementation Plan

### 1. Use this literal schema template on every editor page

Copy this shape into each page's existing `## Layout` slot. Replace angle-bracket placeholders with
the page's labels and phrases, keeping the right-margin wording byte-for-byte identical to the
corresponding `where` value. The state block is separate from the main block; omit a state block
only when the page has no state-dependent controls after source review.

````text
## Layout

```
+---------------------------------------------------------------------+
| [Page nav] [<left>]                    [<right>] [Switch]           |  toolbar: left controls at the left, right controls and switch at the right
+---------------------------------------------------------------------+
| [<main content region>]                                             |  <content region phrase>
+---------------------------------------------------------------------+
| [<footer or status region>]                                         |  <footer phrase, when present>
+---------------------------------------------------------------------+
```

Reference rendering — Grid:

```
+---------------------------------------------------------------------+
| [Edit Columns] [CSV Options]             [Search ⌕] [Editor switch] |  toolbar: columns at the left, search and switch at the right
+---------------------------------------------------------------------+
| Column headers — click to sort, drag to reorder. A filter button    |  each column header carries a filter button at its right edge,
| appears at the right edge of a header when you hover it.            |  shown on hover or while that column is filtered
| Cells — double-click to edit, Ctrl+C / Ctrl+V to paste from Excel.  |  grid body, below the toolbar
+---------------------------------------------------------------------+
```
````

### User-facing label → `elements` name

Use one mapping list for the main diagram and every state diagram; put all addressable controls in
this list before the separately labelled state diagrams, and keep only genuinely unaddressable
surfaces in the no-entry lines.

- `<user label>` → `<elements name>`
- `<user label without an elements entry>` → no entry: `<stable reason or ownership>`

### When <state name> is open

```
+---------------------------------------------------------------------+
| [<state controls>]                                      [Close]     |  <state name>; <state region phrase>
+---------------------------------------------------------------------+
```

### Drawn controls without `elements`

- `<control>` — `<decision 9 verdict: add with data-name / add with explicit selector / keep and reason>`.

The outer Markdown fence above is illustrative only: the implementation must use one language-less
fence for the actual diagram, then the mapping list and separately labelled state blocks as literal
Markdown below it. Each diagram row is a screen region, never an individual control: put controls
side by side in true left-to-right order, use horizontal whitespace to show left/right grouping, and
write one right-margin comment for the whole row. Keep every box border aligned and the box under
about 78 columns. The Grid rendering above is the reference for this rule; do not revert to a
vertical control list.

Before → after for a page slot:

```markdown
## Layout

## Data and editing
```

```markdown
## Layout

```
+---------------------------------------------------------------------+
| [Page nav] [Columns] [CSV Options]            [Search] [Switch]     |  Grid toolbar controls and switch
+---------------------------------------------------------------------+
| [Grid rows and column headers]                                      |  grid body below the toolbar
+---------------------------------------------------------------------+
```

### 2. Add `where` from the page schema, not independently

For every in-scope facade table below, add the stated phrase to the existing declaration. Keep
`where` optional for a whole region or a control without a stable useful position; do not use an
empty string, `null`, CSS selectors, coordinates, or action instructions. Preserve the existing
Grid phrases unless the live review finds a contradiction. A shared name is scoped by its host
facade: the same `text-compare-left`, `text-show-resources`, or future shared name may have a
different phrase on a different page because the declaration describes the control in that host's
schema. It is not a global name-to-position map. This is necessary because `TextChromeView` puts
the same shared control into host-dependent left or right slots (`src/renderer/editors/base/TextChromeView.ts:345-411`).

#### Archive — `ArchiveEditorFacade`

| `elements` name | `where` |
|---|---|
| `archive-collapse-all` | `left side of the archive toolbar` |
| `archive-refresh` | `left side of the archive toolbar, after Collapse all` |

Evidence: the view constructs and appends Collapse all then Refresh before the archive tree
(`src/renderer/editors/archive/ArchiveEditorView.ts:45-65,92-115`); declarations are at
`src/renderer/scripting/api-wrapper/ArchiveEditorFacade.ts:8-11`.

#### Board — `BoardEditorFacade`

| `elements` name | `where` |
|---|---|
| `board-toolbar-explorer` | `left edge of the board toolbar` |
| `board-toolbar-reload` | `left side of the board toolbar, after File Explorer` |
| `board-toolbar-log` | `left side of the board toolbar, after Reload` |
| `board-toolbar-properties` | `right side of the board toolbar, before the editor switch` |
| `board-trust` | `center of the untrusted board placeholder, when the board is untrusted` |

Evidence: `BoardToolbar` appends Explorer, path, Reload, Log, Properties, and its switch in that
order (`src/renderer/editors/board/BoardToolbar.ts:97-146`); the page appends toolbar, webview,
script panel, and footer (`src/renderer/editors/board/BoardEditorView.ts:78-117`); the trust
placeholder is a centered Button (`src/renderer/editors/board/UntrustedBoardView.ts:34-47`).
Declarations are at `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:41-47`.

#### Browser — `BrowserEditorFacade`

| `elements` name | `where` |
|---|---|
| `toolbar-home` | `left edge of the browser toolbar` |
| `toolbar-back` | `left side of the browser toolbar, after Home` |
| `toolbar-forward` | `left side of the browser toolbar, after Back` |
| `toolbar-reload` | `left side of the browser toolbar, after Forward` |
| `url-input` | `middle of the browser toolbar` |
| `url-navigate` | `right edge of the browser address field` |
| `url-bookmark-toggle` | `right edge of the browser address field, after Navigate` |
| `toolbar-bookmarks` | `right side of the browser toolbar, after the bookmark toggle` |
| `toolbar-tor-info` | `right side of the browser toolbar, after Bookmarks, when Tor mode is active` |
| `toolbar-downloads` | `right side of the browser toolbar, after Bookmarks and Tor info when Tor mode is active` |
| `toolbar-more` | `right side of the browser toolbar, after Downloads` |
| `toolbar-devtools` | `right side of the browser toolbar, after More` |
| `toolbar-close` | `right edge of the browser toolbar` |
| `tabs-panel-host` | `left side of the browser content below the toolbar` |
| `popup-blocked-bar` | `top of the browser content below the toolbar, when popups are blocked` |

Live evidence for the schema is the 1536px running-window measurement: the browser row is
`app-content → pages-container → page-slot → page-editor → editor-toolbar → browser-toolbar-content`;
the visible controls are Home, Back, Forward, Reload, `url-bar`/`url-input`, Navigate, Bookmark,
Bookmarks, Downloads, More, DevTools, Close from left to right. `url-input` occupies the middle
from about x=110 to x=1345; Navigate and Bookmark begin at about x=1347 and x=1371; Downloads is
at x=1428, More x=1454, DevTools x=1480, and Close x=1506. There is no `page-nav-panel` or
`page-editor-switch` on this row. This is live-measured evidence, not an inference from the view.
The view's own DOM order and slots remain at `src/renderer/editors/browser/BrowserView.ts:274-331`,
and its toolbar/content assembly is at `:418-453`. The current declarations and original count are
at `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:61-76`; implementation adds the
`toolbar-downloads` entry described below.

Decision-9 addition: add `{ name: "toolbar-downloads", purpose: "Open browser downloads" }` to
`BROWSER_ELEMENTS`; verdict: **add the entry; `data-name` already present** on the
`downloads-button` host and its `toolbar-downloads` button
(`src/renderer/editors/browser/DownloadButton.ts:16-28`).

#### Drawing — `draw-view`, no static facade list

Draw `[Theme] [Copy image] [Save] [Open in new tab] [Screen Snip]` on the right side of the shared
toolbar, followed by the editor switch; draw the Excalidraw canvas below it. The five toolbar
buttons are created and appended in that order (`src/renderer/editors/draw/index.ts:53-69,123-167`),
and the toolbar is supplied as the shared right contribution (`src/renderer/editors/draw/index.ts:345-361`).

No `elements` mapping is promised for these controls. `DrawEditorFacade` publishes members and no
`elements` property (`src/renderer/scripting/api-wrapper/DrawEditorFacade.ts:28-42`); the schema
must say that the toolbar and Excalidraw internals are visible screen content, not addressable
facade controls. Do not add a new Draw list in this task.

#### Environment Variables — `EnvVarsEditorFacade`

| `elements` name | `where` |
|---|---|
| `env-vars-profile-tabs` | `top of the selected namespace pane` |
| `env-vars-add-profile` | `right side of the profile tabs` |
| `env-vars-delete-profile` | `right edge of the active profile row` |
| `env-vars-namespace-row` | `left namespace column, one row per namespace` |
| `env-vars-add-namespace` | `bottom of the namespace column` |
| `env-vars-delete-namespace` | `right edge of the active namespace row` |
| `env-vars-grid` | `center of the selected profile pane, below the profile controls` |
| `env-vars-unlock` | `center of the locked environment panel, when the file is locked` |

Evidence: profile controls and profile-pane order are in `src/renderer/editors/env-vars/EnvVarsBodyView.ts:508-615`,
namespace column/content order is at `:648-720`, and the shared chrome wraps the body at
`src/renderer/editors/env-vars/index.ts:17-33`. Declarations are at
`src/renderer/scripting/api-wrapper/EnvVarsEditorFacade.ts:12-21`.

#### Git Diff — `FileDiffEditorFacade`

| `elements` name | `where` |
|---|---|
| `file-diff-picker-from` | `left side of the diff toolbar` |
| `file-diff-picker-to` | `left side of the diff toolbar, after From` |
| `text-compare-left` | `left side of the text toolbar, after the diff selectors, when comparison is available` |
| `text-show-resources` | `right side of the text toolbar, when the host language is HTML` |

Evidence: the diff toolbar appends From, its picker, the arrow, To, and its picker
(`src/renderer/editors/file-diff/FileDiffToolbarView.ts:15-38`); the page supplies it to the
shared left slot (`src/renderer/editors/file-diff/index.ts:19-38`). Declarations are at
`src/renderer/scripting/api-wrapper/FileDiffEditorFacade.ts:7-12`.

#### Folder View — `FolderViewEditorFacade`

| `elements` name | `where` |
|---|---|
| `category-breadcrumb` | `left side of the folder toolbar` |

Evidence: `CategoryEditor` creates the page toolbar and breadcrumb contribution
(`src/renderer/editors/category/CategoryEditor.ts:67-68,130-186,219-226`); declaration is at
`src/renderer/scripting/api-wrapper/FolderViewEditorFacade.ts:8-10`.

#### Git Tree — `GitTreeEditorFacade`

| `elements` name | `where` |
|---|---|
| `git-tree-pull` | `left side of the Git toolbar, after the repository tag` |
| `git-tree-push` | `left side of the Git toolbar, after Pull` |
| `git-tree-refresh` | `right side of the Git toolbar` |
| `git-tree-bottom-tab-select` | `top of the bottom Git panel` |

Evidence: the repository tag, Pull, Push, divider, and Refresh are placed in left and right page
toolbar slots (`src/renderer/editors/git-tree/GitTreeEditorView.ts:175-203,233-253`); Commit/Diff
is a bottom-panel segmented control (`src/renderer/editors/git-tree/GitTreeEditorView.ts:410-444`).
Declarations are at `src/renderer/scripting/api-wrapper/GitTreeEditorFacade.ts:17-22`.

#### Graph — `GraphEditorFacade`

| `elements` name | `where` |
|---|---|
| `graph-open-in-draw` | `right side of the graph toolbar` |
| `graph-copy-image` | `right side of the graph toolbar, after Open in Drawing` |
| `graph-settings` | `left side of the graph body toolbar` |
| `graph-toggle-grouping` | `left side of the graph body toolbar, after Force tuning` |
| `graph-reset-view` | `left side of the graph body toolbar, after Grouping` |
| `graph-expand-all` | `left side of the graph body toolbar, after Reset view` |
| `graph-search` | `right side of the graph body toolbar, after Expand all` |
| `graph-search-clear` | `right edge of the graph search field, when search text is present` |
| `graph-selection-menu` | `right side of the graph body toolbar, after search information, when nodes are selected` |
| `graph-panel-physics` | `top of the graph toolbar panel, Physics tab` |
| `graph-panel-expansion` | `top of the graph toolbar panel, Expansion tab` |
| `graph-panel-results` | `top of the graph toolbar panel, Results tab` |
| `tuning-charge` | `in the Physics panel, first tuning row` |
| `tuning-link-distance` | `in the Physics panel, second tuning row` |
| `tuning-collide` | `in the Physics panel, third tuning row` |
| `tuning-reset` | `in the Physics panel, bottom-right` |
| `graph-detail-panel` | `right side of the graph canvas, when a node is selected` |
| `graph-detail-toggle` | `top of the graph detail panel` |
| `graph-detail-id` | `in the expanded graph detail panel, Info tab, ID row` |
| `graph-detail-title` | `in the expanded graph detail panel, Info tab, Title row` |
| `graph-links-grid` | `in the expanded graph detail panel, Links tab` |
| `graph-properties-grid` | `in the expanded graph detail panel, Properties tab` |
| `graph-detail-tab-info` | `top of the expanded graph detail panel, Info tab` |
| `graph-detail-tab-properties` | `top of the expanded graph detail panel, Properties tab` |
| `graph-detail-tab-links` | `top of the expanded graph detail panel, Links tab` |
| `graph-legend-panel` | `left side of the graph canvas, when the legend is open` |
| `graph-legend-toggle` | `top of the graph legend panel` |
| `graph-legend-tab-selection` | `top of the expanded graph legend panel, Selection tab` |
| `graph-legend-tab-level` | `top of the expanded graph legend panel, Level tab` |
| `graph-legend-tab-shape` | `top of the expanded graph legend panel, Shape tab` |
| `graph-expansion-root` | `in the Expansion panel, Root field` |
| `graph-expansion-depth` | `in the Expansion panel, Depth field` |
| `graph-expansion-max` | `in the Expansion panel, maximum-visible-nodes field` |

Evidence: the image actions are the shared right contribution (`src/renderer/editors/graph/index.ts:30-75,138-166`),
the body toolbar order is explicit (`src/renderer/editors/graph/GraphBodyView.ts:410-430`), and
detail panel tabs/fields are constructed in `src/renderer/editors/graph/GraphDetailPanelView.ts:248-387,495-517`.
Legend tabs and placement are in `src/renderer/editors/graph/GraphLegendPanelView.ts:260-282,430-457`;
tuning controls are at `src/renderer/editors/graph/GraphTuningSlidersView.ts:65-121`. Declarations
are at `src/renderer/scripting/api-wrapper/GraphEditorFacade.ts:10-44`.

#### Grid — `GridEditorFacade` (already filled by US-1373)

| `elements` name | `where` |
|---|---|
| `grid-search` | `search box at the right of the grid toolbar, left of the editor switcher` |
| `grid-search-clear` | `clear button at the right edge of the grid search box` |
| `grid-column-filter` | `filter button at the right edge of each column header; appears when the header is hovered, the column is filtered, or its filter popup is open` |
| `grid-columns` | `Edit Columns button on the left side of the grid toolbar` |
| `grid-csv-options` | `CSV Options button beside Edit Columns on the left side of the grid toolbar` |
| `columns-options-apply` | `in the Columns popup, bottom-right` |
| `columns-options-cancel` | `in the Columns popup, bottom-right, left of Apply` |
| `csv-options-header` | `in the CSV Options popup, at the top` |
| `csv-options-delimiter` | `in the CSV Options popup, below the header checkbox` |
| `csv-options-other` | `custom delimiter field in the CSV Options popup, at the bottom` |

Evidence: these are the landed declarations and selector (`src/renderer/scripting/api-wrapper/GridEditorFacade.ts:19-71`),
the toolbar/search construction (`src/renderer/editors/grid/index.ts:45-184,219-240`), and the two
popup layouts (`src/renderer/editors/grid/components/ColumnsOptions.ts:317-400`;
`src/renderer/editors/grid/components/CsvOptions.ts:76-117`). The schema must explicitly keep the
row filter out of the toolbar and draw it at each column-header right edge.

#### HTML Preview — `HtmlEditorFacade`

| `elements` name | `where` |
|---|---|
| `text-compare-left` | `left side of the HTML text toolbar, when comparison is available` |
| `text-show-resources` | `right side of the HTML text toolbar, before preview actions` |
| `html-copy` | `right side of the HTML toolbar, after Show Resources` |
| `html-more` | `right edge of the HTML toolbar` |

Evidence: HTML preview actions are appended together and supplied to the shared right slot
(`src/renderer/editors/html/index.ts:36-48,88-142,170-203`). Declarations are at
`src/renderer/scripting/api-wrapper/HtmlEditorFacade.ts:9-14`.

#### Image Viewer — `ImageEditorFacade`

| `elements` name | `where` |
|---|---|
| `image-save` | `right side of the image toolbar` |
| `image-open-draw` | `right side of the image toolbar, after Save` |
| `image-copy` | `right side of the image toolbar, after Open in Drawing` |

Evidence: `ImageToolbarView` appends Save, Open in Drawing, and Copy
(`src/renderer/editors/image/ImageToolbarView.ts:25-56,115-155`), and `ImageView` places that
toolbar above the viewport (`src/renderer/editors/image/ImageView.ts:28-51`). Declarations are at
`src/renderer/scripting/api-wrapper/ImageEditorFacade.ts:8-12`.

#### Log View — `LogViewEditorFacade`

| `elements` name | `where` |
|---|---|
| `log-clear` | `left side of the Log View toolbar` |
| `log-toggle-timestamps` | `left side of the Log View toolbar, after Clear` |
| `log-grid-open-in-editor` | `top-right of each Grid output card, on hover` |
| `log-markdown-open-in-editor` | `top-right of each Markdown output card, on hover` |
| `log-mermaid-open-in-editor` | `top-right of each Mermaid output card, on hover` |
| `log-mermaid-copy` | `top-right of each Mermaid output card, after Open in editor, on hover` |
| `log-text-open-in-editor` | `top-right of each text output card, on hover` |
| `log-radio-group` | `in the Log View dialog, radio-group area` |
| `log-select` | `in the Log View dialog, select area` |
| `log-text-input` | `in the Log View dialog, text-input area` |
| `log-dialog-button` | `in the Log View dialog, answer-button row` |
| `log-dialog-checkbox` | `in the Log View dialog, checkbox list` |

Evidence: toolbar order is `Clear` then timestamps (`src/renderer/editors/log-view/index.ts:72-84,115-177`);
output action placement is in `src/renderer/editors/log-view/items/GridOutputView.ts:37-60`,
`MarkdownOutputView.ts:15-33`, and `MermaidOutputView.ts:28-58`; dialog controls and explicit
selectors are at `src/renderer/editors/log-view/items/ButtonsPanel.ts:63-82` and
`CheckboxesDialogView.ts:18-68`. Declarations are at
`src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts:15-28`.

#### Markdown Preview — `MarkdownEditorFacade`

| `elements` name | `where` |
|---|---|
| `text-compare-left` | `left side of the Markdown text toolbar, when comparison is available` |
| `markdown-back` | `left side of the Markdown toolbar, after shared text actions` |
| `markdown-compact-toggle` | `right side of the Markdown toolbar, before the editor switch` |
| `find-input` | `in the Markdown find bar, left side, when the find bar is open` |
| `find-prev` | `in the Markdown find bar, after the find field, when the find bar is open` |
| `find-next` | `in the Markdown find bar, after Previous, when the find bar is open` |
| `find-close` | `right edge of the Markdown find bar, when the find bar is open` |

Evidence: back is a left contribution and compact is a right contribution
(`src/renderer/editors/markdown/index.ts:156-194`); the Markdown body owns the preview/find column
and scroll region (`src/renderer/editors/markdown/MarkdownBodyView.ts:60-86,248-263`), and the
shared find controls are created by `FindBarView` (`src/renderer/editors/shared/FindBarView.ts:100-160`).
Declarations are at `src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts:7-15`.

#### Mermaid — `MermaidEditorFacade`

| `elements` name | `where` |
|---|---|
| `text-compare-left` | `left side of the Mermaid text toolbar, when comparison is available` |
| `mermaid-theme` | `right side of the Mermaid toolbar` |
| `mermaid-open-draw` | `right side of the Mermaid toolbar, after Theme` |
| `mermaid-convert-excalidraw` | `right side of the Mermaid toolbar, after Open in Drawing` |
| `mermaid-save` | `right side of the Mermaid toolbar, after Convert` |
| `mermaid-copy` | `right edge of the Mermaid toolbar` |

Evidence: the five Mermaid actions are appended in that order and supplied to the shared right slot
(`src/renderer/editors/mermaid/index.ts:58-80,195-237`). Declarations are at
`src/renderer/scripting/api-wrapper/MermaidEditorFacade.ts:9-16`.

#### Monaco/Text — `TextEditorFacade`

| `elements` name | `where` |
|---|---|
| `text-compare-left` | `left side of the text toolbar, when comparison is available` |
| `text-run-script` | `left side of the text toolbar, after Compare, for script languages` |
| `text-run-all-script` | `left side of the text toolbar, after Run, when text is selected` |
| `text-show-resources` | `right side of the text toolbar, for HTML language` |
| `text-toggle-script` | `right side of the text footer, when a related script exists` |
| `script-panel-splitter` | `between the editor and the open script panel` |
| `script-run` | `top-left of the open script panel` |
| `script-run-all` | `top-left of the open script panel, when script text is selected` |
| `script-select` | `top of the open script panel` |
| `script-save` | `top of the open script panel, after Script selection` |
| `script-open-tab` | `top of the open script panel, after Save` |
| `script-close` | `top-right of the open script panel` |

Evidence: `TextChromeView` constructs compare/run/resource/footer/script branches and places them
in the shared chrome (`src/renderer/editors/base/TextChromeView.ts:45-248,345-411`); the
Monaco editor is the minimal TextChrome host (`src/renderer/editors/monaco/index.ts:1-29`). The
related script controls are defined in `src/renderer/editors/text/ScriptPanelView.ts` (search its
`data-name` declarations when implementing). Declarations are at
`src/renderer/scripting/api-wrapper/TextEditorFacade.ts:8-21`.

The find/replace widget inside Monaco gets a separate `### When the Monaco find bar is open` block,
but its generated inner controls stay unaddressed: the UI-element contract deliberately excludes
editor internals (`doc/architecture/ui-element-contract.md:211-220`).

#### Notebook — `NotebookEditorFacade`

| `elements` name | `where` |
|---|---|
| `notebook-breadcrumb` | `left side of the Notebook toolbar` |
| `notebook-search` | `right side of the Notebook toolbar` |
| `notebook-search-clear` | `right edge of the Notebook search field, when search text is present` |
| `notebook-add-note` | `right side of the Notebook toolbar, after Search` |
| `notebook-expanded-collapse` | `top-right of the expanded note overlay, when a note is expanded` |
| `note-delete` | `top-right of each note card` |
| `note-expand` | `top-right of each note card, beside Delete` |
| `note-language` | `top-left of each note editor` |
| `note-editor-switch` | `top-left of each note editor, after Language` |
| `note-run-script` | `top-left of each script note editor` |
| `note-run-all-script` | `top-left of each script note editor, when text is selected` |

Evidence: Notebook supplies breadcrumb left and toolbar right contributions
(`src/renderer/editors/notebook/index.ts:219-270`); toolbar controls are created in
`src/renderer/editors/notebook/index.ts:110-191`, while note-card controls are in
`src/renderer/editors/notebook/NoteItemView.ts:81-88,190-219` and
`ExpandedNoteView.ts:84-179` (verify exact live card nesting). Declarations are at
`src/renderer/scripting/api-wrapper/NotebookEditorFacade.ts:9-21`.

#### REST Client — `RestClientEditorFacade`

| `elements` name | `where` |
|---|---|
| `method-label` | `left edge of the selected request bar` |
| `url-input` | `center of the selected request bar, after Method` |
| `rest-send` | `right edge of the selected request bar` |
| `request-header-collection` | `left side of the request header` |
| `request-header-name` | `left side of the request header, after the collection field` |
| `request-delete` | `right side of the request header` |
| `headers-view` | `right side of the Headers section header` |
| `response-headers-view` | `right side of the response Headers section header` |
| `body-type-select` | `top of the Body section` |
| `body-language` | `right side of the Body section header, for raw bodies` |
| `response-language` | `right side of the response body header` |
| `response-tab-select` | `top of the response region` |
| `response-open-in-tab` | `right side of the response header` |
| `kv-row-key` | `left side of each header or form-urlencoded row` |
| `kv-row-value` | `center of each header or form-urlencoded row` |
| `kv-row-delete` | `right edge of each header or form-urlencoded row` |
| `form-data-key` | `left side of each multipart row` |
| `form-data-type-toggle` | `center of each multipart row, after the enabled checkbox` |
| `form-data-value` | `right side of each multipart text row` |
| `form-data-browse` | `right side of each multipart file row` |
| `form-data-delete` | `right edge of each non-empty multipart row` |

Evidence: the request bar, Headers/Body section order, and horizontal body splitter are explicit
(`src/renderer/editors/rest-client/RequestBuilderView.ts:113-139,210-240`); repeated key/value
and multipart row order is at `src/renderer/editors/rest-client/KeyValueEditorView.ts:66-86,170-216`
and `RequestBuilderView.ts:327-359`. The request pane/header owns collection/name/delete
(`src/renderer/editors/rest-client/RestClientShared.ts:158-214,258-344`); response tabs, language,
and open-in-tab are ordered in `src/renderer/editors/rest-client/ResponseViewerView.ts:294-369`.
Declarations are at
`src/renderer/scripting/api-wrapper/RestClientEditorFacade.ts:24-46`.

#### SVG Preview — `SvgEditorFacade`

| `elements` name | `where` |
|---|---|
| `text-compare-left` | `left side of the SVG text toolbar, when comparison is available` |
| `svg-open-draw` | `right side of the SVG toolbar` |
| `svg-save` | `right side of the SVG toolbar, after Open in Drawing` |
| `svg-copy` | `right edge of the SVG toolbar` |

Evidence: SVG actions are appended and supplied as the shared right contribution
(`src/renderer/editors/svg/index.ts:40-52,112-147`). Declarations are at
`src/renderer/scripting/api-wrapper/SvgEditorFacade.ts:9-14`.

#### Links — `link-view`, no static facade list

Draw the shared toolbar with `[Breadcrumb] [Add] [View] [Search]`, the links body, and its footer;
the link view creates those controls and puts breadcrumb left/actions right
(`src/renderer/editors/link-editor/index.ts:84-178,234-280,381-423`). Its `LinkEditorFacade`
publishes no `elements` property (`src/renderer/scripting/api-wrapper/LinkEditorFacade.ts:30-45`),
so the mapping list must explicitly say “no addressable editor-facade controls for this page” and
not turn the existing UI names into promises.

#### Video — `VideoEditorFacade`

| `elements` name | `where` |
|---|---|
| `video-url-input` | `top of the Video toolbar` |
| `video-open-vlc` | `below the video player, when VLC fallback is available` |
| `audio-play-pause` | `bottom overlay of the audio player` |
| `audio-next` | `bottom overlay of the audio player, after Play/Pause` |
| `audio-mute` | `bottom overlay of the audio player, after Next` |
| `audio-shuffle` | `bottom overlay of the audio player, after Mute` |
| `audio-seek` | `bottom overlay of the audio player` |
| `visualizer-bars` | `audio visualizer selector, right side of the visualizer` |
| `visualizer-circular` | `audio visualizer selector, after Bars` |
| `visualizer-none` | `audio visualizer selector, after Circular` |

Evidence: the URL field is placed in the page toolbar and the player/VLC region below it
(`src/renderer/editors/video/VideoView.ts:35-100,150-175`); audio controls and visualizer choices
are ordered in `src/renderer/editors/video/AudioControls.ts:42-65,104-160` and
`src/renderer/editors/video/AudioVisualizer.ts:154-208`. Declarations are at
`src/renderer/scripting/api-wrapper/VideoEditorFacade.ts:8-19`.

### 3. Per-page state blocks and no-entry verdicts

Every page schema must include the following state blocks where applicable. The no-entry line is
part of the page's mapping section; it prevents a polished diagram from implying an addressable
control that the facade does not expose. The 14 text-chrome-hosted pages and the five own
`PageToolbarView` pages (`archive`, `folder`, `git-tree`, `image`, `video`) draw the common
`[Page navigation]` (`page-nav-panel`) and `[Editor switch]` (`page-editor-switch`) shell controls;
they are no-entry controls owned by the chrome work in US-1377, not by every editor facade
(`src/renderer/editors/base/PageToolbarView.ts:373-384`). `board` draws its own BoardToolbar and
custom switcher, while `browser` draws neither generic control.

| Page | State diagrams required | Drawn controls without current `elements` entry and decision-9 verdict |
|---|---|---|
| Archive | Loaded archive; no archive loaded | PageToolbar's navigation and editor switch are shell-owned by US-1377; archive tree rows are a content region, not individually promised. |
| Board | Untrusted board; board script panel when mounted; board toolbar switch menu | Add `board-toolbar-switcher` with `data-name` if the custom switcher is drawn; no generic page navigation/switch is drawn; board-webview controls remain unaddressed because the board is embedded content. |
| Browser | URL suggestions; search-engine menu; page menu; downloads popup; bookmarks drawer; blocked-popup bar; Tor overlay | Add the `toolbar-downloads` entry; `data-name` is already present on the own host. Add own-host `popup-allow`, `popup-dismiss`, `tor-overlay-close`, and `tor-overlay-retry` with `data-name` if drawn; no generic page navigation/editor switch is drawn, and webview page controls remain third-party content and unaddressed. |
| Draw | Excalidraw canvas and toolbar | Keep all five toolbar controls unaddressed: the facade has no list by design, and Excalidraw is editor-internal/third-party. |
| Env Vars | Locked file; active namespace/profile | Data-grid cell editors are editor-internal; keep them as the `Environment variable grid` region. Add no per-cell facade entries. |
| File Diff | From/To revision picker; compare mode; HTML resource state | Add stable `data-name`/selector for the own revision-tree popup only if the schema draws individual popup controls; keep native file dialogs unaddressed. |
| Folder | Empty/error category; category tree | Tree rows remain a repeated content region; `category-breadcrumb` is the sole facade control. |
| Git Tree | No repository; commit selected; bottom Diff tab; Pull/Push menus | Add stable names for own Pull/Push menu items only if drawn individually; commit/ref rows are content, not facade controls. |
| Graph | Physics panel; Expansion panel; Results panel; selected-node detail; legend; selection menu | Add explicit names for own Apply/Cancel buttons in detail grids if they are drawn; level/shape icon rows and canvas gestures remain editor-internal unless live review shows a stable named root. |
| Grid | Columns popup; CSV Options popup; column-filter popup | Already addressed by US-1373; do not add a toolbar row-filter entry. The repeated filter uses the explicit selector in `GridEditorFacade.ts:31-34`. |
| HTML | HTML image-actions popup | Keep popup menu items unaddressed unless own DOM gives them stable names; add a selector only for a stable own control that the schema names. |
| Image | Image save popup | Keep native save destination controls unaddressed; address the own Save/Open/Copy triggers already in the facade. |
| Links | Search active; view-mode state | Keep all controls unaddressed because `link-view` has no static list; prose must not promise addressable handles. |
| Log View | Confirm dialog; radio/select/text-input/checkbox dialogs; output-card hover actions | Existing dynamic dialog selectors are the intended explicit-selector solution (`LogViewEditorFacade.ts:26-27`); add `log-mcp-toggle` only if the MCP card header is drawn as a named control. Destructive confirmation remains drawn but must not gain a drive promise beyond its answer selector. |
| Markdown | Markdown find bar open; minimap visible | Find controls already have facade entries; rendered Markdown/code-block controls remain content because their DOM is generated from document content. |
| Mermaid | Render loading/error; image action state | Keep generated Mermaid SVG/image internals unaddressed; facade covers own toolbar actions. |
| Monaco | Monaco find/replace widget; related script panel open | Keep Monaco's generated find/replace internals unaddressed under the editor-internal scope; address only the own TextChrome/ScriptPanel controls. |
| Notebook | Search active; expanded note overlay; embedded note editor switch/script state | Repeated note controls already use facade names; note text/editor internals remain content. |
| REST Client | Method menu; body-language menu; table/JSON headers; binary/form-data body; response tabs | Add own stable names for `headers-copy`, `rest-tree-add`, `request-copy-as`, and the body splitter if those controls are drawn; keep the OS file chooser behind `form-data-browse` unaddressed. |
| SVG | Rendered preview | Keep generated SVG internals unaddressed; facade covers own toolbar actions. |
| Video | Source loading/error; VLC fallback; audio player; visualizer selector | Keep native media/video.js internals unaddressed; own source, fallback, audio, and visualizer controls are already named. |

For every “add” verdict, implementation must use a UIKit `name`/`data-name` for Persephone-owned
DOM, or an explicit selector for repeated/third-party/generated DOM, following the `data-name`
contract (`doc/architecture/ui-element-contract.md:7-20`). The contract intentionally excludes
editor internals and transient surfaces from exhaustive enumeration
(`doc/architecture/ui-element-contract.md:211-220`); that is the reason the schemas draw those
regions while explicitly declining to promise individual handles.

### 4. Source review and live review checklist

Codex cannot perform the required live review because it does not have the running window. Claude
must verify every page against the running app before implementation acceptance. The source plan
establishes likely order; the live review must resolve only geometry that source cannot settle.

For each page Claude should:

1. Open the page at a normal width and compare every row with the page-specific evidence above.
2. For the 14 TextChrome-hosted pages and the five own `PageToolbarView` pages, confirm the editor
   switch is rightmost, to the right of any right-slot contribution. For Board, confirm its own
   BoardToolbar switcher; for Browser, confirm the measured custom toolbar has neither generic
   control. Confirm the Grid exception: column filter is at each header's right edge, not in the
   toolbar.
3. Open every listed state block and check its control order, side, visibility wording, and repeated
   control behavior.
4. Confirm every `where` phrase is the same plain-English phrase used in the schema and that it
   names the state when the element is state-only.
5. Enumerate the live visible `[data-name]` nodes in the page/editor scope and diff their names
   against that facade's `elements` list. Classify every difference as either a control that gains
   an entry, or a structural/container name that should remain out of the facade; record the
   decision in the page's no-entry list. Use actual visibility, not mere DOM presence, and preserve
   repeated names as repeated matches. This follows the addressing contract's `data-name` rule and
   repeated-element guidance (`doc/architecture/ui-element-contract.md:7-20,35-42`).

The honest “needs live check” list is deliberately short:

- exact visual grouping and available width when a toolbar has both right-slot controls and the
  editor switch;
- whether conditional controls (Tor, HTML resources, compare, script, VLC, note actions) are
  simultaneously visible in the review fixture;
- the exact nesting of repeated Notebook cards and Graph overlays;
- the exact popup anchoring for browser, Grid, Graph, REST, Log, and revision-picker states;
- the live visible `[data-name]` diff against each facade list, including whether a difference is a
  control that needs an entry or a container that should remain unlisted.

### 5. Implement in family-sized passes

Do not implement all pages in one context pass. The corpus and 171 editor entries are large enough
that a partial pass would leave schema and facade vocabularies inconsistent. Use these ordered
passes, completing and reviewing each family before moving on:

1. **Shared text chrome and simple previews:** `monaco`, `markdown`, `html`, `svg`, `mermaid`,
   `file-diff`, then `video`, `image`, and `archive`.
2. **Structured/data editors:** `grid` verification, `env-vars`, `notebook`, and `rest-client`.
3. **Navigation and repository editors:** `folder`, `git-tree`, and `browser`.
4. **Complex/embedded editors:** `graph`, `board`, `draw`, and `links`.

After each family, compare the page schema labels, the facade arrays, and the resolved `elements`
value. Do not run unit tests or create a test harness; this project has no such test workflow. The
epic's later gate is the live MCP call-based “where is X?” check
(`doc/epics/EPIC-094.md:234-248`).

### 6. Before → after facade shape

The current declarations are plain objects without a position field, except the already-landed
Grid example. An implementation change should be mechanically small but source-backed:

```ts
// Before — representative current declaration
{ name: "archive-refresh", purpose: "Locate the visible archive refresh control; refresh remains a view-owned operation." },
```

```ts
// After — phrase copied from the Archive schema
{
    name: "archive-refresh",
    purpose: "Locate the visible archive refresh control; refresh remains a view-owned operation.",
    where: "left side of the archive toolbar, after Collapse all",
},
```

No shared type or renderer change belongs in US-1376: US-1373 already added the optional field and
its two output paths (`src/shared/ai-vision/types.ts`,
`src/renderer/scripting/ai-vision/elements.ts:117-125`, and
`src/shared/ai-vision/help-search.ts:82-91`).

## Concerns / Open Questions

- **Screen/editor ownership:** About and MCP Inspector are explicitly screens, not editor pages;
  US-1377 must fill their phrases. The same rule applies to Board Info, Mneme Config, Mneme Root,
  Toolset, and Tools Hub, even though their implementation classes are named editor facades.
- **Shared names:** use an identical `where` phrase for a shared control whenever the shared chrome
  puts it in the same region and side. `TextChromeView` establishes the common left/right placement
  (`src/renderer/editors/base/TextChromeView.ts:345-411`), so repeated `text-compare-left` and
  `text-show-resources` declarations should stay textually identical while that placement is the
  same. Use a host-specific phrase only when the position genuinely differs, and name the reason
  in the phrase (for example, an own toolbar versus the TextChrome left or right slot). Apply the
  same rule to the `find-input`/`find-prev`/`find-next`/`find-close` family wherever a facade exposes
  it; the current checkout's static declarations are in Markdown and the shared implementation is
  `FindBarView` (`src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts:7-15`;
  `src/renderer/editors/shared/FindBarView.ts:100-160`). The live `[data-name]` diff is the check
  that catches a newly repeated name or a host-specific position before phrases drift.
- **Third-party and generated UI:** browser webview controls, Excalidraw, Monaco widgets, native
  media controls, generated SVG/Markdown content, and OS dialogs cannot receive a stable editor
  facade promise merely because they appear in a diagram. The page must draw their region and state
  the no-entry reason.
- **Grid wording is an existing dependency:** do not “improve” its ten phrases while adding the
  other families. Any change must update both `grid.md` and the declaration in the same review.
- **Live geometry remains Claude's gate:** source order cannot settle all popup anchoring, responsive
  wrapping, or conditional visibility. Those remain the explicit live-check list above rather than
  guessed coordinates.
- **No dashboard or commit:** the user explicitly excludes both, so `doc/active-work.md` and Git
  history remain unchanged.

## Acceptance Criteria

- [ ] All 21 editor pages receive a schema in their existing `## Layout` slot; `editors/index.md`
  remains a catalogue without a layout schema.
- [ ] Each schema uses the fixed language-less ASCII-box format, margin phrases, label mapping,
  separately labelled state diagrams, and spatial words only.
- [ ] Every schema's region order and control side has a cited source file and line range in this
  document, with live-only uncertainties listed rather than guessed.
- [ ] The 171 current in-scope static editor-facade entries have `where` phrases matching their
  page schemas; Grid's ten landed phrases remain consistent with `grid.md`, and the planned
  Browser `toolbar-downloads` addition is included as the one new decision-9 entry.
- [ ] The seven screen-owned facade lists (70 entries) are unchanged by US-1376 and are explicitly
  handed to US-1377.
- [ ] The arithmetic is explicit: 171 current editor entries + 70 current screen entries = 241;
  after the new Browser entry, 172 editor entries + 70 screen entries = 242.
- [ ] `draw-view` and `link-view` schemas draw their visible regions but do not promise addressable
  controls because neither facade has a static `elements` list.
- [ ] Every drawn control without an entry is listed per page with a decision-9 verdict: add a
  stable `data-name`, add an explicit selector, or retain it with a documented ownership,
  destructive/OS, third-party, generated, or editor-internal reason.
- [ ] Shared names use identical phrases when shared chrome puts them in the same place, and use a
  host-specific phrase only when the position genuinely differs and the reason is named.
- [ ] Each editor has a live visible `[data-name]` enumeration diffed against its facade list, with
  every difference classified as an addressable control or an intentionally unlisted container.
- [ ] No unit tests or test harnesses are added, no dashboard entry is added, and no commit is made
  during the implementation of this task.
- [ ] Claude performs the live geometry/schema review and the later EPIC-094 gate before the epic
  is considered complete.

## Files Changed Summary

| File | Planned change |
|---|---|
| `assets/guides/editors/archive.md` through `assets/guides/editors/video.md` (the 21 existing editor pages) | Fill each existing `## Layout` slot with its source-backed schema, mappings, and state diagrams. |
| `src/renderer/scripting/api-wrapper/ArchiveEditorFacade.ts`, `BoardEditorFacade.ts`, `BrowserEditorFacade.ts`, `EnvVarsEditorFacade.ts`, `FileDiffEditorFacade.ts`, `FolderViewEditorFacade.ts`, `GitTreeEditorFacade.ts`, `GraphEditorFacade.ts`, `HtmlEditorFacade.ts`, `ImageEditorFacade.ts`, `LogViewEditorFacade.ts`, `MarkdownEditorFacade.ts`, `MermaidEditorFacade.ts`, `NotebookEditorFacade.ts`, `RestClientEditorFacade.ts`, `SvgEditorFacade.ts`, `TextEditorFacade.ts`, `VideoEditorFacade.ts` | Add host-matching `where` phrases to the 171 current editor entries; add `toolbar-downloads` to `BrowserEditorFacade` because its existing live `data-name` is addressable, plus only other explicitly reviewed decision-9 entries that the schemas draw. |
| `src/renderer/scripting/api-wrapper/GridEditorFacade.ts` | Normally no change; verify the ten US-1373 phrases and selector against the Grid schema and change only if live review proves a mismatch. |
| `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts`, `LinkEditorFacade.ts` | No element-list change; retain the no-static-list rule and document it in the two schemas. |
| `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts`, `BoardInfoEditorFacade.ts`, `McpInspectorFacade.ts`, `MnemeConfigEditorFacade.ts`, `MnemeRootEditorFacade.ts`, `ToolsetEditorFacade.ts`, `ToolsHubEditorFacade.ts` | No US-1376 change; US-1377 owns their screen schemas and `where` phrases. |
| `assets/guides/editors/index.md` | No change; it remains a catalogue, not a screen schema. |
| `doc/tasks/US-1376-editor-layout-schemas/README.md` | This investigation and implementation plan. |

Files verified and intentionally requiring no change in this task: `doc/active-work.md`,
`src/shared/ai-vision/types.ts`, `src/renderer/scripting/ai-vision/elements.ts`,
`src/shared/ai-vision/help-search.ts`, `src/shared/ai-vision/hint.ts`,
`src/renderer/editors/base/PageToolbarView.ts`, `src/renderer/editors/base/TextChromeView.ts`,
`doc/architecture/ui-element-contract.md`, the seven screen facade lists, and the two no-static-list
facades unless the implementation discovers a direct contradiction during live review.
