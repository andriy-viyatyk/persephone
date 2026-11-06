# US-1769: Remove the built-in Notebook editor from the core

## Goal

Remove the built-in Notebook after its published board is available, retaining access to `.note.json` files through that board. This is the final core-removal phase of [EPIC-137](../../epics/EPIC-137.md); this document does not authorize implementation before review.

## Background

`C:/projects/persephone-boards/boards/notebook/board-manifest.json` declares a content-host board, `fileMasks: ["*.note.json"]`, priority 200, version 1.0.0 and minimum bridge 1.49.0. Its guides are in `C:/projects/persephone-boards/boards/notebook/guides/`. The user confirmed that release `notebook-v1.0.0` is published in the catalog with minimum app version 5.0.18, and that the board has been tested and approved. The current core matcher in `src/renderer/editors/base/editor-matchers.ts` claims the suffix at priority 20 and separately detects JSON containing both `"type": "note-editor"` and `"notes"`; removing it removes that content-only switch. `src/renderer/editors/register-editors.ts` registers the editor and two sidebar views.

A fresh case-insensitive `rg` of `notebook|notebook-view|note-editor|NotebookEditor|INotebookEditor|notebook-categories|notebook-tags|\.note\.json` over `src/`, `assets/`, `doc/architecture/`, `doc/standards/`, `qa/`, `scripts/`, and `package.json` found 1,471 matching lines. The classification below covers those hits by file or explicitly scoped group; matching files can contain both material to edit and material to keep. The search does not match every dependency, so the plan also traces imports, state, pins and restore paths.

`src/renderer/api/pages/PagesPersistenceModel.ts` skips an unknown host editor at `constructPage`'s `if (d.host && !editorRegistry.getById(d.editorId)) return null`, then attaches surviving editors. Its `page.editors.length === 0 && !desc.sidebar` test currently lets an editorless page survive when any sidebar descriptor exists. Notebook registers its Categories/Tags panels and `src/renderer/api/pages/PageModel.ts` `getDescriptor()` persists `sidebar` whenever its secondary-views model exists, so old Notebook tabs commonly hit this path. `page.panelEditors` is a subset of `page.editors`, hence zero editors means zero composed panels: saved sidebar state alone cannot render a panel.

The current sidebar exception appears intended to retain sidebar-only pages, but the code does not document its original rationale. Real sidebar-only examples are folder pages from `src/renderer/api/pages/PagesLifecycleModel.ts` `addEmptyPageWithNavPanel()` and the Clipboard page from `showClipboardPage()`: both explicitly attach an `ExplorerEditor` even though their main editor is null. Thus disposing a page only when `page.editors.length === 0` retains those pages, and also retains an old Notebook tab if its separately attached Explorer or another editor survives. For an editorless old tab, the planned generic fix disposes it, `restorePage` returns null, and `applyState` omits it; if no non-right page remains, `applyState` creates an empty page. There is no board conversion. `src/renderer/ui/sidebar/EditorCategoriesView.ts` resolves saved refs against current creatable entries and filters missing ones: an old pin is hidden, its stored ref is not migrated.

New-page creation differs for published and bundled boards. `src/renderer/ui/sidebar/tools-editors-registry.ts` `getCreatableItems()` adds content-host creation entries only for `bundledBoardRegistry.enabledEntries()`; `src/renderer/api/pages/PagesLifecycleModel.ts` `addBundledBoardPage()` rejects non-bundled boards. Published Todo's `C:/projects/persephone-boards/boards/todo/guides/editor.md` instructs users to open a `*.todo.json` file. A trusted published Notebook board has no automatic new-page entry, but `src/renderer/editors/base/editor-switch-options.ts` and `src/renderer/editors/board/custom-editor-registry.ts` match a host's file path or title against board masks; `assets/guides/boards.md` documents the unsaved-page flow. Create a text page, rename its tab `untitled.note.json`, select Notebook in the editor switch, then save it: `C:/projects/persephone-boards/boards/notebook/model.js` `parseNotebook()` treats empty content as a new notebook. This provides creation through existing generic machinery, but not a dedicated New Notebook entry.

`src/shared/i18n/validate-pack.ts` warns and ignores unknown message keys; `scripts/i18n-check-entry.ts` prints every validation warning as INVALID and sets the fatal flag. Removing the English catalog while retaining pack message keys therefore fails `npm run i18n:check`; remove matching `messages` and `source` entries in every pack. `source` is passed through by the validator, so remove its orphan entries deliberately, even though unknown-source keys alone are not checked there.

## Implementation Plan

- [x] BT-081 publication and user testing are confirmed by the user. Preserve `.note.json` file contents and use the board's own guides.
- [ ] Fix generic empty-page restore in `src/renderer/api/pages/PagesPersistenceModel.ts` `constructPage`: dispose and return `{ kind: "invalid" }` whenever no editor survived, regardless of a persisted sidebar descriptor. Leave pages with attached Explorer or other surviving editors intact. Do not branch on Notebook or migrate its descriptor. Verify removed/unknown host IDs with and without sidebar, a valid Explorer-only folder and Clipboard page, and an old Notebook page with a surviving Explorer.
- [ ] Document the generic new-notebook workflow in the current guides and breaking notice: install the board, create a text page, rename its tab to `untitled.note.json`, select Notebook in the editor switch and save; alternatively create/open an empty `*.note.json` file. State that the dedicated built-in New Notebook entry is gone; do not introduce a Notebook-specific core entry.
- [x] Delete `src/renderer/editors/notebook/` in full, `src/renderer/scripting/api-wrapper/NotebookEditorFacade.ts`, `src/renderer/api/types/notebook-editor.d.ts`, `assets/editor-types/notebook-editor.d.ts`, `src/shared/i18n/en/notebook.ts`, `assets/guides/editors/notebook.md`, and `assets/guides/formats/notebook.md`.
- [x] Remove Notebook's matcher including `isEditorContent` from `src/renderer/editors/base/editor-matchers.ts`, module and secondary-view registrations from `src/renderer/editors/register-editors.ts`, the `notebook-view` icon mapping/import from `src/renderer/content/open-with-editor.ts`, and its creatable row/import from `src/renderer/ui/sidebar/tools-editors-registry.ts`. Retain the shared `NotebookIcon` and `.note.json` filename mapping in `src/renderer/theme/language-icons.ts` and `src/renderer/components/icons/language-icon-resolver.ts`: they still identify notebook files in the file tree. No Notebook match exists in `src/renderer/core/utils/language-mapping.ts`; retain its shared language detection.
- [x] Remove Notebook imports, facade union and factory in `src/renderer/scripting/api-wrapper/PageWrapper.ts`; update its structured-content help text. Remove both panel nodes and id mapping in `src/renderer/scripting/ai-vision/page-panels.ts`, and update editor list in `src/renderer/scripting/ai-vision/root.ts`. Remove the `notebook-guide` resource and obsolete format guidance in `src/main/mcp/manifest.ts`.
- [ ] Update `src/renderer/api/types/common.d.ts`, `page.d.ts`, `page-panels.d.ts`, `editors.d.ts` and matching `assets/editor-types/common.d.ts`, `page.d.ts`, `page-panels.d.ts`, `editors.d.ts`; remove `notebook-editor.d.ts` from `assets/editor-types/_imports.txt`. Remove the id from both unions, interface import/union and panel properties; fix descriptive comments. `src/renderer/api/setup/configure-monaco.ts` loads the shipped `_imports.txt`; keep the checked-in copies synchronized and verify IntelliSense loads. Search all imports again, including non-grep dependencies.
- [ ] Remove `notebookCatalog` imports/entries/types in `src/shared/i18n/en/index.ts`, `src/renderer/api/languages.ts`, and `scripts/i18n-export-entry.ts`; remove `editors.notebook` in `src/shared/i18n/en/editors.ts`. Remove `notebook.*` and `editors.notebook` from both `messages` and `source` in all 17 `assets/languages/*.lang.json` packs. Run `npm run i18n:check` and confirm no unknown-key errors, complete counts or new stale hashes.
- [x] `src/renderer/core/traits/TraitRegistry.ts` has `Note` and `NotebookCategory` used by Notebook; `src/renderer/uikit/Tree/Tree.story.ts` also uses `NotebookCategory` for a demo. Replace the story's demo key with an appropriate existing trait before removing Notebook-only enum entries; preserve the generic trait machinery. Update `doc/architecture/trait-system.md` examples accordingly. Verify no other consumers before removal.
- [x] Fix only Notebook-specific comments in shared code: `src/renderer/editors/base/editorRegistry.ts`, `EditorStateStorage.ts`, `TextHostEditorModel.ts`, `src/renderer/api/pages/PageModel.ts`, `src/renderer/editors/board/BoardContentEditorModel.ts`, `src/renderer/editors/browser/BrowserBookmarks.ts`, `src/renderer/editors/explorer/page-explorer.ts`, `src/renderer/editors/grid/GridEditor.ts`, `src/renderer/editors/html/HtmlBodyView.ts`, `src/renderer/editors/markdown/detect-git-root.ts`, `src/renderer/editors/markdown/rehypeHighlight.ts`, `src/renderer/editors/text/TextEditorModel.ts`, `src/renderer/theme/global-styles.ts`, `src/renderer/uikit/Textarea/Textarea.story.ts`, and `src/renderer/uikit/CLAUDE.md`. Keep the behavior, even where comments identify an apparently Notebook-only path; defer architectural cleanup to US-1770.
- [ ] Update current guides: `assets/guides/index.md`, `editors/index.md`, `tabs-and-navigation.md`, `shortcuts.md`, `screens/index.md`, `screens/tabs.md`, `agents/index.md`, `agents/pages.md`, `agents/scripting.md`, `scripting/api/index.md`, `scripting/api/page.md`, `scripting/api/editors.md`, `mcp-setup.md`, `boards.md` and `agents/languages-glossary.md`. Remove obsolete built-in claims, links, shortcuts, facade and MCP examples; where useful explain that the catalog board owns its guides. Keep truthful file-format examples and other editor documentation. `assets/board-template/CLAUDE.md` also lists the old built-in priority example; replace it with a current example.
- [x] Add a breaking-change entry under `## Version 5.0.18 (Upcoming)` in `assets/guides/whats-new.md`, directing users to install the Notebook board from the catalog. Explicitly list all accepted losses: note script execution; HTML/Mermaid/SVG previews; Monaco IntelliSense and commands; file/link-to-category and note-to-category drag (use the card category field); content-only Notebook switch; `INotebookEditor` and `pages.addEditorPage("notebook-view", …)` (use `page.editor.app`); no migration of restored tabs or old pins, and reopening the file through the board or `+` install entry when absent; no dedicated New Notebook entry (create/open a `*.note.json` file, or rename a new text tab and switch to the installed board). Tell users to **save all open notebooks before updating**, including untitled notebooks. Preserve historical release entries.
- [ ] Update developer docs and diagrams listed in Files Changed, including shared mechanisms that remain but no longer have Notebook as a live example. Update live manual QA (`qa/README.md`, `qa/surfaces/README.md`, `qa/surfaces/editors/data.md`, `qa/surfaces/guide-questions.md`, `qa/surfaces/about-guide-browser.md`, `qa/surfaces/where-is-x.md`, `qa/surfaces/panels.md`) to test existing surfaces/board guides instead of deleted Notebook facade, guide and panel APIs; retain historical QA run reports.
- [ ] Verify with build/type check and lint, `npm run i18n:check`, and targeted manual checks: installed board opens an existing `.note.json` and preserves data; absent board offers the `+` install route; ordinary JSON with the old marker has no Notebook switch; new-page menu and old pin contain no built-in Notebook; scripting, panel discovery and MCP resources omit the removed API; file icon remains. Restart with representative old Notebook descriptors, including with and without saved sidebar, a saved Explorer, and a modified cached file: assert empty pages are dropped, Explorer-only pages survive, and the skipped editor cache remains orphaned. Test a new empty text tab renamed `untitled.note.json`, switching to the trusted board, adding a note and saving. The epic accepts no migration.
- [x] `src/shared/board-bridge-version.ts` is currently 1.49.0. No board bridge contract changes are planned, so **no `BOARD_BRIDGE_VERSION` bump**; if implementation changes the bridge, stop and scope that separately per the epic.

Representative edits (not complete patches):

```ts
// src/renderer/api/pages/PagesPersistenceModel.ts - before
if (page.editors.length === 0 && !desc.sidebar) {
    await page.dispose();
    return { kind: "invalid" };
}
// after: sidebar state cannot own a panel without an attached editor
if (page.editors.length === 0) {
    await page.dispose();
    return { kind: "invalid" };
}
```

```ts
// src/renderer/editors/register-editors.ts — before
{ id: "notebook-view", nameKey: "editors.notebook", guidePath: "editors/notebook", hasContentHost: true, load: async () => (await import("./notebook")).notebookModule },
// after: remove this definition and both Notebook secondary-view registrations
```

```ts
// src/renderer/api/types/page.d.ts — before
| ITextEditor | IGridEditor | INotebookEditor | IEnvVarsEditor
// after
| ITextEditor | IGridEditor | IEnvVarsEditor
```

```ts
// src/shared/i18n/en/index.ts — before
notebook: Object.fromEntries(Object.entries(notebookCatalog).map(([key, entry]) => [key, entry.message])),
// after: remove this entry, catalog import and corresponding type member
```

## Implementation notes

- US-1770: retain and investigate shared host state, `EditorStateStorage`, embedded `BodyView` dispatch, adopt/yield, Grid embedded state slots, and the HTML iframe focus workaround. These may now have no live embedded-editor consumer; EnvVars still uses shared host state.
- Runtime checks need a running app: board installation/opening and creation, file icon, old pins, IntelliSense, panel and MCP discovery, and restore/cache cases have not been verified. No cache or descriptor migration is implemented.
- `npm run i18n:check` could not start its esbuild service: `spawn EPERM`. All 17 packs parse and were compared with their original JSON: only the requested keys were removed and all other values are unchanged.

## Concerns

- Unsaved cache is **orphaned**, not migrated or immediately deleted. `src/renderer/content/providers/CacheFileProvider.ts` stores it as `{userData}/data/cache/{editorId}.txt` (`src/renderer/api/fs.ts` sets the cache root); `src/renderer/editors/text/TextFileIOModel.ts` `restore()` reads it only when a modified host is reconstructed with that ID. `PagesPersistenceModel.restorePage()` protects descriptor IDs during construction then releases them; it skips the unknown host before constructing it. `PageModel.dispose()` only calls `fs.deleteCacheFiles` for attached editors, so it does not delete the skipped editor's cache; `src/renderer/api/fs.ts` `releaseCacheIds()` only removes the protection counter. `PagesPersistenceModel.saveState()` later persists only surviving pages/editors, removing the normal descriptor-to-cache recovery route. The cache may remain manually recoverable from disk, subject to its encoding/transformers and any later external cleanup; reopening the saved source uses a new host and does not restore the orphan. Save all notebooks, including untitled ones, before updating.
- If another editor such as Explorer survives, the tab remains as that sidebar-only page, not the Notebook. A descriptor whose only editor was removed is discarded with or without persisted sidebar. Generic test coverage must protect legitimate folder/Clipboard pages.
- `NotebookEditor.ts` stores its three view fields in the host's `editorSettings["notebook-view"]`; no standalone Notebook settings key was found in the searched core. The note toolbar also uses `tab-recent-languages`, which `src/renderer/ui/tabs/PageTabView.ts` shares; retain it. Leave old stored data alone; no pin, tab or settings migration is planned.
- `IContentHost.getEditorState`/`setEditorState` and `TextHostEditorModel.mirrorHostSettings` remain shared (including EnvVars); `EditorStateStorage`, embedded `BodyView` dispatch, adopt/yield paths, Grid notebook-slot handling and HTML focus workaround may become unused or partly unused. Record such findings for US-1770, do not remove them here. The same applies to other zero-user shared code discovered after folder deletion.
- Published-board installation and the `+` route still need end-to-end verification in the target build; publication and user approval are confirmed.

## Acceptance Criteria

- [ ] Built-in Notebook implementation, matcher, content detection, sidebar registrations, new-page entry, facade, declarations, MCP and ai-vision surfaces, English catalog and all translated keys are removed; no dangling imports or deleted guide links.
- [ ] Existing `.note.json` opens via the installed board; without it the catalog install route is available. Filename icon remains. Old content-only detection, old pin and old scripting entry are absent without migration. A new untitled page named `untitled.note.json` can be switched to the installed board and saved; there is no dedicated New Notebook entry.
- [ ] All accepted losses are described in 5.0.18 What's New; active guides, QA scenarios, architecture and standards describe the remaining system accurately.
- [ ] Old unknown-editor descriptors with zero surviving editors are discarded even with sidebar state; valid Explorer-only pages remain. Tests cover sidebar and cache variants, and the orphaned-cache risk is documented. Shared host and embedded-editor behavior remains intact.
- [ ] Build/type check, lint, `npm run i18n:check`, and focused manual checks pass. No bridge version bump, unless separately scoped.

## Files needing NO change

- `src/renderer/theme/language-icons.ts`, `src/renderer/components/icons/language-icon-resolver.ts`: retain NotebookIcon and filename mapping for notebook files.
- `src/renderer/core/utils/language-mapping.ts`: no Notebook-specific mapping found. `src/renderer/content/open-in-persephone.ts`: `.note.json` is still a valid board/file example.
- `src/renderer/editors/base/IContentHost.ts` and shared host state/trait machinery: retain shared mechanisms. `src/renderer/ui/sidebar/pinned-items.ts`, `EditorCategoriesView.ts`, `src/renderer/api/settings.ts`: retain generic stored pins/settings, no migration.
- `assets/boards/excalidraw/lib/deps/shared-HKRY5MY7.js`: bundled third-party LSP notebook terminology, unrelated. `src/renderer/uikit/Tree/Tree.story.ts` is an exception and must change as above.
- `qa/runs/2026-08-09-haiku.md`, `qa/runs/2026-09-06-epic-087-data-surfaces.md`, `qa/runs/2026-09-07-epic-092-guide-questions.md`, `qa/runs/2026-09-07-epic-094-where-is-x.md`, `qa/runs/2026-09-07-epic-095-retirement.md`: historical evidence, not current guidance. Historical Notebook entries in `assets/guides/whats-new.md` remain.
- `package.json`: search produced no Notebook hit; existing scripts suffice. `src/shared/board-bridge-version.ts`, `src/board-shim.ts`: no bridge change. The external board and its guides are outside this core removal.

## Files Changed

The table is the implementation inventory; this planning task itself changes only this document, `doc/active-work.md`, and `doc/epics/EPIC-137.md`.

| Action | Exact paths / scope | Purpose |
|---|---|---|
| Delete | `src/renderer/editors/notebook/` | Entire built-in implementation, views, panels and per-note host |
| Delete | `src/renderer/scripting/api-wrapper/NotebookEditorFacade.ts`; `src/renderer/api/types/notebook-editor.d.ts`; `assets/editor-types/notebook-editor.d.ts`; `src/shared/i18n/en/notebook.ts`; `assets/guides/editors/notebook.md`; `assets/guides/formats/notebook.md` | Retire built-in API, catalog and guides |
| Edit | `src/renderer/api/pages/PagesPersistenceModel.ts` | Drop restored pages with no surviving editors, including stale sidebar descriptors; preserve Explorer-only pages |
| Edit | `src/renderer/editors/base/editor-matchers.ts`; `src/renderer/editors/register-editors.ts`; `src/renderer/content/open-with-editor.ts`; `src/renderer/ui/sidebar/tools-editors-registry.ts` | Remove matcher, registrations, switch icon and creation item |
| Edit | `src/renderer/scripting/api-wrapper/PageWrapper.ts`; `src/renderer/scripting/ai-vision/page-panels.ts`; `src/renderer/scripting/ai-vision/root.ts`; `src/main/mcp/manifest.ts` | Remove facade, panels and resource |
| Edit | `src/renderer/api/types/common.d.ts`, `page.d.ts`, `page-panels.d.ts`, `editors.d.ts`; corresponding `assets/editor-types/` files and `_imports.txt` | Remove IDs, types, imports and comments |
| Edit | `src/shared/i18n/en/index.ts`, `editors.ts`; `src/renderer/api/languages.ts`; `scripts/i18n-export-entry.ts`; all 17 `assets/languages/*.lang.json` | Remove catalog and orphan message/source entries |
| Edit | `src/renderer/core/traits/TraitRegistry.ts`; `src/renderer/uikit/Tree/Tree.story.ts` | Remove Notebook traits after changing demo |
| Edit | `src/renderer/editors/base/editorRegistry.ts`, `EditorStateStorage.ts`, `TextHostEditorModel.ts`; `src/renderer/api/pages/PageModel.ts`; `src/renderer/editors/board/BoardContentEditorModel.ts`; `src/renderer/editors/browser/BrowserBookmarks.ts`; `src/renderer/editors/explorer/page-explorer.ts`; `src/renderer/editors/grid/GridEditor.ts`; `src/renderer/editors/html/HtmlBodyView.ts`; `src/renderer/editors/markdown/detect-git-root.ts`, `rehypeHighlight.ts`; `src/renderer/editors/text/TextEditorModel.ts`; `src/renderer/theme/global-styles.ts`; `src/renderer/uikit/Textarea/Textarea.story.ts`; `src/renderer/uikit/CLAUDE.md` | Notebook-specific comments only |
| Edit | `assets/guides/index.md`, `editors/index.md`, `tabs-and-navigation.md`, `shortcuts.md`, `screens/index.md`, `screens/tabs.md`, `agents/index.md`, `agents/pages.md`, `agents/scripting.md`, `agents/languages-glossary.md`, `scripting/api/index.md`, `scripting/api/page.md`, `scripting/api/editors.md`, `mcp-setup.md`, `boards.md`, `whats-new.md`; `assets/board-template/CLAUDE.md` | Current guides and breaking-change notice |
| Edit | `doc/architecture/key-files.md`, `overview.md`, `folder-structure.md`, `editors.md`, `trait-system.md`, `state-management.md`, `scripting.md`, `secondary-views.md`, `pages-architecture.md`, `browser-editor.md`; `doc/standards/uikit-vs-components-split.md`, `editor-guide.md`, `model-view-pattern.md` | Remove stale built-in references; retain shared architecture |
| Edit | `doc/architecture/diagrams/1-application-layers.mmd`, `3-rendering-architecture.mmd`, `3-editor-switch.mmd`, `3-editor-resolution.mmd`, `4-class-hierarchy.mmd` | Replace removed editor/host examples |
| Edit | `qa/README.md`; `qa/surfaces/README.md`, `editors/data.md`, `guide-questions.md`, `about-guide-browser.md`, `where-is-x.md`, `panels.md` | Retire or replace live built-in Notebook scenarios |
