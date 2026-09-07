# US-1377 — `## Layout` schemas for screens and `where` on shell elements

## Goal

Give the eight `assets/guides/screens/` pages, plus the three non-screen guides that own a
screen `editorId`, a source-backed `## Layout` schema. Fill the spatial vocabulary used by the
shell, tabs, sidebar panels, Settings, and the seven screen-owned editor facades so that a user-facing
phrase and an addressable `elements` name agree.

This is an investigation and implementation plan only. It does not implement schemas, edit view
code, add a dashboard entry, run tests, or commit.

## Background

EPIC-094 decision 8 fixes the schema shape: one language-less fenced ASCII diagram in screen order,
right-margin phrases, a user-label → `elements` mapping, and separately labelled state diagrams
(`doc/epics/EPIC-094.md:161-175`). Decision 9 says a drawn addressable control normally receives a
stable `data-name` and an `elements` entry; only controls the agent must not drive remain
unaddressed (`doc/epics/EPIC-094.md:176-182`). The phrase convention is short, present-tense,
user-facing location prose, with state names repeated in the state diagram and `where` field
(`doc/tasks/US-1373-where-on-elements/README.md:331-341`).

US-1373 already added the optional field and filled `GRID_ELEMENTS`; its wording is the worked
example to follow (`src/renderer/scripting/api-wrapper/GridEditorFacade.ts:19-71`). US-1375 added
the screen guide slots and the front-matter support, while the current source review below catches
two incomplete outcomes that must be resolved in this task's implementation pass. US-1376 owns the
21 editor pages and the 19 editor facades; it hands this task About, Board Info, MCP Inspector,
Mneme Config, Mneme Root, Toolset, and Tools Hub (`doc/tasks/US-1376-editor-layout-schemas/README.md:26-47`).

The shared shell order is established by `MainPageView`: header, then app content containing the
pages container and Menu Bar (`src/renderer/ui/app/MainPageView.ts:70-82`); the header itself
appends the Persephone button, tabs, spacer, conditional reload/zoom controls, window controls,
and the status cluster (`src/renderer/ui/app/MainPageView.ts:108-129`). The status cluster's
bottom-right placement is established by `src/renderer/ui/app/MainPage.css:2-18`. The contract
organises the shell as header → status indicators → page tab → Menu Bar → Settings → page area and
lists the corrected selectors (`doc/architecture/ui-element-contract.md:71-176`).

For editors hosted by `TextChromeView` or `PageToolbarView`, the toolbar implementation appends
page navigation, the left slot, spacer, right slot, and editor switch in that order
(`src/renderer/editors/base/PageToolbarView.ts:358-387`; `src/renderer/editors/base/TextChromeView.ts:345-411`).
That is not a universal page-toolbar rule: Browser uses its own `EditorToolbarView` and has neither
`page-nav-panel` nor `page-editor-switch` (`src/renderer/editors/browser/BrowserView.ts:411-417,449-453`),
while Board uses a custom `BoardToolbarView` that embeds the switch widget after its own controls
(`src/renderer/editors/board/BoardToolbar.ts:72-85,128-143`). The page-area source explicitly
inserts the sidebar before the editor content (`src/renderer/ui/app/PageContentView.ts:91-125`).

The 21 editor schemas in US-1376 must therefore use these toolbar categories, rather than applying the
shared-toolbar sketch to every page:

| Category | Editors | Toolbar consequence | Evidence |
|---|---|---|---|
| `TextChromeView` | Monaco, Markdown, HTML, SVG, Mermaid, File Diff, Draw, Environment Variables, Grid, Link Editor, REST Client, Notebook, Graph, Log View | Shared page navigation, slots, and editor switch; the switch is last in this toolbar | `src/renderer/editors/base/TextChromeView.ts:345-411`; usages in `src/renderer/editors/{monaco,markdown,html,svg,mermaid,file-diff,draw,env-vars,grid,link-editor,rest-client,notebook,graph,log-view}/index.ts` |
| direct `PageToolbarView` | Archive, Folder/Category, Git Tree, Image, Video | Shared page navigation/slot/switch ordering supplied directly by the page-toolbar base | `src/renderer/editors/archive/ArchiveEditorView.ts:12-23,63-92`, `src/renderer/editors/category/CategoryEditor.ts:7-39,67`, `src/renderer/editors/git-tree/GitTreeEditorView.ts:15,121,201`, `src/renderer/editors/image/ImageView.ts:1,28,45`, `src/renderer/editors/video/VideoView.ts:8,36,69` |
| custom `BoardToolbarView` | Board | Own controls, then the embedded editor switch; do not draw `page-nav-panel` unless the custom view supplies it | `src/renderer/editors/board/BoardToolbar.ts:72-85,95-143` |
| custom browser toolbar | Browser | Own toolbar; no `page-nav-panel` and no `page-editor-switch` | `src/renderer/editors/browser/BrowserView.ts:273-307,411-417,449-453` |

The category membership is source-derived, while the exact widths and any state-dependent visibility remain
review work. The illustrative template below is still copied verbatim from US-1376; its toolbar labels are
placeholders that each implementation must replace with the applicable category's actual order
(`doc/tasks/US-1376-editor-layout-schemas/README.md:114-149`).

### Live header and tab evidence

The following is the live enumeration supplied for the running 1536 × 1044 window. It is the
geometry evidence for `header.md` and `tabs.md`, not a guessed coordinate diagram:

```text
Header strip — three visual rows above the page area

top 0     app-header@2 ......... window-minimize@1406  window-toggle@1450  window-close@1494
top ~16   persephone-menu@10   page-tabs-wrapper@42   [tabs run left to right]
                               page-tabs-add@1030  split-primary@1030  split-caret@1057
top ~24   app-header-spacer@1077
top ~32   status-indicators@1426 { header-snip-button@1426  mneme-indicator@1462  mcp-indicator@1505 }
```

The schema must therefore put the Persephone glyph at the left edge, place the tab strip after it,
place the plus split button immediately after the last visible tab, and place the top-right window
controls above the bottom-right status cluster. The live order of the status cluster is Snip, Mneme,
MCP. `tab-language` and `tab-sound` are conditional per tab: the measured tab exposed one or the
other shape, not both as fixed controls. `autoload-reload`, `zoom-indicator`, and the overflow scroll
arrows were absent in this state; their conditional states come from the view code and must be
shown separately (`src/renderer/ui/app/MainPageView.ts:83-90,108-129,160-201`,
`src/renderer/ui/tabs/PageTabsView.ts:47-90`, `src/renderer/ui/tabs/PageTabView.ts:370-403`).

### Scope and current discrepancies

The editor registry has eight app screens: Settings, About, Tools & Editors, MCP Inspector, Mneme
Config, Mneme Root, Agent Tool, and Board Info (`src/renderer/editors/register-editors.ts:167-189`).
The current guide front matter maps only Settings and MCP Inspector under `screens/`; Mneme owns two
ids, Boards owns Board Info, and Agent Tools owns Toolset (`assets/guides/screens/settings.md:1-7`,
`assets/guides/screens/mcp-inspector.md:1-7`, `assets/guides/mneme.md:1-6`,
`assets/guides/boards.md:1-6`, `assets/guides/agent-tools.md:1-6`). `screens/index.md` currently has
neither `screen:` nor `editorId:` (`assets/guides/screens/index.md:1-5`). The implementation must
add `screen: "index"` and `editorId: ["about-view", "tools-hub-view"]` there; otherwise About
and Tools Hub have no guide mapping despite being in this task's ownership boundary.

The current `SETTINGS_CATALOG` has 13 sections and its verified `key:` rows total 24
(`src/renderer/scripting/ai-vision/namespaces/settings.ts:22-150`). The existing Settings prose
also says 25 rows (`assets/guides/screens/settings.md:15-17`), which is stale relative to the
source. Do not invent a setting key. Fill the 24 generated rows from the current catalog, add the
existing `settings-view-file` control as the one non-key page action required by decision 9
(`src/renderer/editors/settings/SettingsView.ts:97-106`), and record the resulting declaration
count explicitly as 25 (24 catalog keys + 1 page action). If the catalog changes before
implementation, re-run the count and preserve this distinction.

The current static/dynamic declaration counts are:

| List | Current verified count | Planned count | Evidence / note |
|---|---:|---:|---|
| `HEADER_ELEMENTS` | 16 | 16 | `src/renderer/scripting/ai-vision/namespaces/ui.ts:5-22` |
| `MENU_BAR_ELEMENTS` | 10 | 11 | Current list omits the contractual `menubar-user-guide`; the view and contract contain it (`src/renderer/scripting/ai-vision/namespaces/menu-bar.ts:14-25`, `src/renderer/ui/sidebar/MenuBarView.ts:111-123`, `doc/architecture/ui-element-contract.md:126-137`). |
| Generated setting rows | 24 | 24 | `src/renderer/scripting/ai-vision/namespaces/settings.ts:152-158`; 13 sections, 24 current rows. |
| Settings page action | 0 | 1 | Add `settings-view-file`; its `data-name` already exists (`src/renderer/editors/settings/SettingsView.ts:97-106`). |
| `TAB_ELEMENTS` | 4 | 4 | `src/renderer/scripting/ai-vision/page-tab.ts:8-13` |
| `SWITCH_ELEMENTS` | 1 | 1 | `src/renderer/scripting/ai-vision/page-editor-switches.ts:14-16` |
| `COMPARE_ELEMENTS` | 2 | 2 | `src/renderer/scripting/ai-vision/page-compare.ts:8-11` |
| `SIDEBAR_ELEMENTS` | 4 | 4 | `src/renderer/scripting/ai-vision/page-panels.ts:39-44` |
| Dynamic Explorer tuples | 11 | 11 | `src/renderer/scripting/ai-vision/page-panels.ts:148-156` |
| Dynamic Search tuples | 2 | 2 | `src/renderer/scripting/ai-vision/page-panels.ts:157` |
| Dynamic Boards tuples | 11 | 11 | `src/renderer/scripting/ai-vision/page-panels.ts:158-164` |
| Dynamic Git tuples | 19 | 19 | `src/renderer/scripting/ai-vision/page-panels.ts:165-173` |
| **Task total after the two missing controls are addressed** | **104 current** | **106** | 16 + 10 + 24 + 4 + 1 + 2 + 4 + 43 = 104; add User Guide and View Settings File. |

The seven handed-off facades contain 70 entries: About 24, Board Info 11, MCP Inspector 12,
Mneme Config 8, Mneme Root 9, Toolset 3, and Tools Hub 3. These counts are verified at
`src/renderer/scripting/api-wrapper/AboutEditorFacade.ts:11-36`,
`BoardInfoEditorFacade.ts:18-30`, `McpInspectorFacade.ts:33-46`,
`MnemeConfigEditorFacade.ts:24-33`, `MnemeRootEditorFacade.ts:8-18`,
`ToolsetEditorFacade.ts:11-15`, and `ToolsHubEditorFacade.ts:10-14`.

### Cross-task findings for US-1376

The live data-name enumeration found an addressable Browser control missing from
`BROWSER_ELEMENTS`: `downloads-button` is the host and `toolbar-downloads` is the visible button at
the right side of the toolbar (measured at x≈1428). Both names already exist in the DOM; the view
creates them and places the download control after bookmarks and before More
(`src/renderer/editors/browser/DownloadButton.ts:16-28`, `src/renderer/editors/browser/BrowserView.ts:282-307`).
Neither is represented by the current 14-entry facade list, which has no `toolbar-downloads`
(`src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:61-76`); adding the actionable button is
a one-line declaration with no contract-name question. US-1376 must add it and its `where` phrase;
US-1377 must not edit the Browser page or facade.

The same live row settles the Browser gate question: the browser's own toolbar is
`Home → Back → Forward → Reload → url-input → url-navigate → url-bookmark-toggle → Bookmarks →
Downloads → More → DevTools → Close`. `url-input` occupies the middle from approximately x=110 to
x=1345, with `url-navigate` at its right edge and the bookmark toggle immediately after it. There
is no page navigation control or editor switch on this row (`src/renderer/editors/browser/BrowserView.ts:273-307,411-417`).
The supplied measurement was:

```text
top 48  app-content@2 pages-container@2 page-slot@2 page-editor@2 editor-toolbar@2
        browser-toolbar-content@6
        toolbar-home@6 toolbar-back@32 toolbar-forward@58 toolbar-reload@84
        url-bar@110 url-input@110 ... url-navigate@1347 url-bookmark-toggle@1371
        toolbar-bookmarks@1402 downloads-button@1428 toolbar-downloads@1428
        toolbar-more@1454 toolbar-devtools@1480 toolbar-close@1506
```

US-1376 must use the exact phrase “middle of the browser toolbar, after Home, Back, Forward, and
Reload and before Navigate” (or the same wording in the schema), and must preserve the measured
navigation order rather than assuming a conventional Back/Forward/Reload/Home order.

The reusable implementation check is: enumerate every visible, non-zero-box `[data-name]` node in
the live screen, group nodes by visual row, diff the names against that page's facade `elements`
declarations, and record each addressable-but-unlisted node in the owning task's decision-9 table.
Run that diff for every screen and editor page, not only when reasoning from view code; it found
`toolbar-downloads` here and should find the next omission before schema review.

## Implementation Plan

### 1. Use the US-1376 schema template verbatim

The following is copied verbatim from US-1376's template (`doc/tasks/US-1376-editor-layout-schemas/README.md:114-149`). Use it in every layout slot; replace placeholders only. I have deliberately kept its fence shape, headings, mapping list, state block, and no-elements list identical.

````text
## Layout

```
+--------------------------------------------------------------------------+  | top toolbar; page navigation at the left
| [Page navigation] [<left controls>]              [<right controls>]      |  | <same phrase as each row's where value>
|                                                  [Editor switch]         |  | editor switch at the far right
+--------------------------------------------------------------------------+
| [<main content region>]                                                  |  | <content region phrase>
+--------------------------------------------------------------------------+
| [<footer or status region>]                                              |  | <footer phrase, when present>
+--------------------------------------------------------------------------+
````

### User-facing label → `elements` name

- `<user label>` → `<elements name>`
- `<user label without an elements entry>` → no entry: `<stable reason or ownership>`

### When <state name> is open

```
+---------------------------------------------------------------+  | <state name>; <state region phrase>
| [<state control>] [<state control>]                 [Close]   |  | <same state phrase used by where>
+---------------------------------------------------------------+
```

### Drawn controls without `elements`

- `<control>` — `<decision 9 verdict: add with data-name / add with explicit selector / keep and reason>`.

The outer Markdown fence above is illustrative only: the implementation must use one language-less
fence for the actual diagram, then the mapping list and separately labelled state blocks as literal
Markdown below it. No diagram may copy the illustrative Grid sketch in
`doc/in-app-guides-roadmap.md:182-191`; Grid's real toolbar is established by
`src/renderer/editors/grid/index.ts:45-92,116-184,219-240`.
````

Before → after for every guide slot:

```markdown
## Layout

## The next existing section
```

```markdown
## Layout

```
+--------------------------------------------------------------------------+  | <verified region phrase>
| [<controls in source order>]                                             |  | <same phrase as where>
+--------------------------------------------------------------------------+
| [<main region>]                                                          |  | <main region phrase>
+--------------------------------------------------------------------------+
```

### 2. Correct the guide-to-screen ownership before adding diagrams

Update only guide front matter as part of this task:

```yaml
# assets/guides/screens/index.md — before
summary: "..."
---
```

```yaml
# assets/guides/screens/index.md — after
summary: "..."
screen: "index"
editorId: ["about-view", "tools-hub-view"]
---
```

This makes the eight screen pages and all eight app-screen ids complete without creating a ninth
screen page (`src/renderer/editors/register-editors.ts:167-189`). `mneme.md` receives two labelled
schemas in one `## Layout` because its list-valued `editorId` deliberately maps both Mneme Config
and Mneme Root to one guide (`assets/guides/mneme.md:1-6`). Boards and Agent Tools each receive one
schema because each owns one screen id (`assets/guides/boards.md:1-6`, `assets/guides/agent-tools.md:1-6`).

### 3. Write the per-page schemas and state diagrams

The diagrams below define the regions and controls the implementation pass must draw. Every page
must retain the exact user label → element mapping and a separate state block for each state named
here. Evidence is source order; Claude's later live review establishes visual accuracy.

#### `assets/guides/screens/index.md` — About and Tools & Editors

Draw both screen variants in the same page because the page will own both ids:

```text
+--------------------------------------------------------------------------------+
| [About card: version, update, links] | [About splitter] [Guide browser]       |  | About; card left, guide browser right
+--------------------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------------+
| [Built-in] [Registered boards] [Search boards] [Tools]                   |  | Tools & Editors; tab switcher at the top
| [active hub body]                                           [pinned rail] |  | active body below tabs, pinned rail at right
+--------------------------------------------------------------------------+
```

State blocks: About contents versus a selected guide page (breadcrumbs, Back, Open in tab, body);
Tools Hub's four active tabs. About's left card → splitter → guide browser order is constructed at
`src/renderer/editors/about/AboutView.ts:135-237`; the selected-guide header puts Back, breadcrumbs,
and Open in tab left-to-right above the body (`src/renderer/editors/about/AboutGuidePageView.ts:104-150`).
Tools Hub puts the main tab/body column before the vertical pinned rail and swaps one body for the
active tab (`src/renderer/editors/tools-hub/ToolsHubView.ts:45-56,90-123`).

Drawn controls without entries: individual guide-tree rows, breadcrumb links, and dynamic hub body
rows. Keep them drawn with “no entry: data-driven content; the stable tree/browser or tab-root
entry is the addressable anchor,” unless live review shows a stable repeated control that should
receive a new `data-name`. The About root and all listed actions are already declared in
`src/renderer/scripting/api-wrapper/AboutEditorFacade.ts:11-36`; the hub tab/filter controls are
declared in `ToolsHubEditorFacade.ts:10-14`.

#### `assets/guides/screens/header.md`

```text
+--------------------------------------------------------------------------------+
| [window controls: minimize, restore, close]                                   |  | top-right row, above status indicators
| [Persephone menu] [page tabs] [add page immediately after the last tab]       |  | tab row; plus is tab-strip-relative
| [autoload reload when needed] [zoom indicator when zoomed] [header spacer]    |  | conditional/structural header content
| [Snip] [Mneme] [MCP]                                                          |  | bottom-right status row, left-to-right
+--------------------------------------------------------------------------------+
```

State blocks: overflowed tabs (scroll arrows), conditional autoload/zoom, Mneme/MCP enabled states,
and the snip menu open state. The live evidence above establishes the three visual rows, the
Persephone-left/tab-relative-plus relationship, top-right window controls, and status order.
`MainPageView` establishes the control construction and conditional visibility
(`src/renderer/ui/app/MainPageView.ts:108-129,160-201`); `MainPage.css` establishes the status
cluster's separate bottom-right placement (`src/renderer/ui/app/MainPage.css:10-28`); `PageTabsView`
establishes wrapper, scroll arrows, and add button ownership (`src/renderer/ui/tabs/PageTabsView.ts:35-84`).

Drawn controls without entries: Snip Screen/Snip Persephone popup items — no entry: transient popup
surface, outside the shell contract; `split-primary` and `split-caret` — no entry: internal parts of
the addressable `page-tabs-add` split control; `app-header-spacer` — no entry: structural spacer,
not a user control (`doc/architecture/ui-element-contract.md:219-220`). Every permanent user-facing
header control maps to `HEADER_ELEMENTS` (`src/renderer/scripting/ai-vision/namespaces/ui.ts:5-22`).

#### `assets/guides/screens/menu-bar.md`

```text
+--------------------------------------------------------------------------------+
| [Open File] [New Window] [About] [User Guide] [Settings]                         |  | Menu Bar toolbar; actions across the top of the categories pane
| [category list]                         | [selected category content] [splitter] |  | folders left, content right, splitter between
+--------------------------------------------------------------------------------+
```

State blocks: closed (backdrop hidden), open with the category list/content pane, and a selected
folder with its dynamic content. The view appends categories, content panel, splitter and toolbar
actions in the cited order (`src/renderer/ui/sidebar/MenuBarView.ts:177-205,257-276`); open/closed
animation and the backdrop's hidden DOM state are explicit in `MenuBarView.ts:224-245` and
`src/renderer/ui/sidebar/MenuBar.css:2-29`.

Drawn controls without entries: individual category rows, folder context-menu commands, and
selected-category body controls — no entry: dynamic category/editor content; the stable list and
content-pane anchors are the supported addresses. Add `menubar-user-guide` to the declaration so
the corrected contractual control is not drawn without an entry (`doc/architecture/ui-element-contract.md:126-137`).

#### `assets/guides/screens/settings.md`

```text
+--------------------------------------------------------------------------+
| [Settings content]                                                       |  | centered Settings content below the page toolbar
| [Theme] → [Window Behavior] → [Browser Profiles] → [Links]               |  | fixed section order, top to bottom
| [Default Browser] → [File Search] → [MCP Server / Mneme] → [Git]          |  | fixed section order, top to bottom
| [Board Environment Variables] → [Script Library] → [Drawing Library]     |  | fixed section order, top to bottom
| [Video Player] → [Terminal] → [View Settings File]                       |  | final sections and file action at the bottom
+--------------------------------------------------------------------------+
```

State block: Settings sections expanded/visible as one fixed-order scroll surface; live review must
check the actual vertical fold and the Default Browser section's controls. `SettingsView` appends
the 13 section wrappers and dividers in exactly this order and then the file button
(`src/renderer/editors/settings/SettingsView.ts:48-106`). The contract supplies the root, content,
file button, and every section selector (`doc/architecture/ui-element-contract.md:139-163`).

Drawn controls without entries: `View Settings File` is not a setting key, so add its existing
`settings-view-file` data-name and explicit `where`; section roots are regions, not additional
setting rows. The 24 setting-key entries inherit section phrases as specified in step 4 below.

#### `assets/guides/screens/sidebar.md`

```text
+--------------------------------------------------------------------------------+
| shared text/page-toolbar: [page-nav-panel] [left-slot controls] [right-slot] [editor switch] |  | shared toolbar; switch last
| browser toolbar: [Home] [Back] [Forward] [Reload] [url-input] ... [Close]               |  | own toolbar; no page-nav-panel or editor switch
| board toolbar: [board controls] [editor switch]                                        |  | custom BoardToolbarView order
 +--------------------------------------------------------------------------------+
| [Explorer/Search/Boards/Git panel stack] | [active page editor]                 |  | sidebar left of page content when open
| [sidebar splitter]                      |                                        |  | splitter at sidebar's right edge
+--------------------------------------------------------------------------------+
```

State blocks: sidebar closed, one panel expanded, and multiple rendered panels with one active
panel. `PageContentView` inserts the secondary-view root before content and only mounts it when the
sidebar is open (`src/renderer/ui/app/PageContentView.ts:91-125`); `SecondaryViewsView` appends the
stack before its splitter (`src/renderer/ui/secondary-views/SecondaryViewsView.ts:69-80`). Explorer,
Search, Boards, and Git control order comes from their panel views (`src/renderer/editors/explorer/ExplorerSecondaryView.ts:112-170`,
`SearchSecondaryView.ts:40-111`, `BoardsSecondaryView.ts:128-225`,
`src/renderer/editors/git-tree/GitPanelSecondaryView.ts:57-152`).

Drawn controls without entries: data-driven file, board, tool, ref, and changed-file rows — no
entry: repeated data rows are addressed through panel state/actions; the dynamic declaration sets
cover the stable roots and actions. Panel headers have entries for each owned panel kind in
`page-panels.ts:148-175`.

#### `assets/guides/screens/tabs.md`

```text
+--------------------------------------------------------------------------+
| [page-tab] [language/editor type when present] [title] [sound when shown] |  | one tab in the header strip; conditional controls stay inside the tab
| [close/ungroup]                                                          |  | close is at the tab edge; grouped/modified state changes its icon
+--------------------------------------------------------------------------+
```

State blocks: active versus inactive, modified close-dot, grouped ungroup action, pinned icon-only
tab, audible/muted tab, no-language editor, and the conditional presence of language versus sound
controls. `PageTabView` mounts the tab root, title, and close
button (`src/renderer/ui/tabs/PageTabView.ts:136-158`) and updates the conditional language/sound
icons and grouped/modified close icons (`src/renderer/ui/tabs/PageTabView.ts:370-403`). The contract
documents the state attributes and the two exceptional tab shapes (`doc/architecture/ui-element-contract.md:98-124`).

Drawn controls without entries: tab title text and transient right-click menu — no entry: title is
content, while the tab menu is a transient popup outside the contract. The four actionable tab
controls map to `TAB_ELEMENTS` (`src/renderer/scripting/ai-vision/page-tab.ts:8-13`); their `where`
phrases must say “when a language control exists” and “when the sound indicator is shown,” not imply
fixed positions in every tab.

#### `assets/guides/screens/dialogs.md`

```text
+--------------------------------------------------------------------------+
| [active page content]                                                     |  | permanent page behind the transient surface
|                                      [Find input] [matches] [Prev] [Next] [Close] |  | Find Bar overlay at the editor's top-right
|                                      [modal question / answer controls]   |  | modal dialog when an action is waiting
+--------------------------------------------------------------------------+
```

State blocks: Find Bar open, an application modal present, an Unsaved Changes choice, the Open URL
dialog followed by the native OS file picker, and Log View inline questions. `FindBarView` fixes the
overlay's top/right anchoring and input → counter → previous → next → close order
(`src/renderer/editors/shared/FindBarView.ts:33-87`); `DialogsView` mounts transient dialog roots in
state order (`src/renderer/ui/dialogs/DialogsView.ts:19-29,38-91`). The Open URL two-stage flow and
Unsaved Changes choices are documented from their callers (`src/renderer/api/pages/PagesLifecycleModel.ts:490-491`,
`src/renderer/editors/text/TextFileActionsModel.ts:80-88`).

Decision 9 verdict: the five Find Bar names (`find-bar`, `find-input`, `find-prev`, `find-next`,
`find-close`) are contractual app-owned selectors, but they remain editor-local rather than being
added to the shell `ui.elements` list (`src/renderer/editors/shared/FindBarView.ts:33-35,52-73,127-135`,
`doc/architecture/ui-element-contract.md:15-17`). Modal internals, Log View question controls,
and the native OS picker stay drawn with no `elements` entry because transient surfaces are outside
the contract and the OS surface cannot receive an app `data-name` (`assets/guides/screens/dialogs.md:15-18,39-75`,
`doc/architecture/ui-element-contract.md:219-220`).

#### `assets/guides/screens/mcp-inspector.md`

```text
+--------------------------------------------------------------------------+
| [Saved] [HTTP/Stdio] [URL or command] [args] [Connect/Disconnect]         |  | connection bar, left-to-right
| [status/error or server identity] [Info] [Tools] [Resources] [Prompts] [History] |  | status and panel switcher
| [active panel body]                                                       |  | selected capability panel below
+--------------------------------------------------------------------------+
```

State blocks: disconnected with empty/saved connections, connecting, connection error, connected
Info, and each capability panel (Tools, Resources, Prompts, History). The view appends the toolbar,
error/server hosts, and body in order (`src/renderer/editors/mcp-inspector/McpInspectorView.ts:67-90`),
switches transport inputs between HTTP and Stdio (`McpInspectorView.ts:185-215`), and only exposes
capability segments advertised by the server (`McpInspectorView.ts:222-228`).

Drawn controls without entries: dynamic saved-connection rows, tool/resource/prompt selection rows,
argument fields, and server website links — no entry: dynamic/editor-content controls are not in
the curated 12-entry facade; their stable connection/panel/action anchors remain addressable.
The existing facade entries and their count are `src/renderer/scripting/api-wrapper/McpInspectorFacade.ts:33-46`.

#### `assets/guides/mneme.md` — Mneme Config and Mneme Root

Use two labelled diagrams under the one layout heading.

```text
+--------------------------------------------------------------------------+
| [connection status] [restart]                         [MCP] [Log]         |  | Mneme Config; status bar actions at the right
| [Embedding model] [Update/Load model]                                      |  | model section header
| [Roots] [+ Add root] [Reindex all]                                       |  | roots section header
+--------------------------------------------------------------------------+
```

```text
+--------------------------------------------------------------------------+
| [Search query] [Text/Vector/Hybrid] [Filters] [Search]                    |  | Mneme Root; search toolbar left-to-right
| [filters when open: include tags, exclude tags, dates, Clear]             |  | filter panel below the toolbar
| [status] [ranked results or empty state]                                   |  | result area below controls
+--------------------------------------------------------------------------+
```

State blocks: Config stopped versus running, disconnected/error/connected status, model ready/not
ready, roots empty/populated and reindexing; Root filters closed/open, resolving/searching/error,
no-results, and results. Config source order is status toolbar → error/health surfaces → model and
roots bodies (`src/renderer/editors/mneme-config/MnemeConfigView.ts:54-87`), with model and root
controls in `ModelPanel.ts:87-113` and `RootsPanel.ts:46-68`. Root source order and filter state
are explicit in `src/renderer/editors/mneme-root/MnemeRootEditorView.ts:296-380` and its filter
controls at `:68-101,386-415`; its wiki tree is a separate sidebar surface
(`src/renderer/editors/mneme-root/MnemeTreeSecondaryView.ts:38-73`).

Drawn controls without entries: per-root dynamic reindex/remove/filter configuration controls and
wiki tree rows — no entry: repeated data controls are owned by the dynamic root/tree state; the
stable Mneme config/root facade anchors are the declared entries at
`src/renderer/scripting/api-wrapper/MnemeConfigEditorFacade.ts:24-33` and
`MnemeRootEditorFacade.ts:8-18`. The live review may promote a repeated control only if its
selector can be stable across root names.

#### `assets/guides/boards.md` — Board Info

```text
+--------------------------------------------------------------------------+
| [page navigation] [Board Info toolbar]                         [switch]   |  | shared toolbar; switch rightmost
| [Install location / Browse]                                               |  | install mode location control
| [catalog board tiles: Download / Cancel / Retry / Register / Delete]       |  | install mode results below
| [properties: Open / Uninstall or Unregister]                               |  | properties mode actions
| [published versions: Retry / Update or Install]                            |  | versions below properties
+--------------------------------------------------------------------------+
```

State blocks: install mode empty/download/error/downloaded, properties mode for catalog versus
local board, versions loading/error/empty/available, and the trust confirmation. `BoardInfoEditorView`
mounts page toolbar before body (`src/renderer/editors/board-info/BoardInfoEditorView.ts:83-90`),
constructs install controls and their status variants (`BoardInfoEditorView.ts:188-309`), then
properties actions and version rows (`BoardInfoEditorView.ts:316-429,455-470`).

Drawn controls without entries: install progress, dynamic catalog/version rows, and the native
install-location folder picker — no entry for the progress/rows because they are repeated state;
keep the picker unaddressed because it is an OS dialog. The 11 facade anchors are declared at
`src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts:18-30`.

#### `assets/guides/agent-tools.md` — Toolset

```text
+--------------------------------------------------------------------------+
| [Toolset name] [status] [root] [description] [author]          [Refresh]   |  | toolset header; refresh at right
| [Open Folder] [Open Log]                                                  |  | actions below identity
| [manifest errors or tool cards]                                           |  | scrollable toolset body
+--------------------------------------------------------------------------+
```

State blocks: valid registered toolset, invalid manifest/error list, and no execution log. The view
appends identity/status, spacer/Refresh, then the action row and branch body in source order
(`src/renderer/editors/toolset/ToolsetEditorView.ts:57-130`). All three stable actions are declared
at `src/renderer/scripting/api-wrapper/ToolsetEditorFacade.ts:11-15`.

Drawn controls without entries: individual manifest tool cards and error rows — no entry: repeated
content, while the toolset root and three stable actions are addressable.

### 4. Fill `where` from those schemas

Use the following exact phrases in both the diagram's right margin and the declaration. Do not use
CSS selectors, coordinates, click instructions, empty strings, or `null` (`doc/tasks/US-1373-where-on-elements/README.md:333-341`).

#### `HEADER_ELEMENTS` — 16 entries

| Name | `where` |
|---|---|
| `app-header` | `top application strip` |
| `persephone-menu` | `leftmost control in the header strip, opening the Menu Bar` |
| `page-tabs` | `header tab strip, immediately right of the Persephone menu` |
| `page-tabs-wrapper` | `inside the header tab strip, around the open-page tabs` |
| `page-tabs-scroll-left` | `left edge of the tab strip, when the tabs overflow` |
| `page-tabs-scroll-right` | `right edge of the tab strip, when the tabs overflow` |
| `page-tabs-add` | `immediately right of the last visible page tab, with its split menu` |
| `autoload-reload` | `header control, when autoload files need a reload` |
| `zoom-indicator` | `header control, when the window is zoomed` |
| `window-minimize` | `top-right of the header strip, first window control` |
| `window-toggle` | `top-right of the header strip, between minimize and close` |
| `window-close` | `top-right of the header strip, far-right window control` |
| `status-indicators` | `bottom-right of the header strip` |
| `header-snip-button` | `bottom-right status cluster, first from the left` |
| `mneme-indicator` | `bottom-right status cluster, after Snip, when Mneme is enabled` |
| `mcp-indicator` | `bottom-right status cluster, after Mneme, when MCP is running` |

Evidence: `src/renderer/ui/app/MainPageView.ts:108-129`, `src/renderer/ui/app/MainPage.css:16-28`,
and `doc/architecture/ui-element-contract.md:75-97`.

#### `MENU_BAR_ELEMENTS` — 11 after adding the corrected User Guide entry

| Name | `where` |
|---|---|
| `menu-bar` | `over the page area, when the Menu Bar is open` |
| `menu-bar-content` | `left side of the open Menu Bar` |
| `menubar-open-file` | `top of the Menu Bar categories pane, first action` |
| `menubar-new-window` | `top of the Menu Bar categories pane, after Open File` |
| `menubar-about` | `top of the Menu Bar categories pane, after the action spacer` |
| `menubar-user-guide` | `top of the Menu Bar categories pane, between About and Settings` |
| `menubar-settings` | `top of the Menu Bar categories pane, right of User Guide` |
| `menubar-folders` | `left pane of the open Menu Bar, below its action row` |
| `menubar-content` | `right pane of the open Menu Bar` |
| `menubar-add-folder-button` | `bottom of the Menu Bar category pane` |
| `menubar-splitter` | `between the category list and content pane` |

Evidence: `src/renderer/ui/sidebar/MenuBarView.ts:89-143,177-205,455-467` and
`doc/architecture/ui-element-contract.md:126-137`. The `where` phrase for the backdrop includes
state because `menu-bar` remains in the DOM while closed (`MenuBarView.ts:224-245`).

#### Settings — 24 inherited catalog phrases plus `settings-view-file`

Add `where` to `SettingsCatalogSection`, not to each current row:

```typescript
// before: src/renderer/scripting/ai-vision/namespaces/settings.ts:14-20,152-158
interface SettingsCatalogSection { id: string; title: string; description: string; elementName: string; rows: readonly SettingsCatalogRow[]; }
// each generated declaration has only name, purpose, selector
```

```typescript
// after
interface SettingsCatalogSection { id: string; title: string; description: string; elementName: string; where: string; rows: readonly SettingsCatalogRow[]; }
// each generated declaration adds where: section.where
// append the existing settings-view-file declaration with its own bottom-of-content phrase
```

The section phrases and inherited keys are:

| Section (`elementName`) | Keys inheriting the section phrase | Inherited `where` |
|---|---|---|
| Theme (`settings-section-theme`) | `theme` | `Settings content, Theme section` |
| Window Behavior (`settings-section-window-behavior`) | `window.close-to-tray` | `Settings content, Window Behavior section` |
| Browser Profiles (`settings-section-browser-profiles`) | `browser-profiles`, `browser-default-profile`, `browser-default-bookmarks-file`, `browser-incognito-bookmarks-file`, `tor.exe-path`, `tor.socks-port`, `tor.bookmarks-file` | `Settings content, Browser Profiles section` |
| Links (`settings-section-link-behavior`) | `link-open-behavior` | `Settings content, Links section` |
| File Search (`settings-section-file-search`) | `search-extensions`, `search-exclude` | `Settings content, File Search section` |
| MCP Server / Mneme (`settings-section-mcp`) | `mcp.enabled`, `mcp.port`, `main.scripting.enabled`, `mneme.enabled`, `mneme.port` | `Settings content, MCP Server / Mneme section` |
| Git Integration (`settings-section-git-integration`) | `git.enabled` | `Settings content, Git Integration section` |
| Board Environment Variables (`settings-section-board-vars`) | `board-vars.file` | `Settings content, Board Environment Variables section` |
| Script Library (`settings-section-script-library`) | `script-library.path` | `Settings content, Script Library section` |
| Drawing Library (`settings-section-drawing-library`) | `drawing.library-path` | `Settings content, Drawing Library section` |
| Video Player (`settings-section-video-player`) | `vlc-path`, `video-stream.port` | `Settings content, Video Player section` |
| Terminal (`settings-section-terminal`) | `terminal.command` | `Settings content, Terminal section` |
| Page action | `settings-view-file` | `bottom of Settings content` |

`Default Browser` has no catalog row in the current source (`settings.ts:66-71`), so it contributes
no inherited key; its section remains a drawn region and its own page controls stay outside the
setting-key list. If a single key ever needs a different phrase, add `where?: string` to
`SettingsCatalogRow` and map `where: row.where ?? section.where`; the cost is one optional field,
one fallback expression, and one data value per exception, with no change to the 13-section model.
The generated shape and selector inheritance are established by `settings.ts:8-20,22-150,152-158`.

#### `TAB_ELEMENTS`, `SWITCH_ELEMENTS`, and `COMPARE_ELEMENTS`

| List | Name | `where` |
|---|---|---|
| Tab | `page-tab` | `in the header tab strip` |
| Tab | `tab-language` | `inside this page's tab, when a language control exists` |
| Tab | `tab-close` | `right edge of this page's tab` |
| Tab | `tab-sound` | `inside this page's tab, when the sound indicator is shown` |
| Switch | `page-editor-switch` | `last control on a TextChromeView/PageToolbarView toolbar; Board places its embedded switch after its custom controls` |
| Compare | `compare-root` | `active page area, replacing the normal editor content` |
| Compare | `compare-exit` | `compare surface toolbar, at the exit end` |

Evidence: `page-tab.ts:8-13`, `page-editor-switches.ts:14-16`, `page-compare.ts:8-11`,
`src/renderer/ui/tabs/PageTabView.ts:136-158`, `src/renderer/editors/base/PageToolbarView.ts:373-387`,
and `src/renderer/editors/board/BoardToolbar.ts:128-143`. Browser has no switch in its own toolbar
(`src/renderer/editors/browser/BrowserView.ts:411-417,449-453`).

#### `SIDEBAR_ELEMENTS`

| Name | `where` |
|---|---|
| `page-nav-panel` | `far left of the page toolbar` |
| `secondary-views-container` | `left side of the page area, when the sidebar is open` |
| `secondary-views-stack` | `inside the sidebar, below the panel headers` |
| `secondary-views-splitter` | `right edge of the sidebar` |

Evidence: `src/renderer/scripting/ai-vision/page-panels.ts:39-44`, `PageToolbarView.ts:180-205`,
`src/renderer/ui/app/PageContentView.ts:110-125`, and `src/renderer/ui/secondary-views/SecondaryViewsView.ts:69-80`.

#### Dynamic `panelElements(kind)` tuples — 43 entries

The current tuple type is `[name, purpose, selector?]` and declarations are produced by one map
(`src/renderer/scripting/ai-vision/page-panels.ts:148-176`). Preserve existing three-item tuples
by extending the type to `[name, purpose, selector?, where?]`; append the phrase as the fourth item,
using `undefined` in slot three when a tuple has no selector, then destructure four values and spread
`where` only when defined. This is the exact non-breaking transformation:

```typescript
// before
const source: readonly (readonly [string, string, string?])[] = ...;
return source.map(([name, purpose, selector]) => ({ name, purpose, ...(selector ? { selector } : {}) }));
```

```typescript
// after
const source: readonly (readonly [string, string, string?, string?])[] = ...;
return source.map(([name, purpose, selector, where]) => ({
    name, purpose,
    ...(selector ? { selector } : {}),
    ...(where ? { where } : {}),
}));
```

| Kind | Name | `where` |
|---|---|---|
| Explorer | `explorer-secondary-view` | `Explorer sidebar panel body` |
| Explorer | `explorer-header-actions` | `right side of the Explorer panel header` |
| Explorer | `explorer-up` | `Explorer panel header actions, first` |
| Explorer | `explorer-search` | `Explorer panel header actions, after Up` |
| Explorer | `explorer-boards` | `Explorer panel header actions, after Search` |
| Explorer | `explorer-collapse-all` | `Explorer panel header actions, after Boards` |
| Explorer | `explorer-close` | `right edge of the Explorer panel header` |
| Explorer | `explorer-open-board` | `on each matching board row in the Explorer body` |
| Explorer | `explorer-open-toolset` | `on each matching toolset row in the Explorer body` |
| Explorer | `explorer-open-git` | `on each matching Git entry in the Explorer body` |
| Explorer | `explorer-open-mneme` | `on each matching Mneme entry in the Explorer body` |
| Search | `search-secondary-view` | `Search sidebar panel body` |
| Search | `search-secondary-close` | `right edge of the Search panel header` |
| Boards | `boards-empty` | `Boards panel body, when no boards are available` |
| Boards | `boards-empty-actions` | `Boards empty state, below its message` |
| Boards | `boards-create-empty` | `Boards empty state, first action` |
| Boards | `boards-create-demo-empty` | `Boards empty state, after Create board` |
| Boards | `boards-secondary-view` | `Boards sidebar panel body` |
| Boards | `boards-tools-switch-bar` | `top of the Boards panel body` |
| Boards | `boards-close` | `right edge of the Boards panel header` |
| Boards | `boards-tools-switch` | `top of the Boards panel body, before its list` |
| Boards | `boards-create` | `top of the Boards list, beside the Boards/Tools switch` |
| Boards | `explorer-boards` | `Boards panel body, on the repeated board list` |
| Boards | `explorer-tools` | `Tools panel body, on the repeated toolset list` |
| Git | `git-panel` | `Git sidebar panel body` |
| Git | `git-panel-toolbar` | `top of the Git panel body` |
| Git | `git-panel-tabs` | `left side of the Git panel toolbar` |
| Git | `git-branches-sort-alpha` | `right side of the Git panel toolbar, on Branches or Tags` |
| Git | `git-panel-header-actions` | `right side of the Git panel header` |
| Git | `git-panel-refresh` | `Git panel header actions, first` |
| Git | `git-panel-close` | `far-right of the Git panel header actions` |
| Git | `git-panel-repo-name` | `Git panel header, beside the Git title` |
| Git | `git-changes` | `Git Changes body` |
| Git | `git-changes-unstaged` | `Git Changes body, unstaged list` |
| Git | `git-changes-staged` | `Git Changes body, staged list` |
| Git | `git-changes-toolbar` | `top of the Git Changes body` |
| Git | `git-changes-file` | `on each repeated changed-file row` |
| Git | `git-commit` | `Git Changes toolbar, commit action area` |
| Git | `git-stage` | `on each unstaged changed-file row` |
| Git | `git-unstage` | `on each staged changed-file row` |
| Git | `git-changes-splitter` | `between the Git changes lists` |
| Git | `git-branches-tree` | `Git Branches body` |
| Git | `git-tags-tree` | `Git Tags body` |

Evidence: tuple declarations and counts (`src/renderer/scripting/ai-vision/page-panels.ts:148-176`),
Explorer order (`src/renderer/editors/explorer/ExplorerSecondaryView.ts:112-170`), Boards order and
conditional switch bar (`src/renderer/editors/explorer/BoardsSecondaryView.ts:128-225,246-305`),
Search close/header (`src/renderer/editors/explorer/SearchSecondaryView.ts:40-111`), and Git toolbar,
header, and tab-dependent sort control (`src/renderer/editors/git-tree/GitPanelSecondaryView.ts:57-152,236-283`).

#### Screen-owned facade `where` tables — 70 entries

These phrases must be added to the seven declarations owned by this task. The source evidence for
each table is the corresponding view order and declaration range.

##### About — 24 (`AboutEditorFacade.ts:11-36`; `AboutView.ts:135-237`; `AboutGuidePageView.ts:104-150`)

| Name | `where` |
|---|---|
| `about-root` | `whole About page` |
| `about-content` | `inside the left About card` |
| `about-card` | `left pane of About` |
| `about-check-updates` | `lower part of the About card` |
| `about-github` | `bottom of the About card` |
| `about-report-issue` | `bottom of the About card, beside GitHub Repository` |
| `about-update-download` | `About update status area` |
| `about-update-whats-new` | `About update status area, beside Download` |
| `about-splitter` | `between the About card and guide browser` |
| `about-guide-browser` | `right pane of About` |
| `about-whats-new` | `guide contents pane, What's New section` |
| `about-whats-new-open` | `guide contents pane, beside What's New` |
| `about-resources` | `guide contents pane, Resources section` |
| `about-resource-repository` | `guide contents pane, repository resource` |
| `about-resource-issues` | `guide contents pane, issues resource` |
| `about-resource-boards` | `guide contents pane, Boards resource` |
| `about-resource-mcp-setup` | `guide contents pane, MCP setup resource` |
| `about-show-agent-guides` | `guide contents pane, above the guide tree` |
| `about-guide-tree` | `guide contents pane, below its filters and resources` |
| `about-guide-page` | `right pane of About, replacing guide contents` |
| `about-guide-breadcrumbs` | `top of the selected guide pane` |
| `about-guide-back` | `top-left of the selected guide pane` |
| `about-guide-open-in-tab` | `top-right of the selected guide pane` |
| `about-guide-body` | `below the selected guide header` |

##### Board Info — 11 (`BoardInfoEditorFacade.ts:18-30`; `BoardInfoEditorView.ts:188-309,316-470`)

| Name | `where` |
|---|---|
| `board-info-browse` | `install mode, beside the install-location field` |
| `board-info-download` | `on each catalog board tile, beside its details` |
| `board-info-cancel` | `on the active downloading board tile` |
| `board-info-retry` | `on a failed catalog board tile` |
| `board-info-register` | `on a downloaded board tile` |
| `board-info-delete` | `on a downloaded unregistered board tile, beside Register board` |
| `board-info-open` | `properties mode, board action row` |
| `board-info-uninstall` | `properties mode, board action row for a catalog install` |
| `board-info-unregister` | `properties mode, board action row for a local board` |
| `board-info-versions-retry` | `published versions section, when loading failed` |
| `board-info-version-install` | `on each published version row` |

##### MCP Inspector — 12 (`McpInspectorFacade.ts:33-46`; `McpInspectorView.ts:74-90,222-268`)

| Name | `where` |
|---|---|
| `mcp-transport` | `connection bar, after Saved connections` |
| `mcp-saved-connections` | `left side of the connection bar` |
| `mcp-url` | `connection bar, after the transport selector, for HTTP` |
| `mcp-command` | `connection bar, after the transport selector, for Stdio` |
| `mcp-args` | `connection bar, after the Stdio command` |
| `mcp-connect` | `right side of the connection bar` |
| `mcp-panel-switch` | `server status bar, after server identity` |
| `mcp-call-tool` | `Tools panel, beside the selected tool arguments` |
| `mcp-read-resource` | `Resources panel, beside the selected resource` |
| `mcp-get-prompt` | `Prompts panel, beside the selected prompt arguments` |
| `mcp-open-history` | `center of the History panel, beside the request count` |
| `mcp-clear-history` | `History panel actions, after Open in Log View` |

##### Mneme Config — 8 (`MnemeConfigEditorFacade.ts:24-33`; `MnemeConfigView.ts:54-87`; `ModelPanel.ts:87-113`; `RootsPanel.ts:46-68`)

| Name | `where` |
|---|---|
| `mneme-start` | `center of the stopped Mneme page` |
| `mneme-open-settings` | `center of the stopped Mneme page, beside Start Mneme` |
| `mneme-open-mcp-inspector` | `right side of the Mneme status bar` |
| `mneme-open-log` | `far-right of the Mneme status bar` |
| `mneme-restart` | `left side of the Mneme status bar, when disconnected` |
| `mneme-add-root` | `Roots section header, right side` |
| `mneme-reindex-all` | `Roots section header, beside Add root` |
| `mneme-update-model` | `Embedding model section header, right side` |

##### Mneme Root — 9 (`MnemeRootEditorFacade.ts:8-18`; `MnemeRootEditorView.ts:296-415`)

| Name | `where` |
|---|---|
| `mneme-search-input` | `left side of the Mneme search toolbar` |
| `mneme-search-mode` | `search toolbar, after the query field` |
| `mneme-filters-toggle` | `search toolbar, after the search mode` |
| `mneme-search-run` | `right side of the Mneme search toolbar` |
| `mneme-filter-tags` | `expanded Filters panel, first filter row` |
| `mneme-filter-exclude-tags` | `expanded Filters panel, second filter row` |
| `mneme-filter-date-from` | `expanded Filters panel, date range left side` |
| `mneme-filter-date-to` | `expanded Filters panel, date range right side` |
| `mneme-filters-clear` | `expanded Filters panel, bottom-right` |

##### Toolset — 3 (`ToolsetEditorFacade.ts:11-15`; `ToolsetEditorView.ts:57-130`)

| Name | `where` |
|---|---|
| `toolset-refresh` | `right side of the toolset header` |
| `toolset-open-folder` | `toolset action row, first` |
| `toolset-open-log` | `toolset action row, after Open Folder` |

##### Tools Hub — 3 (`ToolsHubEditorFacade.ts:10-14`; `ToolsHubView.ts:45-123`)

| Name | `where` |
|---|---|
| `tools-hub-tabs` | `top of the Tools & Editors hub` |
| `search-boards-filter` | `Search boards tab, top of the search body` |
| `search-boards-refresh` | `Search boards tab, beside the query field` |

### 5. Apply the declaration changes without changing view ownership

The declaration edits are additive and preserve existing selectors and purposes. The key before →
after shapes are:

```typescript
// before: menu-bar.ts
{ name: "menubar-settings", purpose: "Opens the Settings page." },
```

```typescript
// after
{ name: "menubar-user-guide", purpose: "Opens the User Guide at its contents." },
{ name: "menubar-settings", purpose: "Opens the Settings page." },
```

```typescript
// before: panelElements tuple
["git-changes-file", "A repeated changed-file control...", selector]
```

```typescript
// after
["git-changes-file", "A repeated changed-file control...", selector, "on each repeated changed-file row"]
```

Existing view files already expose the corrected shell names (`MainPageView.ts:108-129`,
`MenuBarView.ts:111-123`, `SettingsView.ts:97-106`, `SecondaryViewsView.ts:265-290`), so no view
file needs a planned `data-name` addition. The only new declaration names are the missing User Guide
and the existing Settings file button. Screen-owned facades retain their current selectors and
receive only `where` fields.

### 6. Review and sizing order

Do this as one implementation pass in dependency order:

1. Correct `screens/index.md` front matter and fill all 11 guide layout slots using the fixed
   template; write the diagrams and no-entry verdicts before any phrase table is edited.
2. Add section-level Settings phrases and the explicit page-action declaration; add the Menu Bar
   User Guide declaration; extend the panel tuple shape; then fill the seven static shell/tab/panel
   declaration files.
3. Fill the seven screen-owned facade lists from the corresponding diagrams.
4. Count every declaration from source again: 16 header, 11 Menu Bar, 25 Settings total (24 generated
   keys plus the page action), 4 tab,
   1 switch, 2 compare, 4 sidebar, 43 dynamic panels, and 70 handed-off facade entries. Reconcile
   any catalog drift before review.
5. Claude performs the live-window accuracy review required by EPIC-094, following the per-page
   confidence table below, and updates phrases if the running screen disagrees. The implementation
   also runs the visible `[data-name]`-to-facade diff for every screen and editor page. Codex does not
   claim live geometry verification.

This is sized as one pass because the schemas and phrases are one vocabulary and splitting them
would make the right-margin text and declaration tables drift. The work is still separable by the
four ordered batches above if review capacity requires parallel authoring.

## Concerns

### Confidence and remaining live review

Header and tabs have measured live geometry from the running 1536 × 1044 window above. The other
schemas are source-backed plans and must be opened during Claude's review; this distinction is
intentional because EPIC-094 assigns visual accuracy to that review.

| Guide page | Current evidence status | Review action |
|---|---|---|
| `screens/index.md` (About and Tools Hub) | view code alone pending live review | Open About and Tools Hub; verify splitter, selected-guide swap, pinned rail, and hub bodies (`AboutView.ts:213-237`, `AboutGuidePageView.ts:104-150`, `ToolsHubView.ts:45-123`). |
| `screens/header.md` | live measurement now available, supported by view/CSS | Verify conditional autoload/zoom and overflow states against `MainPageView.ts:83-90,108-129,160-201` and `PageTabsView.ts:47-90`; no baseline re-measurement is required for the supplied rows. |
| `screens/menu-bar.md` | view code alone pending live review | Open closed, open, and selected-folder states; verify proportions and backdrop (`MenuBarView.ts:177-195`, `MenuBar.css:13-29`). |
| `screens/settings.md` | view code alone pending live review | Open Settings and measure the vertical fold, section headings, row alignment, and View Settings File (`SettingsView.ts:48-106`). |
| `screens/sidebar.md` | view code alone pending live review | Open the sidebar and measure panel/splitter geometry, collapse states, and ordering (`PageContentView.ts:110-125`, `SecondaryViewsView.ts:69-80`). |
| `screens/tabs.md` | live measurement now available, supported by view code | Verify active, grouped, pinned, modified, no-language, language, and sound variants; the conditional DOM is established by `PageTabView.ts:136-158,370-403`. |
| `screens/dialogs.md` | view code alone pending live review | Open Find Bar, application modal, Open URL/native picker, Unsaved Changes, and Log View questions; keep transient surfaces outside the shell contract (`FindBarView.ts:33-87`, `DialogsView.ts:38-91`). |
| `screens/mcp-inspector.md` | view code alone pending live review | Open HTTP, Stdio, disconnected/connected, error, and capability-tab states (`McpInspectorView.ts:74-145,222-228`). |
| `mneme.md` | view code alone pending live review | Open stopped/running config, root/filter expansion, dynamic roots, and wiki sidebar (`MnemeConfigView.ts:54-87`, `MnemeRootEditorView.ts:296-380`, `MnemeTreeSecondaryView.ts:38-73`). |
| `boards.md` | view code alone pending live review | Open Board Info install, properties, and version states (`BoardInfoEditorView.ts:188-309,316-470`). |
| `agent-tools.md` | view code alone pending live review | Open Toolset valid/error/no-log states and verify header/action/body relationships (`ToolsetEditorView.ts:57-130`). |

### Ownership check

All eight app-screen ids are claimed after the planned index front-matter correction: About and
Tools Hub by `screens/index.md`, MCP Inspector and Settings by their screen pages, Mneme Config and
Root by `mneme.md`, Board Info by `boards.md`, and Toolset by `agent-tools.md`. No screen facade is
left unclaimed. The current source has 24 Settings rows; the planned 25th Settings declaration is
the already named View Settings File action, not a fabricated key. Re-count immediately before
implementation if the catalog changes.

### Files that need no changes

These files are evidence or shared policy only: `doc/agents-common.md`, `.claude/rules/task-docs.md`,
`doc/epics/EPIC-094.md`, `doc/architecture/ui-element-contract.md`,
`doc/tasks/US-1373-where-on-elements/README.md`,
`doc/tasks/US-1376-editor-layout-schemas/README.md`, all view files cited above, and the
front-matter parser/type files already changed by US-1375. Do not add tests or a test harness; the
project workflow has no unit-test requirement for this documentation/API vocabulary task. Do not
edit `active-work.md` because the user explicitly prohibited a dashboard entry.

## Acceptance Criteria

- [ ] The 11 guide files have complete `## Layout` sections using the US-1376 template verbatim:
  `assets/guides/screens/index.md`, `header.md`, `menu-bar.md`, `settings.md`, `sidebar.md`,
  `tabs.md`, `dialogs.md`, `mcp-inspector.md`, plus `assets/guides/mneme.md`, `boards.md`, and
  `agent-tools.md`.
- [ ] `screens/index.md` has `screen: "index"` and maps `about-view` and `tools-hub-view`; all
  eight app-screen ids are uniquely claimed by the listed guides.
- [ ] Each page has a main diagram, the required state diagrams, source/line evidence, a complete
  user-label → `elements` mapping, and an explicit decision-9 list for every drawn control without
  an entry. Dialogs explicitly distinguish contractual Find Bar selectors from out-of-contract
  modal, popup, Log View, and OS surfaces.
- [ ] `where` is filled for all current header, Menu Bar, Settings, tab, switch, compare, sidebar,
   and dynamic panel entries; `menubar-user-guide` and `settings-view-file` are added with stable
   names and phrases.
- [ ] Settings phrases live on the 13 section records and are inherited by the 24 generated key
  declarations; the optional per-key override design is documented and does not change selector
  construction. The final declaration count distinguishes 24 generated keys from the page action.
- [ ] Dynamic panel tuples preserve `[name, purpose, selector?]` compatibility by adding an optional
  fourth `where` position and mapping it only when present; Explorer 11, Search 2, Boards 11, and
  Git 19 counts are re-verified.
- [ ] The seven screen-owned facade lists receive all 70 planned phrases, with counts reconciled
  against their current declaration ranges.
- [ ] Header and tab schemas retain the supplied live measurements; Claude opens every other page
   listed in the confidence table, records source-versus-live corrections, and does not treat
   view-code-only geometry as live verification.
- [ ] The toolbar rule is scoped to the source-backed editor categories: shared TextChrome/PageToolbar,
   custom BoardToolbar, and custom BrowserToolbar. Browser review includes `toolbar-downloads` and
   the exact Home/Back/Forward/Reload/address-bar order, while US-1376 owns the facade edit.
- [ ] The implementation enumerates visible non-zero `[data-name]` nodes and diffs them against each
   facade's `elements` list for every screen/editor page, recording missing addressable controls in
   the owning task's decision-9 table.
- [ ] No unit tests, harnesses, dashboard entry, implementation code, or commit is added by this
  task-documenting turn.

## Files Changed Summary

| File | Planned change |
|---|---|
| `assets/guides/screens/index.md` | Add `screen`/two `editorId` values and About/Tools Hub layouts. |
| `assets/guides/screens/header.md` | Add header/status schema and states. |
| `assets/guides/screens/menu-bar.md` | Add closed/open Menu Bar schemas and states. |
| `assets/guides/screens/settings.md` | Add fixed-order Settings schema and section state. |
| `assets/guides/screens/sidebar.md` | Add page-area/sidebar schema and panel states. |
| `assets/guides/screens/tabs.md` | Add tab-control schema and tab-shape states. |
| `assets/guides/screens/dialogs.md` | Add transient-surface diagrams and contract boundary. |
| `assets/guides/screens/mcp-inspector.md` | Add MCP connection/panel schema and connection states. |
| `assets/guides/mneme.md` | Add Mneme Config and Mneme Root schemas and states. |
| `assets/guides/boards.md` | Add Board Info schema and install/properties states. |
| `assets/guides/agent-tools.md` | Add Toolset schema and manifest/log states. |
| `src/renderer/scripting/ai-vision/namespaces/ui.ts` | Fill 16 header `where` phrases. |
| `src/renderer/scripting/ai-vision/namespaces/menu-bar.ts` | Add User Guide declaration and fill 11 phrases. |
| `src/renderer/scripting/ai-vision/namespaces/settings.ts` | Add section inheritance, 24 key phrases, and View Settings File declaration. |
| `src/renderer/scripting/ai-vision/page-tab.ts` | Fill 4 tab phrases. |
| `src/renderer/scripting/ai-vision/page-editor-switches.ts` | Fill the editor-switch phrase. |
| `src/renderer/scripting/ai-vision/page-compare.ts` | Fill 2 compare phrases. |
| `src/renderer/scripting/ai-vision/page-panels.ts` | Fill 4 sidebar phrases and 43 dynamic tuple phrases using the fourth slot. |
| `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts` | Fill 24 screen-owned phrases. |
| `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Fill 11 screen-owned phrases. |
| `src/renderer/scripting/api-wrapper/McpInspectorFacade.ts` | Fill 12 screen-owned phrases. |
| `src/renderer/scripting/api-wrapper/MnemeConfigEditorFacade.ts` | Fill 8 screen-owned phrases. |
| `src/renderer/scripting/api-wrapper/MnemeRootEditorFacade.ts` | Fill 9 screen-owned phrases. |
| `src/renderer/scripting/api-wrapper/ToolsetEditorFacade.ts` | Fill 3 screen-owned phrases. |
| `src/renderer/scripting/api-wrapper/ToolsHubEditorFacade.ts` | Fill 3 screen-owned phrases. |
