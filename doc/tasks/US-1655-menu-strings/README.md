# US-1655: Menus, tree providers and shared file controls

**Epic:** [EPIC-125 — Extract every UI string](../../epics/EPIC-125.md) · **Status:** In Progress

## Goal

Extract app-owned visible text in the menu, tree-provider, file-search, file-list, git-tree and pipe-status surfaces into the typed English catalog. Preserve agent and script contracts with stable menu IDs, data values and English-only fields where the displayed value is also identity or external data.

## Background

EPIC-125 decisions E1–E7 apply. Use the current flat `<area>.<entry>` key shape and lazy `t()` lookup. Add `src/shared/i18n/en/menus.ts`, register it in `src/shared/i18n/en/index.ts`, and use `common` for generic strings already defined there. The related `shell` catalog already contains several menu labels from US-1654. Plurals use CLDR category objects with `params.count`; complete sentences use one message with placeholders.

The scoped ESLint run on 2026-10-10 found 117 `vanilla-view/no-hardcoded-ui-strings` reports in the requested paths. Ten belong to `src/board-context-menu.ts`; this file runs in the board webview before a locale is available and is deferred to phase 3, when D10 passes `persephone.locale` to the shim. That leaves 107 in-scope reports. A separate run over `src/renderer/content/open-with-*.ts` found 5 more, for **112 in-scope lint-report occurrences**. Repeated call-site occurrences are counted separately. The additional source audit below identifies UI text the rule misses.

### Lint inventory

| File | Reports | Reported source text (repeated positions count separately) |
|---|---:|---|
| `src/board-context-menu.ts` — **deferred to phase 3** | 10 | `Save Image`; `Open Link`; `Copy Link`; `Open Image in New Tab`; `Copy Image`; `Save Image As…`; `Cut`; `Copy` (2); `Paste`. Imported by `src/board-shim.ts` and executed inside the board webview; no active locale is available until D10 passes `persephone.locale`. Leave unchanged in US-1655. |
| `src/renderer/components/file-list/FileListView.ts` | 4 | `Search...` (2); `Clear Search`; `no files` |
| `src/renderer/components/file-search/FileSearchView.ts` | 9 | `Search...` (2); `Include (e.g. *.ts, *.tsx)` (2); `Exclude — adds to Settings (e.g. dist, *.min.js)` (2); `Toggle Filters` (2); `No results found` |
| `src/renderer/components/git-tree/GitBranchesModel.ts` | 3 | `Failed to fetch: {error}`; `Pull stopped with conflicts: {list}`; `Failed to pull: {error}` |
| `src/renderer/components/git-tree/GitChangesModel.ts` | 5 | `Failed to stage: {error}`; `Failed to unstage: {error}`; `Failed to reset: {error}`; `Failed to create branch: {error}`; `Failed to commit: {error}` |
| `src/renderer/components/git-tree/git-refs-tree.ts` | 3 | `Branches`; `Remotes`; `Tags` |
| `src/renderer/components/pipe-status/PageLoadingShellView.ts` | 2 | `Close page`; `Retry` |
| `src/renderer/components/pipe-status/PagePipeStatusView.ts` | 4 | `Content loading progress` (2); `Dismiss pipe error`; `Pipe status: {state}` |
| `src/renderer/components/tree-provider/CategoryViewImpl.ts` | 6 | `Search...` (2); `Clear`; `View Mode` (2); `({count} selected)` |
| `src/renderer/components/tree-provider/TreeProviderViewImpl.ts` | 3 | `Close Search`; `Search...` (2) |
| `src/renderer/components/tree-provider/item-crud-actions.ts` | 8 | `Enter file name:`; `New File`; `Enter folder name:`; `New Folder`; `Enter new name:`; `Rename {kind}`; `Are you sure you want to delete "{title}"?`; `Delete Confirmation` |
| `src/renderer/components/tree-provider/item-menus.ts` | 15 | `Rename...`; `Delete`; `New File...` (2); `New Folder...` (2); `Cut` (2); `Copy` (2); `Paste` (3); `Open`; `Open Terminal here` |
| `src/renderer/components/tree-provider/os-clipboard.ts` | 4 | `The clipboard contains no files.`; `{count} item(s) already exist here and will be overwritten:\n{names}`; `Overwrite?`; `Some items could not be pasted:\n{errors}` |
| `src/renderer/components/tree-provider/plural-actions.ts` | 6 | `Cut ({count})`; `Copy ({count})`; `Delete ({count})`; `Do you want to delete {count} items?`; `Delete Confirmation`; `Some items could not be deleted:\n{errors}` |
| `src/renderer/components/tree-provider/tree-drop-actions.ts` | 15 | `Move "{source}" to "{target}/"?`; `Move`; `Cannot move folder "{name}" into itself.`; `Move {items} to "{target}/"?`; `{count} item(s) already exist here and will be overwritten:\n{names}`; `Overwrite?`; `Some items could not be moved:\n{errors}`; `{count} file(s) already exist here and will be overwritten:\n{names}`; `Overwrite files?`; `Move or copy {items} into "{target}"?`; `Move or Copy`; `Some items could not be {action}:\n{errors}`; `Failed to {action}.` |
| `src/renderer/editors/shared/FindBarView.ts` | 6 | `Previous Match (Shift+F3)` (2); `Next Match (F3)` (2); `Close (Esc)` (2) |
| `src/renderer/editors/shared/editor-menu-items.ts` | 8 | `Open in Browser`; `Show in File Explorer`; `Copy File Path`; `Save`; `Save As...`; `Rename`; `Decrypt`; `Make Unencrypted` |
| `src/renderer/editors/shared/image-export.ts` | 2 | `Save Image`; `Failed to save image: {error}` |
| `src/renderer/editors/shared/link-open-menu.ts` | 4 | `Open in Default Browser`; `Open in Internal Browser`; `Open in {profile}`; `Open in Incognito` |
| `src/renderer/content/open-with-default-app.ts` | 1 | `Could not open {path}: {error}` |
| `src/renderer/content/open-with-editor.ts` | 4 | `Open with`; `Default App`; `This editor is no longer available for this file.`; `The current page remains in its existing editor.` |
| **In-scope total** | **112** | 107 scoped-folder reports plus 5 from `open-with-*.ts`. |
| Deferred board total | 10 | Remain in lint until phase 3 supplies the locale to the shim. |

The source strings above are the pre-extraction lint inventory. Collision messages use CLDR entries (`overwriteItems` and `overwriteFiles`) for the item/file count; delete confirmations use `deleteItemsConfirmation`; selection uses the complete CLDR `selectedCount` message. Search summaries and pipe duration messages also use CLDR objects. Tree-drop failures choose complete moved or copied messages (`itemsCouldNotBeMoved` / `itemsCouldNotBeCopied`, with separate overflow variants, and `failedToMove` / `failedToCopy`) in code. No translated action word is inserted into another message. Find tooltips use complete messages with literal `{shortcut}` parameters.

## Progress

- [x] Apply review corrections: defer `src/board-context-menu.ts` to phase 3; keep it unchanged in this task.
- [x] Confirm whole-message selection for moved/copied sentences and CLDR count requirements.
- [x] Record dialog result ID comparisons to preserve.
- [x] Add/register the `menus` catalog and extract scoped UI text.
- [x] Add stable IDs to translated menu items; retain existing data-name, editor IDs, and dialog IDs.
- [x] Run scoped ESLint, `npm run lint`, `npm run typecheck`, and `npm run build-prod`.
- [ ] Live en-XA verification by the user; `npm run i18n:check` is intentionally skipped in this sandbox.

Implementation added 148 typed English entries under `menus`. The scoped ESLint run reports zero `vanilla-view/no-hardcoded-ui-strings` findings. `npm run lint` exits successfully with 723 repository-wide warnings and no errors; `npm run typecheck` and `npm run build-prod` pass. The 10 board-context-menu reports remain deferred to phase 3.

## Implementation Plan

### 1. Catalog and call-site extraction

- Add `src/shared/i18n/en/menus.ts` using `EnglishCatalogEntry` from `common.ts`, then register `menusCatalog` in `src/shared/i18n/en/index.ts` and its derived catalog type.
- Reuse `common.open` and `common.loading` where their context matches. Check `shell` before adding duplicates: it already has `shell.openInNewTab`, `shell.openInNewWindow`, `shell.openTerminalHere`, and `shell.showInFileExplorer`. Keep task-context labels such as Copy/Cut/Paste/Delete/Save/Search/Retry/Find in `menus`.
- Extract app-owned text in the lint inventory and the additional source-audit inventory below. Resolve `t()` while constructing/updating view props, not in module-level translated constants.
- In `src/renderer/components/tree-provider/item-menus.ts`, translate the conditional `Copy Href` / `Copy Path` labels, and add stable, menu-local IDs to every converted item. Do the same for multi-select labels, shared editor menus, link menus, the open-with parent item, and shared host tree-context menus. `src/board-context-menu.ts` is deferred unchanged to phase 3 under D10.
- Convert notifications, prompts, confirmations, progress labels and fallback status text in the tree-provider, git-tree, file-search and pipe-status sources. Interpolate errors, paths, names, refs and result details as data; use a complete translated wrapper where app-authored text surrounds them.
- `src/renderer/components/file-search/FileSearchView.ts`: make the status messages complete catalog sentences. Searching, result counts, truncation and recommendations should be whole messages with placeholders; count forms use CLDR objects.
- `src/renderer/components/tree-provider/CategoryViewImpl.ts`, `plural-actions.ts`, `tree-drop-actions.ts`, and `os-clipboard.ts`: use CLDR messages for all visible item/file counts and whole messages for collision, confirmation, progress and failure text. Avoid singular/plural branches that build sentence fragments. For tree drops, select separate complete `itemsCouldNotBeMoved` / `itemsCouldNotBeCopied` and `failedToMove` / `failedToCopy` messages in code; never translate `{action}` and insert it into a sentence.
- `src/renderer/components/pipe-status/PagePipeStatusModel.ts` and `PipeStageListView.ts`: translate fixed fallback text and complete UI-owned progress/duration messages. Use CLDR categories for count messages. Do not translate provider-supplied stage/status data.
- `src/renderer/editors/shared/FindBarView.ts`: extract the unseen `Find...` default placeholder and `No results` counter, in addition to linted button titles. Tooltip shortcut hints use `{shortcut}` placeholders, with `Shift+F3`, `F3`, and `Esc` passed literally under E5.
- Keep `src/renderer/content/open-with-editor.ts` editor-option IDs as the stable identity. Its built-in menu item labels are localized only when a `labelKey` exists; board/editor-provided option names remain data. Give the parent `Open with` item its own stable ID.

Use this ID mapping so an implementation does not derive IDs from translated labels. IDs need only be unique within each menu; where two alternatives share a menu action, keep the alternatives distinct:

| Menu owner | English label | Stable ID |
|---|---|---|
| `tree-provider/item-menus.ts` | Open; Copy Href; Copy Path; Cut; Copy; Paste; Rename...; Delete; New File...; New Folder...; Open Terminal here | `open`; `copy-href`; `copy-path`; `cut`; `copy`; `paste`; `rename`; `delete`; `new-file`; `new-folder`; `open-terminal-here` |
| `tree-provider/plural-actions.ts` | Copy Hrefs ({count}); Copy Paths ({count}); Cut ({count}); Copy ({count}); Delete ({count}) | `copy-hrefs`; `copy-paths`; `cut`; `copy`; `delete` |
| `CategoryViewImpl.ts` view-mode popup | List; Landscape; Landscape (Large); Portrait; Portrait (Large) | `list`; `tiles-landscape`; `tiles-landscape-big`; `tiles-portrait`; `tiles-portrait-big` (existing mode IDs retained) |
| `editors/shared/editor-menu-items.ts` | Open in Browser; Show in File Explorer; Copy File Path; Save; Save As...; Rename; Decrypt; Encrypt; Change Password; Make Unencrypted | `open-in-browser`; `show-in-file-explorer`; `copy-file-path`; `save`; `save-as`; `rename`; `decrypt`; `encrypt`; `change-password`; `make-unencrypted` |
| `editors/shared/link-open-menu.ts` | Open in Default Browser; Open in Internal Browser; Open in {profile}; Open in Incognito | `open-in-default-browser`; `open-in-internal-browser`; `open-in-profile-{profile-name-slug}-{profile-name-codepoints}`; `open-in-incognito` |
| `content/tree-context-menus.ts` | Open in Rest Client; Open in New Tab; Open in New Window; Show in File Explorer | `open-in-rest-client`; `open-in-new-tab`; `open-in-new-window`; `show-in-file-explorer` |
| `content/open-with-editor.ts` | Open with; Default App; editor choices | `open-with`; existing `open-with:default-app` and `open-with:{editorId}` |

Board-webview items are deliberately not converted in US-1655. `src/board-context-menu.ts` is imported by `src/board-shim.ts` and runs before the locale bridge exists. Its 10 lint reports and host-owned strings are deferred to phase 3, after D10 supplies `persephone.locale`; the file remains unchanged here.

Before:

```ts
label: `Copy (${n})`,
```

After:

```ts
id: "copy",
label: t("menus.copyItems", { count: n }),
```

### 2. Additional app-owned UI text missed by lint

Verified source audit found these further extraction candidates:

| File | Missed text / handling |
|---|---|
| `src/renderer/components/tree-provider/item-menus.ts` | Conditional `Copy Href` / `Copy Path`; IDs are to be attached to both possible menu choices under one semantic action ID if they represent the same action in that menu. |
| `src/renderer/components/tree-provider/plural-actions.ts` | `Copy Hrefs ({count})` / `Copy Paths ({count})` conditional labels; CLDR count message. |
| `src/renderer/components/tree-provider/CategoryViewImpl.ts` | `No matching items`, `Empty folder`, `Loading...`, item counts and selected count; selected count is a complete CLDR message, not a concatenated suffix. View-mode labels retain their existing mode IDs (`list`, `tiles-landscape`, etc.) as identity. |
| `src/renderer/components/tree-provider/TreeProviderViewModel.ts` and `CategoryViewModel.ts` | Provider failure fallback `Failed to load items`; inspect every path which places this fallback in the view. `err.message` remains error/data content under E3. |
| `src/renderer/components/tree-provider/plural-actions.ts`, `os-clipboard.ts`, `tree-drop-actions.ts` | `Deleting...`, `Moving...`, `{verb}...`, and progress sentences `Deleting {done} of {total}: {name}` / `{verb} {done} of {total}: {name}`. Count placeholders and action names are message parameters; file names are data. |
| `src/renderer/components/file-search/FileSearchView.ts` | Searching status, `No results`, result/file summary, and truncation hint are complete messages. Searching, result summary, and truncation summary use CLDR forms for file counts. |
| `src/renderer/editors/shared/FindBarView.ts` | `Find...` (default placeholder) and `No results` (counter). |
| `src/renderer/components/pipe-status/PagePipeStatusModel.ts` | Fixed fallback `Loading`, `Unable to load content`, and `Content loaded`; full elapsed-time messages use CLDR objects with literal unit abbreviations. Preserve summary-provided text. |
| `src/renderer/components/pipe-status/PipeStageListView.ts` | `Loaded {bytes}` and `of {bytes}` are UI-authored fragments currently appended as separate text nodes; combine as one complete message. Rate suffix `/s` is a language-neutral unit format. |
| `src/renderer/components/git-tree/GitTreeView.ts` | Grid column headers `Comment`, `Commit`, `Date`, and `Author` are UI copy. Translate `Column.name`, retaining its separate `Column.key` (`subject`, `shortHash`, `authorDate`, `authorName`) as layout/column identity. |
| `src/renderer/components/git-tree/load-more-footer.ts` | `Loading…`, `Load more`, and `Load all` are native footer actions. Keep the existing `data-action` values (`load-more`, `load-all`) as their stable action identity. |
| `src/renderer/content/tree-context-menus.ts` | Shared handlers add `Open in Rest Client`, `Open in New Tab`, `Open in New Window`, and `Show in File Explorer`; lint did not report this file. They are converted under this task because their menus are in the host-owned tree context-menu flow. Add IDs and reuse existing shell keys where they fit. |
| `src/renderer/editors/shared/editor-menu-items.ts` | `Change Password` / `Encrypt` conditional label was not reported; extract both fixed labels. |
| `src/renderer/content/open-with-editor.ts` | Open-with child options whose `labelKey` is unset can be editor/board display names; keep these source labels as English/data. |

Audit complete for the listed TypeScript folders: files with no additional app-authored visible literals outside the inventories are listed under **Files with no planned changes**. Re-run the same source review during implementation because helpers and render-time paths can conceal user-facing strings.

### 3. Identity and agent-facing text

1. **Menu items shared with scripts and MCP — `src/renderer/components/tree-provider/TreeProviderViewModel.ts`, `CategoryViewModel.ts`, `item-menus.ts`, `plural-actions.ts`, `src/renderer/content/tree-context-menus.ts`, and `src/renderer/content/open-with-editor.ts`.** Context-menu item arrays flow through `app.events.linkContextMenu`; the local-file handler reuses the same array for `app.events.fileExplorer.itemContextMenu` for script compatibility. Labels therefore can be observed by extension/script consumers. Add a stable `id` to each converted host item (unique within its menu) and keep automation/actions keyed by IDs, never by translated labels. Existing open-with child IDs (`open-with:${id}` and `open-with:default-app`) already provide this contract; add an ID for its parent item. The type is `MenuItem` in `src/renderer/core/events/context-menu.ts`; `src/renderer/uikit/Menu/MenuModel.ts` currently falls back to `${index}:${item.label}` when no ID exists, so explicit IDs also prevent locale changes from changing row identity.
2. **Board webview context menu — deferred.** `src/board-context-menu.ts` is imported by `src/board-shim.ts` and runs in the board webview. It cannot resolve the active locale until phase 3 passes `persephone.locale` under D10. No strings or IDs in that file change in US-1655; its 10 lint reports remain deliberately.
3. **Tree item and selection identity — `src/renderer/components/tree-provider/TreeProviderViewModel.ts`, `CategoryViewModel.ts`, `FileListView.ts`, and `FileSearchView.ts`.** `href`, selected href arrays, provider paths, file paths, result line numbers and item/file titles are data used to identify, filter, compare or open files. Keep them unchanged and English as data; do not translate item names. Context-menu target objects retain `href`/`path` and their stable type. `CategoryViewModel` selection compares hrefs via `sameHref`/`sameHrefs`; no displayed label is the key.
4. **Git ref tree and commit grid — `src/renderer/components/git-tree/git-refs-tree.ts`, `GitTreeView.ts`, and `load-more-footer.ts`.** Root captions `Branches`, `Remotes`, and `Tags`, plus column headers `Comment`, `Commit`, `Date`, and `Author`, are UI strings to translate. Keep `GitRefNode.value` constants/prefixes, `refName`, remote/branch/tag names and `Column.key` values as identity/data. The footer's existing `data-action` attributes stay stable while its visible action labels translate.
5. **Pipe status — `src/renderer/components/pipe-status/PagePipeStatusModel.ts`, `PipeStageListView.ts`, and `src/renderer/content/ContentPipe.ts`.** Provider `displayName`, `role`, `status.text`, `status.detail`, errors, byte/rate values and the page's provider summary are supplied pipeline data and may be surfaced to diagnostic/agent consumers. Keep them in English/data. Translate only fixed app-authored fallback/wrapper text and progress framing.
6. **Open-with choices — `src/renderer/content/open-with-editor.ts` and `src/renderer/editors/shared/link-open-menu.ts`.** The `id` passed to `openWithEditor()` and `open-with:${id}` menu IDs are editor identity. Keep IDs stable. Built-in option names can use their catalog key; board-owned option labels and names without `labelKey` remain as supplied. Browser profile `name` is data used to construct the `profile:${name}` browser mode; its kebab-cased slug plus code-point suffix supplies a locale-independent, unique menu ID, while only its surrounding visible label is translated. Keyboard labels such as `Shift+F3`, `F3`, `Esc`, and `Ctrl` notation remain literal per E5.

No other displayed label in the audited files is compared with `===` or used as a map key. `src/renderer/scripting/ai-vision/page-panels.ts` reads the stable `search` panel ID plus query, paths, results and counts; those are API identity/data and stay unchanged. File names/titles and Git ref names are user/repository data, including when persisted. Explicitly English thrown-error strings under E3 include `Loaded image has no raster dimensions`, `Failed to obtain a 2D canvas context`, and `Failed to encode PNG` in `src/renderer/editors/shared/image-export.ts`; `MonacoEditorHostView is not mounted.`, `MonacoDiffEditorHostView is not mounted.`, and `Menu icon does not have a DOM builder.` in `src/renderer/editors/shared/`; and `GitTreeView model identity cannot change while the view is mounted.` in `src/renderer/components/git-tree/GitTreeView.ts`. These thrown errors stay English. `src/board-context-menu.ts` has thrown image errors but is deferred to phase 3 with the file. E5 data/format exceptions are file/folder names and paths, search queries/globs, result snippets, URLs, Git branch/remote/tag names and command output, provider-supplied pipe stage/status text, editor/board names, product/protocol names (`Persephone`, `MCP`, `Git`, `Mneme`, `Tor`), keyboard shortcut notation (`Shift+F3`, `F3`, `Esc`, `Ctrl`), and board-owned context-menu items.

**Dialog comparisons retained by this task:** `item-crud-actions.ts` checks `inputResult.button` against `DialogButton.create` (file/folder creation), `DialogButton.rename`, and `DialogButton.delete`; `os-clipboard.ts` checks `bt` against `DialogButton.overwrite`; `plural-actions.ts` checks `bt` against `DialogButton.delete`; `tree-drop-actions.ts` checks `bt` against `DialogButton.move`, `DialogButton.overwrite`, and (for OS drops) `DialogButton.move` / `DialogButton.copy`. Keep every comparison against those stable English IDs/constants. Never compare a translated button label.

## Concerns

- `src/board-context-menu.ts` belongs to phase 3: it runs in the board webview before locale delivery. Do not change it here; its 10 rule reports are intentionally left.
- `src/renderer/content/tree-context-menus.ts` is adjacent to the requested open-with files and is not in the initial lint invocation; its app-owned tree menu additions were included after tracing their event path. Keep this extension limited to the host tree menu additions, not arbitrary event subscriber labels.
- Data-originated errors/status text may contain English and must not be rewritten as UI copy. Translate only the application-authored wrapper/fallback; E3 keeps thrown errors English.
- `FindBarView` is used by Browser and Markdown, so pseudo-locale verification must exercise both consumers.
- Do not change the generic `MenuItem` `idOf()` fallback contract in this extraction unless required; assign IDs to converted host items at their owners.

## Acceptance Criteria

- [x] Scoped ESLint reports zero `vanilla-view/no-hardcoded-ui-strings` findings in the requested renderer folders and the two reporting `open-with-*.ts` files. The 10 reports in `src/board-context-menu.ts` are intentionally deferred to phase 3 because the board webview has no active locale yet.
- [x] The source-audit strings listed above are localized; only E3/E5 exceptions remain English.
- [x] All translated context-menu items have stable IDs; labels are not used as agent identity.
- [x] Existing `common` and `shell` entries are reused where semantically identical; the new flat `menus` area is registered.
- [x] Count messages use CLDR and sentence text is kept whole; path/name/error/ref values remain placeholders or data.
- [x] Typecheck and production build pass. `npm run i18n:check` is skipped in this sandbox per user instruction. Live `en-XA` verification remains for the user.
- [ ] Live verification that MCP/script context-menu consumers can activate converted items by stable ID; source preserves target/action semantics. AI-vision checks are included in the live route checklist.

## Live access for `en-XA` verification

| Surface | Live route |
|---|---|
| Explorer tree provider and item/background menus | Use MCP `script.execute` with `await app.pages.openFile("<existing folder>")` or open an Explorer page and expose its Explorer panel; right-click a file, folder and background. Use the menu row `data-id`/ID to activate. A category/folder-content view is reached by opening a folder in the Explorer tree. |
| File Search | In the Explorer panel click the `explorer-search` header action, run searches with and without results, then toggle filters. MCP surface: `pages[i].panels.search` exposes query/result state; open a folder/page first. |
| File list | Sidebar > Recent Files; also open Git Tree and select a commit to show its changed-file list. Search and clear the sidebar list, and open a file context menu. File names remain data. |
| Git refs and messages | Choose Git Tree from Tools & Editors in a repository with local branches, remotes and tags; trigger stage/unstage/reset/commit/pull failure paths where safe. The editor is not opened through a dedicated `showGitTreePage()` MCP method. |
| Shared editor menus | Open an image page to test Save Image; open a file with an external URL/link in Markdown or Browser and right-click it; right-click text/editor content to show shared file/editor actions. `FindBarView` is opened in Browser with Ctrl+F and in Markdown with its find command/shortcut; exercise prev/next/close and no-results states. |
| Pipe loading/status | Open a remote URL, a large file or a content source with visible pipe stages. Inspect loading, completion, and an error/retry page; open the status popover. Provider-supplied stages/status strings are data and may remain English. |
| Host board context menu | Deferred to phase 3: `src/board-context-menu.ts` runs in the board webview and cannot use the active locale until D10 supplies `persephone.locale`. Do not include it in US-1655 live verification. |
| Open with | In Recent Files or an Explorer file row, open the context menu and the Open with submenu; exercise a built-in editor and Default App. Existing child menu IDs are the assertion target. |

MCP page methods and editor/panel IDs are verified in the page model, `src/renderer/scripting/ai-vision/page-panels.ts`, and editor declarations. Use stable page/editor/panel IDs and menu item IDs; do not select by translated labels.

## Files with no planned changes

These files in the enumerated folders contain models, layout/style, user data or language-neutral behavior and have no app-authored visible strings in the current source audit. Recheck lint and text positions after extracting the views.

- `src/renderer/components/tree-provider/`: `drop-dispatch.ts`, `href-utils.ts`, `index.ts`, `TreeProviderView.css`, `CategoryView.css`.
- `src/renderer/components/file-search/`: `FileSearch.css`, `FileSearch.ts`, `FileSearchModel.ts`, `index.ts`.
- `src/renderer/components/file-list/`: `FileList.css`, `FileList.ts`.
- `src/renderer/components/git-tree/`: `GitTree.css`, `GitTree.story.ts`, `GitTreeModel.ts`, `branch-tree-cell.ts`, `git-date.ts`, `git-ref-color.ts`, `side-select-cell.ts`, `swimlane-layout.ts`, `index.ts`.
- `src/renderer/components/pipe-status/`: `PagePipeStatusView.css`, `PipeStageListView.css`, `page-pipe.ts`.
- `src/board-context-menu.ts`: unchanged; its board-webview locale handoff is phase 3 work (D10).
- `src/renderer/editors/shared/`: `ColorizedCodeView.ts`, `MonacoEditorHostView.ts`, `MonacoEditorHostView.css`, `MonacoDiffEditorHostView.ts`, `MonacoDiffEditorHostView.css` (their thrown errors remain English under E3).
- `src/renderer/content/open-with-*.ts`: both current files are in scope because lint reports them; no other `open-with-*` files were present on 2026-10-10.

## Files Changed

| File | Planned change |
|---|---|
| `src/shared/i18n/en/menus.ts` | New catalog area for menu, tree, search, file-list, Git and pipe-status messages. |
| `src/shared/i18n/en/index.ts` | Register the `menus` catalog. |
| `src/renderer/components/tree-provider/CategoryViewImpl.ts`, `TreeProviderViewImpl.ts`, `item-crud-actions.ts`, `item-menus.ts`, `os-clipboard.ts`, `plural-actions.ts`, `tree-drop-actions.ts`, `CategoryViewModel.ts`, `TreeProviderViewModel.ts` | Extract UI strings, IDs, whole sentences and CLDR messages. |
| `src/renderer/components/file-search/FileSearchView.ts` | Extract input, status, result and empty-state copy. |
| `src/renderer/components/file-list/FileListView.ts` | Extract search and empty-state copy. |
| `src/renderer/components/git-tree/GitBranchesModel.ts`, `GitChangesModel.ts`, `GitTreeView.ts`, `git-refs-tree.ts`, `load-more-footer.ts` | Extract notifications, static root captions, grid headers and footer actions; preserve ref/column/action identities. |
| `src/renderer/components/pipe-status/PageLoadingShellView.ts`, `PagePipeStatusView.ts`, `PagePipeStatusModel.ts`, `PipeStageListView.ts` | Extract fixed loading, fallback, accessibility and progress copy. |
| `src/renderer/editors/shared/FindBarView.ts`, `editor-menu-items.ts`, `image-export.ts`, `link-open-menu.ts` | Extract shared find controls, menu labels, save title and notification. |
| `src/renderer/content/open-with-default-app.ts`, `open-with-editor.ts`, `tree-context-menus.ts` | Extract host-owned menu labels and notifications; preserve editor IDs and event behavior. |
| `doc/epics/EPIC-125.md`, `doc/active-work.md` | Link this task in the epic and dashboard. |
