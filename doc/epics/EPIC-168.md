# EPIC-168: Refactoring Phase 6.6 part 1 — Tool editors: `LinkCollection`, de-duplicated link views, `McpSession`, log-entry registry, typed Mneme client

## Status

**Status:** Completed
**Created:** 2026-11-14
**Completed:** 2026-11-14

## Overview

This is the twenty-eighth epic of the [refactoring roadmap](../refactoring-roadmap.md) and part 1 of roadmap item
**6.6, Tool editors** (findings **EDT-5, EDT-6, EDT-8, EDT-9, EDT-10** in
`doc/reviews/refactoring-2026-11/08-editors-tools.md`). Part 2 (EDT-11 and EDT-12) is recorded below and in the roadmap.

The code was checked on 2026-11-14, after EPIC-167. The findings still hold:

- **Link editor (EDT-5).** `editors/link-editor/LinkEditor.ts` is 1,119 lines. The "re-derive after mutation" ritual
  (`loadCategories(); loadTags(); loadHostnames(); applyFilters();`) still appears at `:353`, `:678`, `:874`, `:929`,
  `:1038`; `LinkTreeProvider.renameCategoryPath` (`:217`) re-implements the category-subtree move; the duck-typed
  embedder hooks `onLinkOpen` / `onGetLinkMenuItems` (`:126-127`) are assigned from outside; five dynamic
  `import("../../api/app")` calls remain (`:772-1087`); the incremental filter cache `lastFilterState` is at `:103`.
- **Link views (EDT-6).** `LinkBody.ts` 487, `LinksListView.ts` 467, `LinksTilesView.ts` 617, `PinnedLinksPanelView.ts`
  411, `panels/LinkTagsSecondaryView.ts` 281, `panels/LinkHostnamesNavigationPanel.ts` 238: the handler pairs, the
  two context-menu copies, three favicon trackers and the Tags/Hostnames twin panels are as the review describes.
- **MCP inspector (EDT-8).** `McpInspectorEditorModel.ts` is 951 lines; the capture-generation / time / try-catch /
  `isCurrentRequest` / `logRequest` pipeline is written seven times (`:392-802`); `McpInspectorView.ts` subscribes to
  and loads `mcpConnectionStore` itself (`:102-104`).
- **Log View (EDT-9).** The entry-type catalog is spread over `logTypes.ts`, `LogEntryContent.makeChild`,
  `api/mcp/ui-push-validation.ts` (`KNOWN_LOG_TYPES` at `:51`, which omits `log.log` while `logTypes.ts:39,201` list
  it) and `UiFacade`; `OutputEntryStubView` and `isUnknownLogEntry` are dead; `LogViewEditor.ts` (557) parses JSONL
  twice and imports `scripting/ai-vision/event-log` (`:8`).
- **Mneme (EDT-10).** 34 raw `callTool`/`parseToolResult` sites across `api/mneme-status.ts`,
  `editors/mneme-config/MnemeConfigEditorModel.ts` (581), `editors/mneme-root/MnemeRootEditorModel.ts` (419),
  `content/tree-providers/MnemeTreeProvider.ts` and `content/providers/MnemeProvider.ts`; the `status` call is
  duplicated (`mneme-status.ts:139`, `MnemeConfigEditorModel.ts:216`); the index walk (`walkRootIndexes`, `:462`) lives
  in the editor model; three hand-rolled path normalizers (`MnemeConfigEditorModel.ts:579`, `MnemeRootEditorModel.ts:92`,
  `category/FolderViewModeService.ts`).

## Goals

- **`LinkCollection`** (`editors/link-editor/link-collection.ts`): a DOM-free class that owns parse/serialize, the
  category/tag/hostname index with counts, filtering, view modes, CRUD, tag toggle, category move and pins, and
  re-indexes itself after every mutation. `TAG_SEPARATOR` / `CATEGORY_SEPARATOR` constants live there.
  **`LinkImporter`** owns the folder scan and import (returns `{ links, limitReached }`); the confirmation stays in the
  editor. `LinkEditor` keeps lifecycle, panels, selection/filter state and dialog orchestration; `showLinkDialog` and
  `addLink` share one add path; `LinkTreeProvider` and the three tag toggles call the collection. The embedder hooks
  become one explicit `LinkEditorEmbedding` passed once by the browser.
- **De-duplicated link views:** one shared items-view props base and `createLinksItemsView(mode, props)` (also used by
  `CategoryEditor`), `link-item-actions.ts` (one context menu, one open-and-save-favicon), a `FaviconRowTracker` used by
  list, tiles and the pinned panel, one `LinkFilterNavigationPanelView` with Tags and Hostnames as configurations, and
  the dead model-swap rebind code removed from the toolbar views.
- **`McpSession`** owns the connection-generation and staleness checks, timing and `logRequest` for every inspector
  request; `McpToolsModel`, `McpResourcesModel`, `McpPromptsModel` own their state, selection generation and
  operations; one `readResource(uri, target)`; `EMPTY_SERVER_INFO`; saved connections behind the model;
  `McpInspectorView.ts` re-expanded into normal multi-line classes.
- **Log entry registry:** one catalog of entry types (category, agent-documented flag, dialog spec, push
  normalisation) from which `isLogEntry`/`isDialogEntry`/`isOutputEntry`, the ui-push known-type lists and its error
  message, and `makeChild` derive; a typed child-view update instead of `update(props as unknown)`; a
  `JsonlLogDocument` that owns entries, line count and `nextId`; the dialog-answer report injected instead of imported
  from `scripting/`; dead stub, unions and `isUnknownLogEntry` removed.
- **Typed Mneme client** (`api/mneme-client.ts`) over `mnemeConnection.getClient()` that owns every tool name, timeout
  and `parseToolResult`, the progress-message parse and the index-inventory walk; the editors, `mneme-status`,
  `MnemeProvider` and `MnemeTreeProvider` call it; the three normalizers become `fpNormalizeForCompare`.

## Decisions this epic acts on

- **Scope: five tasks; EDT-11 and EDT-12 are part 2.** EDT-5 (L) + EDT-6 (M) alone are a large epic's worth of Link
  editor work; adding the three M-sized protocol/registry findings makes five coherent tasks, which is the epic size
  that has worked so far. EDT-11 (published-boards entry list for the Tools hub, `boardUsageGroup` on a `Pick`, Category
  view mode in the model; its step 3, the tree-provider host capability, was already done by EPIC-165's
  `TREE_PROVIDER_HOST_TRAIT`) and EDT-12 (About search state, one roots-tree builder, one board-vars parser, multiselect
  encode/decode) are small and independent of this epic, so they form part 2.
- **Order.** US-1952 (`LinkCollection` + `LinkImporter`) → US-1953 (link views), planned after US-1952 is implemented so
  the plan reads the real collection API. US-1954 (MCP inspector), US-1955 (Log View registry) and US-1956 (Mneme
  client) touch disjoint files and are planned in parallel with US-1952. Implementations run one at a time.
- **Where the new modules live.** Every new class stays in the owning editor folder (`editors/link-editor/`,
  `editors/mcp-inspector/`, `editors/log-view/`), except the Mneme client, which goes to `api/mneme-client.ts` because
  `api/mneme-status.ts` and two `content/` modules consume it. `mnemeTypes.ts` moves next to it
  (`api/mneme-types.ts`, importers updated, no re-export shim) so `api/` and `content/` stop importing an editor folder
  for it. The log-entry catalog part that `api/mcp/ui-push-validation.ts` needs must be DOM-free and must not import any
  view; the view factories stay in `editors/log-view/`. Moving `logTypes.ts` and `McpConnectionManager` out of editor
  folders is roadmap item 2.4 (EDT-7) and is not done here: the existing `api/mcp → editors/log-view/logTypes` edge is
  not made worse, and no new wrong-way edge is added.
- **Behaviour is kept.** Every rule moves verbatim: filter semantics (including the "tag ends with `:` → prefix match"
  rule and the incremental filter cache), the 100-file import confirmation, category-move confirmation and counts,
  pin order, view-mode keys, favicon save conditions (private pages), the MCP staleness guards (connection generation
  **and** the per-area selection re-check, in both branches), request-log entries, the Log View JSONL parse tolerance and
  id assignment, every Mneme timeout and argument shape. **The ui-push accepted type list does not change**: `log.log`
  stays a valid level in the view and stays unknown to `ui_push` (the registry's `agentDocumented` flag records the
  difference), and every ui-push error message stays byte-identical. Rendered DOM structure, CSS classes and every
  `data-name` stay identical (checked by a before/after structural fingerprint of each affected editor).
- **Contracts that must not change:** the Link editor JSON serialization (`JSON.stringify({ type: "link-editor", ...data },
  null, 4)` byte-identical, key order included), the Log View JSONL line format, the MCP connection store file, the
  script API (`LinkEditorFacade`, `McpInspectorFacade`, `UiFacade`, `MnemeConfigEditorFacade` member names and results),
  ai-vision paths and output, MCP `call` and `ui_push` behaviour and messages, `data-name`, `window.persephone` (not
  touched, so no `BOARD_BRIDGE_VERSION` bump; a plan that touches it is sent back).
- **Guardrails.** No new protocol code (guardrail 1): `McpSession` is a request-staleness wrapper over the existing
  MCP SDK client, not a new correlator or envelope, and the Mneme client calls the existing MCP tools. No
  `await import()` to break a cycle (guardrail 5): the Link editor's dynamic `import("../../api/app")` calls are replaced
  by static imports where no cycle exists, and a real cycle is reported in the plan rather than kept. God files only
  shrink (guardrail 3): `LinkEditor.ts` (1,119), `McpInspectorEditorModel.ts` (951), `LogViewEditor.ts` (557),
  `MnemeConfigEditorModel.ts` (581), `MnemeRootEditorModel.ts` (419), `LinkBody.ts`, `LinksTilesView.ts`,
  `LinksListView.ts`, `PinnedLinksPanelView.ts`.
- **Live verification limits.** Link and Log View checks use temp fixtures under `%TEMP%`; the MCP inspector connects
  only to Persephone's own loopback endpoint and never saves a connection; Mneme checks are read-only (status, roots
  list, tags/search on an existing root) and never add/remove a root, reindex, update the model or delete an index.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1952 | `LinkCollection` and `LinkImporter` | Done |
| US-1953 | De-duplicated Link editor views | Done |
| US-1954 | MCP inspector `McpSession` and per-area sub-models | Done |
| US-1955 | Log View entry-type registry and `JsonlLogDocument` | Done |
| US-1956 | Typed Mneme client | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts before/after for the god files
  above. For every exported symbol that moves or is renamed, list its importers and update them (no re-export shims).
  Every `data-name` in a touched view listed and shown preserved. List every facade member that reaches the touched
  code and show its delegate. No unit tests or harnesses.
- **US-1952.** The collection API (constructor, read, mutate, serialize/parse) with each method mapped to the
  `LinkEditor` lines it replaces; where `lastFilterState` lives; the five ritual sites removed; `showLinkDialog` vs
  `addLink` defaulting reconciled to one path with today's exact defaults; `LinkTreeProvider.getTagItems` and
  `renameCategoryPath` on the collection (one re-index, not one per link — say whether any observable intermediate state
  existed); the three tag toggles; `LinkImporter` and its confirmation threshold; `LinkEditorEmbedding` and every place
  that assigns the hooks today; each dynamic `import("../../api/app")` → static import or the cycle that prevents it;
  migration comments and the `typedQueue` cast removed only where nothing depends on them; `serialize()` byte-identity.
- **US-1953.** Per duplicated pair: today's two copies, the differences between them (the pinned menu's
  `appendLinkOpenMenuItems` is one), and how the shared helper keeps each caller's exact behaviour; the virtualized-cell
  once-per-wrapper listener rule (`model-view-pattern.md`); the Tags/Hostnames strategy fields and that both panel
  `data-name`s stay; the dead rebind code and the proof that a model swap throws today.
- **US-1954.** The seven methods → `McpSession.request` + sub-model methods with each guard kept (connection generation
  and selection generation, in success and error branches, and what is logged when stale); the facade's calls; where
  `editor.tools/resources/prompts` are exposed; the saved-connections owner; the view re-expansion (no behaviour or DOM
  change, `querySelector('[data-part="status"]')` replaced by kept references).
- **US-1955.** The full type list from every source today (view, ui-push, facade, dialog specs), the registry entry for
  each, the derived lists and the exact ui-push error-message text before/after; the typed child update; the
  `JsonlLogDocument` API mapped to the duplicated parse/serialize/`nextId` sites; how the dialog answer reaches
  `event-log` without `editors → scripting` (an injected callback or an event, wired by whom).
- **US-1956.** Every Mneme tool call today (file, line, tool name, arguments, timeout, result parse) → client method;
  the progress parse and index walk moved; the three normalizers replaced (show `fpNormalizeForCompare` gives the same
  comparison result for the inputs each site sees, or keep the site's rule and say why); every importer of `mnemeTypes`.

## Part 2 (not in this epic)

- **EDT-11:** `publishedBoards.listEntries()` in `api/published-boards.ts` so `SearchBoardsTabView` only filters and
  renders (the 11-field signature comparator goes); `boardUsageGroup` on `Pick<BoardManifest, "fileMasks" | "standalone">`;
  the Category view mode loaded and persisted by `CategoryEditorModel`; the stale "Five content tabs" comment. (Step 3 is
  already met by `TREE_PROVIDER_HOST_TRAIT`, EPIC-165.)
- **EDT-12:** `MarkdownSearchState` + `createStandaloneMarkdownBodyModel()` shared by Markdown and About; one
  `buildRootsTree` for the boards and tools trees; one strict `parseBoardVarsFile` (decide the loose-store behaviour
  first) and row validation in `EnvVarsEditor`; `encodeMultiSelect`/`decodeMultiSelect` in board-settings types.

## Out of scope

- Any change to `window.persephone`, the script API, MCP `call`/`ui_push` or the `data-name` contract.
- Roadmap item 2.4 moves (`logTypes`, `McpConnectionManager`, link list/tiles views out of editor folders).
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-14
- Epic created after EPIC-167. Findings re-checked against the code (see Overview). Codex weekly window had 31% left at
  the start; the policy pick is Luna for planning as well.

### 2026-11-14 — plan reviews and implementation
- **US-1956.** Corrections: the client receives the caller's already-guarded `Client` (callers keep their
  `getClient()` guards; no await separates guard and call), so no new missing-client error path appears; final method
  names and the exact third `callTool` argument per call (`{ timeout: 10_000 }`, `{ timeout: 15_000 }`,
  `{ signal, onprogress }`, or omitted). Accepted: all three path normalizers stay as they are —
  `FolderViewModeService.normalizePath` produces persisted `folderViewMode.json` keys and handles roots like `d:/`
  (`fpNormalizeForCompare` would strip the slash and resolve `""` to the working directory); the two Mneme rules
  compare wire/persisted values whose canonical form is not guaranteed, and the config rule moved unchanged with the
  index walk into the client. `MnemeConfigEditorModel.ts` 581 → 512, `MnemeRootEditorModel.ts` 419 → 388.
- **Live check (cold start, after US-1956):** Mneme config fingerprints (default, root-config loaded, filters open),
  `rootConfigs`, root/model key sets and every `data-name` identical to the baseline; status probe connected. Not
  exercised live: the Mneme root editor search/tags and the `mneme://` tree/content providers (no read-only fixture
  root; covered by typecheck and the call inventory).
- **US-1952.** Corrections: `TComponentState.update` is immer `produce` with auto-freeze, so `LinkCollection` keeps an
  immutable snapshot and every mutation is `this.data = produce(this.data, …)` followed by one index rebuild; the editor
  publishes `state.data = collection.data` plus the indexes in one update (all 26 former `s.data` writers, including
  the pinned-panel width, go through the collection). Import keeps calling the `addLink` defaulting rule per item and
  the reverse insertion order (`addMany`). One editor-owned defaulting helper for `addLink` and the Add dialog; the
  collection's `add` only inserts, and each caller keeps its object key order (serialized bytes unchanged). The editor's
  category-move guards and confirmation stay in the editor; `LinkCollection.moveCategory` is the unguarded rewrite the
  tree provider already used (same mapping for a non-empty source). `linksWithTag` serves the tree provider without the
  filter cache. `LinkEditor.ts` 1,119 → 813, `LinkBody.ts` 487 → 483.
- **Behaviour change (bug fix, US-1952).** The incremental filter cache reused the previous result whenever the search
  was unchanged or extended, without checking whether the links changed: with a search active, a link added through
  the toolbar (which takes the search text as its title) did not appear, a deleted link stayed listed, and an edited link
  showed its old values. The cache now also requires the same `links` array. Verified live: with search `ROW-0001`
  active, an added matching link appears and a deleted one disappears.
- **Live check (cold start, after US-1952):** Link editor fingerprints for six UI states (default, tag `kind`, tag
  `perf`, category `Media` with tiles mode, hostname, category `Dev`) identical to the baseline; facade add / add with
  defaults / update / delete of a pinned link give identical `links`, facade summaries and serialized file content.
- **US-1954.** Corrections: `McpSession.begin()` captures client and generation first (the area returns before
  touching state when there is no client, and loading flags are set after it, as today); `request(ctx, method, params,
  call, { guard, onSuccess, onError })` runs the area's mapping inside the same try, so a post-processing exception is
  still guarded and logged as a second entry instead of escaping as an unhandled rejection. `McpInspectorEditorModel.ts`
  951 → 252 (sub-models, session and three extracted panel files); `McpInspectorView.ts` 282 → 457 only because the
  single-line classes were re-expanded.
- **Live check (cold start, after US-1954):** against Persephone's own loopback endpoint: disconnected, connected,
  Info, Resources, History, resource read and after-disconnect fingerprints identical; Tools differs only by Monaco's
  lazily created hidden `context-view` node; resource content, selected resource, request-history methods and the
  facade summary identical. No connection was saved.
- **US-1955.** Corrections: registry and view-factory lookups are `ReadonlyMap.get` (a plain-object index would turn an
  entry `type` like `"constructor"` into a crash instead of the unknown-entry preview); only the strict
  `type in DIALOG_SPECS` check keeps today's plain-object semantics. The dialog-answer reporter is a required
  `LogViewEditor` constructor option supplied by the module factory in `editors/log-view/index.ts`, not a module-load
  registration that could silently be skipped. `LogViewEditor.ts` 557 → 432, `LogEntryContent.ts` 202 → 136.
- **Live check (cold start, after US-1955):** a 21-entry fixture with every entry type (including `log.log` and an
  unknown type) renders a fingerprint identical to the baseline including text; 18 strict `push` cases (valid types,
  `log.log`, unknown type, missing type, grid `content` object vs `data`, bad dialogs, mixed arrays, non-object) return
  byte-identical results and messages, and the resulting JSONL content is identical; answering an inline dialog still
  emits the "user answered Log View dialog" event.
- **US-1953.** Plan accepted without corrections. Verified: the three toolbar views live in `LinkEditorView.ts` (not
  `index.ts`) and are also mounted by the browser's bookmarks drawer and webview item, which hold a `readonly linkEditor`
  and never update those children, so the model-swap rebind code is dead in every host. `LinkBody.ts` 487 → 398,
  `LinksListView.ts` 467 → 427, `LinksTilesView.ts` 617 → 592, `PinnedLinksPanelView.ts` 411 → 326,
  `LinkEditorView.ts` 423 → 63 (toolbar views to `LinkToolbarViews.ts`), the Tags/Hostnames panels become strategies over
  `LinkFilterNavigationPanelView`.
- **Live check (cold start, after US-1953):** the six Link editor states are identical to the US-1952 run including
  leaf text, facade operations and serialized content identical; the Category editor (folder view of a temp folder,
  two folders) is identical including text; the list-row and pinned-item context menus keep their own item sets (the
  pinned one adds the open-in items and always offers Unpin).
- **Completion (2026-11-14).** `/review` (Codex): no defects; it noted non-null assertions in `DisconnectedBodyView.ts`
  (carried over from the re-expanded view code, no standard forbids them) and left them. `/document` updated
  `folder-structure.md` and `key-files.md`. `/userdoc`: no guide change needed. No English message was added or changed;
  `npm run i18n:check` reports every pack complete (1672/1672). Next roadmap item: 6.6 part 2 (EDT-11, EDT-12).
