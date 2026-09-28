# US-1554: Board trust granting, bundled-board creation and Board Info each have one path

## Goal

Route board trust grants, new bundled content-host pages, and Board Info transitions through one authoritative path each. Preserve the current board-facing bridge contract and Board Info restore behavior.

## Background

### Trust granting

The grant sequence is repeated in `src/renderer/api/boards.ts` (`boards.registerBoard`), `src/renderer/editors/board/BoardEditorView.ts` (`trustBoard`), and `src/renderer/editors/board-info/BoardInfoEditorModel.ts` (`register`). Each reads the normalized manifest, computes `boardTrustDisclosure(manifest)`, shows `showTrustBoardDialog`, calls `confirmNamespaceNotColliding`, and writes trust. `boardTrustDisclosure` and `readNormalizedBoardManifest` are already the shared manifest layer from US-1549, but the grant orchestration is still duplicated.

`src/renderer/ui/dialogs/TrustBoardDialog.ts` currently accepts an optional `capabilities` array and re-reads the normalized manifest when callers omit it. `boards.registerBoard` currently omits the field; the other two pass the result of `boardTrustDisclosure`. The authoritative trust write is already main-owned: `src/renderer/api/board-trust.ts` calls `api.setBoardTrust(boardRoot, true)`, and main returns authoritative paths. The reusable request flow should sit next to the existing board access helpers at `src/renderer/editors/board/board-access.ts` (the story hint's `src/renderer/api/board-access.ts` path does not exist in this checkout).

The shared helper owns the bundled and already-trusted short-circuits for all three callers: initialize `bundledBoardRegistry`, return `true` for a bundled root, then `boardTrust.load()` and return `true` for an already-trusted root. Otherwise it shows the dialog, checks the namespace, and grants through `boardTrust.trust()`. `boards.registerBoard` retains only its `isBoardFolder()` validation and current invalid-root exception. Board Info's `register()` may therefore receive `true` for an already-trusted root without showing another dialog, then correctly refreshes `customEditorRegistry` and continues its existing install/switch flow. If `readNormalizedBoardManifest()` returns no manifest, the helper passes the existing empty disclosure `{ permissions: [], serviceDeclared: false, capabilities: [] }` to the dialog. `boardTrust.trust()` and `boardTrust.untrust()` remain the renderer wrappers for main-owned trust IPC; no renderer writes the trust file.

### Bundled content-host creation

`src/renderer/ui/sidebar/tools-editors-registry.ts:getCreatableItems()` currently routes every bundled `content-host` association through `pagesModel.addBundledBoardPage(board.root, "json", "untitled.excalidraw")`. There is a second hard-coded language in `src/renderer/api/pages/PagesLifecycleModel.ts:openBoardHandlerPage()`, which calls `addBundledBoardPage(boardRoot, "json", title, onPageCreated)` for bundled capability handlers. Move derivation into `PagesLifecycleModel.addBundledBoardPage()` so both creation paths share it. The bundled Excalidraw manifest is `assets/boards/excalidraw/board-manifest.json`; its `fileMasks` association is the source of the `.excalidraw` file type, and `src/renderer/core/utils/monaco-languages.ts` maps `.excalidraw` to the `json` language.

Use the existing `fileMasks` declaration rather than adding a new manifest field: it already declares the file type and avoids changing the manifest schema. Add one mask-to-untitled-name helper in `src/renderer/editors/board/board-manifest.ts`; for the first usable normalized `*.<literal suffix>` mask (including compound suffixes), it returns `untitled<suffix>`, otherwise `untitled`. `addBundledBoardPage(boardRoot, options?)` reads the normalized manifest once, derives the default untitled filename and Monaco language through `getLanguageByExtension(fpExtname(title))` (falling back to `plaintext` when the manifest/mask has no usable extension), and uses optional `options.title` as the page title override. Thus the Tools hub uses `untitled.excalidraw` / `json`, while `openBoardHandlerPage()` keeps its capability title and uses the manifest-derived language. Pass the already-read normalized manifest result (including `null`, to distinguish a completed read from no supplied value) into `openSingleInstanceBoard()` so singleton routing does not re-read it.

The `disabled-bundled-boards` setting currently has consumers in three renderer areas. Replace the reads/filtering at `src/renderer/editors/board/custom-editor-registry.ts:476,496` and `src/renderer/ui/sidebar/tools-editors-registry.ts:212,268` with `bundledBoardRegistry.enabledEntries()` / `isDisabled(id)`. Replace setting reads/writes in `tools-editors-registry.ts:247-255` with `bundledBoardRegistry.setDisabled(id, disabled)`. Keep `src/renderer/api/board-trust-sync.ts:23-27` as the remaining direct settings path because it pushes the value to main. The key-change subscribers in `BuiltinEditorsListView.ts:98`, `PinnedRailView.ts:117`, `PageTabsView.ts:102`, and `custom-editor-registry.ts:448` only react to the setting key and remain unchanged. This leaves two setting-read paths: registry access for renderer UI/registration, and main synchronization.

After US-1551, `PagesLifecycleModel.openSingleInstanceBoard()` already resolves the board root from an editor target, reads `singleInstance` through `readNormalizedBoardManifest`, activates an existing page, enqueues any source context, and disposes the redundant pipe. `addBundledBoardPage()` duplicates only the singleton manifest lookup and existing-page activation. Delegate its pre-creation check to `openSingleInstanceBoard(undefined, undefined, { target: editorId, normalizedManifest })`, where `normalizedManifest` is the already-read result, including `null`; ordinary open callers omit it and let the helper read the manifest. Keep actual fresh page construction in `addBundledBoardPage()`.

### Board Info transitions and roadmap note

`src/renderer/editors/board-info/open-board-info.ts:28` calls `confirmRelease()` only when the old editor has no `CONTENT_HOST_TRAIT`; host-bearing sources transfer losslessly. `src/renderer/editors/base/editor-switch.ts:176` explicitly says the host-transfer path has no reload and no veto because nothing is lost. The defect is that the Board Info special branch at `editor-switch.ts:87-93` also skips the veto for host-less sources (simple board, `board-view`, or Archive viewer). The shared helper must preserve current semantics: call `oldEditor.confirmRelease()` and abort only when an old editor exists without `CONTENT_HOST_TRAIT`; transfer a host-bearing editor through `switchFrom()` without a veto.

The host-less branches of `BoardInfoEditorModel.switchFrom()` (`BoardInfoEditorModel.ts:262-295`) capture folder/file path and set the title to its basename; they do not touch `boardRoot`, but they can overwrite an explicitly passed `title`. The host-bearing `adoptHost()` path can also replace the title from host state. Preserve explicitly provided `boardRoot` and `title` by reapplying those defined option values after `switchFrom()`; when no title was supplied, retain the source-derived title. Construct the helper's model with `new BoardInfoEditorModel(new TComponentState({ ...getDefaultBoardInfoEditorState(), ...opts }))`, matching the existing menu opener. `editorRegistry.createEditor(BOARD_INFO_EDITOR_ID)` and this direct construction use the same model class and baseline state, but the registry factory has no options parameter; choose direct construction so the helper can seed `opts` and preserve them across `switchFrom()`.

`PageModel.setMainEditor()` is the page replacement lifecycle, while Board Info persists its state through `getRestoreData()` / `applyRestoreData()` and has a dedicated restore path. US-1556's [task document](../US-1556-board-page-restore/README.md) confirms the restore path accepts install-mode descriptors, properties-mode descriptors, host-less paths, and optional content hosts. Keep the editor id, persisted state, and restore dispatch stable so this transition refactor does not undo that fix.

The roadmap's *Needs user verification* item 10 currently says Board Info properties mode is unreachable. `BoardToolbar.ts` does provide a **Board properties** menu entry that opens `openBoardInfo(page, { boardRoot })`; properties mode is reachable there. The failed attempt used an editor switch, which intentionally opens install mode without a `boardRoot`. Update item 10's note to record this as a verification-path correction, not a code defect.

### Board bridge

None of these changes alters a value, method, or protocol visible to a board: trust granting remains a Persephone UI/API flow, bundled page name/language are host initialization metadata, and Board Info is a Persephone editor transition. No `BOARD_BRIDGE_VERSION` bump is needed.

## Implementation plan

- [x] Add `requestBoardTrust(boardRoot)` in `src/renderer/editors/board/request-board-trust.ts`, next to `board-access.ts`. It validates bundled status via `bundledBoardRegistry.ensureInitialized()` / `isBundled()`, loads main-owned trust via `boardTrust.load()` / `isTrusted()`, then owns normalized-manifest disclosure, the required dialog, namespace-collision check, and final `boardTrust.trust(boardRoot)` call. Return `true` for bundled/already-trusted/accepted roots and `false` for dialog cancellation or namespace collision. When the manifest is unreadable, pass `{ permissions: [], serviceDeclared: false, capabilities: [] }`. Keep `boardTrust.trust()` as the main-IPC write path.
- [x] Replace the grant orchestration in `src/renderer/api/boards.ts:registerBoard`, `src/renderer/editors/board/BoardEditorView.ts:trustBoard`, and `src/renderer/editors/board-info/BoardInfoEditorModel.ts:register` with calls to `requestBoardTrust(boardRoot)`. `boards.registerBoard` keeps only `isBoardFolder()` validation and its current invalid-root exception; remove its own bundled/already-trusted checks. Preserve Board Info's awaited registry refresh and subsequent page switch when the helper returns `true`, including the already-trusted case. Remove now-unused dialog, manifest-disclosure, trust-state and namespace imports from those call sites.
- [x] In `src/renderer/ui/dialogs/TrustBoardDialog.ts`, remove the optional `capabilities` input and manifest-read fallback. Accept the required `TrustBoardDialogProps` disclosure fields (excluding `boardPath`) and pass all three disclosure values through to `TComponentState`. Every caller will now provide `boardTrustDisclosure(manifest)` or the existing empty disclosure when the manifest is unavailable.

  Before:

  ```typescript
  disclosure: Omit<TrustBoardDialogProps, "boardPath" | "capabilities">
      & { capabilities?: readonly string[] },
  // Missing capabilities caused this dialog to re-read the manifest.
  ```

  After:

  ```typescript
  disclosure: Omit<TrustBoardDialogProps, "boardPath">,
  // The caller supplies permissions, serviceDeclared, and capabilities.
  ```

- [x] Add `untitledFileNameForMasks(fileMasks)` to `src/renderer/editors/board/board-manifest.ts` to return `untitled<suffix>` for the first usable normalized `*.<literal suffix>` mask (including compound suffixes such as `*.grid.json`), or `untitled` when none is usable. Do not add a manifest field: `fileMasks` already identifies the content-host board's file type.

  Before:

  ```typescript
  await pagesModel.addBundledBoardPage(board.root, "json", "untitled.excalidraw");
  ```

  After:

  ```typescript
  await pagesModel.addBundledBoardPage(board.root);
  ```

- [x] In `src/renderer/api/pages/PagesModel.ts:addBundledBoardPage` and `PagesLifecycleModel.ts:addBundledBoardPage`, change the signature to `(boardRoot, options?: { title?: string; onPageCreated?: (page: PageModel) => void })`. The lifecycle method reads the normalized manifest once, validates the enabled bundled content-host match, calls `untitledFileNameForMasks(manifest?.fileMasks)` for the default host filename, and derives its language with `getLanguageByExtension(fpExtname(fileName))?.id ?? "plaintext"`. Set the host title to the derived filename and the Board editor/page title to `options.title ?? fileName`. Pass the read result, including `null`, to `openSingleInstanceBoard()` as `normalizedManifest` so singleton routing does not trigger a second manifest read. Preserve fresh-page host initialization and callbacks.
- [x] Update `src/renderer/ui/sidebar/tools-editors-registry.ts` to call `pagesModel.addBundledBoardPage(board.root)` with no hand-built language/name. Update `PagesLifecycleModel.openBoardHandlerPage()` to call `addBundledBoardPage(boardRoot, { title, onPageCreated })`; its capability title remains the page title while host filename and language always come from the manifest.
- [x] Centralize disabled bundled-board setting reads and writes in `src/renderer/editors/board/bundled-board-registry.ts` with exact methods `enabledEntries()`, `isDisabled(id)`, and `setDisabled(id, disabled)`. Replace filtering at `custom-editor-registry.ts:476,496` and `tools-editors-registry.ts:212,268`; replace `settings.get` / `settings.set` at `tools-editors-registry.ts:247-255` with `setDisabled`. Keep `board-trust-sync.ts:23-27` as the remaining direct settings path because it pushes the value to main; retain main-side filtering in `src/main/board-trust-service.ts`. Leave the key-change subscribers at `BuiltinEditorsListView.ts:98`, `PinnedRailView.ts:117`, `PageTabsView.ts:102`, and `custom-editor-registry.ts:448` unchanged; they only listen for the key.
- [x] In `src/renderer/api/pages/PagesLifecycleModel.ts:addBundledBoardPage`, replace its local `isSingleInstanceBoard()` plus `findPageByBoardRoot()` branch with `openSingleInstanceBoard(undefined, undefined, { target: editorId, normalizedManifest })`, where `normalizedManifest` is the result already read by `addBundledBoardPage`. Ordinary callers leave it absent and the helper reads the manifest. Keep actual fresh page construction in `addBundledBoardPage()`; remove `isSingleInstanceBoard` if now unused.
- [x] In `src/renderer/editors/board-info/open-board-info.ts`, make one shared page transition helper: when an old editor exists without `CONTENT_HOST_TRAIT`, call `oldEditor.confirmRelease()` and abort on `false`; for a host-bearing source, transfer through `switchFrom()` without `confirmRelease()`. Call `switchFrom(oldEditor)` for both kinds to capture host-less file/folder paths, then reapply explicitly supplied `boardRoot` and `title` so source capture/adoption cannot override them. Create the model directly with `new BoardInfoEditorModel(new TComponentState({ ...getDefaultBoardInfoEditorState(), ...opts }))`, restore it, then install with `page.setMainEditor()`. This uses the same BoardInfoEditorModel/default state as `editorRegistry.createEditor(BOARD_INFO_EDITOR_ID)` while letting the helper seed options. Route both `openBoardInfo()` (toolbar Board properties) and the `BOARD_INFO_EDITOR_ID` branch of `src/renderer/editors/base/editor-switch.ts:switchMainEditor()` through this helper. Pass `{ boardRoot }` from Board properties; let the switch-widget call omit it and retain install mode.
- [x] Update `doc/platform-roadmap.md` *Needs user verification* item 10 at its current heading: state that the BoardToolbar **Board properties** menu opens properties mode, and that the unverified attempt used the editor switch, which opens install mode by design. Record that this is a verification-path correction, not a code defect; keep the capability section/refusal-row live observation itself marked unverified.
- [x] Preserve Board Info restore behavior from US-1556. Its persisted descriptor and dedicated restore path stay intact; verify the plan against `doc/tasks/US-1556-board-page-restore/README.md` and do not change that README as part of this task.
- [x] State and retain the bridge decision: do not change `src/shared/board-bridge-version.ts`; these changes do not alter anything visible to a board.

## Concerns / Open questions

- No design questions remain. The `fileMasks` option is selected over a new manifest field because the normalized association already carries the declared suffix and Excalidraw's existing `*.excalidraw` mask reproduces its required untitled filename. Masks with no safe literal suffix need the documented generic fallback.
- The Board Info release veto applies only to host-less source editors. Host-bearing sources retain the no-prompt `switchFrom()` transfer because the shared content host remains alive; explicit `boardRoot` / `title` options must survive path capture and host adoption.
- Codex does not edit `doc/active-work.md`, `doc/epics/EPIC-115.md`, or US-1557 files; the orchestrating agent handles dashboard/epic updates.
- `BOARD_BRIDGE_VERSION` remains `1.23.0`; no bump is required because no board-facing bridge API or result changes.

## Acceptance criteria

- All three trust entry points use `requestBoardTrust(boardRoot)` and the helper's only privilege grant calls the main-owned `boardTrust.trust()` path after the required dialog and namespace check.
- `TrustBoardDialog` requires explicit capabilities and does not read the manifest itself; disclosure still comes from `boardTrustDisclosure(manifest)`.
- New bundled content-host pages derive filename and language from the first usable `fileMasks` entry inside `addBundledBoardPage()`. Excalidraw still opens as `untitled.excalidraw` with JSON language; unsupported/missing suffixes have a documented fallback. The capability-handler path retains its supplied page title and uses the same derived language.
- Disabled bundled-board filtering has two setting read paths: one renderer registry helper for UI/registration and the main-sync path. The UI and `custom-editor-registry` agree on enabled state.
- `addBundledBoardPage()` routes existing singleton detection/activation through `PagesLifecycleModel.openSingleInstanceBoard()`.
- Board properties and the Board Info editor-switch path share one transition helper. Both run `confirmRelease()` and abort on `false` only for a host-less source; a host-bearing source transfers without a prompt. The menu opens properties mode; switching to Board Info without a root retains install mode. Explicit `boardRoot` / `title` options survive `switchFrom()` path capture.
- Board Info page descriptors continue to restore after reload as described by US-1556.
- Roadmap item 10 records the corrected verification path while leaving the capability presentation observation unconfirmed.
- No board-visible bridge contract changes; `BOARD_BRIDGE_VERSION` is not bumped.

## Live verification

- On a synthetic scratch board with declared capabilities, open trust from all three entry points: `boards.registerBoard` via MCP, the board page Trust button, and Board Info Register. Confirm all three show identical disclosure, including capabilities; select **Cancel** each time and confirm the board remains untrusted. Run each entry path twice.
- From the Tools hub, create the bundled Excalidraw content-host board and confirm the tab/host opens as `untitled.excalidraw` with language `json`. Run twice.
- Open a capability-handler page for the bundled content-host board and confirm it still opens with the capability-supplied page title and manifest-derived `json` language. Run twice.
- For a host-less source, exercise Board Info through the board menu **Board properties** and the editor switch. In each path verify the release dialog appears, Cancel leaves the original editor installed, and approval completes the transition; then reload and confirm Board Info restores. Run each path twice. Also confirm a host-bearing source transfers without an unnecessary release prompt and explicit `boardRoot` / `title` options survive `switchFrom()`.

### Results (2026-09-28, dev build, each path twice)

- `boards.registerBoard` and the untrusted board page's **Trust board** button, on a synthetic
  untrusted board declaring `permissions: ["capabilities"]` and one capability: the dialog showed
  identical disclosure (`permissions ["capabilities"]`, `serviceDeclared false`, `capabilities
  ["us1554.probe"]`) on both paths; Cancel returned `false` and left the board untrusted. Accepting
  on a second synthetic board returned `true` and trusted it through main (untrusted again afterwards).
- Tools & Editors **Excalidraw** row: a new `untitled.excalidraw` board page with language `json`.
- `capabilities.invoke("diagram.edit", ...)`: opened the bundled Excalidraw handler page with the
  capability title and language `json`.
- Host-less source (synthetic simple board over a file): with `confirmRelease` forced to `false`,
  both **Board properties** and the editor switch called it once and left the board installed.
  With it approving, the menu opened properties mode and the switch opened install mode, both
  keeping the file path. Both restored in the same mode after a renderer reload.
- Host-bearing source (text page): switching to Board Info did not call `confirmRelease` and the
  content survived the round trip.

### Not verified

- Board Info **Register board** entry point. It needs a downloaded, unregistered catalog board, and
  none was available without a network install into the user's folders. It calls the same
  `requestBoardTrust` as the two entry points verified above.
- The Tools & Editors disable/re-enable toggle (`bundledBoardRegistry.setDisabled`) was not clicked,
  because that would change the user's settings.

## Files intentionally unchanged

| File | Reason |
|---|---|
| `doc/active-work.md` | Codex does not edit it. |
| `doc/epics/EPIC-115.md` | Codex does not edit it. |
| `doc/tasks/US-1556-board-page-restore/README.md` | Read to preserve its restore behavior; no change needed. |
| `src/renderer/api/board-trust.ts` | Already routes `trust()` through main-owned `api.setBoardTrust`. |
| `src/shared/board-bridge-version.ts` | No board-visible contract change; no bridge version bump. |
| `src/main/board-trust-service.ts` | Continues applying the synchronized disabled-board list on the main side. |
| US-1557 files | Explicitly outside scope. |

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/board/request-board-trust.ts` | Add the shared trust-grant request flow beside board access helpers. |
| `src/renderer/api/boards.ts` | Delegate `registerBoard` trust flow. |
| `src/renderer/editors/board/BoardEditorView.ts` | Delegate the view trust action. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Delegate the installed-board registration flow. |
| `src/renderer/ui/dialogs/TrustBoardDialog.ts` | Require caller-provided capability disclosure and remove manifest re-read. |
| `src/renderer/ui/sidebar/tools-editors-registry.ts` | Call the simplified bundled-board creation API and use centralized enabled/disabled listings. |
| `src/renderer/api/pages/PagesModel.ts` | Update the `addBundledBoardPage` options signature. |
| `src/renderer/editors/board/bundled-board-registry.ts` | Centralize enabled/disabled bundled-board setting access. |
| `src/renderer/editors/board/board-manifest.ts` | Add the shared normalized file-mask to untitled-name helper. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Register enabled bundled boards through the centralized query. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Reuse singleton routing from bundled content-host creation. |
| `src/renderer/editors/board-info/open-board-info.ts` | Own the shared Board Info transition and release veto. |
| `src/renderer/editors/base/editor-switch.ts` | Delegate Board Info switching to the shared transition. |
| `doc/platform-roadmap.md` | Correct Needs user verification item 10's explanation. |
