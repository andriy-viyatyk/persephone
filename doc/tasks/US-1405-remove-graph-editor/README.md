# US-1405: Remove the built-in Force Graph editor

**Status:** Planned  
**Priority:** High  
**Epic:** [EPIC-100](../../epics/EPIC-100.md)  
**Started:** 2026-09-12

## Goal

Remove the built-in `graph-view` editor and all app-owned wiring, scripting types, icons,
MCP guide references, QA references, and current documentation. The published **Force Graph** board
(`force-graph` 1.0.0, gated at `minAppVersion 5.0.2`) is the replacement; the owner has tested it and
approved lifting the removal gate.

## Background

EPIC-100 D6 held this cleanup until owner testing. That gate is now lifted. US-1404 added the
board bridge required by the migrated feature, and US-1406 mounts trusted board guides under
`installed-boards/<board-folder>/`. The board supplies the Force Graph user/agent documentation and
its `greek-gods.fg.json` example, making the app copies redundant.

Commit [a2692189](https://github.com/andriy-viyatyk/persephone/commit/a2692189), "US-893: remove
the built-in Todo editor", is the removal precedent. Its diff removed the editor directory, facade,
public types, registry/matcher/icon/trait wiring, MCP guide and descriptions, editor-types mirror,
QA entry, and current documentation, while deliberately accepting Monaco fallback and the generic
JSON-grid switch. Graph follows that shape without compatibility shims.

### Investigation findings

- `src/renderer/editors/graph/` contains exactly 29 files: `types.ts`, `shapeGeometry.ts`,
  `index.ts`, `GraphVisibilityModel.ts`, `GraphTuningSlidersView.ts`,
  `GraphTuningSliders.css`, `GraphTooltipView.ts`, `GraphTooltipModel.ts`,
  `GraphTooltip.css`, `GraphSearchModel.ts`, `GraphMutationModel.ts`,
  `GraphLegendPanelView.ts`, `GraphLegendPanel.css`, `GraphIcons.ts`,
  `GraphHighlightModel.ts`, `GraphGroupModel.ts`, `GraphGroupActionsModel.ts`,
  `GraphExpansionSettingsView.ts`, `GraphExpansionSettings.css`, `GraphEditor.ts`,
  `GraphDetailPanelView.ts`, `GraphDetailPanel.css`, `GraphDataModel.ts`,
  `GraphContextMenu.ts`, `GraphConnectivityModel.ts`, `GraphBodyView.ts`,
  `GraphBody.css`, `ForceGraphRenderer.ts`, and `constants.ts`.
- `src/renderer/editors/register-editors.ts` has one `graph-view` row, loading `./graph`.
  `src/renderer/editors/base/editor-matchers.ts` has its matcher, including `acceptFile`,
  `switchOption`, JSON validation, and `"type": "force-graph"` plus `"nodes"` detection;
  its `SPECIALIZED_JSON_PATTERNS` also has `/\.fg\.json$/i`.
- `PageWrapper.ts` has the GraphEditor/GraphEditorFacade imports, union member, and
  `FACADE_FOR_EDITOR["graph-view"]` factory. `GraphEditorFacade.ts` is the only graph facade.
- Both app and shipped public type mirrors still have `IGraphEditor`, `"graph-view"` in the
  facade/editor unions, and the `graph-editor.d.ts` import/list entries.
- The current icon map is `src/renderer/components/icons/language-icon-resolver.ts`, not
  `LanguageIcon.tsx`. It maps `/\.fg\.json$/i` to `GraphIcon`. `GraphIcon` has exactly two
  users: that resolver and the Force Graph sidebar entry; the component is in
  `src/renderer/theme/language-icons.ts`.
- `src/renderer/api/pages/PagesLifecycleModel.ts` has no Graph-specific construction branch or
  Graph import. Its generic `attachEditorToPage()` path uses `editorRegistry.createEditorSync()`.
- `src/renderer/core/traits/TraitRegistry.ts` has no graph-owned trait.
- `asGraph()` is already absent from `src/`. The current surface is the page editor facade,
  so the plan removes that facade/type surface and adds no alias.
- `src/main/mcp-http-server.ts` has zero graph-editor names and only provides HTTP/session
  plumbing. The actual fixed guide list is `src/main/mcp/manifest.ts`: one `graph-guide` object
  plus a `SERVER_INSTRUCTIONS` mention of graph JSON.
- `resolveBoardOpenContent()` in `src/renderer/editors/board/board-open-content.ts` accepts a
  string editor id, rejects `board-editor:` ids, and calls
  `pagesModel.addEditorPage(editor as EditorView, language, title, content)`. Runtime validation is
  performed by `PagesModel.addEditorPage()`/`editorRegistry`, so narrowing the type union does not change
  this path. The implementation typecheck must confirm that.
- Only `doc/architecture/diagrams/1-application-layers.mmd` and
  `doc/architecture/diagrams/4-class-hierarchy.mmd` name this editor. The first has a Graph family
  label; the second has the two `GraphEditor` relationship lines. No other diagram does.
- No stale `GraphEditor` exemplar comment exists outside `src/renderer/editors/graph/`. The Force
  Graph rationale in `board-open-content.ts` remains valid.

### Search disposition

The required search covered `src/`, `assets/`, `qa/`, `doc/`, and root `README.md` for
`graph-view`, `GraphEditor`, `asGraph`, `fg.json`, `fg\.json`,
`force-graph`, `Force Graph`, `greek-gods`, and `editors/graph`.

| Hits | Decision |
|---|---|
| The 29-file `src/renderer/editors/graph/` directory, `GraphEditorFacade.ts`, both `graph-editor.d.ts` files, `assets/guides/editors/graph.md`, `assets/guides/formats/graph.md`, `assets/guides/examples/greek-gods.fg.json`, and `qa/surfaces/editors/graph.md` | **Delete** outright. |
| `register-editors.ts`, `editor-matchers.ts`, `PageWrapper.ts`, public type mirrors, `assets/editor-types/_imports.txt`, sidebar registry, icon resolver/component, and `src/main/mcp/manifest.ts` | **Edit** as specified below. |
| Current references in `README.md`, user/agent guides, `qa/surfaces/README.md`, architecture docs, standards, and diagrams | **Edit**. The tabs and QA index hits were omitted by the draft checklist. |
| `assets/guides/whats-new.md` | **Edit** the upcoming 5.0.2 section only; older Graph entries remain historical. |
| `src/main/mcp-http-server.ts`, `PagesLifecycleModel.ts`, `TraitRegistry.ts` | **Leave**; the suspected sites do not exist or contain no graph names. |
| `board-open-content.ts`, `board-manifest.ts`, `p-vars.ts`, board-author documentation | **Leave**; generic board infrastructure and the replacement board contract must remain. |
| Historical `doc/epics/**`, `doc/tasks/completed.md`, existing task documents, historical QA runs, and historical What's New entries | **Leave** as records explicitly outside the cleanup. |

## Implementation Plan

### 1. Delete the implementation and public surfaces

- Delete all 29 files under `src/renderer/editors/graph/`.
- Delete `src/renderer/scripting/api-wrapper/GraphEditorFacade.ts`.
- Delete `src/renderer/api/types/graph-editor.d.ts` and
  `assets/editor-types/graph-editor.d.ts`.
- Delete `assets/guides/editors/graph.md`, `assets/guides/formats/graph.md`,
  `assets/guides/examples/greek-gods.fg.json`, and `qa/surfaces/editors/graph.md`.

### 2. Remove source wiring

- Remove the `graph-view` row from `src/renderer/editors/register-editors.ts`.
- Remove `EDITOR_MATCHERS["graph-view"]` and `/\.fg\.json$/i` from
  `SPECIALIZED_JSON_PATTERNS` in `src/renderer/editors/base/editor-matchers.ts`. This
  intentionally leaves `grid-json` available as a switch for `.fg.json`.
- Remove the Force Graph item and its `GraphIcon` import from
  `src/renderer/ui/sidebar/tools-editors-registry.ts`.
- Remove the GraphEditor/GraphEditorFacade imports, union member, and factory entry from
  `src/renderer/scripting/api-wrapper/PageWrapper.ts`.
- Remove `GraphIcon` from `src/renderer/components/icons/language-icon-resolver.ts` and its
  `{ pattern: /\.fg\.json$/i, icon: GraphIcon }` entry; then remove the unused
  `GraphIcon` component from `src/renderer/theme/language-icons.ts`. JSON then uses
  `JsonIcon` until the trusted board icon wins.

Before → after:

```ts
// Before
{ id: "graph-view", name: "Graph", guidePath: "editors/graph", hasContentHost: true, load: async () => (await import("./graph")).graphModule },
// After
// The row is absent; adjacent mermaid/draw rows remain.

// Before
const SPECIALIZED_JSON_PATTERNS = [/\.note\.json$/i, /\.link\.json$/i, /\.fg\.json$/i, /\.excalidraw$/i];
"graph-view": { acceptFile: ..., switchOption: ..., validForLanguage: ..., detectsContent: ... },
// After
const SPECIALIZED_JSON_PATTERNS = [/\.note\.json$/i, /\.link\.json$/i, /\.excalidraw$/i];
// No graph matcher.
```

Do not edit `src/renderer/editors/board/board-open-content.ts`. Its arbitrary string input,
`board-editor:` rejection, and `pagesModel.addEditorPage()` delegation remain valid; the Force
Graph board uses this bridge for other built-in pages such as Markdown, Grid, and Drawing.

### 3. Remove the authoritative types and stale generated output

- In the authoritative `src/renderer/api/types/page.d.ts` and
  `src/renderer/api/types/common.d.ts`, remove the `IGraphEditor` import and facade-union
  members, and remove only the `"graph-view"` `EditorView` member.
- Delete `src/renderer/api/types/graph-editor.d.ts`.
- Do not treat `assets/editor-types/page.d.ts` or `assets/editor-types/common.d.ts` as
  independent edits. `vite.renderer.config.ts`'s `editorTypesPlugin` copies every `.d.ts` from
  `src/renderer/api/types/` into that directory at `buildStart` and on dev file changes,
  overwriting those generated copies.
- Delete the stale generated `assets/editor-types/graph-editor.d.ts` by hand. The plugin copies
  files but never deletes destination files, so deleting only the source file leaves this orphan
  in place. Do not rely on a hand edit to `assets/editor-types/_imports.txt`: the plugin regenerates
  it from every `.d.ts` in the destination, so its `graph-editor.d.ts` line returns unless the
  orphan destination file is gone.

```ts
// Before, in src/renderer/api/types/page.d.ts (the authoritative source)
import type { IGraphEditor } from "./graph-editor";
| "mermaid-view" | "graph-view" | "draw-view" | ...
| IMarkdownEditor | ISvgEditor | IHtmlEditor | IMermaidEditor | IGraphEditor
// After
| "mermaid-view" | "draw-view" | ...
| IMarkdownEditor | ISvgEditor | IHtmlEditor | IMermaidEditor
```

The board path stays generic: `resolveBoardOpenContent()` retains its string input and runtime
registry validation. Removing the obsolete literal from `EditorView` does not prevent requests for
`md-view`, `grid-json`, or `draw-view`, and the final typecheck must confirm
`board-open-content.ts` compiles unchanged. After `npm run build-prod`, confirm that the generated
`assets/editor-types/page.d.ts` and `common.d.ts` reflect the source edits, that
`assets/editor-types/graph-editor.d.ts` is still absent, and that `_imports.txt` no longer lists it.

### 4. Remove the fixed MCP graph guide

- In `src/main/mcp/manifest.ts`, remove the `graph-guide` object from `resourceFiles` and
  remove `graph JSON` from the `SERVER_INSTRUCTIONS` formats sentence.
- In `assets/guides/mcp-setup.md`, remove the **Graph Guide** row.
- Leave `src/main/mcp-http-server.ts` and `src/main/mcp/server-factory.ts` unchanged: the first
  has no graph offers and the second generically loops over `resourceFiles`.

```ts
// Before: src/main/mcp/manifest.ts
"... for notebook, links, or graph JSON use guides.formats.<page> ..."
{
    name: "graph-guide",
    uri: "persephone://guides/graph",
    file: "guides/formats/graph.md",
    description: "Force-graph editor reference: JSON data format, editor paths, editing graph data, and grouping nodes.",
},

// After
"... for notebook or links JSON use guides.formats.<page> ..."
// No graph-guide object in resourceFiles.
```

### 5. Update developer documentation and diagrams

- `doc/architecture/editors.md`: remove the registry row, Graph from the native
  `VanillaView` sentence and concrete-editor list, the `GraphEditorFacade` facade row,
  `graph-view` from priority 20, and the force-graph content-detection mapping.
- `doc/architecture/folder-structure.md`: remove the graph directory/file listing,
  `graph-editor.d.ts`, and `GraphEditorFacade.ts`.
- `doc/architecture/key-files.md`: remove its five graph-specific key-file rows.
- `doc/architecture/scripting.md`: remove the Graph facade row, its structural type
  example, and graph type/facade file-tree rows.
- `doc/standards/coding-style.md`: remove `editors/graph/GraphBodyView.ts` from the
  confirmation-dialog precedent list; the text and Git Tree examples remain.
- `doc/standards/editor-guide.md`: remove `*.fg.json` from priority-20 examples.
- `doc/architecture/diagrams/1-application-layers.mmd`: remove the Graph label;
  `doc/architecture/diagrams/4-class-hierarchy.mmd`: remove both GraphEditor relationship lines.

### 6. Update current user documentation and QA

- `assets/guides/editors/index.md`: remove the Graph row, Graph switch/content-detection
  claims, and the deleted guide link.
- `assets/guides/agents/pages.md`: remove Graph from creatable ids, the specialized editor
  table, initial-content list, format subsection, and structured-editor error example.
- Remove graph facade/example references from `assets/guides/scripting/index.md`,
  `assets/guides/scripting/api/index.md`, and `assets/guides/scripting/api/page.md`.
- Remove the Force Graph item from the built-in items sentence in
  `assets/guides/tabs-and-navigation.md`.
- Remove the graph surface row from `qa/surfaces/README.md`.
- In `README.md`, remove the Force Graph row from **Built-in editors**. Keep Git's
  commit-history graph wording and the catalog paragraph.
- In `assets/guides/whats-new.md`, add a Breaking Changes section before the upcoming
  5.0.2 New Features section, matching the existing user-facing style. Use this exact entry:

  - **The built-in Force Graph editor is now a board** — Install the **Force Graph** board from the
    **persephone-boards** catalog for interactive force-graph editing. Without it, `.fg.json` files
    still open as raw JSON in the Text Editor. Open **Tools & Editors → Search boards**, find
    **Force Graph**, choose **Install**, and trust it when prompted.

  Leave older What's New entries unchanged.

### 7. Update the dashboard and verify

- Replace the EPIC-100 line in `doc/active-work.md` with:

  ```md
  - [ ] [US-1405: Remove the built-in Force Graph editor](tasks/US-1405-remove-graph-editor/README.md)
  ```

  Keep it under EPIC-100 and unchecked; this document plans implementation and the owner-testing
  gate note is removed.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`. The production build runs
  `vite.renderer.config.ts`'s `editorTypesPlugin`; after it completes, confirm the generated
  `assets/editor-types/page.d.ts` and `common.d.ts` reflect the authoritative source edits,
  `assets/editor-types/graph-editor.d.ts` is still absent, and `_imports.txt` no longer lists it.
  Confirm the type-union removal compiles `board-open-content.ts` and unknown ids remain rejected
  at runtime.
- Re-run the required grep and account for only retained historical records, EPIC-100 records,
  board-author/replacement-board documentation, generic graph wording, and this task document.

## Concerns

- Pre-approved degradations are intentional: `.fg.json` falls back to Monaco without the board;
  dropping its specialized pattern offers `grid-json` as a switch; its file uses the generic JSON
  icon until the board is installed; persisted `graph-view` tabs are dropped; saved links targeting
  it get no remap; `page.asGraph()` has no alias; and content detection for
  `"type": "force-graph"` JSON is lost without the board.
- No compatibility shim, migration, remap, alias, or app-side content matcher is to be proposed.
- Keep `src/renderer/theme/p-vars.ts`: its 14 graph colors are the additive board contract
  from US-1404. Keep generic board manifest/content-mask handling and the open-content bridge.
- Historical Graph/asGraph/graph-view matches are expected and must not be rewritten.

All investigation questions are resolved. The draft's Lifecycle branch, TraitRegistry graph trait,
four/five `mcp-http-server.ts` locations, and `LanguageIcon.tsx` mapping do not exist in the
current implementation.

## Acceptance Criteria

- [ ] The 29 built-in graph files, facade, graph type definitions, redundant app guides/example,
      and graph QA surface are deleted.
- [ ] Current registry, matcher, sidebar, facade factory, public types, icon resolver, and fixed MCP
      resource contain no built-in graph editor references.
- [ ] `SPECIALIZED_JSON_PATTERNS` no longer contains `/\.fg\.json$/i`; Monaco/grid fallback behavior
      is retained as specified.
- [ ] `board-open-content.ts` is unchanged and compiles after the authoritative `EditorView`
      type loses `"graph-view"` and the generated copy reflects that change.
- [ ] After `npm run build-prod`, `assets/editor-types/graph-editor.d.ts` remains absent and
      `_imports.txt` no longer lists it; the generated page/common copies match `src/renderer/api/types/`.
- [ ] Developer docs, current user/agent docs, README, QA index, MCP setup/manifest, and diagrams
      match the removal; older records remain untouched.
- [ ] The upcoming 5.0.2 Breaking Changes entry names the Force Graph board, raw JSON fallback, and
      Tools & Editors → Search boards installation path.
- [ ] `doc/active-work.md` has the linked, ungated EPIC-100 entry.
- [ ] No compatibility shim is added; `npm run typecheck`, `npm run lint`, and `npm run build-prod`
      pass; final grep has no unaccounted current hits.

### Files that need NO changes

- `src/main/mcp-http-server.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, and
  `src/renderer/core/traits/TraitRegistry.ts` — no current graph implementation sites.
- `src/renderer/editors/board/board-open-content.ts` — generic validated board bridge.
- `src/renderer/editors/board/board-manifest.ts`, `src/renderer/theme/p-vars.ts`,
  `assets/guides/boards.md`, `assets/guides/agents/boards.md`, and
  `assets/board-template/CLAUDE.md` — replacement-board infrastructure/documentation.
- `src/main/mcp/server-factory.ts` — generic `resourceFiles` loop.
- Historical `doc/epics/**`, `doc/tasks/completed.md`, existing task documents,
  historical QA runs, and older `assets/guides/whats-new.md` sections — retained records.

## Files Changed

| Path | Planned change |
|---|---|
| `doc/tasks/US-1405-remove-graph-editor/README.md` | This investigation and implementation plan. |
| `doc/active-work.md` | Link US-1405 under EPIC-100 and remove the gate note. |
| `src/renderer/editors/graph/` | Delete all 29 built-in editor files. |
| `src/renderer/scripting/api-wrapper/GraphEditorFacade.ts` | Delete the graph facade. |
| `src/renderer/api/types/graph-editor.d.ts` | Delete the app graph type definition. |
| `assets/editor-types/graph-editor.d.ts` | Delete the stale generated graph type by hand; the build plugin does not delete destination files. |
| `src/renderer/editors/register-editors.ts` | Remove the graph registry row. |
| `src/renderer/editors/base/editor-matchers.ts` | Remove the graph matcher and specialized filename pattern. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Remove graph imports, union member, and factory. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Remove the Force Graph creatable item. |
| `src/renderer/components/icons/language-icon-resolver.ts` | Remove the `.fg.json` icon mapping. |
| `src/renderer/theme/language-icons.ts` | Remove the unused `GraphIcon` component. |
| `src/renderer/api/types/page.d.ts` | Authoritatively remove the graph import and facade-union members. |
| `src/renderer/api/types/common.d.ts` | Authoritatively remove `graph-view` from `EditorView`. |
| `assets/editor-types/page.d.ts`, `assets/editor-types/common.d.ts` | Generated copies updated by `editorTypesPlugin`; do not hand-edit. |
| `assets/editor-types/_imports.txt` | Regenerated by `editorTypesPlugin` after the orphan graph type is deleted; do not hand-edit. |
| `src/main/mcp/manifest.ts` | Remove the fixed graph resource and instruction mention. |
| `assets/guides/mcp-setup.md` | Remove the Graph resource row. |
| `doc/architecture/editors.md` | Remove current graph registry, facade, priority, and detection references. |
| `doc/architecture/folder-structure.md` | Remove graph directory/type/facade listings. |
| `doc/architecture/key-files.md` | Remove graph key-file rows. |
| `doc/architecture/scripting.md` | Remove graph facade/type references. |
| `doc/standards/coding-style.md` | Remove the deleted graph file from a code precedent list. |
| `doc/standards/editor-guide.md` | Remove `*.fg.json` from priority examples. |
| `doc/architecture/diagrams/1-application-layers.mmd` | Remove Graph from the editor-family label. |
| `doc/architecture/diagrams/4-class-hierarchy.mmd` | Remove GraphEditor relationships. |
| `assets/guides/editors/index.md` | Remove current Graph catalog/switch/detection claims. |
| `assets/guides/agents/pages.md` | Remove Graph creation and format guidance. |
| `assets/guides/scripting/index.md` | Remove the graph facade example. |
| `assets/guides/scripting/api/index.md` | Remove the graph facade branch. |
| `assets/guides/scripting/api/page.md` | Remove graph id and facade descriptions. |
| `assets/guides/tabs-and-navigation.md` | Remove Force Graph from built-in items. |
| `assets/guides/whats-new.md` | Add the upcoming 5.0.2 Breaking Changes entry. |
| `README.md` | Remove Force Graph from the built-in editor table. |
| `qa/surfaces/README.md` | Remove the graph QA index row. |
| `assets/guides/editors/graph.md`, `assets/guides/formats/graph.md`, `assets/guides/examples/greek-gods.fg.json`, `qa/surfaces/editors/graph.md` | Delete redundant app-owned assets. |
