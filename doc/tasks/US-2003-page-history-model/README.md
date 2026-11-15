# US-2003: Page history model

## Goal

Implement the model layer of [EPIC-178](../../epics/EPIC-178.md): record in-place navigation, replay Back and Forward, and persist both stacks.

## Background

`PagesLifecycleModel.navigatePageTo` runs open interceptors before calling `PageNavigator.navigatePageTo`. The board interceptor can return `take`, and the lifecycle returns `true`, although the source page did not move. The navigator has a same-file reveal exit, a cancelled `confirmLeaveCurrentEditor` exit, two reuse exits, and a fresh-build exit. `finishNavigation` saves state. Editor switches and panel promotion do not call this navigator. History commits belong inside the navigator after a successful reuse or fresh attachment and before `finishNavigation`, never after the lifecycle's boolean result.

`PageModel` owns `NavBackStack`, mirrors its count in `state.navBackCount`, snapshots it as `PageDescriptor.navBack`, and `PagesPersistenceModel.constructPage` seeds it after `normalizePageDescriptor`. `MarkdownEditor.followLink` pushes before opening, and `navigateBack` pops before opening. `MarkdownEditorView` observes `navBackCount`; `IPageHost` declares push/pop and `BrowserPanelHost` implements no-op versions.

Capture the leaving editor before confirmation as `{ filePath, target, title, sourceLink? }`: `filePath` is `editor.filePath ?? editor.sourceLink?.url`, `target` is `editor.editorId` (the editor type, not instance UUID), `title` is `editor.title`, and `sourceLink` is the editor's existing storage-cleaned `sourceLink`. The base accessors read editor state, then content-host state, although editors can override them. `createPageOpenRequest` sets `sourceLink.url` to the resolved logical path, including for virtual links. If neither path is nonempty, there is no entry; do not substitute an href, title, or board root. Saved changes may update an untitled editor during confirmation; its pre-confirmation entry remains absent.

### Direct replay evidence

`PagesLifecycleModel.retryOpen` rebuilds a saved source with `pipeFromPersistedSource`; the helper prefers `sourceLink.pipeDescriptor`, then `sourceLink.href`, then the fallback path, with registered scheme resolution before generic URL resolution. This preserves descriptor-based HTTP settings and custom providers/transformers without running `openRawLink` and its resolvers. `PageHistory` can call the existing lifecycle navigator with the saved path, target, title, source link, reconstructed pipe, and an internal `historyMove`. `PageNavigator.prepareOpenedEditor` installs the source link only after `createEditorFromFile` restores the newly created editor; it is available during subsequent use, not during that initial restore. The existing `folderPath` option selects `createEditorFromFolder`.

| Leaving content | Capture and direct replay verification |
| --- | --- |
| Local file | A file-backed editor exposes its logical file path and current editor ID. `pipeFromPersistedSource` rebuilds its saved descriptor or a file provider, and `createEditorFromFile` selects the target. `app.fs.exists` checks the local path. |
| Archive entry | The logical `filePath` includes `archive!entry`; the stored descriptor or `resolveUrlToPipeDescriptor` reconstructs the file provider and archive transformer. `app.fs.exists` delegates archive entry checking to `archiveService`. |
| `folder-editor://` folder board | `BoardEditorModel.filePath` is absent for a folder board, so capture uses the logical `folder-editor://` path in `sourceLink.url`. `pipeFromPersistedSource` rebuilds the saved placeholder pipe or resolves the registered scheme. `decodeFolderEditorLink` recovers the anchor; saved target plus `folderPath` selects `createEditorFromFolder`, and the existing registry verifies the folder claim. The factory throws on invalid target/claim rather than installing an empty page; no separate anchor-existence probe is justified. |
| `tree-category://` / folder view | `CategoryEditorModel.initFromLink` sets `filePath` to the encoded category link. The registered virtual scheme supplies a placeholder pipe and category `newEditorModel` decodes the path; the target selects that module. A raw directory action creates a separate sidebar-only page and is not a navigated content editor. |
| Plain board | `BoardEditorModel.filePath` is absent, so capture uses the `persephone-board://` logical path in `sourceLink.url`. `pipeFromPersistedSource` rebuilds the saved placeholder pipe or resolves the registered scheme; `boardModule.newEditorModel` decodes the path and constructs the plain board. A single-instance interceptor can take the request instead of moving this page. |
| Custom-editor board | A file-backed board exposes its file via `currentFilePath()`, including `sourceLink.filePath` where present. Its `board-editor:<root>` target reaches `buildEditorById` and the board factory; the stored source link is passed through the board interceptor and installed after construction. `BoardPageRouter` may recapture source context and may take the request for a single-instance board. A board that depends on `sourceLink` during its initial restore cannot rely on this route: `prepareOpenedEditor` runs after restore. |
| Guide | The guide provider's `sourceUrl` and text host file path are `persephone-guide://...`; the saved guide descriptor reconstructs `GuideProvider`, while the registered scheme can resolve a missing descriptor. The `md-view` target and `createEditorFromFile` reopen it. Unlike the open pipeline, direct descriptor replay bypasses `resolveGuide`'s `getGuidePage` pre-validation; `TextFileIOModel.restore` catches provider read failures and records a provider error, so direct replay can attach an error-state editor and commit; it does not guarantee a failed guide read leaves the current page intact. |
| Untitled | With neither `filePath` nor `sourceLink.url`, no entry exists; no synthetic history entry is created. |

## Implementation Plan

- [x] **History owner:** replace `src/renderer/api/pages/NavBackStack.ts` with `src/renderer/api/pages/PageHistory.ts`. It owns capture, identity, two oldest-first stacks, snapshots and seeding, replay, preflight, and a per-page in-flight guard. Inject page/lifecycle collaborators as needed; use direct imports within the existing import zones. Expose `back()`, `forward()`, `canGoBack`, `canGoForward`, and immutable `entries` snapshots for US-2004 and US-2005. Use named `MAX_PAGE_HISTORY_ENTRIES = 50`, applied to each stack, including seed and opposite-stack pushes. Mirror the booleans into reactive page state for consumers. Do not expose mutable internal arrays.
- [x] **Capture and comparison:** `PageHistory` captures the fields above using `EditorModel.filePath ?? EditorModel.sourceLink?.url` for the logical path, plus `editorId`, `title`, and `sourceLink`. Reuse `fileIdentity` in `src/renderer/core/utils/file-path.ts`: compare the leaving path against resolved `newFilePath` plus the effective destination target. A missing incoming target means the current editor ID only when the incoming file identity matches the current file; otherwise use the resolved target supplied to navigation. File identity normalizes local paths and Windows case/separators, while virtual paths compare verbatim. Different targets are distinct. Titles, fragments and reveal hints do not affect identity. Retain the navigator's existing same-file reveal branch as non-recording.
- [x] **Success-only commit:** add `historyMove` only to `NavigatePageToOptions` in `src/renderer/api/pages/PageNavigator.ts`, with direction and enough identity to validate the peeked entry/attempt. Capture after `restore.ready` and before confirmation. At each successful reuse or fresh exit, commit once before `finishNavigation`: ordinary different-link navigation pushes a restorable leaving entry and clears Forward; navigation away from an untitled editor clears Forward even if no entry is pushed. For a history move, verify the marker matches the peeked top, pop it on success, and push the captured leaving entry onto the opposite stack if restorable. Do not record a replay as ordinary navigation. Same-link, reveal, cancelled confirmation, missing/inert page, exception and interceptor take do not commit. Reuse `reuseNavigationTarget`, `reuseEditorForFile`, `setMainEditor`, and `applyOpenHints`; surviving Link or Git Tree instances are promoted with their edits.
- [x] **Replay:** `PageHistory.back()` / `forward()` peek without popping, then call `pipeFromPersistedSource(entry.sourceLink, entry.filePath, { unknownScheme: "reject" })` from `src/renderer/content/rebuild-pipe.ts`. Decode a `folder-editor://` link using `decodeFolderEditorLink` from `src/renderer/content/folder-editor-link.ts` to derive `folderPath`; look at the stored source link href/URL or logical path, and use the saved editor target. Call `pages.lifecycle.navigatePageTo(pageId, entry.filePath, { pipe, sourceLink: entry.sourceLink, target: entry.target, title: entry.title, folderPath, historyMove })`. A marker is internal to this options type: do not add link-data or open-request fields. Guard overlapping history operations, validate the top before commit, and release the guard in `finally`. A `true` lifecycle result is not proof of a move because an interceptor can take it; only the navigator commits.
- [x] **Pipe ownership:** as in `src/renderer/content/open-handler.ts`, dispose a rebuilt pipe on `false` or throw. On a successful folder build, dispose the unused pipe; on a fresh file build transfer it to the editor; on file reuse use the navigator's existing disposal. Ensure successful singleton reuse also disposes its unused incoming pipe (the existing `reuseNavigationTarget` does not). On interceptor take, the existing board router disposes its pipe; do not double-dispose. Retain these ownership rules for any other interceptor. A reconstruction failure or rejected navigation leaves the current editor and stacks intact.
- [x] **Missing source and build failures:** before reconstructing, use `app.fs.exists` for non-virtual local `filePath`, including archive entries; use `isVirtualPath` and the existing file-path utilities rather than probing virtual URLs. For a missing path, remove only the peeked entry, notify with `ui.notify(t("api.fileNotFound", { name: fpBasename(filePath) }), "error")`, update state and persist; leave the opposite stack and current editor intact, without automatically skipping another entry. No folder-anchor preflight. In `PageNavigator.buildEditor`, when `options.historyMove` is present, fail instead of installing either empty-text fallback on a missing file or editor-build error; preserve ordinary navigation behavior. This also handles a file disappearing after preflight. Ensure a failed partially built editor/pipe is disposed by its owner.
- [x] **Page and Markdown:** in `src/renderer/api/pages/PageModel.ts`, replace the stack field with the `history` collaborator, wire reactive state and descriptor snapshot/seed delegation only. Remove `pushNavBack`, `popNavBack`, `seedNavBack`, and `navBackCount`. In `src/renderer/api/pages/IPageHost.ts`, replace push/pop with optional `readonly history?:` narrow history interface (or `PageHistory`). In `src/renderer/editors/markdown/MarkdownEditor.ts`, remove the push in `followLink` and delegate `navigateBack` to `page.history?.back()`. In `src/renderer/editors/markdown/MarkdownEditorView.ts`, select the reactive `canGoBack` instead of `navBackCount`, adjusting its boolean consumer as needed. The button remains until US-2004. If removal of the required state field makes `BrowserPanelHost`'s object literal fail excess-property checking, delete only its dead `navBackCount: 0` literal; its extra no-op methods need no change merely because the interface no longer declares them. No other Browser code changes.
- [x] **Persistence:** in `src/shared/persistence.ts`, define new entries with required `filePath`, `target`, and `title`, plus optional already-cleaned `sourceLink`; retain `href` only in a legacy nav-entry shape read by migration. Add optional oldest-first `historyBack` and `historyForward` arrays to `PageDescriptor`; omit empty snapshots and retain optional `navBack` as legacy input. The change is additive: `WindowState.schemaVersion` stays 4. In `src/renderer/api/pages/descriptor-migrations.ts`, add a dated 2026-11-15 migration before board-link repair in `normalizePageDescriptor`: if `historyBack` is absent, convert each old `{ href, title? }` in order to `{ filePath: href, target: EditorId.mdView, title: title ?? href }`; explicit new history wins, forward defaults empty, and discard `navBack` from normalized output. Use existing file URL normalization for legacy `file://` hrefs before storing a logical path. Make migration idempotent. Extend `migratePersistedBoardLinks` to repair both stacks' `filePath` and saved `sourceLink.href`/`url` with `repairBoardLink`, and resolve each `target` with existing `resolveBoardEditorId`; preserve the board registry as the owner of board-root rules. A persisted placeholder descriptor may contain an old board root in its provider path: repair that path through the same board-link helper when present, without altering unrelated provider configs. In `src/renderer/api/pages/PagesPersistenceModel.ts`, seed both normalized stacks; snapshot through the page descriptor for saves and window moves. Schedule persistence for history changes outside successful navigation, especially missing-entry removal.
- [x] **Verify:** `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass. This project has no unit tests; none were added. Strict-folder nullability fixes are type-only and did not change runtime conditions. No protocol code, new import-zone exceptions, `await import()` to break a cycle, board-rule relocation, or `window.persephone` change was added. `PagesLifecycleModel.ts` needs no replay helper: its existing public `navigatePageTo` and interceptors are used directly.

### Before and after sketches

```ts
// Before: Markdown pushes before an open that can fail.
page.pushNavBack({ href: current.filePath, title: current.title });
await app.events.openRawLink.sendAsync(createLinkData(href, { pageId, target: EditorId.mdView }));

// After: normal links navigate as before; the navigator commits after attachment/reuse.
await app.events.openRawLink.sendAsync(createLinkData(href, { pageId, target: EditorId.mdView }));
// In each successful navigator exit, before finishNavigation:
page.history.commitNavigation(leavingEntry, options, destination);
```

```ts
// Before: Back pops before the open can fail.
const entry = page.popNavBack();
// After: peek and rebuild through the existing persisted-source helper.
const entry = history.peekBack();
const pipe = await pipeFromPersistedSource(entry.sourceLink, entry.filePath, { unknownScheme: "reject" });
await pages.lifecycle.navigatePageTo(pageId, entry.filePath, {
    pipe, sourceLink: entry.sourceLink, target: entry.target,
    title: entry.title, folderPath, historyMove,
});
```

```ts
// Before: navBack stores href-only Markdown entries.
navBack?: LegacyNavEntry[];
// After: retain navBack for dated migration and persist two new stacks.
historyBack?: NavEntry[];
historyForward?: NavEntry[];
navBack?: LegacyNavEntry[];
```

Sketches omit guards, pipe disposal, other existing fields and failure handling; the checklist defines those requirements.

## Concerns

- `buildEditor` restores before `prepareOpenedEditor`; source-link-dependent initial restore cannot assume saved metadata is already installed. Descriptor reconstruction preserves registered, reconstructible pipe configuration, but private `sessionHandle` is stripped by existing storage cleaning. Guide direct replay bypasses guide resolver validation, and `TextFileIOModel.restore` catches and records provider read errors rather than throwing; an error-state editor can therefore attach and commit. Thrown reconstruction and build failures do not commit.
- An interceptor `take` returns `true` and the board router disposes its pipe; success must be signalled by the navigator's commit, not inferred from that boolean. Reuse and folder builds need explicit unused-pipe disposal.
- Virtual identities compare verbatim. Legacy Markdown entries default to `md-view`. No scroll or cursor snapshot is captured.
- Header controls, shortcuts and removing the Markdown button are US-2004; the scripting object-model node and guides are US-2005. No Browser logic or board bridge changes are planned.

## Acceptance Criteria

- Successful in-place fresh and reuse navigation records a restorable leaving editor using the specified logical `filePath` entry, clears Forward on a new branch, and caps each stack at 50. Untitled, same-link, reveal, cancelled and intercepted navigations do not create entries.
- Back and Forward rebuild from the stored source descriptor, invoke the lifecycle navigator directly, and commit only at its successful navigator exit. Cancellation, take, missing/inert page, reconstruction failure and build failure do not move the stacks; missing local files/archive entries remove only that entry with a toast and do not replace the page.
- Local files, archive entries, categories, plain and folder boards, file-backed custom boards and guides follow the verified direct routes, subject to the listed restore and interceptor limitations.
- Schema version remains 4. Legacy `navBack` migrates once in order to Markdown-targeted entries. Both new stacks survive restart/window transfer and board links, embedded placeholder paths and board editor IDs are repaired.
- Model consumers have `back()`, `forward()`, `canGoBack`, `canGoForward`, and immutable entry snapshots. Markdown's existing button observes `canGoBack` and calls history; no scripting API node or Browser logic changes.
- `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass.

### Claude live checks

1. Navigate file A to B to C; Back, Forward, and a new navigation: check target views, stack cap, and Forward clearing.
2. Cancel a modified-editor save prompt during Back; check both stacks and current editor. Repeat with a single-instance board interceptor.
3. Follow a Markdown link and use the existing Back button; repeat for an archive entry and a deleted file/entry to verify the toast and unchanged page.
4. Replay a category, guide, plain board, folder board, and file-backed custom board; exercise surviving Link/Git Tree promotion.
5. Restart or move the window with both stacks populated; check legacy Markdown migration and board-root repair.
6. Replay a configured pipe and an untitled-to-file transition; check configuration retention and the absence of a synthetic untitled entry.

## Files Changed

| File | Planned change |
| --- | --- |
| `src/renderer/api/pages/PageHistory.ts`, `src/renderer/api/pages/NavBackStack.ts` | New history collaborator; remove old stack. |
| `src/renderer/api/pages/PageNavigator.ts` | Internal move marker, success-only commits, replay failure behavior and unused-pipe ownership. |
| `src/renderer/api/pages/PageModel.ts`, `src/renderer/api/pages/IPageHost.ts` | Swap history field and state; replace old stack methods with optional history contract. |
| `src/renderer/editors/markdown/MarkdownEditor.ts`, `src/renderer/editors/markdown/MarkdownEditorView.ts` | Delegate Back, remove push, observe `canGoBack`. |
| `src/shared/persistence.ts`, `src/renderer/api/pages/descriptor-migrations.ts`, `src/renderer/api/pages/PagesPersistenceModel.ts` | Two new stacks, dated legacy migration, board-link/target repair, seed both. |
| `src/renderer/editors/browser/BrowserPanelHost.ts` | Only remove the obsolete state-literal property if typechecking requires it; no other Browser change. |

No changes: `src/renderer/api/pages/PagesLifecycleModel.ts` (existing public lifecycle and interceptors suffice), `src/renderer/api/pages/open-request.ts`, `src/renderer/content/open-handler.ts`, `src/renderer/api/types/io.link-data.d.ts`, `src/shared/link-data.ts`, `src/renderer/editors/base/EditorModel.ts`, `src/renderer/content/builtin-schemes.ts`, `src/renderer/content/resolvers.ts`, board code and registries, other `src/renderer/editors/browser/` files, `window.persephone`, `assets/guides/`, `doc/active-work.md`, and `doc/epics/EPIC-178.md`.
