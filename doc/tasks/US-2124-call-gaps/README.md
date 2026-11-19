# US-2124: Call gaps

Epic: [EPIC-199](../../epics/EPIC-199.md)

## Goal

Make the call surface able to open a folder through its normal Explorer navigation, save the current page through its own Ctrl+S behavior, and record the required approval item for preserving error codes across namespaces.

## Background

The repeated folder-open failures are confirmed in the feedback entries EPIC-188 / US-2072 and US-2074, and EPIC-191 / US-2094 in [the feedback log](../../reviews/ai-vision-feedback.md): `pages.openFile(folder)` creates an editorless workspace page; Folder View, Git Tree and folder-claim routing are selected when an Explorer row is navigated. `FileTreeProvider.getNavigationUrl(item)` is the row's routing decision point; `ExplorerEditorModel` and `CategoryEditorModel` send its URL through `app.events.openRawLink`. Factor the folder target selection used by `getNavigationUrl(item)` into a shared `FileTreeProvider.getFolderNavigationUrl(folderPath)` helper and use it from the new call member. Leave `getNavigationUrlByHref(href)` unchanged because it retains generic category routing under `ITreeProvider` (`src/renderer/api/types/io.tree.d.ts:41`). `PagesModel.openPath` feeds a routed link to the existing open pipeline and returns the resulting page, including editorless folder pages.

For saves, text-page Ctrl+S is handled by `TextPageKeymap.handleKeyDown` in `src/renderer/editors/base/TextPageKeymap.ts` and calls `host.saveFile(event.shiftKey)`. Board-frame Ctrl+S is `src/board-shim/frame-behaviours.ts:16-20` -> `content.save` -> `src/renderer/editors/board/frame/board-host-router.ts:355-360` -> `ContentHostBridge.saveContent()` in `src/renderer/editors/board/frame/content-host-bridge.ts:53-55` -> `model.saveBoardContent()`. `BoardContentEditorModel.contentHost` returns its content-host slot (`src/renderer/editors/board/BoardContentEditorModel.ts:53-55`), and its `saveBoardContent()` calls that host's `saveFile()`; the base `BoardEditorModel.saveBoardContent()` is a no-op. Thus page-level save for pages that can save is `mainEditor.contentHost.saveFile(false)`, not the close-time `persephone.onSaveRequest` / `BoardFrameChrome.saveRequest` path in `BoardEditorModel.confirmRelease`. `TextFileIOModel.saveFile` is declared `Promise<boolean>` at `src/renderer/editors/content-host/TextFileIOModel.ts:109`, and `TextFileModel.saveFile` forwards to it at `src/renderer/editors/content-host/TextFileModel.ts:325`. With no writable path, it opens Save As; cancellation returns `false`. The save regressions are feedback entries EPIC-192 / US-2097 and US-2098, and EPIC-194 / US-2104. Existing save cases are in `integration-test/tests/boards/excalidraw/excalidraw.test.mjs`, `integration-test/tests/boards/rest-client/rest-client.test.mjs`, and `integration-test/tests/published-boards/todo/todo.test.mjs` / `notebook/notebook.test.mjs`.

For error codes, `node_modules/ai-vision/dist/core/resolver.js` catches thrown methods and constructs resolver errors with `errMessage(error)`, while `dist/core/errors.js` returns only the message. Its `ICallResult.error` type is `string`. `src/main/mcp/tools/call-tools.ts`'s `toCallResult` receives that string and formats it as text; it cannot recover a code already dropped by the resolver. Feedback entry EPIC-198 / US-2120 documents the capability-only workaround in `src/renderer/scripting/ai-vision/namespaces/capabilities.ts`, which appends `[code: <code>]` before throwing. `AppWrapper.call` and the MCP renderer call both invoke `ai-vision.resolveCall`, but no shared call-tree error adapter currently intercepts thrown errors before that resolver catch. Every namespace therefore cannot be covered from `toCallResult`; a resolver envelope change in `ai-vision` is the remaining open approval item.

## Implementation Plan

- [x] In `src/renderer/content/tree-providers/FileTreeProvider.ts`, factor folder-target selection into `getFolderNavigationUrl(folderPath)` and call it from both `getNavigationUrl(item)` and the new direct-folder API. Preserve `isParentRow` behavior for the `..` row; resolve other folder targets through existing `editorCatalog.resolveFolder` and `folderEditorLinkFor` helpers, preserving Folder View, Git Tree, Mneme and board routes. Do not alter `getNavigationUrlByHref(href)` or the `ITreeProvider` contract. In `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts`, add `openFolder(folderPath: string)`: validate with `FileTreeProvider.stat`, throw a clear error naming `pages.openFile` for a non-directory, get the folder URL from a provider rooted at the folder's parent, and open it through `PagesModel.openPath` and the existing pipeline before wrapping its `PageModel`. Keep the existing hand-written `openFile` describe return type and give `openFolder(folderPath: string) → Page | undefined` the same call-result type as `openFile` (the resolved page summary, not a Promise). Document the non-directory error naming `pages.openFile` and successful return behavior in `PAGES_HELP`. Keep the script declaration `openFolder(folderPath: string): Promise<IPage | undefined>` in `src/renderer/api/types/pages.d.ts`.
- [x] In `src/renderer/scripting/api-wrapper/PageWrapper.ts`, add `save(): Promise<boolean>` to `PAGE_MEMBERS` with the hand-written describe signature `save() → boolean` and matching `PAGE_HELP`. Call the current main editor's `contentHost?.saveFile(false)` and return its result. If there is no content host, throw a clear error that the page has no file content to save. State that saving an untitled page opens the Save As dialog and the call returns dialog attention while it waits for the user's choice. `TextFileIOModel.saveFile` returns `Promise<boolean>` (`src/renderer/editors/content-host/TextFileIOModel.ts:109`), so the script declaration is `save(): Promise<boolean>` on `IPage` in `src/renderer/api/types/page.d.ts`. No `EditorModel` save hook, `BoardSaveController`, or `BoardEditorModel` change is needed.
- [x] Update the actual script/API guides that list these surfaces: `assets/guides/scripting/api/pages.md` and `assets/guides/agents/pages.md` for folder opening; `assets/guides/scripting/api/page.md` and `assets/guides/agents/pages.md` for page saving; `assets/guides/agents/boards/folder-editor.md` to replace the Explorer-only call workaround with the new member. English UI catalogs need no changes because these are API/help additions, not UI text.
- [x] Error-code investigation result: no shared Persephone-side catch exists before `ai-vision.resolveCall`; `toCallResult` receives only a string error. Leave Persephone source unchanged for codes and record the resolver error-envelope change in `ai-vision` as a user-approval open item. Do not edit `node_modules/ai-vision`, change/publish/bump its package, or copy the capability-specific `[code: ...]` wrapper into namespaces.
- [x] Add integration tests in the existing owner modules: `integration-test/tests/editors/folder/folder-view.test.mjs` for Folder View routing; `integration-test/tests/tools/git/git-tree.test.mjs` for `.git` routing, with the new Git-dependent case tagged `requires: ["git"]` (existing Git Tree cases declare this requirement); and `integration-test/tests/boards/extensions/editors.test.mjs` for a claimed folder. For page saving, replace the Monaco-switch/`saveFile()` workarounds in `integration-test/tests/boards/excalidraw/excalidraw.test.mjs`, `integration-test/tests/boards/rest-client/rest-client.test.mjs`, `integration-test/tests/published-boards/todo/todo.test.mjs`, and `integration-test/tests/published-boards/notebook/notebook.test.mjs` with `page.save()`, retaining every existing saved-file read and content assertion. Add a negative case in `integration-test/tests/editors/folder/folder-view.test.mjs` that calls `save()` on an editorless workspace page and asserts the clear no-file-content error. Claude runs integration tests. Do not add unit tests or a harness, run the app, or invoke the integration runner.

### Before → after API examples

```text
Before: pages.openFile(folderPath) returns a workspace page with no editor.
After:  pages.openFolder(folderPath) → Page | undefined returns the same resolved page summary as openFile.
        It throws for a non-directory and names pages.openFile for opening files.

Before: pages[pageId].editorSwitches.switchTo("monaco"); pages[pageId].editor.saveFile()
After:  pages[pageId].save() → boolean over call (Promise<boolean> in the script API).
```

## Concerns / Open questions

- Every-namespace coded errors require a change to `ai-vision`'s resolver error envelope to carry `code` from the thrown error into the envelope, followed by a release. The package belongs to the user; this remains an open item awaiting approval, with no Persephone error-code change in this task.

## Acceptance Criteria

- [x] The call API can open a folder in the same editor/navigation behavior used by an Explorer row; a non-directory throws an error naming `pages.openFile`, and a successful call returns the same page summary as `openFile`.
- [x] `pages.openFolder(folderPath) → Page | undefined` is present in `app.pages` types, its hand-written call-tree describe/help, and the listed guides; direct folder routing matches ordinary Explorer, `.git`, and board-claim routes without changing `getNavigationUrlByHref` semantics. For a non-directory it throws an error naming `pages.openFile`; on success it returns the same resolved page summary as `openFile`.
- [x] `pages[pageId].save() → boolean` is present in `IPage`, its hand-written call-tree describe/help, and the listed guides; it calls `contentHost.saveFile(false)`, returns the existing boolean result, explains Save As/dialog attention for untitled pages, and throws a clear error when there is no file content to save.
- [x] No Persephone-only code fix is planned: `toCallResult` sees only `ICallResult.error: string`; the required package error-envelope change is recorded for user approval.
- [x] Integration coverage is specified in exact existing modules for both new call members; Claude runs it.
- [x] No unit tests, test harnesses, or changes outside this task document are part of this task.

## Files that do not need changes

| File / area | Reason |
|-------------|--------|
| `src/main/mcp/tools/call-tools.ts` | `toCallResult` receives resolver errors as strings and cannot restore a code already lost upstream. |
| `node_modules/ai-vision/**` | Package changes and releases require the user's approval. |
| `src/shared/board/**` and board registries | Folder routing reuses `FileTreeProvider` and existing `editorCatalog` rules; no new board rule is needed. |
| `src/shared/board-bridge-version.ts` | The planned members are `app.pages`/page-wrapper surfaces, not a `window.persephone` bridge change. |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` `getNavigationUrlByHref` and `src/renderer/api/types/io.tree.d.ts` | Keep the stored-href/category-routing contract unchanged; use a separate shared folder-target helper. |
| `src/renderer/editors/base/EditorModel.ts`, `src/renderer/editors/board/BoardEditorModel.ts`, and `src/renderer/editors/board/model/BoardSaveController.ts` | `PageWrapper.save()` directly uses the current `contentHost.saveFile(false)` path; close-time board save handling is out of scope. |
| `doc/reviews/refactoring-roadmap.md` | No roadmap god file needs to grow. |
| `src/shared/i18n/en/**` and `assets/languages/**` | The planned API/help additions add no English UI catalog strings. |
| `C:/projects/persephone-boards/**` | Read-only checkout; no changes are planned. |
| Unit-test directories / harnesses | The project does not use unit tests; integration tests are the specified coverage. |

## Files Changed Summary

| File | Planned change |
|------|----------------|
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | Factor Explorer-row folder-target selection into `getFolderNavigationUrl(folderPath)` and reuse it for direct folder opens; preserve `getNavigationUrlByHref`. |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Add `openFolder`, hand-written AiVision descriptor, and help. |
| `src/renderer/api/types/pages.d.ts` | Declare script-facing `openFolder`. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Add page-level `save`, hand-written AiVision descriptor, and help. |
| `src/renderer/api/types/page.d.ts` | Declare `IPage.save`. |
| `assets/guides/scripting/api/pages.md` | Document `app.pages.openFolder`. |
| `assets/guides/agents/pages.md` | Document folder opening and page saving call paths. |
| `assets/guides/scripting/api/page.md` | Document `page.save()`. |
| `assets/guides/agents/boards/folder-editor.md` | Document direct folder open call. |
| `integration-test/tests/editors/folder/folder-view.test.mjs` | Exercise `pages.openFolder` for Folder View and assert the no-file-content error when saving an editorless workspace page. |
| `integration-test/tests/tools/git/git-tree.test.mjs` | Exercise `pages.openFolder` for a `.git` folder in a test tagged `requires: ["git"]`. |
| `integration-test/tests/boards/extensions/editors.test.mjs` | Exercise `pages.openFolder` for a claimed folder. |
| `integration-test/tests/boards/excalidraw/excalidraw.test.mjs` | Save a board content page through `page.save()`. |
| `integration-test/tests/boards/rest-client/rest-client.test.mjs` | Save a REST Client content-host page through `page.save()`. |
| `integration-test/tests/published-boards/todo/todo.test.mjs` | Save a Todo content-host page through `page.save()`. |
| `integration-test/tests/published-boards/notebook/notebook.test.mjs` | Save a Notebook content-host page through `page.save()`. |
| `integration-test/tests/editors/text/text.test.mjs` | Exercise the default content-host page save path. |
| `doc/tasks/US-2124-call-gaps/README.md` | Planning document only; the package change remains an approval item. |
