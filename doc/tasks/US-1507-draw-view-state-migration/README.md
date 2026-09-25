# US-1507 — Migrate persisted `draw-view` state — pinned `+` slot and open pages

## Status

**Status:** Planned  
**Epic:** [EPIC-110: Excalidraw extraction, part 2 — remove `editors/draw` and React](../../epics/EPIC-110.md)  
**Depends on:** EPIC-109's shipped bundled-board registry and Excalidraw board; must land before US-1508.

This is an investigation and implementation plan only. No implementation, test harness, app run, or
commit belongs to this task.

## Goal

Before the built-in `draw-view` editor is deleted, rewrite the two persisted user-state surfaces that
name it: the ordered `pinned-editors` `+`-menu entry and open drawing-page descriptors. Existing
`.excalidraw` content must restore through the bundled Excalidraw board after the upgrade, while a
fresh install, a missing board, and a disabled board remain safe.

## Background

### Epic constraints

EPIC-110 D1 requires state migration before deletion and forbids imports from `src/renderer/editors/draw/`
in the migration. D2 transfers the pinned entry's position but keeps the board's own manifest label.
The pin rewrite belongs to settings initialization. The page rewrite belongs to the existing page
normalization seam, which runs before session restore constructs an editor; it must use only the board
registry, settings, and page-persistence contracts.

### The pinned state and its replacement

`DEFAULT_PINNED_EDITORS` currently includes `draw-view` between `script-js` and `grid-csv` in
[`src/renderer/ui/sidebar/tools-editors-registry.ts:53-56`](../../../src/renderer/ui/sidebar/tools-editors-registry.ts#L53-L56).
The settings file describes the same array at
[`src/renderer/api/settings.ts:117`](../../../src/renderer/api/settings.ts#L117), and the persisted
default repeats the `draw-view` entry at [`settings.ts:155`](../../../src/renderer/api/settings.ts#L155).
The bundled-board creatable item is constructed in `getCreatableItems()` as
``bundled-board:${board.id}`` at [`tools-editors-registry.ts:220-252`](../../../src/renderer/ui/sidebar/tools-editors-registry.ts#L220-L252).
The migration must replace only the exact stored `draw-view` value, retaining every other value and
the original array index. The board row keeps its manifest-derived name (`Excalidraw`), as required
by D2; the pin migration does not rename that row to `Drawing`.

The fresh-install defaults must be changed to the bundled item id so a new profile does not need a
legacy rewrite. An absent or disabled board may make that default temporarily invisible in the pinned
rail, but the stored slot is retained; disabled bundled rows remain available to re-enable through
`getDisabledBundledBoardItems()`. The disable setting excludes the board from new creatable/custom-
editor registration; the current bundled permission predicate still recognizes a shipped bundled
root, so this task promises continuity and no crash for an already-open page rather than inventing a
new disabled-page placeholder.

### The actual persisted page shape

The persisted window file is `openFiles{windowIndex}.json`, defined by
[`src/shared/constants.ts:1`](../../../src/shared/constants.ts#L1), and is read through
`app.fs.getDataFile()` in [`src/renderer/api/pages/PagesPersistenceModel.ts:148-154`](../../../src/renderer/api/pages/PagesPersistenceModel.ts#L148-L154).
Only `schemaVersion === 4` and an array-valued `pages` field are restored. The file is written by
`PagesPersistenceModel.saveState()` as a `WindowState` with `pages: PageDescriptor[]`.

The current v4 descriptor has one persisted editor identity:

1. `PageDescriptor.editors[].editorId` is the primary restore key. A current built-in Draw page is
   serialized as `editorId: "draw-view"` by the Draw editor's inherited text-host descriptor.

`TextEditorModel.getDescriptor()` persists an explicit metadata list (including optional
`editorSettings`) and does not include `editor`; `BoardContentEditorModel` documents the same fact.
`restoreState()` also accepts only schema v4, so there is no older persisted shape requiring a
host-level identity rewrite.

The live-object failure contract is still verified in [`src/renderer/api/pages/PagesLifecycleModel.ts:57-86`](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L57-L86):
`attachEditorToPage()` reads `legacy.state.get().editor` and calls
`editorRegistry.createEditorSync(targetEditorId, id)`. An unknown id fails in
[`src/renderer/editors/base/editorRegistry.ts:314-333`](../../../src/renderer/editors/base/editorRegistry.ts#L314-L333)
with `No editor registered for id: <id>`; an uncached registered module has a separate preload error.
Those are live-object paths, not persisted v4 data surfaces.

There is an important current-v4 distinction from the epic shorthand. Startup session restore does
not currently call `attachEditorToPage()`; `PagesPersistenceModel.restorePage()` first awaits
`normalizePageDescriptor()` at [`PagesPersistenceModel.ts:161`](../../../src/renderer/api/pages/PagesPersistenceModel.ts#L161).
`normalizeEditorDescriptor()` at [`PagesPersistenceModel.ts:48-81`](../../../src/renderer/api/pages/PagesPersistenceModel.ts#L48-L81)
already rewrites descriptor and state editor identities through `resolveBoardEditorId`, repairs
`state.boardRoot`, and repairs board links. The draw mapping belongs beside those repairs. Only later,
at [`PagesPersistenceModel.ts:239-247`](../../../src/renderer/api/pages/PagesPersistenceModel.ts#L239-L247),
does the content-host path construct an editor and catch a failed construction by returning `null`.
Normalization therefore sees the old id before the failure seam; no raw file pre-pass is needed.

### Board identity and the safe persisted representation

`bundledBoardRegistry.ensureInitialized()` scans the shipped `assets/boards` folders and exposes each
record's stable folder id and current absolute root at
[`src/renderer/editors/board/bundled-board-registry.ts:16-60`](../../../src/renderer/editors/board/bundled-board-registry.ts#L16-L60).
The Excalidraw record is the shipped `id: "excalidraw"` board whose manifest claims `*.excalidraw`
with `editorKind: "content-host"` in
[`assets/boards/excalidraw/board-manifest.json:18-23`](../../../assets/boards/excalidraw/board-manifest.json#L18-L23).
The runtime custom-editor id is path-derived by
`boardEditorId(boardRoot)` at [`src/renderer/editors/board/custom-editor-registry.ts:60-72`](../../../src/renderer/editors/board/custom-editor-registry.ts#L60-L72); the plan must call it with the
registry record's current `root`, never hardcode an absolute path or a `board-editor:` string.

The current board persistence contract must also be respected. `BoardContentEditorModel.editorId`
derives the live custom id from `state.boardRoot`, but its comments and `BoardEditorModel.getRestoreData()`
explicitly persist the stable `editorId: "board-view"` and re-derive the path-based id at runtime
([`BoardContentEditorModel.ts:57-67`](../../../src/renderer/editors/board/BoardContentEditorModel.ts#L57-L67),
[`BoardEditorModel.ts:685-704`](../../../src/renderer/editors/board/BoardEditorModel.ts#L685-L704)).
Therefore the migration's v4 before/after shape is:

```json
// Before: built-in drawing page
{
  "editorId": "draw-view",
  "state": { "title": "Sketch.excalidraw" },
  "host": { "state": { "filePath": "C:\\work\\Sketch.excalidraw", "editorSettings": { "draw-view": {} } } }
}

// After: stable board restore key; the board derives board-editor:<current root> at runtime
{
  "editorId": "board-view",
  "state": { "title": "Sketch.excalidraw", "boardRoot": "<bundled board root>" },
  "host": { "state": { "filePath": "C:\\work\\Sketch.excalidraw", "editorSettings": { "draw-view": {} } } }
}
```

The migration obtains `<bundled board root>` from the live `BundledBoard` record. It does not persist
the path-derived id: the verified board contract says the persisted editor identity is the stable
`board-view` token, while `boardEditorId(boardRoot)` is the runtime identity. The original host
content, cache pipe, file path, title, page id, and `editorSettings` are copied unchanged.
`editorSettings["draw-view"]` is intentionally left in place: the board does not read it, it is
harmless, and retaining it allows a rollback to 5.0.3 to reuse the setting.

### One-time migration precedent and bookkeeping decision

The precedent is `migrateLegacyExcalidrawLibraryPath()` in
[`src/renderer/api/board-settings/board-settings-bridge.ts:101-128`](../../../src/renderer/api/board-settings/board-settings-bridge.ts#L101-L128): it waits for settings, checks an explicit boolean, serializes concurrent calls with a cached promise, performs an idempotent copy, then sets its bookkeeping key. The key is declared, documented, and defaulted in
[`src/renderer/api/settings.ts:57,132,170`](../../../src/renderer/api/settings.ts#L57).

No new bookkeeping key is needed. The page rewrite is idempotent because
`normalizeEditorDescriptor()` maps the descriptor on every restore and `saveState()` writes the
normalized descriptor on the next ordinary session save. The remaining pin rewrite is also idempotent:
it replaces exact `draw-view` values, and after US-1508 deletes that id no code can re-acquire it.
Adding a permanent settings key would create user-visible state for a transition that already has
these two natural completion conditions. The existing `boards.excalidraw-library-migrated` key remains
unrelated and unchanged.

## Implementation Plan

### 1. Make the post-migration default fresh-install safe

- In `src/renderer/ui/sidebar/tools-editors-registry.ts`, replace the `draw-view` member of
  `DEFAULT_PINNED_EDITORS` with `bundled-board:excalidraw`, leaving the surrounding order unchanged.
  Keep the static default as a string because `defaultAppSettingsState` is created before bundled
  discovery. `BundledBoard.id` is the folder name (`entry.name`) at
  [`bundled-board-registry.ts:54`](../../../src/renderer/editors/board/bundled-board-registry.ts#L54),
  so the replacement is the stable literal `bundled-board:excalidraw`, not a path-derived editor id.
- In `src/renderer/api/settings.ts`, update the `pinned-editors` help text so its examples no longer
  advertise `draw-view`. Add a settings-initialization helper that rewrites the loaded array, but do
  not add a bookkeeping key.
- Change the persisted default array at `settings.ts:155` to the same
  `bundled-board:excalidraw` value. Do not remove or repurpose the existing
  `boards.excalidraw-library-migrated` key.

Before → after for the user-visible persisted default:

```ts
// Before
"pinned-editors": ["script-js", "script-ts", "draw-view", "grid-json", "grid-csv", "browser"]

// After
"pinned-editors": ["script-js", "script-ts", "bundled-board:excalidraw", "grid-json", "grid-csv", "browser"]
```

### 2. Rewrite the loaded pin during settings initialization

In `src/renderer/api/settings.ts`, immediately after the initial settings file has been loaded and
before the settings initialization promise resolves, map every exact `draw-view` member of
`pinned-editors` to the literal `bundled-board:excalidraw`. Preserve array length, duplicates, order,
and all unrelated values. Use the normal settings update/save path only when the array changes; the
fresh default already contains the replacement, so a fresh install performs no write. This operation
needs neither `bundledBoardRegistry` nor a migration key and does not wait on session restore.

### 3. Map legacy page descriptors in `normalizeEditorDescriptor`

Extend `normalizeEditorDescriptor()` in `src/renderer/api/pages/PagesPersistenceModel.ts`, next to
its existing `resolveBoardEditorId`, `state.boardRoot`, and EPIC-109 board-link repairs:

1. When the persisted descriptor's `editorId` is exactly `draw-view`, ensure the bundled registry is
   available and select the record whose stable `id` is `excalidraw`. If it is unavailable or does
   not describe the expected bundled content-host board, leave the descriptor untouched and let the
   existing legacy path remain recoverable; do not invent a root.
2. When the record exists, return the descriptor with `editorId: "board-view"` and
   `state.boardRoot` set to that record's current `root`, preserving all other descriptor, state,
   host, pipe, and page fields. Do not inspect or rewrite a host-level editor identity: it is not
   persisted in schema v4. Leave `host.state.editorSettings["draw-view"]` in place; it is harmless and preserves
   a possible rollback to 5.0.3.
3. Keep the runtime identity path-derived. `BoardContentEditorModel` derives `boardEditorId(boardRoot)`
   from the migrated root, while `BoardEditorModel.getRestoreData()` verifies that persistence uses
   `board-view` plus `boardRoot`; never serialize an absolute/path-derived editor id.

`normalizePageDescriptor()` is the first statement of `restorePage()` at `PagesPersistenceModel.ts:161`,
before the content-host branch at `:203-222` and before the later generic `host` construction at
`:239-247`. The normalizer therefore handles each window's own descriptors as they restore. The next
ordinary `saveState()` persists the normalized descriptor; this task never reads or writes
`openFiles{windowIndex}.json` directly and adds no `renderer.ts` bootstrap barrier.

### 4. Verify the complete upgrade matrix

Use a controlled profile and inspect settings plus the restored page model, rather than raw-writing
open-files data. Verify:

- fresh profile: both pinned defaults contain `bundled-board:excalidraw`, no migration write is made,
  and no `draw-view` state is generated;
- upgrade with a pinned `draw-view`: the replacement occupies exactly the old array index, all other
  entries are unchanged, and Tools & Editors shows the board's `Excalidraw` label once;
- upgrade with a real `.excalidraw` page: normalization produces exactly `editorId: "board-view"`
  plus the current bundled `state.boardRoot`, preserves host metadata and
  `editorSettings["draw-view"]`, and the content-host restore branch opens the page in the board;
- two or more windows: each window normalizes its own session descriptors, with no global completion
  flag that can make a later renderer skip its file;
- a second restore/save cycle: normalization makes no further semantic change and `saveState()` keeps
  the stable descriptor shape;
- disabled bundled board: the board record is still available to normalization; `restorePage()`'s
  content-host branch does not consult the disabled-board filter, and the board permission check still
  recognizes the shipped bundled root, so an already-open page restores without a new custom-editor
  registration;
- missing bundled board: the descriptor is not fabricated or discarded by this rewrite; record the
  resulting US-1508 deletion dependency in Concerns and require its abort boundary before deletion;
- all new migration code has no import path containing `src/renderer/editors/draw/`.

Run the repository's normal renderer checks after implementation: `npm run typecheck`, `npm run lint`,
and `npm run build-prod`. Manual restore verification is mandatory because the failure mode is a
startup/session-data interaction that static checks cannot prove.

## Concerns

### Resolved decisions

- **No new bookkeeping key:** the pin rewrite reaches a fixed point after replacing exact `draw-view`
  values, while the page rewrite is repeated safely by `normalizeEditorDescriptor()` and persisted by
  ordinary `saveState()`. A permanent settings flag would add user-visible state without protecting
  either operation.
- **Disabled versus missing:** `customEditorRegistry` filters disabled bundled boards from new
  registrations, but `restorePage()`'s `editorId: "board-view"` content-host branch does not consult
  that filter, and the bundled-root permission predicate still recognizes an existing shipped root.
  Thus a disabled, present board can restore an already-open page. A missing board cannot supply a
  `boardRoot`; normalization leaves the legacy descriptor intact and does not claim success.
- **Stable persistence versus runtime id:** current board persistence deliberately stores
  `board-view` plus `boardRoot`, then derives `boardEditorId(boardRoot)` at runtime. The migration
  follows that verified contract rather than inventing a path-dependent serialized `EditorView` token.
- **Migration timing:** page normalization is the safe point. It is the first operation in
  `restorePage()`, before `createEditor()` and before the per-editor catch that would otherwise drop
  an unknown editor. Settings initialization handles the independent pin rewrite without a session
  restore ordering dependency.

### Risks to keep visible during implementation

- Settings writes are debounced, so the pin helper must use the existing settings update/save path and
  preserve the transformed array if the process exits before the debounce fires. Page normalization
  has no separate write transaction: `saveState()` persists its result during the ordinary lifecycle.
- `bundledBoardRegistry.list()` includes disabled bundled records, while `getCreatableItems()` filters
  them. The pin remains stored even when the pinned rail temporarily hides the disabled row; the
  disabled-board recovery UI remains responsible for re-enabling it.
- The current restore code catches per-editor construction errors and returns `null`, which can make a
  lost page look like a harmless empty session. Acceptance must inspect the persisted descriptor and
  page count, not rely only on the absence of a thrown startup error.
- **Relabelling to `board-view` inherits the zombie guard.** `restorePage()` drops any descriptor
  whose `editorId` is `board-view` and whose instance id is not the page's `mainEditorId`
  (`PagesPersistenceModel.ts`, the US-799 guard immediately inside the per-editor `try`). A migrated
  drawing page therefore restores only as a page's main editor. In practice every drawing page is
  created through `addEditorPage`, which makes its editor the main one, so this should be
  unreachable — but it is a behaviour the old `draw-view` id did not have, and manual verification
  must include a grouped page with a drawing in it rather than assuming it.
- The page normalizer must not fabricate a root when the bundled record is absent. EPIC-110 D9 must
  abort US-1508 if a real upgrading page cannot be restored into the bundled board; otherwise a future
  deletion would expose the preserved legacy descriptor to the same unknown-id catch.

## Runtime verification (2026-09-25) — and the defect it caught

Exercised end to end against the running app, which is EPIC-110 D9's gate for starting US-1508.
Method: create a `draw-view` page, confirm it persists as `editorId: "draw-view"` in
`openFiles0.json`, reload the renderer so `restoreState()` runs, and inspect the restored page.

**First run failed, in a way no static check could have caught.** The page restored with the right
editor (`board-editor:<bundled root>`) and its content intact — but `renderState` was `not-found`
and `frameReady` was null, i.e. the board rendered its "not found" view holding the user's drawing.
Comparing the persisted descriptor against a genuine board page opened from a real `.excalidraw`
file showed the cause: the genuine page carries `selectedBoard: "excalidraw"` and
`iconKey: "excalidraw"`, and the migrated one carried neither.

`BoardEditorModel.restore()` does not re-derive the selection from `boardRoot` — `refreshBoards()`
only ever CLEARS `selectedBoard` — and `BoardEditorFacade` returns `not-found` whenever
`!state.boardRoot || !state.selectedBoard`. Only the live path sets it, in `selectBoard()`, which
`initFromBoardRoot()` calls. A descriptor carrying `boardRoot` alone is therefore not a complete
board descriptor.

Fixed in `normalizeEditorDescriptor` by seeding exactly what `selectBoard()` writes: the board
folder name into `selectedBoard` (which makes it render) and `iconKey` (which gives the tab its
icon). Re-verified on a fresh `draw-view` page: restores as `board-editor:<root>`,
`renderState: "bundled"`, `frameReady: true`, content byte-identical, title preserved.

Not covered by this run, and still owed: a grouped page holding a drawing (the zombie-guard risk
above), and a page whose `.excalidraw` file exists on disk rather than an untitled one.

## Acceptance Criteria

- [x] `DEFAULT_PINNED_EDITORS` and the settings default use `bundled-board:excalidraw` in the former
      `draw-view` position; settings help text no longer presents `draw-view` as a current creatable id.
- [x] Settings initialization replaces exact legacy pins using the normal settings save path, with no
      new bookkeeping key; fresh defaults perform no migration write.
- [x] `normalizeEditorDescriptor()` maps an available legacy page before editor construction, with no
      raw `openFiles{windowIndex}.json` read/write and no `renderer.ts` bootstrap barrier.
- [x] No migration code or startup import reaches `src/renderer/editors/draw/`.
- [x] An upgrading user's exact `draw-view` pin is replaced by the bundled board id at the same index,
      without changing other pins or the board's manifest-derived label.
- [x] A valid persisted drawing descriptor is rewritten to the current board restore contract
      (`editorId: "board-view"`, `state.boardRoot` from the live registry root, host metadata/content
      unchanged), and a subsequent restore/save cycle keeps the page in the board.
- [x] The persisted descriptor does not contain a host-level `editor` identity; any
      `editorSettings["draw-view"]` entry is intentionally retained for harmless rollback
      compatibility.
- [x] The path-derived runtime id is obtained through `boardEditorId(board.root)`/the board's runtime
      state, never hardcoded as an absolute path or serialized as a fake constant.
- [x] Fresh installs perform no migration write beyond their replacement default and have no new
      bookkeeping setting to set.
- [x] A second restore/save cycle makes no semantic change; two or more windows independently
      normalize their own descriptors.
- [x] A disabled, present bundled board restores an already-open migrated page without requiring
      custom-editor registration; a missing board leaves the legacy descriptor untouched and is covered
      by the US-1508 abort boundary.
- [ ] `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass after implementation, plus
      the manual upgrade/restore matrix in the plan is recorded.

## Files that need no changes

- `src/renderer/editors/draw/**` — explicitly forbidden migration dependency; deletion belongs to US-1508.
- `src/renderer/api/pages/PagesLifecycleModel.ts` — `attachEditorToPage()` remains the verified
  synchronous live-object failure seam; it is not a persisted v4 data surface.
- `src/renderer/editors/base/editorRegistry.ts` — its `createEditorSync()` error behavior is the
  contract being protected, not a behavior to soften with an unknown-id fallback.
- `src/renderer/editors/board/bundled-board-registry.ts` — existing discovery, stable folder ids,
  and current-root resolution are reused; no registry behavior change is needed.
- `src/renderer/editors/board/custom-editor-registry.ts` — existing disabled-board filtering is
  reused; restore does not need a registration change.
- `src/renderer/api/board-settings/board-settings-bridge.ts` — read as the one-time migration
  precedent; its library bookkeeping key remains independent.
- `src/renderer.ts`, `src/shared/persistence.ts`, and `src/shared/constants.ts` — no bootstrap or raw
  window-file change is needed; existing session persistence and filename contracts are reused.
- `doc/active-work.md` and `doc/epics/EPIC-110.md` — the task/dashboard link already exists and the
  request explicitly forbids adding a dashboard entry.
- `assets/boards/excalidraw/**` — the shipped board and manifest are consumed as-is by this task.
- `assets/guides/**`, `assets/editor-types/**`, and user-facing docs — this task changes persisted
  compatibility state only; the documented `draw-view` API removal belongs to US-1508/user-doc work.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `src/renderer/api/settings.ts` | Replace exact legacy pinned values during settings initialization; update the pinned default/help text without adding a migration key | No |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Replace `draw-view` in `DEFAULT_PINNED_EDITORS` with the bundled-board creatable id | No |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Normalize legacy `draw-view` descriptors to `board-view` plus the current bundled `boardRoot` before editor construction | No |
| `doc/tasks/US-1507-draw-view-state-migration/README.md` | Verified investigation, decisions, implementation plan, concerns, and acceptance criteria | Yes |
| `src/renderer/editors/draw/**`, `src/renderer.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, `src/renderer/editors/base/editorRegistry.ts` | No implementation change; existing deletion, bootstrap, live-object, and restore/error contracts are preserved | No |
| `doc/active-work.md`, `doc/epics/EPIC-110.md` | No dashboard or epic-plan edit; the existing link/decisions remain authoritative | No |
