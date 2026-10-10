# US-1669 — Board metadata text: `manifest.*` keys

Epic: [EPIC-126 — Boards localization](../../epics/EPIC-126.md#us-1669--board-metadata-text)

## Goal

Resolve user-visible board metadata from reserved `manifest.*` keys in the board’s language packs while retaining English manifest values for board identity, agents, scripts, and persisted state. Use one cached renderer resolver shared by all presentation surfaces, with US-1667’s fallback and validation behavior.

## Background

F1 reserves `manifest.name`, `manifest.description`, `manifest.editorName`, `manifest.views.<id>.title`, `manifest.settings.<key>.label`, and `manifest.settings.<key>.description`. Capability declarations also have a `title`: `src/renderer/editors/board-info/BoardInfoEditorView.ts:445-459` displays it in Board Info as the “capability title” detail. Add `manifest.capabilities.<id>.title` so that visible manifest text is covered too. Keep every English value in `board-manifest.json`; packs supply translations only.

US-1667 already reads the current, base, and default board packs, validates arbitrary flat keys and reserved `manifest.*` strings, and pseudo-localizes the default board pack for `en-XA` (`src/renderer/editors/board/board-i18n.ts`; see [US-1667](../US-1667-board-i18n-runtime/README.md), Implementation Plan 2–3, 6). Reuse its file loading, validation, and message lookup; do not create another JSON reader or validators. Add metadata resolution beside that loader or have the new display module call an exported helper from it.

### Display inventory

The inventory below groups related elements by visible surface. It contains **14 local-manifest display sites** plus one published-catalog display site owned by US-1670; the final row records the explicitly requested toolbar/status audit where no `manifest.*` value is currently shown.

| # | Display site and current source | Planned display behavior |
|---|---|---|
| 1 | Boards tree: `src/renderer/editors/board/boards-tree-build.ts:20-32,42-50,65-91,99-123` builds each board leaf from its path segment; `src/renderer/editors/board/BoardsTreeView.ts:140-147` caches the projected nodes; `src/renderer/ui/sidebar/TrustedBoardsListView.ts:48-67,244-255` supplies the trusted roots. | Resolve the board leaf label from `manifest.name`, retaining the path for its stable node value and as the fallback. Keep containing folder labels as paths. |
| 2 | Board Info name/description: `src/renderer/editors/board-info/BoardInfoEditorModel.ts:400-421` builds the raw-English `BoardPropsInfo`; `src/renderer/editors/board-info/BoardInfoEditorView.ts:340-372` displays the name and description. | In the existing async model load, await `ensureBoardDisplayText()` before returning the English model snapshot; the view then uses the synchronous accessor. Keep model and facade data English. |
| 3 | Board Info editor association name: `src/renderer/editors/board-info/BoardInfoEditorModel.ts:437-450`; `src/renderer/editors/board-info/BoardInfoEditorView.ts:385-407` shows `info.editorName` beside file/folder masks. | Display `manifest.editorName` through the resolver; keep masks, editor kind, and association data intact. |
| 4 | Capability title in Board Info: `src/renderer/editors/board-info/BoardInfoEditorView.ts:445-459`, specifically `:452`. | Add `manifest.capabilities.<id>.title` and resolve by capability ID at display time. The title is user-visible, so it is included even though F1’s initial reserved-key list omits it. |
| 5 | Open with submenu: `src/renderer/content/open-with-editor.ts:29-43` obtains options from `getFileOpenEditorOptions()`; `src/renderer/editors/base/editor-switch-options.ts:41-65` builds file choices and `:82-125,142-195` builds folder/content/page switch options from `CustomEditorMatch.name`. | Keep `name` English in registry/matching data and resolve the displayed board name by `boardRoot` when projecting option labels. |
| 6 | Board page tab title: `src/renderer/editors/board/BoardEditorModel.ts:1091-1106,1109-1115` keeps the file/folder title or sets the manifest’s English name on a plain-board page; `src/renderer/ui/tabs/PageTabView.ts:70-79` calls `displayPageTitle()`. | Leave stored page title English. Add an optional third `boardRoot` parameter to `displayPageTitle()` and pass it only for board pages; translate only when the stored title matches the board’s English manifest name. File and folder titles stay as source data. Subscribe the tab view to the board display-text change signal and unsubscribe in its existing disposal path. |
| 7 | Open Tabs sidebar labels: `src/renderer/ui/sidebar/OpenTabsListView.ts:97,142` also calls `displayPageTitle()`. | Pass the optional board root only when known, subscribe to the display-text change signal, and unsubscribe during disposal. Other callers without a board root remain unchanged. |
| 8 | Secondary-view sidebar panel title: `src/renderer/editors/board/BoardSecondaryView.ts:108-122` puts `declaration.title` into `SideBarPanelHeaderView`; the panel ID is derived from the view ID in `src/renderer/editors/board/BoardEditorModel.ts:1202-1222`. | Resolve `manifest.views.<id>.title` for the user-facing header; keep the ID and declaration’s English title untouched in state. |
| 9 | Settings navigation/content tree board section: `src/renderer/editors/settings/SettingsView.ts:373-409` creates a board section with `title: board.name`; `:93-115,425-436` projects section titles into the Content tree. | Use the localized board display name for the settings section label while retaining the stable namespace-derived section ID. |
| 10 | Board Settings heading: `src/renderer/editors/settings/SettingsView.ts:290-309` passes the registration name as `displayName`; `src/renderer/editors/settings/sections/BoardSettingsSection.ts:40-52` renders it. | During the existing async Settings initialization, await `ensureBoardDisplayText()` for registered boards before building their section DOM; the view uses the synchronous accessor. Keep `BoardSettingsRegistration.name` English. |
| 11 | Board setting labels/descriptions, including folder picker title: `src/renderer/editors/settings/sections/BoardSettingsSection.ts:32-34,68-107,109-119` displays labels/descriptions; lines 76-99 also pass the label as the open-folder dialog title. | Resolve `manifest.settings.<id>.label` and `.description` from the ready cache while building the section. The setting ID, options, values, storage, and errors remain English/unchanged. |
| 12 | Tools & Editors board entries (including disabled bundled-board rows): `src/renderer/ui/sidebar/tools-editors-registry.ts:221-246,271-284` builds board items and `:253-255` resolves labels; `src/renderer/ui/sidebar/BuiltinEditorsListView.ts:37,113-120` renders/sorts them. | Resolve a bundled board’s name for display; subscribe to the display-text change signal and unsubscribe in disposal. Keep item IDs (`bundled-board:<id>`) stable. |
| 13 | Pinned rail board entries: `src/renderer/ui/sidebar/PinnedRailView.ts:138-146,209-226,251-260` has a separate board-pin branch and currently labels a board with `fpBasename(root)`. | Resolve `manifest.name` from the pinned root for display; subscribe to the display-text change signal and unsubscribe in disposal. Keep the serialized pin root unchanged. Bundled editor pins continue through `getCreatableItemLabel()`. |
| 14 | New-page/editor menu board entries: `src/renderer/ui/tabs/PageTabsView.ts:298-308` creates menu rows using `getCreatableItemLabel()`. | Reuse the same board display accessor and change signal so open menus/list projections refresh; unsubscribe in disposal. Do not change menu item identity. |
| 15 | Tools Hub published-board cards: `src/renderer/editors/tools-hub/SearchBoardsTab.ts:226-237,357-367,463-468` searches and displays catalog `name` / `description`, sourced from published catalog metadata rather than an installed local manifest. | This is US-1670’s localized-catalog surface; keep it English in US-1669 and hand off to the catalog task. |
| — | Toolbar/status bar audit: `src/renderer/editors/board/BoardToolbar.ts:136-150` displays runtime `toolbarText`, and `src/renderer/editors/board/BoardStatusBarItems.ts:137-165` renders board-provided status items. These are runtime API strings, not the listed manifest fields. | No `manifest.*` display change here. Bundled/catalog board application copy is handled by later EPIC-126 board tasks. |

The current `BoardsTreeView` is instantiated by the trusted boards sidebar list (`TrustedBoardsListView:51`); the tree builder documents single-root and multi-root modes at `boards-tree-build.ts:7-11`. Keep tree node values/path roots unchanged and only alter the leaf’s presentation label. The registry’s `CustomEditorMatch.name` is a shared data source for Open with and editor switching, not a translated identity: `src/renderer/editors/board/custom-editor-registry.ts:89-103,471-489,511-544,596-610`.

### Agent-facing text and identity inventory

These sites continue to read raw English manifest values, IDs, or durable state. Apply translation only in the view/accessor layer; do not rewrite their source data.

| Site | Existing source and split |
|---|---|
| MCP/local board listings and `boards.*` results | `src/renderer/api/boards.ts:208-223,264-270` builds listing `name`/`description` directly from `readBoardManifest()`; keep those English. `src/renderer/scripting/ai-vision/namespaces/boards.ts:18-25,58` describes the English API names and behavior. The display resolver must not be used by either path. |
| Board editor API / `$help` manifest snapshot | `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:89,123,408-410` exposes `getManifest()`; `src/renderer/scripting/api-wrapper/board-manifest-projection.ts:10-54,57-82` copies English metadata including capability/view/settings declarations. Leave the projection and help/schema strings English; Board Info translates only its rendered copy. |
| AI-vision page/panel labels | `src/renderer/scripting/ai-vision/page-panels.ts:52-59,299` returns `declaration.title` as the panel label. Keep that agent-facing label English; only `BoardSecondaryView`’s UI header uses the resolver. Snapshot text inside board documents may of course show the board’s rendered translation, per F5. |
| `$help`, board guides, runtime diagnostics | The board API declaration and help text (`src/renderer/editors/board/board-api.d.ts:11` and `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:89,123`) and board guide corpus remain English under D3. This task adds no help/guide copy. |
| Tool search | `tools.search` searches registered toolset manifest names/descriptions in `src/renderer/api/tools/registered-tools.ts:108-160`; this is a separate Tools manifest surface and does not consume board `manifest.*` metadata. Keep search corpus and IDs English. |
| Persisted page title and board selection | `BoardEditorModel.ts:1091-1115` writes the English manifest name into `state.title`; `src/renderer/api/pages/PagesPersistenceModel.ts:85-95,209-222` preserves board state across restore. Keep title and `selectedBoard` English; presentation is converted by `displayPageTitle()` only. |
| Board identity / comparisons | `src/renderer/editors/board/board-manifest.ts:252-270` requires English `author` + `name` and forms `stableBoardIdentity`; `custom-editor-registry.ts:480-489,517-544` uses that namespace and English names; `SettingsView.ts:395-409` derives stable settings section IDs from the namespace. Never compare translated text or key a stable identity by a translation. |
| Settings keys and values | `src/renderer/api/board-settings/board-settings-bridge.ts:50-66,131-197` resolves, validates, reads, and writes by declaration `id`; `BoardSettingsSection.ts:68-107,144-168` likewise uses `declaration.id` for control names and values. Only the label/description are translated. |
| Manifest/API projection data | `board-manifest-projection.ts:11-54` and `src/renderer/api/types/board-editor.d.ts:51-86` keep manifest property names, setting IDs, view IDs, and capability IDs as data. No localized fields are copied back into the manifest/API. |

F5/E2 split: keep `manifest.name`, `description`, `editorName`, capability/view titles, setting IDs/keys, stored page titles, settings namespaces, and MCP/script projections in English. The new display accessor accepts English source values and a manifest key, returning localized text for presentation. It never mutates the normalized manifest or returns localized data to agents.

### Resolution and cache design

Add `src/renderer/editors/board/board-display-text.ts` as the single renderer-facing API. It accepts a board root, the already normalized manifest, and an English source value/key; it resolves the corresponding `manifest.*` key using the same current → base → default lookup order as US-1667, then falls back to that English manifest value. Invalid or absent reserved-key entries follow `board-i18n.ts` validation behavior and simply fall through.

US-1667 pseudo-localizes a board’s default-pack table in the current slot for `en-XA`. Manifest metadata has no manifest-derived English entry in that pack, so the display resolver must apply the shared `pseudoText()` from `src/shared/i18n/pseudo-text.ts` to the English manifest value whenever the app locale is `en-XA`. Do not require `manifest.*` keys in `lang/en.json`; English remains in the manifest. For a non-English locale, resolve the reserved key current → base → default → manifest English.

The locale is fixed for the window’s life under D5; a language change reloads the window. Key the cache only by normalized board root, using `Map<root, Promise<table>>` for deduplicated lazy reads and a resolved `Map<root, table>` containing the current → base → default merged `manifest.*` entries. `ensureBoardDisplayText(root, manifest)` lazily fills those maps. When `BoardWebview.registerBoard()` calls `loadBoardI18n()` for a board open/reload (`src/renderer/editors/board/BoardWebview.ts:546-568`), hand its loaded tables and normalized manifest to the display cache to replace that root’s resolved table and fire the change signal. This makes edited packs visible on reopen without filesystem checks during rendering. Clear the affected root on uninstall/rename and clear cached display entries when `customEditorRegistry.refresh()` runs. Do not use `fs.stat` or per-render I/O.

Expose `onBoardDisplayTextChanged(listener): () => void`, emitting the changed root whenever its table resolves or is refreshed. The app event channels in `src/renderer/api/events/` do not include an existing board-display invalidation event; use a module-local typed `EventChannel` (same subscription/disposer pattern) rather than adding an unrelated application event. Boards tree, pinned rail, Tools & Editors list, Open Tabs, the page tab title, and any other list using the synchronous accessor subscribe and reproject; each view unsubscribes through its existing teardown. Board Info and Settings already have async load/initialization paths, so await `ensureBoardDisplayText()` before constructing their view DOM rather than subscribing. The synchronous accessor returns the English manifest source until the table is ready. For `en-XA`, it immediately returns `pseudoText(english)` without waiting for or loading a table.

### Before → after

```ts
// Before: registry data and settings field labels are displayed directly
label: board.name
label: declaration.label || declaration.id
```

```ts
// After: English data stays on the model; presentation uses one resolver
label: boardDisplayText(board.boardRoot, board.manifest, "manifest.name", board.name)
label: boardDisplayText(root, manifest, `manifest.settings.${declaration.id}.label`, declaration.label || declaration.id)
```

```ts
// Before: translated page titles are selected only for built-in editor names
displayPageTitle(state.editor, state.title)

// After: stored title is still English; only a board page passes its optional root
displayPageTitle(state.editor, state.title, boardRoot)
```

The display accessor should accept the normalized manifest and explicit English fallback because some callers (e.g. a board setting declaration or a capability/view title) are iterating nested declarations, while others have only the root and board registry match. It should centralize mapping from manifest path to pack key; do not hand-build fallback chains at each call site.

## Implementation Plan

1. [x] **Extend reserved metadata keys and resolver.** In `src/renderer/editors/board/board-display-text.ts`, add key helpers/accessors for name, description, editor name, view title, setting label/description, and capability title. Reuse exported loading/validation/lookup from `src/renderer/editors/board/board-i18n.ts`; if needed, factor only the shared board-pack table loader out of that file. Keep fallback order current → base → default → English manifest source. For `en-XA`, the synchronous accessor immediately returns `pseudoText(english)` without loading any table. Keep `Map<normalizedRoot, Promise<table>>` for in-flight deduplication and `Map<normalizedRoot, table>` for resolved merged manifest entries. Add `ensureBoardDisplayText(root, manifest)`, a refresh entry point called with `loadBoardI18n()` results from `BoardWebview.registerBoard()`, `onBoardDisplayTextChanged(listener)`, and root/all invalidation methods.

2. [x] **Make collection surfaces consume presentation values without changing identity.** In `src/renderer/editors/board/boards-tree-build.ts` and `BoardsTreeView.ts`, accept/project cached board leaf labels while preserving roots, values, and folder segments. Update `src/renderer/ui/sidebar/TrustedBoardsListView.ts` to use the synchronous accessor and subscribe to root change notifications; unsubscribe in its existing teardown. Keep English names in `src/renderer/editors/board/custom-editor-registry.ts`; update `src/renderer/editors/base/editor-switch-options.ts` to resolve display labels for file, folder, and content editor-switch options. Update `src/renderer/content/open-with-editor.ts` only if needed to render resolved board option labels while keeping stable editor IDs.

3. [x] **Localize Board Info display only.** Keep `src/renderer/editors/board-info/BoardInfoEditorModel.ts` and `src/renderer/scripting/api-wrapper/board-manifest-projection.ts` English. In the existing async Board Info model load, await `ensureBoardDisplayText(root, manifest)` before returning the model snapshot. In `src/renderer/editors/board-info/BoardInfoEditorView.ts`, resolve name and description, editor association name, and capability titles synchronously from the ready cache; use declaration IDs for `manifest.capabilities.<id>.title` and preserve the existing English fallback when a key is absent.

4. [x] **Keep page state English and localize rendered titles.** Extend `displayPageTitle()` in `src/renderer/ui/tabs/page-title.ts` with an optional third `boardRoot` parameter. Only board pages pass the root from `src/renderer/ui/tabs/PageTabView.ts` and `src/renderer/ui/sidebar/OpenTabsListView.ts`; callers without a root remain unchanged. Resolve only when the stored title equals the board’s English manifest name (plain board page); preserve file names, folder titles, caller overrides, and page persistence data. Both list views subscribe to `onBoardDisplayTextChanged()` and unsubscribe during disposal.

5. [x] **Localize secondary view headers and settings UI.** In `src/renderer/editors/board/BoardSecondaryView.ts`, resolve `manifest.views.<id>.title` for the user-facing header while retaining declaration IDs and English titles in model state; subscribe to the change signal if the current board has not yet registered. In the existing async Settings initialization in `src/renderer/editors/settings/SettingsView.ts`, await `ensureBoardDisplayText()` for registered boards before building their board sections. In `src/renderer/editors/settings/sections/BoardSettingsSection.ts`, read localized labels/descriptions by setting ID from the ready cache, including the folder-picker dialog title. Preserve setting values, IDs, and the English storage model.

6. [x] **Localize bundled-board entries, board pins, and trust display names.** Add display-only root/manifest context to bundled creatable items in `src/renderer/ui/sidebar/tools-editors-registry.ts` and resolve their labels through `getCreatableItemLabel()` for `BuiltinEditorsListView` and `PageTabsView`; preserve `bundled-board:<id>`. In `src/renderer/ui/sidebar/PinnedRailView.ts`, resolve a `kind: "board"` row from its root instead of `fpBasename(root)`; serialized pins remain root-based. These lists subscribe to the display-text change signal and unsubscribe in disposal. In `src/renderer/editors/board/request-board-trust.ts`, await `ensureBoardDisplayText()` before showing a dialog that uses `boardName`; if pack loading fails, continue with the English name and never block the trust prompt. Keep raw English data for uninstall/update/API operations. Do not localize published-catalog `PublishedBoardInfo` here; that is US-1670.

7. [x] **Keep agent-facing consumers English.** Confirm `src/renderer/api/boards.ts`, `src/renderer/scripting/ai-vision/namespaces/boards.ts`, `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts`, `src/renderer/scripting/api-wrapper/board-manifest-projection.ts`, `src/renderer/scripting/ai-vision/page-panels.ts`, settings namespace/key handling, persistence, and `tools.search` continue to use raw values/IDs. If registry values gain any display field, keep it additive and separate from `name`, namespace, identity, and API projections.

8. [ ] **Extend the scratch board live check.** Update the existing `C:\projects\test-boards\us-1667-i18n` fixture with one `secondaryViews` entry and one `settings` declaration in `board-manifest.json`; add the corresponding `manifest.name`, `manifest.views.<id>.title`, and `manifest.settings.<key>.label` / `.description` strings in `lang/de.json` (and retain the existing `manifest.name`). Under `de`, inspect the Boards sidebar, Board Info, Open with for a matching file, plain-board tab and Open Tabs entry, secondary sidebar panel title, and Settings section/setting text. Repeat under `en-XA` and confirm metadata is pseudo-text derived from the English manifest without a `manifest.*` value in the English pack. Verify English fallback for a missing German key. Call `boards.list()` over MCP and `pages[i].editor.getManifest()`; confirm both still return English manifest values and unchanged setting/view IDs. Do not edit `doc/epics/EPIC-126.md` or `doc/active-work.md`.

## Concerns

- F1 does not list capability title, but source inspection confirms Board Info displays it (`BoardInfoEditorView.ts:452`). Include `manifest.capabilities.<id>.title` so no displayed manifest title is missed.
- An initial untrusted board has its manifest read before trust. The ordinary trust dialog shows the path and permission disclosure; `boardName` also appears in permission-change text and in the legacy deprecation warning (`request-board-trust.ts:42-50,74-80`; `TrustBoardDialogView.ts:34-57`). Translate any displayed board name before trust too, using the board’s own manifest/pack data; keep path, permission flags, capability IDs, and warning meaning unchanged.
- The app locale is fixed for a window lifetime under D5. The root-only cache refreshes whenever `loadBoardI18n()` runs during board registration/reopen and is cleared by registry refresh or board removal/rename; do not add filesystem-stat cache checks or per-render file access.
- `ensureBoardDisplayText()` can fail if a board pack cannot be read. The trust-dialog caller must catch that failure and use the synchronous English fallback so localization never blocks the security prompt.
- Change notifications are needed for views whose labels can be created before registration loads the packs. Board Info and Settings have existing async initialization and should await the resolver before constructing their DOM; the tree, pins, editor list, page tabs/Open Tabs, and tab title subscribe and dispose their listeners.
- `en-XA` metadata is generated from English manifest values, not only from a board’s default pack. Preserve placeholders if any are introduced later; current reserved metadata validation disallows placeholder-bearing metadata keys per US-1667.
- Runtime board toolbar/status-bar text is not manifest metadata and is not extracted by this task. Later bundled/catalog board work owns extraction of board-authored UI copy.
- Published board search cards use `PublishedBoardInfo.name` / `description` (`src/renderer/editors/tools-hub/SearchBoardsTab.ts:226-237,463-468`); localization is assigned to US-1670 and must not be pulled into this local manifest resolver.
- Board Info and script facades share source model objects. Translate in the view only; mutating `BoardPropsInfo` or normalized declarations would leak localized metadata into AI-facing projections.

## Acceptance Criteria

- All 14 local-manifest display sites use the single cached display resolver where they show a board manifest field; the published-catalog site remains US-1670 scope, and audited toolbar/status items remain classified as runtime board text.
- Reserved keys include F1’s six forms plus `manifest.capabilities.<id>.title`; English values remain in the manifest and missing pack entries fall back current → base → default → manifest English.
- Under `en-XA`, each manifest value shown in UI is pseudo-localized from its English manifest value even when the packs contain no `manifest.*` entries.
- Under `en-XA`, the synchronous accessor immediately returns `pseudoText(english)` without loading any board table.
- The cache is keyed only by normalized board root and has in-flight `Map<root, Promise<table>>` and resolved `Map<root, table>` maps. Pack loading happens during `ensureBoardDisplayText()` or board registration/reopen, never on each render. Registration refreshes the merged `manifest.*` table; uninstall/rename and `customEditorRegistry.refresh()` clear affected entries. No `fs.stat` checks are used.
- `onBoardDisplayTextChanged(listener)` emits the affected root on resolve/refresh and returns an unsubscribe function. Board tree, pinned rail, Tools & Editors list, Open Tabs, tab title, and relevant board headers re-render on that signal and dispose their subscriptions. Board Info and Settings await cache population in their async initialization before DOM construction. Trust-dialog pack failures fall back to English and do not block the prompt.
- Display translation never changes `CustomEditorMatch.name`, settings IDs/namespaces, board roots, capability/view IDs, persisted page titles, or API/MCP/script projections.
- Board tabs and Open Tabs translate a plain board’s title at presentation time while state/storage continues to hold the English manifest name; file/folder/caller-supplied titles remain intact.
- Board Info displays localized name, description, editor name, and capability title; secondary panel headers display localized view titles; board settings render localized section, label, description, and folder-picker title.
- Trust/permission UI localizes a board name if shown before trust while all permission disclosure content and path data remain as before.
- With the scratch fixture, `de` and `en-XA` checks cover the named UI locations and missing-key fallback; `boards.list()` and `getManifest()` continue to report English metadata and stable IDs.

## Files Changed

Files investigated that should need no changes: `src/renderer/editors/board/board-manifest.ts` for manifest identity/normalization and `stableBoardIdentity()` (add no localized fields there); `src/renderer/scripting/api-wrapper/board-manifest-projection.ts`, `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts`, `src/renderer/api/boards.ts`, `src/renderer/scripting/ai-vision/namespaces/boards.ts`, and `src/renderer/scripting/ai-vision/page-panels.ts` (keep English projections and agent-facing labels); `src/renderer/api/board-settings/board-settings-bridge.ts` and `src/renderer/api/board-settings/BoardSettingsStore.ts` (keys/values/storage remain unchanged); `src/renderer/api/pages/PagesPersistenceModel.ts` (persisted title stays English); `src/renderer/api/tools/registered-tools.ts` (separate toolset search corpus); `src/renderer/editors/board/BoardToolbar.ts` and `BoardStatusBarItems.ts` (runtime board strings, not manifest metadata); `src/renderer/editors/tools-hub/SearchBoardsTab.ts` (published catalog belongs to US-1670); `src/renderer/ui/dialogs/TrustBoardDialogView.ts` unless a UI-only name projection is required beyond passing a localized display `boardName`; and `doc/epics/EPIC-126.md` / `doc/active-work.md` (explicitly excluded by this request).

| File | Planned change |
|---|---|
| `doc/tasks/US-1669-board-metadata-text/README.md` | This task plan. |
| `src/renderer/editors/board/board-display-text.ts` | New single resolver, cache, invalidation/prewarm, manifest-key helpers, and display accessors. |
| `src/renderer/editors/board/board-i18n.ts` | Export/reuse the existing pack read, validation, and fallback path needed by metadata; avoid duplicate parsing. |
| `src/renderer/editors/board/boards-tree-build.ts` | Project localized leaf labels while retaining stable path values. |
| `src/renderer/editors/board/BoardsTreeView.ts` | Accept cached board labels and reproject on resolver updates. |
| `src/renderer/ui/sidebar/TrustedBoardsListView.ts` | Prewarm/subscribe board tree display labels. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Resolve visible metadata fields and capability title for display. |
| `src/renderer/editors/base/editor-switch-options.ts` | Localize board labels in file/folder/content editor switch options. |
| `src/renderer/content/open-with-editor.ts` | Update only if needed to project localized labels without changing option IDs. |
| `src/renderer/ui/tabs/page-title.ts` | Add board-aware presentation lookup while preserving stored English titles. |
| `src/renderer/ui/tabs/PageTabView.ts` | Supply board root to page-title display resolution. |
| `src/renderer/ui/sidebar/OpenTabsListView.ts` | Supply board root to the same page-title resolver. |
| `src/renderer/editors/board/BoardSecondaryView.ts` | Resolve localized manifest view title for the user-facing panel header and subscribe to updates until data is ready. |
| `src/renderer/editors/board/BoardWebview.ts` | Hand normalized manifest and `loadBoardI18n()` tables to the display cache on each registration/reopen. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Await display cache readiness during its existing async local-board load without changing returned English metadata. |
| `src/renderer/editors/settings/SettingsView.ts` | Resolve board section title in Settings navigation and view props. |
| `src/renderer/editors/settings/sections/BoardSettingsSection.ts` | Resolve board setting labels, descriptions, and picker title. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Carry display-only root/manifest context and resolve bundled-board labels. |
| `src/renderer/ui/sidebar/BuiltinEditorsListView.ts` | Subscribe to resolver changes, refresh labels, and unsubscribe during disposal. |
| `src/renderer/ui/sidebar/PinnedRailView.ts` | Resolve trusted board pins by root, subscribe to resolver changes, and preserve pin identity. |
| `src/renderer/ui/tabs/PageTabsView.ts` | Render creatable-board menu labels through the shared display accessor and refresh on resolver changes. |
| `src/renderer/api/board-install.ts` | Clear the relevant root cache entry during board uninstall/rename operations. |
| `src/renderer/editors/board/request-board-trust.ts` | Supply a localized display name when trust/permission UI shows it; preserve English board data. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Only if a display-only cache/prewarm hook must be connected; retain the registry’s English identity fields. |
