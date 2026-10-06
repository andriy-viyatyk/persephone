# US-1630: Open with for Explorer files and folder-scoped board icons

## Goal

Let a user choose a compatible editor from a file tree before opening the file, routing directly to that editor. Keep folder-scoped boards out of name-only file icon resolution while preserving the current board claim behavior for editor selection.

## Background

### Current file context menus and entry point

`src/renderer/content/tree-context-menus.ts:45-115` registers the default local-file menu through the shared `app.events.linkContextMenu` channel. For files it adds “Open in New Tab”, “Open in New Window”, “Open with Default App”, and “Show in File Explorer”; directories receive the folder-specific actions at lines 50-70. The current default-app action delegates to `src/renderer/content/open-with-default-app.ts:13`.

`src/renderer/components/tree-provider/TreeProviderViewModel.ts:846-880` emits `linkContextMenu` for tree provider rows. The Explorer builds this view with `FileTreeProvider` (`src/renderer/editors/explorer/ExplorerSecondaryView.ts:254-265`) and archive entries use `ArchiveTreeProvider` through `ArchiveEditorView` (`src/renderer/editors/archive/ArchiveEditorView.ts:22-65,104-110`), so both surfaces use the shared menu handler. Folder/category contents also emit the same channel through `src/renderer/components/tree-provider/CategoryViewModel.ts:639-673`; CategoryView skips the singular channel for multi-selection (lines 642-655). `doc/architecture/context-menu.md:163-190` confirms folder-content views and link lists/tiles use the shared channel. The handler should append only for a single file target, following its existing file-only branch.

Recent Files is a separate surface: `src/renderer/ui/sidebar/RecentFileListView.ts:23-34,54-59` builds a `FileListView`, and its own `getContextMenu` returns Open, Open in New Window, Show in File Explorer, and Remove from Recent at lines 79-108. The new option should be added there too. `src/renderer/components/file-search/FileSearchView.ts` has no row context-menu callbacks (its only `onClick`/`contextMenu` matches are filter controls and text highlighting); search results currently do not expose a row context menu, so this task need not add one. The Explorer's double-click action separately calls `openWithDefaultApp` (`src/renderer/editors/explorer/ExplorerSecondaryView.ts:296-298`); preserve its existing Windows Explorer behavior unless implementation deliberately adds an explicit submenu affordance there. Link editor list/tile rows also invoke `linkContextMenu` (`src/renderer/editors/link-editor/LinkBody.ts:425-430,476-478`), so if the shared handler adds “Open with” generally, file-like links there receive it as well; URL and directory gates already exclude them.

### Editor candidates and file routing

`src/renderer/editors/base/editor-matchers.ts:47-150` is the matcher table for built-in editor IDs. `src/renderer/editors/base/editorRegistry.ts:135-153` resolves the highest-priority built-in file matcher; `EditorRegistry.findEditorsAccepting` at lines 182-195 is instead host-dependent and limited to content-host editors. `EditorRegistry.getSwitchOptions(language, fileName)` at lines 221-235 evaluates the same `switchOption` definitions used to populate built-in editor choices in the toolbar. `src/renderer/editors/base/editor-switch-options.ts:65-130` builds the page toolbar/scripting switch list from `model.findCompatibleEditors()` plus board/catalog entries; it is not a pre-open selector and also merges content-based board claims. Pre-open candidates should reuse the registry's switch matcher definitions with a language derived from the filename, plus file-opening-only built-ins such as image/archive/video viewers that are recognized by `acceptFile` but are not switch options.

`src/renderer/editors/board/custom-editor-registry.ts:595-600` exposes `getBoardsForFile`; `resolveEditorIdForFile` at lines 657-687 applies source capability and priority rules to determine the default. For open-with, use registered built-in definitions and compatible file matchers, and use the switch enumeration only where its host/content assumptions fit; do not change the toolbar's existing behavior merely to support the new menu.

The pipeline already supports an explicit editor target. `src/renderer/api/app.ts:62-65` implements `app.openRawLink(href, { editor })` by placing that id in `ILinkData.target`; `src/renderer/api/types/app.d.ts:125-135` documents it. `src/renderer/content/builtin-schemes.ts:198-209,332-369` retains an explicit target rather than replacing it with the resolver result, and `src/renderer/content/open-handler.ts:55-68` forwards `data.target` into `PagesLifecycleModel.openFile`. `src/renderer/api/pages/PagesLifecycleModel.ts:166-177,255-274` constructs a requested editor directly before restoring it. This is the path to reuse for “Open with”; it avoids opening Monaco first.

By contrast, `app.pages.openFile(path)` in `src/renderer/api/pages/PagesModel.ts:238-253` has no editor option and creates link data without a target. Its public type and script wrapper likewise expose only a path (`src/renderer/api/types/pages.d.ts:53-58`, `src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:225-228`, `assets/editor-types/pages.d.ts:58`). `app.openRawLink(path, { editor })` is already script-wrapped as `AppWrapper.openRawLink` (`src/renderer/scripting/api-wrapper/AppWrapper.ts:136`), so scripts and MCP-facing callers can already request a specific editor through the existing app API. Do not add a `pages.openFile(path, { editor })` overload: it would duplicate that route and require parallel changes to `PagesModel`, `PageCollectionWrapper`, both declaration files, and guides.

### Folder-scoped icon defect

`src/renderer/components/icons/language-icon-resolver.ts:197-210` passes its `fileName` argument as-is to `getBoardsForFile`, then lends an icon only when the resolved default board is in those matches. The argument may be a basename or path. `matchesBoardMasks` skips `folderMasks` only for a bare name (`board-manifest.ts:676-687`); keep this shared predicate unchanged because it also controls defaults and editor-switch candidates (`custom-editor-registry.ts:657-687`, `editor-switch-options.ts:79`). In `resolveFileIcon`, filter out entries with non-empty `folderMasks` only when `fileName` has no `/` or `\` path separator. With a full path, keep the existing `getBoardsForFile(fileName)` result so matching folder-scoped boards can lend their icon.

Icon callers currently pass these shapes:

- `createFileTypeIconElement` forwards its `fileName` unchanged to `resolveFileIcon` (`src/renderer/components/icons/icon-elements.ts:33-38`). `createTreeProviderItemIconElement` supplies `item.title` (a bare display name) for ordinary and HTTP file rows (`icon-elements.ts:97-113`); page/editor icon callers may supply a title or language (`icon-elements.ts:125-129`, `PageTabView.ts:466`).
- `createFileIconElement` accepts a `path` but currently strips it to `fpBasename` before calling `createFileTypeIconElement` (`icon-elements.ts:57-67`). It is used by path-based lists and rows, including Recent Files, File Search, File Grid, and Clipboard (`FileListView.ts:161`, `FileSearchView.ts:340`, `FileGridView.ts:73`, `ClipboardSecondaryView.ts:316`). Preserve its full local path when forwarding so these callers can use a matching folder mask.
- The board icon API passes each supplied `name` unchanged to `resolveFileIcon` (`src/renderer/editors/board/board-file-icons.ts:52-61,67`); its contract accepts either basenames or paths (line 67). Basenames get the name-only rule; paths retain folder matching.

The manifest defines `folderMasks` as a narrowing gate on the containing folder (`board-manifest.ts:135-148`); with masks scoped to `.claude/projects/**` and `.codex/sessions/**`, a log in a relocated `CLAUDE_CONFIG_DIR` or `CODEX_HOME` location is outside the default claim unless that path is added. The explicit submenu deliberately ignores this location gate for board choices, while default resolution continues to honor the full source path.

The large-file claim is confirmed by the bundled Monaco implementation: `node_modules/monaco-editor/esm/vs/editor/common/model/textModel.js:119,520-524` sets a 256 Mi-character threshold and throws `BugIndicatingError` from `getValue()` when exceeded. `src/renderer/editors/shared/MonacoEditorHostView.ts:100-118` calls `model.getValue()` inside `setValue()` before applying the change, so opening through Monaco can hit this failure. A direct requested-target open avoids constructing Monaco as the first editor, provided the chosen editor itself can process the file.

## Implementation Plan

- [x] Add “Open with” as a submenu in `src/renderer/content/tree-context-menus.ts` for one file target in the Explorer, archive, category/folder, and generic link-item surfaces; add the equivalent submenu to `src/renderer/ui/sidebar/RecentFileListView.ts:79-108`, which owns a separate list menu. Keep File Search out of scope because its result rows have no context menu. Put all editor destinations in one submenu and move the current OS action inside as the final `Default App` item. Order the resolved default first, then other matching built-in editors, then eligible matching boards (match `fileMasks` by basename regardless of `folderMasks`). Label built-ins with `editorRegistry.getSwitchOptions(...).getOptionLabel(id)` when available, otherwise the registry definition's `name`; prefix board labels with `Board: ` plus `CustomEditorMatch.name`. Append ` (Default)` to the first entry's label. Give each row a stable `MenuItem.id` based on its editor id.
- [x] Submenu icons (user request after implementation): boards show their own glyph (`createBoardGlyphElement`), grid / notebook / link / archive editors show their theme icons, every other built-in editor including the Text Editor shows the generic file icon (`DefaultIcon`), and **Default App** reuses the parent `open-link` icon. Map lives in `src/renderer/content/open-with-editor.ts` (`BUILT_IN_EDITOR_ICONS`).
- [x] Add `getBoardsForFileName(filePathOrName)` to `src/renderer/editors/board/custom-editor-registry.ts`. It must use the same `state.entries` array and preserve its order while checking only normalized `fileMasks` against the basename. Import `matchesFileMask` from `board-manifest.ts`; do not call `matchesBoardMasks` here because it enforces `folderMasks` when a path is supplied. Exact method:

  ```ts
  getBoardsForFileName(filePathOrName: string): CustomEditorMatch[] {
      if (!filePathOrName) return [];
      const fileName = fpBasename(filePathOrName);
      return this.state.get().entries.filter((entry) =>
          entry.fileMasks.some((mask) => matchesFileMask(fileName, mask))
      );
  }
  ```

- [x] Add a file-open candidate projection to `src/renderer/editors/base/editor-switch-options.ts`. Derive `fileName = fpBasename(path)`, then `language = getLanguageByExtension(fpExtname(fileName))?.id ?? "plaintext"` (`src/renderer/core/utils/language-mapping.ts:40-42`); pass that language and basename to `editorRegistry.getSwitchOptions(language, fileName)` (`src/renderer/editors/base/editorRegistry.ts:225-241`). Merge those switch-option ids with `editorRegistry.getAll()` definitions (`editorRegistry.ts:116-118`) whose `(definition.match?.acceptFile?.(fileName) ?? -1) >= 0`. This registry query includes image/archive/video viewers without hardcoding their ids; `getSwitchOptions` supplies language-switchable editors such as Markdown/SVG/HTML previews. Resolve default with `resolveEditorIdForFile(path) ?? "monaco"`, put it first once, and preserve registry priorities/order for remaining candidates. Then append eligible entries from `customEditorRegistry.getBoardsForFileName(fileName)`, applying the existing local/non-local source rule from `resolveEditorIdForFile` (`custom-editor-registry.ts:665-681`). Built-in option labels use the switch helper's `getOptionLabel(id)` where the id is in its options, else `editorRegistry.getById(id)?.name`; prefix board names with `Board: ` plus `CustomEditorMatch.name` (`custom-editor-registry.ts:88-100`), and append ` (Default)` to the resolved default. The existing `getEditorSwitchOptions(model)` is unsuitable because it requires an open page/host and uses folder-gated file matching.
- [x] Route each submenu leaf through shared `src/renderer/content/open-with-editor.ts`, used by tree and Recent Files menus. On activation, recompute file-open candidates for `(path, editorId)`. If the id is no longer offered, call `app.ui.notify("This editor is no longer available for this file.", "warning")` and stop; otherwise open with `app.openRawLink(path, { editor: editorId })` so a fresh page constructs the selected editor first. Keep “Default App” on `openWithDefaultApp(path)` and preserve context-menu script compatibility.
- [x] For an already-open path, have `open-with-editor.ts` find the existing page by path, activate it, and if its editor id differs call `page.switchMainEditor(editorId)`. This is the toolbar's underlying switch mechanism (`PageToolbarView.ts:359-363`; `PageModel.ts:577-582`). The scripting `page.editorSwitches.switchTo(id)` is unrestricted beyond visible options and verifies the resulting id (`page-editor-switches.ts:46-61`); it delegates to the same `switchMainEditor`. For a file page, that method does not validate against the folder-gated options: the board branch finds registered board ids in `customEditorRegistry.entries` (`editor-switch.ts:152-171`), and the built-in branch accepts any id returned by `editorRegistry.getById` (`207-227`). Thus a registered file-mask board omitted by the folder-gated toolbar list and a text-host editor can both be selected. If release confirmation is declined and the id remains unchanged, show an informational notification that the current page remains in its existing editor.
- [x] Keep “Default App” wired to `openWithDefaultApp(path)` and preserve existing context-menu compatibility scripts and file-only gating.
- [x] In `src/renderer/components/icons/language-icon-resolver.ts`, apply the folder-scope icon filter only when `fileName` has no path separator, matching `matchesBoardMasks`' bare-name check:

  ```ts
  const boardMatches = customEditorRegistry.getBoardsForFile(fileName);
  const iconBoardMatches = /[\\/]/.test(fileName)
      ? boardMatches
      : boardMatches.filter((board) => board.folderMasks.length === 0);
  const resolvedEditorId = resolveEditorIdForFile(fileName);
  const boardRoot = iconBoardMatches.some((board) => board.editorId === resolvedEditorId)
      ? parseBoardEditorId(resolvedEditorId ?? "")
      : null;
  ```

  With a full path, `getBoardsForFile` continues applying `folderMasks`, so only a matching scoped board can lend its icon. In `src/renderer/components/icons/icon-elements.ts`, preserve full paths in `createFileIconElement` and pass a tree row's `item.href` when `isPlainLocalPath(item.href)` is true; continue using `item.title` for archive, URL, and virtual sources. Keep ordinary extension/language icons and folderless board behavior unchanged; do not change `matchesBoardMasks` or editor resolution/switching.
- [x] Keep the scripting/MCP surface unchanged: `app.openRawLink(path, { editor })` already supports explicit IDs, is wrapped by `AppWrapper` (`src/renderer/scripting/api-wrapper/AppWrapper.ts:136`), and is documented in `assets/guides/scripting/api/app.md:161-190` with matching declarations in `src/renderer/api/types/app.d.ts` and `assets/editor-types/app.d.ts`. Do not add a `pages.openFile(path, { editor })` overload: that API currently serves file or folder open and an overload would duplicate an existing supported route while touching `PagesModel`, `PageCollectionWrapper`, two declaration files, and docs.
- [x] Address menu selectors per `doc/architecture/ui-element-contract.md:7-20,60-70,289-298`: popup menus are explicitly transient and outside the shell selector contract. `MenuItem.id` becomes `data-id` on a row (`src/renderer/uikit/Menu/MenuView.ts:167-175`), while `MenuModel.idOf` provides a label-derived fallback (`MenuModel.ts:45-47`). Give generated editor rows explicit stable ids based on editor id; do not add `data-name` contract entries for transient menu items.
- [x] At implementation completion, update `assets/guides/tabs-and-navigation.md` (Explorer panel and context-menu usage), `assets/guides/boards.md` (user-facing board matching), `assets/guides/agents/boards.md` (folderMasks + icon rule), `assets/guides/whats-new.md` (a NEW entry under "Version 5.0.8 (Upcoming)"; never edit older release sections such as the US-934 entry, which are history), `doc/architecture/context-menu.md`, and `doc/architecture/key-files.md`. Also update the wording comment in `src/renderer/content/open-with-default-app.ts`. There is no standalone `assets/guides/explorer.md`; use the existing Explorer section in Tabs & Navigation.

## Concerns

- Context-menu coverage is verified: Explorer, archive, and folder/category trees share the tree-provider channel; Recent Files owns a separate FileList menu; File Search has no result-row menu; Link editor items also use the generic link channel. Keep implementation on those existing surfaces.
- Toolbar candidates are model/host based, so do not call `getEditorSwitchOptions(model)` before opening. Reuse its underlying registry switch matchers and add registered definitions with file `acceptFile` matchers for file-opening viewers.
- Registered state eligibility is already enforced upstream. `refresh()` assembles entries from trusted `boardTrust.listPaths()` and `bundledBoardRegistry.enabledEntries()`, then drops `installed` sources before writing `state.entries` (`custom-editor-registry.ts:473-505,528-542`). `enabledEntries()` filters ids in `disabled-bundled-boards` (`bundled-board-registry.ts:73-79`). The new filename-only getter should use that same entry list; it needs no second trust/enabled filter. This excludes untrusted installed boards and disabled bundled boards.
- Standalone boards with no matching `fileMasks` are not file choices. A board with matching file masks and a standalone declaration remains eligible for the explicit file choice; standalone affects untitled launches (`board-manifest.ts:943-961`).
- Non-local source eligibility stays as implemented: a board may handle archive entries/URLs if it owns a pipe (`content-host` or `stream-host`) or declares `editorSources: "any"`; a simple local-only board is excluded (`custom-editor-registry.ts:665-681`, `board-manifest.ts:192-212`).
- For an already-open file, activate the existing page and switch only when its editor differs. `openFile` deduplicates by path and activates at `PagesLifecycleModel.ts:647-665`; `PageModel.switchMainEditor` delegates to the toolbar's mechanism (`PageModel.ts:577-582`, `PageToolbarView.ts:359-363`). `PageEditorSwitchesNode.switchTo` accepts any id, not only visible options, and verifies the result (`page-editor-switches.ts:46-61`). For a file page, `switchMainEditor` does not require membership in folder-gated options: its board branch checks registered board entries (`editor-switch.ts:152-171`) and its text-host branch checks the editor registry id (`207-227`). If release confirmation is declined, report that the page remains in its current editor.
- On menu activation, recompute file-open options in `open-with-editor.ts`. If the id is no longer offered, call `app.ui.notify("This editor is no longer available for this file.", "warning")` and stop; `buildEditorById` accepts an unregistered `board-editor:<root>` by falling back to the supplied root (`PagesLifecycleModel.ts:182-197`). For a fresh valid choice, use `app.openRawLink(path, { editor })` so target construction precedes content loading.
- Monaco's 256 Mi-character guard and `getValue()` exception are in `node_modules/monaco-editor/esm/vs/editor/common/model/textModel.js:119,520-524`; `MonacoEditorHostView.setValue` calls `getValue()` at lines 100-104. A direct target avoids this path only when the selected editor does not instantiate Monaco for the same content first.
- The scripting API already has `app.openRawLink(path, { editor })`; retain it without adding a `pages.openFile` overload. Its guide and declaration surfaces already document the editor option.
- The resolved default is first and deduplicated; append ` (Default)` to its label. Built-in switch candidates use `getOptionLabel`, file-opening-only built-ins use `EditorDefinition.name`, board labels use `Board: ${name}`, and the OS action is `Default App`.
- Update current Tabs & Navigation and What's New instructions, context-menu/key-file docs, and the helper comment for the changed OS-action label. Keep the US-934 completion record as historical wording; `rg` found no matching references in `qa/`.

## Acceptance Criteria

- [x] A file tree context menu exposes one “Open with” submenu with the default target first, other matching built-in editors, matching/eligible boards, and a Default App action.
- [x] Choosing a submenu editor passes its id into the first open request, so a large file is not first loaded into Monaco.
- [x] Selecting an editor for an already-open file activates that page and switches it through `PageModel.switchMainEditor` when necessary; declining release leaves the old editor active with an informational notification. Fresh opens honor the target before editor construction.
- [x] File-mask board choices are offered independent of folder scope; folder scope still controls default editor resolution.
- [x] Name-only icon resolution does not use a board icon when that board has non-empty `folderMasks`; folderless board icons and ordinary file icons are unchanged.
- [x] Existing default-open, Default App, scriptable context-menu, archive/URL source gating, and standalone-editor behavior remain coherent.
- [x] The existing `app.openRawLink(path, { editor })` API remains sufficient for scripting and MCP callers; no new scripting declarations are required.
- [x] Selecting a stale/unavailable editor option shows a warning and makes no open/switch request.
- [x] Developer and user docs listed in the implementation plan describe the final behavior.

### Before → after menu shape

Before (`tree-context-menus.ts`):

```text
Open in New Tab
Open in New Window
Open with Default App
Show in File Explorer
```

After (planned):

```text
Open in New Tab
Open in New Window
Open with > [resolved default editor] (Default), [other compatible editors], [matching boards], Default App
Show in File Explorer
```

The selected leaf routes immediately through the existing target field:

```ts
// Before: file open has no editor override and resolves its default.
app.events.openRawLink.sendAsync(createLinkData(path));

// After: the chosen editor is the first editor constructed for the file.
app.openRawLink(path, { editor: editorId });
```

For icon resolution, keep the shared mask predicate unchanged and filter only bare-name candidates:

```ts
// Before: a bare filename skips folderMasks, so a scoped board can enter the icon candidates.
const boardMatches = customEditorRegistry.getBoardsForFile(fileName);

// After: full paths retain folder-gated matches; bare names exclude scoped boards.
const iconBoardMatches = /[\\/]/.test(fileName)
    ? boardMatches
    : boardMatches.filter((board) => board.folderMasks.length === 0);
const resolvedEditorId = resolveEditorIdForFile(fileName);
const boardRoot = iconBoardMatches.some((board) => board.editorId === resolvedEditorId)
    ? parseBoardEditorId(resolvedEditorId ?? "")
    : null;
```

`createFileIconElement` must forward a path instead of reducing it to a basename, and tree-provider rows must forward `item.href` only for plain local paths. Their current input shapes are recorded above.

```ts
// Before: the path-taking helper discards the directory before resolution.
fileName: fpBasename(options.path)

// After: the resolver can apply folderMasks when this is a local path.
fileName: options.path

// Tree-provider rows retain display-name behavior for non-local/virtual sources.
const fileName = isPlainLocalPath(item.href) ? item.href : item.title;
```

### Files investigated and not planned for changes

| File | Why no change is currently planned |
|---|---|
| `src/renderer/editors/base/editor-matchers.ts` | Existing matcher declarations should be reused, not duplicated or behavior-changed. |
| `src/renderer/editors/base/editorRegistry.ts` | Existing `getAll`, `getSwitchOptions`, and matcher APIs suffice; the new file-open projection belongs beside the page switch option logic. |
| `src/renderer/editors/board/board-manifest.ts` | Keep `matchesBoardMasks` semantics unchanged for default resolution and switch options. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Its explicit-target path already constructs the requested editor directly; click-time revalidation belongs in `open-with-editor.ts`. |
| `src/renderer/content/open-handler.ts`, `src/renderer/content/builtin-schemes.ts` | Existing `ILinkData.target` propagation routes a requested editor into direct construction. |
| `doc/architecture/ui-element-contract.md` | Popup menus are transient and excluded from the `data-name` contract; use stable `MenuItem.id` / `data-id` for menu rows. |
| `src/renderer/components/file-search/FileSearchView.ts` | Search result rows have no context-menu builder today. |
| `doc/tasks/completed.md` | Keep US-934's original label as historical completion wording. |
| `qa/` | `rg -F "Open with Default App" assets/guides qa doc src` found no QA references. |
| `node_modules/monaco-editor/esm/vs/editor/common/model/textModel.js` | Dependency source used only to verify the large-file guard; never modify vendor dependency files. |

### Review findings resolved

1. **Path-aware icons:** filter `folderMasks` only when the resolver input has no slash or backslash. Preserve full local paths through `createFileIconElement` and local tree-row icon creation. Name-only callers keep normal icons for scoped boards; full paths still show a scoped board icon when its folder matches.
2. **Folder-agnostic board choices:** add `getBoardsForFileName(filePathOrName)` using `state.entries`, `fpBasename`, and `matchesFileMask` only. `state.entries` already contains trusted and enabled bundled boards only; `refresh()` uses `enabledEntries()` and excludes untrusted installed sources, so the getter adds no second trust/disabled filter.
3. **Open-page and stale-choice behavior:** activate an existing page and switch its editor through `PageModel.switchMainEditor` if needed; this handles both registered board ids outside the visible folder-gated options and registered text-host ids. If release is declined, show an informational notification. Recompute candidates at click time; if the selected id is no longer offered, show a warning and do nothing.
4. **Built-in candidates and labels:** derive language with `getLanguageByExtension(fpExtname(fpBasename(path)))?.id ?? "plaintext"`; combine `getSwitchOptions(language, fileName)` with `editorRegistry.getAll()` definitions accepted by `match.acceptFile`. This gets file-opening viewers from the registry instead of hardcoding their ids. Use switch labels when available, registry names otherwise, `Board: <name>` for boards, ` (Default)` on the resolved default, and `Default App` last.
5. **Legacy label references:** update the current menu implementation, helper comment, `assets/guides/tabs-and-navigation.md`, a new 5.0.8 entry in `assets/guides/whats-new.md` (older release sections stay unchanged), `doc/architecture/context-menu.md`, and `doc/architecture/key-files.md`; these are listed in Files Changed Summary. Leave the `doc/tasks/completed.md` US-934 entry as historical wording. No QA references matched the grep.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/content/tree-context-menus.ts` | Build the “Open with” submenu and route chosen editor ids directly. |
| `src/renderer/content/open-with-editor.ts` | New shared candidate recheck, stale-choice warning, existing-page switch, and direct-open handler. |
| `src/renderer/content/open-with-default-app.ts` | Update its comment to name the `Default App` submenu entry. |
| `src/renderer/ui/sidebar/RecentFileListView.ts` | Add the same submenu to the Recent Files list's separate context menu. |
| `src/renderer/editors/base/editor-switch-options.ts` | Add file-name-based built-in and board candidates, ordering, and labels. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Add `getBoardsForFileName`, matching only `fileMasks` and preserving entry order. |
| `src/renderer/components/icons/language-icon-resolver.ts` | Apply the folder-mask icon filter only for bare-name lookup. |
| `src/renderer/components/icons/icon-elements.ts` | Preserve known local paths for folder-scoped icon resolution. |
| `assets/guides/tabs-and-navigation.md` | Update Explorer context-menu list and old “Open with Default App” instructions. |
| `assets/guides/whats-new.md` | Add a new entry under "Version 5.0.8 (Upcoming)" describing the Open with submenu and its Default App leaf; leave older release sections (US-934) unchanged. |
| `assets/guides/boards.md`, `assets/guides/agents/boards.md` | Explain scoped matching, explicit board choice, and icon behavior. |
| `doc/architecture/context-menu.md` | Document the submenu and replace the old visible action wording. |
| `doc/architecture/key-files.md` | Update the helper description to name its `Default App` submenu use. |
