> Part of the [refactoring roadmap](../../refactoring-roadmap.md). Reviewed at commit `c798129d` (2026-11-10); line numbers drift, so search by symbol when they no longer match.

# 07-editors-core — refactoring review

Scope: `src/renderer/editors/{base,shared,text,monaco,grid,markdown,compare,file-diff,git-tree,explorer,archive,image,svg,mermaid,html,video,restore-failed}` plus `editors/index.ts`, `register-editors.ts` and `types.ts`. All paths below are relative to the repository root.

## Summary

The basic design is sound. It has an `EditorModel` base, a table-driven registry with literal `import()` rows, pure file-name matchers, `TextHostEditorModel` for text editors, and uncontrolled Monaco widget hosts. Most built-in text editors follow it. The weakness is how it grew over the last six months: each new feature (boards, the "+" install entry, folder editors, content-host boards, recordings) was added as a special case where it was called, not as an extension point. The base layer now knows about boards, editors work around the switch widget, and the same plumbing exists in several copies.

The three biggest problems:
1. **Content-host plumbing is copied** (EDC-1). `TextHostEditorModel` uses inheritance, so the two board models re-implement about 150 lines of it, and Grid has its own echo guard.
2. **The `base/` framework is wired to boards** (EDC-2). Switch options, switch execution, the toolbar, the status bar and the `EditorModel` base all import board modules. Two editor registries are merged by hand in 14 files. Editors such as Archive and Video return a fake one-entry `[self]` list just so the switch widget appears.
3. **`TextFileModel` is a god object in a misnamed folder** (EDC-3). It sits in `text/TextEditorModel.ts`. It holds IO, encryption, a script panel with a Monaco widget reference, keyboard shortcuts, script running and sidebar opening. It reaches up into `page.mainEditorInstance`, and it still carries the pseudo-editor surface and dead code from the editor-or-host migration.

Second tier: four copies of the image-export toolbar and actions; hand-built view shells in every editor (21 `requireXxxModel` guards); sidebar panel views that own IO; `ExplorerEditor` used as a catch-all sidebar container; the tree-provider host pattern and source watching, each copied three times; and a Video model that mixes four concerns. Leftovers include the dead `detectedContentEditor` detector (its removal was planned in EPIC-028), dead `resolveForFile`/`mode`, the legacy `state.type` discriminator, and about 100 comment references to planning documents that have been deleted.

## Findings

### EDC-1: Content-host lifecycle exists three times because `TextHostEditorModel` is a base class, not a component
- **Priority:** P1
- **Effort:** M
- **Where:**
  - `src/renderer/editors/base/TextHostEditorModel.ts:63-83` (trait), `:166-173`, `:177-225`, `:240-263`, `:324-342`
  - `src/renderer/editors/board/BoardContentEditorModel.ts:38-50`, `:88-99`, `:105-133`, `:135-138`, `:145-166`, `:172-182`, `:191-201`
  - `src/renderer/editors/board-info/BoardInfoEditorModel.ts:250-261`, `:270-281`, `:283-286`, `:290-318`, `:820-830`
  - `src/renderer/editors/board-info/open-board-info.ts:35`
  - `src/renderer/editors/grid/GridEditor.ts:189-191`, `:340-349`, `:925-929`
  - `doc/architecture/editors.md:262-265`
- **Problem:**
  - `TextHostEditorModel`'s own header says it exists so editors do not "copy-paste" host adoption (`:15-24`). Single inheritance stops the two board models from using it, so both copy it:
    - `BoardContentEditorModel` copies trait registration, `switchFrom`, `adoptHost` (title/id stamp, host `editor` tag, `descriptorChanged` forwarding), the `setPage` forward, `_pendingHost` restore, `getRestoreData`/`applyRestoreData` with `host`, and `saveState`/`confirmRelease` delegation.
    - `BoardInfoEditorModel` copies most of it a third time; its comment says "mirrors BoardContentEditorModel" (`:263`).
  - The copies have already drifted:
    - The restore fallback differs: `TextHostEditorModel` uses an empty host or rethrows, while `BoardContentEditorModel` sets `contentHostError`.
    - Title updates differ: the board copy re-titles on every host change, the base only on adopt.
    - Only the base has the subscription registry, the echo guard and `mirrorHostSettings`.
  - Grid inherits the base but bypasses its echo guard. It writes with `this._host?.changeContent` (`:928`) and filters echoes through a private one-slot `_changedContent` (`:191`, `:343`). The editor guide says every write must go through `writeToHost`/`subscribeHostContent` (`doc/standards/editor-guide.md:22-27`).
- **Refactor:**
  1. Extract `editors/base/content-host-slot.ts` with a `ContentHostSlot` class owned by an editor. It holds `host` and `pendingDescriptor`. Its API:
     - `adopt(host)` and `extract()`, registered as the `CONTENT_HOST_TRAIT` implementation
     - `transferFrom(oldEditor, { tolerant })`
     - `restore(options, { onFailure: "empty" | "throw" | "error-state" })`
     - `descriptor()` and `stash(descriptor)`
     - `registerSubscription`, `subscribeContent`, `write`, `mirrorSettings`
     - `setPage`, `confirmRelease`, `saveState`, `dispose`

     Its options are `displayName`, `stampEditorId` (`editorId` / `"board-view"` / none), `untitledName`, `onAttached` and `onExtracted`.
  2. Turn `TextHostEditorModel` into a thin adapter that owns one slot and keeps today's protected API by delegating to it, so no subclass changes.
  3. `BoardContentEditorModel` and `BoardInfoEditorModel` compose a slot (Board Info uses `tolerant: true` and no stamp). Their copies are deleted; `open-board-info.ts` uses the slot API.
  4. Move Grid to `writeToHost` and `subscribeHostContent`, and delete `_changedContent`.
- **Risk / notes:**
  - Switch and restore are the riskiest paths. Keep each `onFailure` mode exactly as today and test Monaco ↔ Grid ↔ content-host board ↔ "+" switches.
  - This is the same target shape as BRD-9 in 05-board-editor. Do it once, owned by `base/`.

### EDC-2: The editor framework in `base/` is wired to boards; there is no extension point for dynamic editors
- **Priority:** P1
- **Effort:** L
- **Where:**
  - `src/renderer/editors/base/editor-switch.ts:4-17`, `:20-45` (with the source-id list at `:33`), `:103-125`, `:131-179` (category special case at `:168-175`), `:186-246` (file path computed twice at `:207-209` and `:222-224`)
  - `src/renderer/editors/base/editor-switch-options.ts:1-18`, `:87-137` vs `:139-213` ("+" placement and label mapping duplicated at `:112-136` and `:182-213`)
  - `src/renderer/editors/base/PageToolbarView.ts:1-11`, `:249-255`, `:293-314`, `:325-329`
  - `src/renderer/editors/base/EditorStatusBarView.ts:22-32`, `:176-212`
  - `src/renderer/editors/base/EditorModel.ts:13`, `:40-42`, `:359-362`
  - `src/renderer/editors/archive/ArchiveEditor.ts:62-76`
  - `src/renderer/editors/video/VideoEditor.ts:155-160`
- **Problem:**
  - **`base/` imports board modules.** It imports `board/custom-editor-registry`, `board/board-manifest`, `board/board-display-text`, `board-info/board-info-id`, `board-info/open-board-info`, `api/board-install-registry` and `api/published-boards`. Board-specific concepts sit in generic contracts:
    - `EditorStatusBarView` takes `boardStart`/`boardEnd` slots.
    - `EditorModel` declares `EditorOpenContext` with a `BoardSourceContext`, and an `acceptOpenContext` hook that only the board implements.
  - **Two registries are merged by hand at each call site.** The built-in `editorRegistry` and the board `customEditorRegistry` are combined wherever editors are resolved: `parseBoardEditorId`, `resolveEditorIdForFile` and `getFolderEditorsForFolder` are called from 14 files, 10 of them outside `editors/`. `getEditorSwitchOptions` builds the merged list twice, once for folders and once for files, with the same "+" reordering and label-mapping code in each branch.
  - **`switchMainEditor` is a chain of special cases.** Board Info first, with a 20-line comment explaining why this ordering matters (`:103-120`). Then folder editors, with an inline `instanceof CategoryEditorModel` link build. Then board kinds, constructing `BoardContentEditorModel` directly. Then built-ins. Each new editor kind adds another branch here.
  - **Editors work around the switch widget.** It hides unless the current editor is in the list and there are at least 2 options (`PageToolbarView.ts:325-329`). So no-host editors return `[this.editorId]` from `findCompatibleEditors()` only to make board options visible (`ArchiveEditor.ts:69-76`, `VideoEditor.ts:155-160`), and Archive overrides `filePath` (`:62-64`) for the same reason.
  - **The widget subscribes to four board sources** directly: the custom registry, the install registry, display-text changes and the published-catalog subscriptions (`PageToolbarView.ts:249-255`, `:293-314`).
- **Refactor:**
  1. **One resolution surface: `editors/base/editor-catalog.ts`.**
     - Define `interface EditorSource { resolveFile(ctx); resolveFolder(path); candidatesForFile(ctx); candidatesForFolder(path); label(id); subscribe(listener): Cleanup }` and an `EditorCandidate { id, label, labelKey?, labelParams?, displayLabel?, title?, transition: "host-transfer" | "rebuild" | "install" }`.
     - `BuiltInEditorSource` wraps `editorRegistry`. The board module registers `BoardEditorSource` at startup; it absorbs the custom-editor registry, the install registry, the published catalog and display names.
     - `editorCatalog.switchCandidates(model)` always includes the current editor and places the "+" entry once. This deletes both `[self]` overrides and the duplicated branches in `editor-switch-options.ts`.
  2. **Switch execution through strategies.** Define `interface EditorSwitchStrategy { matches(oldEditor, candidate): boolean; run(page, oldEditor, candidate): Promise<void> }`:
     - `base/` registers host-transfer, rebuild-over-file and folder-factory.
     - Board Info registers the install strategy.
     - The board module registers the content-host and simple-board strategies, using BRD-3's board factory.
     - The category link enrichment moves into the category module's folder factory, as `newEditorModelForFolder(anchor, page)`.
  3. Rename `boardStart`/`boardEnd` to `startContributions`/`endContributions`. Move `EditorOpenContext`/`acceptOpenContext` into a board-owned trait (see EDC-6).
  4. Add an ESLint `no-restricted-imports` zone so that `editors/base/**` cannot import `editors/board*/**` or the board `api/` modules.
- **Risk / notes:**
  - This touches the most-used page path. Preserve today's ordering: built-ins first, boards in registry order, "+" last.
  - Pair it with BRD-3 (board factory) and BRD-8 (board contribution registry) in 05-board-editor. Call sites in `content/` and `api/pages` (CORE-1) migrate to `editorCatalog` afterwards.

### EDC-3: `TextFileModel` (the content host) mixes IO, UI chrome state, shortcuts, script running and page navigation, and depends upward
- **Priority:** P1
- **Effort:** L
- **Where:**
  - `src/renderer/editors/text/TextEditorModel.ts:64-81`, `:120-149`, `:159-187`, `:193-236`, `:278-292`, `:327-347`, `:405-449`
  - `src/renderer/editors/text/TextFileActionsModel.ts:1-9`, `:14-48`, `:58-65`, `:101-111`
  - `src/renderer/editors/text/ScriptPanel.ts:2`, `:50`, `:132-174`, `:226-299`, `:309-335`
  - `src/renderer/editors/base/TextChromeView.ts:14-15`, `:26-36`, `:486-495`
  - `src/renderer/editors/monaco/MonacoEditor.ts:184-198`
  - `src/renderer/editors/base/IContentHost.ts:13-61`
  - `src/renderer/api/pages/PageNavigator.ts:240-241`, `:310-313`
  - `src/renderer/api/pages/PagesLifecycleModel.ts:809-810`
- **Problem:**
  - **The framework's core host is in the wrong place.** It lives in `text/TextEditorModel.ts` under the name `TextFileModel`, but `text/` contains no editor; the "Text Editor" is `monaco/`. `base/` imports `text/` ten times, three of them at runtime (`TextHostEditorModel.ts:8`, `PageToolbarView.ts:11`, `TextChromeView.ts:15`), and `text/` imports `base/editorRegistry` back, which creates a `base` ↔ `text` cycle.
  - **One object holds too many jobs:**
    - content state and the two serialisers
    - the IO, encryption and actions sub-models
    - `ScriptPanelModel`: a UI panel with a raw Monaco `editorRef` (`ScriptPanel.ts:50`, `:158-174`), library-save dialogs (`:226-299`) and `openInTab`, which builds and attaches an `ExplorerEditor` to a page (`:309-335`)
    - content-detection and git-detection timers
    - per-editor settings slots
    - a pseudo-editor surface "folded in from the former `editors/base/EditorModel.ts`" (`:65-81`, `:120-149`): `noLanguage`, `getIconElement`, `scriptData`, `page`, `secondaryView` and `type`
  - **It depends upward:**
    - `TextFileActionsModel` imports `pagesModel`, `PageModel` and `scriptRunner` (`:4-7`), and opens the sidebar.
    - The host reaches into the editor through the page with duck typing: `revealLine`, `setHighlightText` and `focusEditor` (`TextEditorModel.ts:159-171`). The pages layer then calls `textHost.revealLine(...)` (`PageNavigator.ts:240-241`, `:310-313`; `PagesLifecycleModel.ts:809-810`).
  - **One rule is implemented in three places:**
    - F5 is handled in `TextChromeView.ts:486-495`, `TextFileActionsModel.ts:24-31` and `ScriptPanel.ts:132-136`.
    - "Run script" is split between `MonacoEditor.runScript` (gets the real selection through the queue, `:184-198`) and `TextFileActionsModel.runScript`. The latter calls `host.getSelectedText()`, a stub that always returns `""` (`TextEditorModel.ts:179-181`).
    - `TextChromeView` finds runners with duck checks such as `"runScript" in model` and `"hasSelection" in state` (`:26-36`).
  - **Dead code:**
    - `canClose` (`TextEditorModel.ts:449`) and `TextFileActionsModel.canClose`, which disposes the model (`:101-111`); no caller ever uses `close()` on a host or editor.
    - `getRestoreData()` (`TextEditorModel.ts:278-292`) has no caller; `getDescriptor()` is the only serialiser in use.
    - Delegates with no external callers: `renameFile`, `applyRenamedPath`, `alertEncryptionError` and `runRelatedScript`. `encript` is also misspelled (`:434`).
  - **`IContentHost` has one implementer and no consumer** that types against it; `EditorModel.contentHost` returns `TextFileModel`.
- **Refactor:**
  1. **Move and rename.**
     - Completed by US-1885: `TextFileModel.ts` now lives in `editors/content-host/`, so the file name matches the class.
     - Completed by US-1885: `ScriptPanel.ts` and `ScriptPanelView.ts` now live in `editors/base/script-panel/`; this is chrome used by `TextChromeView` and `BoardEditorView`.
     - Completed by US-1885: `paste-rich-text.ts` now lives in `monaco/`.
  2. **One keymap.** A `TextPageKeymap` in `TextChromeView` handles Ctrl+S, Ctrl+Shift+S, F5 and Ctrl+Shift+F. Delete the handlers in `TextFileActionsModel.handleKeyDown` and `ScriptPanelModel.handleKeyDown`.
  3. **Script running moves to `scripting/`.** Add `runPageScript(editor, { all, source: "page" | "panel" })`. The selection comes from an optional `TEXT_SELECTION_TRAIT` that Monaco registers. Delete the `getSelectedText` stub and `TextFileActionsModel.runScript`.
  4. **Navigation goes to the editor, not the host.** Callers use a `TEXT_NAVIGATION_TRAIT` (`revealLine`, `setHighlightText`) on `page.mainEditorInstance`. Delete `host.revealLine`, `setHighlightText` and `focusEditor`.
  5. **`ScriptPanelModel` keeps state only.**
     - `openInTab` and the library-save dialogs move to `api/library-service` (or `scripting/script-library-actions.ts`).
     - The view gives the selection through a callback instead of the model holding `editorRef`.
     - Lifetime stays tied to the host id, so the panel still survives editor switches.
  6. **Delete the dead code listed above.** After EDC-4, also delete the pseudo-editor fields. Then either type `contentHost` as `IContentHost` or delete the interface.
- **Risk / notes:**
  - Keyboard behaviour across Monaco, Grid and content-host boards needs a manual check.
  - The script panel's per-host cache file (`fs.getCacheFile(id, "script")`) must keep its key.
  - Step 6 depends on EDC-4 and on CORE-2 step 6 in 04-api-core.

### EDC-4: Every editor has two identities (`state.type` and `editorId`), and the editor-or-host split forces branching on where data lives
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/shared/types.ts:1`, `:14`
  - `src/renderer/editors/base/EditorModel.ts:53-58`, `:252-262`, `:293-314`
  - `src/renderer/editors/base/index.ts:6-10`, `:16-26`
  - `src/renderer/editors/text/TextEditorModel.ts:473-481`
  - `src/renderer/editors/base/editor-switch.ts:20-23`, `:81-88`, `:207-224`
  - `src/renderer/editors/base/editor-switch-options.ts:142-145`, `:217-222`
  - `src/renderer/editors/archive/ArchiveSecondaryView.ts:118`
  - `src/renderer/editors/types.ts:9-10`
  - Readers outside `editors/`: `src/renderer/api/pages/PageModel.ts:41`, `:867`; `PageNavigator.ts:266`; `PagesLifecycleModel.ts:73`, `:766`, `:842`, `:858`; `PagesPersistenceModel.ts:327`
- **Problem:**
  - **Two discriminators.** `editorId` was meant to replace the legacy `state.type` discriminator (`EditorModel.ts:57`: "Replaces today's `state.type` discriminator"). Instead both exist:
    - The 18-member `EditorType` union is still set at 35 sites.
    - It is read to recognise the text host (`isTextFileModel`, 17 references), to find the Explorer (`type === "fileExplorer"`, while its `editorId` is `"explorer"`), and to deduplicate archives.
    - `getDefaultEditorModelState()` stamps `type: "textFile"` and is used only by the Browser, which overwrites it.
  - **Data lives on the editor or on its host.** Because text editors keep `filePath`, `sourceLink` and `title` on the host while no-host editors keep them on their own state, every consumer branches:
    - `getNavigationSourceId` (`EditorModel.ts:293-314`, whose comment records the bug this caused)
    - `sourceLinkFromEditor` (`editor-switch.ts:20-23`)
    - `hostState?.filePath ?? model.filePath ?? hostState?.title ?? editorState.title` (`editor-switch-options.ts:221`)
    - `ArchiveSecondaryView` compares an editor with `page.mainEditor`, which may be a host after unwrapping (`:118`).
  - **The base reads its own declared fields through casts.** `(this.state.get() as { filePath?: string })` appears although `EditorStateBase` already extends `Partial<IEditorState>` (`:252-262`).
- **Refactor:**
  1. **Delete `IEditorState.type` and `EditorType`.** Replace each reader:
     - `isTextFileModel` becomes `instanceof TextFileModel`.
     - The Explorer lookup becomes `instanceof ExplorerEditor`.
     - The archive dedup becomes `editorId === "archive-view"`.
     - Keep reading `type` only inside the persistence migration for old `openFiles.txt` files.
  2. **Canonical getters on `EditorModel`:** `filePath`, `sourceLink`, `language` and `displayTitle`. `TextHostEditorModel` overrides them to read the host. Then delete `getNavigationSourceId`'s two-location lookup, `sourceLinkFromEditor` and the `?? model.filePath` chains.
  3. **Remove `EditorOrHost`.** Coordinate with 04-api-core, CORE-2 step 6: delete `EditorOrHost`, `unwrapToHost` and `editors/types.ts`, and type `SecondaryViewProps.model` as `EditorModel`.
- **Risk / notes:** Old session files carry `type`. Keep one tolerant read in `PagesPersistenceModel` and nowhere else.

### EDC-5: Editor resolution uses five overlapping predicates with different priority rules; the registry has dead paths and the ids are magic strings
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/base/editorRegistry.ts:12-22`, `:131-149`, `:178-192`, `:195-215`, `:217-237`, `:239-264`, `:266-281`; "Mirrors the legacy …" comments at `:197`, `:212`, `:219`, `:241`, `:258`, `:270`
  - `src/renderer/editors/base/editor-matchers.ts:17-24`, `:140-156`
  - `src/renderer/editors/register-editors.ts:145-159`, `:201-213`
  - `src/renderer/editors/text/TextEditorModel.ts:31`, `:193-218`, `:266`, `:275`, `:389`
  - `doc/architecture/editors.md:727-732`
  - `doc/epics/EPIC-028.md:100`
  - `src/renderer/editors/board/BoardEditorModel.ts:378-380`
  - `src/renderer/editors/link-editor/LinkEditor.ts:315-322`
- **Problem:**
  - **Five predicates with different meanings.** An editor's fit is expressed by `accepts(input)`, `match.acceptFile`, `match.switchOption`, `match.validForLanguage` and `match.detectsContent`. Each registry method uses a different subset and a different order:
    - `findEditorsAccepting` sorts descending.
    - `getSwitchOptions` sorts ascending.
    - `resolve` uses `acceptFile` only.
    - `getPreviewEditor` mixes `switchOption` and `acceptFile`.

    Monaco therefore has three priorities: `accepts` 50, `acceptFile` 0, `switchOption` 0. A content-detected editor (60) outranks Monaco in one list but not in the other. `doc/architecture/editors.md:603` claims that the board and built-in lists agree, but that only holds because of how these unrelated numbers happen to fall.
  - **Dead code:**
    - `resolveForFile` and the whole `AcceptanceInput.mode` ("edit"/"view") have no callers, so Monaco's `mode === "view" ? 10 : 50` branch is dead.
    - `detectedContentEditor` (`TextEditorModel.ts:31`, `:193-218`) runs immediately on restore and on a 2.5 s debounce after every edit, stores the result in host state, and is never read. The switch widget re-evaluates `detectsContent` live. EPIC-028 planned to remove this field and timer (`EPIC-028.md:100`); the doc still describes it as used (`editors.md:732`).
    - The "Mirrors the legacy X" comments refer to a registry that no longer exists.
  - **Magic ids.**
    - `editorId` is typed `string`, not the existing `EditorView` union.
    - Only `BOARD_INFO_EDITOR_ID` is a constant. `"monaco"` appears 54 times in 27 files, `"board-view"` 34 times in 14 files, and `"md-view"` 22 times in 15 files.
    - The navigation `sourceId` strings that let a board receive a source context ("explorer", "link-category", "link-tag") are listed separately in `editor-switch.ts:33`, `BoardEditorModel.ts:378-380` and `LinkEditor.ts:315-322`.
    - The built-in grid matcher knows the bundled Excalidraw board's `.excalidraw` extension (`editor-matchers.ts:18-21`).
- **Refactor:**
  1. Delete `resolveForFile`, `AcceptanceInput.mode` and Monaco's explicit `accepts`.
  2. Delete `detectedContentEditor`, `scheduleDetection`, `cancelDetection` and `editorRegistry.detectContentEditor`.
  3. Use one matcher contract with named tiers: `EditorMatcher { file?(name): Tier; language?(lang, name?): Tier; content?(lang, content): boolean; folder?(path): Tier; host?(host): Tier }`. A single `rank(input)` function serves resolve, switch, preview and accept. One documented sort rule (Monaco first, then by tier) is implemented once.
  4. Add `editors/base/editor-ids.ts` with `EditorId` constants typed as `EditorView`, plus ``type BoardEditorId = `board-editor:${string}` ``. Type `editorId: EditorView | BoardEditorId`. Add a `NavigationSourceId` union and one `BOARD_CONTEXT_SOURCE_IDS` set.
  5. Drop the `.excalidraw` exclusion. Let the grid switch suppress itself for files a content-host board claims, or add a manifest flag.
- **Risk / notes:**
  - Changing the sort can reorder the switch segments users see, so snapshot the current order per file type first.
  - Removing `detectedContentEditor` is safe: there are no readers in code, `.d.ts` files or assets.

### EDC-6: The `EditorModel` base keeps gaining single-use hooks and inherits a dialog protocol nobody uses
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/base/EditorModel.ts:1`, `:48-52`, `:68-70`, `:107-117`, `:333-371`
  - `src/renderer/core/state/model.ts:69-93`
  - `src/renderer/editors/monaco/MonacoEditor.ts:57-66`, `:133-149`
  - `src/renderer/editors/grid/GridEditor.ts:227-230`
  - `src/renderer/editors/markdown/MarkdownEditor.ts:63-69`
  - `src/renderer/editors/mermaid/MermaidEditor.ts:63-68`
  - `src/renderer/editors/svg/SvgEditor.ts:29-35`
  - `src/renderer/editors/html/HtmlEditor.ts:45-51`
  - `doc/architecture/editors.md:219`
- **Problem:**
  - **The base keeps growing.** It has about 50 members. Several optional hooks each serve one editor:
    - `acceptOpenContext`: board only, and it pulls `BoardSourceContext` into the base
    - `onReopen`: video only
    - `revealFragment`: markdown only
    - `isFreshEmpty`: Monaco only
    - `hasTextSelection`: Monaco implements it and nothing calls it

    The class was meant to stay generic.
  - **It inherits an unused dialog protocol.** `EditorModel` extends `TDialogModel`, inheriting `close`, `result`, `canClose`, `onClose` and an `R` generic. No editor is ever closed through it: pages use `confirmRelease`. The doc nevertheless claims "every editor can `close()` with confirmation" (`editors.md:219`).
  - **The queue cast is copied.** The base types `queue` as `ComponentQueue<E>` with no request channel, so six editors in this area (and three elsewhere) re-cast it to `typedQueue` with `as unknown as`. Monaco also has both `focus()` and `focusEditor()` doing the same thing (`:133-149`).
- **Refactor:**
  1. `EditorModel` extends `TModel`; drop `R`.
  2. Make the base generic over requests: `EditorModel<T, E, Q = never>` with `queue: ComponentQueue<E, Q>`. Delete the nine `typedQueue` casts and `focusEditor`.
  3. Keep on the class only the identity and the lifecycle core: `applyRestoreData`, `switchFrom`, `restore`, `getRestoreData`, `saveState`, `confirmRelease`, `dispose`, and the navigation/panel hooks several editors use. Move single-implementer behaviour to traits on the existing `TraitSet`, which today carries only `CONTENT_HOST_TRAIT`:
     - `OPEN_CONTEXT_TRAIT` (board)
     - `REOPEN_TRAIT` (video)
     - `FRAGMENT_NAV_TRAIT` (markdown)
     - `NAVIGATION_SINGLETON_TRAIT` (`matchesNavigationTarget`/`onNavigationReuse`)
  4. Delete `hasTextSelection` and the casted getters.
- **Risk / notes:** The change is mechanical. Before deleting the dialog members, grep for `editor.close`, `.result` and `.onClose` on editors; none were found in this review.

### EDC-7: Every editor assembles its page view by hand; `EditorModule.View` is untyped, so 21 runtime guards and 16 helper copies exist
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/base/editorRegistry.ts:38-40`
  - `doc/standards/editor-guide.md:37-44`, `:238`
  - `requireXxxModel` in `monaco/index.ts:16`, `grid/index.ts:25`, `markdown/index.ts:18`, `mermaid/index.ts:21`, `svg/index.ts:21`, `html/index.ts:26`, `image/ImageView.ts:22`, `archive/ArchiveEditorView.ts:146`, `git-tree/GitTreeEditorView.ts:122`, `video/VideoView.ts:33`, `file-diff/index.ts:10`, plus 10 more outside this area
  - `createContentsRoot` in `monaco/index.ts:21`, `grid/index.ts:19`, `markdown/index.ts:12`, `mermaid/index.ts:15`, `svg/index.ts:15`, `html/index.ts:20`, `image/ImageView.ts:16`, `file-diff/index.ts:72`, `file-diff/FileDiffBodyView.ts:325`, `file-diff/RevisionPickerView.ts:170`; `createContentsPart` in `base/PageToolbarView.ts:83` and `base/TextChromeView.ts:38`
  - `src/renderer/editors/base/TextChromeView.ts:45-250`, `:498-510`
  - `src/renderer/editors/base/PageToolbarView.ts:90-231`
  - `src/renderer/ui/secondary-views/secondary-view-registry.ts:8`
- **Problem:**
  - **The view contract is untyped, and the guide's example does not compile against it.** `EditorModule.View` is `VanillaViewCtor<{ model: EditorModel }>`, while the guide's example declares `VanillaView<{ model: MyEditor }>`. So every editor re-narrows with its own `instanceof` guard.
  - **The text-editor page shell (body + toolbar parts + `TextChromeView`) is written separately in each editor, using three strategies:**
    - built in the constructor with `super(props, chrome.root)` (SVG, HTML, Monaco)
    - built in `onMount` into a contents root that appends body, toolbar and chrome as siblings before the chrome moves the body into its slot (Mermaid `:201-223`, Grid `:220-249`)
    - updated in `onUpdate`, either by throwing on a model change (HTML, Grid, Image) or by re-pointing silently (Monaco, SVG, Mermaid)
  - **The main view's file location contradicts the guide.** It is in `index.ts` for six text editors and in `XxxView.ts` for the others.
  - **"Conditionally show one icon button" is copied four times:** `CompareButtonView`, `RunButtonsView` and `ShowResourcesButtonView` in `TextChromeView`, and `NavPanelButtonView` in `PageToolbarView`.
  - **The generic text chrome contains an HTML-only feature.** "Show resources" builds a `file:///` URL with a regex (`TextChromeView.ts:498-503`), while `HtmlEditor` uses `content/link-utils.toFileUrl`.
  - **Secondary views have the same problem.** `SecondaryViewProps.model` is `EditorOrHost`, so panels cast it, for example `props.model as ExplorerEditor` (`ClipboardSecondaryView.ts:90`).
- **Refactor:**
  1. **Typed modules.** Make the module generic, `EditorModule<M extends EditorModel>`, with `View: VanillaViewCtor<{ model: M }>`. Add `defineEditorModule(ModelClass, def)`, which performs the single `instanceof` check, and delete the 21 guards. Do the same for `SecondaryViewProps<M>`.
  2. **A shared text-editor page view.** Add `TextEditorPageView<M>` in `base/`. Each editor supplies `createParts(model)`, returning `{ body, toolbar?, rightToolbar?, footer? }`. The base view composes them into `TextChromeView` with one construction and update policy. Monaco, Grid, Markdown, Mermaid, SVG, HTML, FileDiff, EnvVars, LogView and Link adopt it.
  3. **Shared helpers in `uikit/shared`:** `createContentsElement(part?)`, which deletes 16 copies, and a `ToggledIconButton` helper for the show/update/release pattern.
  4. **Move "Show resources"** into an HTML-language contribution that uses `toFileUrl`. Settle the main view file name (`XxxEditorView.ts`) and update `editor-guide.md`.
- **Risk / notes:**
  - This is mostly mechanical; do it per editor.
  - The data-name contract (`text-chrome-root`, `text-run-script`, and so on) must not change, because automation and QA address it.

### EDC-8: Image-export actions and toolbars exist four times; `image-export.ts` mixes layers and forms a UIKit ↔ editors cycle
- **Priority:** P2
- **Effort:** M
- **Where:**
  - Toolbars: `src/renderer/editors/svg/index.ts:31-107`, `src/renderer/editors/mermaid/index.ts:43-189`, `src/renderer/editors/html/index.ts:31-200`, `src/renderer/editors/image/ImageToolbarView.ts:21-174`
  - Model actions: `src/renderer/editors/svg/SvgEditor.ts:50-93`, `src/renderer/editors/mermaid/MermaidEditor.ts:187-253`, `src/renderer/editors/html/HtmlEditor.ts:100-160`, `src/renderer/editors/image/ImageEditor.ts:280-363`
  - Copy paths: `src/renderer/editors/svg/SvgBodyView.ts:97-98`, `src/renderer/editors/mermaid/MermaidBodyView.ts:190-191`, `src/renderer/editors/image/ImageView.ts:32-33`, `src/renderer/scripting/api-wrapper/ImageEditorFacade.ts:139-140`
  - Image-export module: `src/renderer/editors/shared/image-export.ts:1-8`, `:23-48`, `:59-85`, `:97-99`, `:129-152`
  - Cycle: `src/renderer/uikit/ImageViewport/ImageViewportView.ts:3`, `src/renderer/uikit/ImageViewport/image-raster.ts:1-15`
- **Problem:**
  - **The same actions are re-implemented in each image editor.** SVG, Mermaid, HTML and Image all implement copy-as-PNG, save-as-PNG and "open in Drawing Editor", each with its own model method, toolbar view, error wrapping and file-name rule.
  - **Copy takes three routes:**
    - the body view calls the model (SVG, Mermaid)
    - the Image view copies from the viewport
    - the Image facade uses the shared `copyImageToClipboard(editor)`
  - **The menu-button boilerplate is copied.** `focusedBeforeMenu`, `MenuHandle` and `restoreFocus` appear in `html/index.ts:144-166` and `ImageToolbarView.ts:86-103`.
  - **`image-export.ts` combines unrelated layers:**
    - pure canvas helpers, two of which repeat `uikit/ImageViewport/image-raster.ts` (the image loader and the encode step)
    - an IPC clipboard write
    - save dialogs and toasts

    UIKit imports it (`ImageViewportView.ts:3`), and it imports UIKit back (`:8`), forming a cycle. `api/capability-feedback.ts` imports it as well.
- **Refactor:**
  1. **Shared actions.** Add `editors/shared/image-actions.ts` with `ImageActions(source: IImageExport & IImageEditSource)` providing `copy()`, `saveAsPng()`, `openInDrawingEditor()` and `openInImageView()`. Each model keeps only `exportPng`, `suggestedImageName` and `imageEditPayload()`. The Image editor gets a model-level copy like the others.
  2. **Shared toolbar.** Add `ImageActionsToolbarView` with options `{ layout: "buttons" | "menu"; extra?: IconButtonProps[] }`. Mermaid adds its theme and Excalidraw buttons as extras. The menu focus handling moves to a UIKit `MenuButtonView` (see UIK).
  3. **Split `image-export.ts`.** Pure raster code (`loadImage`, `rasterToPngBlob`, `rasterToPngBlobWithDimensions`, `imageElementToPngBlob`, `blobToBuffer`, `blobToDataUrl`) goes to `core/utils/image-raster.ts`; this removes the UIKit cycle (UIK-7). The clipboard and dialog IO stays in `editors/shared/image-actions.ts`.
- **Risk / notes:** HTML's export is intentionally not headless; keep that difference inside `HtmlEditor.exportPng`.

### EDC-9: Views own IO and business rules, while models hold raw DOM and widget handles
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/explorer/ClipboardSecondaryView.ts:52-79`, `:192-277`, `:467-560`
  - `src/renderer/editors/explorer/BoardsSecondaryView.ts:374-473`
  - `src/renderer/editors/explorer/ExplorerSecondaryView.ts:222-250`
  - `src/renderer/editors/explorer/ExplorerEditorModel.ts:62-69`
  - `src/renderer/editors/git-tree/CommitDiffPanel.ts:45-61` vs `:155-198`
  - `src/renderer/editors/markdown/MarkdownBodyView.ts:157-198` vs `src/renderer/editors/markdown/MarkdownEditor.ts:86-97`
  - DOM handles held by models: `src/renderer/editors/markdown/MarkdownEditor.ts:55-59`, `:185-191`; `src/renderer/editors/html/HtmlEditor.ts:41`, `:100-117`; `src/renderer/editors/video/VideoEditor.ts:92`, `:105-107`, `:144-146`; `src/renderer/editors/text/ScriptPanel.ts:50`
  - `doc/standards/model-view-pattern.md:866-870`
- **Problem:** The model-view standard says the model holds the logic and the view only renders, and that models must not touch DOM. Several views do the reverse:
  - **`ClipboardSecondaryView` (703 lines) has no model.**
    - It holds history, status, loading, the revision and three generation counters.
    - It calls the clipboard IPC directly: start/stop monitoring, history, status, copy, remove, clear and restart.
    - The ai-vision `clipboard` namespace calls the same IPC on its own.
  - **`BoardsSecondaryView` performs board operations** itself: create board, delete board (`fs.removeDir`, untrust, `removePin`) and untrust toolsets.
  - **`ExplorerSecondaryView` creates `new FileTreeProvider(rootPath)`** and writes it into `model.treeProvider`. So the model's `listItems`/`openItem` fail until a view has mounted (`ExplorerEditorModel.ts:62-69` documents this).
  - **`CommitDiffPanelModel` has only three setters.** The view does the `git.commitFiles`/`git.show` loading with generation guards.
  - **Markdown splits navigation across view and model.** Following a link (push to the back stack, then `openRawLink`) lives in `MarkdownBodyView`, while going back lives in `MarkdownEditor.navigateBack`.

  In the other direction, five models keep raw DOM or widget handles so facades can reach the view: Markdown `_containerRef`, HTML `_captureEl` with `getBoundingClientRect`, Video `mediaElement`, `ScriptPanelModel.editorRef`, and the Grid `_grid` instance.
- **Refactor:**
  1. **Clipboard history model.** Add `api/clipboard-history.ts` with `ClipboardHistoryModel` (reactive state; `startMonitoring`, `stopMonitoring`, `refresh`, `open`, `copy`, `remove`, `clear`, `restart`; generation guards inside). The panel view and the ai-vision namespace both consume it.
  2. **Board operations move to the board module.** `deleteBoard`, `createBoard` and `removeToolset` go into a board-library service, together with the "untrust + unpin" pairing (SHL-5, PLAT-2).
  3. **The Explorer model owns its `FileTreeProvider`.** It recreates it when `rootPath` changes, as `ArchiveEditor` already does (`ArchiveEditor.ts:80-101`).
  4. **`CommitDiffPanelModel` does the loading** through `loadCommit(repoRoot, commit)` and `selectFile(path)`; the view renders state.
  5. **Markdown navigation in one place.** Add `MarkdownEditor.followLink(href)` next to `navigateBack`. `MarkdownBodyModel.navigateLink?` becomes a required `followLink`, which the About guide also implements.
  6. **One view-port pattern for DOM handles.** The view registers a typed port on mount, `model.attachViewPort({ renderedHtml(), captureRect(), mediaElement() })`, and clears it on unmount. Delete the five ad-hoc handles.
- **Risk / notes:** The clipboard panel's race handling (revision and generation counters) must move unchanged. Facade behaviour on inactive pages, where no port is attached, must keep its current errors.

### EDC-10: `ExplorerEditor` has become a catch-all sidebar container, built in seven places
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/explorer/ExplorerEditorModel.ts:27-48`, `:58-69`, `:160-246`, `:248-300`
  - `src/renderer/api/pages/PagesLifecycleModel.ts:538`, `:545-567`
  - `src/renderer/api/pages/PagesPersistenceModel.ts:334`, `:385`
  - `src/renderer/editors/explorer/page-explorer.ts:50`, `:82`
  - `src/renderer/editors/text/ScriptPanel.ts:326`
  - `src/renderer/editors/explorer/BoardsSecondaryView.ts:33-36`
  - `src/renderer/api/pages/PageModel.ts:867`
- **Problem:**
  - **One model serves four unrelated panels:** the file tree, file search, Boards+Tools (trust lists, toolset registration dialog) and Clipboard.
  - **The dedicated Clipboard page is an `ExplorerEditor`** with `hideExplorer: true, rootPath: ""` (`PagesLifecycleModel.ts:545-567`).
  - **The `explorer/` folder holds unrelated panels:** the 703-line Clipboard panel and the 475-line Boards panel, which imports three `board/` internals (`BoardsTreeView`, `board-shortcut`, `busy-boards`) and `tools/ToolsTreeView`.
  - **Its id is non-standard.** `editorId` is `"explorer"` but the editor is not in the registry, and the page finds it through the legacy `type === "fileExplorer"`.
  - **The same boilerplate is copied seven times:** build a `TComponentState` from `getDefaultExplorerEditorState()`, construct `new ExplorerEditor`, call `page.attach`, then `await restore()`.
  - **`listBoards` normalises paths by hand** with `replace(/\\/g, "/").toLowerCase()` (`:251-256`) instead of `fpNormalizeForCompare`.
- **Refactor:**
  1. Keep `ExplorerEditor` for the file tree and search only.
  2. Add `ClipboardPanelEditor` (`editorId: "clipboard"`) and `BoardsPanelEditor` (`"boards"`). Each is its own Pattern-A panel editor attached to the page. The Explorer header buttons call `page.ensurePanelEditor(...)`, and the dedicated Clipboard page attaches only the clipboard editor. Delete `hideExplorer`, `boardsOpen` and `clipboardOpen`.
  3. Add one factory, `attachExplorer(page, { rootPath, search? })`, in `page-explorer.ts` and use it at all seven sites.
  4. Move `ClipboardSecondaryView` to `editors/clipboard/` and `BoardsSecondaryView` to `editors/board/` (BRD-8).
- **Risk / notes:** Persisted pages carry the `boardsOpen`/`clipboardOpen` flags, so add a one-time migration in `PagesPersistenceModel` (CORE-5).

### EDC-11: The tree-provider host pattern is copied in Archive, Explorer and Link, and is found with `instanceof` instead of a trait
- **Priority:** P2
- **Effort:** S
- **Where:**
  - `src/renderer/editors/archive/ArchiveEditor.ts:44-55`, `:80-101`
  - `src/renderer/editors/explorer/ExplorerEditorModel.ts:62-85`
  - `src/renderer/editors/link-editor/LinkEditor.ts:111-112`, `:178-184`
  - `src/renderer/editors/archive/ArchiveSecondaryView.ts:143-157`
  - `src/renderer/editors/explorer/ExplorerSecondaryView.ts:375-385`
  - `src/renderer/editors/category/CategoryEditorModel.ts:38-51`
  - `src/renderer/editors/base/navigation-state.ts:1-4`
- **Problem:**
  - **Three copies of the same state.** Each host declares `treeProvider`, `selectionState: TOneState<NavigationState>` and, in two cases, a `revealVersion` counter that the panel turns into a requestAnimationFrame-scheduled `revealItem`.
  - **Three ownership models for the provider:** created by the view (Explorer), created by the model (Archive), or a lazy getter (Link).
  - **Discovery by concrete classes.** Category already defines the right interface, `CategoryTreeProviderHost`, but finds hosts with `instanceof LinkEditor || ExplorerEditor || ArchiveEditor`, importing three editors. `navigation-state.ts` refers to an `ITreeProviderHost` duck type that does not exist.
- **Refactor:**
  1. Add `editors/base/tree-provider-host.ts` with a composable `TreeProviderHost` class: `provider`, `selectionState`, `setSelected(href)`, `requestReveal(href)`, a reveal signal and `dispose`. Add `TREE_PROVIDER_HOST_TRAIT`, which Archive, Explorer and Link register.
  2. Category finds hosts with `editor.traits.get(TREE_PROVIDER_HOST_TRAIT)`, which drops its three imports (complements EDT-11).
  3. Add one `TreeRevealController` helper used by both panels.
- **Risk / notes:** Low risk. It depends on EDC-9 step 3 for consistent provider ownership.

### EDC-12: Source watching, moved-source handling and pipe rebuilding are copied across the text host, Image and Video
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/text/TextFileIOModel.ts:53-73`, `:76-113`, `:224-250`
  - `src/renderer/editors/image/ImageEditor.ts:77-82`, `:112-159`
  - `src/renderer/editors/video/VideoEditor.ts:203-228`
  - `src/renderer/content/rebuild-pipe.ts:76-78`
- **Problem:**
  - **Watching is wired separately in each model.** Each one calls `pipe.watch`, `watchSourceRecovery` and `watchSourceMove`, keeping three unsubscribe fields with their own reset code.
  - **Moved-source handling is identical in two places.** `TextFileIOModel.applyRenamedPath` and `ImageEditor.followMovedSource` both rebuild the archive-entry path (`` `${newSourcePath}!${entry}` ``), call `cloneForMovedSource` and rewrite `sourceLink.filePath`/`url`.
  - **The pipe is rebuilt from a path three ways:**
    - `TextFileIOModel.ensurePipe` splits `!` and builds `FileProvider` + `ArchiveTransformer` by hand.
    - Image uses `pipeFromSourcePath`.
    - Video uses `pipeFromPersistedSource`/`pipeFromLink`.
- **Refactor:**
  1. Add `content/source-watch.ts` with `watchPipeSource(pipe, { onChanged?, onRecovered?, onMoved? }, label): Cleanup`, which returns one disposer.
  2. Add `movedSource(pipe, newSourcePath, state)`, returning `{ pipe, filePath, title, sourceLink }`, used by the text host and Image.
  3. `TextFileIOModel.ensurePipe` uses `pipeFromSourcePath`; its caller `restore()` is already async.
- **Risk / notes:** Event filtering differs today. Text ignores "available"/"moved", and Image reloads only when no image is shown. Keep that as callback logic.

### EDC-13: `VideoEditor` mixes stream sessions, temporary recordings, global mute state and VLC launching, and depends on a board module
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/video/VideoEditor.ts:55-57`, `:92-146`, `:182-320`, `:365-375`, `:402-414`, `:417-429`
  - `src/renderer/editors/board/board-pipe-handler.ts:271-290`
  - `src/main/recording-service.ts:21`
- **Problem:** The 479-line model holds four separate concerns:
  - **A stream-session state machine:** request ids, in-flight dedup, IPC create/delete, pipe-resource registration and a recovery watch, about 140 lines.
  - **Temporary-recording management:** save/discard/delete. It repeats main's naming regex `persephone-recording-<uuid>` (`:113` vs `recording-service.ts:21`).
  - **Module-level mutable state:** `sessionMuted` (`:57`).
  - **VLC launching.**

  It registers its pipe resources through `editors/board/board-pipe-handler.ts`. That file is a general renderer-side pipe server serving both board content and video sessions, but its location and name say "board".
- **Refactor:**
  1. Add `video/VideoStreamSession.ts`, a class that owns the request id, the active session and resource, recovery and IPC. Its API: `start(source, { force, freshPipe, rebuildPipe }): Promise<string | undefined>` and `dispose()`.
  2. Add recording helpers to `api/window-recording.ts`: `isTemporaryRecording(path)`, `saveAs(path)` and `discard(path)`, sharing one naming constant with main.
  3. Move mute to an explicit preference or a session store in `api/`.
  4. Move `board-pipe-handler.ts` to `content/pipe-resource-server.ts` with neutral names, for example `registerPipeResource(kind, id, pipe)` (coordinate with 05-board-editor).
- **Risk / notes:** The session race handling (`sourceRequestId`) must move as is.

### EDC-14: `GridEditor` (973 lines) has its format codecs inline, a private echo guard and a one-time legacy migration
- **Priority:** P3
- **Effort:** M
- **Where:**
  - `src/renderer/editors/grid/GridEditor.ts:180-191`, `:305-331`, `:383-392`, `:476`, `:559-602`, `:877-902`, `:933-973`
  - `src/renderer/editors/grid/index.ts:207-293`
  - `src/renderer/editors/grid/GridBodyView.ts:288-300`
  - `src/renderer/editors/grid/util.ts` vs `src/renderer/editors/grid/utils/grid-utils.ts`
- **Problem:**
  - **Format logic is inline.** Parse and serialise switch on `format` in two places, and `parseJsonl` and `detectCsvDelimiter` are file-local or static helpers. The comment on `detectCsvDelimiter` names three callers; only one exists (`:933-935`).
  - **A legacy migration stays in the model.** `_pendingLegacySettings` promotes pre-HS1 (2026-05-21) descriptor fields on every restore.
  - **The grid instance is published twice:** to the model (`setGrid`) and to the parent view (`onModel`), only so the toolbar can reach `ColumnsOptions`.
  - **An error message is hard-coded English** (`:476`).
  - **The echo guard is private** (see EDC-1).
- **Refactor:**
  1. Add `grid/formats/{json,jsonl,csv}-codec.ts`, each implementing `GridCodec { parse(content, opts): { rows, error? }; serialize(rows, columns, opts): string; detectOptions?(content) }`. `GridEditor` selects a codec by format.
  2. Move the legacy promotion into the `PagesPersistenceModel` migrations (CORE-5), or delete it after the cutoff.
  3. The toolbar reads `model.grid`; drop `onModel`.
  4. Localise the error, and merge `util.ts` into `utils/`.
- **Risk / notes:** CSV header and delimiter toggles depend on the rows-before-columns order (`:516-525`). Keep `setRows` in the model.

### EDC-15: `editors/shared/` is a mixed bag, and editors import each other's internals for shared components
- **Priority:** P3
- **Effort:** S
- **Where:**
  - `src/renderer/editors/shared/monaco-project-intellisense.ts:58-59`, `src/renderer/editors/shared/monaco-project-diagnostics.ts` (only `monaco/MonacoBodyView.ts:20-21` imports them)
  - `src/renderer/editors/shared/source-context.ts:14-17`
  - `src/renderer/editors/shared/link-open-menu.ts` (imported by `content/tree-context-menus.ts`)
  - `src/renderer/editors/shared/FindBarView.ts`
  - `src/renderer/editors/markdown/MarkdownEditor.ts:135-181` vs `src/renderer/editors/about/AboutGuidePageView.ts:347-390`
  - `src/renderer/editors/text/paste-rich-text.ts`
  - Markdown renderer consumers: `mcp-inspector/McpInspectorView.ts`, `mcp-inspector/ResourceContentView.ts`, `mneme-root/MnemeRootEditorView.ts`, `log-view/items/MarkdownOutputView.ts`
  - Mermaid renderer consumers: `markdown/CodeBlock.ts:8`, `log-view/items/MermaidOutputView.ts:10`
  - `src/renderer/editors/compare/CompareEditor.ts:42`, `src/renderer/ui/app/PageContentView.ts:2`
- **Problem:**
  - **What `shared/` holds:** 12 files.
    - Genuinely shared: the Monaco hosts, `ColorizedCodeView`, `editor-menu-items`.
    - Single-consumer:
      - the Monaco-only TS-project service (446 lines with module-level maps)
      - the board-only `source-context`, which compares paths by hand instead of with `fpNormalizeForCompare`
    - Imported from lower layers:
      - `image-export` (see EDC-8)
      - `link-open-menu`, imported by `content/`
  - **`FindBarView` is a generic primitive but its state is not shared.** The search state machine behind it (open/close/set text/match count/next/prev) is written twice, once in `MarkdownEditor` and once inside the About guide view.
  - **Shared renderers live inside editor folders.** The Markdown renderer (`MarkdownBlockView`, `CodeBlock`, `hast-dom`, `rehype*`) is used by four other editors from `editors/markdown/`, and the Mermaid renderer is imported from `editors/mermaid/`.
  - **`compare/` contains no editor.** `CompareEditor` is a `VanillaView`, not an `EditorModel`.
- **Refactor:**
  - **`shared/` moves:**
    - `monaco-project-*` and `paste-rich-text` go to `monaco/`.
    - `source-context` goes to `board/`.
    - `link-open-menu` goes to `content/` or `ui/menus`.
    - `FindBarView` goes to UIKit, with a small `FindState` model used by Markdown and the About guide.
  - **Shared renderers:**
    - The Markdown and Mermaid renderers go to `components/markdown/`.
    - Rename `CompareEditor` to `CompareView`, under `ui/app/compare/` or `components/`.
  - **Rule:** state in `doc/architecture/folder-structure.md` that an editor folder must not import another editor folder except through `base/` or `shared/`.
- **Risk / notes:** These are pure moves; batch them as one move-only commit.

### EDC-16: Dead code, leftovers from removed features, and comments that point at deleted planning documents
- **Priority:** P3
- **Effort:** S
- **Where:**
  - `src/renderer/editors/index.ts`
  - `src/renderer/editors/types.ts`
  - `src/renderer/editors/explorer/index.ts:3-5`
  - `src/renderer/editors/image/index.ts:28-29`
  - `src/renderer/editors/base/EditorModel.ts:333-337`, `:274`, `:375`
  - `src/renderer/editors/base/TextHostEditorModel.ts:27-35`
  - `src/renderer/editors/svg/SvgEditor.ts:42-44`
  - `src/renderer/editors/video/VideoEditor.ts:55-56`
  - `src/renderer/editors/monaco/MonacoEditor.ts:22-24`
  - `src/renderer/editors/grid/GridEditor.ts:472`
  - `src/renderer/editors/register-editors.ts:183`
  - `src/renderer/editors/shared/image-export.ts:110`
  - `doc/architecture/editors.md:219`, `:226`, `:727-732`
  - `doc/standards/model-view-pattern.md:850-855`
- **Problem:**
  - **Dead code:**
    - The `editors/index.ts` barrel has no importers, and it would undermine dynamic loading if anything imported it.
    - `editors/types.ts` duplicates `EditorModule["View"]` in an editor-or-host form.
    - Unused alias exports: `ExplorerEditorModel`, `ExplorerEditorModelState`, `getDefaultExplorerEditorModelState` and `ImageEditorModelState`.
    - `hasTextSelection` has no caller. The other dead items are listed in EDC-3 and EDC-5.
  - **React-era comments** still describe JSX and hooks: `` `host.state.use((s) => s.content)` ``, "BaseImageView", `<TextChrome>`, `<MonacoBody>`, `<EditorError>`, "VideoPlayerEditor.tsx", and ".tsx -> .ts conversion".
  - **Comments name removed editors.** The `TextHostEditorModel` header lists the Graph and Rest editors, which are now boards. `doc/architecture/editors.md:226` lists "Draw" as a `TextHostEditorModel` subclass. `image-export.ts:110` cites `addDrawPage`.
  - **About 100 comment references point at planning IDs whose source is gone:** 18 "walkthrough NN" plus 82 codes such as HS1, PV9, GR8 and EX-IMPL5. The `doc/epics/EPIC-028-editor-architecture/` folder they resolve to was deleted. Readers get an ID instead of a reason.
  - **Docs describe code that no longer exists:**
    - `doc/standards/model-view-pattern.md:850-855` lists `GridPageModel`, `MarkdownViewModel` and `ImageViewModel`.
    - `doc/architecture/editors.md:219` claims every editor can `close()` with a `canClose` guard.
- **Refactor:**
  - Delete the dead modules and aliases.
  - Replace each planning ID with one plain sentence of rationale, or remove it if the code is self-explanatory.
  - Rewrite the React-era comments in native terms.
  - Fix the three docs (editors.md, model-view-pattern.md, editor-guide.md) in the same pass as EDC-7.
- **Risk / notes:** None. This can be done any time; it is best after EDC-3 and EDC-5 so their deletions land together.

## Cross-area notes

- **Boards (05-board-editor):**
  - EDC-1 and BRD-9 propose the same `ContentHostSlot`.
  - EDC-2 needs BRD-3's board factory and BRD-8's contribution registry as the board-side `EditorSource`.
  - `BoardEditorView` assembles `ScriptPanelView` and `EditorStatusBarView` itself (`board/BoardEditorView.ts:14-15`, `:125`, `:135`) instead of reusing text-chrome parts; it would use EDC-7's parts.
  - `board/board-pipe-handler.ts` is a general pipe server (EDC-13).
  - `BoardsSecondaryView` belongs in the board module (EDC-10).
- **Pages and API core (04-api-core):**
  - Deleting `EditorOrHost`/`unwrapToHost` (CORE-2) is a precondition for EDC-3 step 6 and EDC-4. `state.type` readers live in `PageModel`, `PageNavigator`, `PagesLifecycleModel` and `PagesPersistenceModel`.
  - `attachEditorToPage` constructs Monaco statically as a special case (`PagesLifecycleModel.ts:84-90`).
  - `host.revealLine` and `setHighlightText` callers need to move to the editor (EDC-3).
  - Four of the seven `ExplorerEditor` construction sites are in `api/pages` (EDC-10).
  - The `draw-view` restore migration (`PagesPersistenceModel.ts:80`, `api/settings.ts:299`) and the `addDrawPage` API name (`PagesLifecycleModel.ts:630`) remain from the removed Draw editor.
- **UIKit (09-uikit):**
  - EDC-8 removes the `uikit/ImageViewport` → `editors/shared/image-export` cycle (UIK-7).
  - A `MenuButtonView` would replace the focus-restore boilerplate in the HTML toolbar, the Image toolbar and `SplitButtonView`.
  - `FindBarView` and `createContentsElement` are UIKit candidates.
- **About (08-editors-tools):** `AboutGuidePageView` implements `MarkdownBodyModel` inside a view and re-implements the Markdown search state (`about/AboutGuidePageView.ts:347-390`). It should use the shared `FindState` and `followLink` from EDC-9 and EDC-15. EDT-11 covers the Category `instanceof` chain from the consumer side (EDC-11).
- **Scripting:** the `scripting/ai-vision/namespaces/clipboard.ts` namespace calls the clipboard IPC directly; it should use the `ClipboardHistoryModel` from EDC-9.
- **Components:** `components/icons/language-icon-resolver.ts:130` still maps `.note.json` to `NotebookIcon`, left over from the removed Notebook editor.
- **Main:** the recording file-name pattern is defined in `main/recording-service.ts:21` and again in `VideoEditor.ts:113`.

## Keep

- **`TextHostEditorModel`'s internals:** the host-subscription registry that is torn down as one set, the bounded exact-content echo guard (`createEchoGuard`), and `mirrorHostSettings` per-editor setting slots. These are the right pieces; they only need to become composable (EDC-1).
- **`MonacoEditorHostView` / `MonacoDiffEditorHostView`:** uncontrolled widget hosts with explicit owned/borrowed model handling and one write policy. This is a good model for wrapping any imperative widget.
- **The registration table:** `register-editors.ts` keeps literal `import()` per row, and `editor-matchers.ts` holds pure file-name matchers, with the synchronous folder-marker probe isolated in `folder-markers.ts`.
- **`IImageExport`:** a small headless capability contract (just its implementations need sharing, EDC-8).
- **Git tree:** `GitTreeEditorModel` composes the `components/git-tree` models, and `GitTreeEditorView` is pure rendering.
- **`FileDiffBodyModel`:** a body-level model for derived render data, which keeps the diff view a pure render.
- **Menus:** `editor-menu-items.ts` is the single home of the text-file and file-path menus, and `onGetMenuItems` routes through the content host.
- **Comments that explain why:** the comments on order-sensitive code, such as `GridEditor.setRows` and the switch "+" ordering, explain what they protect. That style should replace the planning IDs (EDC-16).
