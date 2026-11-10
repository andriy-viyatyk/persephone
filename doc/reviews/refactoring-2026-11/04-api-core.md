> Part of the [refactoring roadmap](../../refactoring-roadmap.md). Reviewed at commit `c798129d` (2026-11-10); line numbers drift, so search by symbol when they no longer match.

# 04-api-core: renderer object model core, state, content pipeline and theme (refactoring review)

## Summary

The foundations are mostly sound. The state primitives (`TOneState`, `dispatch.ts`, `DisposableStore`, `OwnerScheduler`) are small and coherent, the content pipe and provider registry are clean, and the app-service registry is a good model. The problems are in what has been added on top of them over the last six months. The page system is where most of the recent feature work landed, and it shows. Board and recovery features, which were bolted on, now dominate the two central classes. The documented layer rules no longer describe the code.

The three biggest problems:

1. **`PagesLifecycleModel` (1,444 lines) is a god class.** It builds editors, routes boards, opens a dozen singleton pages, handles recovery retries, transfers pages between windows, opens dialogs and runs the open-hint logic. It contains 118 references to boards, the same registry lookup written inline five times, and about 60 lines of dead code (CORE-1).
2. **`PageModel` mixes the tab container with three other state machines.** These are the restore attempt, the recovery placeholder (`retainedDescriptor`, checked 35 times across the code), and board ownership. Its typed `transient` string store is a side channel between api and ui. It still carries `any`-typed compatibility shims, and it reaches back into the pages singleton (CORE-2).
3. **The documented dependency rules are broken in every direction (CORE-3).** For example: `core` imports `api` and `ipc`; even `TOneState` pulls in the IPC API through `utils.ts`; `uikit` → `core/utils/guard` → `api/ui`; `content` imports `api/pages`, `editors/board` and `ui/dialogs`; `api/pages` imports `ui/dialogs` and `ui/secondary-views`.

Answers to the questions in the brief:

- **`settings.ts` is half a store and half a grab-bag.** One setting is defined in four to six separate places. The file also contains microphone IPC, theme application and editor-category migration (CORE-7).
- **The 3-layer pipeline is followed for content opens.** Layer 2, however, carries out non-content actions itself, which is why the `phase` flag exists (CORE-11).
- **`core/utils` is not a dumping ground by size,** but it holds IO, UI and IPC code plus about 300 lines of dead code (CORE-3, CORE-13).
- **There are several ways to do the same job** for events (CORE-14), persistence of UI state (CORE-7), page access (CORE-6), the startup data folder (CORE-9) and text codecs (CORE-10).

## Findings

### CORE-1: `PagesLifecycleModel` is a god class: editor factory, board router, singleton-page catalogue and multi-window transfer in one file

- **Priority:** P1
- **Effort:** L
- **Where:** `src/renderer/api/pages/PagesLifecycleModel.ts` (whole file); `src/renderer/api/pages/PagesModel.ts:254-343`; `src/renderer/api/pages/PageNavigator.ts:163-178,276-279`; `doc/architecture/pages-architecture.md:354,385`
- **Problem:** The documentation says this class handles "create, open, close, navigate, movePageIn/Out" (`pages-architecture.md:354`). In practice it does at least eight separate jobs:
  - **Editor construction (an editors concern):**
    - `attachEditorToPage` (66-108), plus the `wrap` alias kept "for the existing call sites" (110-111).
    - `buildEditorById` (221-290), which constructs `BoardContentEditorModel` by hand (254-265).
    - `constructEditorFromFile` (305-341), `createEditorFromFile` and `createEditorFromFolder` (294-354).
    - One-line wrappers: `createPipeFromPath` (200-202) and `newEditorModelByTarget` (211-216).
  - **Board routing:**
    - `resolveBoardRootForOpen`, `enqueueBoardSource` and `openSingleInstanceBoard` (134-196).
    - `addBundledBoardPage` (357-390) and `openBoardHandlerPage` (393-429).
    - `openBoardRunPage` with its private `runUrlKey` URL normaliser (113-129, 1323-1353).
    - Singleton routing wrapped around navigation (951-989), which captures a `BoardSourceContext`.
    - File-wide, 118 lines mention boards.
  - **Singleton/tool page catalogue:**
    - `showAboutPage`, `showSettingsPage`, `showMnemeConfigPage`, `showStorybookPage`, `showToolsHubPage` and `showVideoPlayerPage` (1290-1401).
    - `showMcpInspectorPage` (1355-1372), which pokes `connectionName` and `connect()` through `as unknown as` casts.
    - `showClipboardPage` with its own `CLIPBOARD_PAGE_ID` (59, 545-567), and `requireWellKnownPage` (605-628).
    - `openImageInNewTab` (1408-1428), `openSiteActionVideo` (1388-1397) and `addDrawPage` (630-635).
    - That makes three different singleton mechanisms side by side:
      - the `well-known-pages.ts` registry;
      - page-id constants imported lazily from editor modules;
      - a local constant (`CLIPBOARD_PAGE_ID`).
  - **Open orchestration:**
    - `openFile` (666-827), which is 160 lines with a nested `applyOpenHints` closure (see CORE-4).
    - `openDiff` (911-940).
    - UI dialogs: `openFileWithDialog` imports `ui/dialogs/OpenUrlDialog` (884-904).
  - **Two different retry mechanisms:**
    - `retryPageRestore` (470-524), for failed deferred opens.
    - `retryRestore` (1035-1081), for recovery placeholders.
    - The doc comment above `retryRestore` (1030-1034) describes `movePageIn`, because it is left over from a move.
  - **Multi-window transfer and duplication:** `movePageIn` (1083-1116), `movePageOut` (1118-1157) and `duplicatePage` (1165-1207).
  - **Bulk close:** `closeToTheRight` and `closeOtherPages` (993-1026) are near-identical loops.
  - **Raw state surgery repeated in five places:** inserting a page into `pages[]`/`ordered[]` is hand-written at 460-464, 1104-1112 and 1199-1204. Replacing a page is at 1058-1063, and removing one is at 1134-1138, which duplicates `PagesModel.removePage`.
  - **Duplicated registry lookup:** `customEditorRegistry.entries.find(e => fpNormalizeForCompare(e.boardRoot) === fpNormalizeForCompare(root))` is written out at 233-235, 238-240, 363-365, 398-402 and 960-962. It also appears at `PagesPersistenceModel.ts:264-269`, giving 14 copies across the renderer; there is no `findByRoot`.
  - **Dead code:**
    - `openFileAsArchive`, `_openAsarArchive` and `_openZipArchive` (829-876). They have no caller, but are still documented in `pages-architecture.md:412`.
    - `handleOpenUrl` (1219, `PagesModel.ts:309`). `RendererEventsService` has its own copy.
    - `resolveBoardRootForOpen` is public but used only internally.
  - **Circular dependency:** `PagesLifecycleModel` statically imports `PageNavigator`. `PageNavigator` calls back into `model.lifecycle.createEditorFromFile` (173). It also dynamically imports `PagesLifecycleModel` just to get `attachEditorToPage` (276-279).
  - **Migration leftovers:** the header "Page-actions (from old page-actions.ts)" (1261), a doubled doc block (1263-1275), "Walkthrough NN / XX" references (1031, 1161, 1228) and "legacy" naming for the live `TextFileModel` host.
- **Refactor:** Split by job. The `browser-pages.ts` precedent (documented in `pages-architecture.md:378-383`) already shows the pattern of "lifecycle keeps a delegate, the feature module owns the logic".
  1. **`editors/base/editor-factory.ts` (`EditorFactory`).** Move `attachEditorToPage`, `buildEditorById`, `constructEditorFromFile`, `createEditorFromFile` and `createEditorFromFolder` here. This removes the static `api/pages → editors/{monaco,explorer,base/TextHostEditorModel,board}` imports and the `PageNavigator ↔ PagesLifecycleModel` cycle. Board construction (the content-host versus plain versus folder branches at 231-272) should be a `boardModule.newEditorModel(...)` hook, not a branch here.
  2. **`editors/board/board-page-routing.ts` (`BoardPageRouter`).**
     - Move here: `openSingleInstanceBoard`, `enqueueBoardSource`, `resolveBoardRootForOpen`, `addBundledBoardPage`, `openBoardHandlerPage`, `openBoardRunPage` with `runUrlKey`, and the singleton pre-routing in `navigatePageToWithSingletonRouting`.
     - Also move the board-specific queries now in `PagesQueryModel.ts:50-103` (`findBoardRunPage`, `findPageByBoardRoot`, `isFullPlayerBoardPage`).
     - The lifecycle exposes one interception point: `openInterceptors.register((request) => Promise<PageModel | undefined>)`, consulted at the top of `openFile` and `navigatePageTo`. The board router registers itself there.
  3. **`api/pages/standalone-pages.ts` (`StandalonePages`).**
     - One registry of fixed-id pages, `{ id, editorId, configure?(editor) }`, which replaces `well-known-pages.ts`, the lazy page-id loaders and `CLIPBOARD_PAGE_ID`.
     - `showPage(id, options)` takes over `showEditorPage` and all the `show*Page` wrappers.
     - `openImageInNewTab`, `openSiteActionVideo` and `showMcpInspectorPage` become `configure` callbacks owned by their editor modules.
  4. **`PagesModel` mutation primitives.** Add `insertPage(page, { at?, activate? })`, `replacePage(old, new)` and `removePage(page)`, used by `addPage`, `movePageIn`, `movePageOut`, `duplicatePage` and `retryRestore`. No submodel writes `state.pages`/`state.ordered` directly afterwards.
  5. Keep in `PagesLifecycleModel`: `addPage`, `addEmptyPage*`, `addEditorPage`, `openLinks`, `openFile`/`navigatePageTo` (both thin over CORE-4's open request), `closePage`, the bulk-close helpers merged into `closePages(predicate)`, `movePageIn`/`Out` and `duplicatePage`.
  6. Delete the dead members listed above. Move `openFileWithDialog`/`openFileFromDialog` to `ui/` or the dialog module (they are UI commands). Fix `pages-architecture.md` §4 and §5.
- **Risk / notes:** This is a large mechanical move, but it has a clear seam per bullet. Do it as four tasks: factory, board router, standalone pages, mutation primitives. The factory has to come first because the others import it. The board interceptor must keep the current ordering, where singleton routing runs before existing-page dedupe (683-684). This overlaps with the editors and boards reviewers (the factory hook and `customEditorRegistry.findByRoot`).

### CORE-2: `PageModel` combines the tab container with a restore state machine, a recovery placeholder, board ownership and `any`-typed compatibility shims

- **Priority:** P1
- **Effort:** L
- **Where:** `src/renderer/api/pages/PageModel.ts:35-45,106-187,263-300,338-357,509-550,580-583,647-659,699-710,920-974,1005-1010,1020-1060`; `src/renderer/api/pages/IPageHost.ts:42-47,66-67`; `src/renderer/api/pages/PagesLifecycleModel.ts:519,794,819`; `src/renderer/ui/app/PageContentView.ts:220`; `src/renderer/editors/base/index.ts:10`
- **Problem:** `PageModel` should be "the stable tab container that owns the browsing context" (`pages-architecture.md:76`). It carries six other things:
  - **Restore attempt state machine** (`startRestore`, `cancelRestore`, `ready`, `restoreController`, `restoreAttempt`, at 134-187).
  - **Recovery placeholder.**
    - Five fields: `retainedDescriptor`, `recoveryRetry`, `recoveryInvalidated`, `recoveryCloseAuthorized` and `recoveryProtectionOwned` (109-129).
    - Every operation must remember it: `retainedDescriptor` is checked 18 times in `PageModel` and 17 more in `PagesLifecycleModel`, `PagesLayoutModel`, `PageNavigator` and `PageTabView`. Examples: setters at 343 and 399, `setMainEditor` at 619, `switchMainEditor` at 678, `close` at 921, `getDescriptor` at 984 and `modified` at 429.
    - It also owns cache-file protection via `fs.releaseCacheIds`/`deleteCacheFiles` (123, 1050-1057).
  - **Two retry paths with confusing names:**
    - `RestoreFailedEditor.retry` calls `lifecycle.retryRestore(pageId)` (`PagesPersistenceModel.ts:197`).
    - The loading shell reads transient `"retryRestore"`, which calls `lifecycle.retryPageRestore(page)` (`PageContentView.ts:220`, `PagesLifecycleModel.ts:794`).
  - **Untyped side channel.** `getTransient`/`setTransient` (263-278), which is also on `IPageHost:46-47`, carry four contracts keyed by strings:
    - `"retryRestore"` and `"applyOpenHints"` (closures passed from the lifecycle to the UI and back);
    - `"boardRunOwner"` and `"lockedBoardRoot"` (board ownership, 280-300).
  - **Compatibility shims typed `any`.**
    - `addSecondaryView`, `removeSecondaryView` and `promoteSecondaryToMain` (512-550, 699-710), plus `setMainEditorId`, the "compat shim used by v3 restore path" (1005-1010).
    - Two shims are unused: `removeSecondaryViewWithoutDispose` (531-536) and `findSecondaryView` (580-583).
    - `IPageHost` publishes the `any` signatures (`IPageHost.ts:42-43,66-67`) to Archive, Mneme, Git Tree and Link Editor callers.
  - **Dual main-editor shape.**
    - `mainEditor` returns the unwrapped `TextFileModel` host for "legacy consumers" (35-45, 332-340). `mainEditorInstance` returns the real editor (351-357).
    - Both are widely used (36 versus 66 call sites).
    - `EditorOrHost = EditorModel | TextFileModel` (`editors/base/index.ts:10`, redeclared in `PageWrapper.ts:67`) has 52 uses and 7 `as unknown as EditorOrHost` casts. This is the residue of the TextFileModel → TextHostEditorModel migration.
- **Other coupling problems:**
  - `setMainEditor` does `await import("../pages")` to reach the singleton and exit compare mode (647-659). That is a layout rule implemented from inside the page.
  - `PageModel` imports `ui/dialogs/ConfirmationDialog`, `ui/dialogs/dialog-buttons` and `ui/secondary-views/SecondaryViewsModel` + `panel-key` (17, 23, 28-29).
- **Refactor:**
  1. **`PageRestore`** (new class in `api/pages/PageRestore.ts`). Owns `start/cancel/ready/status/error` and a typed `retry?: () => Promise<void>`. Expose it as `page.restore`. `PageContentView` calls `page.restore.retry()`, and both `"retryRestore"` and `"applyOpenHints"` transients disappear (the hint callback becomes part of the open request in CORE-4).
  2. **`RecoveryPlaceholder`** (new class). Holds the descriptor, cache protection, the invalidation and retry promise, and the close authorisation. A recovery page becomes `PageModel` + `RestoreFailedEditor` + `page.recovery?: RecoveryPlaceholder`.
     - Guards collapse to one predicate, `page.isInert`, checked at the collection level: the layout, navigator and lifecycle entry points.
     - The ~10 inline checks inside `PageModel` mutators go away.
     - Rename `retryRestore` → `recoverPage`, and `retryPageRestore` → `retryOpen`.
  3. **Typed runtime slots** instead of the string store:
     - `page.boardRun?: BoardRunPageOwner` and `page.lockedBoardRoot?: string`. Better still, a `WeakMap<PageModel, …>` owned by the CORE-1 board router, so the page has no board vocabulary.
     - Drop `getTransient`/`setTransient` from `IPageHost`. `BrowserPanelHost` implements them only as stubs.
  4. **Replace shims with typed members:**
     - `releaseEditor(editor: EditorModel, { dispose: boolean })` and `promoteToMain(editor: EditorModel)`.
     - Delete the two unused shims.
     - Make `addPage`/restore use `attach` + `setMainEditorId` under a non-"compat" name (`assignMain`).
  5. **Compare-mode cleanup.** `PagesLayoutModel` subscribes to each attached page's `mainEditorId` slice in `PagesModel.attachPage`. `PageModel` no longer imports `../pages`.
  6. **Finish the host migration.** The lifecycle and factory always return `EditorModel` (`TextHostEditorModel` wraps the host). Replace `mainEditor` with `mainEditorInstance` + `contentHost` at the 36 call sites, then rename `mainEditorInstance` → `mainEditor`, and delete `unwrapToHost` and `EditorOrHost`.
  7. **Remove the `ui` imports.** Confirmation goes through `app.ui.confirm` (it already exists in `api/ui.ts:82`). Move `SecondaryViewsModel` (pure reactive state) and `panel-key` into `api/pages/` (or `core/`), since the page owns that state.
- **Risk / notes:** Step 6 touches many editors (tab strip, OpenTabsList, script wrappers) and needs its own task; steps 1–5 are independent of it. The recovery guards protect real data (cache-file deletion). Move them as a block, and keep `isInert` checks at every entry point that previously checked `retainedDescriptor` in the lifecycle, layout and navigator.

### CORE-3: The documented layer rules no longer hold: `core`→`api`/`ipc`, `content`→`api/pages`/`editors`/`ui`, `api`→`ui`/`uikit`/`editors`

- **Priority:** P1
- **Effort:** M
- **Where:** `doc/architecture/overview.md:230-241`.
  - core: `src/renderer/core/utils/utils.ts:1,33-35`; `core/state/state.ts:2`; `core/utils/guard.ts:1`; `core/utils/copy-files.ts:5-7`; `core/utils/file-watcher.ts:5-6`; `core/traits/fileLinkTraits.ts:5`; `core/traits/linkTraits.ts:5`; `core/utils/focus-utils.ts:22-26`; `uikit/TagsInput/TagsInputView.ts:5`.
  - content: `content/resolvers.ts:2,35-38`; `content/open-handler.ts:2`; `content/builtin-schemes.ts:2,13,100-174`; `content/tree-context-menus.ts:1-24`; `content/open-with-editor.ts:1-10`; `content/folder-editor-link.ts:2`.
  - api: `api/pages/PageModel.ts:17,23,28-29`; `api/pages/PagesPersistenceModel.ts:22`; `api/settings.ts:15`; `api/ui.ts:18`.
- **Problem:** The overview documents these rules:
  - "`core/` … no imports from other renderer layers";
  - "`uikit/` … imports only `core/` and `theme/`";
  - "`api/` … imports `core/`, uses IPC";
  - "`content/` … imports `core/`, `api/types/`".

  None of them hold:
  - **`core` depends on `api` and `ipc`.**
    - `utils.ts` imports `ipc/renderer/api` for `toClipboard`. `state.ts:2` imports `resolveState` from that same file, so **every `TOneState` user transitively loads the IPC API module**.
    - `guard.ts` imports `api/ui`, which makes the standalone `uikit` depend on the app API (`TagsInputView.ts:5` → `guard` → `api/ui` → `ui/dialogs`).
    - `copy-files.ts` and `file-watcher.ts` are filesystem services built on `api/fs` and `api/path-watch`.
    - The trait producers register with `api/fs`.
    - `focus-utils.ts` queries a `ui` data-name.
  - **`content` depends on the page model, editors and dialogs.**
    - The file resolver opens folder pages (`resolvers.ts:35-38`).
    - `builtin-schemes.ts` imports `ui/dialogs/dialog-buttons` and dynamically imports `ui/dialogs/ConfirmationDialog`, `api/board-trust`, `api/capabilities`, `api/pages` and `api/shell` (20 imports).
    - `tree-context-menus.ts` and `open-with-editor.ts` are context-menu builders with icons, which are UI.
    - `resolveEditorIdForFile` comes from `editors/board/custom-editor-registry` (`resolvers.ts:2`).
  - **`api` depends on `ui`, `uikit` and `editors`.** `PageModel` imports dialogs and secondary-view state from `ui/`. `settings.ts` imports `ui/speech/microphone-cleaning-types`. `ui.ts` reads `uikit` module singletons. The `api/pages/*` imports of editors are listed in CORE-1.

  The result is that no layer can be reasoned about, or moved, in isolation. The rule text in `overview.md` gives a false picture to anyone, human or agent, who reads it first.
- **Refactor:**
  1. **`core/utils/utils.ts`.** Move `resolveState` into `core/state/state.ts`. Move `toClipboard` to `api/clipboard.ts` (or `ui/clipboard.ts`). After this `core/state` has no non-core imports.
  2. **`guard`.** Move it to `api/guard.ts`, or keep the core function and inject the notifier: `core/utils/guard.ts` takes a `setGuardReporter(fn)` that `api/ui` installs at startup. For `uikit`, give `TagsInputView` an `onError` prop instead.
  3. **`copy-files.ts`, `file-watcher.ts`.** Move to `api/fs/` (for example `api/file-operations.ts` and `api/file-watcher.ts`). They are services, not utilities.
  4. **Trait producers using `fs`.** Move the producer registrations (OsFile and the link traits' fs calls) to `api/traits-registration.ts`, called at bootstrap. `core/traits` keeps only the registry and keys.
  5. **`content` menus.** Move `tree-context-menus.ts`, `open-with-editor.ts` and `open-with-default-app.ts` to `ui/link-menus/` (or `editors/shared/`).
  6. **`content` → pages/dialogs/trust.** See CORE-11: Layer 2 records an action, and Layer 3 (which may depend on `api/pages`) executes it.
  7. **`api` → `ui`.** See CORE-2 step 7. `settings.ts` takes `MICROPHONE_TUNING`/`MicrophoneNotch` from a `shared/` module.
  8. **Lock it in** with `eslint-plugin-import` `no-restricted-paths` zones mirroring `overview.md:232-241`. This is a lint rule, not a test. Then correct the overview wherever a real, deliberate edge remains (for example "`content` providers may use `api/fs`").
- **Risk / notes:** Each step is small and mechanical. The lint rule should start as a warning listing the known exceptions, then tighten as CORE-1, CORE-2 and CORE-11 land. This affects the `uikit` reviewer (guard) and the editors reviewer (resolver ownership).

### CORE-4: Open-hint handling is implemented four times; pipe "logical path" knowledge leaks into four modules

- **Priority:** P2
- **Effort:** M
- **Where:**
  - Open hints: `src/renderer/api/pages/PagesLifecycleModel.ts:699-712,754-822`; `src/renderer/api/pages/PageNavigator.ts:55-60,98-140,149-150,231-244,259-315`; `src/renderer/api/pages/PagesQueryModel.ts:35-48`; `src/renderer/content/open-handler.ts:20-27,69-75`.
  - Logical path: `src/renderer/content/board-pipe-utils.ts:5-9`; `src/renderer/editors/text/TextFileIOModel.ts:227-231`; `src/renderer/editors/image/ImageEditor.ts:137-141`.
- **Problem:** One `ILinkData` request is turned into editor side effects along four separate paths, each with its own copy of the hint logic:
  - **The hints themselves:** fragment, revealLine/highlightText, diff revisions, explicit host target, session handle registration, sourceLink and title.
  - **The four paths:**
    - `openFile` new page (`applyOpenHints` closure, 800-817);
    - `openFile` existing page (699-712);
    - `navigatePageTo` fresh build (282-315);
    - `navigatePageTo` reuse exits (106, 137).
  - **Repeated per path:**
    - `applyDiffRevisions` is duck-typed through a cast twice (`PagesLifecycleModel.ts:804`, `PageNavigator.ts:297-299`).
    - The `acceptOpenContext({ mode: "register-session" })` block appears twice (`PagesLifecycleModel.ts:772-781`, `PageNavigator.ts:282-291`).
    - Explicit-host-target selection appears twice (`PagesLifecycleModel.ts:764-770`, `PageNavigator.ts:195-219`).
  - **Title is applied three ways:** the `constructEditorFromFile(title)` argument, a post-open `state.update` in `open-handler.ts:69-75`, and another in `openBoardHandlerPage:427`.
  - **File identity is computed three times:** `findPageByFilePath` (`PagesQueryModel.ts:37-45`), `sameFileIdentity` (`PageNavigator.ts:55-60`) and `isVirtualPath` (`PageNavigator.ts:149-150`). All repeat `includes("://") || startsWith("data:")`.
  - **The archive "logical path" is rebuilt from `transformers.find(t => t.type === "archive").config.entryPath`** in `open-handler.ts:20-27`, `board-pipe-utils.ts:6`, `TextFileIOModel.ts:227-231` and `ImageEditor.ts:137-141`. The last two hand-build the `!` separator instead of calling `buildArchivePath`.
  - **Latent bug:** `openFile` reads `options.sourceLink?.title` (`PagesLifecycleModel.ts:735`) although `options` is optional. It compiles only because `tsconfig.json` has no `strictNullChecks`.
- **Refactor:**
  1. Add `api/pages/open-request.ts` with a typed `PageOpenRequest` (built once from `ILinkData` by `open-handler`) and `applyOpenHints(page, editor, request, { fresh: boolean })`. This one function handles the fragment (always), revealLine/highlight (forcing Monaco), diff revisions (via a declared optional `EditorModel.applyDiffRevisions?` hook, not a cast), session registration, title and panel expansion.
  2. `openFile` and `navigatePageTo` (all exits) call that function. When restore is deferred, it is passed to `page.restore.whenReady(...)` (CORE-2) instead of being stored as a transient.
  3. Add `fileIdentity(path)` to `core/utils/file-path.ts`, used by the query, the navigator and `buildEditor`.
  4. Add `logicalPath` (getter) and `logicalPathFor(sourcePath)` to `IContentPipe`/`ContentPipe`. Use them in the four call sites, which then stop reading the archive transformer's config.
- **Risk / notes:** Behaviour differs on purpose between "fresh build" and "reuse": most hints apply only on a fresh build, while the fragment applies on every exit (`content-pipeline.md:151`). Encode that as the `fresh` flag, not as separate code. Do this after CORE-1's factory split.

### CORE-5: `PagesPersistenceModel.constructPage` hard-codes per-editor restore rules and migrations

- **Priority:** P2
- **Effort:** M
- **Where:** `src/renderer/api/pages/PagesPersistenceModel.ts:42-108,133-134,187-203,221-458,529-530`; `src/renderer/api/pages/PageModel.ts:795-804,830-841`
- **Problem:** `constructPage` is a 240-line function whose try block is not indented (226-446). Inside it, the generic page restorer knows each editor's restore protocol:
  - **Per-editor branches:**
    - a content-host board (280-300);
    - Board Info (301-312);
    - restore-failed (313);
    - the host path (314-324);
    - Explorer (325-339);
    - a hard-coded `NO_HOST_EDITOR_IDS` list of 15 ids on one line (133-134, used 340-360);
    - folder-board claim validation against `customEditorRegistry` (255-273);
    - a Folder View fallback (383-411);
    - the "busy board must not resurrect" rule (252-254).
  - **The `NO_HOST_EDITOR_IDS` list duplicates `editorRegistry` metadata** (`def.hasContentHost`, already used at `PagesLifecycleModel.ts:274`). It must be edited by hand for every new editor.
  - **Migrations are mixed into normalisation:**
    - `draw-view` → Excalidraw board (80-101);
    - bundled-board root repair (42-49, 55-61);
    - in the restore-failed page, pin-side normalisation is duplicated (189 versus 231-233).
  - **Inconsistent imports:** `editorRegistry` is imported statically (11) and then re-imported dynamically three times (302, 316, 341, plus 394).
  - **Duplicated panel logic:** active-panel validation (426-439) re-implements `PageModel.composedPanels`/`_enforceActivePanelExpanded` (`PageModel.ts:795-841`).
  - **Shim:** "Re-export IEditorState so existing barrel-importers stay green" (529-530).
- **Refactor:**
  1. Add an optional editor-module hook, `restoreFromDescriptor(desc, ctx): Promise<EditorModel | null>`, declared on the editor module definition (where `newEditorModel` already lives). Its default implementation is today's host/no-host behaviour, driven by `def.hasContentHost`. Board, Board Info and Explorer implement it in their own modules.
  2. `constructPage` becomes: normalise → for each descriptor, `module.restoreFromDescriptor` → attach → `page.applySidebarDescriptor(desc.sidebar)`. That method lives on `PageModel` and reuses `composedPanels`.
  3. Move descriptor migrations (`draw-view`, bundled root repair, `navBack` link repair) to `api/pages/descriptor-migrations.ts`, each with a dated comment so it can be removed later.
  4. Add a single `normalizePinSide(desc)` helper. Delete `NO_HOST_EDITOR_IDS`, the duplicate dynamic imports and the `IEditorState` re-export.
- **Risk / notes:** Restore ordering matters: boards build their host before restoring, and Explorer attaches synchronously before the auto-init microtask (`PageModel.ts:850-860`). Keep `attach` after all editors are constructed, as now.

### CORE-6: `PagesModel` has two public surfaces (69 delegates plus public submodels), three access paths and dead delegates

- **Priority:** P2
- **Effort:** S
- **Where:** `src/renderer/api/pages/PagesModel.ts:45-49,218-369`; `src/renderer/api/pages.ts:8-10`; `doc/architecture/pages-architecture.md:318,385`
- **Problem:** `PagesModel` delegates 69 methods to its submodels (the doc says 46). The submodels are nevertheless `readonly` public members, and 50 call sites outside `api/pages` reach into them directly:
  - `query.*` (33 times);
  - `lifecycle.*` (13, for example `content/builtin-schemes.ts:118-144` and `content/open-handler.ts:36,58`);
  - `navigation.*` (4).

  So the same operation has two names, for example `pagesModel.openUrlInBrowserTab` and `pagesModel.lifecycle.openUrlInBrowserTab`.

  The submodels mutate shared `state` directly (lifecycle, layout and persistence all call `this.model.state.update`), so the split does not encapsulate anything.

  Same names, different meanings:
  - `PagesModel.openFile(path)` (268-285) dispatches a raw link through Layer 1.
  - `PagesLifecycleModel.openFile(path, pipe, options)` is the Layer 3 sink.

  Three ways to reach the singleton: `app.pages` (40 uses), `import { pages }` (43 files) and the alias `pagesModel`, "backward-compatible during migration" (77 files, `pages.ts:9-10`).

  Dead delegates: `findPagesByBoardRoot` (dead in the query as well), `findPageByBoardRoot`, `getFirstRightPinnedIndex`, `moveTabByIndex`, `fixGrouping`, `openFileAsArchive`, `handleOpenUrl` and `onAppQuit`. `onAppQuit` (`PagesPersistenceModel.ts:519-526`) is superseded by `api/internal/save-window-state.ts`, which reimplements the same steps.
- **Refactor:** Pick one surface.
  - **Recommended:** keep the submodels as the API grouping (`pages.query`, `pages.layout`, …) and delete the flat delegates. Make every state write go through CORE-1's mutation primitives on `PagesModel`.
  - Rename the Layer-1 entry to `pages.openPath(path)`, or move it to `app.openRawLink`, which already exists (`app.ts:63-67`).
  - Delete the `pagesModel` alias with a mechanical import rewrite.
  - Remove the dead delegates and `PagesPersistenceModel.onAppQuit`.
  - Update `pages-architecture.md` §4.
- **Risk / notes:** This is mechanical but touches about 120 files. `PageCollectionWrapper` (scripting) is the public script façade, so script compatibility is unaffected.

### CORE-7: `settings.ts`: each setting is defined in four to six places; feature logic and side effects live in the store

- **Priority:** P2
- **Effort:** M
- **Where:** `src/renderer/api/settings.ts:15-16,36-86,126-178,185-237,242-276,294-348,365-373,408-419,455,463-511`; `src/renderer/api/app.ts:303-337,362-394`; `src/renderer/api/ui-preferences.ts`; 39 `settings.onChanged.subscribe` call sites
- **Problem:**
  - **One key, four to six places.** For example, `voice-typing.shortcut`:
    - the `AppSettingsKey` union (79);
    - `settingsComments` (170);
    - the defaults (229);
    - normalisation in `set` (410), with the "Alt+V" default repeated;
    - normalisation in `loadSettings` (473), with the default repeated again.

    A key added to the union without a default compiles fine, because `get` falls back to the generic overload.
  - **Feature logic inside the store:**
    - microphone notch validation (242-257);
    - publishing microphone settings over raw `require("electron").ipcRenderer` (368-373, 418, 500), importing `ui/speech` types (15);
    - theme application on every load (497);
    - editor-category normalisation plus the legacy `pinned-editors`/`draw-view` migration (294-348, 483-495);
    - deleting the old `voice-assistant.*` keys (481).
  - **Two places actuate settings:**
    - `settings.ts` itself handles the microphone and the theme.
    - `app.ts` handles MCP, Mneme, clipboard, main scripting, Windows SSO and capability preferences.
    - `app.ts` duplicates each actuation for startup (305-337) and for change (362-393). For example, the "start MCP and notify on failure" block appears at 311-316 and again at 370-375.
    - The `loadSettings` comment points to `App.initServices` (455), but the code lives in `initEvents`.
  - **Every consumer filters keys by hand.** Each of the 39 subscribers writes `({ key }) => { if (key === …) }`, with an untyped `value: unknown`.
  - **UI state is split across two stores.** Popover size (`editor-categories-popover-size`), MRU lists (`tab-recent-languages`, `browser-search-engine`) and other "maintained automatically" UI state live in `appSettings.json`. Sidebar width, the git-tree layout and the translate target live in `uiPreferences` (`api/ui-preferences.ts`, IPC-backed).
- **Refactor:**
  1. **`api/settings-schema.ts`.** One table: `defineSetting<K>(key, { default, comment, normalize?, migrate? })`. Derive `AppSettingsKey` and the value types from it. `Settings` iterates the table for defaults, comments, normalisation (one place, used by both `set` and `load`) and migrations. Feature normalisers (microphone, voice typing, clipboard, capability preferences, editor categories) live next to their feature and are referenced from the table.
  2. **`settings.watch(key, (value) => …)`.** A typed per-key subscription that replaces the hand filters; keep `onChanged` for "any key".
  3. **`api/settings-effects.ts`.** A table of `{ key(s), apply(value, { initial }) }` for MCP, Mneme, clipboard, main scripting, SSO, capability preferences, microphone publish and theme. It runs once at startup and on each change, replacing both copies in `app.ts:305-393` and the side effects inside `Settings`.
  4. **Decide the rule:** user-meaningful configuration goes in `appSettings.json`, window and UI geometry and MRU go in `uiPreferences`. Move `editor-categories-popover-size` (and probably `tab-recent-languages`) accordingly, with a one-time migration.
- **Risk / notes:** Startup ordering is the subtle part: the initial load must not emit, and startup actuation runs after `settings.wait()` (comment at 448-462). The effects table encodes this with `{ initial: true }`. The file header and comments are user-facing, so generate the same text. Interacts with CORE-8 and CORE-9.

### CORE-8: App bootstrap uses a service registry for half of startup and ad-hoc imports for the rest

- **Priority:** P2
- **Effort:** S
- **Where:** `src/renderer/api/app.ts:35,106-168,193-215,236-402`; `src/renderer/api/app-service-registry.ts:31-107`
- **Problem:** `app-service-registry.ts` is a well-typed table, with compile-time completeness, of `{ key, load, initialize }`. Next to it, `App` initialises 14 more modules by hand, each with its own error handling:
  - `ui-preferences`, `module-service-status`, `custom-theme-storage`, `published-boards`, `board-install-registry` and `registered-tools` (133-167);
  - `board-service-settings` and `mcp-handler` (203-209);
  - `site-extension-trust-sync`, `board-navigation-return`, `scripting/ai-vision/alert-watch`, the four content registrations and `editors/board/board-pipe-handler` (240-265);
  - `mneme-status`, `mneme-connection` and `autoload-service` inside a 1.5 s `setTimeout` (310-357).

  Other problems:
  - `initMcpHandler()` is called in both `initPages` (209) and `initEvents` (299).
  - `_pages` is typed with `undefined as unknown as PagesModel` (35).
  - The settings actuation discussed in CORE-7 makes up half of `initEvents`.
  - It is not visible anywhere which phase a module needs.
- **Refactor:**
  - Extend the descriptor table with a phase: `{ key?, phase: "services" | "pages" | "events" | "deferred", init(): Promise<void> | void, background?: true }`. `App.init*` then just runs its phase and reports failures uniformly (reusing `_serviceFailures`/`_reportBackgroundFailure`).
  - Initialise MCP once.
  - Make `pages` a normal descriptor that `initPages` awaits.
  - Move settings actuation to CORE-7's effects table.
- **Risk / notes:** Ordering comments, such as "Register link pipeline handlers first … LIFO" (253-255), must turn into explicit ordering in the table, either by array order within a phase or by `after:` keys.

### CORE-9: The startup data folder and the custom-theme catalogue are implemented twice; theme state flows both ways between settings and themes

- **Priority:** P2
- **Effort:** S
- **Where:** `src/renderer/theme/themes/index.ts:31-63,110-127,202-204`; `src/renderer/i18n/startup.ts:47-56,77`; `src/renderer/api/custom-theme-storage.ts:17,37-75`; `src/renderer/api/cycle-app-theme.ts:4-8`; `src/renderer/api/settings.ts:497`; `src/renderer/api/themes.ts:119-124`; `src/main.ts:13-17`
- **Problem:**
  - **Hard-coded data folder.** `theme/themes/index.ts` and `i18n/startup.ts` both read `%APPDATA%/persephone/data/appSettings.json` (and the themes and languages folders) synchronously at module load.
    - This ignores named profiles, which move `userData` to `%APPDATA%/persephone-profiles/<name>` (`src/main.ts:15-17`).
    - So a profile window shows the default profile's theme, custom themes, user language packs and UI language at first paint. That is a real bug that comes from the duplication.
  - **The same file is parsed two ways.** The theme strips `//` lines with a regex and calls `JSON.parse` (117-119), so any user-written JSON5 (such as trailing commas) falls back to the default theme. i18n uses `parseJSON5` and also probes a `settings.language` wrapper that does not exist (51).
  - **Custom-theme loading is implemented twice:**
    - `readCustomThemesSync` (`themes/index.ts:31-63`);
    - `custom-theme-storage.loadAll` (`custom-theme-storage.ts:37-75`).

    Both copy the validation, the safe-id regex (`themes/index.ts:74-76` and `custom-theme-storage.ts:17`) and the sort.
  - **Theme application flows two ways:**
    - `settings.loadSettings` applies the theme (497).
    - `themes.apply` applies it and then writes settings (119-124).
    - `cycle-app-theme.ts` exists only to break the resulting import cycle (its own comment, 4-8).
  - **Hidden side effects on import:** `themes/index.ts:202-204` installs CSS variables and applies a theme when the module is imported.
- **Refactor:**
  1. **`core/startup-environment.ts`, or `api/startup-environment.ts`.** It resolves `userDataDir` synchronously, either from a new `--persephone-user-data=` argument (main already passes `--persephone-languages-dir=` and the profile name) or from the profile name. It reads `appSettings.json` once with `parseJSON5` and exposes `startupSettings`. Both the theme and i18n startup use it.
  2. **`CustomThemeCatalog`.** One loader with `loadSync()` (first paint) and `load()` (watcher), sharing validation, safe-id rules and sort. `theme/themes` owns only the in-memory registry and apply/preview.
  3. **`ThemeService`.** It owns registry apply and preview and subscribes to `settings.watch("theme")` (CORE-7). `themes.apply`, the keyboard cycle and the board cycle only write the setting. Remove `applyThemePreservingPreview` from `settings.ts` and delete `cycle-app-theme.ts`.
  4. Make the module-load side effects an explicit `installThemeAtStartup()` called from `renderer.ts`.
- **Risk / notes:** First-paint latency: keep the synchronous read. Check that `renderer.ts` currently relies on the import side effect.

### CORE-10: Copy-pasted codecs and parallel lists that have already drifted

- **Priority:** P2
- **Effort:** S
- **Where:** `src/renderer/api/fs.ts:4-6,60-198`; `src/renderer/content/encoding.ts:29-108`; `src/renderer/content/builtin-schemes.ts:17-37`; `src/renderer/content/folder-editor-link.ts:35-46`; `src/renderer/api/languages.ts:2-19,87-106`; `src/shared/i18n/en/index.ts:24-46`; `src/renderer/api/languages.ts:81-84`; `src/renderer/api/custom-theme-storage.ts:111-116`
- **Problem:**
  - **The text codec exists twice.**
    - `fs._decodeBuffer`/`_encodeString` (`fs.ts:66-198`) are line-for-line the same as `content/encoding.ts` `decodeBuffer`/`encodeString`.
    - `encoding.ts` says it was "Extracted from fs.ts" (line 4), but the original copy was never removed.
    - They already differ: `fs.ts` logs the decode and encode fallbacks, while `encoding.ts` swallows them.
  - **`decodeFolderEditorLink` exists twice:** in `builtin-schemes.ts:17-37` and in `folder-editor-link.ts:35-46`.
  - **The language API's catalogue list has drifted.** `languages.ts:87-106` hand-lists 18 English entry catalogues, while `englishCatalog` has 21 areas (`shared/i18n/en/index.ts:24-46`). For the `voiceTyping`, `transcript` and `translation` areas, `languages.english()` therefore returns entries with **no translator notes** (`languages.ts:220`). That is the agent-facing translation API losing context.
  - **Atomic JSON write** is implemented twice: `writeLanguagePackAtomically` and `writeAtomically`.
- **Refactor:**
  - `fs.ts` imports `decodeBuffer`/`encodeString` from `content/encoding.ts`, or better from a new `core/utils/text-encoding.ts`, since `fs` sits below `content`. Delete the private copies.
  - `builtin-schemes.ts` imports `decodeFolderEditorLink`.
  - `shared/i18n/en/index.ts` exports `englishEntryCatalogs` (the `{ area: catalog }` record), and both `englishCatalog` and `languages.ts` derive from it.
  - Add `fs.writeJsonAtomic(path, value)`.
- **Risk / notes:** None of note. Pure deduplication; the i18n change fixes the missing translator notes.

### CORE-11: Layer 2 resolvers carry out non-content actions themselves, which is why the `phase` flag exists; `content/` also holds UI menus

- **Priority:** P2
- **Effort:** M
- **Where:** `src/renderer/content/resolvers.ts:19-39`; `src/renderer/content/builtin-schemes.ts:95-175,193-232,297-397`; `src/renderer/content/scheme-registry.ts:10-17`; `src/renderer/content/open-handler.ts`; `src/renderer/content/tree-context-menus.ts`; `src/renderer/content/open-with-editor.ts`; `doc/architecture/content-pipeline.md:125-132`
- **Problem:** The pipeline is "Parsers set `url` → Resolvers set `pipe`/`target` → Open handler opens". For content this holds. For everything else, Layer 2 carries out the action itself:
  - it opens folder pages via `pagesModel` (`resolvers.ts:31-39`);
  - it opens browser tabs through `openLinkInBrowser` (`builtin-schemes.ts:95-136`), duck-typing `(editor as any).navigate/addTab` (103-109);
  - it launches external apps after checking board trust, appending to the board log over IPC and showing a confirmation dialog (138-175);
  - it invokes the `http.request.open` capability and maps capability errors to toasts (304-329);
  - it runs `image.edit` (208-218).

  Because resolvers have side effects, the same hooks also used for pure pipe reconstruction (`rebuild-pipe.ts`) need `context.phase === "source-path"` guards scattered through them (197, 210, 220, 257, 298). Each fallback handler also re-implements the `handled = false; await next.sendAsync(); handled = true` hand-off that `context.handoff()` already provides (`parsers.ts:26-28,41-43,65-67`, `resolvers.ts:50-52,62-64`). In addition, `content/` holds context-menu builders with icons (`tree-context-menus.ts`, `open-with-editor.ts`), which are UI. The behaviour is documented (`content-pipeline.md:125-132`), but it makes Layer 2 the busiest UI-side module in the pipeline.
- **Refactor:**
  1. Add a typed outcome to `ILinkData`: `data.action?: { kind: "content" } | { kind: "browser"; mode } | { kind: "external" } | { kind: "folder-page"; path } | { kind: "capability"; id; payload }`. Resolvers only classify and set the action (and `pipe` for content), then hand off.
  2. Layer 3 `open-handler.ts` dispatches through a small table, `content/open-actions/{browser,external,folder,capability}.ts`, which is allowed to depend on `api/pages`, trust and dialogs. With no side effects left in Layer 2, the `source-path` phase needs no guards: it just ignores any action other than content.
  3. Use `context.handoff()`, or a shared `handOff(data, next)` helper, for the two fallback handlers.
  4. Move the menu builders out of `content/` (CORE-3 step 5).
- **Risk / notes:** Scripts can subscribe to `openLink`/`openContent` and must still see the same events. The action field is additive and has to be stripped in `cleanForStorage`. Coordinate with the boards and capabilities reviewer, since the board-trust external-launch rule moves.

### CORE-12: `audio-window.ts` is a 496-line procedural module of module-level maps and duplicated wire constants

- **Priority:** P2
- **Effort:** M
- **Where:** `src/renderer/audio/audio-window.ts:1-18,55-101,476-484`; `src/main/audio-service.ts:18-19`; `src/ipc/audio-channels.ts`; `src/ipc/capability-bus-channels.ts:6-17`; `src/shared/capability-contract.ts`
- **Problem:** This recent code (US-1790..US-1798) handles four concerns in one file through top-level `ipcRenderer.on(...)` handlers and module state (`sources`, `channels`, `sharedContext`, `microphoneSettings`, `deviceChangeTimer`, 55-74):
  - shared capture-source pooling with reference counts, restarts and per-device cleaning;
  - playback scheduling;
  - device enumeration;
  - the IPC channel protocol.

  The file also has these problems:
  - **Duplicated channel names.** Five channel names are declared locally (13-17), and `src/main/audio-service.ts:18-19` declares the same strings again, even though `src/ipc/audio-channels.ts` exists for exactly this purpose.
  - **Hard-coded error codes.** The 13 client error codes are a literal array (481), which is the fourth copy in the codebase (also `ipc/main/core-handlers.ts:75`, `main/capability-router.ts:46` and `main/module-service-supervisor.ts:742`).
  - **Imports from `ui/`.** It imports the DSP classes from `ui/speech/*` (3-10), so a separate window entry depends on the main window's UI folder.
- **Refactor:**
  - Split the file:
    - `audio/CaptureSourcePool.ts`: a class that owns `sources`, acquire/release/restart and the settings and devicechange reactions.
    - `audio/PlaybackChannel.ts`: a class per play channel that owns `PlaybackState` and the schedule/finish logic.
    - `audio/audio-window.ts`: a thin host that wires IPC to the two classes.
  - Move all `persephone:audio-*` names into `ipc/audio-channels.ts`.
  - Export `CLIENT_CAPABILITY_ERROR_CODES` and `isClientCapabilityErrorCode` from `shared/capability-contract.ts`, and use them here and in the three main-process copies.
  - Move the DSP classes (`PcmAudioCapture`, `ComputerAudioGate`, `LoopbackReference`, the microphone-cleaning types) to `src/renderer/audio/dsp/`, since both the audio window and the speech UI use them.
- **Risk / notes:** Real-time audio; keep the ordering of the "channel-ready" handshake (comment at 461). The work is a pure reorganisation with no change to the algorithm.

### CORE-13: Dead code, re-export shims and dead barrels in `core/`

- **Priority:** P3
- **Effort:** S
- **Where:** `src/renderer/core/utils/obj-path.ts` (138 lines); `core/utils/memorize.ts`; `core/utils/audio.ts`; `core/utils/utils.ts:5,16,38-44`; `core/utils/path-utils.ts:162-181`; `core/index.ts`; `core/state/index.ts`; `core/utils/index.ts`; `core/utils/format-bytes.ts`; `core/utils/debounce.ts`; `core/utils/types.ts`; `core/utils/curl-parser.ts`; `core/utils/html-resources.ts`
- **Problem:**
  - **No importers:** `obj-path.ts`, `memorize.ts`, `audio.ts` (`beep`), `isNullOrUndefined`, `range`, `isLocalLink`, `resolveRelativePath`, the `core/index.ts` barrel and the `core/state/index.ts` barrel.
  - **Barrel with only two importers:** `core/utils/index.ts` (`components/icons/language-icon-resolver.ts:6-9` and `editors/text/TextFileIOModel.ts:7`). It is the only thing keeping several of the dead modules "used".
  - **One-line re-export shims:** `format-bytes.ts` and `debounce.ts`.
  - **Two different `formatDate` functions:** `utils.ts:38` (ISO → YYYY-MM-DD) and `format.ts:67` (locale-aware).
  - **Mixed `types.ts`:** it holds both a Monaco type and a notification type.
  - **Domain parsers in core:** `curl-parser.ts` (HTTP request parsing for the content pipeline) and `html-resources.ts` (browser resource extraction).
- **Refactor:**
  - Delete the dead modules and members and the three barrels. Rewrite the two barrel imports to direct paths, as the coding style asks.
  - Inline the two shims at their importers.
  - Rename `utils.ts:formatDate` to `formatIsoDate`, or delete it if it has no importer.
  - Move `curl-parser.ts` to `content/` and `html-resources.ts` to `editors/browser/`.
  - Split `types.ts` into `language-mapping.ts` (MonacoLanguage) and `uikit/Notification` (TMessageType).
- **Risk / notes:** Confirm with a project-wide grep including `assets/` script typings before deleting. `obj-path` might be referenced from script typings; none was found in `src/`.

### CORE-14: Events: three layers for one primitive, app broadcasts stored in `core`, and three state class names used inconsistently

- **Priority:** P3
- **Effort:** S
- **Where:** `src/renderer/core/state/events.ts:5-65`; `src/renderer/core/state/listener-list.ts`; `src/renderer/api/internal.ts:8-14`; `src/renderer/core/state/state.ts:117-122`; `doc/architecture/state-management.md:18-19,387-423`
- **Problem:**
  - **Three layers:** `Subscription` wraps `Emitter`, which wraps `ListenerList`. `Emitter` has no user other than `Subscription`.
  - **`wrapSubscription` exists for one caller** (`settings.onChanged`), only to hide `send`.
  - **App-domain globals in `core/state/events.ts`:** `globalKeyDown`, `browserUrlChanged` (which has its own `handled` flag, the same as `EventChannel` semantics), `windowClosing`, `secondaryViewsToggled` and `panelExpanded`. They are module-level singletons sitting in the "foundation" layer.
  - **Three names for identical classes.** `TGlobalState` and `TComponentState` are documented as "intent markers", but use is inconsistent:
    - `PageModel.state`, `MenuBarModel` and `window.ts` use plain `TOneState` for app-wide state;
    - `Settings`, `PagesModel` and `recent` use `TGlobalState`.
  - **The result:** a reader cannot tell which event or state type to pick.
- **Refactor:**
  - Fold `Emitter` into `Subscription` (one class over `ListenerList`). Make `Subscription` expose a read-only `event` view (`{ subscribe }`) so `wrapSubscription` can go.
  - Move the five broadcasts to `api/events/renderer-broadcasts.ts` next to `AppEvents`.
  - Either drop `TGlobalState` and `TComponentState` (one `TOneState`; intent shown by where it lives), or apply them consistently. Dropping is cheaper and the documentation already calls them markers.
  - Update `state-management.md`.
- **Risk / notes:** Mechanical. The `TGlobalState`/`TComponentState` rename touches about 110 sites, so do it in one sweep or not at all.

### CORE-15: `fs.ts` mixes the script filesystem API with app data stores, cache protection, dialogs and shell actions

- **Priority:** P3
- **Effort:** S
- **Where:** `src/renderer/api/fs.ts:1-2,15-32,495-542,544-675`; `doc/standards/coding-style.md:289-312`
- **Problem:** `FileSystem` (678 lines) is several things at once:
  - the public `IFileSystem` script surface;
  - the app's data-file store (`getDataFile`/`saveDataFile`/`prepareDataFile`, 546-567);
  - the per-editor cache store (605-641) and the cache-misc store (645-660);
  - a reference-counted cache-protection set that exists only for page recovery (571-595, used by `PagesPersistenceModel`/`PageModel`);
  - OS dialogs (495-532) and shell actions (536-542);
  - the codec copy from CORE-10.

  It also uses `require("path")` (line 1), against the file-path rule in `coding-style.md:289`, which lists `fs.ts` as an exception only for `fs`. Window index and user data are fetched both here and in `window.ts`.
- **Refactor:**
  - Keep `FileSystem` as the `IFileSystem` façade. Extract `api/app-data-store.ts` (data and cache-misc files) and `api/editor-cache-store.ts` (cache files plus the protection set), which page persistence and editors import directly.
  - The dialog and shell members delegate to `api/shell`.
  - Switch the path calls to `file-path` helpers.
- **Risk / notes:** The cache store is safety-critical: the protection set prevents a recovery page's cache from being deleted. Move it verbatim. Do this after CORE-2, which defines who owns cache protection.

### CORE-16: Stale comments and migration markers that point readers at code that no longer exists

- **Priority:** P3
- **Effort:** S
- **Where:**
  - `src/renderer/api/window.ts:9-24,26-31,61-81,147`
  - `src/renderer/api/pages/PagesLifecycleModel.ts:1030-1034,1261-1275`
  - "Walkthrough NN / XX" comments (16 in `src/renderer/api`)
  - "legacy" wording in `api/pages` (29, mostly for the live `TextFileModel` host)
  - `src/renderer/api/settings.ts:455`
  - `src/renderer/api/pages/PageModel.ts:86-88`
  - `doc/architecture/pages-architecture.md:354,385,412`
- **Problem:**
  - **`window.ts`:**
    - The `signalReadyToQuit()` doc block describes "The boolean carries the close-behavior policy … `false` means hide me", but the function takes no argument; `resolveWindowClose` decides now.
    - `Window` also holds MCP server status (`mcpRunning`, `mcpClientCount`, `inAppAgentCount`, 26-31 and 61-81), which is not a window concern.
    - `openMenuBar` calls `menuBar.openLegacy` (147).
  - **Migration-era tags.** "Walkthrough 05 / M2", "CK7" and similar tags reference a migration plan that is no longer in the repo.
  - **`hasSidebar` in state** is "Kept for backward compat with existing UI".
  - **The pages documentation is out of date.** The lifecycle table (354) and the delegate count (385) are wrong, and §5 documents the dead `openFileAsArchive` (412).
- **Refactor:**
  - Rewrite the `signalReadyToQuit` doc.
  - Move the MCP status state to `api/mcp-status.ts` (the header indicator reads it), next to `mneme-status.ts`.
  - Replace the walkthrough tags with one-line "why" comments or delete them.
  - Rename "legacy" variables to `textHost`.
  - Fix the three doc sections as part of CORE-1 and CORE-6.
- **Risk / notes:** None of note.

## Cross-area notes

- **Capabilities / main process.** The 13-code client error list is copied in `ipc/main/core-handlers.ts:75`, `main/capability-router.ts:46` and `main/module-service-supervisor.ts:742`, beside the audio window (CORE-12). Meanwhile `ipc/capability-bus-channels.ts:6-17` exports a 10-code `CAPABILITY_ERROR_CODES` with the same type name, `CapabilityErrorCode`, as `shared/capability-contract.ts`. There are two different unions under one name.
- **Editors / boards.**
  - The merged file→editor resolver `resolveEditorIdForFile` lives in `editors/board/custom-editor-registry.ts`, yet `content/` and `api/pages` depend on it, which makes the board module a dependency of the core open path. It belongs in `editors/base/editor-resolution.ts`, with boards registering as a source.
  - `customEditorRegistry` lacks `findByRoot(root)` (14 inline copies, CORE-1).
  - Board construction should be a module hook (CORE-1 step 1, CORE-5).
- **`uikit`.**
  - `uikit/TagsInput/TagsInputView.ts:5` imports `core/utils/guard`, which reaches `api/ui` and `ui/dialogs`.
  - `uikit/Notification/AlertsBar.ts:106` and `uikit/Progress/progressModel` hold app-global singletons (alerts, progress, screen locks), which `api/ui.ts` drives. The store should live in `api/ui` and the uikit view should receive it.
- **Scripting.** `PageCollectionWrapper.navigatePageTo` (`scripting/api-wrapper/PageCollectionWrapper.ts:261-272`) goes straight to `PagesModel.navigatePageTo`, bypassing Layers 1–2, so script navigation to an HTTP URL or a registered scheme does not get the pipeline's routing. `PageWrapper.ts:67` redeclares `EditorOrHost`.
- **Build config.** `tsconfig.json` has no `strict`/`strictNullChecks`. That hides latent dereferences such as `PagesLifecycleModel.ts:735` and is partly why `as unknown as` and optional chaining are so common. Turning on `strictNullChecks` per folder (through a `tsconfig.strict.json` that includes `src/renderer/core` and `src/renderer/content` first) would be a cheap way to tighten contracts.
- **`api/node-fetch.ts`** (the boards/network reviewer's area). It carries `BoardNetworkPolicy` (77) and board permission enforcement inside the generic `app.fetch` path, and `doFetch` takes 10 positional parameters (144-155). A `FetchRequest` object and a board-policy wrapper would separate the concerns.
- **`api/internal/save-window-state.ts`** reimplements `PagesPersistenceModel.onAppQuit` (CORE-6). Whoever reviews `internal/` should delete one of them.

## Keep

- **`core/state/dispatch.ts`, `TOneState` and `ListenerList`.** A small, well-documented dispatch boundary (`afterDispatch`, listener retirement during dispatch, error isolation). This is the right foundation.
- **`DisposableStore`, `OwnerScheduler` and `TModel.own()/schedule`.** A consistent ownership model for lifetimes and timers.
- **`app-service-registry.ts`.** A typed descriptor table with a compile-time completeness check (`_AllAppServicesRegistered`). Extend this pattern to the rest of bootstrap (CORE-8) and to settings (CORE-7).
- **The content pipe and registries:** `ContentPipe`, `registry.ts` (provider ownership and shape validation) and `scheme-registry.ts` (an `OwnershipRegistry` per scheme, with handoff context). These are clean extension seams.
- **`PageNavigator.ts` named steps and `browser-pages.ts` / `editor-switch.ts` / `page-explorer.ts` extractions.** These are the right pattern for shrinking the page classes: the page or lifecycle keeps a one-line delegate and the feature module owns the logic. CORE-1 and CORE-2 should follow it.
- **`PagesPersistenceModel` save gating** (`restored` flag with a re-scheduling `debounce` `canRun`). It is well-reasoned and documented.
- **`EventChannel`.** A clear sync-FIFO versus async-LIFO pipeline contract that suits the link pipeline.
