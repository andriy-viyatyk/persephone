# US-1485 — Built-in tab presentation and the Disable action

**Status:** Planned · **Epic:** [EPIC-109: Bundled boards and the Excalidraw board](../../epics/EPIC-109.md) · **Depends on:** [US-1483: Bundled board registry and discovery](../US-1483-bundled-board-registry/README.md), [US-1484: Stable identity for bundled boards across install paths](../US-1484-bundled-board-identity/README.md)

## Goal

Present each enabled bundled board under **Tools & Editors → Built-in** as an ordinary creatable
item, with a bundled-board-only **Disable** action. Disabling must remove that board's creatable
item, custom-editor claims, and board-origin capability registrations live; removing the setting
entry must restore all three without restarting the renderer.

EPIC-109 D6 is explicitly deferred to EPIC-110. The epic keeps the platform `draw-view`
`image.edit` handler as the working fallback, so disabling a bundled handler correctly falls back
to Draw and cannot produce a no-handler state during this epic.

## Background

### Shipped bundled-board and identity code

US-1483 and US-1484 are present in the source despite their older documents still saying Planned.
The live `src/renderer/editors/board/bundled-board-registry.ts` exposes `BundledBoard` records with
the stable immediate folder name (`id`), the current absolute `root`, the parsed `manifest`, and
`origin: "bundled"`. `list()` is synchronous after `ensureInitialized()`, and `subscribe()` is an
in-memory refresh seam.

`src/renderer/editors/board/custom-editor-registry.ts` already reads the bundled records in
`refresh()`, creates real-root ids with `boardEditorId(root)` (`board-editor:<absolute root>`), and
tears down all board-origin providers, schemes, and capabilities before committing a rebuilt state.
Its constructor subscribes to both `boardTrust` and `bundledBoardRegistry`; the bundled subscription
is sufficient for a bundled-registry refresh, but a settings change does not currently notify that
registry. US-1485 must add the settings subscription that calls `customEditorRegistry.refresh()`.

`src/renderer/editors/board/board-access.ts` currently treats every discovered bundled root as
permitted. This task does not invent a third capability origin or change the trusted-or-bundled
permission contract: disabling is enforced at the custom-editor source selection and the existing
board-origin teardown, which is what removes the file and capability registrations required here.

### Built-in surfaces and row behavior

`src/renderer/ui/sidebar/tools-editors-registry.ts` defines `CreatableItem` (`id`, `label`, `icon`,
`create`, and `category`) and the static `draw-view` row. `getCreatableItems()` is synchronous and
currently returns static items plus browser-profile items. `BuiltinEditorsListView` obtains that
list, removes pinned editor ids, sorts it, and supplies one hover-visible trailing slot containing
the pin button.

The sidebar and hub do not diverge: `ToolsEditorsPanelView.mountBody()` constructs
`BuiltinEditorsListView` for the sidebar’s Built-in tab, and `ToolsHubView.mountBody()` constructs
the same class for the full-page `builtin` tab. Updating that shared view and its source list makes
both surfaces consistent; neither mounting file needs a separate bundled-board branch.

The existing comparable per-row actions are context-menu actions: `TrustedBoardsListView` places
board operations such as **Remove** in `BoardsTreeView`’s row context menu, and
`TrustedToolsListView` exposes **Remove** the same way. The built-in list is a `ListBoxView`, whose
`getContextMenu` prop dispatches row-specific `MenuItem[]` through the normal app context-menu
pipeline. Therefore Disable belongs in the bundled row’s context menu, not in a second hover
button that would make ordinary built-in rows look different. The pinned rail needs the same
bundled-only context-menu item because a pinned creatable item is intentionally removed from the
main Built-in list and rendered by `PinnedRailView` instead.

### Pins and settings

`src/renderer/ui/sidebar/pinned-items.ts` stores editor pins as bare creatable-item ids in the
`pinned-editors` string array; only trusted board pins use the `board:<absolute-root>` prefix.
`PinnedRailView.refresh()` maps stored editor ids through `getCreatableItems()` and filters missing
items. `PageTabsView.updateAddMenu()` does the same for the plus menu. This is already the desired
missing-item behavior: a pin to a currently unavailable item is retained but inert/hidden.

The disable state should therefore be one array setting, for example
`disabled-bundled-boards: string[]`, containing stable `BundledBoard.id` values rather than
absolute roots. Folder ids survive install-path changes, array membership is enough for a small
immutable app-owned catalog, and no per-board record or manifest schema change is needed. A stored
id for a board that no longer ships remains harmless and retained; it is ignored while absent and
will keep that id disabled if a later build ships it again.

Add the key, default, and JSON5 comment in `src/renderer/api/settings.ts` following the existing
`pinned-editors` entry. The default is `[]`. The two logical readers of the flag are deliberately
exactly:

1. `getCreatableItems()` filters bundled records before constructing `CreatableItem`s.
2. `customEditorRegistry.refresh()` filters the bundled source loop before it builds `sources`,
   `entries`, provider declarations, and capability registration intents.

The writer is the Disable action’s read-modify-write of that array. `settings.set()` immediately
updates the in-memory state, emits `settings.onChanged`, and persists asynchronously; it does not
require a restart. `customEditorRegistry` must subscribe to `settings.onChanged` for this key and
call its existing asynchronous `refresh()`. Its existing `bundledBoardRegistry.subscribe()` remains
the source-refresh seam; it is not, by itself, sufficient for a setting-only change.

### Verified creation and open paths

The existing `draw-view` row calls:

```typescript
pagesModel.addEditorPage("draw-view", "json", "untitled.excalidraw");
```

That path is not reusable by simply substituting `board-editor:<root>`:
`PagesLifecycleModel.addEditorPage()` validates the id with `editorRegistry.getById()` and throws
`Editor '<id>' is not registered` for a dynamic board id. The real file-open path is different:

```text
file/path → PagesLifecycleModel.newEditorModel()
          → resolveEditorIdForFile()
          → PagesLifecycleModel.buildEditorById(board-editor:<root>, filePath)
          → BoardContentEditorModel when the registry match says editorKind = content-host
          → adopt a TextFileModel host and restore it
```

The creatable item must use a dedicated page-creation seam that reuses
`PagesLifecycleModel.buildEditorById()` with no `filePath`, rather than casting the dynamic id into
`EditorView` or opening a fake file named `untitled.excalidraw`. The new seam should:

- validate an enabled bundled `CustomEditorMatch` for the current `boardEditorId(root)`;
- construct the existing `BoardContentEditorModel` path with an undefined file path, so the adopted
  `TextFileModel` is genuinely untitled and no filesystem pipe is opened;
- apply the same initial JSON language/title values as the first board’s built-in row (for the
  Excalidraw board: `json` and `untitled.excalidraw` as display title, with `filePath` still
  undefined), restore the model, and add it through the normal `PagesLifecycleModel.addPage()`;
- expose the operation through a `PagesModel` delegate so the UI does not reach a private lifecycle
  method; and
- guard the asynchronous click path so a construction failure is not an unhandled rejection.

The before/after boundary is:

```typescript
// Before: valid for static editor ids only; a bundled board id throws in addEditorPage().
create: () => pagesModel.addEditorPage("board-editor:" + board.root, "json", "untitled.excalidraw");

// After: the lifecycle builds the dynamic board editor and its empty content host explicitly.
create: () => {
    void guard(`Failed to create ${board.manifest.name ?? board.id}`, () =>
        pagesModel.addBundledBoardPage(board.root, "json", "untitled.excalidraw"));
};
```

A valid bundled manifest with no editor association is intentionally not a file editor:
`getBoardEditorAssociation()` returns `null`, so `customEditorRegistry.entries` has no
`board-editor:<root>` match. Its creatable item must instead open the ordinary standalone board
through `createLinkData(encodePersephoneBoardLink(root))` and the existing `openRawLink` channel.
The same standalone fallback applies to a non-content-host association, because a simple board has
no Persephone content host to attach to an untitled page. No synthetic editor id or manifest create
field is added.

### Untitled content-host save and dirty state

The untitled case has a real save path in the existing host implementation, but it does not invent
content. `newTextFileModel(undefined)` starts with `content: ""`, `modified: false`, `temp: true`,
no `filePath`, and no primary pipe. `BoardContentEditorModel.adoptHost()` keeps that exact
`TextFileModel` as the content owner; `BoardContentEditorModel.restore()` restores the board and
then the host, which leaves the empty host untouched because it has neither a pipe nor modified
content. The proposed page seam must therefore initialize the host's language/title only, not claim
that the app has populated the board document.

The board bridge is the content hand-off. `BoardWebview` pushes the host snapshot to the iframe,
and `src/board-shim.ts` implements `persephone.host.setContent()` by posting `board:setContent`.
`BoardWebview` handles that message with `BoardContentEditorModel.hostChangeContent()`, which calls
the adopted host's `changeContent(content, true)`. Thus Save writes the host state only after the
board has supplied content; an untitled board that never calls `setContent()` will honestly save an
empty file. The shim's automatic Ctrl/Cmd+S and explicit `persephone.host.save()` both post
`board:save`, which calls `BoardContentEditorModel.hostSave()`.

`TextFileIOModel.saveFile()` forces Save As when the host has no writable pipe, so both Save and
Save As open the native `showSaveFileDialog` with the title (initially `untitled.excalidraw` for
the planned Excalidraw row) as the default path. It writes the host state's current `content` to a
new `ContentPipe`, adopts that pipe, clears `modified`, clears `temp`, and sets `filePath` and the
tab title to the chosen path. A subsequent Save writes through that pipe; Save As always opens a
new path dialog. `BoardContentEditorModel.modified` delegates to the host, and its
`confirmRelease()` delegates to `TextFileModel.confirmRelease()`, so the first board edit through
`setContent()` sets `modified: true`, makes the page dirty, and causes the normal Save/
Don't Save/Cancel close prompt. A newly created untouched page has no dirty prompt.

This is verified platform plumbing, not yet an end-to-end proof for the future Excalidraw board:
there is no shipped bundled content-host board to exercise its first content population. The
temporary fixture must include an actual `host.setContent()` edit and then verify both save paths
write those bytes. If that fixture or US-1487 shows that the real board cannot populate an untitled
host before Save, the smallest honest option is to defer the creatable item until US-1487, when a
real board exists to test it against; this task must not ship a New Drawing row that cannot keep the
user's work.

## Implementation Plan

### 1. Add the stable disable setting

- Modify `src/renderer/api/settings.ts`:
  - add `"disabled-bundled-boards"` to `AppSettingsKey`;
  - add a JSON5 comment describing a `string[]` of stable bundled folder ids, default `[]`, and
    the fact that changes apply live;
  - add the default array to `defaultAppSettingsState.settings`.
- Keep the setting internal to the existing generic `ISettings` API; do not add a per-board record,
  manifest field, trust-file entry, or new public settings schema.

### 2. Build bundled creatable items

- Modify `src/renderer/ui/sidebar/tools-editors-registry.ts`:
  - extend `CreatableItem` with bundled-board metadata sufficient for the row context menu, such
    as the stable `bundledBoardId` and a disable callback; do not overload `board:` because
    `pinned-items.ts` reserves that prefix for trusted board roots;
  - read `bundledBoardRegistry.list()` and the disabled-id array in `getCreatableItems()`;
  - emit one item per enabled record with a collision-safe stable item id such as
    `bundled-board:<BundledBoard.id>`, a display label from `manifest.name` falling back to the
    stable folder id, the board glyph from `createBoardGlyphElement(root)`, category `"editor"`,
    and the creation behavior described above;
  - update the setting array idempotently from the Disable action without removing pins.
- The built-in row remains an ordinary `CreatableItem`; it does not enter `mergeBoardSources()`,
  `TrustedBoardsListView`, or the Registered boards inventory.

### 3. Present Disable consistently on both Built-in surfaces

- Modify `src/renderer/ui/sidebar/BuiltinEditorsListView.ts`:
  - retain the existing pin button and `trailingVisibility: "hover"` rule unchanged;
  - add `ListBoxView.getContextMenu` to the row traits, returning a single **Disable** menu item
    only when the source item carries bundled-board metadata; return no row menu for sections and
    ordinary built-in editors;
  - use the existing generic context-menu dispatch and the same action style as trusted-board and
    trusted-tool Remove actions; do not add a second trailing button.
- Modify `src/renderer/ui/sidebar/PinnedRailView.ts` to add a new native `contextmenu` listener to
  its manually-created rows. `PinnedRailView` currently dispatches click and drag events only; it
  does not have a row context-menu path like `ListBoxView` or `TreeView`. For a pinned bundled
  editor, convert the event with `ContextMenuEvent.fromNativeEvent(event, "generic")` and append
  the single **Disable** item. For an ordinary built-in editor or a trusted `board:` pin, append
  zero row-specific items, preserving the current global empty-menu behavior; they must not acquire
  a Disable entry merely because the rail now listens for context menus.
- Add `"disabled-bundled-boards"` to the setting-change subscriptions in
  `BuiltinEditorsListView`, `PinnedRailView`, and `PageTabsView`. A disabled item must disappear
  from the Built-in list, pinned rail, and plus menu immediately; an inert stored pin must not be
  removed.
- Do not modify `src/renderer/ui/sidebar/ToolsEditorsPanelView.ts` or
  `src/renderer/editors/tools-hub/ToolsHubView.ts`: both already mount the same
  `BuiltinEditorsListView`, which is the consistency guarantee.

### 4. Add the dynamic bundled-board page-creation seam

- Modify `src/renderer/api/pages/PagesLifecycleModel.ts` with a public lifecycle method (the plan
  uses `addBundledBoardPage(boardRoot, language, title)`) that reuses the existing dynamic
  `buildEditorById()` branch rather than `editorRegistry.getById()`.
- Require the current custom-editor entry to be `origin: "bundled"` and `editorKind:
  "content-host"`; build with no file path, initialize the empty host's language/title while
  leaving its content empty until the board calls `host.setContent()`, await the normal
  board/host restore sequence, and call `addPage()`.
- Do not add a second save implementation. The adopted host already makes Save and Save As use
  `TextFileIOModel.saveFile()` and the existing board shim already forwards Ctrl/Cmd+S and
  `host.save()` to `BoardContentEditorModel.hostSave()`; the fixture must prove that the board's
  first `host.setContent()` reaches that host before writing.
- For a record without an association or with a non-content-host association, keep the item’s
  `create()` on the standalone `persephone-board://` open path; do not fabricate a file-backed host.
- Add the corresponding delegate to `src/renderer/api/pages/PagesModel.ts`. Keep the public script
  `EditorView` union unchanged because this is an internal bundled-board operation, not a promise
  that arbitrary dynamic board ids are accepted by `app.pages.addEditorPage()`.

### 5. Gate the two registration/presentation readers and refresh live

- Modify `src/renderer/editors/board/custom-editor-registry.ts`:
  - subscribe in the constructor to `settings.onChanged`; when the key is
    `"disabled-bundled-boards"`, call the existing `refresh()`;
  - in `refresh()`, read the disabled stable-id set and skip those records in the bundled source
    loop before capability/provider/editor intents are collected;
  - leave `bundledBoardRegistry.subscribe()` in place for discovery refreshes;
  - rely on the existing generation guard and clear-before-rebuild sequence so a disabled board’s
    custom-editor entry, file-mask claim, provider/scheme registrations, and board-origin
    capability registrations are removed atomically, while re-enable rebuilds them.
- Do not alter `bundled-board-registry.ts`: it remains the discovered-record source, including
  disabled records, so a setting change can restore a board without rescanning installer assets.
- Do not add a priority-ordering feature. The existing custom capability resolver remains the
  source of current ordering; this task only removes and restores one bundled source.

### 6. Manual verification with a temporary fixture

The verifier—not this planning task—creates a throwaway fixture under `assets/boards/`, uses it
with the already-running app, and removes it before finishing. The fixture is never committed, the
running app is not closed or restarted, and no file under the user’s Persephone data directory is
edited directly.

Use a minimal temporary `assets/boards/us1485-fixture/` containing a valid `board-manifest.json`
and an `index.html` probe with a control that calls `persephone.host.setContent()` (and, if useful,
`persephone.host.save()`). The manifest should use a visible name, a file mask such as
`"*.us1485.json"`, `editorKind: "content-host"`, a priority above the built-in claimant, and an
`image.edit` capability declaration. Arrange for the normal bundled refresh seam to see the fixture
without restarting the app.

Verify, on both the sidebar panel and the full Tools Hub:

1. The fixture appears as a normal Built-in creatable row, is not listed under Registered boards,
   and its row menu contains **Disable**; ordinary rows such as `draw-view` have no Disable item.
2. Creating it produces a new untitled content-host board page through the dynamic
   `board-editor:<root>` construction path, with no phantom file opened. A fixture with no editor
   association opens as a standalone board page instead.
3. Pin the fixture. Confirm its pin is represented by the existing stable creatable id, then
   disable it. The row, pinned-rail row, plus-menu entry, custom-editor/file-mask entry, and
   fixture capability handler disappear; the `pinned-editors` value still contains the pin.
4. Re-enable by removing the fixture id from `disabled-bundled-boards` through the live settings
   API. Without restarting, confirm the creatable row, its file claim, and its capability handler
   return, and the retained pin returns to the pinned rail. Confirm an unknown stored disabled id
   has no visible effect and is not silently rewritten.
5. Exercise Save and Save As on the untitled content-host page. Confirm both show the native save
   path dialog (Save also does so because the new host has no pipe), write the board's current host
   content rather than an empty placeholder, clear the dirty state, and update the page path/title.
   Edit the board through `persephone.host.setContent()` and close it before saving to confirm the
   normal unsaved-changes prompt; close it without an edit to confirm there is no prompt.

After verification, remove the fixture and any sample files created for it. Confirm no
`assets/boards/` fixture remains and no unrelated settings, pins, or user data were changed.
No unit tests, test harnesses, packaging changes, permanent board assets, or capability-routing
changes are part of this task.

## Verification (2026-09-20)

Verified live over MCP after a cold restart, using a temporary **content-host** fixture at
`assets/boards/us1485-fixture/` whose board calls `persephone.host.getContent()`,
`onContentChange()`, `setContent()` and `save()`. Fixture, sample files and all opened pages were
removed afterwards; the user's session file was never touched.

**Presentation (D3).** The board appeared in **Tools & Editors → Built-in** as an ordinary row,
"US1485 Fixture Editor", among Grid (JSON), Notebook and the rest — and **not** under Registered
boards. `renderState` reported `"bundled"` on a board with no entry in `trustedBoards.txt`, which
is US-1483's C5 decision observed end to end for the first time.

**The content-host round trip — the C2 risk.** Resolved empirically, not on paper:

| Step | Result |
|---|---|
| Open `sample.us1485` | opens in `board-editor:…\assets\boards\us1485-fixture` |
| Board calls `host.getContent()` | receives the file's real text |
| Board calls `host.setContent(...)` | page `modified` becomes `true` |
| Board calls `host.save()` | **the file on disk contains the board's bytes** |

**Disable (D4), through the real context menu.** Right-clicking the bundled row offers
**Disable**; clicking it wrote `disabled-bundled-boards: ["us1485-fixture"]`, removed the row, and
a newly opened `.us1485` file resolved to **monaco** instead of the board — all **without a
restart**, confirming both flag readers react. Clearing the setting restored the row and the file
claim, again live.

**C3.** A non-bundled row's context menu offers only the pre-existing **Inspect** — no Disable, and
no empty menu shell.

### Methodology note worth keeping

Reading these registries through a dynamic `import()` from `script.execute` is **unreliable**: it
can resolve to a second, uninitialized module instance. Doing so initially showed zero bundled
entries and a file resolving to `monaco`, which looked exactly like a missing-registration defect —
while the real application had registered the board correctly. Every conclusion above was instead
taken from real application surfaces: opening a file and reading which editor claimed it, the
rendered Built-in list, and the live context menu. A false defect report was avoided only by
forcing a cold restart before drawing any conclusion.

## Concerns / Open questions

1. **D6 is deferred to EPIC-110 by an explicit epic decision.**
   `src/renderer/editors/register-editors.ts` declares `draw-view` with `image.edit` and
   `diagram.edit`, and `src/renderer/api/capabilities.ts` seeds those as platform candidates.
   EPIC-109 deliberately keeps that built-in handler registered as the working fallback, so a
   disabled bundled handler must fall back to Draw. US-1485 adds no no-handler message or
   capability-routing workaround; EPIC-110 owns the later state where the built-in is removed.
2. **Re-enable has no row after Disable.** The required “completely removed” behavior means a
   disabled board cannot leave an Enable creatable item in Built-in. Re-enable is therefore the
   live settings operation that removes the stable id from `disabled-bundled-boards`; the retained
   pin is intentionally inert until then. A later task may add a dedicated settings UI, but this
   task must not weaken the complete-removal invariant to make an Enable row possible.
3. **Untitled content-host save depends on the board sending content.** The platform save path is
   real and verified: no pipe forces a native Save/Save As dialog, and the adopted host's current
   content is what gets written. But the new host begins empty, and `BoardWebview` only forwards
   bytes after the board calls `persephone.host.setContent()`. The fixture and US-1487 must verify
   that the board populates the host before Save; otherwise the honest fallback is to defer the
   creatable item until US-1487, when a real board exists to test it against.
4. **Content-host creation must not use a fake path.** The existing file-open path proves that the
   dynamic id is buildable only through `PagesLifecycleModel.buildEditorById()` and a
   `BoardContentEditorModel` host. Passing `untitled.excalidraw` as `filePath` would make the host
   attempt ordinary file-pipe restoration; the planned helper keeps it as display title only.
5. **A bundled board without an association is still creatable, but not as a file editor.** Its
   row opens the board root through the existing standalone board link. No custom entry means no
   valid `board-editor:<root>` content-host construction path.
6. **No stable-id migration is needed.** `BundledBoard.id` is already folder-name identity from
   US-1483/US-1484. The disable array must never store the absolute root, because that would make
   the user’s choice disappear after reinstalling to another directory.
7. **The two UI surfaces must remain one implementation.** Any future divergence between
   `ToolsEditorsPanelView` and `ToolsHubView` would make Disable appear to work in one Built-in tab
   but not the other; both currently share `BuiltinEditorsListView`, so no duplicate action logic is
   justified.

## Acceptance Criteria

- `src/renderer/api/settings.ts` declares `disabled-bundled-boards` as a default-empty string
  array and describes it in the generated JSON5 settings file.
- The only logical disable-flag readers are `getCreatableItems()` and the bundled-source selection
  inside `customEditorRegistry.refresh()`; the latter is re-run from `settings.onChanged` without a
  restart, while the existing bundled-registry subscription remains intact.
- Every enabled bundled record contributes a stable, collision-safe `CreatableItem` under Built-in
  with its board label/glyph and a creation callback; disabled records contribute no creatable item.
- The sidebar Built-in tab and Tools Hub Built-in tab show identical bundled rows and actions because
  both use `BuiltinEditorsListView`.
- Only bundled rows expose **Disable** through the row context menu. Ordinary built-in editors keep
  only their existing pin behavior; no second trailing control is added to them.
- `PinnedRailView` gains an explicit row context-menu listener because it has none today; bundled
  pinned rows expose **Disable**, while ordinary editor and trusted-board pins expose no
  row-specific actions.
- Disabling removes the bundled board’s `CustomEditorMatch`, file-mask resolution claim, and
  board-origin capability registrations; re-enabling restores them live. Providers and schemes use
  the existing full board rebuild teardown and are not left stale.
- A pinned bundled item’s pin remains in `pinned-editors` while the item is disabled, is hidden from
  the Built-in list, pinned rail, and plus menu, and returns to the pinned rail when re-enabled.
- A content-host bundled row creates a genuinely untitled `BoardContentEditorModel` through the
  dynamic `board-editor:<root>` path without opening a phantom file. A board with no editor
  association opens as a standalone board page. Save and Save As open the native path dialog for
  the initially pipeless host, write the host's current content, clear dirty state, and update the
  path/title; a board edit through `host.setContent()` makes closing prompt to save.
- EPIC-109 D6 is explicitly deferred to EPIC-110: the built-in `draw-view` handler remains the
  intended fallback throughout this epic, so US-1485 does not add no-handler messaging.
- No changes are made to `assets/boards/` permanently, `board-manifest.ts`, `board-access.ts`,
  `pinned-items.ts`, `capability-bus.ts`, trust files, Registered boards inventory, build/packaging,
  Excalidraw implementation, or capability routing/priority ordering.
- No unit tests, test harnesses, or commits are added. The temporary fixture is removed before
  completion and is never committed.

## Files that need no changes

- `src/renderer/ui/sidebar/ToolsEditorsPanelView.ts` and
  `src/renderer/editors/tools-hub/ToolsHubView.ts` — both already mount the shared
  `BuiltinEditorsListView`.
- `src/renderer/editors/board/bundled-board-registry.ts` — stable id, cached manifest, list, and
  subscription seam already exist; disabled records must remain discoverable for re-enable.
- `src/renderer/editors/board/board-access.ts` — keep the shipped trusted-or-bundled permission
  predicate and origin union; this task gates registrations, not the board permission model.
- `src/renderer/ui/sidebar/pinned-items.ts` — its bare editor-id encoding and missing-item behavior
  already support an inert retained pin.
- `src/renderer/api/types/settings.d.ts` — `ISettings` is intentionally generic; the internal
  implementation key does not require a public type-union change.
- `src/renderer/editors/board/board-manifest.ts` — no manifest `id`, create filename, or disable
  field is needed.
- `src/renderer/api/pages/PagesPersistenceModel.ts` and the US-1484 identity helpers — restore
  aliasing and stable storage identity are complete and unrelated to live presentation.
- `electron-builder.yml`, `assets/boards/`, `installedBoards.json`, `trustedBoards.txt`, and
  `doc/active-work.md` / `doc/epics/EPIC-109.md` — packaging, permanent board assets, trust state,
  and the existing dashboard/epic links are outside this task; the fixture is temporary.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `src/renderer/api/settings.ts` | Add the default-empty `disabled-bundled-boards` setting and JSON5 description | No |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Project enabled bundled records into stable creatable items and write Disable membership | No |
| `src/renderer/ui/sidebar/BuiltinEditorsListView.ts` | Add bundled-only row context menu and live setting refresh | No |
| `src/renderer/ui/sidebar/PinnedRailView.ts` | Add the same bundled-only context action and live refresh for retained pins | No |
| `src/renderer/ui/tabs/PageTabsView.ts` | Refresh the pinned plus menu after disable/re-enable | No |
| `src/renderer/editors/board/custom-editor-registry.ts` | Filter disabled bundled sources and refresh on the setting event | No |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Add the dynamic content-host bundled-board page-creation seam | No |
| `src/renderer/api/pages/PagesModel.ts` | Expose the bundled-board page-creation delegate | No |
| `doc/tasks/US-1485-bundled-board-disable/README.md` | Investigation, resolved design, implementation plan, concerns, verification, and acceptance criteria | Yes |
| `assets/boards/us1485-fixture/board-manifest.json`, `index.html` | Temporary manual verification fixture only | No; must be created and removed by the verifier |
