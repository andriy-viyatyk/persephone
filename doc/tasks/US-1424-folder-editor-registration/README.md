# US-1424 — Folder-editor registration: `acceptFolder`, `resolveForFolder`, and the anchor-folder contract

**Status:** Complete · **Epic:** [EPIC-102](../../epics/EPIC-102.md)

## Goal

Add the registry mechanism that lets a standalone editor claim a directory, and let each folder
editor derive — and verify — the directory the Explorer row named. This task must be
behavior-preserving at the Explorer surface; US-1425 consumes the mechanism to change
folder selection behavior.

## Background

The current registry has a file matcher contract in
[`editorRegistry.ts`](../../../src/renderer/editors/base/editorRegistry.ts):
`EditorMatcher.acceptFile` (current lines 40–46), `EditorRegistry.resolveForFile`
(lines 119–137), and `getSwitchOptions` (lines 178–200). `EditorModule` currently has
only `newEditorModel(filePath?)` (lines 18–33). `makeAccepts` in
[`editor-matchers.ts`](../../../src/renderer/editors/base/editor-matchers.ts:159)
only projects file/language/content acceptance.

The three standalone registrations are still matcher-less at
[`register-editors.ts`](../../../src/renderer/editors/register-editors.ts:177-179).
Their current factories decode links: category at
[`category/index.ts`](../../../src/renderer/editors/category/index.ts:14-22), Git at
[`git-tree/index.ts`](../../../src/renderer/editors/git-tree/index.ts:12-20), and
Mneme at [`mneme-root/index.ts`](../../../src/renderer/editors/mneme-root/index.ts:15-24).
The current models store their editor-specific argument (category link/`filePath`,
`repoRoot`, or `rootFolder`) but do not store an anchor. The anchor will be a verified
derivation: Category uses its decoded filesystem category; Git tests `fpJoin(repoRoot,
".git")`; Mneme tests `fpJoin(rootFolder, ".mneme")`. Each candidate is usable only when
`editorRegistry.resolveForFolder(candidate)` returns that editor's own ID.

This also repairs two existing anchor-free link call sites without changing their link
payloads: [`GitTreeEditorModel.ts:527`](../../../src/renderer/editors/git-tree/GitTreeEditorModel.ts:527)
emits a Git link from `repoRoot`, and
[`MnemeConfigEditorModel.ts:199-200`](../../../src/renderer/editors/mneme-config/MnemeConfigEditorModel.ts:199-200)
emits a Mneme link from `rootFolder`. The new `folderAnchor` getters derive and verify the
same physical marker directory when those editors are later asked to switch.
The dashboard already contains all three EPIC-102 entries at
[`doc/active-work.md`](../../active-work.md:11-14), with matching US IDs and titles.

The accepted boundary of this epic is scheme-per-folder-editor: a fourth folder editor needs
a matcher, a `newEditorModelForFolder`, a link scheme with a parser in `content/parsers.ts`,
and an entry in `folder-editor-link.ts`.

## Implementation plan

1. Extend `EditorModule` with the optional factory below. Keep `newEditorModel` for
   link-driven opens and use `newEditorModelForFolder` only when the caller has the
   Explorer-named directory. Both factories must return a fully initialized model;
   neither should make `PagesLifecycleModel.buildEditorById` guess a parent path.

   ```ts
   // Before
   newEditorModel?(filePath?: string): Promise<EditorModel>;

   // After
   newEditorModel?(filePath?: string): Promise<EditorModel>;
   newEditorModelForFolder?(anchorFolder: string): Promise<EditorModel>;
   ```

2. Add `acceptFolder?(folderPath: string): number` to `EditorMatcher` and add
   `EditorRegistry.resolveForFolder` plus `getFolderEditors` in
   [`src/renderer/editors/base/editorRegistry.ts`](../../../src/renderer/editors/base/editorRegistry.ts).
   `resolveForFolder` must evaluate every registered definition's
   `match.acceptFolder`, choose the highest priority, and fall back to
   `category-view` at priority 0. `getFolderEditors` must return every non-negative
   folder match, sorted ascending by priority so Folder View is first and the
   priority-20 editor is second. Do not route this through `accepts()` or
   `makeAccepts()`: those are host/file/language-oriented and a folder has no content
   host.

   ```ts
   // Before
   resolveForFile(fileName: string, language?: string, mode = "edit"): string;

   // After (new sibling API)
   resolveForFolder(folderPath: string): string;
   getFolderEditors(folderPath: string): string[];
   ```

3. Add the synchronous marker helper at
   [`src/renderer/editors/base/folder-markers.ts`](../../../src/renderer/editors/base/folder-markers.ts).
   It is the one narrowly scoped direct-`fs` exception: use `require("fs")`, `fpBasename`,
   and `fpJoin`, never `require("path")`; wrap the marker probe in `try/catch` and return
   `false` on any failure. Move
   [`FileTreeProvider.isGitRepoDir:150-158`](../../../src/renderer/content/tree-providers/FileTreeProvider.ts:150-158)
   verbatim in behaviour: require `git.enabled`, then require `HEAD` and `objects` under
   a basename-`.git` directory. Add the file to the direct-`fs` exception list in
   [`doc/standards/coding-style.md`](../../../doc/standards/coding-style.md:287-322).

4. In [`src/renderer/editors/base/editor-matchers.ts`](../../../src/renderer/editors/base/editor-matchers.ts),
   declare only these folder matchers:

   - `category-view`: `0` for every folder path.
   - `git-tree`: `20` only for a `.git` directory with `git.enabled` and both
     `HEAD` and `objects` present inside it.
   - `mneme-root`: `20` only for a `.mneme` directory with `mneme.enabled`.

   Preserve the existing case-sensitive `.git`/`.mneme` name behavior unless source
   evidence requires otherwise. Use `fpBasename`/`fpJoin` for path operations. The
   marker probe is synchronous because both registry methods are synchronous; call the
   helper from `folder-markers.ts` and return `-1` when it returns false. Do not put
   `require("fs")` in this matcher file.

5. Move the classification decision out of `FileTreeProvider` without changing its
   visible result. In
   [`src/renderer/content/tree-providers/FileTreeProvider.ts`](../../../src/renderer/content/tree-providers/FileTreeProvider.ts:47-78),
   call `editorRegistry.resolveForFolder(fullPath)` for directory entries and use the
   resolved ID for `target`. Remove the provider's `settings` gate and
   `isGitRepoDir`; the matcher/helper owns those checks. Add optional `folderIcon?: string`
   to `EditorDefinition` in
   [`editorRegistry.ts`](../../../src/renderer/editors/base/editorRegistry.ts), set
   `folderIcon: "git"` and `folderIcon: "mneme"` on the corresponding registration rows,
   and leave `category-view` without one. The provider then sets
   `icon: editorRegistry.getById(target)?.folderIcon`; `ITreeProviderItem.icon` already
   accepts a string and `icon-elements.ts` already paints these tokens.

6. Add `folderAnchor: string | undefined` getters to the three folder editor models. The
   getter is a verified derivation, not state: Category returns its decoded `categoryPath`
   only when `decodedLink?.type === "file"`; Git returns
   `fpJoin(repoRoot, ".git")` only when resolution returns `"git-tree"`; Mneme returns
   `fpJoin(rootFolder, ".mneme")` only when resolution returns `"mneme-root"`.
   `newEditorModelForFolder(anchorFolder)` remains the factory used by US-1426 to construct
   the sibling editor; it does not add or persist anchor state. The existing
   `newEditorModel(filePath)` signatures and both link modules remain unchanged.

7. Verify the no-migration restore behavior. `PagesPersistenceModel` continues to restore
   the existing concrete state through `Object.assign`, `applyRestoreData`, and `restore`;
   there is no new persisted property and no schema change. A descriptor from before this
   epic needs no migration because nothing is persisted. Its Git/Mneme getter either
   verifies the reconstructed marker directory or returns `undefined`, so US-1426 offers
   no switch and the UI does not enter the switch branch.

8. Verify the object model for fresh link opens, the two existing anchor-free call sites,
   folder-factory switches, settings/marker changes, `.git` files, and non-filesystem
   category links. No user-visible behavior changes in this task; US-1425 consumes the
   registry and editor metadata.

## Concerns

- **D1 needs the approved narrow filesystem exception.**
  `app.fs.exists` and `app.fs.stat` are Promise-returning
  (`src/renderer/api/types/fs.d.ts:144-167`), while D1 requires synchronous
  `acceptFolder`, `resolveForFolder`, and `getFolderEditors`. The approved resolution is
  the dedicated `folder-markers.ts` module, whose direct-`fs` exception is documented in
  the coding standard; the matcher itself remains free of Node imports and uses
  `file-path` helpers.

- **Icon metadata is not currently part of `EditorDefinition`.** `target` is generic,
  so this task adds the optional `folderIcon` metadata required to remove the provider's
  editor-ID/icon map. The existing `icon-elements.ts` token mapping is sufficient.

## Acceptance criteria

- `resolveForFolder` returns `git-tree`/`mneme-root` at priority 20 only under the
  verified gates, and `category-view` at priority 0 for every directory.
- `getFolderEditors` returns [`"category-view"`] for a plain folder and the floor plus
  the winning special editor for a recognized `.git`/`.mneme` folder.
- Each folder editor exposes a verified `folderAnchor`, and the three modules expose
  `newEditorModelForFolder`; no anchor or link payload field is persisted.
- Anchor-free Git Tree and Mneme links remain unchanged and their models derive a
  verified anchor when the marker still resolves to the same editor.
- Existing Explorer rows retain their current icons and classification until US-1425
  changes only their navigation meaning.
- Verification uses the object model and a live application window only; this project
  has no unit-test harness and no test task is proposed.

## Files changed

| File | Planned change |
|---|---|
| `src/renderer/editors/base/editorRegistry.ts` | Folder matcher/module APIs and resolution methods |
| `src/renderer/editors/base/folder-markers.ts` | Approved synchronous local marker probe, with the direct-`fs` exception |
| `src/renderer/editors/base/editor-matchers.ts` | Category/Git/Mneme folder matchers and marker gates |
| `src/renderer/editors/register-editors.ts` | Attach the three matcher definitions to registrations |
| `doc/standards/coding-style.md` | Document the dedicated marker module's direct-`fs` exception |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | Delegate directory classification to the registry; remove local gates |
| `src/renderer/editors/category/CategoryEditorModel.ts` | Verified `folderAnchor` derivation and folder initialization |
| `src/renderer/editors/category/index.ts` | `newEditorModelForFolder` |
| `src/renderer/editors/git-tree/GitTreeEditorModel.ts` | Verified `folderAnchor` derivation |
| `src/renderer/editors/git-tree/index.ts` | Folder factory |
| `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts` | Verified `folderAnchor` derivation |
| `src/renderer/editors/mneme-root/index.ts` | Folder factory |

### Files verified and intentionally unchanged

- `src/shared/types.ts`, `src/shared/persistence.ts`, and
  `src/renderer/api/pages/PagesPersistenceModel.ts` — no persisted anchor or common-state
  change is needed; old descriptors need no migration.
- `src/renderer/api/pages/PagesLifecycleModel.ts` — explicit link targets already reach
  `module.newEditorModel`; folder switches use the new module factory in US-1426.
- `src/renderer/editors/base/EditorModel.ts` — base `getRestoreData` already serializes
  concrete state.
- `src/renderer/editors/board/custom-editor-registry.ts` — D4 board folder claims are out
  of scope.
- `src/renderer/content/git-tree-link.ts` and `src/renderer/content/mneme-folder-link.ts` —
  existing link payloads remain unchanged.
- `src/renderer/scripting/ai-vision/**` and `src/renderer/scripting/api-wrapper/**` — these
  already expose folder facades and the generic switch node; US-1426 verifies their behavior.
- Any unit-test or test-harness files — none are proposed.
