# US-1689: Source context for board opens (sibling tracks from folder / link category / tag)

Epic: [EPIC-128](../../epics/EPIC-128.md) (decisions A2, A3, A8)

## Goal

Capture the sibling list that supplied a file when it is opened, and deliver that bounded snapshot
to a board with the initial source and every later `source.onOpen` event. Move sibling enumeration
out of `VideoEditor` into a shared renderer helper and keep its current next-track behavior intact.

## Background

- `VideoEditor` currently derives the provider live from `this.page.panelEditors` in
  `findSourceProvider()` and enumerates folder/category/tag siblings in `getSiblingTracks()`
  (`src/renderer/editors/video/VideoEditor.ts`). `getSiblingTracks()` filters to audio files and
  computes `currentIndex`; `playNext()` consumes that result. When a board is opened, the clicked
  page and its panels can differ from the page reused by a `singleInstance` board, so the board
  cannot reconstruct the clicked context by looking at its current panels. This is the A3 failure
  case.
- The source-open pipeline already preserves the click origin long enough to capture it:
  `ExplorerEditorModel.openItem()` sets `pageId` and `sourceId: "explorer"`;
  `LinkEditor.openLinkFromPanel()` sets `pageId`, `sourceId`, `category`, and, for tag opens,
  `selectedTag` (`src/renderer/editors/explorer/ExplorerEditorModel.ts`,
  `src/renderer/editors/link-editor/LinkEditor.ts`). `registerOpenHandler()` copies `data.pageId`
  to a local and then calls `cleanForStorage(data)`, which strips `pageId` but keeps stable source
  metadata (`src/renderer/content/open-handler.ts`, `src/shared/link-data.ts`). The local page ID is
  passed to `PagesLifecycleModel.navigatePageTo()`; capture there before singleton routing, then
  attach the snapshot to `options.sourceLink` for either the reused or fresh destination page.
- `PagesLifecycleModel.navigatePageToWithSingletonRouting()` has the source page ID before it
  calls `openSingleInstanceBoard()` or the `PageNavigator` implementation. The singleton path
  finds the existing board page, shows it, calls `enqueueBoardSource()`, and disposes the incoming
  pipe; the fresh path applies `options.sourceLink` to the navigated editor. Capture there before
  routing, then pass the augmented link into both paths (`src/renderer/api/pages/PagesLifecycleModel.ts`,
  `src/renderer/api/pages/PageNavigator.ts`).
- The destination can be resolved synchronously before capture. `PagesLifecycleModel.newEditorModel()`
  calls `resolveEditorIdForFile(filePath) ?? "monaco"` for the default destination; that resolver
  checks the in-memory built-in editor registry and `customEditorRegistry.getBoardsForFile()` in
  `src/renderer/editors/board/custom-editor-registry.ts::resolveEditorIdForFile()`. An explicit
  `options.target` is the target `PageNavigator.buildEditor()` passes to
  `PagesLifecycleModel.createEditorFromFile()`, which resolves board editor ids in
  `buildEditorById()` via `parseBoardEditorId()` and `customEditorRegistry.entries`
  (`src/renderer/api/pages/PageNavigator.ts`,
  `src/renderer/api/pages/PagesLifecycleModel.ts`). The custom-editor registry contains only
  eligible `origin: "trusted" | "bundled"` board associations. Capture context only when this
  resolved destination is one of those board editor ids; built-in editors (including Video
  Player), Monaco, and every other destination keep `sourceContext` undefined.
- The source provider identifies its backing document. `LinkEditor.treeProvider` constructs
  `LinkTreeProvider` with `_host.state.get().filePath`; the provider stores that argument as
  `sourceUrl` (`src/renderer/editors/link-editor/LinkEditor.ts::treeProvider`,
  `src/renderer/editors/link-editor/LinkTreeProvider.ts::constructor`). For link-category and
  link-tag opens, this is the `.link.json` collection path. For Explorer, use the opened item's
  containing folder, matching VideoEditor's current `fpDirname(url || sourceLink.href)` behavior.
- Runtime source opens are currently URL-only: `EditorOpenContext` has `mode: "enqueue-source"`
  with `sourceUrl` and optional session handle; `BoardEditorModel` queues those transiently;
  `BoardWebview.flushPendingSourceUrls()` posts `BoardSourceOpenedMsg`; and `board-shim.ts`
  buffers and dispatches URL plus optional `privateSession`. Initial source identity and privacy
  travel in `BoardPortInitMsg` (`src/renderer/editors/base/EditorModel.ts`,
  `src/renderer/editors/board/BoardEditorModel.ts`, `src/renderer/editors/board/BoardWebview.ts`,
  `src/ipc/board-bridge-channels.ts`, `src/board-shim.ts`).
- Board restore already persists `state.sourceLink` through `BoardEditorModel.getRestoreData()`;
  `cleanForStorage()` retains serializable navigation fields. Persist the bounded initial context
  as a `sourceLink` member so it remains available after page restore. Later `onOpen` events remain
  transient host events; boards that want later opens in a restarted queue can persist accepted
  hrefs/context in their own restorable state, matching the existing source API guidance.
- Board manifests provide normalized `fileMasks`; `normalizeFileMasks()` and `matchesFileMask()`
  define case-insensitive basename glob matching (`src/renderer/editors/board/board-manifest.ts`).
  Apply the receiving board's normalized `fileMasks` to the snapshot, excluding directories; an
  empty mask list means no mask-based filtering. The built-in Video Player continues to filter by
  `isAudioFile()` as it does today.
- Board-facing source API guidance currently appears in `assets/guides/boards.md`,
  `assets/guides/agents/boards.md`, and `assets/board-template/CLAUDE.md`. The current bridge
  version is `1.36.0` in `src/shared/board-bridge-version.ts`; the current-version descriptions
  also appear in `src/board-shim.ts`, `src/renderer/editors/board/board-api.d.ts`,
  `doc/architecture/overview.md`, `doc/architecture/key-files.md`, and those three guides.

### Context contract

Add a serializable `BoardSourceContext` snapshot, exposed as
`persephone.source.initialSourceContext` and as `context` on every `source.onOpen` event:

```ts
interface BoardSourceContext {
    kind: "folder" | "link-category" | "link-tag";
    sourcePath: string;
    category?: string; // raw category path for link-category
    tag?: string;      // raw selectedTag for link-tag; "" means All
    label: string;
    items: Array<{
        href: string;
        title: string;
        id?: string;       // present for link-source items
        category?: string; // present for link-source items
        tags?: string[];   // present for link-source items
    }>;
    index: number; // index of the opened href in items, or -1 when it is absent
}
```

`kind` maps from `sourceId` (`explorer` → `folder`); `sourcePath` is the Explorer folder path for
folder context and the `.link.json` path for link context. `category` is present for
`link-category`; `tag` is present for `link-tag` and retains the raw selected tag (empty means
“All”). `label` identifies the clicked folder, category, or selected tag. Items preserve provider
order and contain only non-directory entries, with `title` falling back to `href`; link-source
items also carry their `id`, `category`, and `tags`, while folder items omit these fields. This lets
a board match a sibling back to the same collection entry. `index` is case-insensitive by href.
Category and tag lists come from the matching `ITreeProvider` on the source page, not from the
destination board page. Store the initial value as `sourceLink.sourceContext`; expose it to the
board under the public name `source.initialSourceContext`.

Bound snapshots to 5,000 items and 1 MiB of UTF-8 serialized context. The byte count covers the complete
serialized `BoardSourceContext`, including `sourcePath`, raw `category`/`tag`, labels, and all item
fields (`href`, `title`, `id`, `category`, `tags`); the reported 932-link “All” collection is
approximately 111 KiB for href/title and fits without truncation. Only when a sibling list
exceeds either bound, retain a contiguous window around the current item (centered where possible),
preserve provider order, and recalculate `index`; use `-1` if the opened href is not in the
captured items. Keep hrefs intact, cap display labels/titles at 256 characters, and omit a context
that cannot fit even with a single item.

## Implementation Plan

- [x] 1. **Extract sibling enumeration into a reusable helper.** Add
  `src/renderer/editors/shared/source-context.ts` with a helper that accepts the source `PageModel`,
  source link metadata, current href, and an item predicate/limit. Move provider lookup and sibling
  list selection from `VideoEditor.findSourceProvider()` / `getSiblingTracks()` into it. Preserve
  the existing behavior exactly for VideoEditor: resolve the same file/link provider, use
  `getTagItems(selectedTag)` for `link-tag`, use `fpDirname(currentHref)` for Explorer, use
  `sourceLink.category ?? provider.rootPath` for link categories, exclude directories, filter with
  `isAudioFile()`, compare hrefs case-insensitively, and return `null` for missing provider/empty
  results. Export provider lookup from the helper too and use it from both sibling enumeration and
  `VideoEditor.navigateToTrack()`, removing the local `findSourceProvider()`. `VideoEditor.playNext()`
  should call the helper; keep `canPlayNext()`, shuffle selection, `navigateToTrack()`, and its
  source-panel selection updates in VideoEditor.
- [x] 2. **Resolve destination and capture board-only context.** Before capture in
  `PagesLifecycleModel.navigatePageToWithSingletonRouting()`, use `options.target` when present;
  otherwise resolve the target with the same `resolveEditorIdForFile(newFilePath) ?? "monaco"`
  rule as `PagesLifecycleModel.newEditorModel()`. For a `board-editor:<root>` id, use
  `parseBoardEditorId()` and match that root against `customEditorRegistry.entries` to obtain the
  eligible board association and its normalized `fileMasks`
  (`src/renderer/editors/board/custom-editor-registry.ts`). This is an in-memory synchronous
  resolution already used to open the file, so it does not require another manifest read. Only
  capture and attach `sourceContext` for an eligible trusted or enabled bundled custom-editor
  board. Every other target, including Video Player, image viewer, and Monaco, receives
  `sourceContext: undefined`; their persisted `sourceLink` remains unchanged.
- [x] 3. **Define the transport/persistence type and capture path.** Add the serializable
  `BoardSourceContext` type in `src/shared/board-source-context.ts`; extend `ILinkNav` in
  `src/renderer/api/types/io.link-data.d.ts` with the optional `sourceContext` stored member so
  `cleanForStorage()` retains it. `registerOpenHandler()` already copies `data.pageId` before
  cleanup and passes it as the positional `pageId` argument to `navigatePageTo()`; use that existing
  argument in `PagesLifecycleModel.navigatePageToWithSingletonRouting()` to resolve the origin page
  with `this.model.query.findPage(pageId)` and capture before calling
  `openSingleInstanceBoard()`. Augment `options.sourceLink` with `sourceContext` so singleton and
  fresh navigation both receive the snapshot. Use the shared helper with a board-mask predicate
  built from that board's normalized `fileMasks` via `matchesFileMask()`; retain all non-directory
  files when there are no masks. Capture `sourcePath`, raw category/tag, and link item identity
  (`id`, `category`, `tags`) from the source `ITreeProvider`. Keep the list captured at open time,
  never by inspecting the reused board page's panels.
- [x] 4. **Handle opens without a source page.** `PagesLifecycleModel.openFile()` also calls
  `openSingleInstanceBoard()` before fresh-page construction. `registerOpenHandler()` uses this path
  when `data.pageId` is absent (Open dialog, drag-and-drop, and command-line opens); there is no
  originating source panel to inspect, so these board opens carry `sourceContext: undefined` while
  preserving the source URL and private-session behavior.
- [x] 5. **Carry initial and runtime context through board open plumbing.** Extend
  `EditorOpenContext` (`src/renderer/editors/base/EditorModel.ts`) so `enqueue-source` carries an
  optional `BoardSourceContext`. Extend `BoardEditorModel`'s pending source queue and
  `enqueueSourceUrl()`/`acceptOpenContext()` to retain each event's snapshot with its URL and
  `privateSession` fact; add an accessor for the initial context from persisted `state.sourceLink`.
  Extend `BoardPortInitMsg` and `BoardSourceOpenedMsg` in
  `src/ipc/board-bridge-channels.ts`; have `BoardWebview.transferPort()` send the initial context
  beside `sourceUrl` and `initialSourcePrivateSession`, and have `flushPendingSourceUrls()` send the
  queued context on every runtime event. Extend the board shim's event/queue types and dispatch in
  `src/board-shim.ts`; expose `source.initialSourceContext` alongside
  `source.initialSourcePrivateSession`, and include `context` in the callback event from
  `source.onOpen()`.
- [x] 6. **Update board public types and version.** Add the public context shape/property/event field
  and usage JSDoc in `src/renderer/editors/board/board-api.d.ts`. Update its stale bridge-version
  comment to describe the current bridge and the new context member. Bump
  `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` from `1.36.0` to `1.37.0`; add the
  `1.37.0` feature note in `src/board-shim.ts` and update current-version/feature references in
  `doc/architecture/overview.md`, `doc/architecture/key-files.md`, `assets/guides/boards.md`,
  `assets/guides/agents/boards.md`, and `assets/board-template/CLAUDE.md`. Do not rewrite historical
  changelog entries in `assets/guides/whats-new.md`.
- [x] 7. **Update author guidance and preserve source semantics.** Extend source API examples and
  persistence notes in `assets/guides/boards.md`, `assets/guides/agents/boards.md`, and
  `assets/board-template/CLAUDE.md` to show initial context and runtime event context, explain that
  both are open-time snapshots, and describe that only the initial context is host-restored from
  `sourceLink` while boards own persistence for later events. Keep the existing URL/private-session
  fields and their meanings unchanged. This is general board bridge plumbing; do not add audio
  behavior to `VideoEditor` beyond using the shared helper (EPIC-128 A8).

- [x] Capture and persist the same masked source context when an editor switch creates a board for the current file.

### Before → after

```ts
// Before: VideoEditor re-reads the current page's sidebar when Next is used.
const result = await this.getSiblingTracks();
// getSiblingTracks() calls this.findSourceProvider() over this.page.panelEditors.

// After: VideoEditor keeps its audio-specific predicate but delegates enumeration.
const result = await getSiblingItems({
    page: this.page,
    sourceLink: this.state.get().sourceLink,
    currentHref: this.state.get().url,
    include: (item) => !item.isDirectory && isAudioFile(item.href),
});
```

```ts
// Before: a single-instance runtime event contains identity only.
{ __persephone: "source:opened", sourceUrl, privateSession? }

// After: the event includes the source-panel snapshot captured before routing.
{ __persephone: "source:opened", sourceUrl, privateSession?, context? }
```

## Concerns

- `registerOpenHandler()` removes `pageId` from `sourceLink` with `cleanForStorage()` but passes it
  positionally to `navigatePageTo()`. Use that positional id to capture before destination routing;
  never depend on `sourceLink.pageId` or look up panels on the reused board page.
- Some links may be opened without a source panel or with an unknown `sourceId`; those opens should
  continue to deliver URL/private-session data with `context: undefined` and must not fail.
- `PagesLifecycleModel.openFile()` reaches `openSingleInstanceBoard()` without an origin page id
  for Open dialog, drop, and command-line opens. Those paths intentionally produce no context.
- Bounded context is a snapshot, so files added/removed after opening are not reflected. The board
  can treat it as a queue seed and refresh through its own capabilities if it has a separate scan
  flow.
- The initial context is written inside the page descriptor in
  `PagesPersistenceModel.saveState()` (`src/renderer/api/pages/PagesPersistenceModel.ts`), which
  JSON-serializes descriptors to `openFiles{windowIndex}.json` through `appFs.saveDataFile()`
  (`src/renderer/api/fs.ts`; the filename constant is
  `src/shared/constants.ts::openFilesNameTemplate`). That path has no per-member 1 MiB cap, so the
  1 MiB bound is acceptable for this single context member. It differs from the separate 1 MiB
  board-storage-value cap in `src/main/board-storage.ts::MAX_BOARD_STORAGE_BYTES`.
- Current board bridge version `1.36.0` is already in use by locale/i18n. This task must advance the
  shared version to `1.37.0`; do not change A2's or A3's behavior or add a new permission.

## Acceptance Criteria

- [x] Sibling enumeration resides in the shared renderer helper and VideoEditor next/shuffle uses
  it with the same provider selection, audio filtering, order, and current-index behavior.
- [x] Initial board context is captured from the source page at open time, stored with the initial
  source link, and exposed beside `getSourceUrl()` / `source.initialSourcePrivateSession`.
- [x] Context is attached only when the resolved destination is an eligible trusted or bundled
  custom-editor board. Video Player, image viewer, Monaco, and other editors retain no context in
  their persisted `sourceLink`.
- [x] Each `singleInstance` runtime `source.onOpen` event carries the context snapshot captured for
  that specific open, including when successive opens originate from different pages/panels.
- [x] Folder, link-category, and link-tag contexts use the source panel identified by
  `sourceId`; tag opens respect `selectedTag`, category opens respect `category`, and Explorer uses
  the containing directory. Directories are excluded, item order is preserved, and the current
  item index is correct or `-1` when not captured.
- [x] Context includes `sourcePath` and raw category/tag values; link-source items include their
  `id`, `category`, and `tags`, while folder items omit those identity fields.
- [x] Board context items are filtered by the receiving board's normalized `fileMasks` when masks
  exist; empty masks retain all non-directory siblings. The 5,000-item / 1-MiB UTF-8 bounds are
  enforced across every serialized context and item field, with centered truncation only beyond
  those bounds.
- [x] Open dialog, drop, and command-line flows through `PagesLifecycleModel.openFile()` provide
  `sourceContext: undefined` when there is no source page id.
- [x] Initial context survives page save/restore through `sourceLink`; runtime events remain
  transient and board authors are told how to persist later accepted sources themselves.
- [x] The page-state persistence path and acceptance of a 1 MiB context member are documented with
  `PagesPersistenceModel.saveState()` and `appFs.saveDataFile()` references.
- [x] `BOARD_BRIDGE_VERSION` is `1.37.0`; channel definitions, shim, webview, editor model, lifecycle
  routing, and `board-api.d.ts` agree on the initial and runtime context shapes.
- [x] Agent and board-author source API guides listed below document the member, event payload, and
  snapshot/restore behavior. No unit tests are added (project rule); verify with the repository's
  required manual/code checks during implementation.
- [x] Video Player change is limited to consuming the shared helper, consistent with EPIC-128 A8.

### Files verified as not needing changes

| File / area | Reason |
|-------------|--------|
| `src/renderer/editors/link-editor/LinkEditor.ts` | `openLinkFromPanel()` already stamps `pageId`, `sourceId`, `category`, and `selectedTag`; capture consumes that metadata. |
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | `openItem()` already stamps `pageId` and `sourceId: "explorer"`; capture derives its parent directory from the opened href. |
| `src/renderer/content/open-handler.ts` | `registerOpenHandler()` already saves `data.pageId` before `cleanForStorage()` and passes it positionally to `navigatePageTo()`. |
| `assets/guides/whats-new.md` | Existing source/private-session mentions are historical release notes; current source API references are in the board guides above. |
| Unit-test directories | No unit tests are to be added under project rules. |

## Files Changed

| File | Planned change |
|------|---------------|
| `src/renderer/editors/shared/source-context.ts` | New shared provider lookup and bounded sibling snapshot helper; reused by VideoEditor and board capture. |
| `src/shared/board-source-context.ts` | New serializable source-context type. |
| `assets/editor-types/board-source-context.d.ts` | Publish the context shape to editor script type hints. |
| `src/renderer/editors/video/VideoEditor.ts` | Replace local sibling enumeration with helper call; preserve audio behavior. |
| `src/renderer/api/types/io.link-data.d.ts` | Add optional persisted board context field to navigation metadata. |
| `src/renderer/editors/base/EditorModel.ts` | Add context to runtime `enqueue-source` open context. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Capture initial/runtime context from the origin page before routing and persistence cleanup. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Persist initial context via sourceLink and queue each runtime snapshot. |
| `src/renderer/editors/board/BoardWebview.ts` | Send context in initial handshake and runtime open messages. |
| `src/ipc/board-bridge-channels.ts` | Add context to initial and runtime bridge message shapes. |
| `src/board-shim.ts` | Expose initial context and context-bearing `source.onOpen` events. |
| `src/renderer/editors/board/board-api.d.ts` | Type and document the public API and current bridge-version comment. |
| `src/shared/board-bridge-version.ts` | Bump bridge from 1.36.0 to 1.37.0. |
| `doc/architecture/overview.md` | Document bridge 1.37.0 source-context capability. |
| `doc/architecture/key-files.md` | Update the bridge source-of-truth feature description. |
| `assets/guides/boards.md` | Update board-author source API and current bridge version. |
| `assets/guides/agents/boards.md` | Update agent board-author source API and current bridge version. |
| `assets/board-template/CLAUDE.md` | Update board template source API and current bridge version. |
| `doc/epics/EPIC-128.md` | Link this task and revise the bridge-version sequence: US-1689 → 1.37.0, US-1690 → 1.38.0. |
| `doc/active-work.md` | Link the planned task entry to this document. |
