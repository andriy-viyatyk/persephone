# US-1426 — The editor switch on a folder page, and a page toolbar for Mneme

**Status:** Complete · **Epic:** [EPIC-102](../../epics/EPIC-102.md)

## Goal

Make the standard page-editor switch work between a folder editor and Folder View. Git Tree
and Mneme must retain the exact Explorer anchor, Folder View must use the page's Explorer
provider when available, and Mneme must gain the same page toolbar already used by the other
standalone folder editors. A page whose folder can no longer be resolved (a deleted `.git`,
`git.enabled` turned off) must degrade to no switch offered — never to a broken switch. Because
the anchor is derived rather than persisted, a page restored from before this change behaves
exactly like a fresh one.

## Background

The epic's switch line references were re-checked against the current source. The relevant
no-host fallback is now at
[`editor-switch.ts:149-153`](../../../src/renderer/editors/base/editor-switch.ts:149-153),
not the epic's earlier `:135-142` range:

```ts
if (!oldEditor.contentHost) {
    const filePath = oldEditor.filePath;
    if (!filePath) return;
    await rebuildEditorOverFile(page, oldEditor, filePath, newEditorId);
    return;
}
```

A folder-to-folder branch must run before this block. `EditorModel.filePath` reads
`state.filePath`
([`EditorModel.ts:219`](../../../src/renderer/editors/base/EditorModel.ts:219)),
but the Git state stores `repoRoot` and the Mneme state stores `rootFolder`
([`GitTreeEditorModel.ts:23-58,70-80`](../../../src/renderer/editors/git-tree/GitTreeEditorModel.ts:23-58)
and [`MnemeRootEditorModel.ts:33-81,93-117`](../../../src/renderer/editors/mneme-root/MnemeRootEditorModel.ts:33-81)).
The current fallback therefore returns early for these editors.

`getEditorSwitchOptions` begins with `model.findCompatibleEditors()`
([`editor-switch-options.ts:52`](../../../src/renderer/editors/base/editor-switch-options.ts:52)).
The base implementation returns `` ([`EditorModel.ts:191-193`](../../../src/renderer/editors/base/EditorModel.ts:191-193)).
Git Tree and Category already mount `PageToolbarView` at
([`GitTreeEditorView.ts:201-203`](../../../src/renderer/editors/git-tree/GitTreeEditorView.ts:201-203))
and [`CategoryEditor.ts:67-70`](../../../src/renderer/editors/category/CategoryEditor.ts:67-70)).
Mneme currently does not import or render it.

Folder View is provider-backed. `CategoryEditorModel.providerHost` delegates to
`findTreeProviderHost`, which searches page `panelEditors` for a matching provider type and
`sourceUrl` ([`CategoryEditorModel.ts:45-63,95-100`](../../../src/renderer/editors/category/CategoryEditorModel.ts:45-63)).
Without that host, listing returns `undefined` and actions throw at
([`CategoryEditorModel.ts:109-130`](../../../src/renderer/editors/category/CategoryEditorModel.ts:109-130)).
The link must therefore carry the Explorer provider's `sourceUrl`, not merely the folder path.

The scripting surface already exposes these options. `PageEditorSwitchesNode.options` calls
the same switch-option helper and `switchTo` calls the page host's
`switchMainEditor` ([`page-editor-switches.ts:38-60`](../../../src/renderer/scripting/ai-vision/page-editor-switches.ts:38-60)).
`PageWrapper` maps `category-view`, `git-tree`, and `mneme-root` to existing facades and
exposes `editorSwitches`
([`PageWrapper.ts:113-120,264-266`](../../../src/renderer/scripting/ai-vision/PageWrapper.ts:113-120)).
No new AiVision/MCP editor list is needed; the changed behavior is the shared model/host switch.

The accepted boundary of this epic is scheme-per-folder-editor: a fourth folder editor needs
a matcher, a `newEditorModelForFolder`, a link scheme with a parser in `content/parsers.ts`,
and an entry in `folder-editor-link.ts`.

## Implementation plan

1. Add a `folderAnchor: string | undefined` getter and
   `findCompatibleEditors(): string[]` to each of `CategoryEditorModel`,
   `GitTreeEditorModel`, and `MnemeRootEditorModel`. Import `editorRegistry` directly from
   `../base/editorRegistry`; `EditorModel` has no `editorRegistry` member. Read reactive
   state through `this.state.get()` in each getter, then verify the derived candidate:

   ```ts
   import { editorRegistry } from "../base/editorRegistry";
   import { fpJoin } from "../../core/utils/file-path";

   // Category: only a filesystem category can be a folder anchor.
   get folderAnchor(): string | undefined {
       const link = this.decodedLink;
       const category = link?.type === "file" ? link.category : undefined;
       return category || undefined;
   }

   // Git getter
   get folderAnchor(): string | undefined {
       const { repoRoot } = this.state.get();
       const candidate = repoRoot ? fpJoin(repoRoot, ".git") : undefined;
       return candidate && editorRegistry.resolveForFolder(candidate) === "git-tree"
           ? candidate : undefined;
   }

   // Mneme getter
   get folderAnchor(): string | undefined {
       const { rootFolder } = this.state.get();
       const candidate = rootFolder ? fpJoin(rootFolder, ".mneme") : undefined;
       return candidate && editorRegistry.resolveForFolder(candidate) === "mneme-root"
           ? candidate : undefined;
   }

   findCompatibleEditors(): string[] {
       const anchorFolder = this.folderAnchor;
       return anchorFolder ? editorRegistry.getFolderEditors(anchorFolder) : [];
   }
   ```

   The repeated getter names above are separate implementations, one in each concrete model;
   do not place all three in one class.

   Mneme substitutes `rootFolder` and `.mneme`, and returns only when resolution returns
   `"mneme-root"`. This is a verified derivation, not persisted state and not a string guess:
   a `.git` file, missing marker, or disabled setting makes the getter `undefined`. A plain
   filesystem category resolves only to `category-view`, while a recognized marker exposes
   Folder View plus its priority-20 editor. Non-filesystem Category links never offer folder
   editors because the getter requires `decodedLink.type === "file"`.

2. Add the folder branch to
   [`switchMainEditor`](../../../src/renderer/editors/base/editor-switch.ts:25-157).
   After the same-editor no-op and before board handling, content-host transfer, or the
   no-host `rebuildEditorOverFile` fallback, detect whether the outgoing and requested
   IDs are folder editors. Use `editorRegistry.getFolderEditors(anchorFolder)` as the
   compatibility check. If the outgoing editor has no anchor (including an old restored state),
   throw a descriptive `Error` rather than entering the file-path fallback. If the requested ID
   is not returned for that exact anchor, throw the same kind of descriptive availability error.
   The toolbar never reaches this branch for an unavailable option because it is not rendered;
   `PageToolbarView.onSwitch` already wraps a genuine call in `guard()` for a toast.

   For a valid folder switch, obtain the target module and call its
   `newEditorModelForFolder(anchorFolder)`. Attach the returned model with the same page
   main-editor replacement/lifecycle sequence used by the existing rebuild path, restore its
   state as appropriate, then set it as the main editor. Keep board-specific handling and the
   existing host-transfer path for non-folder editors.

   The critical shape is:

   ```ts
   // Must precede the oldEditor.contentHost/filePath fallback
   const anchorFolder = getFolderAnchor(oldEditor);
   if (isFolderEditor(oldEditor.editorId) && isFolderEditor(newEditorId)) {
       if (!anchorFolder) {
           throw new Error(`Folder switch unavailable: this page has no resolvable folder for "${newEditorId}".`);
       }
       if (!editorRegistry.getFolderEditors(anchorFolder).includes(newEditorId)) {
           throw new Error(`Folder switch unavailable: "${newEditorId}" is not offered for "${anchorFolder}".`);
       }
       const module = editorRegistry.getModule(newEditorId);
       const next = await module.newEditorModelForFolder?.(anchorFolder);
       if (!next) throw new Error(`Folder switch unavailable: editor "${newEditorId}" has no folder factory.`);
       // replace/restore/set the page main editor using the normal lifecycle
       return;
   }
   ```

   Use the actual registry/module accessors and disposal/attachment helpers already present in
   `editor-switch.ts`; the snippet is the ordering and data-flow contract, not a request for
   new type assertions. In particular, this branch must never call
   `rebuildEditorOverFile` or `switchFrom` with a folder editor's undefined
   `filePath`.

3. Export `buildFolderCategoryLink(page, anchorFolder): ITreeProviderLink` from
   [`CategoryEditorModel.ts`](../../../src/renderer/editors/category/CategoryEditorModel.ts:45-171).
   Reuse the existing `isCategoryTreeProviderHost` guard while scanning `page.panelEditors`;
   do not match `editorId` on a bare `EditorModel` or read `treeProvider` from an untyped model.
   For each guarded host, accept a provider whose `rootPath` contains the anchor as a path
   segment, comparing with `fpNormalizeForCompare` so Windows case differences do not matter.
   Return the provider's `{ type, sourceUrl, category: anchorFolder }`, or the D3 fallback
   `{ type: "file", url: anchorFolder, category: anchorFolder }` when no host qualifies.

   The settled `newEditorModelForFolder(anchorFolder)` signature has no page argument, so the
   Category module first constructs a self-rooted model from the anchor. In the folder-switch
   branch, before attaching that model, call the exported helper and reinitialize the Category
   model with its returned link:

   ```ts
   const { buildFolderCategoryLink } = await import("../category/CategoryEditorModel");
   const link = buildFolderCategoryLink(page, anchorFolder);
   // The module factory's self-rooted initialization is the no-page fallback.
   if (next.editorId === "category-view") {
       (next as CategoryEditorModel).initFromLink(link);
   }
   ```

   Keep the exact existing provider-host matching behavior. The fallback is explicitly
   self-rooted `file` Folder View, as D3 requires; it is for pages without a matching
   Explorer panel, such as a page restored or opened from another surface.

4. Add a `PageToolbarView` to `MnemeRootEditorView` with the same model/page props and
   lifecycle treatment used by Git Tree and Category. The current view creates a column root,
   then `buildShell()` creates `mneme-search-toolbar` with column direction, dark
   background, bottom border, no shrink, and compact padding; it appends that toolbar,
   `statusHost`, and `resultsHost` directly to the root
   ([`MnemeRootEditorView.ts:297-313`](../../../src/renderer/editors/mneme-root/MnemeRootEditorView.ts:297-313)).
   It renders no page toolbar today.

   Import `PageToolbarView`, create a field for it, append/mount it before the existing
   search shell in `onMount`, and release it with the view's other mounted children. Pass
   the existing page, editor model, breadcrumb, and search props by following
   `GitTreeEditorView`'s `pageToolbarProps` pattern. The resulting order should be:

   ```text
   root column
   ├── PageToolbarView
   ├── mneme-search-toolbar
   ├── statusHost
   └── resultsHost
   ```

   Keep `mneme-search-toolbar` as the second, dark search/filter bar and retain its
   bottom border. Verify the two stacked bars do not collapse the filter controls or results;
   if the panel component requires the toolbar to be mounted after `buildShell`, preserve the
   same visual order explicitly. The existing fallback from the epic—putting the switch inside the
   search toolbar—should be considered only if the standard stacked layout is demonstrably
   disruptive.

5. Verify the complete surface after implementation in a live window: Git Tree ⇄ Folder View,
   Mneme ⇄ Folder View, plain folder (one option), a stale marker/settings state whose
   `folderAnchor` is `undefined`, direct link opens, and
   `pages[i].editorSwitches.options/switchTo`. A scripted request for an editor that is not in
   `options` must retain the existing descriptive failure from
   [`page-editor-switches.ts:51-62`](../../../src/renderer/scripting/ai-vision/page-editor-switches.ts:51-62);
   do not change that file or turn an unavailable switch into success.

   Include lifecycle and panel checks: Git Tree → Folder View must remove the Git panels it
   contributed through `page.setMainEditor`/`notifyMainEditorChanged` without stranding them;
   the page's Explorer panel must survive both switch directions because D3 depends on it; and
   the tree selection highlight on the `.git` row must survive main-editor replacement.
   Also verify that no MCP or AiVision wrapper introduces a separate editor enumeration or
   bypasses the shared switch branch.

## Concerns

- **D2 has a construction-context tension.** The settled module factory takes only
  `anchorFolder`, but D3 needs the current page's Explorer provider `type` and `sourceUrl`
  to construct Category. Keep the factory ownership split: the switch supplies page context only
  for Category's D3 link, while Git/Mneme factories own their existing scheme arguments.
  Do not silently derive a provider URL from the anchor path.

- **Mneme's toolbar is the largest visible uncertainty.** Its current search toolbar is a
  vertical dark panel with its own border and is the first child. A standard PageToolbar adds a
  second horizontal chrome row and another boundary. The plan preserves the existing search
  toolbar and puts the page toolbar above it; this needs visual verification and may require
  only layout adjustments, not a different switch implementation.

- **Folder View depends on panel topology.** The Explorer provider may not be in
  `page.panelEditors`, or its `sourceUrl` may no longer match the link. In that case the
  self-rooted fallback is valid for listing the directory but is not equivalent to the original
  provider context; actions that require the original host remain limited by the existing
  Category model contract.

## Acceptance criteria

- Git Tree and Mneme expose Folder View as a compatible editor only when `folderAnchor` is
  present and accepted; plain folders expose only `category-view`.
- A folder switch creates the target through `newEditorModelForFolder(anchorFolder)` and
  cannot enter the existing undefined-`filePath` rebuild path.
- Category switches use the Explorer panel's provider `type`/`sourceUrl`, with the exact
  self-rooted fallback when no panel exists.
- Mneme displays a PageToolbar above its existing search toolbar without losing filters,
  status, results, or the existing dark search-toolbar treatment.
- A descriptor saved before this change needs no migration because no anchor is persisted; if
  its derived `folderAnchor` is unavailable, the toolbar offers no switch and the UI does not
  throw. The existing scripting API still reports an explicitly requested unavailable switch.
- Non-filesystem Category links (`LinkTreeProvider`, `ArchiveTreeProvider`, or
  `MnemeTreeProvider` categories) have no `folderAnchor` and never offer folder editors.
- AiVision's `pages[i].editorSwitches` observes the same options and retains its descriptive
  unavailable-switch error.
- No unit tests or test harnesses are proposed; verification is by source inspection and the
  project's live-window/manual workflow.

## Files changed

| File | Planned change |
|------|----------------|
| `src/renderer/editors/category/CategoryEditorModel.ts` | Folder compatibility and anchor-aware Category construction support |
| `src/renderer/editors/git-tree/GitTreeEditorModel.ts` | Verified `folderAnchor` derivation and folder compatibility |
| `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts` | Verified `folderAnchor` derivation and folder compatibility |
| `src/renderer/editors/base/editor-switch.ts` | Folder-to-folder branch before the file-path fallback |
| `src/renderer/editors/mneme-root/MnemeRootEditorView.ts` | Page toolbar mounted above the search toolbar |

### Files verified and intentionally unchanged

- `src/renderer/editors/base/editor-switch-options.ts` and
  `src/renderer/editors/base/PageToolbarView.ts` — existing option aggregation and widget
  hiding are sufficient.
- `src/renderer/editors/git-tree/GitTreeEditorView.ts` and
  `src/renderer/editors/category/CategoryEditor.ts` — existing page-toolbar precedents.
- `src/renderer/api/pages/PageModel.ts` and `PagesLifecycleModel.ts` — delegate/construct
  through the shared switch and explicit target paths; no separate folder switch is present.
- `src/renderer/api/pages/PagesPersistenceModel.ts`, `src/shared/persistence.ts`, and
  `src/shared/types.ts` — no anchor is persisted, so no common-state, schema, or migration
  change is indicated.
- `src/renderer/editors/board/custom-editor-registry.ts` — D4 is out of scope.
- `src/renderer/scripting/ai-vision/page-editor-switches.ts` and
  `src/renderer/scripting/api-wrapper/**` — existing scripted switch/error behavior and
  wrapper surface remain unchanged.
- `src/renderer/scripting/ai-vision/PageWrapper.ts`, the existing facades, and
  the page/editor API types — no folder-editor-specific enumeration or MCP contract was found.
- Unit-test files and harnesses — this project uses none and none is proposed.
