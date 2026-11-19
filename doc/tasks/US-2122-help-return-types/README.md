# US-2122: `$help` return types and member drift

Epic: [EPIC-199](../../epics/EPIC-199.md)

## Goal

Make the AiVision `$help` describe tables state verified return types and return shapes, repair the two stale help descriptions named by EPIC-199, and keep the browser editor facade's public methods represented in its call-tree member table. Update the one verified stale script type for editor-switch options and in-repository guides that repeat these contracts; leave other script contracts and the `persephone-boards` repository unchanged.

## Background

EPIC-199 groups this work around handwritten AiVision describe-table `signature:` strings: the call tree exposed to `call` is not the script `app`, so signatures must not be generated from `src/renderer/api/types/**`. The describe tables are colocated with wrappers/facades or in `src/renderer/scripting/ai-vision/`; `createElements` supplies the Settings element/highlight surface.

Verified return contracts and owners:

- Call-tree result shaping is verified in `node_modules/ai-vision/dist/core/resolver.js:105-143,208-211` and `node_modules/ai-vision/dist/core/result-shaper.js:127-190`: the resolver awaits a called method, then uses the returned object's `aiVision.summarize()` descriptor when present; plain objects are copied with function properties omitted, and `undefined` becomes `null`. Thus page-returning methods produce the `PageWrapper.aiSummary()` fields from the `aiVision` descriptor and summary at `src/renderer/scripting/api-wrapper/PageWrapper.ts:206-214,253`, not the script `IPage` interface. The call-tree page summary has `{ kind, id, title, editor, language, filePath, modified, pinSide, pinned, active }`, optional `workspaceFolder`, and conditional workspace/no-editor `note`, browser `profileName`, `isIncognito`, `isTor`, `openedByAgent`, and permitted `url`; address the result as `pages[<id>]`.
- `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` owns `pages.openFile`, `closePage`, `addEditorPage`, and `openUrlInBrowserTab`. `openFile` and `addEditorPage` return `PageWrapper` objects and therefore call-tree page summaries; `openUrlInBrowserTab` returns a page-id string or `undefined` (serialized as `null` when absent). `closePage` returns a boolean when it settles, but a modified editor raises the unsaved-changes dialog through `TextFileActionsModel.confirmRelease()` at `src/renderer/editors/content-host/TextFileActionsModel.ts:33-35`; the MCP call can first return `{ pending: true, attention: { text } }` while that dialog is open (`src/renderer/scripting/ai-vision/attention.ts:45-70,82-102`). Answer via the listed `dialogs[index].click(button)` / `dialogs[index].cancel()` controls (`src/renderer/scripting/ai-vision/attention.ts:173-179`); a canceled close resolves to `false` (`src/renderer/api/pages/PageModel.ts:737-756`).
- `src/renderer/scripting/ai-vision/page-editor-switches.ts` owns `editorSwitches.options`; its getter maps each candidate to `{ id, label, title }`. `EditorCandidate.title` is optional, so JSON serialization can omit `title`; `src/renderer/api/types/page-editor-switches.d.ts` currently declares only `{ id, label }` and must be corrected to `title?: string`.
- `src/renderer/scripting/ai-vision/namespaces/boards.ts` owns the boards describe table. `createBoard` returns a string path, `openBoard` resolves to `null` in the call result (`void` shapes to null), `createShortcut` returns `{ linkPath: string } | null`, and `searchPublished` returns plain objects with `id`, `name`, optional `description`, `version`, optional `fileMasks`, `folderMasks`, `folderEditorMasks`, `folderEditorPriority`, `editorName`, `editorKind`, `standalone`, `minAppVersion`, required `size`, `compatible`, `installed`, optional `installedRoot`, `installedVersion`, and required `updateAvailable`; `version` is the latest catalog version. These fields are verified against `src/renderer/api/boards.ts:298-330` and `src/renderer/api/types/boards.d.ts:7-35`.
- `src/renderer/scripting/ai-vision/namespaces/settings.ts` composes the `highlight` member from `createElements`; it awaits `ui.highlightElement`, whose call result is a plain object `{ id, found, count, selector, highlighted?, error? }` (`src/renderer/api/types/ui.d.ts:140-154`, `src/renderer/api/ui.ts:143-150`).
- `src/renderer/scripting/api-wrapper/FolderViewEditorFacade.ts` owns Folder View `rootPath` and `items`; `rootPath` is a string or `null` when absent in serialized call output. The facade delegates listing to `CategoryEditorModel.listItems()`, which copies its first 200 records. The call result items are plain objects with optional `id`, required `title`, `href`, `category`, `tags`, `isDirectory`, and optional `size`, `mtime`, `imgSrc`, `hasSubDirectories`, `hasItems`, `target`, `icon` (`src/renderer/api/types/folder-view-editor.d.ts:1-15`). `FileTreeProvider.listStrict()` adds a `..` row except at provider root (`src/renderer/content/tree-providers/FileTreeProvider.ts:138-151`); its parent detection recognizes the copied fields. Other providers are not implied to have a parent row.
- `src/renderer/scripting/api-wrapper/GridEditorFacade.ts` owns the grid `rows` descriptor/getter. `rows` delegates to `GridEditor.getRows()` and is the full payload; `visibleRowCount` is the separate search/filter projection.
- `src/renderer/scripting/ai-vision/namespaces/window-screen.ts` has a stale `recording.start` signature: `src/renderer/api/types/window.d.ts` includes `hideStatusChrome?: boolean` and the help prose already documents it.
- `src/renderer/scripting/ai-vision/namespaces/proc.ts` describes `execute`. The runtime handle is a plain object from `createExecuteHandle` (`src/shared/execute-handle.ts:169-170`), so result shaping includes its `jobId` and omits function-valued members: `proc.execute(...)` over `call` returns `{ jobId: string }`, not an error or a streaming handle. Direct agents to `script.execute` for handle work, where the handle can be used inside the renderer script; do not expose its members as callable call-tree paths.
- Browser facade describe members live in `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`; its methods and the shared automation members are separately declared in `BROWSER_EDITOR_MEMBERS` and `browser-automation-members.ts`. The five EPIC-190 methods (`getText`, `getValue`, `getAttribute`, `getHtml`, `exists`) are all present in the current table.
- The EPIC-191 board service names (`requestService`, `startService`, `stopService`) are all present in current `BOARDS_MEMBERS`; every method in `IBoards` is statically listed there, so the checker can cover this namespace table too.

Feedback evidence read for this scope: EPIC-187 / US-2065 (`rows` ignores filters), EPIC-187 / US-2066 (`settings.highlight` result and call/script API distinction), EPIC-190 / US-2086 (browser methods omitted from the describe table), EPIC-191 / US-2091 and US-2094 (boards result shapes, editor switch option records), and EPIC-192 / US-2096 (published search result/version fields). EPIC-191 / US-2091 also confirms the `createShortcut` `{ linkPath }` shape. The specific log entries should remain the evidence source if the final implementation adjusts this scope.

## Implementation Plan

- [x] Update the handwritten return signatures/member summaries in their owning describe tables, using implementation contracts and the existing descriptor helpers:
  - `PageCollectionWrapper.ts`: describe `openFile` and `addEditorPage` as returning a page summary `{ kind, id, title, editor, language, filePath, modified, pinSide, pinned, active, ... }`; include optional `workspaceFolder`, conditional note/browser fields described above, and tell agents to address it as `pages[<id>]`. `openUrlInBrowserTab` returns a page-id string (or null when no id is returned). For `closePage`, state that a modified page raises the unsaved-changes dialog; the call returns dialog attention while it is open, answer through `dialogs`, and a canceled close returns `false`.
  - `page-editor-switches.ts`: document `options` as `Array<{ id: string; label: string; title?: string }>` (readonly projection in implementation), since the underlying candidate type declares `title?` and call serialization drops undefined properties. Update `src/renderer/api/types/page-editor-switches.d.ts` to include `title?: string` so the script type also matches the mapped runtime value.
  - `namespaces/boards.ts`: use `→ string` for `createBoard`, `→ null` for `openBoard`, `→ { linkPath: string } | null` for `createShortcut`, and `→ Array<{ id, name, description?, version, fileMasks?, folderMasks?, folderEditorMasks?, folderEditorPriority?, editorName?, editorKind?, standalone?, minAppVersion?, size, compatible, installed, installedRoot?, installedVersion?, updateAvailable }>` for `searchPublished`; describe `version` as the latest catalog version. These are serialized call results, not promise-wrapped script declarations.
  - `namespaces/settings.ts`: retain `createElements` for shared element behavior, then override only its generated `highlight` member signature at this descriptor owner to describe the plain call-result object `{ id, found, count, selector, highlighted?, error? }`.
  - `FolderViewEditorFacade.ts`: describe `rootPath` as string or null when absent, and `items` as an array of plain item objects `{ id?, title, href, category, tags, isDirectory, size?, mtime?, imgSrc?, hasSubDirectories?, hasItems?, target?, icon? }` (or null when absent); explain that local FileTreeProvider listings include the copied `..` parent row except at root. Keep listing/truncation/copy behavior owned by `CategoryEditorModel` and `FileTreeProvider`.
  - `GridEditorFacade.ts`: state that `rows` returns all data rows regardless of search and column filters; `visibleRowCount` is the filtered projection.
- [x] Correct `recording.start` in `namespaces/window-screen.ts` to include `hideStatusChrome?: boolean` and `→ null` (its `Promise<void>` resolves to no value), consistent with the existing `recordingHelp` prose and `IWindowRecording.start`.
- [x] Expand `namespaces/proc.ts` help to say `execute(command: string, options?: IExecuteOptions) → { jobId: string }` over `call`; the result shaper copies the plain handle's `jobId` and drops its functions. Explain that the script-only handle members (`on`, `getText`, `getJson`, `getBytes`, `write`, `endStdin`, `kill`) cannot be used through `call`; direct agents to `script.execute` for handle work. Do not claim call returns an error or a live handle.
- [x] Add `scripts/describe-tables-check.mjs`, a `describe-tables:check` npm script, and wire it into `npm run lint` as `eslint . && node scripts/describe-tables-check.mjs`, preserving eslint's existing `eslint .` arguments exactly. Keep the standalone npm script too. Parse only the listed TypeScript source files with the installed TypeScript compiler API (no project program/type-check), keep the script ASCII-only and fast, define the method allowlist at the top of the script with one one-line reason per entry, and print one diagnostic line per finding containing the file and member name. Discover `EditorFacadeBase` subclasses and `GenericEditorFacade`, compare their own public instance methods with the statically composed AiVision method members (including imported `BROWSER_AUTOMATION_MEMBERS` for Board/Browser facades), and compare `IBoards` methods with `BOARDS_MEMBERS`. Dynamic method entries should fail with a clear diagnostic; accessors, constructors, private/protected/static methods, and inherited infrastructure methods stay outside the facade comparison. This static mapping is mechanical; do not grow a roadmap §2.3 god file. The checker covers facade/boards-describe membership, not `.d.ts` generation.
- [x] Update only guides that currently conflict with or omit a scoped shape: correct `assets/guides/agents/index.md` so it does not say `boards.openBoard` returns a page id or imply `pages.addEditorPage` returns one directly; correct the `openUrlInBrowserTab` result example in `assets/guides/agents/pages.md` to show the page-id string (MCP renders string results as unquoted text); add the catalog-latest `version` field to `assets/guides/agents/boards/published-boards.md` and `assets/guides/scripting/api/app-proc-and-boards.md`; and clarify in `assets/guides/agents/scripting/editor-facades-and-examples.md` that `grid.rows` is the full row data and ignores search/filter state. `assets/guides/agents/boards/testing.md` already correctly says `openBoard` resolves with no value. Keep script API guides distinct from call-tree signatures.
- [x] Add no unit tests, test harnesses, integration tests, or translations. If implementation introduces English UI catalog text, add it only to `src/shared/i18n/en/` and defer translations until epic close; this plan currently introduces no UI text.

**Before → after examples**:

```text
openUrlInBrowserTab(url, options?: { incognito?, profileName?, external? })
→ openUrlInBrowserTab(url, options?: { incognito?, profileName?, external? }) → string page id (or null when absent)

start({ region, openPlayer? })
→ start({ region, openPlayer?, hideStatusChrome? }) → null

searchPublished(query?: string)
→ searchPublished(query?: string) → array of plain result objects with { id, name, description?, version, fileMasks?, folderMasks?, folderEditorMasks?, folderEditorPriority?, editorName?, editorKind?, standalone?, minAppVersion?, size, compatible, installed, installedRoot?, installedVersion?, updateAvailable }; version is catalog-latest

highlight(name: string, message?: string)
→ highlight(name: string, message?: string) → { id, found, count, selector, highlighted?, error? }

rows: "All rows as plain objects."
→ rows: "All rows as plain objects; search and column filters do not change this full data set."
```

## Concerns / Open Questions

The facade-method mapping is mechanical enough for a scripts check: 24 classes extend `EditorFacadeBase`, and `GenericEditorFacade` is the 25th editor facade; their descriptors use member arrays. `BoardEditorFacade` and `BrowserEditorFacade` spread the imported `BROWSER_AUTOMATION_MEMBERS` array plus their facade-local arrays, and `EditorFacadeBase.describeEditor` appends the shared element members. `IBoards` in `src/renderer/api/types/boards.d.ts` and `BOARDS_MEMBERS` in `namespaces/boards.ts` also form static method lists; current source includes all 18 interface methods, including the three service methods. Compare only each facade class's own public instance methods and explicit method entries. Use explicit allowlists for deliberate omissions; do not infer call access from `.d.ts` types. `UiFacade` is not an editor facade and is outside the facade check.

The return-type edits do not change facade behavior. Add no new product rule: `PageCollectionWrapper` delegates to `PagesModel`/`PagesLifecycleModel`; browser-page opening reuses `browser-pages.ts`; `editorSwitches` delegates to `editorCatalog.switchOptions`; board calls reuse the current `IBoards` implementation; Settings highlight reuses `createElements` and `ui.highlightElement`; Folder View reuses the model's provider listing; grid rows reuse `GridEditor.getRows`; recording reuses `IWindowRecording`; and proc reuses the existing script handle implementation, while the call result is the plain `{ jobId }` projection.

Known plan boundary: `persephone-boards` remains read-only; do not edit, publish, or bump `ai-vision` in `node_modules` or its npm package. Do not change `window.persephone`, so no `BOARD_BRIDGE_VERSION` bump/history line applies. No new board rule, protocol, import-zone exception, `await import()`, or wrapper is planned. The null-check rule is irrelevant because this is descriptor/help text and documentation work, with no runtime null-check changes. Do not start Persephone or Electron, use the Persephone MCP tool or port 7865, run `npm start`, or run `integration-test/run.mjs`.

## Acceptance Criteria

Verification note: `npm run guides:check` could not start because esbuild failed to spawn its service with `EPERM`, including on a standalone retry. The guide-specific acceptance item remains unchecked.

- [x] Every listed describe signature and summary agrees with its concrete implementation and the return types named above; `$help` remains handwritten and limited to the call-tree surface.
- [x] `proc` help names the script handle contract without exposing a process handle through `call`; `recording.start` includes `hideStatusChrome`.
- [x] Browser facade public methods are covered by `describe-tables:check`, with intentional omissions explicit in its allowlist; no broad test harness is added.
- [ ] `npm run describe-tables:check`, `npm run lint`, and `npm run guides:check` pass after implementation; no integration tests are planned. If later scope adds any, list exact paths and have Claude run them.
- [x] Every in-scope guide that restates an affected result agrees with the describe table and runtime source.
- [x] No files outside the task document are changed during planning; implementation targets are confined to Persephone source, guides, package script wiring, and the new checker as listed above. Production build synchronized the corresponding declaration in `assets/editor-types/` from the source type file.

## Files That Need No Changes

- `src/renderer/api/pages/PagesModel.ts`, `src/renderer/api/pages/PagesLifecycleModel.ts`, and `src/renderer/editors/browser/browser-pages.ts` — existing lifecycle/opening behavior already supplies the described results.
- `src/renderer/api/boards.ts` and `src/renderer/api/types/boards.d.ts` — runtime and script-facing board results already agree; only the call-tree describe table and its guide need updates.
- `src/renderer/api/types/window.d.ts` and `src/renderer/api/types/proc.d.ts` — the existing recording options and process-handle contracts are the source for correcting handwritten help.
- `assets/guides/agents/boards/testing.md`, `assets/guides/agents/boards/index.md`, `assets/guides/scripting/api/pages.md`, and `assets/guides/agents/scripting/the-app-object.md` — these already describe their respective `openBoard`, `createShortcut`, page return, and script API contracts accurately.
- `src/renderer/content/tree-providers/FileTreeProvider.ts` and `src/renderer/editors/category/CategoryEditorModel.ts` — existing `..` row and copied provider listing are described, not changed.
- `node_modules/ai-vision/**` and `C:/projects/persephone-boards/**` — read-only; do not patch, publish, or bump either.
- `doc/active-work.md` and `doc/epics/EPIC-199.md` — the user explicitly reserved these for the epic's link/update flow.
- `src/shared/i18n/en/**` and `assets/languages/**` — no UI text or translations are planned.
- Integration tests and unit-test files — none are planned; do not add harnesses or run Persephone or `integration-test/run.mjs`.

## Files Changed

| File | Planned change |
|------|----------------|
| `doc/tasks/US-2122-help-return-types/README.md` | This task plan |
| `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts` | Add page-method return types |
| `src/renderer/scripting/ai-vision/page-editor-switches.ts` | Describe option record shape |
| `src/renderer/api/types/page-editor-switches.d.ts` | Add optional `title` to the script option type |
| `assets/editor-types/page-editor-switches.d.ts` | Build-synchronized Monaco IntelliSense copy of the updated script option type |
| `src/renderer/scripting/ai-vision/namespaces/boards.ts` | Add board return types and latest `version` description |
| `src/renderer/scripting/ai-vision/namespaces/settings.ts` | Add return type to generated `highlight` signature |
| `src/renderer/scripting/api-wrapper/FolderViewEditorFacade.ts` | Document Folder View property types and parent row |
| `src/renderer/scripting/api-wrapper/GridEditorFacade.ts` | Document all-row semantics |
| `src/renderer/scripting/ai-vision/namespaces/window-screen.ts` | Add `hideStatusChrome` and start return type |
| `src/renderer/scripting/ai-vision/namespaces/proc.ts` | Document handle signature, methods, and script-only boundary |
| `scripts/describe-tables-check.mjs` | Add mechanical facade-method/describe-table drift check |
| `package.json` | Wire `describe-tables:check` |
| `assets/guides/agents/index.md` | Correct the `boards.openBoard` page-id claim |
| `assets/guides/agents/pages.md` | Replace the stale object result example with the page-id string |
| `assets/guides/agents/boards/published-boards.md` | Document the latest catalog `version` result field |
| `assets/guides/scripting/api/app-proc-and-boards.md` | Document latest catalog `version` in the result fields |
| `assets/guides/agents/scripting/editor-facades-and-examples.md` | Clarify that grid `rows` ignores search and filters |
