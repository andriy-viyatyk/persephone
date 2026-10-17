# US-1700: Single-instance routing by mask

Epic: [EPIC-128 — Audio Player board](../../epics/EPIC-128.md), decision A11. Platform only; board implementation BT-044 is tracked in `../persephone-boards`.

## Goal

Add the optional board manifest contract `singleInstanceMasks: string[]` and use it to route matching singleton-board opens to the full-player page while allowing other claimed-file opens to stay in or create ordinary light pages. A nonmatching file opened from the full player's own page must enqueue into that full player rather than replace it. Preserve legacy singleton routing for manifests without the new field.

## Background

### Verified current behavior

- **Manifest parsing:** [`src/renderer/editors/board/board-manifest.ts`](../../../src/renderer/editors/board/board-manifest.ts) declares `singleInstance` on both `BoardManifest` and `NormalizedBoardManifest`; `parseBoardManifest()` copies only a boolean. The existing `normalizeFileMasks()` function is the manifest's file-mask normalization path. `singleInstanceMasks` is currently absent.
- **Projection and info surfaces:** `singleInstance` is projected by `src/renderer/scripting/api-wrapper/board-manifest-projection.ts` into `IBoardManifest`, and by `BoardInfoEditorFacade.ts` into info properties. It is also represented in `BoardInfoEditorModel.ts`, `src/renderer/api/types/board-info-editor.d.ts`, `src/renderer/api/types/board-editor.d.ts`, and the shipped copies `assets/editor-types/board-info-editor.d.ts` and `assets/editor-types/board-editor.d.ts`. Those are the corresponding places for exposing the new field.
- **Bridge version:** [`src/shared/board-bridge-version.ts`](../../../src/shared/board-bridge-version.ts) confirms `BOARD_BRIDGE_VERSION = "1.39.0"`; this task's next minor is **1.40.0**. The current-version references are at the top of `assets/guides/boards.md` and `assets/guides/agents/boards.md`; the agent guide has the manifest reference section near its `singleInstance` listing. `doc/architecture/overview.md` carries a chronological bridge changelog through 1.37.0. EPIC-128 retains its historical US-1689/US-1690 note and now appends the US-1700 1.40.0 bump.
- **Existing singleton route:** `PagesLifecycleModel.openSingleInstanceBoard()` resolves a board root from the open target/path, reads or receives its normalized manifest, and routes *every* open to the most recently shown board page when `singleInstance === true`. It enqueues the source URL/context, disposes the incoming pipe, then returns the existing page. It is called from `addBundledBoardPage()`, `openFile()`, and `navigatePageToWithSingletonRouting()`.
- **Open versus navigation fallback:** `openFile()` calls singleton routing before `findPageByFilePath()` dedupe. If no singleton is returned, it reuses an already-open page with the same `mainEditor.filePath`, calling `onReopen(pipe)` when restored/ready; otherwise it creates and adds a new page. `navigatePageToWithSingletonRouting()` calls singleton routing before delegating to `PageNavigator.navigatePageTo()`, so a non-routed open navigates the requested page in place.
- **Source context capture, verified end-to-end:** `navigatePageToWithSingletonRouting()` finds the source page and captures `BoardSourceContext` from `options.sourceLink` before singleton routing. It places the snapshot on the routed `sourceLink`; for an in-place navigation, `PageNavigator.navigatePageTo()` builds the board editor and assigns `options.sourceLink` to its state before `page.setMainEditor()`. A stream-host board is the base `BoardEditorModel`; it reads `initialSourceContext()` from `state.sourceLink.sourceContext`, and `BoardWebview.ts` sends that value in the initial bridge handshake. `src/board-shim.ts` stores the handshake value and exposes it as `persephone.source.initialSourceContext`. `getRestoreData()` persists `cleanForStorage(sourceLink)`. The source-panel click path in `LinkEditor.openLinkFromPanel()` sends `pageId` and `sourceId` through `openRawLink`; `src/renderer/content/open-handler.ts` forwards those to `navigatePageTo()`, so the context capture is also reached for Link Editor clicks.
- **Stream-host page source and restore:** `PagesLifecycleModel.buildEditorById()` explicitly leaves `editorKind: "stream-host"` on the base `BoardEditorModel` and calls `initFromBoardRoot(boardRoot, filePath)`. `BoardEditorModel.currentFilePath()` returns `state.filePath ?? state.sourceLink?.filePath`, exposed as its `filePath` getter. `openFile()` stores a cleaned `sourceLink` (including `pipeDescriptor`) on the editor before adding it to the page. `BoardEditorModel.getRestoreData()` stores both `filePath` and cleaned `sourceLink`; `PagesPersistenceModel` restores the persisted `board-view` editor state. The original file source therefore remains available for light/full classification after session restore; the live pipe itself is transient and can be reconstructed from the persisted source descriptor.
- **In-place navigation and reopen behavior:** a nonmatching file reaches `PageNavigator.navigatePageTo()`, whose normal build path creates a fresh board model for the target file and whose `page.setMainEditor()` swaps it into the current tab. This is a board rebuild with a new initial source, not `source.onOpen()` on the existing stream-host model. `BoardEditorModel` does not implement `onReopen()`. For `openFile()` instead, exact `mainEditor.filePath` equality in `findPageByFilePath()` focuses the existing page; the optional `onReopen(pipe)` hook is absent on `BoardEditorModel`, so the incoming pipe is disposed. A different file path proceeds to a new page.
- **Board-root lookup:** `PagesQueryModel.findPageByBoardRoot()` currently selects the most recently ordered page with a matching `BoardEditorModel.boardRoot`; it does not distinguish an initial board page from a file-opened board page. `PagesModel.findPageByBoardRoot()` is a direct wrapper and `openSingleInstanceBoard()` is the only caller found so far. `findPagesByBoardRoot()` is a separate all-pages query and is used for inventory/management, not this singleton route. When masks are present, pass them into this query (or an equivalent routing-specific query) and inspect the main editor's persisted source identity: no file source or a `persephone-board://` source is full-player eligible, as is a source whose basename matches a singleton mask. Ordinary file sources outside those masks are ineligible. An absent field must retain the existing unfiltered query.
- **Full-player page classification:** define one `isFullPlayerBoardPage(page, boardRoot, masks)` helper and use it both when `findPageByBoardRoot()` filters routing candidates and when navigation starts from its own full-player page. It requires a matching `editor.boardRoot`, then treats no current `filePath`, a `PERSEPHONE_BOARD_PREFIX` path, or a basename matching one of the masks as full-player. This lets a full player's own Explorer navigation enqueue even a nonmatching audio file on that same full player.
- **Mask semantics:** `normalizeFileMasks()` trims and lowercases entries, drops non-string/empty entries, and coerces a bare extension/name into the established file-mask form; `matchesFileMask()` is a case-insensitive whole-basename glob (`*` and `?`). Both helpers already define board file-mask semantics and can be reused for `singleInstanceMasks`.

### Current behavior examples

```ts
// Before: current PagesQueryModel signature and selection behavior.
findPageByBoardRoot = (boardRoot?: string): PageModel | undefined => {
    if (!boardRoot) return undefined;
    const normalizedRoot = fpNormalizeForCompare(boardRoot);
    const { ordered } = this.model.state.get();
    return [...ordered].reverse().find((page) => {
        const editor = page.mainEditorInstance as { boardRoot?: string } | null;
        return !!editor?.boardRoot
            && fpNormalizeForCompare(editor.boardRoot) === normalizedRoot;
    });
};

// Before: openSingleInstanceBoard's current exact signature and routing branch.
private async openSingleInstanceBoard(
    filePath: string | undefined,
    pipe: IContentPipe | undefined,
    options?: {
        sourceLink?: ILinkData;
        target?: string;
        sessionHandle?: string;
        normalizedManifest?: NormalizedBoardManifest | null;
    },
): Promise<PageModel | undefined> {
    const boardRoot = this.resolveBoardRootForOpen(options?.target, filePath);
    const normalizedManifest = options && Object.prototype.hasOwnProperty.call(options, "normalizedManifest")
        ? options.normalizedManifest
        : boardRoot ? await readNormalizedBoardManifest(boardRoot) : null;
    if (!boardRoot || normalizedManifest?.singleInstance !== true) return undefined;
    const existingPage = this.model.query.findPageByBoardRoot(boardRoot);
    if (!existingPage) return undefined;
    this.model.navigation.showPage(existingPage.id);
    this.enqueueBoardSource(existingPage, filePath, pipe, options?.sourceLink, options?.sessionHandle);
    pipe?.dispose();
    return existingPage;
}
```

```ts
// After: optional masks preserve legacy lookup when absent; when present,
// lookup and in-place routing share the same full-player classifier.
findPageByBoardRoot = (
    boardRoot?: string,
    singleInstanceMasks?: readonly string[],
): PageModel | undefined => {
    if (!boardRoot) return undefined;
    const normalizedRoot = fpNormalizeForCompare(boardRoot);
    const { ordered } = this.model.state.get();
    return [...ordered].reverse().find((page) => {
        if (singleInstanceMasks === undefined) {
            const editor = page.mainEditorInstance as { boardRoot?: string } | null;
            return !!editor?.boardRoot
                && fpNormalizeForCompare(editor.boardRoot) === normalizedRoot;
        }
        return this.isFullPlayerBoardPage(page, boardRoot, singleInstanceMasks);
    });
};

isFullPlayerBoardPage = (
    page: PageModel | undefined,
    boardRoot: string,
    masks: readonly string[],
): boolean => {
    if (!page) return false;
    const editor = page.mainEditorInstance as { boardRoot?: string; filePath?: string } | null;
    if (!editor?.boardRoot
        || fpNormalizeForCompare(editor.boardRoot) !== fpNormalizeForCompare(boardRoot)) return false;
    const filePath = editor.filePath;
    return !filePath
        || filePath.startsWith(PERSEPHONE_BOARD_PREFIX)
        || masks.some((mask) => matchesFileMask(fpBasename(filePath), mask));
};

private async openSingleInstanceBoard(
    filePath: string | undefined,
    pipe: IContentPipe | undefined,
    options?: {
        sourceLink?: ILinkData;
        target?: string;
        sessionHandle?: string;
        normalizedManifest?: NormalizedBoardManifest | null;
        preferredPageId?: string;
    },
): Promise<PageModel | undefined> {
    const masks = normalizedManifest?.singleInstanceMasks;
    const preferredPage = masks !== undefined && options?.preferredPageId
        ? this.model.query.findPage(options.preferredPageId)
        : undefined;
    const preferredIsFullPlayer = masks !== undefined
        && this.model.query.isFullPlayerBoardPage(preferredPage, boardRoot, masks);
    const isBoardOpen = !filePath || filePath.startsWith(PERSEPHONE_BOARD_PREFIX);
    const matchesMask = !!filePath
        && masks?.some((mask) => matchesFileMask(fpBasename(filePath), mask));
    if (masks !== undefined && !isBoardOpen && !matchesMask && !preferredIsFullPlayer) return undefined;
    const existingPage = preferredIsFullPlayer
        ? preferredPage
        : this.model.query.findPageByBoardRoot(boardRoot, masks);
    if (!existingPage) return undefined;
    // Show page, enqueue source/context, dispose incoming pipe, return page.
}
```

`PagesLifecycleModel.openSingleInstanceBoard()` also receives the originating page ID on navigation. If that page passes `isFullPlayerBoardPage()`, it is preferred and receives the enqueue even when the newly opened file does not match the singleton masks.

## Implementation Plan

1. [x] **Add and normalize the manifest field** in `src/renderer/editors/board/board-manifest.ts` next to `singleInstance` in `BoardManifest` and `NormalizedBoardManifest`, and in `parseBoardManifest()`. Preserve optionality: absent or non-array input leaves the field undefined; an explicitly supplied array is retained after `normalizeFileMasks()`, including an empty normalized array when all entries are invalid/empty. These masks affect singleton routing only and do not replace the board's `fileMasks` claims.
2. [x] **Project the field anywhere `singleInstance` is projected:**
   - `src/renderer/scripting/api-wrapper/board-manifest-projection.ts` (`projectBoardManifest()`),
   - `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` (properties copy),
   - `src/renderer/editors/board-info/BoardInfoEditorModel.ts` (`BoardPropsInfo` and manifest-derived `props`),
   - `src/renderer/api/types/board-info-editor.d.ts` and `src/renderer/api/types/board-editor.d.ts`,
   - `assets/editor-types/board-info-editor.d.ts` and `assets/editor-types/board-editor.d.ts`.
   Use readonly arrays in public declarations, following neighboring `fileMasks` declarations.
3. [x] **Change singleton open routing** in `src/renderer/api/pages/PagesLifecycleModel.ts`:
   - With no `singleInstanceMasks`, preserve current behavior exactly: every source that resolves to this `singleInstance` board attempts the existing singleton lookup and is enqueued if a page exists; a missing singleton continues through the normal open/navigation flow.
   - With `singleInstanceMasks`, only a board open without a file, a `persephone-board://` board link, a basename matching a mask, or navigation originating on this board's own full-player page is eligible for the singleton. The empty array is still a present field and therefore makes only board opens and the full-player self-navigation case eligible. Compare with `matchesFileMask(fpBasename(...), mask)` to match the existing board mask rules. Other nonmatching file opens return `undefined` from `openSingleInstanceBoard()`, allowing `navigatePageTo()` to navigate in place and `openFile()` to reach its existing file-path dedupe/new-page flow.
   - Extend the `openSingleInstanceBoard(filePath, pipe, options?)` options with `preferredPageId?: string`; for masked navigation, classify that page with the shared helper and prefer/enqueue into it when it is the full-player page. Pass the `pageId` from `navigatePageToWithSingletonRouting()`; fresh `openFile()` calls have no preferred page.
   - Keep `addBundledBoardPage()` as a no-file singleton request.
   - Continue capturing source context before routing, and ensure an in-place board gets it in the initial source link/state when `PageNavigator.navigatePageTo()` constructs the board editor.
4. [x] **Define and share one full-player classifier** in `src/renderer/api/pages/PagesQueryModel.ts` (or colocated board-routing code), with the signature `isFullPlayerBoardPage(page: PageModel | undefined, boardRoot: string, masks: readonly string[]): boolean`. Require the matching root; allow pages without a current file path, pages whose source path starts with `PERSEPHONE_BOARD_PREFIX`, and pages whose source basename matches a mask. Use this helper in `findPageByBoardRoot()` when masks are present and in masked navigation's preferred-page check. Preserve legacy query behavior when masks are absent. Update the `PagesModel.findPageByBoardRoot()` wrapper signature for optional masks; all callers have been searched and only `openSingleInstanceBoard()` currently calls it. `findPagesByBoardRoot()` remains the separate all-pages query.
5. [x] **Retain source context in in-place navigation** in `src/renderer/api/pages/PagesLifecycleModel.ts` and `src/renderer/api/pages/PageNavigator.ts`: keep capture before the singleton eligibility decision and keep the enriched `sourceLink` assignment before `page.setMainEditor()`. Do not try to enqueue `source.onOpen()` for nonmatching light-page navigation; the verified path constructs a fresh board model. Keep duplicate `openFile()` behavior on the existing file-path dedupe path.
6. [x] **Bump and document the bridge version.** The verified current source is 1.39.0; bump `src/shared/board-bridge-version.ts` to **1.40.0**. Update current version and field documentation in `assets/guides/agents/boards.md` (manifest association section), current version/changelog in `assets/guides/boards.md`, bridge changelog in `doc/architecture/overview.md`, current bridge summary in `doc/architecture/key-files.md`, and the version example/changelog comment in `src/renderer/editors/board/board-api.d.ts`. Search version lists/guides for any other current declaration; retain historical release notes.
7. [ ] **Acceptance checks:** cover board/no-file open, `persephone-board://` open, matching and nonmatching basename routes, legacy manifests with no `singleInstanceMasks`, Explorer in-place navigation, Link Editor panel in-place navigation, normal `openFile()` creation and duplicate-file focus, singleton lookup when light and full pages coexist, and restore classification for persisted file-opened pages. These live routing scenarios remain for manual verification; no test harness or app start/stop was used.

The intended method-signature changes are:

```ts
// Before
findPageByBoardRoot = (boardRoot?: string): PageModel | undefined => { ... };
private async openSingleInstanceBoard(
    filePath: string | undefined,
    pipe: IContentPipe | undefined,
    options?: {
        sourceLink?: ILinkData;
        target?: string;
        sessionHandle?: string;
        normalizedManifest?: NormalizedBoardManifest | null;
    },
): Promise<PageModel | undefined>;

// After
findPageByBoardRoot = (
    boardRoot?: string,
    singleInstanceMasks?: readonly string[],
): PageModel | undefined => { ... };
private async openSingleInstanceBoard(
    filePath: string | undefined,
    pipe: IContentPipe | undefined,
    options?: {
        sourceLink?: ILinkData;
        target?: string;
        sessionHandle?: string;
        normalizedManifest?: NormalizedBoardManifest | null;
        preferredPageId?: string;
    },
): Promise<PageModel | undefined>;
```

## Concerns

- **Routing classification needs care:** a plain board opened via `persephone-board://` has that URL in `sourceLink.url` but no content file; a no-file bundled board can have neither. A stream-host file page has `filePath` and a persisted `sourceLink`, including a `pipeDescriptor`. Classification must treat the board scheme as no file and must use the persisted file identity after restore.
- **Full-player self-navigation:** when the full player's own page initiates navigation to a nonmatching file, route back to that page through the existing enqueue path. Otherwise the ordinary in-place navigation fallback would replace the full player with a light page.
- **Open behavior differs by entry point:** singleton opens enqueue source events into the already-running full player. In-place navigation to a different light-page file rebuilds the board editor and exposes the new file as its initial source. A repeated `openFile()` for the same exact file just focuses the page and drops the incoming pipe because stream-host `BoardEditorModel` has no `onReopen()` implementation.
- **User scope excludes board-side implementation.** The matching board manifest declaration and light/full UI behavior belong to BT-044 in `../persephone-boards`; this task documents only Persephone platform behavior and its authoring guide/bridge contract.

## Acceptance Criteria

- [x] Optional `singleInstanceMasks: string[]` is parsed, normalized, and visible through every manifest/info type and projection listed above.
- [ ] Matching board and file opens route to the full-player singleton; nonmatching files stay on their source page for navigation opens and get an ordinary page for fresh opens.
- [x] A manifest without `singleInstanceMasks` retains today's route-everything behavior.
- [ ] Routing reuses only a full-player page for manifests with masks; a light page opened from an audio file never captures a board launch.
- [ ] Navigating from the full player's own page to a nonmatching audio file enqueues it into that page and does not replace the full player with a light page.
- [ ] Clicking an audio file in Explorer and in a Link Editor category/tag panel plays it in place on that page; previous/next walk the clicked folder/category/tag (board side BT-044).
- [ ] Launching the board from the Boards panel while a light page exists opens/focuses the full player, never the light page.
- [ ] Initial source context reaches an in-place stream-host board and survives the intended persisted page state; session-restored file-opened pages remain classifiable as light pages.
- [ ] Light-page duplicate opens follow the existing `findPageByFilePath()` dedupe and stream-host `onReopen` contract as verified in this task.
- [x] `BOARD_BRIDGE_VERSION` advances from 1.39.0 to 1.40.0; the boards guide and bridge changelog state the new contract/version.
- [x] Task remains platform-only; no changes are planned in `../persephone-boards`.

### Verified files needing no change

- `src/renderer/content/open-handler.ts`: existing Link Editor/Explorer navigation dispatch already calls `pagesModel.lifecycle.navigatePageTo()` with the source page ID and source link; singleton gating belongs in the lifecycle method.
- `src/renderer/api/pages/PageNavigator.ts`: current navigation already stores the link/source context on the target editor before the page swap; no change is indicated by the verified in-place board path.
- `src/renderer/editors/board/BoardEditorModel.ts`: the existing file/source identity, `initialSourceContext()` accessor, `getRestoreData()` serialization, and base stream-host lifecycle already provide what classification needs.
- `src/renderer/api/pages/PagesPersistenceModel.ts`: it restores the board's persisted state and pipe descriptor; the source discriminator is already retained.
- `../persephone-boards`: explicitly outside US-1700 scope; BT-044 owns board-side use of the new field.

## Files Changed Summary

| File | Planned change |
|---|---|
| `doc/tasks/US-1700-single-instance-masks/README.md` | This implementation-ready task plan and investigation record. |
| `doc/active-work.md` | Link the active EPIC-128 entry to this task document. |
| `doc/epics/EPIC-128.md` | Link US-1700 in the Persephone task table. |
| `src/renderer/editors/board/board-manifest.ts` | Parse and normalize `singleInstanceMasks`. |
| `src/renderer/scripting/api-wrapper/board-manifest-projection.ts` | Project the normalized field to board scripts. |
| `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Project the field through board info properties. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Expose field in derived board info. |
| `src/renderer/api/types/board-info-editor.d.ts`, `src/renderer/api/types/board-editor.d.ts` | Public declarations. |
| `assets/editor-types/board-info-editor.d.ts`, `assets/editor-types/board-editor.d.ts` | Shipped editor type copies. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Mask-gated singleton routing, preserving legacy behavior and source context. |
| `src/renderer/api/pages/PagesQueryModel.ts`, `src/renderer/api/pages/PagesModel.ts` | Shared full-player classifier and optional-mask routing query. |
| `src/shared/board-bridge-version.ts` | Bump confirmed bridge version from 1.39.0 to 1.40.0. |
| `assets/guides/agents/boards.md`, `assets/guides/boards.md` | Document the field and update current bridge version/changelog. |
| `doc/architecture/overview.md`, `doc/architecture/key-files.md` | Add/update board bridge changelog and current version summary. |
| `src/renderer/editors/board/board-api.d.ts` | Update bridge version example and source-context release comment. |
| `src/ipc/board-bridge-channels.ts`, `src/board-shim.ts` | Add the source navigation request/reply and `persephone.source.navigate()` implementation. |
| `src/renderer/editors/board/BoardWebview.ts`, `BoardEditorModel.ts` | Gate requests to the trusted main frame and validate/navigate only within the hosting page's initial source context. |
| `src/renderer/editors/shared/source-context.ts`, `src/renderer/editors/video/VideoEditor.ts` | Share source-panel selection and navigation behavior between boards and Video Player. |
| `src/shared/board-source-context.ts` | Preserve target metadata in source context items for navigation. |

## Addendum A — source navigation for light pages (user decision 2026-10-18)

### Goal

**Before**

> Add the optional board manifest contract `singleInstanceMasks: string[]` and use it to route matching singleton-board opens to the full-player page while allowing other claimed-file opens to stay in or create ordinary light pages.

**After**

> Keep the `singleInstanceMasks` routing contract and expose `persephone.source.navigate(href): Promise<void>` so a light-page board can navigate its hosting page only to an item from that page's initial Explorer or Link Editor category/tag source context. Preserve Video Player Next's source selection, navigation metadata, and callback lifetime behavior.

### Implementation plan

**Before**

> The platform captures a bounded initial source context for the board, but the board bridge has no source-panel navigation call.

**After**

> Add `source.navigate` to the 1.40.0 bridge and route its request through `src/board-shim.ts`, `src/ipc/board-bridge-channels.ts`, `BoardWebview.ts`, and `BoardEditorModel.ts`. Validate against `state.sourceLink.sourceContext.items` using `fpNormalizeForCompare` for local paths and exact href matching for URLs. Accept only `explorer`, `link-category`, and `link-tag` source IDs, from the main frame and for this board's hosting page. Dispatch `openRawLink` with the page/source/category/tag/target/title metadata and resolve after dispatch. Extract Video Player's navigation and panel-selection logic into `src/renderer/editors/shared/source-context.ts`; keep its US-1288 callback-lifetime reasoning there. Document `source.navigate` in the board API declaration, 1.40.0 guides, and bridge changelog without changing the bridge version.

The nonmatching-audio light-page path remains an in-place navigation: `navigatePageToWithSingletonRouting()` captures the new source context, `openSingleInstanceBoard()` returns no singleton for a nonmatching file when the source page is not the full player, and `PageNavigator.navigatePageTo()` rebuilds the board on that same page with the captured context.

### Acceptance

**Before**

> The board can read the initial sibling snapshot but cannot ask Persephone to navigate to a sibling while remaining in its light page.

**After**

> `source.navigate(href)` accepts only an item in the initial source snapshot and rejects unsupported sources or unknown hrefs with a stable readable error. Explorer selection updates before navigation; Link Editor selection updates after navigation in `afterPaint`. The request is main-frame-only, stays within the hosting page, and resolves after `openRawLink` dispatch. Video Player delegates to the shared helper without changing its behavior. The nonmatching audio navigation path above retains its light-page placement and recaptures source context. `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass; no test harness is added or run.

## Addendum B — page visibility for boards (user decision 2026-10-18)

### Goal

**Before**

> The board bridge exposes page mute state and toggle events, but a board cannot tell whether its hosting page is currently displayed.

**After**

> Expose `persephone.page.visible` and `persephone.page.onVisibilityChange(callback)` so a board can read whether its page is displayed and subscribe to changes. A page is visible when it is active or grouped side by side with the active page. Window minimization does not affect this page-level value.

### Implementation plan

**Before**

> `BoardPortInitMsg` has no page-visibility field, and `BoardWebview` does not observe page activation or grouping for the board's host page.

**After**

> Add a boolean visibility value to the board's initial bridge handshake in `src/ipc/board-bridge-channels.ts`, set it from `BoardWebview` using the active page and `pagesModel.query.getGroupedPage()`, and initialize the shim's `persephone.page.visible` value before the frame uses the completed bridge. Subscribe each board webview to `pagesModel.state`; post a `page:visibility` message only when the derived value changes, and have `src/board-shim.ts` update the getter and notify `onVisibilityChange` subscribers. Include the current value in each handshake so frame reloads receive it. Document the API in `src/renderer/editors/board/board-api.d.ts`, the page section of `assets/guides/agents/boards.md`, the 1.40.0 changelog in `assets/guides/boards.md`, and the board bridge changelog in `doc/architecture/overview.md`. Keep `BOARD_BRIDGE_VERSION` at 1.40.0.

Implementation steps:

1. [x] Add `pageVisible: boolean` to `BoardPortInitMsg`; calculate active-or-grouped visibility in `BoardWebview`, include it in the handshake, and subscribe to `pagesModel.state` for transitions.
2. [x] Add the `page:visibility` host message and expose `page.visible` plus immediate `page.onVisibilityChange()` callbacks with a disposer in `src/board-shim.ts`.
3. [x] Document the page API in the requested board API declaration, guides, and architecture changelog; keep `BOARD_BRIDGE_VERSION` at 1.40.0.
4. [x] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`; do not add or run tests.

### Acceptance

**Before**

> The board API has no page-level visibility property or change event, and host page activation, grouping, and regrouping do not update boards.

**After**

> `persephone.page.visible` is a boolean initialized from the first handshake. `onVisibilityChange` calls a new subscriber immediately with the current value and returns a disposer. The callback receives changes when the hosting page becomes or ceases to be active or grouped with the active page; a group member shown beside the active page is visible. The host sends at most one visibility message per actual boolean transition and sends the current value on frame reload. Window minimization does not change the value. `BOARD_BRIDGE_VERSION` remains 1.40.0; `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass. No unit tests or harnesses are added or run.
