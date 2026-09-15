# US-1425 — Explorer: one click opens the folder's editor; drop the trailing buttons

**Status:** Complete · **Epic:** [EPIC-102](../../epics/EPIC-102.md)

## Goal

Make Explorer selection use the editor selected by folder resolution. A recognized
`.git` or `.mneme` row will open its editor on one click, while every ordinary
directory continues to open Folder View. Remove the duplicate Git/Mneme trailing actions
without touching manifest-file actions for Boards and Agent Tools.

## Background

`ITreeProviderItem.target` is already an arbitrary `string`, not a closed editor-id
union, at [`src/renderer/api/types/io.tree.d.ts`](../../../src/renderer/api/types/io.tree.d.ts:145-155).
The same is true for `ILinkNav.target` at `io.link-data.d.ts:41-45`. The current
FileTreeProvider classifies directories with hardcoded Git/Mneme checks at
[`FileTreeProvider.ts`](../../../src/renderer/content/tree-providers/FileTreeProvider.ts:62-78),
then its `getNavigationUrl` has hardcoded special links at lines 137–147. US-1424 moves
classification/gates to `resolveForFolder`; this task consumes that result for navigation.

The current Explorer click path deliberately defeats the provider URL for those two
targets: [`ExplorerEditorModel.openItem`](../../../src/renderer/editors/explorer/ExplorerEditorModel.ts:113-124)
replaces it with a category link at lines 118–120. The trailing buttons are rendered by
[`ExplorerSecondaryView.renderTrailingAction`](../../../src/renderer/editors/explorer/ExplorerSecondaryView.ts:258-299),
with Git/Mneme branches at lines 274–291. Their model callbacks are
`openGitTree`/`openMneme` at [`ExplorerEditorModel.ts`](../../../src/renderer/editors/explorer/ExplorerEditorModel.ts:267-283).

The icon behavior is already generic enough for the known values:
[`icon-elements.ts`](../../../src/renderer/components/icons/icon-elements.ts:96-103)
maps `git` and `mneme` to their editor glyphs before the folder fallback. Other tree
views pass `target`/`icon` through generically; a repository-wide exact-consumer sweep
found no other `item.target === "git-tree"`, `item.target === "mneme-root"`,
`item.icon === "git"`, or `item.icon === "mneme"` branches. The remaining manifest-file
branches in Explorer are independent and must remain.

Navigation is scheme-driven. `parsers.ts` routes `tree-category://` to `category-view`
(lines 114–122), `git-tree://` to `git-tree` (124–134), and `mneme-folder://` to
`mneme-root` (136–147). `resolvers.ts:148-164` creates a placeholder pipe for virtual
schemes so these links still reach `openContent`; `PagesLifecycleModel.buildEditorById`
then dispatches the explicit target to the module factory (117–165). A raw arbitrary
editor ID has no parser by itself.

The accepted boundary of this epic is scheme-per-folder-editor: a fourth folder editor needs
a matcher, a `newEditorModelForFolder`, a link scheme with a parser in `content/parsers.ts`,
and an entry in `folder-editor-link.ts`.

## Implementation plan

1. Keep the US-1424 `FileTreeProvider.list` result as the single source of truth:
   `target = editorRegistry.resolveForFolder(fullPath)`. Set the icon from editor metadata:
   `icon: editorRegistry.getById(target)?.folderIcon`. Do not reintroduce an ID-to-icon map,
   name checks, settings gates, or marker probes in this task. The `..` entry still has no
   target and is not passed through folder-editor classification.

   ```ts
   // Before
   const isGit = entry.name === ".git" && this.isGitRepoDir(fullPath);
   const isMneme = !isGit && entry.name === ".mneme" && settings.get("mneme.enabled");

   // After (US-1424 mechanism and editor-owned icon metadata consumed here)
   const target = editorRegistry.resolveForFolder(fullPath);
   const icon = editorRegistry.getById(target)?.folderIcon;
   ```

2. Add [`src/renderer/content/folder-editor-link.ts`](../../../src/renderer/content/folder-editor-link.ts)
   with the single synchronous ID-to-scheme mapping:
   `folderEditorLinkFor(editorId, anchorFolder, sourceUrl)`. It should return the existing
   `tree-category://` link for `category-view`, the existing `git-tree://` link using the
   parent of the `.git` anchor for `git-tree`, and the existing `mneme-folder://` link using
   the parent of the `.mneme` anchor for `mneme-root`. The exact `anchorFolder` is used to
   derive those existing link arguments; it is not added to either link payload. Keep this
   helper synchronous because `getNavigationUrl` is
   synchronous, so the editor module cannot own this mapping.

3. Rewrite [`FileTreeProvider.getNavigationUrl`](../../../src/renderer/content/tree-providers/FileTreeProvider.ts:137-148)
   so files still return `item.href`, and every directory calls
   `folderEditorLinkFor(item.target ?? "category-view", item.href, this.sourceUrl)`. The
   target remains arbitrary metadata, but the helper emits only the three parser-recognized
   schemes. If a target is absent or unsupported, use the ordinary category link as the
   safe fallback rather than emitting an unparseable URL.

   ```ts
   // Before
   if (item.target === "git-tree") return encodeGitTreeLink(fpDirname(item.href));
   if (item.target === "mneme-root") return encodeMnemeFolderLink(fpDirname(item.href));
   if (!item.isDirectory) return item.href;
   return encodeCategoryLink({ type: this.type, url: this.sourceUrl, category: item.href });

   // After
   if (!item.isDirectory) return item.href;
   return folderEditorLinkFor(item.target ?? "category-view", item.href, this.sourceUrl);
   ```

   Keep `getNavigationUrlByHref` unchanged. It has no caller of its own in
   `FileTreeProvider`; the only call is `ArchiveEditor.ts:123`, on the ARCHIVE provider.
   It also lacks the original item metadata needed to preserve a special target.

4. Simplify `ExplorerEditorModel.openItem`: set `selectedHref` exactly as today, then
   call `this.treeProvider.getNavigationUrl(item)` for every item. Remove only the
   `target === "git-tree" || target === "mneme-root"` category override and the now
   unused imports of the three special-link encoders. Keep the page/source metadata on
   `createLinkData`; `pageId` is what makes the open handler navigate this page.

5. Remove only the two directory branches from
   `ExplorerSecondaryView.renderTrailingAction` and keep the file branches for
   `BOARD_MANIFEST_FILE` and `TOOLS_MANIFEST_FILE` byte-for-byte in behavior. The
   manifest buttons hang off files and are not folder claims; D4 explicitly leaves them
   alone. Once no call remains, remove `openGitTree` and `openMneme` from
   `ExplorerEditorModel`, plus their imports and any dead trailing-button typing.

6. Preserve row expansion and selection behavior. `TreeProviderViewModel` still gets
   the same directory item and invokes `onItemClick`; only the navigation URL changes.
   The caret must continue to expand `.git` and `.mneme` children, and the selection
   write must remain before the async open so the Explorer highlight survives the main
   editor replacement.

7. Verify link routing in the live pipeline for all three outcomes. A plain folder must
   reach `tree-category://`/`category-view`; `.git` must reach
   `git-tree://`/`git-tree`; `.mneme` must reach
   `mneme-folder://`/`mneme-root`. Do not add a parser for a new arbitrary editor ID
   in this task.

## Concerns

- **Arbitrary target IDs do not imply arbitrary navigation.** The source type permits
  `target?: string`, but `parsers.ts` only recognizes schemes. The helper's fallback must
  keep an unsupported target on the ordinary category path until the accepted boundary's
  matcher, factory, parser, and helper entry exist.

- **The Folder View fallback is not used for recognized special rows.** If a malformed
  or unsupported target ever reaches `getNavigationUrl`, the safe behavior is to return
  the file-provider category link rather than emit an unparseable URL. The current
  registry table prevents that path for the three accepted folder IDs; record any new
  target as requiring a parser/factory pair before adding it to `resolveForFolder`.

- **The board/toolset buttons are intentionally not generalized.** Their exact current
  branches identify manifest files (`board-manifest.json` and `tools-manifest.json`),
  and `ExplorerEditorModel.openBoard`/`openToolset` perform trust and registration
  work. Removing them would exceed this task and violate D4's scope boundary.

## Acceptance criteria

- One click on a recognized `.git` or `.mneme` row navigates the page to the resolved
  editor; one click on any ordinary directory navigates to Folder View.
- The special row icon remains Git/Mneme, and plain directories retain the folder icon.
- No Git/Mneme trailing button is rendered; manifest-file Board and Agent Tool buttons
  still render and behave as before.
- Expanding a special row still lists its children, `..` still navigates as a plain
  directory, and selection highlighting is preserved.
- The three existing schemes route through their existing parsers; subsequent US-1426
  switches verify the anchor from the editor's existing state-derived argument.
- Verification is live/object-model/manual only; no unit tests or test harnesses are
  proposed.

## Files changed

| File | Planned change |
|---|---|
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | Resolve directory target/icon through the registry and return the matching known folder link |
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | Remove the special-target click override and obsolete Git/Mneme open methods/imports |
| `src/renderer/editors/explorer/ExplorerSecondaryView.ts` | Remove only Git/Mneme trailing-button branches |
| `src/renderer/content/folder-editor-link.ts` | Synchronous editor-ID-to-existing-link-scheme mapping |

### Files verified and intentionally unchanged

- `src/renderer/components/icons/icon-elements.ts` — existing `git`/`mneme` icon mapping is sufficient.
- `src/renderer/api/types/io.tree.d.ts` — `target?: string` already accepts editor IDs.
- `src/renderer/content/git-tree-link.ts` and `src/renderer/content/mneme-folder-link.ts` —
  existing link payloads remain unchanged.
- `src/renderer/content/parsers.ts` and `src/renderer/content/resolvers.ts` — existing
  three scheme parsers/virtual-link routing remain the contract.
- `src/renderer/api/pages/PagesLifecycleModel.ts` — explicit target construction already works.
- `src/renderer/editors/board/custom-editor-registry.ts` and all manifest trust code — D4,
  board folder claims, and file-side buttons are out of scope.
- `src/renderer/scripting/ai-vision/**` and `src/renderer/scripting/api-wrapper/**` — no
  special item target/icon consumer or folder-navigation API is exposed there.
- Any unit-test or test-harness files — none are proposed.
