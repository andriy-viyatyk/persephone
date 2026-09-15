# EPIC-102: Folder editors — a registered editor for a folder, with a switch back to its content

## Status

**Status:** Complete
**Created:** 2026-09-15
**Completed:** 2026-09-15

## Overview

Two folders in the Explorer tree are not really folders to the user: `.git` is a repository and
`.mneme` is a wiki root. Today each is shown with its editor's icon *and* a trailing icon button,
and the two halves disagree — clicking the row opens the folder's **contents**, while only the
small button at the right opens the Git Tree / Mneme editor.

This epic replaces that with the mechanism the app already uses for files: **an editor registers
for a folder**, the Explorer paints the winning editor's icon on the row, selecting the row opens
that editor in the main area, and the page toolbar grows the ordinary **editor switch** so the user
can drop to **Folder View** (the folder's contents) and back.

The trailing buttons then disappear, and the behaviour stops being two hardcoded special cases:
`git-tree`, `mneme-root` and `category-view` become three entries in one folder-resolution table,
with `category-view` as the priority-0 floor exactly as `monaco` is for files.

## Goals

- A folder-acceptance contract in the editor registry, symmetric with the existing file one
  (`acceptFile` → `acceptFolder`, `resolveForFile` → `resolveForFolder`).
- `.git` and `.mneme` rows in the Explorer open their editor on a single click, with no trailing
  button, and no hardcoded `target: "git-tree"` / `target: "mneme-root"` in the tree provider.
- The page toolbar's editor switch works on a folder page: `Git Tree ⇄ Folder View`,
  `Mneme ⇄ Folder View`. A plain folder keeps exactly one candidate and therefore no switch.
- The mechanism is open: a fourth folder editor (a board claiming a folder, an `Agent Tool` folder)
  can be added as a declared set — a matcher, a `newEditorModelForFolder`, a link scheme with its
  parser, and one entry in the id→link table — with no new branch in the Explorer itself.
- No regression for a plain folder, for the `..` row, for expanding `.git` in the tree, or for
  session restore of a Git Tree / Mneme page.

## What exists today (verified 2026-09-15)

### The two special cases are spelled out in three places

- `content/tree-providers/FileTreeProvider.ts:63-77` tags the entry during `list()`:
  `isGit` (name `.git` **and** `HEAD` + `objects` present **and** `git.enabled`, `:150-158`) sets
  `{ target: "git-tree", icon: "git" }`; `isMneme` (name `.mneme` **and** `mneme.enabled`) sets
  `{ target: "mneme-root", icon: "mneme" }`.
- `components/icons/icon-elements.ts:97-103` paints from that `icon` field — so the row **already**
  shows the editor glyph, before the folder fallback at `:103`. The icon half of the request is
  done; what is missing is the behaviour behind it.
- `editors/explorer/ExplorerSecondaryView.ts:274-291` renders the trailing `IconButton` per target
  and calls `ExplorerEditorModel.openGitTree` / `openMneme` (`:267-283`), which send
  `encodeGitTreeLink(parent)` / `encodeMnemeFolderLink(parent)` through `openRawLink`.

And the row click deliberately goes the *other* way: `ExplorerEditorModel.openItem:118-120`
overrides the provider's navigation URL with a plain category link **precisely when**
`target === "git-tree" || target === "mneme-root"` — so a click shows the folder contents while
`FileTreeProvider.getNavigationUrl:137-146` (which would return the editor link) is bypassed.

### Folder editors are ordinary standalone editors already

`register-editors.ts:177-179` registers `category-view` ("Folder View"), `git-tree` ("Git Tree")
and `mneme-root` ("Mneme") with **no `match` block** and `hasContentHost` false. Each module
supplies `newEditorModel(filePath)` and decodes its own link scheme:
`editors/category/index.ts` → `decodeCategoryLink`, `editors/git-tree/index.ts` →
`decodeGitTreeLink` → `initFromRepoRoot`, `editors/mneme-root/index.ts` → `decodeMnemeFolderLink`
→ `initFromRootFolder`. `content/parsers.ts:114-146` maps each scheme to its `target`, and
`PagesLifecycleModel.buildEditorById:145-165` dispatches an explicit target to
`module.newEditorModel`. **The construction path already accepts "open editor X over path P"** —
nothing new is needed there.

### Why the existing switch cannot be reused unchanged

Three facts, each verified, define the work:

1. **They never enter the switch widget.** `getEditorSwitchOptions` starts from
   `model.findCompatibleEditors()` (`editors/base/editor-switch-options.ts:52`), whose base
   implementation returns `[]` (`base/EditorModel.ts:191-193`) and is overridden only by
   host-bearing editors and boards. `PageToolbarView.syncSegments:301-307` then hides the control
   below two options. `git-tree` and `category-view` do mount a `PageToolbarView`
   (`GitTreeEditorView.ts:201`, `category/CategoryEditor.ts:67`), so the control has a home;
   `MnemeRootEditorView` builds its own `mneme-search-toolbar` div (`:297-312`) and has **no**
   page toolbar — that is a real gap this epic must close.
2. **The switch's fallback path needs a file path these editors do not have.**
   `editor-switch.ts:135-142`: with no content host it dispose-and-rebuilds over
   `oldEditor.filePath`, and `EditorModel.filePath` reads `state.filePath` (`EditorModel.ts:219`).
   `GitTreeEditorState` carries `repoRoot`, not `filePath` (`GitTreeEditorModel.ts:70-80`,
   `:359-367`); `MnemeRootEditorState` carries `rootFolder` (`:179-187`). Both would hit
   `if (!filePath) return;` and the switch would silently do nothing.
3. **The three editors do not agree on which folder they mean.** For the Explorer row
   `C:\repo\.git`, Git Tree wants `C:\repo`, Mneme wants the parent of `.mneme`, and Folder View
   wants the `.git` directory itself. A switch cannot translate between them by string surgery
   after the fact.

### Folder View has a host dependency

`CategoryEditorModel` resolves its provider from the **page's sidebar**, not from its own link:
`providerHost` (`:96-100`) searches `page.panelEditors` for an Explorer / Link / Archive editor
whose provider matches the link's `type` **and** `sourceUrl` (`findTreeProviderHost:50-62`). With
no host, `listItems` returns `undefined` and the actions throw
*"Folder View action unavailable: no provider host is attached."* So a switch to Folder View must
build the category link with the **Explorer panel's own `sourceUrl`** — not with the folder path —
or it produces a dead page. This is the one genuinely load-bearing design detail in the epic.

### The precedent for "a manifest claims a path"

`editors/board/custom-editor-registry.ts` already resolves *files* against trusted boards with
`fileMasks` + `folderMasks` + `editorPriority`, merged with the built-in registry in
`resolveEditorIdForFile`. `folderMasks` narrows a file mask to a location; there is **no**
folder-only association today. The folder contract below is deliberately shaped so that one could
be added later (D4) without touching the Explorer again.

## Decisions

**D1 — Folder acceptance is a matcher method, not a new registry.**
`EditorMatcher` gains `acceptFolder?(folderPath: string): number` and `EditorRegistry` gains
`resolveForFolder(folderPath): string` / `getFolderEditors(folderPath): string[]`, mirroring
`acceptFile` / `resolveForFile` / `getSwitchOptions`. Priorities follow the file convention:
`category-view` returns **0** for every directory (the floor, as `monaco` is for files),
`git-tree` returns **20** when the folder is a real repo dir and `git.enabled`, `mneme-root`
returns **20** for a `.mneme` folder when `mneme.enabled`. The settings gates and the
`HEAD`+`objects` marker check move out of `FileTreeProvider` and into the matchers — the tree
provider stops knowing what a `.git` folder is.

**D2 — The anchor folder is a verified derivation, not stored state.**
Every folder editor exposes a `folderAnchor` getter — *the directory whose `resolveForFolder()`
returns this editor's own id*. Folder View's anchor is its own category; Git Tree's candidate is
`repoRoot/.git` and Mneme's is `rootFolder/.mneme`, and each is returned **only if the forward
matcher accepts it**. That verification is what makes this exact rather than the guess this
decision originally forbade: a worktree's `.git` *file*, a vanished marker, or a disabled
`git.enabled` all fail acceptance, so `folderAnchor` is `undefined` and no switch is offered.

This was originally written as a persisted `anchorFolder` field on each editor's state, set on
every construction path. Investigation (US-1424) showed that costs a field on three state
interfaces, an optional payload in two link schemes, changed initializer signatures, a restore
migration — and still leaves the two existing anchor-free link producers
(`GitTreeEditorModel.ts:527`, `MnemeConfigEditorModel.ts:199-200`) without a switch. The verified
getter has none of that: nothing is persisted, so nothing needs migrating, and a page restored
from before this epic behaves identically to a fresh one.

A module still builds the sibling editor from an anchor through a new optional
`newEditorModelForFolder?(anchorFolder: string): Promise<EditorModel>`, so each editor keeps
ownership of its own link encoding and parent derivation.

**D3 — Folder View is built from the page's Explorer panel when there is one.**
On a switch to `category-view`, the category link is
`{ type, url: <panel provider's sourceUrl>, category: anchorFolder }` taken from the page's
matching panel editor; only when the page has no such panel does it fall back to
`{ type: "file", url: anchorFolder, category: anchorFolder }` (a self-rooted view, which works
because `FileTreeProvider` accepts any directory as its root). The fallback is what makes a Git
Tree page opened from outside the Explorer — a recent-files entry, a restored session — still
offer a usable Folder View rather than a dead one.

**D4 — Boards claiming folders are out of scope, and the door is left open.**
`board-manifest.json` could later declare a folder association (a folder containing
`tools-manifest.json` opening the Agent Tool editor is the obvious first customer, and today it is
yet another trailing button — `ExplorerSecondaryView.ts:255-272`). Nothing in D1–D3 is built
around there being exactly three folder editors, and `resolveForFolder` is the single place a
merged board lookup would be added, exactly as `resolveEditorIdForFile` merges the file one. Not
built here: it needs its own trust and manifest work, and this epic is worth landing without it.

**D5 — Expanding a `.git` row in the tree is unchanged.**
The caret still lists the directory's children. Only *selection* changes meaning. The user can
still reach every file under `.git`, through the tree or through Folder View.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1424 | Folder-editor registration: `acceptFolder`, `resolveForFolder`, and the anchor-folder contract | Done |
| US-1425 | Explorer: one click opens the folder's editor; drop the trailing buttons | Done |
| US-1426 | The editor switch on a folder page, and a page toolbar for the Mneme root editor | Done |

**US-1424 — the mechanism.** Add `acceptFolder` to `EditorMatcher`, `resolveForFolder` /
`getFolderEditors` to `EditorRegistry`, and `newEditorModelForFolder` to `EditorModule`. Declare
matchers for `category-view` (0), `git-tree` (20, `git.enabled` + repo-marker) and `mneme-root`
(20, `mneme.enabled`), moving those checks out of `FileTreeProvider`. Add the persisted
`anchorFolder` to the three editor states and set it on every construction path (fresh open,
switch, restore). No user-visible change lands in this task; it is verified through the object
model.

**US-1425 — the Explorer.** `FileTreeProvider.list` sets `target`/`icon` from
`resolveForFolder(fullPath)` instead of its two hardcoded branches; `getNavigationUrl` returns the
resolved editor's folder link for any directory. Delete the `git-tree`/`mneme-root` override in
`ExplorerEditorModel.openItem` and the two trailing-button branches in `ExplorerSecondaryView`
(and `openGitTree` / `openMneme` with them, once nothing calls them). Keep the board and toolset
*file* buttons untouched — they hang off a manifest file, not a folder, and D4 is where they go.

**US-1426 — the switch.** Override `findCompatibleEditors()` on the three folder editors to return
`getFolderEditors(anchorFolder)`; add a folder branch to `switchMainEditor` that rebuilds the
target through `newEditorModelForFolder` when both sides are folder editors (D2), and build the
Folder View link per D3. Give `MnemeRootEditorView` a `PageToolbarView` so the control has
somewhere to render. Verify `Git Tree ⇄ Folder View` and `Mneme ⇄ Folder View` in a live window,
including after a restart.

## Concerns / Open Questions

1. **The Mneme root editor has no page toolbar.** Adding one is a visible change to that editor's
   chrome, not just a switch. It may need its search toolbar re-laid-out beneath it. This is the
   largest unknown in the epic and belongs to US-1426; if it turns out to be disruptive, the
   fallback is to render the switch inside the existing `mneme-search-toolbar` row.
2. **`category-view` accepting every folder at priority 0** makes `getFolderEditors` return two
   entries for `.git` and one for a plain folder — which is exactly what hides the switch on a
   plain folder (`syncSegments` needs two). Worth confirming nothing else reads
   "does an editor accept this folder" as "this folder is special".
3. **`.git` is not always a directory.** In a worktree or a submodule it is a *file* pointing at
   the real git dir. The current marker check already fails there (no `HEAD`/`objects` inside a
   file), so those rows stay plain — unchanged behaviour, but now it is the matcher's silence
   rather than the tree provider's.
4. **Session restore.** Resolved by the amended D2: nothing is persisted, so a page saved before
   this epic restores exactly like a fresh one and derives its anchor on demand. What remains to
   check is that a folder whose markers have since gone (a deleted `.git`, `git.enabled` turned
   off) degrades to "no switch" rather than an error.

5. **Explorer selection highlight.** Selecting `.git` now leaves the tree selection on a row whose
   main editor is not a category page; `ExplorerEditorModel.openItem` sets `selectedHref` before
   navigating, so this should hold, but it is worth looking at once the click path changes.
6. **The `..` row** has no `target` and resolves as a plain directory. Unchanged, but it is the
   one row where "select a folder" must keep meaning "navigate", not "open an editor".

## Notes

### 2026-09-15
- Epic opened at the user's request after reviewing the current `.git` / `.mneme` handling. The
  user's framing — *"we may reuse the same mechanism that we use for files"* and *"maybe we can
  review our editor registration and make it work for pure folders as well"* — is what D1 and D2
  implement; the investigation confirmed it is possible without a new resolution system, because
  the construction path (`buildEditorById` → `module.newEditorModel`) is already target-driven.
- The icon half of the request already works: `.git` and `.mneme` rows paint the editor glyph
  today (`icon-elements.ts:97-103`). What changes is the meaning of a click, not the picture.
- Amended after the US-1424 investigation: **D2 no longer persists an anchor folder**. The
  investigation surfaced the full cost of the stored field (three state interfaces, two link
  payloads, changed initializers, a restore path) and a gap it left open, and a verified
  derivation — propose the conventional anchor, accept it only if the forward matcher does —
  is both exact and free. Concern 4 dissolves with it.

### 2026-09-15 — all three tasks implemented
- US-1424, US-1425 and US-1426 are implemented and verified in a live window: a `.git` row
  resolves to `target: "git-tree"` / `icon: "git"` and opens Git Tree on one click, a `.mneme`
  row opens the Mneme editor, plain folders resolve to `category-view` with the folder glyph,
  and both special pages offer `Folder View ⇄ <editor>` on the toolbar while a plain folder
  offers a single option (so the control stays hidden). Folder View built by a switch resolves
  its provider from the page's Explorer panel, as D3 requires.
- Concern 1 (the Mneme page toolbar) came out cheap: `MnemeRootEditorView` mounts an ordinary
  `PageToolbarView` above its existing search toolbar, which keeps its dark treatment and
  bottom border. The fallback of rendering the switch inside the search bar was not needed.
- **One defect found by live verification and fixed:** a folder switch strands the outgoing
  editor as a duplicate sidebar panel. `git-tree` and `mneme-root` are Pattern B editors that
  survive as their own secondary view, so `setMainEditor` demotes the old instance to a panel
  rather than disposing it, and a naive rebuild on the way back produced a second one — two
  "Git" panels after one round trip, another with every repeat. The switch now promotes a
  matching surviving instance (`editorId` plus a `fpNormalizeForCompare`-equal `folderAnchor`)
  and calls `onNavigationReuse()`, mirroring `PageNavigator.reuseNavigationTarget:74-97`, and
  only builds when nothing matches. Verified stable across two round trips on the same page.
- Completion review found no architecture concerns. `/document` updated the editor architecture,
  key-file, and editor-guide references; `/userdoc` updated the Folder View, Git Tree, Mneme, and
  What's New guides. The three tasks are now complete.

